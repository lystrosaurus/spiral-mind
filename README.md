# spiral-mind

这是一个 TypeScript 学习工作区，用来从 0 到 1 学习并重建
[shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)
里的核心机制。

目标不是复制上游仓库，而是理解 agent harness 的设计，并能自己重建关键部件。

## TypeScript 实现

本仓库使用 TypeScript `6.0.3`。这是 npm registry 在 2026-05-26 返回的
`latest` 包版本。

```sh
npm install
npm test
```

当前实现范围：

- [src/index.ts](src/index.ts)：核心 agent 循环、模型接口、工具定义、权限策略、
  hook，以及测试用的 `MemoryModel`。
- [test/agent-loop.test.ts](test/agent-loop.test.ts)：覆盖 s01 到 s04 基础机制的
  行为测试。

第一个实现里程碑覆盖：

- s01 Agent 循环
- s02 通过 dispatch map 实现工具调用
- s03 在 handler 执行前做权限检查
- s04 在工具执行前后触发 hook 回调

## 来源快照

检查日期：2026-05-26，来自当前工作区环境。

- 当前主线：根目录下的 `s01_agent_loop/` 到 `s20_comprehensive/`。
- 旧版路线：`agents/`、`docs/` 以及当前 `web/` 应用仍在描述旧的 12 课版本。
- 不要混用 20 课主线和旧 12 课路线的章节编号。

## 心智模型

模型才是 agent。你写的代码是 harness。

```text
User -> messages[] -> model -> stop_reason
                         |
                         | tool_use
                         v
                  TOOL_HANDLERS[name](input)
                         |
                         v
                  tool_result -> messages[] -> loop
```

每一章都围绕这个循环增加一种 harness 机制：工具、权限、hook、计划、subagent、
skill、上下文压缩、记忆、任务、后台工作、团队、worktree、MCP，最后形成一个完整
的参考 harness。

## 如何使用本仓库

1. 阅读 [docs/learning-roadmap.md](docs/learning-roadmap.md)。
2. 运行 `npm test` 验证当前 TypeScript harness。
3. 每学一章，把 [docs/chapter-notes-template.md](docs/chapter-notes-template.md)
   复制到自己的笔记中并补全。
4. 使用 [docs/practice-lab.md](docs/practice-lab.md) 重建小型机制，不要只阅读。
5. 每完成一章，更新 [progress.md](progress.md)。
6. 上游变化时，同步更新 [docs/sources.md](docs/sources.md) 中的来源记录。

## 推荐的第一个里程碑

先构建一个最小本地 harness：

- 一个 `while True` 循环；
- 一个类似 shell 的工具；
- 一个 `TOOL_HANDLERS` dispatch map；
- 能清楚打印 `messages[]`、`stop_reason` 和工具结果；
- 命令执行前有一个安全检查。

之后一次只增加一种机制。
