// 예산/한도 체크: 실행 전(사전) / 실행 도중(중간) 게이트.
// 5중 안전장치 중 하나 — max_runs_per_day, monthly_cap_usd, max_cost_usd_per_run, max_duration_minutes.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR, getTodayKST } from "../../config.js";
import type { LoopBudget, LoopDefinition, LoopState } from "./types.js";

const COST_LOG_FILE = join(HISTORY_DIR, "cost-log.jsonl");

interface CostLogEntry {
  timestamp: string;
  agentId: string;
  jobId?: string | null;
  costUsd: number;
}

function currentMonthKey(): string {
  // getTodayKST()는 YYYY-MM-DD 형식 — 앞 7자리(YYYY-MM)만 사용
  return getTodayKST().slice(0, 7);
}

export function checkPreRun(def: LoopDefinition, state: LoopState): { ok: boolean; reason?: string } {
  if (state.paused) {
    return { ok: false, reason: `일시정지 상태 (${state.paused.reason}, ${state.paused.at})` };
  }

  const budget: LoopBudget = def.budget ?? {};
  const today = getTodayKST();

  if (budget.max_runs_per_day !== undefined) {
    const runsToday = state.runsToday?.date === today ? state.runsToday.count : 0;
    if (runsToday >= budget.max_runs_per_day) {
      return { ok: false, reason: `오늘 실행 횟수 한도 초과 (${runsToday}/${budget.max_runs_per_day})` };
    }
  }

  if (budget.monthly_cap_usd !== undefined) {
    const month = currentMonthKey();
    const spent = state.monthSpend?.month === month ? state.monthSpend.usd : 0;
    if (spent >= budget.monthly_cap_usd) {
      return { ok: false, reason: `월간 예산 한도 초과 ($${spent.toFixed(2)}/$${budget.monthly_cap_usd})` };
    }
  }

  return { ok: true };
}

/** cost-log.jsonl 전체를 읽어 주어진 jobIds에 해당하는 costUsd 합산. v1은 전체 라인 스캔 허용. */
export function sumRunCost(jobIds: string[]): number {
  if (jobIds.length === 0) return 0;
  if (!existsSync(COST_LOG_FILE)) return 0;
  const targetIds = new Set(jobIds);
  let total = 0;
  try {
    const lines = readFileSync(COST_LOG_FILE, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as CostLogEntry;
        if (entry.jobId && targetIds.has(entry.jobId)) {
          total += Number(entry.costUsd) || 0;
        }
      } catch {
        // 손상된 라인 skip
      }
    }
  } catch (err) {
    console.error("[LoopEngine] cost-log.jsonl 읽기 실패:", err);
  }
  return total;
}

export function checkMidRun(
  def: LoopDefinition,
  spentUsd: number,
  startedAtMs: number,
): { ok: boolean; reason?: string } {
  const budget: LoopBudget = def.budget ?? {};

  if (budget.max_cost_usd_per_run !== undefined && spentUsd >= budget.max_cost_usd_per_run) {
    return { ok: false, reason: `실행당 비용 한도 초과 ($${spentUsd.toFixed(2)}/$${budget.max_cost_usd_per_run})` };
  }

  if (budget.max_duration_minutes !== undefined) {
    const elapsedMin = (Date.now() - startedAtMs) / 60_000;
    if (elapsedMin >= budget.max_duration_minutes) {
      return { ok: false, reason: `실행 시간 한도 초과 (${elapsedMin.toFixed(1)}분/${budget.max_duration_minutes}분)` };
    }
  }

  return { ok: true };
}

/** runsToday 카운터 증가 (실행 시작 시 호출). */
export function bumpRunsToday(state: LoopState): void {
  const today = getTodayKST();
  if (state.runsToday?.date === today) {
    state.runsToday.count += 1;
  } else {
    state.runsToday = { date: today, count: 1 };
  }
}

/** 월간 누적 비용 증가 (실행 종료 시 호출). 월간 한도 도달 시 자동 일시정지. */
export function bumpMonthSpend(def: LoopDefinition, state: LoopState, addedUsd: number): boolean {
  const month = currentMonthKey();
  if (state.monthSpend?.month === month) {
    state.monthSpend.usd += addedUsd;
  } else {
    state.monthSpend = { month, usd: addedUsd };
  }
  const cap = def.budget?.monthly_cap_usd;
  if (cap !== undefined && state.monthSpend.usd >= cap && !state.paused) {
    state.paused = { reason: "budget", at: new Date().toISOString() };
    return true; // 자동 일시정지 발생
  }
  return false;
}
