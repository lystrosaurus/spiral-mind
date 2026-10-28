/**
 * ============================================================================
 * test/agent-loop.test.ts —— s01 到 s04 的行为测试
 * ============================================================================
 *
 * 用 Node 内建的 node:test 测试框架（不需要 jest/vitest）。
 *
 * 测试策略：用 MemoryModel（脚本模型）替代真实 LLM。
// 这样测试稳定、免费、快速，而且能精确控制"模型何时想调工具、调什么工具"。
 *
 * 四个测试分别对应：
 *   1. s01+s02  主循环 + dispatch map：模型调工具 → harness 执行 → 结果回填 → 模型继续
 *   2. s03      权限策略：被拒绝的工具绝不能执行 handler
 *   3. s04      hook 系统：beforeToolUse / afterToolUse 在正确时机被调用
 *   4. s04      afterModelResponse：每轮模型响应完都会触发，且能拿到轮次/消息数
 * ============================================================================
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  AgentLoop,
  MemoryModel,
  PermissionDeniedError,
  defineTool,
} from "../src/index.js";

/**
 * s01 + s02：模型先请求 echo 工具，harness 执行后把 tool_result 回填给模型。
 *
 * 剧本（MemoryModel 的两条响应）：
 *   第 1 轮：模型说"我要调用 echo(text='hello')"（stopReason=tool_use）
 *   第 2 轮：模型看到工具结果后说"done"（stopReason=end_turn）
 *
 * 期望：
 *   - 最终 stopReason 是 end_turn
 *   - 倒数第二条消息是 harness 回填的 tool_result
 *   - 最后一条是模型的"done"响应
 */
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
        // handler 接收 ToolInput，这里直接解构出 text 字段并转成字符串
        // ({ text }) 是参数解构：等价于 (input) => String(input.text)
        handler: async ({ text }) => String(text),
      }),
    ],
  });

  const result = await loop.run([{ role: "user", content: "say hello" }]);

  assert.equal(result.stopReason, "end_turn");
  // 倒数第二条消息是工具结果；最后一条消息是模型看到结果后的 done 响应。
  //
  // result.messages.at(-2)：负数索引从后往前数，-1 是最后一条，-2 是倒数第二条。
  // deepEqual 是深比较：递归对比对象每个字段，而不是只比引用。
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

/**
 * s03：权限策略拒绝后，handler 不应该被调用，避免危险工具产生副作用。
 *
 * 剧本：模型第 1 轮就要求调用 "dangerous" 工具。
 * 权限策略：一律拒绝。
 *
 * 期望：
 *   - loop.run() 抛出 PermissionDeniedError
 *   - handler 里的 executed 标记始终是 false（说明 handler 没被触发）
 */
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
          // 如果 handler 真的被调用了，这个标记会被翻成 true
          executed = true;
          return "ran";
        },
      }),
    ],
    permission: {
      // 一律拒绝的策略
      canUseTool: () => ({
        allowed: false,
        reason: "blocked by test policy",
      }),
    },
  });

  // assert.rejects 期待传入的 async 函数抛错；
  // 第二个参数指定错误类型，只有抛 PermissionDeniedError 才算通过
  await assert.rejects(
    () => loop.run([{ role: "user", content: "run it" }]),
    PermissionDeniedError,
  );
  assert.equal(executed, false);
});

/**
 * s04：hook 挂在工具执行前后，适合做审计日志、指标采集或调试输出。
 *
 * 剧本：模型第 1 轮调 echo("hooked")，第 2 轮 end_turn。
 *
 * 期望：事件数组按顺序是：
 *   ["before:echo", "after:echo:hooked"]
 * 说明两个 hook 都在正确时机被调用了。
 */
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

/**
 * s04 补充：每次模型响应后都会触发 afterModelResponse。
 *
 * 这个 hook 拿到的 iteration 从 1 开始；messagesBefore 是"调用模型前"的快照。
 *
 * 剧本：模型第 1 轮调工具（此时 messages 里只有最初的 1 条用户消息），
//        第 2 轮 end_turn（此时 messages 里已有 user + assistant + user(tool_result) 共 3 条）。
 *
 * 期望事件：
 *   ["turn:1:before:1:stop:tool_use", "turn:2:before:3:stop:end_turn"]
 */
test("fires a model response hook on each model turn", async () => {
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
      afterModelResponse: ({ iteration, response, messagesBefore }) => {
        events.push(
          `turn:${iteration}:before:${messagesBefore.length}:stop:${response.stopReason}`,
        );
      },
    },
  });

  await loop.run([{ role: "user", content: "say hooked" }]);

  assert.deepEqual(events, [
    "turn:1:before:1:stop:tool_use",
    "turn:2:before:3:stop:end_turn",
  ]);
});
