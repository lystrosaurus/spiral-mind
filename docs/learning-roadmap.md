# 学习路线图

这份路线图跟随 `shareAI-lab/learn-claude-code` 当前的 20 课主线。检查日期为
2026-05-26，检查来源是当前工作区环境。

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

## 章节地图

| 章节 | 机制 | 需要理解什么 | 建议本地练习 |
|---|---|---|---|
| s01 | Agent 循环 | `messages[]`、`while True`、`stop_reason` | 写一个 fake model 循环，调用一个命令 handler。 |
| s02 | 工具调用 | tool schemas、`TOOL_HANDLERS`、dispatch maps | 添加 `read_file`、`write_file`、`edit_file` handler。 |
| s03 | 权限系统 | 允许、拒绝、需要审批的动作 | dispatch 前增加路径和命令检查。 |
| s04 | Hook 系统 | 工具调用前后的扩展点 | 不改核心循环，通过 hook 记录每次工具调用。 |
| s05 | TodoWrite | 先计划再执行，以及进度跟踪 | 构建一个带状态的内存 todo list。 |
| s06 | Subagent | 用新的 `messages[]` 隔离旁路工作 | 运行一个只返回摘要的子循环。 |
| s07 | Skill 加载 | 先列出知识，再按需展开 | 只在选中时加载本地 Markdown skill。 |
| s08 | 上下文压缩 | snipping、micro compaction、auto compaction | token 预算超限时总结旧消息。 |
| s09 | 记忆系统 | 选择、提取、合并 | 将稳定事实与原始 transcript 分开持久化。 |
| s10 | 系统提示词 | 运行时组装 prompt | 从命名 section 组合 system prompt。 |
| s11 | 错误恢复 | retry、fallback、token escalation | 给错误分类，并选择重试路径。 |
| s12 | 任务系统 | 持久任务和依赖关系 | 将任务以 JSON 存储，并支持 `blockedBy` 依赖。 |
| s13 | 后台任务 | 在线程中运行慢任务 | 启动命令，并在之后轮询通知。 |
| s14 | Cron 调度器 | 按时间触发工作 | 持久化计划任务，并在到期时触发。 |
| s15 | Agent 团队 | 队友和异步 mailbox | 通过 JSONL inbox 发送 request/reply 消息。 |
| s16 | 团队协议 | 固定协作模式 | 实现计划评审和关闭握手协议。 |
| s17 | 自主 Agent | 空闲扫描和自我认领任务 | 让 agent 用锁认领未分配任务。 |
| s18 | Worktree 隔离 | 一个任务，一个目录 | 将 task ID 绑定到隔离工作目录。 |
| s19 | MCP 插件 | 外部能力路由 | 将外部工具规范化进同一个工具池。 |
| s20 | 综合 Agent | 所有机制，一个循环 | 解释每个 manager 如何挂到循环周围。 |

## 四周学习计划

### 第 1 周：核心循环和边界

阅读 s01-s04，在本地构建最小 harness。

你应该能回答：

- `stop_reason == "tool_use"` 表示什么？
- 为什么 dispatch map 比硬编码分支更好？
- 哪些动作应该允许、拒绝或要求审批？
- hook 可以挂在哪里，而不需要重写核心循环？

### 第 2 周：复杂工作和上下文

阅读 s05-s08，加入计划、subagent、skill 和压缩机制。

你应该能回答：

- 为什么 todo list 能提高任务完成率？
- 新的子 `messages[]` 解决了什么问题？
- 为什么知识应该通过 tool result 加载，而不是塞进 system prompt？
- 压缩之后哪些信息必须保留下来？

### 第 3 周：记忆、恢复和长任务

阅读 s09-s14，加入持久化和长时间运行能力。

你应该能回答：

- 什么应该变成 memory，什么应该留在 transcript history 中？
- system prompt 如何在运行时组装？
- 哪些错误应该重试、升级或放弃？
- 持久任务和内存 todo 有什么不同？
- 后台执行如何通知主循环？

### 第 4 周：多 Agent 协作和扩展

阅读 s15-s20，重点理解协调、隔离和能力扩展。

你应该能回答：

- mailbox message 中应该包含什么？
- 为什么团队需要明确协议？
- 自主 agent 如何避免认领同一个任务？
- 为什么 worktree 对并行 coding agent 很重要？
- MCP 如何成为另一种工具来源，而不是一套独立控制流？

## 学习规则

每一章都按这个节奏来：

1. 先读 README，建立心智模型。
2. 再读 `code.py`，看结构，不抠细节。
3. 自己重建一个极小版本。
4. 故意把它弄坏一次。
5. 把故障模式写进笔记。

如果你只运行上游代码，你会“认识”这个机制。只有自己重建一遍，你才会真正理解它。
