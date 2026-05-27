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

## 调试真实模型调用

设置 Anthropic API key 后，可以跑一个真实模型调试循环：

```powershell
npm run debug:model -- "Use the bash tool to run pwd, then explain the harness loop."
```

`npm run debug:model` 会自动读取项目根目录的本地 `.env`。仓库只提交
[.env.example](.env.example) 作为格式参考；真实 `.env` 已被 `.gitignore` 排除。

```env
MODEL_PROVIDER=anthropic

ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MAX_TOKENS=1024

# OpenAI-compatible gateways:
# MODEL_PROVIDER=openai
# OPENAI_API_KEY=your-openai-compatible-key
# OPENAI_MODEL=gpt-4o-mini
# OPENAI_BASE_URL=https://api.openai.com
# OPENAI_MAX_TOKENS=1024
```

先用这个命令确认本地 `.env` 是否生效，以及最终请求会发到哪里：

```powershell
npm run debug:config
```

这个命令会：

- 调用 Anthropic Messages API；
- 把 `messages` 和 `tools` 发给模型；
- 允许模型调用一个安全版 `bash` 工具；
- 打印 `beforeToolUse`、`afterToolUse`、最终 `stopReason` 和完整 transcript。

安全版 `bash` 只允许 `pwd`、`ls`、`dir` 和 `echo <text>`，用来学习工具调用协议，不用来执行任意命令。

当前实现范围：

- [src/index.ts](src/index.ts)：核心 agent 循环、模型接口、工具定义、权限策略、
  hook、Anthropic Messages API 适配器，以及测试用的 `MemoryModel`。
- [src/debug-model.ts](src/debug-model.ts)：真实模型调用调试入口。
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
