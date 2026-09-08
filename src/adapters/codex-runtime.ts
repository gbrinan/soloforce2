import { isAbsolute, join } from "node:path";
import { MYCREW_HOME, PROJECT_SELF_DIR } from "../config.js";

export function resolveCodexWriteRoots(paths: readonly string[]): string[] {
  return paths.map((path) => {
    const clean = path.replace(/\/?\*\*$/, "");
    if (isAbsolute(clean) && !clean.startsWith("/")) return clean;
    const relative = clean.replace(/^\//, "");
    const dataPath = ["history/outputs/", "history/agents/", "history/external/"]
      .some((prefix) => relative.startsWith(prefix));
    return join(dataPath ? MYCREW_HOME : PROJECT_SELF_DIR, relative);
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value)) : undefined;
}

export function codexEventError(event: Readonly<Record<string, unknown>>): string | undefined {
  if (event.type === "error" || event.type === "turn.failed") {
    const message = event.message ?? record(event.error)?.message ?? event.error;
    return typeof message === "string" ? message : "Codex turn failed";
  }
  const item = record(event.item);
  if (event.type !== "item.completed" || item?.type !== "mcp_tool_call") return undefined;
  const result = record(item.result);
  if (item.status !== "failed" && result?.isError !== true && result?.is_error !== true) return undefined;
  const message = record(item.error)?.message;
  const content: unknown[] = Array.isArray(result?.content) ? result.content : [];
  const details = content.map((entry) => record(entry)?.text).filter((text) => typeof text === "string").join("\n");
  return `${String(item.server ?? "MCP")}.${String(item.tool ?? "tool")}: ${typeof message === "string" ? message : details || "tool call failed"}`;
}
