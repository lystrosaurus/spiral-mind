# TypeScript 实现说明

本仓库用现代 TypeScript 实现 `learn-claude-code` 的 harness 思路，而不是使用
Python。

## 版本

2026-05-26，npm registry 报告 `typescript@6.0.3` 是 `latest` 包版本。本项目在
`package.json` 中固定这个版本，以便在使用当前 release line 的同时保持构建可复现。

## 设计方向

实现应尽量贴近上游教学模型：

- 保持一个稳定循环；
- 通过 dispatch map 添加工具；
- 通过 policy、hook、manager 和 persistence layer 在循环周围添加机制；
- 避免把模型判断力塞进硬编码 workflow tool。

## 当前模块

- `AgentLoop`：把 messages 发送给模型，执行工具调用，追加 `tool_result` blocks，
  并重复直到模型停止。
- `AnthropicMessagesModel`：把本仓库内部的 `Message`、`ToolDefinition` 和
  `ToolResultBlock` 转成 Anthropic Messages API 的请求格式。
- `defineTool`：注册一个带名称和描述的原子工具 handler。
- `PermissionPolicy`：在 handler 运行前检查请求的工具调用。
- `Hooks`：暴露 `beforeToolUse` 和 `afterToolUse` 扩展点。
- `MemoryModel`：用于测试和示例的确定性脚本模型。

## 调试真实模型

```powershell
npm run debug:model -- "Use the bash tool to run pwd."
```

调试入口会读取项目根目录的本地 `.env`，支持：

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MAX_TOKENS`

`src/debug-model.ts` 故意只注册一个安全版 `bash` 工具，并通过权限策略限制命令范围。
它的目标是观察模型调用、工具请求、工具结果回填和下一轮模型调用，而不是提供完整
shell 能力。

## 下一步里程碑

1. s05 `TodoManager`：带状态的内存计划跟踪。
2. s06 subagents：使用全新 `messages[]` 的子循环。
3. s07 skill loading：按需加载 Markdown 知识。
4. s08 context compaction：transcript 预算和摘要插入。

每个里程碑都应该从一个失败的行为测试开始。
