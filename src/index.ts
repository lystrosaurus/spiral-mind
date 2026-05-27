export type Role = "user" | "assistant" | "system";

// 模型结束本轮输出的原因。只有 tool_use 会让 harness 继续执行工具并回填结果。
export type StopReason =
  | "tool_use"
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "pause_turn"
  | "refusal";

export type TextBlock = {
  readonly type: "text";
  readonly text: string;
};

export type ToolInput = Readonly<Record<string, unknown>>;

export type JsonSchema = Readonly<Record<string, unknown>>;

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
  readonly inputSchema?: JsonSchema;
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

export type ModelResponseHookContext = {
  readonly iteration: number;
  readonly response: ModelResponse;
  readonly messagesBefore: readonly Message[];
};

export type Hooks = {
  readonly afterModelResponse?: (context: ModelResponseHookContext) => Promise<void> | void;
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

export type FetchLike = typeof fetch;

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const body = await response.text();

  try {
    return JSON.parse(body) as T;
  } catch {
    const contentType = response.headers.get("content-type") ?? "<missing content-type>";
    throw new Error(
      `${label} returned non-JSON response (${response.status}, ${contentType}): ${body.slice(
        0,
        300,
      )}`,
    );
  }
}

export type AnthropicMessagesModelOptions = {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly system?: string | undefined;
  readonly maxTokens?: number | undefined;
  readonly anthropicVersion?: string | undefined;
  readonly fetch?: FetchLike | undefined;
};

export function resolveAnthropicMessagesUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  if (normalizedBaseUrl.endsWith("/v1/messages")) {
    return normalizedBaseUrl;
  }
  if (normalizedBaseUrl.endsWith("/v1")) {
    return `${normalizedBaseUrl}/messages`;
  }
  return `${normalizedBaseUrl}/v1/messages`;
}

export function resolveOpenAIChatCompletionsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  if (normalizedBaseUrl.endsWith("/v1/chat/completions")) {
    return normalizedBaseUrl;
  }
  if (normalizedBaseUrl.endsWith("/v1")) {
    return `${normalizedBaseUrl}/chat/completions`;
  }
  return `${normalizedBaseUrl}/v1/chat/completions`;
}

type AnthropicMessage = {
  readonly role: "user" | "assistant";
  readonly content: string | readonly Record<string, unknown>[];
};

type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  tools: {
    name: string;
    description: string;
    input_schema: JsonSchema;
  }[];
  system?: string;
};

type AnthropicResponseBody = {
  readonly stop_reason: StopReason;
  readonly content: readonly Record<string, unknown>[];
  readonly error?: {
    readonly message?: string;
  };
};

export class AnthropicMessagesModel implements Model {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #system: string | undefined;
  readonly #maxTokens: number;
  readonly #anthropicVersion: string;
  readonly #fetch: FetchLike;

  public constructor(options: AnthropicMessagesModelOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.#system = options.system;
    this.#maxTokens = options.maxTokens ?? 8000;
    this.#anthropicVersion = options.anthropicVersion ?? "2023-06-01";
    this.#fetch = options.fetch ?? fetch;
  }

  public async create(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
  ): Promise<ModelResponse> {
    const system = this.#buildSystem(messages);
    const body: AnthropicRequestBody = {
      model: this.#model,
      max_tokens: this.#maxTokens,
      messages: messages
        .filter((message) => message.role !== "system")
        .map((message) => this.#toAnthropicMessage(message)),
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema ?? { type: "object", properties: {} },
      })),
    };
    if (system) {
      body.system = system;
    }

    const response = await this.#fetch(this.#messagesUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.#apiKey,
        "anthropic-version": this.#anthropicVersion,
      },
      body: JSON.stringify(body),
    });

    const responseBody = await readJsonResponse<AnthropicResponseBody>(
      response,
      "Anthropic Messages API",
    );
    if (!response.ok) {
      throw new Error(
        `Anthropic Messages API request failed (${response.status}): ${
          responseBody.error?.message ?? response.statusText
        }`,
      );
    }

    return {
      stopReason: responseBody.stop_reason,
      content: responseBody.content.map((block) => this.#fromAnthropicBlock(block)),
    };
  }

  #buildSystem(messages: readonly Message[]): string | undefined {
    const systemMessages = messages
      .filter((message) => message.role === "system")
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("\n"),
      )
      .filter((content) => content.length > 0);

    return [this.#system, ...systemMessages].filter(Boolean).join("\n\n") || undefined;
  }

  #messagesUrl(): string {
    return resolveAnthropicMessagesUrl(this.#baseUrl);
  }

  #toAnthropicMessage(message: Message): AnthropicMessage {
    if (message.role === "system") {
      throw new Error("System messages are serialized through the top-level system field.");
    }

    return {
      role: message.role,
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((block) => this.#toAnthropicBlock(block)),
    };
  }

  #toAnthropicBlock(block: ContentBlock): Record<string, unknown> {
    switch (block.type) {
      case "text":
        return block;
      case "tool_use":
        return block;
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
        };
    }
  }

  #fromAnthropicBlock(block: Record<string, unknown>): ContentBlock {
    if (block.type === "text") {
      return {
        type: "text",
        text: String(block.text ?? ""),
      };
    }

    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: String(block.id),
        name: String(block.name),
        input: this.#asToolInput(block.input),
      };
    }

    return {
      type: "text",
      text: JSON.stringify(block),
    };
  }

  #asToolInput(value: unknown): ToolInput {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as ToolInput;
    }
    return {};
  }
}

export type OpenAIChatCompletionsModelOptions = {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly maxTokens?: number | undefined;
  readonly fetch?: FetchLike | undefined;
};

type OpenAIChatCompletionResponseBody = {
  readonly choices?: readonly {
    readonly finish_reason?: string | null;
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly {
        readonly id?: string;
        readonly type?: string;
        readonly function?: {
          readonly name?: string;
          readonly arguments?: string;
        };
      }[];
    };
  }[];
  readonly error?: {
    readonly message?: string;
  };
};

export class OpenAIChatCompletionsModel implements Model {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #maxTokens: number;
  readonly #fetch: FetchLike;

  public constructor(options: OpenAIChatCompletionsModelOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.#maxTokens = options.maxTokens ?? 1024;
    this.#fetch = options.fetch ?? fetch;
  }

  public async create(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
  ): Promise<ModelResponse> {
    const response = await this.#fetch(resolveOpenAIChatCompletionsUrl(this.#baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.#model,
        max_tokens: this.#maxTokens,
        messages: this.#toOpenAIMessages(messages),
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema ?? { type: "object", properties: {} },
          },
        })),
      }),
    });

    const responseBody = await readJsonResponse<OpenAIChatCompletionResponseBody>(
      response,
      "OpenAI-compatible chat completion API",
    );
    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible chat completion request failed (${response.status}): ${
          responseBody.error?.message ?? response.statusText
        }`,
      );
    }

    const choice = responseBody.choices?.[0];
    if (!choice?.message) {
      throw new Error("OpenAI-compatible response did not include choices[0].message.");
    }

    return this.#fromOpenAIChoice(choice);
  }

  #toOpenAIMessages(messages: readonly Message[]): Record<string, unknown>[] {
    const mapped: Record<string, unknown>[] = [];

    for (const message of messages) {
      if (typeof message.content === "string") {
        mapped.push({
          role: message.role,
          content: message.content,
        });
        continue;
      }

      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const toolUses = message.content.filter((block) => block.type === "tool_use");
      const toolResults = message.content.filter((block) => block.type === "tool_result");

      if (toolUses.length > 0) {
        mapped.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUses.map((block) => ({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          })),
        });
      } else if (text) {
        mapped.push({
          role: message.role,
          content: text,
        });
      }

      for (const block of toolResults) {
        mapped.push({
          role: "tool",
          tool_call_id: block.toolUseId,
          content: block.content,
        });
      }
    }

    return mapped;
  }

  #fromOpenAIChoice(choice: NonNullable<OpenAIChatCompletionResponseBody["choices"]>[number]): ModelResponse {
    const content: ContentBlock[] = [];
    const message = choice.message;

    if (typeof message?.content === "string" && message.content.length > 0) {
      content.push({
        type: "text",
        text: message.content,
      });
    }

    for (const toolCall of message?.tool_calls ?? []) {
      if (toolCall.function?.name) {
        content.push({
          type: "tool_use",
          id: toolCall.id ?? `tool-call-${content.length + 1}`,
          name: toolCall.function.name,
          input: this.#parseToolArguments(toolCall.function.arguments ?? "{}"),
        });
      }
    }

    return {
      stopReason: this.#stopReason(choice.finish_reason, content),
      content,
    };
  }

  #stopReason(reason: string | null | undefined, content: readonly ContentBlock[]): StopReason {
    if (content.some((block) => block.type === "tool_use") || reason === "tool_calls") {
      return "tool_use";
    }
    if (reason === "length") {
      return "max_tokens";
    }
    if (reason === "content_filter") {
      return "stop_sequence";
    }
    return "end_turn";
  }

  #parseToolArguments(value: string): ToolInput {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as ToolInput;
      }
    } catch {
      return {};
    }
    return {};
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
      const messagesBefore = [...messages];
      const response = await this.#model.create(messages, tools);
      await this.#hooks.afterModelResponse?.({
        iteration: iteration + 1,
        response,
        messagesBefore,
      });
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
