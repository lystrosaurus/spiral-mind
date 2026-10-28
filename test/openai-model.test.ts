/**
 * ============================================================================
 * test/openai-model.test.ts —— OpenAI 模型适配器的行为测试
 * ============================================================================
 *
 * 和 anthropic-model.test.ts 一样用"注入假 fetch"的方式做无副作用测试。
 *
 * 重点关注 OpenAI 协议和 Anthropic 的几处差异：
 *   - 认证用 Authorization: Bearer <key>，不是 x-api-key
 *   - 工具调用叫 tool_calls，arguments 是 JSON 字符串（不是对象）
 *   - 工具结果用 role: "tool" 的独立消息表示，不是塞在 user 消息里
 *   - 响应里有 choices 数组，stop_reason 字段叫 finish_reason
 * ============================================================================
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  OpenAIChatCompletionsModel,
  defineTool,
  resolveOpenAIChatCompletionsUrl,
  type Message,
} from "../src/index.js";

/**
 * 验证：模型调用时按 OpenAI 协议序列化请求，并把响应翻译回内部 ModelResponse。
 *
 * 假 fetch 的剧本：返回一个 tool_calls 调用 bash({"command":"pwd"})。
 * 注意 arguments 字段是 JSON 字符串 "{\"command\":\"pwd\"}"，
 * 适配器内部要把它 JSON.parse 回对象。
 */
test("OpenAIChatCompletionsModel sends OpenAI-compatible chat completion requests", async () => {
  let requestUrl = "";
  let requestBody: unknown;
  let requestHeaders: Headers | undefined;

  const model = new OpenAIChatCompletionsModel({
    apiKey: "test-key",
    baseUrl: "https://gateway.example.test/v1",
    model: "test-model",
    maxTokens: 123,
    fetch: async (url, init) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body));
      requestHeaders = new Headers(init?.headers);

      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                // content 为 null 是 OpenAI 工具调用响应的常见形态：
                // 模型这一轮只想调工具，没有文字回复
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "bash",
                      // 注意：arguments 是 JSON 字符串而不是对象
                      arguments: "{\"command\":\"pwd\"}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    },
  });

  const response = await model.create(
    [{ role: "user", content: "where am I?" }],
    [
      defineTool({
        name: "bash",
        description: "Run a shell command.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
        },
        handler: async () => "unused",
      }),
    ],
  );

  // baseUrl 已经带 /v1，最终 URL 应该是 /v1/chat/completions
  assert.equal(requestUrl, "https://gateway.example.test/v1/chat/completions");
  // OpenAI 用 Bearer token 认证
  assert.equal(requestHeaders?.get("authorization"), "Bearer test-key");
  // 请求 body 的 tools 数组是 OpenAI 的 { type: "function", function: {...} } 形状
  assert.deepEqual(requestBody, {
    model: "test-model",
    max_tokens: 123,
    messages: [{ role: "user", content: "where am I?" }],
    tools: [
      {
        type: "function",
        function: {
          name: "bash",
          description: "Run a shell command.",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      },
    ],
  });
  // 响应被翻译成内部形状：arguments JSON 字符串被解析回 input 对象
  assert.equal(response.stopReason, "tool_use");
  assert.deepEqual(response.content, [
    {
      type: "tool_use",
      id: "call_1",
      name: "bash",
      input: { command: "pwd" },
    },
  ]);
});

/**
 * 验证：内部"一条消息里既有 tool_use 又有 tool_result"的形状，
 * 会被拆成 OpenAI 期望的多条消息：
 *   - assistant 消息（带 tool_calls 字段）
 *   - 独立的 role: "tool" 消息（用 tool_call_id 对应回去）
 */
test("OpenAIChatCompletionsModel serializes internal tool results as tool messages", async () => {
  let requestBody: { messages?: Message[] } | undefined;

  const model = new OpenAIChatCompletionsModel({
    apiKey: "test-key",
    baseUrl: "https://gateway.example.test",
    model: "test-model",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as { messages?: Message[] };

      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "done",
              },
            },
          ],
        }),
      );
    },
  });

  // 内部对话历史：一条 assistant 消息（含 tool_use）+ 一条 user 消息（含 tool_result）
  await model.create(
    [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "bash",
            input: { command: "pwd" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolUseId: "call_1",
            content: "C:/AI/spiral-mind",
          },
        ],
      },
    ],
    [],
  );

  // 期望被翻译成 OpenAI 形状：
  //   第 1 条：assistant 消息，content 为 null，tool_calls 数组装工具调用
  //   第 2 条：role: "tool" 消息，tool_call_id 对应上面的 id
  assert.deepEqual(requestBody?.messages, [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "bash",
            arguments: "{\"command\":\"pwd\"}",
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: "C:/AI/spiral-mind",
    },
  ]);
});

/**
 * 单元测试 resolveOpenAIChatCompletionsUrl 的三种 baseUrl 形态。
 * 和 Anthropic 版本同理，只是端点是 /v1/chat/completions。
 */
test("resolveOpenAIChatCompletionsUrl supports common base URL forms", () => {
  assert.equal(
    resolveOpenAIChatCompletionsUrl("https://gateway.example.test"),
    "https://gateway.example.test/v1/chat/completions",
  );
  assert.equal(
    resolveOpenAIChatCompletionsUrl("https://gateway.example.test/v1"),
    "https://gateway.example.test/v1/chat/completions",
  );
  assert.equal(
    resolveOpenAIChatCompletionsUrl("https://gateway.example.test/v1/chat/completions"),
    "https://gateway.example.test/v1/chat/completions",
  );
});

/**
 * 验证：后端返回非 JSON 响应（比如 502 网关在维护时返回 HTML/纯文本）时，
 * 适配器抛出清晰的错误消息，包含状态码、content-type 和响应体前几百字符。
 *
 * 第二个参数是正则：错误消息必须匹配 /non-JSON.*502.*text\/plain.*service unavailable/。
 * .* 表示任意字符任意次数，所以这个正则的意思是"依次包含这几个关键词"。
 */
test("OpenAIChatCompletionsModel reports non-JSON responses clearly", async () => {
  const model = new OpenAIChatCompletionsModel({
    apiKey: "test-key",
    baseUrl: "https://gateway.example.test",
    model: "test-model",
    fetch: async () =>
      // 模拟一个 502 错误，content-type 是 text/plain（不是 JSON）
      new Response("service unavailable", {
        status: 502,
        headers: {
          "content-type": "text/plain",
        },
      }),
  });

  await assert.rejects(
    () => model.create([{ role: "user", content: "hello" }], []),
    /non-JSON.*502.*text\/plain.*service unavailable/,
  );
});
