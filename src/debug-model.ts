/**
 * ============================================================================
 * src/debug-model.ts —— 用真实模型跑 harness 的 CLI 调试入口
 * ============================================================================
 *
 * 用法：
 *   npm run debug:model -- "Use the bash tool to run pwd, then explain the harness loop."
 *
 * 它会做这些事：
 *   1. 从 .env 加载 API key 和模型配置
 *   2. 根据 MODEL_PROVIDER 构造对应的 Model 适配器（Anthropic 或 OpenAI）
 *   3. 注册一个"安全版 bash"工具（只允许 pwd / ls / dir / echo）
 *   4. 配一个白名单 PermissionPolicy，危险命令直接拒绝
 *   5. 挂上丰富的 hook，把每一轮模型响应和每次工具调用都打印出来
 *   6. 启动 AgentLoop，跑完后打印完整对话历史
 *
 * 这个文件的价值：让你**亲眼看到** harness 的每一步——模型什么时候要调工具、
// 权限在哪一步生效、工具结果什么时候回填进 messages。
 * ============================================================================
 */

import process from "node:process";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// 注意这里 import 的是 ./index.js 而不是 ./index.ts：
// 项目用 tsc 把 .ts 编译成 .js 后运行，所以 import 路径要用编译后的扩展名。
// 这是 TS ESM 项目的常见约定（TS 不会自动改写 import 路径）。
import {
  AgentLoop,
  AnthropicMessagesModel,
  OpenAIChatCompletionsModel,
  defineTool,
  type Model,
  type ContentBlock,
  type PermissionPolicy,
  type ToolDefinition,
  type ToolInput,
} from "./index.js";
// 上面 import 里的 type 关键字：表示"这个符号只用作类型，运行时不存在"。
// 编译时会被完全擦除，不会出现在最终 .js 里。

import { findDotEnvFile, loadDotEnvFile } from "./env.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

/**
 * 判断当前模块是不是"被直接执行的入口"。
 *
 * 在 ESM 里，import.meta.url 是当前模块的 file:// URL；
// process.argv[1] 是 node 命令行传入的脚本路径。
// 两者相等说明用户是 `node debug-model.js` 直接跑的，
// 而不是被别的模块 import 进来当库用的。
 *
 * 这样写可以让这个文件既能当 CLI 入口、又能被测试代码 import 而不会误执行 main()。
 *
 * @param moduleUrl  当前模块的 import.meta.url
 * @param entryPath  process.argv[1]（可能为 undefined）
 */
export function isCliEntrypoint(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

/**
 * 从 ToolInput 里安全地取一个字符串字段。
 *
 * ToolInput 的值类型是 unknown，可能不是字符串（模型可能给了数字、对象、null）。
 * 这里做一次运行时类型检查：不是字符串就返回空串，避免后续 .trim() 之类崩掉。
 */
function getTextInput(input: ToolInput, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

/**
 * 构造一个"安全版 bash"工具。
 *
 * 这是调试专用的玩具工具：只支持四条命令（pwd / ls / dir / echo），
// 其他命令直接返回"不允许"。这样既能演示工具协议，又不用担心模型乱执行。
 *
 * 真实项目里千万别这么开放 bash 工具，要有严格的沙箱和权限控制。
 */
function createSafeBashTool(): ToolDefinition {
  return defineTool({
    name: "bash",
    description:
      "Run a tiny allowlisted local command for harness debugging. Allowed commands: pwd, ls, dir, echo <text>.",
    // inputSchema 是给模型看的"参数说明书"，模型据此生成合法的 input
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command to run. Allowed: pwd, ls, dir, echo <text>.",
        },
      },
      required: ["command"],
    },
    handler: async (input) => {
      const command = getTextInput(input, "command").trim();

      if (command === "pwd") {
        return process.cwd();
      }

      if (command === "ls" || command === "dir") {
        // readdir 配 withFileTypes: true 会返回 Dirent 对象，
        // 可以直接判断是文件还是目录，不用再次 stat
        const entries = await readdir(process.cwd(), { withFileTypes: true });
        return entries
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
          .join("\n");
      }

      if (command.startsWith("echo ")) {
        // slice 去掉前缀 "echo "，剩下部分就是要 echo 的内容
        return command.slice("echo ".length);
      }

      return `Command not allowed in this learning harness: ${command}`;
    },
  });
}

/**
 * 权限策略：工具白名单。
 *
 * 注意这是双保险：
 *   1. 这里限制"只允许 bash 工具 + 只允许四种命令"
 *   2. createSafeBashTool 的 handler 内部也限制了同样的命令
 *
 * 为什么要双保险？因为权限策略是"通用防线"，handler 内部判断是"工具的自我保护"。
// 即使将来某个工具忘了自我保护，权限策略还能兜底；反之亦然。
 */
const permission: PermissionPolicy = {
  canUseTool: (toolUse) => {
    if (toolUse.name !== "bash") {
      return {
        allowed: false,
        reason: "only the bash debug tool is registered",
      };
    }

    const command = getTextInput(toolUse.input, "command").trim();
    const allowed =
      command === "pwd" ||
      command === "ls" ||
      command === "dir" ||
      command.startsWith("echo ");

    return allowed
      ? { allowed: true }
      : {
          allowed: false,
          reason: `debug CLI only allows pwd, ls, dir, and echo; got: ${command}`,
        };
  },
};

/**
 * 把消息的 content 格式化成人类可读的多行文本（用于最后打印完整对话历史）。
 *
 * content 既可能是字符串（普通对话），也可能是 ContentBlock[]（含工具调用）。
 */
function formatContent(content: string | readonly ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "tool_use":
          return `[tool_use ${block.name}] ${JSON.stringify(block.input)}`;
        case "tool_result":
          return `[tool_result ${block.toolUseId}] ${block.content}`;
      }
    })
    .join("\n");
}

/**
 * 把 ContentBlock[] 压缩成单行摘要（用于 hook 里的实时打印）。
 *
 * 太长的文本会被截断到 120 字符，避免刷屏。
 */
function summarizeContent(content: readonly ContentBlock[]): string {
  return content
    .map((block) => {
      switch (block.type) {
        case "text":
          return `text(${JSON.stringify(block.text.slice(0, 120))})`;
        case "tool_use":
          return `tool_use(name=${block.name}, input=${JSON.stringify(block.input)})`;
        case "tool_result":
          return `tool_result(id=${block.toolUseId}, content=${JSON.stringify(
            block.content.slice(0, 120),
          )})`;
      }
    })
    .join(" | ");
}

/**
 * CLI 入口主函数。
 */
async function main(): Promise<void> {
  // 第一步：把 .env 里的环境变量加载进 process.env。
  // 用 findDotEnvFile 向上查找，避免 IDEA 调试时 cwd 不是工程根目录导致找不到。
  const envPath = findDotEnvFile();
  if (envPath) {
    console.log(`.env: ${envPath}`);
    await loadDotEnvFile(envPath);
  } else {
    console.log(".env: not found (falling back to process environment only)");
  }

  // 模型供应商：anthropic（默认）或 openai
  const provider = process.env.MODEL_PROVIDER ?? "anthropic";

  // 用户的提示词：取命令行参数（去掉 node 和脚本路径），用空格拼起来。
  // process.argv 形如：["node", "dist/src/debug-model.js", "你", "好"]
  // slice(2) 去掉前两个，join(" ") 拼回完整 prompt。
  const prompt =
    process.argv.slice(2).join(" ") ||
    "Use the bash tool to run pwd, then explain what happened in the harness loop.";

  const model = createModel(provider);

  const loop = new AgentLoop({
    model,
    tools: [createSafeBashTool()],
    permission,
    hooks: {
      // 每次模型响应完触发：打印当前轮次、消息数、stopReason、内容摘要
      afterModelResponse: ({ iteration, response, messagesBefore }) => {
        console.log(`\n=== model turn ${iteration} ===`);
        console.log(`request messages: ${messagesBefore.length}`);
        console.log(`available tools: bash`);
        console.log(`stopReason: ${response.stopReason}`);
        console.log(`assistant content: ${summarizeContent(response.content)}`);
      },
      // 每次工具执行前触发：打印模型要求调用什么
      beforeToolUse: ({ toolUse }) => {
        console.log(`\n--- dispatch tool ---`);
        console.log(`tool_use.id: ${toolUse.id}`);
        console.log(`tool_use.name: ${toolUse.name}`);
        console.log(`tool_use.input: ${JSON.stringify(toolUse.input)}`);
      },
      // 每次工具执行后触发：打印结果，并提醒结果会被作为 user 消息回填
      afterToolUse: ({ result }) => {
        console.log(`tool_result.toolUseId: ${result.toolUseId}`);
        console.log(`tool_result.content: ${result.content}`);
        console.log(`--- tool result appended as next user message ---\n`);
      },
    },
    // 限制最多 5 轮，防止调试时意外把额度烧光
    maxIterations: 5,
  });

  // 启动主循环。初始 messages 只有一条用户消息（用户的 prompt）。
  const result = await loop.run([{ role: "user", content: prompt }]);

  // 打印最终结果
  console.log(`stopReason: ${result.stopReason}`);
  // result.messages.entries() 返回 [索引, 元素] 迭代器，方便打印序号
  for (const [index, message] of result.messages.entries()) {
    console.log(`\n#${index + 1} ${message.role}`);
    console.log(formatContent(message.content));
  }
}

/**
 * 根据 provider 构造对应的 Model 适配器。
 *
 * provider === "openai" 时用 OpenAI 兼容网关，否则用 Anthropic。
 * 两者都支持通过 ANTHROPIC_* 环境变量兜底，方便"一套 .env 切换两家"。
 */
function createModel(provider: string): Model {
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Set OPENAI_API_KEY in .env before running with MODEL_PROVIDER=openai.");
    }

    return new OpenAIChatCompletionsModel({
      apiKey,
      model: process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL,
      baseUrl: process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL,
      maxTokens: Number(process.env.OPENAI_MAX_TOKENS ?? process.env.ANTHROPIC_MAX_TOKENS ?? 1024),
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Set ANTHROPIC_API_KEY in .env before running with MODEL_PROVIDER=anthropic.");
  }

  return new AnthropicMessagesModel({
    apiKey,
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? 1024),
    system:
      "You are debugging a small agent harness. Use the bash tool when it helps answer the user.",
  });
}

// 只有"被直接执行"时才跑 main()；被 import 时不跑（方便测试）
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    // error instanceof Error 是类型守卫：确认是 Error 实例才取 .message，
    // 否则原样打印（万一有人 throw 一个字符串）
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
