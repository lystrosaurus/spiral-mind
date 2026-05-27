import { existsSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { loadDotEnvFile } from "./env.js";
import { resolveAnthropicMessagesUrl, resolveOpenAIChatCompletionsUrl } from "./index.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

function maskSecret(value: string | undefined): string {
  if (!value) {
    return "<missing>";
  }

  if (value.length <= 12) {
    return `<set, length ${value.length}>`;
  }

  return `${value.slice(0, 7)}...${value.slice(-4)} (length ${value.length})`;
}

async function main(): Promise<void> {
  const envPath = ".env";
  await loadDotEnvFile(envPath);

  const provider = process.env.MODEL_PROVIDER ?? "anthropic";

  console.log(`.env present: ${existsSync(envPath)}`);
  console.log(`MODEL_PROVIDER: ${provider}`);

  if (provider === "openai") {
    const baseUrl =
      process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? DEFAULT_OPENAI_BASE_URL;
    console.log(`OPENAI_API_KEY: ${maskSecret(process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY)}`);
    console.log(`OPENAI_MODEL: ${process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL}`);
    console.log(`OPENAI_BASE_URL: ${baseUrl}`);
    console.log(`OPENAI_MAX_TOKENS: ${process.env.OPENAI_MAX_TOKENS ?? process.env.ANTHROPIC_MAX_TOKENS ?? 1024}`);
    console.log(`resolved Chat Completions URL: ${resolveOpenAIChatCompletionsUrl(baseUrl)}`);
    console.log("auth header style: Authorization: Bearer");
    return;
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? DEFAULT_BASE_URL;
  console.log(`ANTHROPIC_API_KEY: ${maskSecret(process.env.ANTHROPIC_API_KEY)}`);
  console.log(`ANTHROPIC_MODEL: ${process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL}`);
  console.log(`ANTHROPIC_BASE_URL: ${baseUrl}`);
  console.log(`ANTHROPIC_MAX_TOKENS: ${process.env.ANTHROPIC_MAX_TOKENS ?? 1024}`);
  console.log(`resolved Messages URL: ${resolveAnthropicMessagesUrl(baseUrl)}`);
  console.log("auth header style: x-api-key");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
