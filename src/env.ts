/**
 * ============================================================================
 * src/env.ts —— 极简 .env 文件加载器
 * ============================================================================
 *
 * 这个模块做三件小事：
 *   1. parseDotEnv    把 .env 文件文本解析成 key-value 对象
 *   2. applyDotEnv    把解析结果合并到目标环境对象（通常是 process.env）
 *   3. loadDotEnvFile 读取 .env 文件并完成 1+2，文件不存在时静默跳过
 *
 * 为什么不直接用 dotenv 库？教学项目希望自己写一个最小版本，看清楚原理：
//   KEY=VALUE
//   # 注释会被忽略
//   空行会被忽略
//   KEY="带引号的值" 或 KEY='带引号的值' 会自动去引号
 *
 * 实际项目里推荐用成熟的 dotenv 包，这里仅供学习。
 * ============================================================================
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

/** key-value 形式的环境变量集合（值一定是字符串） */
export type EnvMap = Record<string, string>;

/**
 * 可写的环境变量集合。
 *
 * process.env 的类型就是这个形状：键是字符串，值要么是字符串要么是 undefined
 * （读取一个不存在的环境变量时得到 undefined）。
 */
export type MutableEnv = Record<string, string | undefined>;

/**
 * applyDotEnv 的可选配置。
 *
 * override 默认 true：.env 里的值会覆盖 process.env 已有值。
 * 如果想"process.env 优先、.env 兜底"，传 { override: false }。
 */
export type ApplyDotEnvOptions = {
  readonly override?: boolean | undefined;
};

/**
 * 把 .env 文件内容解析成 EnvMap。
 *
 * 规则（保持简单）：
 *   - 空行和以 # 开头的行被忽略
 *   - 行内必须包含 =，否则被忽略
 *   - key 必须符合标识符规则（字母/下划线开头，后续可跟数字）
 *   - value 两端的成对引号（"..." 或 '...'）会被去掉
 *
 * @param source .env 文件的原始文本
 */
export function parseDotEnv(source: string): EnvMap {
  const env: EnvMap = {};

  // /\r?\n/ 是正则：同时兼容 Unix(\n) 和 Windows(\r\n) 换行
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    // 空行、注释行跳过
    if (!line || line.startsWith("#")) {
      continue;
    }

    // 找第一个 = 的位置；找不到说明不是合法的 KEY=VALUE，跳过
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    // 校验 key 是否合法（字母或下划线开头，后续可跟字母数字下划线）
    // 不合法的 key（比如 "1ABC"、"MY-KEY"）直接忽略
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    env[key] = unquote(rawValue);
  }

  return env;
}

/**
 * 把 values 里的键值对写入 target。
 *
 * @param values  解析 .env 得到的键值对
 * @param target  目标环境对象（通常是 process.env）
 * @param options 可选项；override=false 时已有键不会被覆盖
 */
export function applyDotEnv(
  values: EnvMap,
  target: MutableEnv,
  options: ApplyDotEnvOptions = {},
): void {
  // ?? true：调用方没传 override 时默认 true（覆盖模式）
  const override = options.override ?? true;

  // Object.entries 把对象转成 [key, value] 数组，方便 for...of 遍历
  for (const [key, value] of Object.entries(values)) {
    // 覆盖模式：直接写
    // 非覆盖模式：只有当 target 里这个 key 不存在（undefined）时才写
    if (override || target[key] === undefined) {
      target[key] = value;
    }
  }
}

/**
 * 从 startDirectory 开始逐级向上查找 .env，返回第一个命中的绝对路径。
 *
 * 为什么要向上找，而不是只认 process.cwd()？
 * 因为 cwd 会随启动方式变化：
 *   - 在终端里 `npm run debug:model` → cwd 是工程根目录
 *   - 在 IDEA 里点 Debug 运行 Node.js 配置 → cwd 常常是脚本所在目录
 *     （例如 dist/src），此时相对路径 ".env" 就找不到工程根目录的 .env，
 *     而 loadDotEnvFile 对"文件不存在"是静默跳过的，表现就是"配置没生效"。
 *
 * 向上查找后，无论从工程根目录还是 dist/src 启动，都能定位到同一份 .env。
 *
 * @param startDirectory 起始目录，默认 process.cwd()
 * @returns .env 的绝对路径；一路到盘符根都没有则返回 undefined
 */
export function findDotEnvFile(startDirectory: string = process.cwd()): string | undefined {
  // resolve 把相对路径补成绝对路径，避免 dirname 循环时路径形态不一致
  let currentDirectory = resolve(startDirectory);
  // parse("C:\\AI\\spiral-mind").root 是 "C:\\"；Linux 下是 "/"
  const { root } = parse(currentDirectory);

  for (;;) {
    const candidate = join(currentDirectory, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }

    // 到达盘符根目录仍然没找到，说明整条路径上都没有 .env
    if (currentDirectory === root) {
      return undefined;
    }

    currentDirectory = dirname(currentDirectory);
  }
}

/**
 * 读取 .env 文件并合并到 process.env。
 *
 * 文件不存在（ENOENT）时静默返回，不抛错——这是 dotenv 类工具的常见约定：
 * 在生产环境里通常不需要 .env（环境变量由部署平台直接注入），
 * 所以"没有 .env"不算错误。
 *
 * @param path    .env 文件路径，默认当前目录下的 .env
 * @param target  要写入的环境对象，默认 process.env
 * @param options 同 applyDotEnv
 */
export async function loadDotEnvFile(
  path = ".env",
  target: MutableEnv = process.env,
  options?: ApplyDotEnvOptions,
): Promise<void> {
  try {
    const source = await readFile(path, "utf8");
    applyDotEnv(parseDotEnv(source), target, options);
  } catch (error: unknown) {
    // catch 到的 error 类型是 unknown（TS 的严格默认），
    // 用 isMissingFileError 做一下运行时收窄
    if (isMissingFileError(error)) {
      return;
    }
    // 其他错误（权限不够、磁盘错误等）继续抛出
    throw error;
  }
}

/**
 * 去掉 value 两端的成对引号。没引号则原样返回。
 *
 * value.at(0) 和 value.at(-1) 是 ES2022 的新方法：
 *   .at(0)  取首字符
 *   .at(-1) 取末字符（负数从后往前数）
 */
function unquote(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    // slice(1, -1) 去掉首尾各一个字符
    return value.slice(1, -1);
  }
  return value;
}

/**
 * 判断 catch 到的错误是不是"文件不存在"（Node 的 ENOENT 错误码）。
 *
 * error as { code?: unknown } 是类型断言：告诉编译器"先把它当成
 * 一个可能有 code 字段的对象"。运行时我们确实会先判断 error 是不是
 * 对象、是否有 code 字段，所以这个断言是安全的。
 */
function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
