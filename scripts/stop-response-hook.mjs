#!/usr/bin/env node
// stop-response-hook — Claude Code Stop 훅. 턴 종료 시 마지막 어시스턴트 메시지를 서버에 전달한다.
//
// 목적: submit_response MCP 툴이 누락·미해소돼도 awaiter가 busy에 갇히지 않도록 하는 안전망.
//   - 마이크루: MYCREW_STOP_SUBMIT_URL = /api/terminal/stop-finalize  (finalizeTerminalTurn)
//   - 워커   : MYCREW_STOP_SUBMIT_URL = /api/agent-response/<id>       (receiveWorkerResponse, 멱등)
//
// 계약: stdin = Stop JSON { last_assistant_message?, transcript_path?, stop_hook_active }.
//   - last_assistant_message가 없으면 transcript(JSONL)의 마지막 assistant 텍스트로 폴백.
//   - 절대 exit 2(턴 차단)로 끝내지 않는다. 실패는 stderr 한 줄 + exit 0.

import { readFileSync } from "node:fs";

function lastAssistantFromTranscript(path) {
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let rec;
      try { rec = JSON.parse(lines[i]); } catch { continue; }
      const msg = rec?.message ?? rec;
      if ((rec?.type ?? msg?.role) !== "assistant" && msg?.role !== "assistant") continue;
      const content = msg?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        const text = content.filter((c) => c?.type === "text").map((c) => c.text).join("\n").trim();
        if (text) return text;
      }
    }
  } catch { /* 폴백 실패 — 빈 문자열 */ }
  return "";
}

async function main() {
  const url = process.env.MYCREW_STOP_SUBMIT_URL;
  if (!url) return;
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let hook = {};
  try { hook = JSON.parse(raw); } catch { /* 빈 입력 허용 */ }

  let content = typeof hook.last_assistant_message === "string" ? hook.last_assistant_message : "";
  if (!content && typeof hook.transcript_path === "string") content = lastAssistantFromTranscript(hook.transcript_path);
  content = content.trim();
  // 서버 라우트는 빈 content를 400으로 거부(워커) 또는 no-op(터미널)한다 — 빈 값도 그대로 보낸다(터미널 finalize용).
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
  } catch (e) {
    process.stderr.write(`[stop-response-hook] 전달 실패: ${e instanceof Error ? e.message : e}\n`);
  }
}

main().finally(() => process.exit(0));
