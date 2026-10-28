/**
 * ============================================================================
 * src/debug-config.ts —— 检查 .env 配置是否生效的 CLI 工具
 * ============================================================================
 *
 * 用法：
 *   npm run debug:config
 *
 * 它会打印：
 *   - .env 文件是否存在
 *   - 当前的 MODEL_PROVIDER
 *   - 用到的 API key（打码显示，不会泄露完整 key）
 *   - 模型名、base URL、maxTokens
 *   - 最终解析出来的完整 API 端点 URL
 *   - 认证 header 风格（Anthropic 用 x-api-key，OpenAI 用 Authorization: Bearer）
 *
 * 用途：在跑 debug:model 之前，先确认配置都对、URL 拼接正确。
 * 特别是当你用了自建的 OpenAI 兼容网关时，最容易出 URL 拼接错误。
 * ============================================================================
 */

import { existsSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { loadDotEnvFile } from "./env.js";
import { resolveAnthropicMessagesUrl, resolveOpenAIChatCompletionsUrl } from "./index.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

/**
 * 把 API key 打码显示，避免泄露。
 *
 * 显示规则：
 *   - 没设置：显示 <missing>
 *   - 太短（<=12 字符）：显示 <set, length N>（太短了露前几位都不安全）
 *   - 正常长度：显示前 7 位 + ... + 后 4 位，附带总长度
 *
 * 例如 sk-ant-abc...xyz1 (length 108)
 */
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
  // 把 .env 加载进 process.env
  await loadDotEnvFile(envPath);

  const provider = process.env.MODEL_PROVIDER ?? "anthropic";

  console.log(`.env present: ${existsSync(envPath)}`);
  console.log(`MODEL_PROVIDER: ${provider}`);

  if (provider === "openai") {
    // OpenAI 路径：所有配置优先用 OPENAI_*，缺省时回退到 ANTHROPIC_* 兜底
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

  // Anthropic 路径（默认）
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? DEFAULT_BASE_URL;
  console.log(`ANTHROPIC_API_KEY: ${maskSecret(process.env.ANTHROPIC_API_KEY)}`);
  console.log(`ANTHROPIC_MODEL: ${process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL}`);
  console.log(`ANTHROPIC_BASE_URL: ${baseUrl}`);
  console.log(`ANTHROPIC_MAX_TOKENS: ${process.env.ANTHROPIC_MAX_TOKENS ?? 1024}`);
  console.log(`resolved Messages URL: ${resolveAnthropicMessagesUrl(baseUrl)}`);
  console.log("auth header style: x-api-key");
}

// 只有被直接执行时才跑 main()
// 这个判断方式和 debug-model.ts 里的 isCliEntrypoint 等价，只是这里直接内联写出来了
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
