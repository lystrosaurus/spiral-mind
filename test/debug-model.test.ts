import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { isCliEntrypoint } from "../src/debug-model.js";

test("isCliEntrypoint recognizes the script path that Node puts in argv[1]", () => {
  const entryPath = resolve("dist/src/debug-model.js");
  const moduleUrl = pathToFileURL(entryPath).href;

  assert.equal(isCliEntrypoint(moduleUrl, entryPath), true);
});

test("isCliEntrypoint rejects different entry scripts", () => {
  const moduleUrl = pathToFileURL(resolve("dist/src/debug-model.js")).href;
  const otherEntryPath = resolve("dist/src/other.js");

  assert.equal(isCliEntrypoint(moduleUrl, otherEntryPath), false);
});
