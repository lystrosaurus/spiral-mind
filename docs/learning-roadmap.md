# 学习路线图

这份路线图跟随 `shareAI-lab/learn-claude-code` 当前的 **17 课主线**
（`s01_agent_loop` 到 `s17_goal_loop`）。检查日期 2026-10-28。

> 上一次检查（2026-05-26）时上游还是 20 课。这次发现上游已将 20 课收敛为 17 课，
> 详细合并去向见 [sources.md](./sources.md) 的 "Legacy 20 课 → Current 17 课 合并去向"。

## 你在学习什么

你学习的是 harness engineering。

- agent 是经过训练的模型。
- harness 是围绕模型构建的运行环境。
- harness 为模型提供工具、知识、观察结果、动作接口和权限。
- 好的 harness 让模型保持主导，同时让动作安全、可观察、可恢复、可组合。

## 唯一核心循环

所有章节都围绕同一个循环展开：

```text
1. 把 messages、system prompt 和 tool schemas 发送给模型。
2. 将模型响应追加到 messages[]。
3. 如果 stop_reason 不是 tool_use，返回响应。
4. 对每个 tool_use block，按名称 dispatch 到 TOOL_HANDLERS。
5. 将 tool_result block 追加回 messages[]。
6. 重复。
```

不要丢掉这条主线。后续每一种机制都是挂载在这个循环周围的附加层，而不是替代这个
循环。

## 章节地图（Current 17 课主线）

| 章节 | 机制 | 需要理解什么 | 建议本地练习 | 核心口号 |
|---|---|---|---|---|
| s01 | Agent Loop | `messages[]`、`while True`、`stop_reason` | 写一个 fake model 循环，调用一个命令 handler。 | One loop & Bash is all you need |
| s02 | Tool Use | tool schemas、`TOOL_HANDLERS`、dispatch map | 添加 `read_file`、`write_file`、`edit_file` handler。 | Adding a tool means adding one handler |
| s03 | Permission System | 允许、拒绝、需要审批的动作 | dispatch 前增加路径和命令检查。 | Set boundaries first, then grant freedom |
| s04 | Hook System | 工具调用前后的扩展点 | 不改核心循环，通过 hook 记录每次工具调用。 | Hook around the loop, never rewrite the loop |
| s05 | TodoWrite | 先计划再执行，以及进度跟踪 | 构建一个带状态的内存 todo list。 | An agent without a plan drifts |
| s06 | Subagent | 用新的 `messages[]` 隔离旁路工作 | 运行一个只返回摘要的子循环。 | 给子任务一份新的 messages[] |
| s07 | Skill Loading | 先列出知识，再按需展开 | 只在选中时加载本地 Markdown skill。 | Load knowledge on demand, not upfront |
| s08 | Context Compact | tool_result_budget / snip_compact / micro_compact / compact_history | token 预算超限时先丢 tool_result、再总结历史。 | Context always fills up — have a way to make room |
| s09 | Memory System | 选择、提取、合并 | 将稳定事实与原始 transcript 分开持久化。 | Remember what matters, forget what doesn't |
| s10 | Task System | 磁盘持久化、`blockedBy` 依赖图 | 将任务以 JSON 存储，并支持 `blockedBy` 依赖。 | Big goals break into small tasks, ordered, persisted to disk |
| s11 | Background Tasks | 线程执行 + 通知队列 | 启动命令，并在之后轮询通知。 | Slow ops go background, agent keeps thinking |
| s12 | Cron Scheduler | 持久化计划任务 + session 内触发器 | 按时间自动触发工作。 | Fire on schedule, no human kick needed |
| s13 | Agent Teams | 持久队友、原子任务认领、task-bound worktrees、typed protocols | 通过 JSONL inbox 发送 request/reply 消息。 | Too big for one agent — let teammates divide the work |
| s14 | MCP Plugin | 工具发现、命名空间、工具池组装 | 把外部 MCP 工具规范化进同一个工具池。 | Not enough capability? Plug in more via MCP |
| s15 | Integrated Harness | tools + runtime context + tasks + teams + scheduling + MCP 围绕一个循环 | 解释每个 manager 如何挂到循环周围。 | Many mechanisms, one loop |
| s16 | Workflow Runtime | 脚本编排、生命周期事件、journal 恢复 | 把固定编排写成脚本，出故障能从 journal 续跑。 | When the orchestration shape is fixed, put it in code |
| s17 | Goal Loop | goal gate、对话评估、自动续跑 | 让独立评估器决定 loop 是否真的可以 stop。 | A goal decides when the loop may stop |

### 章节分组

按依赖关系和复杂度分 5 个阶段：

```
阶段 1：核心循环（s01–s04）
  s01 Agent Loop → s02 Tool Use → s03 Permission → s04 Hooks

阶段 2：复杂工作管理（s05–s07）
  s05 TodoWrite → s06 Subagent → s07 Skill Loading

阶段 3：上下文与记忆（s08–s09）
  s08 Context Compact → s09 Memory System

阶段 4：持久化与长任务（s10–s12）
  s10 Task System → s11 Background Tasks → s12 Cron Scheduler

阶段 5：协作、扩展与收尾（s13–s17）
  s13 Agent Teams → s14 MCP → s15 Integrated → s16 Workflow → s17 Goal Loop
```

注意：s10 以前的"系统提示词"和"错误恢复"两章已被吸收。系统提示词现在属于
runtime context（s15）的一部分；错误恢复分散在 compaction（s08）、
后台任务清理（s11）等各处。

## 四周学习计划

### 第 1 周：核心循环和边界（s01–s04）

阅读 s01-s04，在本地构建最小 harness。（本仓库当前已实现这 4 章。）

你应该能回答：

- `stop_reason == "tool_use"` 表示什么？
- 为什么 dispatch map 比硬编码分支更好？
- 哪些动作应该允许、拒绝或要求审批？
- hook 可以挂在哪里，而不需要重写核心循环？

### 第 2 周：复杂工作和知识管理（s05–s09）

阅读 s05-s09，加入计划、subagent、skill、压缩和记忆机制。

你应该能回答：

- 为什么 todo list 能提高任务完成率？
- 新的子 `messages[]` 解决了什么问题？
- 为什么知识应该通过 tool result 加载，而不是塞进 system prompt？
- 压缩之后哪些信息必须保留下来？
- 记忆系统的选择/提取/合并三个子系统分别做什么？

### 第 3 周：持久化和长任务（s10–s12）

阅读 s10-s12，加入磁盘持久化、后台执行和定时调度。

你应该能回答：

- 持久任务和内存 todo 有什么不同？
- 后台执行如何通知主循环？
- Cron 任务如何在 session 结束后仍然存活？

### 第 4 周：协作、扩展和收尾（s13–s17）

阅读 s13-s17，重点理解协调、隔离、能力扩展、脚本编排和目标控制。

你应该能回答：

- mailbox message 中应该包含什么？
- 为什么团队需要明确协议？
- MCP 如何成为另一种工具来源，而不是一套独立控制流？
- Workflow Runtime 的 journal 恢复和普通 task 重试有什么不同？
- Goal Loop 的独立评估器解决了什么问题？

## 学习规则

每一章都按这个节奏来：

1. 先读 README，建立心智模型。
2. 再读 `code.py`，看结构，不抠细节。
3. 自己重建一个极小版本。
4. 故意把它弄坏一次。
5. 把故障模式写进笔记。

如果你只运行上游代码，你会"认识"这个机制。只有自己重建一遍，你才会真正理解它。
