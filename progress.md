# 学习进度

状态取值：`not_started`、`reading`、`implemented`、`reviewed`。

> 2026-10-28 更新：上游 canonical track 已从 20 课收敛为 17 课。
> 本仓库已实现的 s01–s04 在新旧主线中完全一致，可直接沿用。
> 详细合并去向见 [docs/sources.md](./docs/sources.md)。

## Current 17 课主线

| 章节 | 主题 | 状态 | 本地产物 |
|---|---|---:|---|
| s01 | Agent Loop | implemented | `src/index.ts`, `test/agent-loop.test.ts` |
| s02 | Tool Use | implemented | `defineTool`、`TOOL_HANDLERS` map |
| s03 | Permission System | implemented | `PermissionPolicy`、`PermissionDeniedError` |
| s04 | Hook System | implemented | `beforeToolUse`、`afterToolUse`、`afterModelResponse` |
| s05 | TodoWrite | not_started | |
| s06 | Subagent | not_started | |
| s07 | Skill Loading | not_started | |
| s08 | Context Compact | not_started | |
| s09 | Memory System | not_started | |
| s10 | Task System | not_started | |
| s11 | Background Tasks | not_started | |
| s12 | Cron Scheduler | not_started | |
| s13 | Agent Teams | not_started | |
| s14 | MCP Plugin | not_started | |
| s15 | Integrated Harness | not_started | |
| s16 | Workflow Runtime | not_started | |
| s17 | Goal Loop | not_started | |

## 已消失的章节（20 → 17 合并去向）

原 progress.md 里的 20 课有 6 课被合并吸收：

| 原编号 | 原主题 | 去向 |
|---|---|---|
| s10 | 系统提示词 | 合并进 s15（runtime context） |
| s11 | 错误恢复 | 分散进 s08（compaction）、s11（后台清理）、s15（集成） |
| s16 | 团队协议 | 合并进 s13 Agent Teams（typed protocols） |
| s17 | 自主 Agent | 合并进 s13 Agent Teams（atomic task claims） |
| s18 | Worktree 隔离 | 合并进 s13 Agent Teams（task-bound worktrees） |
| s20 | 综合 Agent | 重命名为 s15 Integrated Harness |

## 新增章节（17 课比 20 课多出来的）

| 新编号 | 新主题 | 说明 |
|---|---|---|
| s16 | Workflow Runtime | 固定编排脚本化 / 生命周期事件 / journal 恢复 |
| s17 | Goal Loop | goal gate / 对话评估 / 自动续跑 |

## 复盘检查点

- 完成 s04 后：你能解释核心循环、dispatch map、权限边界和 hook 扩展点。✅ 已通过
- 完成 s08 后：你能用计划、subagent、skill 加载和上下文压缩来维持复杂任务的推进。
- 完成 s12 后：你能持久化任务、从错误中恢复、在后台运行慢任务，并调度定时工作。
- 完成 s15 后：你能把 tools / runtime / tasks / teams / MCP 组装进同一个循环。
- 完成 s17 后：你能说明所有机制如何挂载到同一个循环周围，以及如何用 goal gate 控制停止条件。
