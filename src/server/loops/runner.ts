// 루프 실행기: 정의를 받아 스텝을 순차 실행하고 ledger에 기록, Genie 채팅에 결과를 알린다.
// 5중 안전장치: max_iterations 하드캡 / 예산 자동 일시정지 / no-progress 감지 / 3연속 실패 자동 일시정지 / done_condition 게이트 필수.
import { randomUUID } from "node:crypto";
import { getJob } from "../jobs.js";
import { getWorkerAgent } from "../../agent-registry.js";
import { getTask, createRoutineInstance, getOrCreateRoutineMaster, setTaskModel } from "../tasks.js";
import { getTodoById } from "../todos.js";
import { sendMessage, addGenieMessage } from "../chat.js";
import { appendRunStart, appendRun, loadState, saveState } from "./ledger.js";
import { checkPreRun, checkMidRun, sumRunCost, bumpRunsToday, bumpMonthSpend } from "./budget.js";
import { runUntilDone } from "./until-done.js";
import { resolveTier } from "../model-tiers.js";
import type { LoopDefinition, LoopExitReason, LoopRunRecord, LoopRunStepResult, LoopStep } from "./types.js";

const DRAFT_ONLY_NOTICE =
  "**[루프 정책] 외부 발신·전송·결제·삭제 금지. 모든 산출물은 초안으로만 저장.**";

function modelTierGuidance(tier?: LoopStep["model_tier"]): string {
  if (!tier) return "";
  const label = tier === "cheap" ? "저비용/경량" : tier === "frontier" ? "최고 성능" : "표준";
  // 실제 모델 고정(pinning)은 setTaskModel(instance.id, resolvedModel)로 처리됨(runTaskStep 참고).
  // 이 문구는 보조 컨텍스트 — 모델이 이미 고정된 상태에서 작업 강도를 안내.
  return `\n(모델 등급 가이드: ${label} — 이 등급에 맞는 노력 수준으로 작업하세요.)`;
}

function buildStepPrompt(def: LoopDefinition, step: LoopStep, iteration?: number): string {
  const lines: string[] = [];
  if (def.approval?.mode !== "auto") {
    lines.push(DRAFT_ONLY_NOTICE);
  }
  lines.push(step.prompt);
  const stateFiles = def.session?.state_files;
  if (stateFiles && stateFiles.length > 0) {
    lines.push(`\n이 파일들을 읽고 이어서 작업하세요. 끝나면 갱신하세요: ${stateFiles.join(", ")}`);
  }
  const tierGuidance = modelTierGuidance(step.model_tier);
  if (tierGuidance) lines.push(tierGuidance);
  if (iteration !== undefined) {
    lines.push(`\n(완료까지 반복 — ${iteration}번째 시도)`);
  }
  return lines.join("\n");
}

const TERMINAL_STATUSES = new Set(["completed", "outputs_missing", "failed"]);
const POLL_INTERVAL_MS = 5_000;

function findLatestJobIdForTask(taskId: string): string | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  for (let i = task.todoIds.length - 1; i >= 0; i--) {
    const todo = getTodoById(task.todoIds[i]);
    const jobId = todo?.relatedJobIds?.[todo.relatedJobIds.length - 1];
    if (jobId) return jobId;
  }
  return undefined;
}

/** 단순 task 스텝 1회 dispatch + 완료 대기 (scheduler.ts 루틴 마스터/인스턴스 + sendMessage 패턴 재사용). */
async function runTaskStep(
  def: LoopDefinition,
  step: LoopStep,
  startedAtMs: number,
): Promise<{ jobIds: string[]; exitReason: LoopExitReason; error?: string }> {
  const master = getOrCreateRoutineMaster(step.prompt, `loop:${def.id}:${step.id}`);
  const instance = createRoutineInstance(master.id, step.prompt);
  // model_tier 실제 고정: 인스턴스 task에 해석된 모델 ID를 저장 — DelegateTask 핸들러가
  // 호출자가 model을 명시하지 않았을 때 이 값을 job에 적용한다.
  const resolvedModel = resolveTier(step.model_tier);
  if (resolvedModel) setTaskModel(instance.id, resolvedModel);
  const prompt = buildStepPrompt(def, step);
  const requestWithMarker = `${prompt}\n\n<!-- ROUTINE_INSTANCE_TASK:${instance.id} -->`;

  // [로컬 패치 2026-07-16] step.agent가 지정된 스텝은 지니를 거치지 않고 직접 위임한다.
  // 지니 경유는 바쁨/마커 누락/재량 생략의 비결정성으로 "job이 생성되지 않음" 오탐의 근원이었다.
  let jobId: string | undefined;
  const directAgent = step.agent && step.agent !== "genie" ? getWorkerAgent(step.agent) : undefined;
  if (directAgent) {
    try {
      const port = process.env.PORT ?? "3456";
      const leaseSec = def.budget?.max_duration_minutes ? Math.min(def.budget.max_duration_minutes * 60, 3600) : undefined;
      const res = await fetch("http://127.0.0.1:" + port + "/api/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          request: step.prompt,
          agent: directAgent.id,
          planGate: false,
          taskId: instance.id,
          taskTitle: "[루프 " + def.id + "] " + step.id,
          ...(leaseSec ? { leaseSec, timeoutSec: Math.max(leaseSec - 300, 600) } : {}),
        }),
      });
      if (res.ok) {
        const ack = await res.json() as { jobId?: string };
        jobId = ack.jobId;
        console.log("[Loop:" + def.id + "] 직접 위임 → " + directAgent.id + " (job " + jobId + ")");
      } else {
        console.warn("[Loop:" + def.id + "] 직접 위임 실패(" + res.status + ") — 지니 경유 폴백");
      }
    } catch (err) {
      console.warn("[Loop:" + def.id + "] 직접 위임 오류 — 지니 경유 폴백:", err instanceof Error ? err.message : err);
    }
  }

  if (!jobId) try {
    await sendMessage(requestWithMarker, undefined, undefined, { internal: true, source: "loop:runner" });
  } catch (err) {
    if (!(err instanceof Error && (err.message === "genie_queued" || err.message === "genie_busy"))) {
      return { jobIds: [], exitReason: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }

  // [로컬 패치 2026-07-16] 12회(60초) → 60회(5분): 지니(Opus) 응답 턴이 60초를 넘으면
  // 위임(job) 생성 전에 창이 닫혀 "job이 생성되지 않음"으로 오탐 실패하던 문제 수정.
  for (let tries = 0; tries < 60 && !jobId; tries++) {
    jobId = findLatestJobIdForTask(instance.id);
    if (!jobId) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (!jobId) {
    return { jobIds: [], exitReason: "error", error: "job이 생성되지 않음" };
  }

  for (;;) {
    const job = getJob(jobId);
    if (!job) return { jobIds: [jobId], exitReason: "error", error: "job을 찾을 수 없음" };
    if (TERMINAL_STATUSES.has(job.status)) {
      if (job.status === "failed") {
        return { jobIds: [jobId], exitReason: "error", error: job.error || "job 실패" };
      }
      return { jobIds: [jobId], exitReason: "done" };
    }
    const midCheck = checkMidRun(def, sumRunCost([jobId]), startedAtMs);
    if (!midCheck.ok) {
      return { jobIds: [jobId], exitReason: "budget_exceeded", error: midCheck.reason };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function buildDeliveryMessage(def: LoopDefinition, record: LoopRunRecord): string {
  const lines: string[] = [];
  const statusLabel: Record<LoopExitReason, string> = {
    done: "완료",
    max_iterations: "최대 반복 횟수 도달",
    budget_exceeded: "예산 초과로 중단",
    no_progress: "진행 없음으로 중단",
    error: "오류로 중단",
    paused: "일시정지 상태",
    interrupted: "서버 재시작으로 중단됨",
  };
  lines.push(`🔁 루프 실행 결과: "${def.description || def.id}"`);
  lines.push(`- 결과: ${statusLabel[record.exitReason]}`);
  for (const s of record.steps) {
    const iterInfo = s.iterations ? ` (${s.iterations}회 반복)` : "";
    lines.push(`  - 스텝 ${s.stepId}${iterInfo}: job ${s.jobIds.length}건`);
  }
  lines.push(`- 비용: $${record.costUsd.toFixed(4)}`);
  if (record.error) lines.push(`- 상세: ${record.error}`);
  // delivery.on_success=full — 산출물 본문을 메시지에 그대로 포함한다.
  // (텔레그램·디스코드로도 같은 본문이 전달되므로 "폰에서 결과를 바로 읽는" 용도.)
  // 기본값 "summary"는 기존 동작 유지. 텔레그램 4096자 제한 고려해 스텝당 2500자로 자른다.
  if ((def.delivery?.on_success ?? "summary") === "full") {
    for (const st of record.steps) {
      for (const jobId of st.jobIds) {
        const out = getJob(jobId)?.fullResult;
        if (!out || !out.trim()) continue;
        const body = out.trim();
        lines.push("", body.length > 2500 ? body.slice(0, 2500) + "\n…(생략)" : body);
      }
    }
  } else {
  lines.push(`- 산출물은 각 스텝 job 결과를 참고하세요.`);
  }
  return lines.join("\n");
}

export async function runLoop(def: LoopDefinition, trigger: "cron" | "manual"): Promise<LoopRunRecord> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const state = loadState(def.id);

  const preCheck = checkPreRun(def, state);
  if (!preCheck.ok) {
    const record: LoopRunRecord = {
      runId,
      loopId: def.id,
      startedAt,
      endedAt: new Date().toISOString(),
      trigger,
      steps: [],
      costUsd: 0,
      exitReason: "paused",
      error: preCheck.reason,
    };
    appendRun(record);
    return record;
  }

  bumpRunsToday(state);
  saveState(def.id, state);
  appendRunStart(def.id, runId, trigger);

  const stepResults: LoopRunStepResult[] = [];
  let overallExit: LoopExitReason = "done";
  let overallError: string | undefined;

  for (const step of def.steps) {
    if (step.type === "until_done") {
      const result = await runUntilDone(def, step, {
        runId,
        startedAtMs,
        buildPrompt: (s, iteration) => buildStepPrompt(def, s, iteration),
        onBudgetCheck: (spentUsd) => !checkMidRun(def, spentUsd, startedAtMs).ok,
      });
      stepResults.push({ stepId: step.id, jobIds: result.jobIds, iterations: result.iterations, exitReason: result.exitReason });
      if (result.exitReason !== "done") {
        overallExit = result.exitReason;
        overallError = result.error;
        break;
      }
    } else {
      const result = await runTaskStep(def, step, startedAtMs);
      stepResults.push({ stepId: step.id, jobIds: result.jobIds, exitReason: result.exitReason });
      if (result.exitReason !== "done") {
        overallExit = result.exitReason;
        overallError = result.error;
        break;
      }
    }
  }

  const allJobIds = stepResults.flatMap((s) => s.jobIds);
  const costUsd = sumRunCost(allJobIds);

  const record: LoopRunRecord = {
    runId,
    loopId: def.id,
    startedAt,
    endedAt: new Date().toISOString(),
    trigger,
    steps: stepResults,
    costUsd,
    exitReason: overallExit,
    error: overallError,
  };
  appendRun(record);

  // 상태 갱신: 실패/성공 카운터 + 월간 비용 누적(자동 일시정지 트리거 가능)
  const freshState = loadState(def.id);
  if (overallExit === "error") {
    freshState.consecutiveFailures = (freshState.consecutiveFailures ?? 0) + 1;
    if (freshState.consecutiveFailures >= 3 && !freshState.paused) {
      freshState.paused = { reason: "consecutive_failures", at: new Date().toISOString() };
      addGenieMessage(`⏸️ 루프 "${def.description || def.id}"가 3회 연속 실패해 자동 일시정지되었습니다.`, { internal: false });
    }
  } else if (overallExit === "done") {
    freshState.consecutiveFailures = 0;
  }
  const autoPaused = bumpMonthSpend(def, freshState, costUsd);
  if (autoPaused) {
    addGenieMessage(`⏸️ 루프 "${def.description || def.id}"가 월간 예산 한도에 도달해 자동 일시정지되었습니다.`, { internal: false });
  }
  saveState(def.id, freshState);

  // 결과 전달
  const deliveryMode = def.delivery?.on_success ?? "summary";
  // 조용한 감시 루프 지원: 스텝 산출물에 [[QUIET]] 가 있으면(보고할 것 없음) 발송을 통째로 건너뛴다.
  const quiet = overallExit === "done" && record.steps.some((st) => st.jobIds.some((id) => (getJob(id)?.fullResult || "").includes("[[QUIET]]")));
  if (!quiet && (overallExit !== "done" || deliveryMode !== "silent")) {
    const deliveryMessage = buildDeliveryMessage(def, record);
    try {
      addGenieMessage(deliveryMessage);
    } catch (err) {
      console.error(`[LoopEngine] 결과 전달 메시지 실패(${def.id}):`, err);
    }
    // 텔레그램·디스코드 알림 (fire-and-forget) — chat.js와의 순환 import를 피하기 위해 동적 import 사용.
    // delivery.on_success: "silent"인 경우 위 if 조건에서 이미 제외되므로 두 채널 모두 자연히 스킵된다.
    import("../telegram.js")
      .then((m) => m.sendTelegramNoticeThrottled("loop-run", deliveryMessage))
      .catch(() => {});
    import("../discord.js")
      .then((m) => m.sendDiscordNoticeThrottled("loop-run", deliveryMessage))
      .catch(() => {});
  }

  return record;
}
