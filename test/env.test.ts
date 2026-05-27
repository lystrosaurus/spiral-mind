import test from "node:test";
import assert from "node:assert/strict";

import { applyDotEnv, parseDotEnv } from "../src/env.js";

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

test("applyDotEnv overrides existing process environment values by default", () => {
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
    ANTHROPIC_BASE_URL: "https://from-file.example.test",
  });
});

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
    ANTHROPIC_BASE_URL: "https://from-shell.example.test",
  });
});
