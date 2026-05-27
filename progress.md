# 学习进度

状态取值：`not_started`、`reading`、`implemented`、`reviewed`。

| 章节 | 主题 | 状态 | 本地产物 |
|---|---|---:|---|
| s01 | Agent 循环 | implemented | `src/index.ts`, `test/agent-loop.test.ts` |
| s02 | 工具调用 | implemented | `defineTool`、`TOOL_HANDLERS` map |
| s03 | 权限系统 | implemented | `PermissionPolicy`、`PermissionDeniedError` |
| s04 | Hook 系统 | implemented | `beforeToolUse`、`afterToolUse` |
| s05 | TodoWrite | not_started | |
| s06 | Subagent | not_started | |
| s07 | Skill 加载 | not_started | |
| s08 | 上下文压缩 | not_started | |
| s09 | 记忆系统 | not_started | |
| s10 | 系统提示词 | not_started | |
| s11 | 错误恢复 | not_started | |
| s12 | 任务系统 | not_started | |
| s13 | 后台任务 | not_started | |
| s14 | Cron 调度器 | not_started | |
| s15 | Agent 团队 | not_started | |
| s16 | 团队协议 | not_started | |
| s17 | 自主 Agent | not_started | |
| s18 | Worktree 隔离 | not_started | |
| s19 | MCP 插件 | not_started | |
| s20 | 综合 Agent | not_started | |

## 复盘检查点

- 完成 s04 后：你能解释核心循环、dispatch map、权限边界和 hook 扩展点。
- 完成 s08 后：你能用计划、subagent、skill 加载和上下文压缩来维持复杂任务的推进。
- 完成 s14 后：你能持久化任务、从错误中恢复、在后台运行慢任务，并调度定时工作。
- 完成 s18 后：你能协调多个 agent，并避免共享上下文冲突。
- 完成 s20 后：你能说明所有机制如何挂载到同一个循环周围。
