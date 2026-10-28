/**
 * ============================================================================
 * test/debug-model.test.ts —— isCliEntrypoint 行为测试
 * ============================================================================
 *
 * isCliEntrypoint 用来判断"当前模块是不是被 node 直接执行的入口"。
 * 这是 CLI 文件的常用技巧：让同一个文件既能 node xxx.js 直接跑、
 * 又能被别的代码 import 进来当库用（不会误触发 main()）。
 *
 * 工作原理：
 *   - import.meta.url  当前模块的 file:// URL
 *   - process.argv[1]  node 命令行传入的脚本路径
 *   - 两者相等 → 当前模块就是入口
 * ============================================================================
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { isCliEntrypoint } from "../src/debug-model.js";

/**
 * 匹配的情形：argv[1] 就是当前模块的路径。
 *
 * resolve("dist/src/debug-model.js") 把相对路径转成绝对路径。
 * pathToFileURL(entryPath).href 把文件路径转成 file:/// 形式的 URL。
 * 两者应该相等 → isCliEntrypoint 返回 true。
 */
test("isCliEntrypoint recognizes the script path that Node puts in argv[1]", () => {
  const entryPath = resolve("dist/src/debug-model.js");
  const moduleUrl = pathToFileURL(entryPath).href;

  assert.equal(isCliEntrypoint(moduleUrl, entryPath), true);
});

/**
 * 不匹配的情形：当前模块是 debug-model.js，但 node 启动的是别的脚本（other.js）。
 * 说明 debug-model 是被 import 进来的，不应执行 main()。
 */
test("isCliEntrypoint rejects different entry scripts", () => {
  const moduleUrl = pathToFileURL(resolve("dist/src/debug-model.js")).href;
  const otherEntryPath = resolve("dist/src/other.js");

  assert.equal(isCliEntrypoint(moduleUrl, otherEntryPath), false);
});
