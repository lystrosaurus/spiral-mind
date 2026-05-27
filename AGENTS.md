# Agent 协作说明

本仓库是一个学习工作区，用来重建并理解
`shareAI-lab/learn-claude-code` 教学中的 agent harness 机制。

## 工作规则

- 保持当前 20 课主线和旧 12 课路线的区别。
- 持久学习材料优先放在 `docs/`，章节进度放在 `progress.md`，实验代码后续放在
  `labs/` 目录。
- 除非用户明确要求 vendored reference，否则不要把上游的大段源码复制进本仓库。
- 不要存储 API key、`.env` 文件、token、cookie 或模型凭据。
- 添加代码实验时，保持范围小，并且一次只对应一个 harness 机制。

## 事实来源

- `README.md`：工作区入口。
- `docs/learning-roadmap.md`：学习顺序和预期成果。
- `docs/practice-lab.md`：动手练习。
- `progress.md`：当前学习状态。
