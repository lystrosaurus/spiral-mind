import test from "node:test";
import assert from "node:assert/strict";

import {
  AgentLoop,
  MemoryModel,
  PermissionDeniedError,
  defineTool,
} from "../src/index.js";

// s01 + s02：模型先请求 echo 工具，harness 执行后把 tool_result 回填给模型。
test("runs tool_use requests through the dispatch map until the model stops", async () => {
  const model = new MemoryModel([
    {
      stopReason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "echo",
          input: { text: "hello" },
        },
      ],
    },
    {
      stopReason: "end_turn",
      content: [{ type: "text", text: "done" }],
    },
  ]);

  const loop = new AgentLoop({
    model,
    tools: [
      defineTool({
        name: "echo",
        description: "Return the provided text.",
        handler: async ({ text }) => String(text),
      }),
    ],
  });

  const result = await loop.run([{ role: "user", content: "say hello" }]);

  assert.equal(result.stopReason, "end_turn");
  // 倒数第二条消息是工具结果；最后一条消息是模型看到结果后的 done 响应。
  assert.deepEqual(result.messages.at(-2), {
    role: "user",
    content: [
      {
        type: "tool_result",
        toolUseId: "tool-1",
        content: "hello",
      },
    ],
  });
});

// s03：权限策略拒绝后，handler 不应该被调用，避免危险工具产生副作用。
test("checks permissions before executing a tool handler", async () => {
  let executed = false;
  const loop = new AgentLoop({
    model: new MemoryModel([
      {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "dangerous",
            input: {},
          },
        ],
      },
    ]),
    tools: [
      defineTool({
        name: "dangerous",
        description: "Should not run when denied.",
        handler: async () => {
          executed = true;
          return "ran";
        },
      }),
    ],
    permission: {
      canUseTool: () => ({
        allowed: false,
        reason: "blocked by test policy",
      }),
    },
  });

  await assert.rejects(
    () => loop.run([{ role: "user", content: "run it" }]),
    PermissionDeniedError,
  );
  assert.equal(executed, false);
});

// s04：hook 挂在工具执行前后，适合做审计日志、指标采集或调试输出。
test("fires pre and post tool hooks without changing the core loop", async () => {
  const events: string[] = [];
  const loop = new AgentLoop({
    model: new MemoryModel([
      {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "echo",
            input: { text: "hooked" },
          },
        ],
      },
      {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
      },
    ]),
    tools: [
      defineTool({
        name: "echo",
        description: "Return the provided text.",
        handler: async ({ text }) => String(text),
      }),
    ],
    hooks: {
      beforeToolUse: async ({ toolUse }) => {
        events.push(`before:${toolUse.name}`);
      },
      afterToolUse: async ({ toolUse, result }) => {
        events.push(`after:${toolUse.name}:${result.content}`);
      },
    },
  });

  await loop.run([{ role: "user", content: "say hooked" }]);

  assert.deepEqual(events, ["before:echo", "after:echo:hooked"]);
});
