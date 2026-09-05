#!/usr/bin/env node
// agent-event-hook — 마이크루 PTY의 알바(Agent 도구) 시작·종료를 서버에 알린다 (UI "알바 작업 중" 표시).
//   PreToolUse(matcher Agent) → event=start / SubagentStop → event=stop
//   대상: MYCREW_APPROVAL_BASE + /api/genie/agent-event. fire-and-forget, 항상 exit 0.
async function main() {
  const base = process.env.MYCREW_APPROVAL_BASE;
  if (!base) return;
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let hook = {};
  try { hook = JSON.parse(raw); } catch { /* */ }
  const event = hook.hook_event_name === "SubagentStop" ? "stop" : "start";
  const agentId = typeof hook.tool_input?.subagent_type === "string" ? hook.tool_input.subagent_type : undefined;
  try {
    await fetch(`${base}/api/genie/agent-event`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, agentId }),
    });
  } catch { /* UI 표시용 — 실패 무시 */ }
}
main().finally(() => process.exit(0));
