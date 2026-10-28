# 在 IDEA 里单步调试 Agent Harness

本文档说明如何用 IntelliJ IDEA 给本项目下断点、单步执行、观察变量。

> 前提：已经在 IDEA 里打开 `c:\AI\spiral-mind` 项目，并且执行过一次
> `npm run build`（`tsconfig.json` 里已开 `sourceMap: true`，IDE 能把编译产物
> 的断点映射回 `.ts` 源码）。

## 为什么要 Source Map

本项目是 TypeScript → JavaScript 的编译型：

```text
src/index.ts  ──tsc──▶  dist/src/index.js
                       dist/src/index.js.map   ← source map
```

`dist/*.js` 里的代码是编译后的产物（类型注解被擦除、`#` 私有字段变成运行时
符号、`satisfies` 消失、枚举被内联……），**不适合直接读**。但 Node.js 只能跑
`.js`。

source map 是编译时生成的"回译本"——IDE 跑 `.js` 时，断点会自动映射回原始的
`.ts` 文件行号。所以**你在 `.ts` 源码里下断点，跑的是 `dist/` 下的 `.js`，
但在源码里观察变量和单步**。

## 三种调试场景

按"入门 → 进阶"排。场景 A 不需要 API key，场景 B 需要本地 `.env`。

---

### 场景 A：调试测试用例（推荐先从这个开始）

**不需要 API key、不需要 `.env`。** 用 `MemoryModel`（脚本模型）驱动主循环，
稳定、免费、跑得快。

#### IDEA 里怎么配

1. 右上角 **Run → Edit Configurations…**
2. 点左上角 `+` → 选 **Node.js**
3. 填写：

| 字段 | 值 | 说明 |
|---|---|---|
| Name | `test: agent-loop` | 随便起 |
| JavaScript file | `dist/test/agent-loop.test.js` | 编译后的产物 |
| Node parameters | `--test` | 告诉 Node 用 node:test 框架跑 |
| Working directory | `c:\AI\spiral-mind` | IDEA 自动填对 |

4. 选 **Apply → OK**

> ⚠️ **JavaScript file 必须填 `dist/` 下的 `.js`，不能填 `test/*.test.ts`。**
>
> 直接跑 TS 源码会报：
>
> ```text
> Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\AI\spiral-mind\src\index.js'
> imported from C:\AI\spiral-mind\test\agent-loop.test.ts
> ```
>
> 原因：TS 源码里写 `from "../src/index.js"` 是 ESM 的规范要求（编译后路径才成立），
> 但源码目录里只有 `src/index.ts`，没有 `src/index.js`。Node 不会自动把 `.js`
> 解析成 `.ts`，所以必须在编译后的 `dist/` 上运行。
>
> 改配置前记得先 `npm run build`，保证 `dist/` 是最新的。

#### 下断点

打开 [src/index.ts](../src/index.ts)，在下面几处点左边行标：

```
AgentLoop.run() 的 for 循环开头     ← 每次模型响应后都会回到这里
AgentLoop.#runToolUses 里的 handler 调用 ← 真正执行工具的地方
AgentLoop.#runToolUses 里的 PermissionPolicy.canUseTool ← 权限检查
```

打开 [test/agent-loop.test.ts](../test/agent-loop.test.ts)，在测试用例里下断点：

```
第一个测试里 loop.run(...) 调用     ← 进入 harness 主循环前的最后一步
```

#### 开始调试

点 IDEA 右上角那个虫子图标（🪲 Debug）。

命中断点后：

- **F8**：Step Over（单步跳过，当前行执行完进入下一行）
- **F7**：Step Into（单步进入，函数调用会跳进去）
- **Shift+F7**：Smart Step Into（智能选择进哪个函数）
- **Shift+F8**：Step Out（跳出当前函数）
- **F9**：Resume（继续跑到下一个断点）

#### 重点观察什么

在 Variables 面板展开 `AgentLoop` 实例的私有字段（`#model`、`#tools`、
`#permission`、`#hooks`、`#maxIterations`）。它们在调试器里可能显示成
`#private#model`——这是 JavaScript 真正私有字段的运行时表现，不是 bug。

展开 `messages` 数组：你会看到 harness 在主循环每一轮把 assistant 响应和
tool_result 依次 append 进去，对话历史在你眼皮底下长长。

在 `MemoryModel.create()` 断下来时看 `this.#index`——每跑一轮 `#index += 1`，
剧本向前推进一条。

---

### 场景 B：调试真实模型（debug:model）

**需要在项目根目录有 `.env` 文件**（`.gitignore` 已排除，不会误提交）。

#### 先验证配置对不对

在 IDEA 里同样新建一个 Node.js 配置：

| 字段 | 值 |
|---|---|
| Name | `debug:config` |
| JavaScript file | `dist/src/debug-config.js` |
| Working directory | `c:\AI\spiral-mind` |

点 ▶ Run，看控制台输出是否正常。确认 API key 打码显示、URL 拼接正确。

#### 再跑真实模型

再建一个 Node.js 配置：

| 字段 | 值 | 说明 |
|---|---|---|
| Name | `debug:model` | |
| JavaScript file | `dist/src/debug-model.js` | |
| Program arguments | `Use the bash tool to run pwd, then explain.` | 命令行 prompt |
| Working directory | `c:\AI\spiral-mind` | |

在这些地方下断点：

```
src/debug-model.ts main()         ← 入口，看 .env 加载、model 创建、loop 启动
src/index.ts AnthropicMessagesModel.create() / OpenAIChatCompletionsModel.create()
                                  ← fetch 调用前，看 request body 长什么样
src/index.ts AgentLoop.run() 里的 hooks.afterModelResponse  ← 每轮模型响应后
src/index.ts AgentLoop.#runToolUses 里的 beforeToolUse / handler / afterToolUse
                                  ← 完整工具调用链路
```

跑起来后你会**亲眼看到**整个 harness 循环：

```
模型 → "我要调 bash(pwd)" → harness → "权限检查通过" → 执行 handler
→ "返回 C:\AI\spiral-mind" → tool_result 回填成 user 消息 → 再次问模型
→ "好，现在我知道你在哪了" → stopReason=end_turn → 返回 transcript
```

---

### 场景 C：调试配置加载（debug:config）

最简单的场景，用来排查 `.env` 读不进或者 URL 拼错。

配置同场景 B 的"先验证配置对不对"，在 [src/debug-config.ts](../src/debug-config.ts)
的 `main()` 里下断点就行。

---

## 推荐断点位置（按学习顺序）

按 s01–s04 的逻辑结构排列，方便你边调边理解 harness：

### s01 Agent 循环

| 断点位置 | 文件 | 行号 | 看什么 |
|---|---|---|---|
| `AgentLoop.run()` 的 `for` 循环开头 | src/index.ts | AgentLoop.run | 每轮迭代 `iteration` 自增、`messages` 数组在长长 |
| `await this.#model.create(...)` | src/index.ts | run() 内 | 发请求给模型的地方，前后 messagesBefore 和 response 都能看 |
| `response.stopReason !== "tool_use"` 分支 | src/index.ts | run() 内 | 模型决定"不调工具了"时的出口 |

### s02 工具调用 / dispatch map

| 断点位置 | 文件 | 看什么 |
|---|---|---|
| `this.#tools.get(block.name)` | src/index.ts | dispatch map 查表 |
| `tool.handler(block.input, { messages })` | src/index.ts | 真正执行工具的那一行 |

### s03 权限系统

| 断点位置 | 文件 | 看什么 |
|---|---|---|
| `this.#permission.canUseTool(block, tool)` | src/index.ts | Policy 返回的 `decision.allowed` 和 `decision.reason` |
| `throw new PermissionDeniedError(...)` | src/index.ts | 被拒绝时的抛错路径 |

### s04 Hook 系统

| 断点位置 | 文件 | 看什么 |
|---|---|---|
| `await this.#hooks.afterModelResponse?.(...)` | src/index.ts | 每轮模型响应结束后 |
| `await this.#hooks.beforeToolUse?.(...)` | src/index.ts | 工具执行前 |
| `await this.#hooks.afterToolUse?.(...)` | src/index.ts | 工具执行后，result 已就绪 |

### 模型适配器

| 断点位置 | 文件 | 看什么 |
|---|---|---|
| `this.#fetch(this.#messagesUrl(), {...})` | src/index.ts | Anthropic/OpenAI 的 fetch 调用前；展开 body 看完整请求 |
| `new Response(JSON.stringify({...}))` | test/*.test.ts | 测试里注入假 fetch 的地方，可模拟各种响应 |

### MemoryModel（测试时）

| 断点位置 | 文件 | 看什么 |
|---|---|---|
| `if (!response) { return ... }` | src/index.ts | 剧本用完的兜底路径 |
| `this.#index += 1` | src/index.ts | 每次 create 调用后剧本向前推进一格 |

---

## 调试器里的 TS 注意事项

### 类型注解不存在

断点停住后你看不到 `ContentBlock`、`ToolInput` 这些类型信息——这是正常的。
TypeScript 的类型系统只在编译期起作用，运行时**全部被擦除**。调试器里你看到的
是纯 JavaScript 世界。

### 私有字段显示成奇怪的名字

```text
#responses → #private#responses（或直接叫 responses，取决于 Node 版本）
#tools    → #private#tools
```

这是 JS 原生私有字段（`#` 前缀）在运行时的表现，不影响功能。

### `readonly` 约束在调试器里可以打破

TypeScript 的 `readonly` 只是编译期检查。**调试器里可以直接修改变量值**——
比如故意把 `response.stopReason` 改成 `"end_turn"` 看 harness 怎么反应。
这正是调试器的威力：能在运行时注入测试场景。

### ESM import 跳转可能失效

本项目用 Node ESM（`import` / `export`）。IDEA 对 ESM 的源码跳转有时不稳定。
如果 Ctrl+点击 `./env.js` 跳不到 `src/env.ts`，不影响运行，等 JetBrains 修就行。

---

## 遇到问题怎么办

| 症状 | 原因 | 解决 |
|---|---|---|
| `ERR_MODULE_NOT_FOUND: Cannot find module '...\src\index.js'` | Run Configuration 指向了 `.ts` 源文件 | JavaScript file 改成 `dist/test/agent-loop.test.js`（或对应 `dist/src/*.js`），并先 `npm run build` |
| 断点显示为空心（灰色） | IDEA 没识别到 source map 或编译产物比源码旧 | 重新 `npm run build`，确认 `dist/**/*.map` 文件存在 |
| 断在 `.js` 里而不是 `.ts` 里 | source map 被 IDEA 忽略 | File → Project Structure → Modules → 勾上 "Enable JavaScript support" 或 "TypeScript Language Service" |
| 跑到一半报 ENOENT: .env 找不到 | debug:model 需要 .env 文件 | 跑 debug:model 之前先跑 debug:config 确认 .env 存在 |
| Windows 下路径变成 `/C:/...` 炸掉 | pathToFileURL 转换时 URL 编码不一致 | 这个是 IDEA 历史 bug，升级到 2025.x |
| 测试在 Debug 里跑但 Console 输出空白 | node:test 的输出被 IDEA 吞了 | 在 Node parameters 里加 `--test-reporter spec` |

---

## 一键重建调试环境

如果以上全不管用，最后手段：

```powershell
# 1. 清理编译产物
rm -r dist

# 2. 重新 build（sourceMap=true 会一并生成 .map 文件）
npm run build

# 3. 确认 .map 文件在
dir dist\src\*.map
dir dist\test\*.map

# 4. IDEA 里 File → Invalidate Caches → Invalidate and Restart
```
