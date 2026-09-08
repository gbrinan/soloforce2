import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";

const testHome = mkdtempSync(join(tmpdir(), "codex-runtime-test-"));
process.env.MYCREW_HOME = testHome;
const { codexEventError, resolveCodexWriteRoots } = await import("../src/adapters/codex-runtime.js");
const { PROJECT_SELF_DIR, MYCREW_HOME } = await import("../src/config.js");

// Given distinct code and data roots, history permissions must follow the data instance.
assert.notEqual(MYCREW_HOME, PROJECT_SELF_DIR, "Run with an isolated MYCREW_HOME");
assert.deepEqual(resolveCodexWriteRoots([
  "/history/outputs/training-designer/**", "/history/agents/training-designer/**", "/src/**",
]), [join(MYCREW_HOME, "history/outputs/training-designer"),
  join(MYCREW_HOME, "history/agents/training-designer"), join(PROJECT_SELF_DIR, "src")]);

// Given a provider error with no stderr, retain the actionable message.
assert.equal(codexEventError({ type: "error", message: "upgrade required" }), "upgrade required");
assert.equal(codexEventError({ type: "turn.failed", error: { message: "model unavailable" } }), "model unavailable");

// Given a failed MCP call followed by normal final prose, the task still failed.
assert.equal(codexEventError({ type: "item.completed", item: {
  type: "mcp_tool_call", server: "safefs", tool: "SafeWrite", status: "failed",
  error: { message: "approval denied" },
} }), "safefs.SafeWrite: approval denied");
assert.equal(codexEventError({ type: "item.completed", item: {
  type: "mcp_tool_call", server: "safefs", tool: "SafeWrite", status: "failed",
  result: { content: [{ type: "text", text: "DENIED: outside allow-list" }] },
} }), "safefs.SafeWrite: DENIED: outside allow-list");
assert.equal(codexEventError({ type: "item.completed", item: {
  type: "mcp_tool_call", server: "safefs", tool: "SafeWrite", status: "completed",
  result: { isError: true, content: [{ type: "text", text: "write failed" }] },
} }), "safefs.SafeWrite: write failed");
assert.equal(codexEventError({ type: "item.completed", item: { type: "agent_message", text: "done" } }), undefined);
assert.equal(codexEventError({ type: "item.completed", item: {
  type: "mcp_tool_call", status: "completed", result: { content: [] },
} }), undefined);
console.log("PASS: instance write roots, provider errors, MCP failures, successful events");
rmdirSync(testHome);
