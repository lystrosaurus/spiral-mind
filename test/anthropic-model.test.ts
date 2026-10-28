/**
 * ============================================================================
 * test/anthropic-model.test.ts —— Anthropic 模型适配器的行为测试
 * ============================================================================
 *
 * 关键技巧：通过构造函数的 fetch 参数注入"假 fetch"。
 * 这样我们不需要真的发网络请求，就能验证：
 *   - 请求 URL 拼得对不对
 *   - 请求 header 带没带 x-api-key / anthropic-version
 *   - 请求 body 的字段名、结构是不是符合 Anthropic 协议
 *   - 内部 Message 格式 → Anthropic 格式的翻译是否正确
 *   - Anthropic 响应 → 内部 ModelResponse 的翻译是否正确
 *
 * 这是"依赖注入"思想在测试里的典型应用：
// 把"发请求"这个副作用抽成参数，测试时换成无副作用的假货。
 * ============================================================================
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  AnthropicMessagesModel,
  defineTool,
  resolveAnthropicMessagesUrl,
  type Message,
} from "../src/index.js";

/**
 * 验证：模型调用时把消息和工具按 Anthropic 协议序列化后 POST 出去，
 * 并把 Anthropic 的响应正确翻译回内部 ModelResponse。
 *
 * 假 fetch 做的事：
 *   1. 捕获请求 body 和 header 到外部变量（供断言）
 *   2. 返回一个固定剧本："stop_reason=tool_use + 一个 bash 工具调用"
 */
test("AnthropicMessagesModel sends messages and tool schemas to the Messages API", async () => {
  let requestBody: unknown;
  let requestHeaders: Headers | undefined;

  const model = new AnthropicMessagesModel({
    apiKey: "test-key",
    baseUrl: "https://api.test",
    model: "claude-test",
    system: "Use tools when useful.",
    maxTokens: 123,
    // 注入的假 fetch：签名和真 fetch 一致，但只记录请求 + 返回固定响应
    fetch: async (_url, init) => {
      // init?.body 是 fetch 的 body 字段；?. 防止 init 是 undefined
      // String(...) 把 BodyInit 类型转成字符串再 JSON.parse
      requestBody = JSON.parse(String(init?.body));
      // Headers 是浏览器/Node 18+ 的内建类，方便用 .get() 查 header
      requestHeaders = new Headers(init?.headers);

      // Response 也是内建类，构造一个假的 HTTP 响应
      return new Response(
        JSON.stringify({
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "bash",
              input: { command: "pwd" },
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

  // 验证返回值：stop_reason 和 tool_use block 都被正确翻译回内部形状
  assert.equal(response.stopReason, "tool_use");
  assert.deepEqual(response.content, [
    {
      type: "tool_use",
      id: "toolu_1",
      name: "bash",
      input: { command: "pwd" },
    },
  ]);
  // 验证请求 header：x-api-key 是 Anthropic 的认证方式
  assert.equal(requestHeaders?.get("x-api-key"), "test-key");
  // anthropic-version 默认值是 2023-06-01
  assert.equal(requestHeaders?.get("anthropic-version"), "2023-06-01");
  // 验证请求 body：字段名是 snake_case（max_tokens、input_schema）
  assert.deepEqual(requestBody, {
    model: "claude-test",
    system: "Use tools when useful.",
    max_tokens: 123,
    messages: [{ role: "user", content: "where am I?" }],
    tools: [
      {
        name: "bash",
        description: "Run a shell command.",
        input_schema: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
        },
      },
    ],
  });
});

/**
 * 验证：内部 tool_result block 序列化成 Anthropic 格式时，
 * 字段名 toolUseId 会被翻译成 tool_use_id（camelCase → snake_case）。
 *
 * 这是 Anthropic 协议的字段命名约定。
 */
test("AnthropicMessagesModel serializes internal tool results as tool_result blocks", async () => {
  let requestBody: { messages?: Message[] } | undefined;

  const model = new AnthropicMessagesModel({
    apiKey: "test-key",
    baseUrl: "https://api.test",
    model: "claude-test",
    fetch: async (_url, init) => {
      // as { messages?: Message[] } 是类型断言：告诉编译器解析结果的形状
      requestBody = JSON.parse(String(init?.body)) as { messages?: Message[] };

      return new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
        }),
      );
    },
  });

  // 构造一段"模型刚用完工具，harness 把结果回填进去"的对话历史
  await model.create(
    [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
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
            toolUseId: "toolu_1",
            content: "C:/AI/spiral-mind",
          },
        ],
      },
    ],
    [],
  );

  // messages.at(1) 取第 2 条（harness 回填的那条 user 消息）
  // 期望：toolUseId 被翻译成 Anthropic 的 tool_use_id
  assert.deepEqual(requestBody?.messages?.at(1), {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: "C:/AI/spiral-mind",
      },
    ],
  });
});

/**
 * 验证：baseUrl 已经以 /v1 结尾时，最终 URL 会被拼成 /v1/messages 而不是 /v1/v1/messages。
 * 这是用户配置 .env 时最常踩的坑。
 */
test("AnthropicMessagesModel accepts a base URL that already ends with /v1", async () => {
  let requestUrl = "";
  const model = new AnthropicMessagesModel({
    apiKey: "test-key",
    baseUrl: "https://gateway.example.test/v1",
    model: "claude-test",
    fetch: async (url) => {
      // url 参数类型是 string | URL | Request，统一 String(...) 一下
      requestUrl = String(url);

      return new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
        }),
      );
    },
  });

  await model.create([{ role: "user", content: "hello" }], []);

  assert.equal(requestUrl, "https://gateway.example.test/v1/messages");
});

/**
 * 单元测试 resolveAnthropicMessagesUrl 的三种 baseUrl 形态：
 *   - 只有域名
 *   - 域名 + /v1
 *   - 已经包含 /v1/messages
 * 三种都要拼成正确的端点。
 */
test("resolveAnthropicMessagesUrl supports common base URL forms", () => {
  assert.equal(
    resolveAnthropicMessagesUrl("https://gateway.example.test"),
    "https://gateway.example.test/v1/messages",
  );
  assert.equal(
    resolveAnthropicMessagesUrl("https://gateway.example.test/v1"),
    "https://gateway.example.test/v1/messages",
  );
  assert.equal(
    resolveAnthropicMessagesUrl("https://gateway.example.test/v1/messages"),
    "https://gateway.example.test/v1/messages",
  );
});
