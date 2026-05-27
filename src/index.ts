export type Role = "user" | "assistant" | "system";

// 模型结束本轮输出的原因。只有 tool_use 会让 harness 继续执行工具并回填结果。
export type StopReason = "tool_use" | "end_turn" | "max_tokens" | "stop_sequence";

export type TextBlock = {
  readonly type: "text";
  readonly text: string;
};

export type ToolInput = Readonly<Record<string, unknown>>;

// 模型请求工具时输出的结构。handler 只通过 name 和 input 被路由。
export type ToolUseBlock = {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: ToolInput;
};

// 工具执行结果会作为 user 消息追加回 messages，让模型在下一轮继续推理。
export type ToolResultBlock = {
  readonly type: "tool_result";
  readonly toolUseId: string;
  readonly content: string;
};

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type Message = {
  readonly role: Role;
  readonly content: string | readonly ContentBlock[];
};

export type ModelResponse = {
  readonly stopReason: StopReason;
  readonly content: readonly ContentBlock[];
};

// 真实模型和测试 fake model 都只需要实现这个最小接口。
export type Model = {
  create(messages: readonly Message[], tools: readonly ToolDefinition[]): Promise<ModelResponse>;
};

export type ToolContext = {
  readonly messages: readonly Message[];
};

export type ToolHandler = (
  input: ToolInput,
  context: ToolContext,
) => Promise<string> | string;

export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly handler: ToolHandler;
};

// 当前权限系统只有允许和拒绝两种结果；后续章节可以扩展为 require_approval。
export type PermissionDecision =
  | {
      readonly allowed: true;
      readonly reason?: string;
    }
  | {
      readonly allowed: false;
      readonly reason: string;
    };

export type PermissionPolicy = {
  canUseTool(toolUse: ToolUseBlock, tool: ToolDefinition): PermissionDecision;
};

// hook 拿到的是只读上下文，用来记录日志、统计、审计，不直接改变核心循环。
export type ToolHookContext = {
  readonly toolUse: ToolUseBlock;
  readonly tool: ToolDefinition;
  readonly messages: readonly Message[];
};

export type ToolResultHookContext = ToolHookContext & {
  readonly result: ToolResultBlock;
};

export type Hooks = {
  readonly beforeToolUse?: (context: ToolHookContext) => Promise<void> | void;
  readonly afterToolUse?: (context: ToolResultHookContext) => Promise<void> | void;
};

export type AgentLoopOptions = {
  readonly model: Model;
  readonly tools: readonly ToolDefinition[];
  readonly permission?: PermissionPolicy;
  readonly hooks?: Hooks;
  readonly maxIterations?: number;
};

export type AgentRunResult = {
  readonly stopReason: StopReason;
  readonly messages: readonly Message[];
};

export class PermissionDeniedError extends Error {
  public constructor(toolUse: ToolUseBlock, reason: string) {
    super(`Permission denied for tool "${toolUse.name}": ${reason}`);
    this.name = "PermissionDeniedError";
  }
}

export class UnknownToolError extends Error {
  public constructor(toolName: string) {
    super(`Unknown tool "${toolName}"`);
    this.name = "UnknownToolError";
  }
}

export class MaxIterationsError extends Error {
  public constructor(maxIterations: number) {
    super(`Agent loop reached max iterations (${maxIterations})`);
    this.name = "MaxIterationsError";
  }
}

// 小封装让调用处保持“定义工具”的语义，后续可以在这里增加 schema 校验。
export function defineTool(definition: ToolDefinition): ToolDefinition {
  return definition;
}

// 测试用的脚本模型：按顺序吐出预置响应，方便稳定复现 agent loop 行为。
export class MemoryModel implements Model {
  readonly #responses: ModelResponse[];
  #index = 0;

  public constructor(responses: readonly ModelResponse[]) {
    this.#responses = [...responses];
  }

  public async create(): Promise<ModelResponse> {
    const response = this.#responses[this.#index];
    if (!response) {
      return {
        stopReason: "end_turn",
        content: [{ type: "text", text: "No more scripted responses." }],
      };
    }

    this.#index += 1;
    return response;
  }
}

export class AgentLoop {
  readonly #model: Model;
  readonly #tools: Map<string, ToolDefinition>;
  readonly #permission: PermissionPolicy;
  readonly #hooks: Hooks;
  readonly #maxIterations: number;

  public constructor(options: AgentLoopOptions) {
    this.#model = options.model;
    // dispatch map 是 s02 的核心：模型只说工具名，harness 决定调用哪个 handler。
    this.#tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.#permission =
      options.permission ??
      ({
        canUseTool: () => ({ allowed: true }),
      } satisfies PermissionPolicy);
    this.#hooks = options.hooks ?? {};
    this.#maxIterations = options.maxIterations ?? 25;
  }

  public async run(initialMessages: readonly Message[]): Promise<AgentRunResult> {
    const messages: Message[] = [...initialMessages];
    const tools = [...this.#tools.values()];

    // 这是整个 harness 的主循环：问模型、记录响应、必要时执行工具、再问模型。
    for (let iteration = 0; iteration < this.#maxIterations; iteration += 1) {
      const response = await this.#model.create(messages, tools);
      messages.push({ role: "assistant", content: response.content });

      // 不是 tool_use 就表示模型本轮不再要求 harness 行动，直接把 transcript 返回。
      if (response.stopReason !== "tool_use") {
        return {
          stopReason: response.stopReason,
          messages,
        };
      }

      // 工具结果以 user 消息身份回填，这是 Anthropic/OpenAI 类工具协议的常见形态。
      const toolResults = await this.#runToolUses(response.content, messages);
      messages.push({ role: "user", content: toolResults });
    }

    throw new MaxIterationsError(this.#maxIterations);
  }

  async #runToolUses(
    content: readonly ContentBlock[],
    messages: readonly Message[],
  ): Promise<ToolResultBlock[]> {
    const results: ToolResultBlock[] = [];

    // 一次模型响应里可以混有 text 和多个 tool_use；这里只执行 tool_use block。
    for (const block of content) {
      if (block.type !== "tool_use") {
        continue;
      }

      const tool = this.#tools.get(block.name);
      if (!tool) {
        throw new UnknownToolError(block.name);
      }

      // 权限检查必须发生在 handler 前，确保被拒绝的工具不会产生副作用。
      const decision = this.#permission.canUseTool(block, tool);
      if (!decision.allowed) {
        throw new PermissionDeniedError(block, decision.reason);
      }

      const hookContext: ToolHookContext = {
        toolUse: block,
        tool,
        messages,
      };
      await this.#hooks.beforeToolUse?.(hookContext);

      // handler 是唯一真正执行外部动作的位置，例如读文件、跑命令或调用 API。
      const content = await tool.handler(block.input, { messages });
      const result: ToolResultBlock = {
        type: "tool_result",
        toolUseId: block.id,
        content,
      };

      await this.#hooks.afterToolUse?.({
        ...hookContext,
        result,
      });
      results.push(result);
    }

    return results;
  }
}
