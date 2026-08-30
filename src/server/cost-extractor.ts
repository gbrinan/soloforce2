// PTY 모드 비용 추출: claude jsonl 마지막 턴들에서 토큰을 누적해 비용 계산 후 cost-log 에 기록.
// chat 응답 path 에 영향 없게 setImmediate 백그라운드 호출 전제.

import { existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { computeMemoryDir } from "../mcp/memory-dir.js";
import { PROJECT_SELF_DIR } from "../config.js";
import { logCost } from "./jobs.js";

// 모델별 가격 ($ / 1M tokens). 참고용 누적이라 표준 티어 가격만.
// 누락된 모델은 fallback (Opus 4.7) 적용.
const PRICES: Record<string, { input: number; output: number; cache5m: number; cache1h: number; cacheRead: number }> = {
  // 2026-07-17: 현역 모델 추가 — 누락 시 폴백(Opus 단가)이 적용돼 sonnet-5 비용이 ~5배 과대 기록되고
  // 주간 비용 리포트·루프 예산 판단이 전부 오염된다. 신모델 도입 시 이 표 갱신 필수.
  "claude-opus-4-8":       { input: 15,  output: 75, cache5m: 18.75, cache1h: 30,    cacheRead: 1.50 },
  "claude-sonnet-5":       { input: 3,   output: 15, cache5m: 3.75,  cache1h: 6,     cacheRead: 0.30 },
  "claude-fable-5":        { input: 15,  output: 75, cache5m: 18.75, cache1h: 30,    cacheRead: 1.50 },
  "claude-opus-4-7":       { input: 15,  output: 75, cache5m: 18.75, cache1h: 30,    cacheRead: 1.50 },
  "claude-opus-4-6":       { input: 15,  output: 75, cache5m: 18.75, cache1h: 30,    cacheRead: 1.50 },
  "claude-sonnet-4-6":     { input: 3,   output: 15, cache5m: 3.75,  cache1h: 6,     cacheRead: 0.30 },
  "claude-haiku-4-5":      { input: 1,   output: 5,  cache5m: 1.25,  cache1h: 2,     cacheRead: 0.10 },
};
const FALLBACK_PRICE = PRICES["claude-opus-4-7"];

const TAIL_BYTES = 64 * 1024;

interface AsstUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cache5m: number;
  cache1h: number;
  cacheRead: number;
  model: string;
}

function readTail(path: string, bytes: number): string {
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const len = size - start;
  const buf = Buffer.alloc(len);
  const fd = openSync(path, "r");
  try { readSync(fd, buf, 0, len, start); } finally { closeSync(fd); }
  return buf.toString("utf-8");
}

// 마지막 "진짜 사용자 메시지" 이후의 assistant 턴들 usage 누적.
// (tool_result 인 user 엔트리는 사용자 입력이 아니라 도구 응답이므로 스킵)
function collectLatestPromptUsage(tail: string): AsstUsage | null {
  const lines = tail.split("\n").filter(l => l.trim());
  const usage: AsstUsage = {
    input: 0, output: 0, cacheCreate: 0, cache5m: 0, cache1h: 0, cacheRead: 0, model: "",
  };
  let any = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    let o: Record<string, unknown>;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    const m = (o.message ?? {}) as Record<string, unknown>;
    if (o.type === "user") {
      // tool_result 인 user 엔트리는 도구 응답 — 사용자 입력 아님, 계속 진행
      const content = m.content;
      const isToolResult = Array.isArray(content) && (content[0] as Record<string, unknown> | undefined)?.type === "tool_result";
      if (!isToolResult) break; // 진짜 사용자 입력 — 여기서 멈춤
      continue;
    }
    if (o.type !== "assistant") continue;
    const u = (m.usage ?? {}) as Record<string, unknown>;
    const cc = (u.cache_creation ?? {}) as Record<string, unknown>;
    usage.input        += Number(u.input_tokens) || 0;
    usage.output       += Number(u.output_tokens) || 0;
    usage.cacheCreate  += Number(u.cache_creation_input_tokens) || 0;
    usage.cache5m      += Number(cc.ephemeral_5m_input_tokens) || 0;
    usage.cache1h      += Number(cc.ephemeral_1h_input_tokens) || 0;
    usage.cacheRead    += Number(u.cache_read_input_tokens) || 0;
    if (!usage.model && typeof m.model === "string") usage.model = m.model;
    any = true;
  }
  return any ? usage : null;
}

function computeCostUsd(u: AsstUsage): number {
  const p = PRICES[u.model] ?? FALLBACK_PRICE;
  // cache_creation_input_tokens 가 5m+1h 합과 다를 수 있으면 breakdown 우선, 없으면 5m 가정
  const breakdownSum = u.cache5m + u.cache1h;
  const cache5mUsed = breakdownSum > 0 ? u.cache5m : u.cacheCreate;
  const cache1hUsed = breakdownSum > 0 ? u.cache1h : 0;
  const usd =
    (u.input      * p.input      +
     u.output     * p.output     +
     cache5mUsed  * p.cache5m    +
     cache1hUsed  * p.cache1h    +
     u.cacheRead  * p.cacheRead) / 1_000_000;
  return usd;
}

/**
 * PTY 에이전트(마이크루·인터랙티브 워커)의 비용을 세션 jsonl에서 추출해 cost-log에 기록.
 * setImmediate/setTimeout 백그라운드 호출 전제 (응답 path 영향 X).
 */
export function extractAndLogCost(agentId: string, sessionId: string, durationMs: number): void {
  try {
    const dir = computeMemoryDir(PROJECT_SELF_DIR);
    const path = join(dir, `${sessionId}.jsonl`);
    if (!existsSync(path)) return;
    const tail = readTail(path, TAIL_BYTES);
    const u = collectLatestPromptUsage(tail);
    if (!u) return;
    logCost(agentId, undefined, {
      costUsd:           computeCostUsd(u),
      inputTokens:       u.input,
      outputTokens:      u.output,
      cacheCreateTokens: u.cacheCreate,
      cacheReadTokens:   u.cacheRead,
      durationMs,
    });
  } catch (e) {
    console.error(`[Cost] ${agentId} 비용 추출 실패:`, e instanceof Error ? e.message : e);
  }
}

export function extractAndLogGenieCost(sessionId: string, durationMs: number): void {
  extractAndLogCost("genie", sessionId, durationMs);
}
