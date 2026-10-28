# 来源

来源检查日期：2026-10-28，通过 `git fetch upstream` 本地比对。

## 主要来源

- 上游仓库：
  <https://github.com/shareAI-lab/learn-claude-code>
- 上游 README（英文，默认）：
  <https://raw.githubusercontent.com/shareAI-lab/learn-claude-code/main/README.md>
- 上游 README（中文）：
  <https://raw.githubusercontent.com/shareAI-lab/learn-claude-code/main/README-zh.md>
- 公开学习站点：
  <https://learn.shareai.run/en/s01/>

## 当前主线

**上游已将 canonical track 从 20 课收敛为 17 课（2026-07 左右）。**

根目录下的 `s01_agent_loop/` 到 `s17_goal_loop/` 是当前 canonical 版本。
每章目录里都有英/中/日三语 README 和可运行的 `code.py`。

### Legacy 与 Current 的关系

| 版本 | 位置 | 说明 |
|---|---|---|
| **Current 17 课主线** | 根目录 `s01_agent_loop/` … `s17_goal_loop/` | canonical，推荐所有新读者走这条 |
| **Legacy 12 课路线** | `docs/`、`agents/` | 仅保留旧 12 课版本，用于现有读者和旧链接迁移 |
| 原 20 课路线 | 不存在了 | 已被 17 课主线吸收合并 |

### Legacy 12 课 → Current 17 课 映射（上游 README 提供）

| Legacy 12 课 | Current 17 课 | 主题 |
|---|---|---|
| old s01 | new s01 | Agent Loop |
| old s02 | new s02 | Tool Use |
| old s03 | new s05 | TodoWrite |
| old s04 | new s06 | Subagent |
| old s05 | new s07 | Skill Loading |
| old s06 | new s08 | Context Compact |
| old s07 | new s10 | Task System |
| old s08 | new s11 | Background Tasks |
| old s09 | new s13 | Agent Teams |
| old s10 | new s13 | Team Protocols（合并进 s13） |
| old s11 | new s13 | Autonomous task claiming（合并进 s13） |
| old s12 | new s13 | Task-bound worktrees（合并进 s13） |
| —（Current 独有） | s03, s04, s09, s12, s14, s15, s16, s17 | Permission、Hooks、Memory、Cron、MCP、Integrated Harness、Workflow Runtime、Goal Loop |

## Legacy 20 课 → Current 17 课 合并去向（本仓库推断）

我们之前仓库里的 progress.md 用的是 s01–s20 20 课编号。上游做了大合并：

| 旧编号 | 旧主题 | 新编号 | 新主题 | 说明 |
|---|---|---|---|---|
| s01 Agent 循环 | s01 Agent Loop | — | 没变 | |
| s02 工具调用 | s02 Tool Use | — | 没变 | |
| s03 权限系统 | s03 Permission System | — | 没变 | |
| s04 Hook 系统 | s04 Hook System | — | 没变 | |
| s05 TodoWrite | s05 TodoWrite | — | 没变 | |
| s06 Subagent | s06 Subagent | — | 没变 | |
| s07 Skill 加载 | s07 Skill Loading | — | 没变 | |
| s08 上下文压缩 | s08 Context Compact | — | 目录名从 context_compression 改成 context_compact |
| s09 记忆系统 | s09 Memory System | — | 没变 |
| **s10 系统提示词** | — | 消失 | 可能吸收进 s10 Task System 或 s15 Integrated Harness 的 runtime context |
| **s11 错误恢复** | — | 消失 | 可能吸收进 s08（compaction 错误）或 s11（后台任务错误处理） |
| s12 任务系统 | s10 Task System | **编号前移** | 磁盘持久化 + blockedBy 依赖图 |
| s13 后台任务 | s11 Background Tasks | 编号前移 | 线程执行 + 通知队列 |
| s14 Cron 调度器 | s12 Cron Scheduler | 编号前移 | |
| s15 Agent 团队 | s13 Agent Teams | 合并 | |
| **s16 团队协议** | s13 Agent Teams | 合并 | typed protocols 并入 s13 |
| **s17 自主 Agent** | s13 Agent Teams | 合并 | task-bound worktrees 并入 s13 |
| **s18 Worktree 隔离** | s13 Agent Teams | 合并 | 作为 s13 的 worktree 子机制 |
| s19 MCP 插件 | s14 MCP Plugin | 编号前移 | |
| s20 综合 Agent | s15 Integrated Harness | 改名 | 仍是"所有机制一个循环"的总览 |
| —（新增） | **s16 Workflow Runtime** | — | 脚本编排 / 生命周期事件 / journal 恢复 |
| —（新增） | **s17 Goal Loop** | — | goal gate / 对话评估 / 自动续跑 |

**结论：** 我们当前实现的 s01–s04 在新旧主线里**完全一致**，可以直接沿用。s05 以后的章节编号要对齐 17 课主线。

## 二级索引

- DeepWiki 总览：
  <https://deepwiki.com/shareAI-lab/learn-claude-code>

## 上游近期重要改动（2026-05-26 → 2026-10-28）

| 日期 | Commit | 内容 |
|---|---|---|
| 2026-10-27 | 7226f55 | fix(s08): preserve complete active request after compaction (#603) |
| 2026-10-27 | 2dde971 | fix: replace retired Sonnet 4 default (#602) |
| 2026-10-22 | aa7ee16 | Clarify s03 permission prompt (#593) |
| 2026-10-21 | a2f8162 | docs: translate code comments in Chinese READMEs (s04-s06) (#590) |
| 2026-10-15 | 8491527 | fix(s11): document unreachable else branch in inject_background_results (#584) |
| 2026-10-14 | b057622 | fix: add hysteresis to message-count compaction (#582) |
| 2026-09-30 | e1a35ba | fix(web): replace fs.cpSync to avoid Windows crash in extract step (#574) |
| 2026-09-24 | 45a0f35 | fix(s16): wait for parallel agents before closing journal (#571) |
| 2026-09-22 | 2f8cfb0 | fix: empty REPL line no longer quits chapter silently (#569) |
| 2026-09-18 | 4e3f727 | docs(s02): explain why specialized tools matter (#562) |
| 2026-09-17 | d5cba86 | fix(s08): recognize Anthropic prompt overflow errors (#561) |
| 2026-09-16 | 85ee4f1 | fix: CVE-2026-67213 security vulnerability (#552) |
| 2026-09-10 | ce8f9f1 | fix: keep s11 and s15 process cleanup working on Windows (#586) |
| 2026-09-10 | 94ca468 | Add OS-aware shell context to current course prompts (#587) |
| 2026-09-05 | 08263f4 | refactor: simplify destructive command matching（s03 del 命令 / Windows 兼容） |

## 备注

- 上游 README 现已采用**英/中/日三语**（English / 中文 / 日本語）。
- 上游 README 顶部增加了很长的 "Agency 来自模型" 世界观阐述（DQN / OpenAI Five / AlphaStar / 腾讯绝悟四大历史里程碑）。
- 上游仓库还在根目录保留了 `web/` 应用（README "Web Platform" 章节提到）。
- upstream 远程已添加到本仓库（`git remote add upstream https://github.com/shareAI-lab/learn-claude-code.git`）。
