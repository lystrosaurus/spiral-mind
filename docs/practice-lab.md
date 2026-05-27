# 实践实验室

用这些练习把阅读变成可操作的知识。每个练习都要保持小。重点是一次只让一个
harness 机制变得可见。

## 实验 1：最小 Agent 循环

目标：在加入抽象之前，先理解循环。

构建：

- 一个由 dict 组成的 `messages[]`；
- 一个 fake model function，它有时返回 `tool_use` 请求；
- 一个工具 handler，例如 `run_shell_echo`；
- 对 request、response、tool call、tool result 的循环日志。

验收标准：

- 你能指出模型在哪里做决策。
- 你能指出 harness 在哪里执行动作。
- 之后替换 fake model 时，不需要修改 dispatch 代码。

## 实验 2：Dispatch Map 和安全工具

目标：理解为什么工具要注册到 map，而不是硬编码进循环。

构建：

- 作为 schema-like metadata 的 `TOOLS`；
- `TOOL_HANDLERS = {"read_file": ..., "write_file": ...}`；
- 一个路径安全检查，用来阻止访问项目根目录之外的内容；
- 把错误作为 tool output 返回，而不是让异常直接崩溃。

验收标准：

- 添加工具只需要增加一个 schema 和一个 handler。
- 主循环不会新增 `if tool_name == ...` 分支。
- 权限失败会作为 observation 暴露给模型。

## 实验 3：计划和 Subagent

目标：把“维持计划”和“执行旁路工作”分开。

构建：

- 一个带有 `pending`、`in_progress`、`completed` 状态的 `TodoManager`；
- 当工作继续推进但 todo 没更新时发出提醒；
- 一个使用全新 `messages[]` 的子循环；
- 子循环返回给父循环的结果摘要。

验收标准：

- 父 conversation 保持短小。
- 子循环可以探索嘈杂细节，而不污染父上下文。
- 父循环只接收有用结果。

## 实验 4：上下文和记忆

目标：判断什么留在上下文里，什么变成持久 memory。

构建：

- 一个 transcript 长度的 token 或字符预算；
- 对旧消息的压缩摘要；
- 一个持久 memory 文件，用于稳定偏好或事实；
- 一条规则：原始 tool output 进入长期存储前必须先摘要。

验收标准：

- 你能解释压缩过程中丢失了什么。
- 你能解释为什么某个事实被提升为 memory。
- 旧消息压缩后，循环仍然能工作。

## 实验 5：持久任务和后台工作

目标：让工作跨越一次 conversation turn 后仍然存在。

构建：

- `.tasks/*.json` 任务记录；
- `blockedBy` 之类的依赖字段；
- 用于慢命令的后台 worker thread；
- 在循环顶部消费的 notification queue。

验收标准：

- 重启进程不会丢失任务。
- 被阻塞的任务在依赖完成前不能运行。
- 慢任务不会冻结主循环。

## 实验 6：团队协调和隔离

目标：理解多个 agent 如何协作，同时避免共享一个混乱上下文。

构建：

- `.team/inbox/*.jsonl` mailbox；
- request/reply 的消息结构；
- 用于未分配任务的 claim lock；
- `labs/worktrees/` 下按任务划分的工作目录。

验收标准：

- 两个 agent 不会认领同一个任务。
- 消息结构足够完整，之后可以审计。
- 不同任务的文件改动不会冲突。

## 综合项目

构建一个迷你 Claude-Code-like harness，包含：

- 一个稳定循环；
- dispatch map 工具；
- 权限检查；
- hooks；
- todo 计划；
- 可选 subagents；
- 上下文压缩；
- 任务持久化；
- 后台执行；
- 团队 mailbox；
- 一个形状类似 MCP 的外部工具 adapter。

当你能把每个机制解释为以下类别之一时，综合项目就算完成：

- 一个 tool；
- 一个 manager；
- 一个 persistence layer；
- 一个围绕循环的 hook；
- 或一个 external capability adapter。
