/**
 * ============================================================================
 * test/env.test.ts —— .env 解析与合并的行为测试
 * ============================================================================
 *
 * 测试 src/env.ts 里的三个核心行为：
 *   1. parseDotEnv 能解析简单的 KEY=VALUE，忽略注释和空行
 *   2. parseDotEnv 能识别带引号的 value，并自动去掉引号
 *   3. applyDotEnv 默认会覆盖目标环境对象里的已有值
 *   4. applyDotEnv 传 { override: false } 时会保留已有值
 * ============================================================================
 */

import test from "node:test";
import assert from "node:assert/strict";

import { applyDotEnv, parseDotEnv } from "../src/env.js";

/**
 * 基础解析：KEY=VALUE 行被识别，# 开头的注释和空行被忽略。
 *
 * 注意这里用了反引号模板字符串（`...`），可以跨多行书写，
 * 字符串里的换行就是真实的换行符。
 */
test("parseDotEnv reads simple key value pairs and ignores comments", () => {
  assert.deepEqual(
    parseDotEnv(`
# local debug settings
ANTHROPIC_API_KEY=sk-ant-placeholder
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_BASE_URL=https://gateway.example.test
`),
    {
      ANTHROPIC_API_KEY: "sk-ant-placeholder",
      ANTHROPIC_MODEL: "claude-sonnet-4-20250514",
      ANTHROPIC_BASE_URL: "https://gateway.example.test",
    },
  );
});

/**
 * 带引号的 value："..." 或 '...' 包裹的值会自动去掉外层引号。
 * 这样 .env 里可以写带有特殊字符的值（比如含空格的）。
 */
test("parseDotEnv supports quoted values", () => {
  assert.deepEqual(
    parseDotEnv(`
ANTHROPIC_API_KEY="sk-ant-placeholder"
ANTHROPIC_BASE_URL='https://gateway.example.test/v1'
`),
    {
      ANTHROPIC_API_KEY: "sk-ant-placeholder",
      ANTHROPIC_BASE_URL: "https://gateway.example.test/v1",
    },
  );
});

/**
 * 默认行为：.env 里的值会覆盖 process.env 里已有的同名值。
 *
 * 场景：用户的 shell 里 export 了 ANTHROPIC_BASE_URL，
 * 但项目本地 .env 想用另一个地址——默认应该是 .env 优先。
 */
test("applyDotEnv overrides existing process environment values by default", () => {
  // Record<string, string | undefined> 是 process.env 的形状
  const env: Record<string, string | undefined> = {
    ANTHROPIC_BASE_URL: "https://from-shell.example.test",
  };

  applyDotEnv(
    {
      ANTHROPIC_API_KEY: "from-file",
      ANTHROPIC_BASE_URL: "https://from-file.example.test",
    },
    env,
  );

  assert.deepEqual(env, {
    ANTHROPIC_API_KEY: "from-file",
    // 已有值被覆盖了
    ANTHROPIC_BASE_URL: "https://from-file.example.test",
  });
});

/**
 * 传 { override: false }：已有值保留，只补充缺失的键。
 *
 * 场景：部署平台已经注入了生产配置，本地的 .env 只用来填默认值。
 */
test("applyDotEnv can preserve existing process environment values", () => {
  const env: Record<string, string | undefined> = {
    ANTHROPIC_BASE_URL: "https://from-shell.example.test",
  };

  applyDotEnv(
    {
      ANTHROPIC_API_KEY: "from-file",
      ANTHROPIC_BASE_URL: "https://from-file.example.test",
    },
    env,
    { override: false },
  );

  assert.deepEqual(env, {
    ANTHROPIC_API_KEY: "from-file",
    // 已有值保留
    ANTHROPIC_BASE_URL: "https://from-shell.example.test",
  });
});
