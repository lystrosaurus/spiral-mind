# 术语表

## Agent

能感知、推理并决定动作的训练模型。在这条学习路径里，周围代码不应该假装自己是
agent。

## Harness

围绕模型的运行环境：工具、知识、观察结果、动作接口、权限、上下文管理和持久化。

## messages[]

发送给模型的 conversation state。工具结果会追加回这个列表，让模型观察发生了什么。

## stop_reason

模型响应中的字段，用来告诉 harness：模型已经完成，还是想调用工具。

## tool_use

模型发出的请求，表示要用结构化输入执行某个命名工具。

## tool_result

harness 对 `tool_use` 的响应。它会成为下一轮循环中模型看到的 observation。

## TOOL_HANDLERS

从工具名到 handler function 的 dispatch map。它让主循环在不断添加工具时仍然保持稳定。

## 权限边界

决定某个动作是允许、拒绝，还是需要人工审批的一组规则。

## Hook

围绕循环或工具执行的扩展点。Hook 可以在不重写核心循环的情况下增加日志、校验或通知。

## Todo

会话内的计划项。Todo 帮助模型让多步骤工作保持可见。

## Task

持久化工作项，通常带有依赖关系和状态并存储在磁盘上。Task 可以跨进程重启保留。

## Subagent

拥有全新上下文的子 agent 循环。它执行隔离的旁路工作，并向父循环返回压缩后的结果。

## Skill

按需加载的知识，通常以 Markdown 存储，只在相关时加载。

## 上下文压缩

通过总结、裁剪或预算控制旧内容，为 transcript 腾出空间的过程。

## 记忆

从经验中筛选出的持久信息，存储在原始 transcript 之外。

## 后台任务

在主循环之外执行的长时间操作，通常通过通知把结果报告回来。

## Mailbox

agent 队友之间的持久通信通道，通常表示为 JSONL records。

## Worktree 隔离

一种把独立任务绑定到独立工作目录的方法，避免并行 agent 互相冲突。

## MCP

Model Context Protocol。在这条学习路径中，可以把 MCP 理解为一种把外部能力路由进同一
工具池的方法。
