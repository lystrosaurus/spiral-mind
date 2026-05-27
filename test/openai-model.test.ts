import test from "node:test";
import assert from "node:assert/strict";

import {
  OpenAIChatCompletionsModel,
  defineTool,
  resolveOpenAIChatCompletionsUrl,
  type Message,
} from "../src/index.js";

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

  assert.equal(requestUrl, "https://gateway.example.test/v1/chat/completions");
  assert.equal(requestHeaders?.get("authorization"), "Bearer test-key");
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

test("OpenAIChatCompletionsModel reports non-JSON responses clearly", async () => {
  const model = new OpenAIChatCompletionsModel({
    apiKey: "test-key",
    baseUrl: "https://gateway.example.test",
    model: "test-model",
    fetch: async () =>
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
