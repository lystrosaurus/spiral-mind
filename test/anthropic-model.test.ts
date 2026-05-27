import test from "node:test";
import assert from "node:assert/strict";

import {
  AnthropicMessagesModel,
  defineTool,
  resolveAnthropicMessagesUrl,
  type Message,
} from "../src/index.js";

test("AnthropicMessagesModel sends messages and tool schemas to the Messages API", async () => {
  let requestBody: unknown;
  let requestHeaders: Headers | undefined;

  const model = new AnthropicMessagesModel({
    apiKey: "test-key",
    baseUrl: "https://api.test",
    model: "claude-test",
    system: "Use tools when useful.",
    maxTokens: 123,
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      requestHeaders = new Headers(init?.headers);

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

  assert.equal(response.stopReason, "tool_use");
  assert.deepEqual(response.content, [
    {
      type: "tool_use",
      id: "toolu_1",
      name: "bash",
      input: { command: "pwd" },
    },
  ]);
  assert.equal(requestHeaders?.get("x-api-key"), "test-key");
  assert.equal(requestHeaders?.get("anthropic-version"), "2023-06-01");
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

test("AnthropicMessagesModel serializes internal tool results as tool_result blocks", async () => {
  let requestBody: { messages?: Message[] } | undefined;

  const model = new AnthropicMessagesModel({
    apiKey: "test-key",
    baseUrl: "https://api.test",
    model: "claude-test",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as { messages?: Message[] };

      return new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
        }),
      );
    },
  });

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

test("AnthropicMessagesModel accepts a base URL that already ends with /v1", async () => {
  let requestUrl = "";
  const model = new AnthropicMessagesModel({
    apiKey: "test-key",
    baseUrl: "https://gateway.example.test/v1",
    model: "claude-test",
    fetch: async (url) => {
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
