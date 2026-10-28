/**
 * ============================================================================
 * src/index.ts —— 最小 agent harness 的核心实现（s01–s04）
 * ============================================================================
 *
 * 这个文件是整个学习项目的"心脏"，把所有机制都装在一个文件里，方便对照阅读：
 *
 *   1. 类型定义区     —— 描述 harness 里流动的"数据结构"（消息、工具、决策、hook…）
 *   2. Model 接口     —— 模型抽象：任何能被 harness 驱动的 LLM 都要实现这个接口
 *   3. 工具系统       —— ToolDefinition + ToolHandler + dispatch map（s02）
 *   4. 权限系统       —— PermissionPolicy（s03）
 *   5. Hook 系统      —— beforeToolUse / afterToolUse / afterModelResponse（s04）
 *   6. AgentLoop      —— 主循环：问模型 → 看 stop_reason → 跑工具 → 回填 → 再问（s01）
 *   7. 模型适配器     —— AnthropicMessagesModel / OpenAIChatCompletionsModel / MemoryModel
 *
 * ----------------------------------------------------------------------------
 * 给"懂编程但不熟 TS"读者的语法速查（第一次出现时也会就地再解释一次）：
 * ----------------------------------------------------------------------------
 *
 *  • export type X = ...
 *      类型别名。它**不会**产生运行时代码，只是给编译器看的"形状说明书"。
 *      类似 C 里的 typedef、Java 里的接口（但更灵活，可以给任意类型起别名）。
 *
 *  • A | B                       （联合类型）
 *      "X 是 A 或者是 B"。例如 Role = "user" | "assistant" | "system"
 *      意思是 Role 只能取这三个字符串字面量之一，写错字编译器会报错。
 *
 *  • A & B                       （交叉类型）
 *      "X 同时满足 A 和 B 的形状"。用来把两个对象类型合并。
 *
 *  • readonly 字段 / readonly T[]
 *      只读。编译期约束：声明后不允许被重新赋值。运行时不做任何额外开销。
 *      在 harness 里大量用 readonly 是为了强调"这些结构化数据应该被当成不可变的"。
 *
 *  • 字段?: 类型                 （可选字段 / 可选参数）
 *      这个字段可以不存在。访问前通常要做判空，或者用 ?? 提供默认值。
 *
 *  • a ?? b                      （空值合并运算符）
 *      当 a 是 null 或 undefined 时返回 b，否则返回 a。
 *      和 || 的区别：|| 会把 0、""、false 也当成"空"，而 ?? 只认 null/undefined。
 *      在配置项里非常常用：config.maxTokens ?? 1024。
 *
 *  • a?.b                        （可选链）
 *      如果 a 是 null/undefined 就短路返回 undefined，否则返回 a.b。
 *
 *  • x as T                      （类型断言）
 *      告诉编译器"我确认 x 就是 T 类型，请按 T 处理"。不做运行时检查。
 *      用多了会失去类型保护，本项目里只在解析 JSON 后少量使用。
 *
 *  • x satisfies T               （satisfies 运算符）
 *      让编译器检查 x 是否符合 T，但不改变 x 的类型推断。
 *      适合"我希望这个对象字面量被严格检查，但又不希望被显式标注成 T"。
 *
 *  • class 里的 #字段
 *      JS/TS 的"真正私有字段"。外部代码在编译期和运行期都访问不到，
 *      比 private 关键字（仅编译期私有）更严格。
 *
 *  • implements SomeInterface
 *      声明一个类遵守某个接口。编译器会帮你检查方法签名是否齐全。
 *
 *  • Record<K, V>
 *      工具类型：表示"键是 K、值是 V"的对象，等价于 { [key in K]: V }。
 *      Record<string, unknown> 就是"任意字符串键、值类型未知"的对象。
 *
 *  • Promise<T> / async / await
 *      Promise<T> 是"未来会给出一个 T"的占位符；async 函数总是返回 Promise；
 *      await 会暂停当前 async 函数直到 Promise 出结果，不阻塞事件循环。
 *
 *  • typeof fetch
 *      取一个值的"类型"。FetchLike = typeof fetch 表示"fetch 这个函数的类型"，
 *      方便把 fetch 作为可注入依赖（测试时可以换成假 fetch）。
 *
 * ============================================================================
 */


// ============================================================================
// 1. 消息与内容块（Content Block）类型
// ============================================================================
//
// 在 agent 协议里，一条消息不是简单的字符串，而是"内容块"的数组：
//   - text        普通的文本（模型给人的回答、人给模型的指令）
//   - tool_use    模型发出的"我要调用一个工具"的请求
//   - tool_result harness 执行工具后回填给模型的结果
//
// 这样设计的原因：模型一次回答可能既有文字解释，又有一或多个工具调用请求；
// harness 执行完工具后又要把每个工具的结果回传，所以用"数组+类型标签"统一描述。
// ============================================================================

/**
 * 消息的角色。
 *
 * 字符串字面量联合类型：只能是 "user" / "assistant" / "system" 三者之一。
 * 写错（比如 "User" 大写）在编译期就会报错，避免低级 bug。
 */
export type Role = "user" | "assistant" | "system";

/**
 * 模型结束本轮输出的原因。只有 tool_use 会让 harness 继续执行工具并回填结果。
 *
 * 对照 Anthropic Messages API 的 stop_reason 字段：
 *   - tool_use      模型决定调用工具（harness 必须执行工具后再次调用模型）
 *   - end_turn      模型自己讲完了，对话轮次结束
 *   - max_tokens    输出被 token 上限截断
 *   - stop_sequence 碰到了预设的停止序列
 *   - pause_turn    模型主动要求暂停（用于长任务/打断）
 *   - refusal       模型拒绝回答（内容安全等原因）
 */
export type StopReason =
  | "tool_use"
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "pause_turn"
  | "refusal";

/**
 * 文本内容块。
 *
 * type 字段是"判别标签"（discriminant tag），用来区分不同的 block 类型。
 * 编译器靠这个标签做"判别联合"：用 switch(block.type) 时，
 * 不同分支里 block 会自动收窄成对应的形状，访问 block.text 不会报错。
 */
export type TextBlock = {
  readonly type: "text";
  readonly text: string;
};

/**
 * 工具的输入参数。
 *
 * Record<string, unknown> 表示"任意键、值类型未知"的对象。
 * 因为不同工具的入参形状千差万别，harness 这里不规定死，由具体工具的
 * inputSchema 描述、handler 自己解析。
 */
export type ToolInput = Readonly<Record<string, unknown>>;

/**
 * JSON Schema，用来向模型描述工具入参的形状（哪些字段、类型、含义、是否必填）。
 * 模型会按这个 schema 生成 tool_use 的 input。
 */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * 模型请求工具时输出的结构。handler 只通过 name 和 input 被路由。
 *
 * id 由模型生成，用来在后续把 tool_result 对回这次 tool_use——
 * 因为一次响应里可能有多个 tool_use，没有 id 就分不清哪个结果对应哪次调用。
 */
export type ToolUseBlock = {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: ToolInput;
};

/**
 * 工具执行结果会作为 user 消息追加回 messages，让模型在下一轮继续推理。
 *
 * 这是 Anthropic/OpenAI 工具协议的关键一环：模型看到的对话历史里，
 * 工具结果是以"用户发了一条特殊消息"的形式出现的，模型据此继续作答。
 */
export type ToolResultBlock = {
  readonly type: "tool_result";
  readonly toolUseId: string;
  readonly content: string;
};

/**
 * 三种内容块的联合。
 *
 * 消息正文 content 既可以是简单字符串（人机对话常用），
 * 也可以是 ContentBlock 数组（涉及工具调用时必须）。
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/**
 * 对话历史里的一条消息。
 *
 * content 是 string 或 readonly ContentBlock[] 的联合，二选一。
 */
export type Message = {
  readonly role: Role;
  readonly content: string | readonly ContentBlock[];
};

/**
 * 模型一次完整响应。
 *
 * stopReason 告诉 harness"模型为什么停下来"，
 * content 是模型这一轮吐出的所有内容块（可能有 text + 若干 tool_use）。
 */
export type ModelResponse = {
  readonly stopReason: StopReason;
  readonly content: readonly ContentBlock[];
};


// ============================================================================
// 2. Model 接口（模型抽象）
// ============================================================================
//
// 整个 harness 只依赖这个最小接口，不关心底层是 Anthropic、OpenAI 还是
// 测试用的假模型。这是典型的"依赖倒置"：核心循环依赖抽象，不依赖具体实现。
// ============================================================================

/**
 * 真实模型和测试 fake model 都只需要实现这个最小接口。
 *
 * 入参：
 *   messages  —— 截至目前的完整对话历史（包括已经回填的 tool_result）
 *   tools     —— 本轮模型可以使用的工具列表（名字 + 描述 + 入参 schema）
 *
 * 返回：
 *   Promise<ModelResponse> —— 模型下一轮的输出
 *
 * 这里没有把 hooks、permission 之类塞进来，因为它们是 harness 自己的事，
 * 模型接口只需要"看历史 + 看可用工具 → 给响应"。
 */
export type Model = {
  create(messages: readonly Message[], tools: readonly ToolDefinition[]): Promise<ModelResponse>;
};


// ============================================================================
// 3. 工具系统（s02：dispatch map）
// ============================================================================
//
// 模型在 tool_use 里只会说两件事：工具名 + 入参 JSON。harness 拿到之后
// 要去一张 dispatch map 里查"这个名字对应哪个函数"，然后调用它。
// 这就是 ToolDefinition + ToolHandler 组合的意义。
// ============================================================================

/**
 * 传给工具 handler 的上下文。
 *
 * 现在只放了 messages，方便工具内部"看到对话历史"做更聪明的决策；
 * 后续章节可以往这里加工作目录、session id、用户身份信息等。
 */
export type ToolContext = {
  readonly messages: readonly Message[];
};

/**
 * 工具真正的执行函数。
 *
 * 入参：
 *   input   —— 模型生成的入参 JSON（对应 ToolUseBlock.input）
 *   context —— 上面那个 ToolContext
 *
 * 返回：字符串（工具结果），可以是同步的 string 或异步的 Promise<string>。
 * 用 Promise<string> | string 这个联合，是允许工具既可以是 async 也可以是普通函数。
 */
export type ToolHandler = (
  input: ToolInput,
  context: ToolContext,
) => Promise<string> | string;

/**
 * 一个工具的完整定义。
 *
 *   name        工具名，模型在 tool_use 里通过名字引用它
 *   description 给模型看的自然语言说明，模型据此决定何时调用
 *   inputSchema 入参 JSON Schema（可选），帮模型生成合法的 input
 *   handler     harness 真正调用的函数
 *
 * 这就是 s02 的核心：模型不需要知道函数在哪、怎么调用，它只要会报名字；
 * harness 用 dispatch map 把名字解析到 handler。
 */
export type ToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: JsonSchema;
  readonly handler: ToolHandler;
};


// ============================================================================
// 4. 权限系统（s03：在 handler 之前做检查）
// ============================================================================
//
// 工具 handler 可能产生真实副作用（写文件、发请求、删数据…），所以必须
// 在调用 handler 之前先过一道权限策略。策略只返回"允许/拒绝"，被拒绝时
// harness 直接抛错，handler 不会被触发。
// ============================================================================

/**
 * 权限决策结果。
 *
 * 当前权限系统只有允许和拒绝两种结果；后续章节可以扩展为 require_approval。
 *
 * 这里用了"判别联合"：
 *   - allowed: true 时，reason 是可选的（可以附带说明）
 *   - allowed: false 时，reason 是必填的（必须告诉用户/日志为什么拒绝）
 *
 * 通过把 allowed 当作判别标签，TS 可以强制我们写出上面这种约束：
 * 拒绝时必须有 reason，允许时 reason 可有可无。
 */
export type PermissionDecision =
  | {
      readonly allowed: true;
      readonly reason?: string;
    }
  | {
      readonly allowed: false;
      readonly reason: string;
    };

/**
 * 权限策略接口。
 *
 * canUseTool 在每次 handler 执行前都会被调用一次。
 * 实现可以是：
 *   - 写死的白名单/黑名单
 *   - 按用户角色判断
 *   - 弹出提示让人工确认（后续章节的 require_approval）
 */
export type PermissionPolicy = {
  canUseTool(toolUse: ToolUseBlock, tool: ToolDefinition): PermissionDecision;
};


// ============================================================================
// 5. Hook 系统（s04：在关键时机回调）
// ============================================================================
//
// Hook 是 harness 留给外部代码的"扩展点"。核心循环本身只负责推进流程，
// 至于"要不要打日志、要不要做审计、要不要统计指标"，都通过 hook 注入。
//
// 关键设计：hook 拿到的是只读上下文，所以它不能篡改循环——只能观察。
// ============================================================================

/**
 * hook 拿到的是只读上下文，用来记录日志、统计、审计，不直接改变核心循环。
 *
 * 包含三个东西：
 *   toolUse  —— 这次模型发出的工具调用请求（长什么样、参数是什么）
 *   tool     —— 这次被调用的工具定义（描述、schema、handler 引用）
 *   messages —— 当前的对话历史快照
 */
export type ToolHookContext = {
  readonly toolUse: ToolUseBlock;
  readonly tool: ToolDefinition;
  readonly messages: readonly Message[];
};

/**
 * 工具执行完之后，hook 额外能拿到 result。
 *
 * ToolHookContext & { ... } 是交叉类型：把两个对象类型合并成一个。
 * 等价于 { toolUse, tool, messages, result } 四个字段都有。
 */
export type ToolResultHookContext = ToolHookContext & {
  readonly result: ToolResultBlock;
};

/**
 * 模型每次响应结束后，afterModelResponse hook 拿到的上下文。
 *
 *   iteration      当前是第几轮（从 1 开始）
 *   response       模型刚刚给出的响应
 *   messagesBefore 调用模型之前的对话历史（response 还没追加进去）
 *
 * 把"调用前"的历史单独传出来，对调试和打点很有用：
 * 比如想统计"每轮喂给模型多少 token"，就看 messagesBefore 就行。
 */
export type ModelResponseHookContext = {
  readonly iteration: number;
  readonly response: ModelResponse;
  readonly messagesBefore: readonly Message[];
};

/**
 * 所有 hook 都是可选的。
 *
 * 每个 hook 都可以是同步函数（返回 void）或异步函数（返回 Promise<void>）。
 * 后面 AgentLoop 调用时用 await hooks.xxx?.(...)，两种都能兼容：
 *   - 没传 hook    → ?. 短路，啥都不做
 *   - 同步 hook    → await 一个非 Promise 值会立即返回
 *   - 异步 hook    → await 会等它跑完
 */
export type Hooks = {
  readonly afterModelResponse?: (context: ModelResponseHookContext) => Promise<void> | void;
  readonly beforeToolUse?: (context: ToolHookContext) => Promise<void> | void;
  readonly afterToolUse?: (context: ToolResultHookContext) => Promise<void> | void;
};


// ============================================================================
// 6. AgentLoop 的入参与返回值
// ============================================================================

/**
 * 启动一个 AgentLoop 需要的全部配置。
 *
 *   model        必填，模型接口实现
 *   tools        必填，工具列表（harness 内部会把它转成 dispatch map）
 *   permission   可选，权限策略；缺省时使用"全部允许"策略
 *   hooks        可选，hook 集合
 *   maxIterations 可选，最大循环轮数；防止模型死循环调用工具，把 API 额度烧光
 */
export type AgentLoopOptions = {
  readonly model: Model;
  readonly tools: readonly ToolDefinition[];
  readonly permission?: PermissionPolicy;
  readonly hooks?: Hooks;
  readonly maxIterations?: number;
};

/**
 * AgentLoop.run() 的返回结果。
 *
 *   stopReason  模型最终为什么停下来（通常是 end_turn，也可能是 max_tokens 等）
 *   messages    完整对话历史（包括所有 assistant 回应 + 所有 tool_result 回填）
 *
 * 调用方拿到 messages 后可以做：展示、存盘、作为下次会话的初始历史等。
 */
export type AgentRunResult = {
  readonly stopReason: StopReason;
  readonly messages: readonly Message[];
};


// ============================================================================
// 7. 错误类型
// ============================================================================
//
// 给不同失败原因定义专属 Error 子类，调用方可以用 instanceof 区分错误种类，
// 而不是靠解析错误消息字符串。
// ============================================================================

/**
 * 权限策略拒绝时抛出。包含被拒绝的 toolUse 快照和拒绝原因。
 */
export class PermissionDeniedError extends Error {
  public constructor(toolUse: ToolUseBlock, reason: string) {
    // super(...) 调用父类 Error 的构造函数，把消息传进去
    super(`Permission denied for tool "${toolUse.name}": ${reason}`);
    // 手动设置 name 是为了在堆栈/日志里更直观地区分错误种类
    this.name = "PermissionDeniedError";
  }
}

/**
 * dispatch map 里找不到对应工具时抛出。一般是模型幻觉出了不存在的工具名。
 */
export class UnknownToolError extends Error {
  public constructor(toolName: string) {
    super(`Unknown tool "${toolName}"`);
    this.name = "UnknownToolError";
  }
}

/**
 * 循环超过 maxIterations 仍未结束时抛出。
 * 这是一个安全兜底：防止模型陷入工具死循环把额度耗尽。
 */
export class MaxIterationsError extends Error {
  public constructor(maxIterations: number) {
    super(`Agent loop reached max iterations (${maxIterations})`);
    this.name = "MaxIterationsError";
  }
}


// ============================================================================
// 8. 工具定义辅助函数
// ============================================================================

/**
 * 小封装让调用处保持"定义工具"的语义，后续可以在这里增加 schema 校验。
 *
 * 现在它就是个恒等函数（原样返回入参），但保留这个函数有意义：
 *   - 调用处写 defineTool({ ... }) 比直接写字面量更有"声明一个工具"的语义
 *   - 将来想统一加校验、加默认值、加日志，只要改这一个函数
 */
export function defineTool(definition: ToolDefinition): ToolDefinition {
  return definition;
}


// ============================================================================
// 9. MemoryModel —— 测试用的脚本模型
// ============================================================================
//
// 测试 harness 行为时，我们不希望真的去调 LLM（慢、要钱、不稳定）。
// MemoryModel 接受一组"剧本"（预置响应），每次调用就按顺序吐出下一条。
// ============================================================================

/**
 * 测试用的脚本模型：按顺序吐出预置响应，方便稳定复现 agent loop 行为。
 *
 * implements Model 表示这个类遵守 Model 接口（即必须有 create 方法且签名匹配）。
 * 编译器会帮我们检查；如果哪天 Model 接口改了，这里没跟上就会报错。
 */
export class MemoryModel implements Model {
  // # 开头的字段是 JS/TS 的"真正私有字段"——
  // 编译期和运行期都访问不到，比 private 关键字更严格。
  readonly #responses: ModelResponse[];
  #index = 0;

  public constructor(responses: readonly ModelResponse[]) {
    // [...responses] 是展开语法：把传入的只读数组复制一份新的可变数组，
    // 防止外部调用者事后修改原数组影响内部状态。
    this.#responses = [...responses];
  }

  public async create(): Promise<ModelResponse> {
    const response = this.#responses[this.#index];
    if (!response) {
      // 剧本用完了：兜底返回一个 end_turn，让 AgentLoop 正常终止而不是炸掉。
      return {
        stopReason: "end_turn",
        content: [{ type: "text", text: "No more scripted responses." }],
      };
    }

    this.#index += 1;
    return response;
  }
}


// ============================================================================
// 10. HTTP / JSON 辅助
// ============================================================================

/**
 * FetchLike = "fetch 函数的类型"。
 *
 * typeof fetch 是 TS 的类型查询：取 fetch 这个值对应的类型。
 * 这样做的好处：可以在构造模型适配器时把 fetch 作为参数注入，
 * 测试时传一个假 fetch，就不用真的发网络请求。
 */
export type FetchLike = typeof fetch;

/**
 * 把 HTTP 响应按 JSON 解析；如果不是 JSON（比如 502 网关返回 HTML 错误页），
 * 就抛一个带上下文信息的错误，方便排查。
 *
 * readJsonResponse<T> 的 <T> 是泛型参数：调用方指定"期望解析出什么形状"。
 * 例如 readJsonResponse<AnthropicResponseBody>(resp, "Anthropic Messages API")。
 *
 * 注意：TS 的泛型只在编译期存在。运行时不做校验，全靠我们信任后端契约。
 */
async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const body = await response.text();

  try {
    // as T 是类型断言：告诉编译器"请把这个解析结果当作 T"。
    // 运行时不做校验，所以下面 catch 里要处理"根本不是 JSON"的情况。
    return JSON.parse(body) as T;
  } catch {
    const contentType = response.headers.get("content-type") ?? "<missing content-type>";
    // body.slice(0, 300) 只保留前 300 字符，避免错误消息太长。
    throw new Error(
      `${label} returned non-JSON response (${response.status}, ${contentType}): ${body.slice(
        0,
        300,
      )}`,
    );
  }
}


// ============================================================================
// 11. Anthropic Messages API 适配器
// ============================================================================
//
// Anthropic 的接口约定：
//   POST {baseUrl}/v1/messages
//   headers: x-api-key, anthropic-version, content-type
//   body: { model, max_tokens, messages, tools, system? }
//   响应: { stop_reason, content: [...blocks] }
//
// 下面这个类负责：
//   - 把我们内部的 Message/ToolDefinition 格式翻译成 Anthropic 的请求格式
//   - 发 HTTP 请求
//   - 把 Anthropic 的响应格式翻译回我们内部的 ModelResponse
// ============================================================================

export type AnthropicMessagesModelOptions = {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly system?: string | undefined;
  readonly maxTokens?: number | undefined;
  readonly anthropicVersion?: string | undefined;
  readonly fetch?: FetchLike | undefined;
};

/**
 * 把用户给的 baseUrl 标准化为完整的 /v1/messages 端点。
 *
 * 容忍三种输入：
 *   - "https://api.anthropic.com"          → 补成 ".../v1/messages"
 *   - "https://api.anthropic.com/v1"       → 补成 ".../v1/messages"
 *   - "https://api.anthropic.com/v1/messages" → 原样返回
 *   - 结尾多余斜杠会被去掉
 *
 * 这样在 .env 里配置 base URL 时不用死记硬背完整路径。
 */
export function resolveAnthropicMessagesUrl(baseUrl: string): string {
  // /\/+$/ 是正则：匹配结尾一个或多个斜杠。replace 把它去掉。
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  if (normalizedBaseUrl.endsWith("/v1/messages")) {
    return normalizedBaseUrl;
  }
  if (normalizedBaseUrl.endsWith("/v1")) {
    return `${normalizedBaseUrl}/messages`;
  }
  return `${normalizedBaseUrl}/v1/messages`;
}

/**
 * 同上，但针对 OpenAI 兼容网关的 /v1/chat/completions 端点。
 */
export function resolveOpenAIChatCompletionsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  if (normalizedBaseUrl.endsWith("/v1/chat/completions")) {
    return normalizedBaseUrl;
  }
  if (normalizedBaseUrl.endsWith("/v1")) {
    return `${normalizedBaseUrl}/chat/completions`;
  }
  return `${normalizedBaseUrl}/v1/chat/completions`;
}

// ---- Anthropic 请求/响应的内部类型（只在文件内部使用，所以不 export）----

type AnthropicMessage = {
  readonly role: "user" | "assistant";
  readonly content: string | readonly Record<string, unknown>[];
};

type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  tools: {
    name: string;
    description: string;
    input_schema: JsonSchema;
  }[];
  system?: string;
};

type AnthropicResponseBody = {
  readonly stop_reason: StopReason;
  readonly content: readonly Record<string, unknown>[];
  readonly error?: {
    readonly message?: string;
  };
};

/**
 * Anthropic Messages API 适配器。
 *
 * 实现 Model 接口，所以可以直接传给 AgentLoop 使用。
 */
export class AnthropicMessagesModel implements Model {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #system: string | undefined;
  readonly #maxTokens: number;
  readonly #anthropicVersion: string;
  readonly #fetch: FetchLike;

  public constructor(options: AnthropicMessagesModelOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    // ?? 提供默认值：用户没传 baseUrl 就用官方地址
    this.#baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.#system = options.system;
    this.#maxTokens = options.maxTokens ?? 8000;
    this.#anthropicVersion = options.anthropicVersion ?? "2023-06-01";
    // 默认用全局 fetch；测试时可以注入假 fetch
    this.#fetch = options.fetch ?? fetch;
  }

  /**
   * Model 接口要求的实现：把内部消息格式翻译成 Anthropic 请求并发出去。
   */
  public async create(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
  ): Promise<ModelResponse> {
    // Anthropic 把 system 提示词单独放在顶层字段，不混在 messages 数组里。
    // 所以要先把 role==="system" 的消息挑出来合并成 system 字符串。
    const system = this.#buildSystem(messages);
    const body: AnthropicRequestBody = {
      model: this.#model,
      max_tokens: this.#maxTokens,
      messages: messages
        .filter((message) => message.role !== "system")
        .map((message) => this.#toAnthropicMessage(message)),
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        // 工具没提供 schema 时，给一个"任意对象"的兜底 schema
        input_schema: tool.inputSchema ?? { type: "object", properties: {} },
      })),
    };
    if (system) {
      body.system = system;
    }

    const response = await this.#fetch(this.#messagesUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.#apiKey,
        "anthropic-version": this.#anthropicVersion,
      },
      body: JSON.stringify(body),
    });

    const responseBody = await readJsonResponse<AnthropicResponseBody>(
      response,
      "Anthropic Messages API",
    );
    if (!response.ok) {
      // HTTP 状态码不是 2xx：把后端返回的 error.message 带上，方便定位
      throw new Error(
        `Anthropic Messages API request failed (${response.status}): ${
          responseBody.error?.message ?? response.statusText
        }`,
      );
    }

    // 把 Anthropic 的 content 数组翻译回我们内部的 ContentBlock[]
    return {
      stopReason: responseBody.stop_reason,
      content: responseBody.content.map((block) => this.#fromAnthropicBlock(block)),
    };
  }

  /**
   * 收集所有 role==="system" 的消息文本 + 构造时传入的 system，
   * 合并成一个字符串返回。返回 undefined 表示"没有 system 提示词"。
   */
  #buildSystem(messages: readonly Message[]): string | undefined {
    const systemMessages = messages
      .filter((message) => message.role === "system")
      .map((message) =>
        // system 消息的 content 可能是 string 也可能是 ContentBlock[]
        typeof message.content === "string"
          ? message.content
          : message.content
              // 只保留 text block，忽略 tool_use / tool_result（system 不该有）
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("\n"),
      )
      .filter((content) => content.length > 0);

    // 把构造时的 system 和消息里的 system 全部拼起来，用空行分隔
    return [this.#system, ...systemMessages].filter(Boolean).join("\n\n") || undefined;
  }

  #messagesUrl(): string {
    return resolveAnthropicMessagesUrl(this.#baseUrl);
  }

  /**
   * 把内部 Message 翻译成 Anthropic 单条消息。
   *
   * role === "system" 在这里会抛错：因为 system 已经在 #buildSystem 被挑走了，
   * 走到这里说明代码逻辑出了问题（防御性检查）。
   */
  #toAnthropicMessage(message: Message): AnthropicMessage {
    if (message.role === "system") {
      throw new Error("System messages are serialized through the top-level system field.");
    }

    return {
      role: message.role,
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((block) => this.#toAnthropicBlock(block)),
    };
  }

  /**
   * 把内部 ContentBlock 翻译成 Anthropic 格式的 block。
   *
   * switch(block.type) 配合"判别联合"：在每个 case 分支里，
   * TS 已经知道 block 一定是哪种具体形状，可以安全访问它的字段。
   */
  #toAnthropicBlock(block: ContentBlock): Record<string, unknown> {
    switch (block.type) {
      case "text":
        return block;
      case "tool_use":
        return block;
      case "tool_result":
        // 注意字段命名差异：
        // 我们内部用 toolUseId（camelCase），Anthropic 用 tool_use_id（snake_case）
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
        };
    }
  }

  /**
   * 把 Anthropic 返回的 block 翻译回内部 ContentBlock。
   *
   * 这里入参是 Record<string, unknown>，因为 Anthropic 返回的 block 字段是动态的，
   * 我们要运行时判断 block.type 才能确定结构。
   */
  #fromAnthropicBlock(block: Record<string, unknown>): ContentBlock {
    if (block.type === "text") {
      return {
        type: "text",
        // String(...) 把 unknown 强制转字符串，?? "" 防止 undefined
        text: String(block.text ?? ""),
      };
    }

    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: String(block.id),
        name: String(block.name),
        input: this.#asToolInput(block.input),
      };
    }

    // 不认识的 block 类型：兜底序列化成 JSON 字符串当文本，
    // 既能让模型/用户看到原文，又不会让程序崩掉。
    return {
      type: "text",
      text: JSON.stringify(block),
    };
  }

  /**
   * 运行时收窄：把 unknown 类型的 input 校验成"普通对象"，否则返回空对象。
   * Array.isArray 排除数组（因为数组 typeof 也是 "object"）。
   */
  #asToolInput(value: unknown): ToolInput {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as ToolInput;
    }
    return {};
  }
}


// ============================================================================
// 12. OpenAI Chat Completions API 适配器
// ============================================================================
//
// OpenAI 的接口约定和 Anthropic 有几处不一样：
//   - 工具调用叫 tool_calls，且 arguments 是 JSON 字符串（不是对象）
//   - 工具结果用 role: "tool" 的独立消息表示
//   - 没有独立的 system 字段，system 直接作为一条 role: "system" 的消息
//   - stop_reason 字段叫 finish_reason，取值也不同
//
// 下面这个类负责做这种"协议翻译"。
// ============================================================================

export type OpenAIChatCompletionsModelOptions = {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly maxTokens?: number | undefined;
  readonly fetch?: FetchLike | undefined;
};

type OpenAIChatCompletionResponseBody = {
  readonly choices?: readonly {
    readonly finish_reason?: string | null;
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly {
        readonly id?: string;
        readonly type?: string;
        readonly function?: {
          readonly name?: string;
          readonly arguments?: string;
        };
      }[];
    };
  }[];
  readonly error?: {
    readonly message?: string;
  };
};

export class OpenAIChatCompletionsModel implements Model {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #maxTokens: number;
  readonly #fetch: FetchLike;

  public constructor(options: OpenAIChatCompletionsModelOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.#maxTokens = options.maxTokens ?? 1024;
    this.#fetch = options.fetch ?? fetch;
  }

  public async create(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
  ): Promise<ModelResponse> {
    const response = await this.#fetch(resolveOpenAIChatCompletionsUrl(this.#baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // OpenAI 用 Bearer token 风格，和 Anthropic 的 x-api-key 不同
        authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.#model,
        max_tokens: this.#maxTokens,
        messages: this.#toOpenAIMessages(messages),
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema ?? { type: "object", properties: {} },
          },
        })),
      }),
    });

    const responseBody = await readJsonResponse<OpenAIChatCompletionResponseBody>(
      response,
      "OpenAI-compatible chat completion API",
    );
    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible chat completion request failed (${response.status}): ${
          responseBody.error?.message ?? response.statusText
        }`,
      );
    }

    const choice = responseBody.choices?.[0];
    if (!choice?.message) {
      throw new Error("OpenAI-compatible response did not include choices[0].message.");
    }

    return this.#fromOpenAIChoice(choice);
  }

  /**
   * 把内部 Message[] 翻译成 OpenAI 的 messages 数组。
   *
   * OpenAI 协议里：
   *   - 普通文本对话用 role: "user" / "assistant" / "system"
   *   - 模型发起的工具调用是 assistant 消息里的 tool_calls 字段
   *   - 工具结果必须单独发一条 role: "tool" 的消息，用 tool_call_id 对应回去
   *
   * 所以我们要把内部"一条消息里混合 text + tool_use + tool_result"的形状
   * 拆成 OpenAI 期望的多条消息。
   */
  #toOpenAIMessages(messages: readonly Message[]): Record<string, unknown>[] {
    const mapped: Record<string, unknown>[] = [];

    for (const message of messages) {
      // 简单情形：content 是字符串，直接映射
      if (typeof message.content === "string") {
        mapped.push({
          role: message.role,
          content: message.content,
        });
        continue;
      }

      // 复杂情形：content 是 ContentBlock[]，按 block 类型分组
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const toolUses = message.content.filter((block) => block.type === "tool_use");
      const toolResults = message.content.filter((block) => block.type === "tool_result");

      if (toolUses.length > 0) {
        // 有工具调用：必须发成 assistant 消息 + tool_calls 数组
        mapped.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUses.map((block) => ({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              // OpenAI 要求 arguments 是 JSON 字符串，不是对象
              arguments: JSON.stringify(block.input),
            },
          })),
        });
      } else if (text) {
        mapped.push({
          role: message.role,
          content: text,
        });
      }

      // 工具结果要单独拆成 role: "tool" 的消息
      for (const block of toolResults) {
        mapped.push({
          role: "tool",
          tool_call_id: block.toolUseId,
          content: block.content,
        });
      }
    }

    return mapped;
  }

  /**
   * 把 OpenAI 的 choice 翻译回内部 ModelResponse。
   *
   * NonNullable<T> 是工具类型：去掉 T 里的 null 和 undefined。
   * 这里它的作用是：从 choices 类型里取出"单个 choice 元素"的类型。
   * [number] 表示"取数组元素的类型"。
   */
  #fromOpenAIChoice(choice: NonNullable<OpenAIChatCompletionResponseBody["choices"]>[number]): ModelResponse {
    const content: ContentBlock[] = [];
    const message = choice.message;

    // 文本部分
    if (typeof message?.content === "string" && message.content.length > 0) {
      content.push({
        type: "text",
        text: message.content,
      });
    }

    // 工具调用部分
    for (const toolCall of message?.tool_calls ?? []) {
      if (toolCall.function?.name) {
        content.push({
          type: "tool_use",
          // 模型没返回 id 时，造一个兜底 id（保证后续 tool_result 能对得上）
          id: toolCall.id ?? `tool-call-${content.length + 1}`,
          name: toolCall.function.name,
          input: this.#parseToolArguments(toolCall.function.arguments ?? "{}"),
        });
      }
    }

    return {
      stopReason: this.#stopReason(choice.finish_reason, content),
      content,
    };
  }

  /**
   * OpenAI 的 finish_reason 取值和我们内部 StopReason 不完全一样，
   * 这里做映射。判断顺序：
   *   1. 如果响应里有任何 tool_use block，统一当 tool_use
   *   2. 否则按 finish_reason 字符串映射
   */
  #stopReason(reason: string | null | undefined, content: readonly ContentBlock[]): StopReason {
    if (content.some((block) => block.type === "tool_use") || reason === "tool_calls") {
      return "tool_use";
    }
    if (reason === "length") {
      return "max_tokens";
    }
    if (reason === "content_filter") {
      return "stop_sequence";
    }
    return "end_turn";
  }

  /**
   * OpenAI 把工具入参作为 JSON 字符串传来，要解析回对象。
   * 解析失败 / 解析出来不是对象时，兜底返回空对象，避免崩掉主循环。
   */
  #parseToolArguments(value: string): ToolInput {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as ToolInput;
      }
    } catch {
      return {};
    }
    return {};
  }
}


// ============================================================================
// 13. AgentLoop —— 主循环（s01 的核心）
// ============================================================================
//
// 这是整个 harness 的大脑。流程：
//
//   ┌─────────────────────────────────────────────────────────┐
//   │  1. 把当前 messages + tools 发给模型                     │
//   │  2. 拿到模型的 ModelResponse                             │
//   │  3. 触发 afterModelResponse hook                         │
//   │  4. 把 assistant 消息追加到 messages                     │
//   │  5. 如果 stopReason != "tool_use" → 返回，结束            │
//   │  6. 否则：                                                │
//   │       - 找到 content 里所有 tool_use block               │
//   │       - 对每个 tool_use：                                 │
//   │           a) 在 dispatch map 里查工具                     │
//   │           b) 跑权限策略                                   │
//   │           c) 触发 beforeToolUse hook                     │
//   │           d) 调用 handler 拿结果                          │
//   │           e) 触发 afterToolUse hook                      │
//   │       - 把所有 tool_result 作为 user 消息追加到 messages  │
//   │  7. 回到第 1 步                                           │
//   └─────────────────────────────────────────────────────────┘
//
// 安全兜底：maxIterations 限制最大轮数，防止模型陷入工具死循环。
// ============================================================================

export class AgentLoop {
  readonly #model: Model;
  // dispatch map：工具名 → 工具定义。Map 是 JS 内建哈希表。
  readonly #tools: Map<string, ToolDefinition>;
  readonly #permission: PermissionPolicy;
  readonly #hooks: Hooks;
  readonly #maxIterations: number;

  public constructor(options: AgentLoopOptions) {
    this.#model = options.model;
    // dispatch map 是 s02 的核心：模型只说工具名，harness 决定调用哪个 handler。
    //
    // options.tools.map((tool) => [tool.name, tool]) 把数组转成 [key, value] 对，
    // 再传给 new Map(...) 构造哈希表。后续用 this.#tools.get(name) 就能 O(1) 查到工具。
    this.#tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    // 用户没传权限策略时，给一个"全部允许"的默认策略。
    // satisfies PermissionPolicy 让 TS 检查这个对象字面量确实符合 PermissionPolicy 形状，
    // 但不改变它的推断类型。
    this.#permission =
      options.permission ??
      ({
        canUseTool: () => ({ allowed: true }),
      } satisfies PermissionPolicy);
    this.#hooks = options.hooks ?? {};
    this.#maxIterations = options.maxIterations ?? 25;
  }

  /**
   * 跑 agent 主循环，直到模型不再要求工具（或达到最大轮数）。
   *
   * @param initialMessages 初始对话历史（通常只有一条 user 消息）
   * @returns 完整对话历史 + 最终 stopReason
   */
  public async run(initialMessages: readonly Message[]): Promise<AgentRunResult> {
    // 复制一份，避免污染调用方传入的数组
    const messages: Message[] = [...initialMessages];
    // 把 dispatch map 转回数组形式，因为 Model.create 期望 readonly ToolDefinition[]
    const tools = [...this.#tools.values()];

    // 这是整个 harness 的主循环：问模型、记录响应、必要时执行工具、再问模型。
    for (let iteration = 0; iteration < this.#maxIterations; iteration += 1) {
      // 调用模型前先快照一份，供 hook 使用
      const messagesBefore = [...messages];
      const response = await this.#model.create(messages, tools);
      // 触发"模型刚响应完"的 hook（可观测性扩展点）
      // await hooks.xxx?.(...) 的含义见 Hooks 类型上方的注释
      await this.#hooks.afterModelResponse?.({
        iteration: iteration + 1,
        response,
        messagesBefore,
      });
      // 把 assistant 响应追加到对话历史
      messages.push({ role: "assistant", content: response.content });

      // 不是 tool_use 就表示模型本轮不再要求 harness 行动，直接把 transcript 返回。
      if (response.stopReason !== "tool_use") {
        return {
          stopReason: response.stopReason,
          messages,
        };
      }

      // 工具结果以 user 消息身份回填，这是 Anthropic/OpenAI 类工具协议的常见形态。
      const toolResults = await this.#runToolUses(response.content, messages);
      messages.push({ role: "user", content: toolResults });
    }

    // 跑满 maxIterations 还没结束：抛错兜底
    throw new MaxIterationsError(this.#maxIterations);
  }

  /**
   * 执行模型响应里的所有 tool_use block，返回所有 tool_result。
   *
   * 抽成私有方法是因为：run() 已经很长了，把"工具分发"这块独立出来更容易读。
   * 而且 # 开头让它在类外部完全不可见，避免被外部误用。
   */
  async #runToolUses(
    content: readonly ContentBlock[],
    messages: readonly Message[],
  ): Promise<ToolResultBlock[]> {
    const results: ToolResultBlock[] = [];

    // 一次模型响应里可以混有 text 和多个 tool_use；这里只执行 tool_use block。
    for (const block of content) {
      if (block.type !== "tool_use") {
        continue;
      }

      // 第一步：在 dispatch map 里查工具。查不到说明模型幻觉了不存在的工具。
      const tool = this.#tools.get(block.name);
      if (!tool) {
        throw new UnknownToolError(block.name);
      }

      // 第二步：权限检查必须发生在 handler 前，确保被拒绝的工具不会产生副作用。
      const decision = this.#permission.canUseTool(block, tool);
      if (!decision.allowed) {
        throw new PermissionDeniedError(block, decision.reason);
      }

      // 第三步：执行前 hook（审计/日志/调试输出常挂这里）
      const hookContext: ToolHookContext = {
        toolUse: block,
        tool,
        messages,
      };
      await this.#hooks.beforeToolUse?.(hookContext);

      // 第四步：handler 是唯一真正执行外部动作的位置，例如读文件、跑命令或调用 API。
      const content = await tool.handler(block.input, { messages });
      const result: ToolResultBlock = {
        type: "tool_result",
        toolUseId: block.id,
        content,
      };

      // 第五步：执行后 hook（拿到结果后做记录/统计）
      // { ...hookContext, result } 是展开语法：把 hookContext 的字段全部展开，
      // 再加一个 result 字段，组成 ToolResultHookContext。
      await this.#hooks.afterToolUse?.({
        ...hookContext,
        result,
      });
      results.push(result);
    }

    return results;
  }
}
