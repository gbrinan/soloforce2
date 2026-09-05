#!/usr/bin/env node
// mcp-approval-hook — Claude Code PreToolUse 훅. approval 모드 MCP 도구 호출을 승인카드로 라우팅한다.
//
// 계약 (src/server/worker-pty.ts · terminal-ws.ts 가 등록):
//   stdin  : Claude Code PreToolUse JSON { tool_name, tool_input, ... }
//   env    : MYCREW_APPROVAL_BASE (서버 베이스 URL) · MYCREW_AGENT_ROLE · MYCREW_JOB_ID
//   stdout : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow"|"deny", ... } }
//   exit   : 0 = 위 JSON 결정을 따른다 / 2 = 차단(stderr 사유)
//
// ★ fail-closed: 서버 미응답·파싱 실패·타임아웃은 전부 deny(exit 2)다. exit 1은 Claude Code가
//   "훅 오류(비차단)"로 취급해 도구가 그대로 실행되므로 절대 exit 1로 끝내지 않는다.
//   (2026-09-05: 이 파일이 리포에 없던 동안 approval 모드가 통째로 fail-open이었다 —
//    docs/toolbox-concierge/findings.md Issue 2)

const POLL_MS = 1000;
const WAIT_MS = 65_000; // 훅 timeout(70s)보다 짧게 — 타임아웃은 deny로 귀결

function deny(reason) {
  process.stderr.write(`[mcp-approval-hook] deny: ${reason}\n`);
  process.exit(2);
}

function allow(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: reason },
  }));
  process.exit(0);
}

// tool_input을 승인카드 path 한 줄로 압축 — 값(본문·토큰)은 길이 제한, 키만 온전히.
function summarizeInput(input) {
  if (!input || typeof input !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(input)) {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${(s ?? "").slice(0, 80)}`);
    if (parts.length >= 6) break;
  }
  return parts.join(" ");
}

async function main() {
  const base = process.env.MYCREW_APPROVAL_BASE;
  if (!base) deny("MYCREW_APPROVAL_BASE 미설정");

  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let hook;
  try { hook = JSON.parse(raw); } catch { deny("stdin JSON 파싱 실패"); }

  const toolName = String(hook.tool_name ?? "");
  if (!toolName) deny("tool_name 없음");

  // 도구 단위 모드 (mcp-registry toolModes → MYCREW_MCP_TOOL_MODES JSON {server: {allow[], approval[], default}})
  // 읽기 도구는 승인카드 없이 즉시 통과, 명시 approval·기본 approval은 아래 승인 흐름.
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(toolName);
  if (m && process.env.MYCREW_MCP_TOOL_MODES) {
    let modes = {};
    try { modes = JSON.parse(process.env.MYCREW_MCP_TOOL_MODES); } catch { /* 형식 오류 → 서버 단위 approval */ }
    const srv = modes[m[1]];
    if (srv) {
      const bare = m[2];
      const hit = (list) => (list ?? []).some((re) => { try { return new RegExp(`^${re}$`).test(bare); } catch { return false; } });
      if (hit(srv.approval)) { /* 승인 흐름 */ }
      else if (hit(srv.allow) || srv.default === "allow") allow(`toolModes allow: ${bare}`);
    }
  }

  const body = {
    agentRole: process.env.MYCREW_AGENT_ROLE ?? "orchestrator",
    tool: toolName,
    path: summarizeInput(hook.tool_input) || toolName,
    jobId: process.env.MYCREW_JOB_ID || undefined,
    reason: typeof hook.tool_input?.reason === "string" ? hook.tool_input.reason : undefined,
  };

  let id;
  try {
    const res = await fetch(`${base}/api/approvals`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) deny(`승인 요청 생성 실패 HTTP ${res.status}`);
    ({ id } = await res.json());
  } catch (e) {
    deny(`승인 서버 연결 실패: ${e instanceof Error ? e.message : e}`);
  }
  if (!id) deny("승인 id 없음");

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const res = await fetch(`${base}/api/approvals/${id}/status`);
      if (!res.ok) continue;
      const st = await res.json();
      if (st.status === "allowed") allow(`승인됨 (${id.slice(0, 8)})`);
      if (st.status === "denied" || st.status === "timeout") deny(`${st.status} (${id.slice(0, 8)})`);
    } catch { /* 일시 장애 — 재시도 */ }
  }
  deny(`승인 대기 시간 초과 (${id.slice(0, 8)})`);
}

main().catch((e) => deny(`예외: ${e instanceof Error ? e.message : e}`));
