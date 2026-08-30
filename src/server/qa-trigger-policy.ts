// 자동 QA 발동 판정 — 순수 모듈.
//
// ★ 2026-08-24 배경: 「자동 QA를 조건부화하자」는 지시를 받았는데, 실측해 보니 **이미 조건부**였다
//   (jobs.ts: forceQa || looksLikeQaRequest || hasCodeChanges). 진짜 결함은 조건이 없는 게 아니라
//   **신호가 오염돼 있던 것**이다:
//     1) hasCodeChanges 가 `git status --porcelain` 으로 «레포 전체 워킹트리»를 봤다.
//        그 잡이 무엇을 바꿨는지와 무관하다. 이 레포에는 진단 스크립트 등 미추적 코드 파일이
//        상시 수십 개 널려 있어 사실상 **모든 잡에서 영구히 true** 였다.
//     2) looksLikeQaRequest 정규식이 `검증|테스트|점검|리뷰|verify` 라 한국어 지시서 거의 전부에 걸린다.
//   ⇒ 조건을 더 얹기 전에 신호부터 잡 범위로 좁혀야 한다. 그게 이 모듈이다.
//
// 설계 원칙(아난 승인 문구 그대로):
//   - 코드 변경이 있는 잡 → 전수 QA 유지. 여기가 실제로 결함이 나오는 곳이다. 줄이지 않는다.
//   - 코드 변경 0건 잡 → 전수 해제. 단 완전히 끄지 않고 주 1회 표본은 돌린다.
//   - 외부 발신이 있으면 코드 변경 0건이어도 전수 QA 유지(되돌릴 수 없다).
//   - 판정 불가능하면 안전한 쪽(= QA 수행)이 기본값이다.

/** 외부 발신 가능성이 상시 있는 에이전트. 여기 없어도 어휘·명시 플래그로 걸릴 수 있다. */
export const EXTERNAL_SEND_AGENTS = new Set<string>([
  "spf-sales", "spf-comms", "spf-logistics", 
  "book-keeper", "lead-keeper", "hermes",
]);

/**
 * 아웃바운드 어휘. 히트해도 «판정»이 아니라 «보수적으로 QA 를 켜는» 방향으로만 쓴다
 * — 오탐의 대가가 QA 1회이고, 미탐의 대가는 되돌릴 수 없는 발신이다.
 * (procedure_contract-gate-lexicon-denial-path: 어휘 히트를 FAIL 로 직결하지 않는다)
 */
// ⚠️ 2026-08-24 시정: 처음엔 `메일\s*보` 였는데 "메일**로** 보내라" 가 안 잡혔다(조사 하나에 뚫린다).
//    한국어 조사를 정규식으로 쫓지 말고 명사만 잡는다 — 오탐의 대가는 QA 1회뿐이다.
const OUTBOUND_RE = /발송|전송|발신|메일|텔레그램|카카오|카톡|디스코드|슬랙|게시|업로드|publish|\bsend\b|\bpost\b|notify/i;

export interface QaDecisionInput {
  /** 잡이 실제로 바꾼 코드 파일 수(= 종료 스냅샷 − 시작 스냅샷). 판정 불가면 null. */
  jobScopedCodeChanges: number | null;
  /** 호출자 명시 — 최우선. */
  forceQa?: boolean;
  skipQa?: boolean;
  /** QA 가 스폰한 잡(재귀 차단). */
  qaTriggered?: boolean;
  agentId: string | undefined;
  request: string;
  /** 이 에이전트의 마지막 «표본» QA 시각(ISO). 없으면 한 번도 안 돌린 것. */
  lastSampleAtIso?: string | null;
  /** 현재 시각(ISO) — 테스트 주입용. */
  nowIso: string;
  /** 표본 주기(일). 기본 7 = 주 1회. */
  sampleIntervalDays?: number;
}

export interface QaDecision {
  run: boolean;
  /** 왜 그렇게 판정했는가 — 잡 로그·원장에 그대로 남긴다. 「조용히 껐다」를 막는다. */
  reason: string;
  /** 이번 판정이 «표본» 자격으로 돌린 것인가(표본 시각 갱신 대상). */
  isSample: boolean;
}

export function externalSendSuspected(agentId: string | undefined, request: string): boolean {
  if (agentId && EXTERNAL_SEND_AGENTS.has(agentId)) return true;
  return OUTBOUND_RE.test(request || "");
}

export function decideQa(input: QaDecisionInput): QaDecision {
  // 0. 옵트아웃 — 새 조건보다 «항상» 세다.
  if (input.qaTriggered) return { run: false, reason: "qa-recursion-guard", isSample: false };
  if (input.skipQa) return { run: false, reason: "skipQa(호출자 명시)", isSample: false };
  if (!input.agentId || input.agentId === "qa" || input.agentId === "dev-pm") {
    return { run: false, reason: `agent-excluded(${input.agentId ?? "none"})`, isSample: false };
  }
  // 1. 명시 요청 — 최우선 발동.
  if (input.forceQa === true) return { run: true, reason: "forceQa(호출자 명시)", isSample: false };

  // 2. 코드 변경 — 여기가 결함이 나오는 곳. 줄이지 않는다.
  //    판정 불가(null)면 안전측으로 «수행».
  if (input.jobScopedCodeChanges === null) {
    return { run: true, reason: "code-change-undetermined(안전측 수행)", isSample: false };
  }
  if (input.jobScopedCodeChanges > 0) {
    return { run: true, reason: `code-change(${input.jobScopedCodeChanges}개 파일)`, isSample: false };
  }

  // 3. 코드 변경 0건 — 외부 발신이면 유지.
  if (externalSendSuspected(input.agentId, input.request)) {
    return { run: true, reason: "external-send-suspected(되돌릴 수 없음)", isSample: false };
  }

  // 4. 코드 변경 0건 + 외부 발신 없음 → 주 1회 표본만.
  const days = input.sampleIntervalDays ?? 7;
  const now = Date.parse(input.nowIso);
  const last = input.lastSampleAtIso ? Date.parse(input.lastSampleAtIso) : NaN;
  if (!Number.isFinite(last)) {
    return { run: true, reason: `sample(첫 표본 · 주기 ${days}일)`, isSample: true };
  }
  const elapsedDays = (now - last) / 86400000;
  if (elapsedDays >= days) {
    return { run: true, reason: `sample(마지막 표본 ${elapsedDays.toFixed(1)}일 전 · 주기 ${days}일)`, isSample: true };
  }
  return {
    run: false,
    reason: `no-code-change · no-external-send · 표본 주기 미도래(${elapsedDays.toFixed(1)}/${days}일)`,
    isSample: false,
  };
}

/**
 * 코드 파일 집합의 «잡 범위» 차집합. baseline 에 없던 항목만 이 잡이 만든 변경이다.
 * 문자열 배열만 받는다 — git 실행은 호출부(jobs.ts)에서 한다.
 */
export function newCodeChanges(baseline: string[] | undefined, current: string[]): string[] {
  const seen = new Set(baseline ?? []);
  return current.filter((p) => !seen.has(p));
}
