import process from "node:process";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

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
import { loadDotEnvFile } from "./env.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function isCliEntrypoint(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

function getTextInput(input: ToolInput, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function createSafeBashTool(): ToolDefinition {
  return defineTool({
    name: "bash",
    description:
      "Run a tiny allowlisted local command for harness debugging. Allowed commands: pwd, ls, dir, echo <text>.",
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
        const entries = await readdir(process.cwd(), { withFileTypes: true });
        return entries
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
          .join("\n");
      }

      if (command.startsWith("echo ")) {
        return command.slice("echo ".length);
      }

      return `Command not allowed in this learning harness: ${command}`;
    },
  });
}

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

async function main(): Promise<void> {
  await loadDotEnvFile();

  const provider = process.env.MODEL_PROVIDER ?? "anthropic";

  const prompt =
    process.argv.slice(2).join(" ") ||
    "Use the bash tool to run pwd, then explain what happened in the harness loop.";

  const model = createModel(provider);

  const loop = new AgentLoop({
    model,
    tools: [createSafeBashTool()],
    permission,
    hooks: {
      afterModelResponse: ({ iteration, response, messagesBefore }) => {
        console.log(`\n=== model turn ${iteration} ===`);
        console.log(`request messages: ${messagesBefore.length}`);
        console.log(`available tools: bash`);
        console.log(`stopReason: ${response.stopReason}`);
        console.log(`assistant content: ${summarizeContent(response.content)}`);
      },
      beforeToolUse: ({ toolUse }) => {
        console.log(`\n--- dispatch tool ---`);
        console.log(`tool_use.id: ${toolUse.id}`);
        console.log(`tool_use.name: ${toolUse.name}`);
        console.log(`tool_use.input: ${JSON.stringify(toolUse.input)}`);
      },
      afterToolUse: ({ result }) => {
        console.log(`tool_result.toolUseId: ${result.toolUseId}`);
        console.log(`tool_result.content: ${result.content}`);
        console.log(`--- tool result appended as next user message ---\n`);
      },
    },
    maxIterations: 5,
  });

  const result = await loop.run([{ role: "user", content: prompt }]);

  console.log(`stopReason: ${result.stopReason}`);
  for (const [index, message] of result.messages.entries()) {
    console.log(`\n#${index + 1} ${message.role}`);
    console.log(formatContent(message.content));
  }
}

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

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
