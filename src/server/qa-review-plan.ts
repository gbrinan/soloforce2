import { z } from 'zod';
import { createJevQaClient, JevQaError } from './qa-jev.js';
import type { JevQaClient, JevQaContext, QaProfile } from './qa-jev.js';

const ConfigSchema = z.object({
  enabled: z.boolean(), apiKey: z.string(), model: z.string().min(1).max(100),
  timeoutMs: z.number().int().min(10).max(10000), minConfidence: z.number().min(0.5).max(1),
});
export type QaJevConfig = Readonly<z.infer<typeof ConfigSchema>>;
export type QaReviewSelection = {
  readonly profile: QaProfile; readonly reason: string; readonly elapsedMs: number;
  readonly model?: string; readonly confidence?: number; readonly inputTokens?: number; readonly outputTokens?: number;
};
export function qaJevConfig(env: NodeJS.ProcessEnv = process.env): QaJevConfig {
  return {
    enabled: env.QA_JEV_ENABLED === 'true', apiKey: env.TYPESAFE_API_KEY ?? '',
    model: env.QA_JEV_MODEL ?? 'jev-latest', timeoutMs: Number(env.QA_JEV_TIMEOUT_MS ?? 3000),
    minConfidence: Number(env.QA_JEV_MIN_CONFIDENCE ?? 0.85),
  };
}

export async function selectQaReview(
  input: JevQaContext & { readonly codeChanges: number | null },
  config: QaJevConfig = qaJevConfig(), client: JevQaClient = createJevQaClient(),
): Promise<QaReviewSelection> {
  const startedAt = Date.now();
  const fallback = (reason: string): QaReviewSelection => ({ profile: 'code', reason, elapsedMs: Date.now() - startedAt });
  if (input.codeChanges === null || input.codeChanges !== 0) return fallback('code-review-floor');
  if (!config.enabled) return fallback('disabled');
  const parsed = ConfigSchema.safeParse(config);
  if (!parsed.success) return fallback('invalid-config');
  if (!config.apiKey.trim()) return fallback('missing-key');
  if (!input.request.trim() || !input.report.trim()) return fallback('missing-context');
  if (input.request.length > 4000 || input.report.length > 12000) return fallback('context-too-large');
  try {
    const answer = await client({ request: input.request, report: input.report }, parsed.data);
    return { ...answer, profile: answer.confidence >= config.minConfidence ? answer.profile : 'code',
      reason: answer.confidence >= config.minConfidence ? 'jev-selected' : 'low-confidence', elapsedMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof JevQaError) return fallback(error.reason);
    throw error;
  }
}

const CHECKS = {
  code: ['typecheck', 'lint', 'unit-tests', 'smoke', 'regression'],
  document: ['requirements', 'sources', 'scope', 'contradictions'],
  data: ['source-data', 'recalculate', 'units-period', 'missing-duplicates'],
  general: ['requirements', 'observable-result', 'sources', 'limitations'],
} as const;
export function reviewChecks(profile: QaProfile): readonly string[] { return CHECKS[profile]; }

const INSTRUCTIONS = {
  code: '1. 대상 프로젝트 타입 체크를 실행하고 출력을 첨부한다.\n2. 가능한 린트를 실행한다.\n3. 관련 유닛 테스트를 실행한다.\n4. E2E/스모크를 실행하고 UI 변경 시 실제 화면 동작을 확인한다.\n5. 영향 파일과 빌드의 회귀를 확인한다.',
  document: '1. 산출물을 직접 열고 원본 요청의 요구사항별 충족 여부를 확인한다.\n2. 사실·인용을 원출처와 대조한다.\n3. 고객·프로젝트·유효일과 사용한 근거 판을 확인한다.\n4. 누락·모순·근거 없는 주장을 기록한다.',
  data: '1. 원본 데이터와 처리 범위를 확인한다.\n2. 합계·조인·비율을 독립적으로 재계산하고 계산 명령과 결과를 첨부한다.\n3. 단위·기간·분모를 확인한다.\n4. 누락·중복·미매칭과 주장한 원인의 근거를 확인한다.',
  general: '1. 원본 요청별 완료 근거를 확인한다.\n2. 산출물 또는 외부 처리 결과를 직접 조회한다. 검증 목적으로 발송·결제 등 부수 효과를 재실행하지 않는다.\n3. 사용한 근거와 현재 판을 대조한다.\n4. 확인할 수 없는 부분을 검증 불가로 기록한다.',
} satisfies Record<QaProfile, string>;

export function qaVerificationInstructions(profile: QaProfile): string {
  return `## 필수 검증 절차 (${profile})\n${INSTRUCTIONS[profile]}\n\n`
    + '## 판정 규칙\n모든 해당 검사를 수행하고 증거가 있어야 통과다. 일부 실행 불가면 이유와 함께 조건부 통과 또는 검증 불가로 남긴다. 하나라도 실패하면 거부한다.\n'
    + '보고 문구만으로 통과시키지 않는다. 실제 코드 변경을 발견하면 분류와 관계없이 코드 검사 5개를 모두 수행한다. QA 분류는 승인이나 안전성 보장이 아니다.\n'
    + '5단 QA 보고 필수 (검증 항목별 명령·대조 근거·결과 / 발견 문제 / 종합 판정).';
}
