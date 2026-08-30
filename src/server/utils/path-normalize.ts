// 파일명 정규화·산출물 실존 해석 공용 유틸 (2026-08-06 data-ingest 개선)
//
// 배경: 한글(비ASCII) 파일명은 저장 형태(NFC/NFD)가 조회 형태와 엇갈리면 existsSync가
// 실존 파일을 '없음'으로 오판한다(회고 3회 재발: M1·M2·주형이형). 정규화 로직이
// requirements-ingest.ts의 nfc()와 qa-auto-judge.ts의 resolveExistingArtifact에
// 중복 구현돼 있어 두 곳이 갈라질 위험이 있었다 — 여기로 단일화한다.
//
// 정본 교훈: history/genie/wiki/lessons_encoding_nfc_nfd.md
import { basename, dirname, join, isAbsolute, sep } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

/**
 * macOS NFD 파일명이 조합형(NFC)과 매칭되지 않는 문제를 막는다.
 * 저장·조회 경로는 비교 전에 반드시 이 함수로 형태를 맞춘다.
 */
export function nfc(s: string): string {
  return s.normalize("NFC");
}

/** 비교용 basename(NFC). */
export function basenameNFC(p: string): string {
  return basename(p).normalize("NFC");
}

/**
 * QA 핸드오프 «## 산출물 파일» 목록을 실존분만 남겨 표시 문자열로 만든다.
 *
 * 배경(2026-08-11, 잡 2c13109c): extractOutputFiles는 워커 로그에서 라벨로 경로를 뽑을 뿐
 * 실존을 검증하지 않는다. 잡 도중 만들었다가 **정직하게 삭제한 임시파일**이 다음 워커의
 * 지시서에 "산출물"로 광고됐고, 워커가 그것을 근거로 거짓 주장을 [HARD] 위키에 등재했다.
 *
 * ★ 조용히 지우지 않는다. 제외 사실을 문구로 남긴다 — 목록이 짧아진 이유를 다음 워커가
 *   알아야 "원래 없었다"로 오독하지 않는다.
 *
 * ★ 표시 전용이다. precheckArtifacts(FAIL 판정기)에는 절대 끼워넣지 말 것 —
 *   핸드오프 목록을 stat했다가 오탐 FAIL이 났던 전례가 있다(jobs.ts:2731-2734 주석).
 */
export function formatArtifactListForHandoff(paths: string[], baseDir: string): string {
  if (!paths.length) return "(없음)";
  const kept: string[] = [];
  let dropped = 0;
  for (const p of paths) {
    const fullPath = isAbsolute(p) ? p : join(baseDir, p);
    if (resolveExistingArtifact(fullPath, p, baseDir)) kept.push(p);
    else dropped++;
  }
  if (dropped === 0) return kept.join(", ");
  if (!kept.length) {
    return `(없음 — 보고된 ${paths.length}건 전부 잡 종료 시점에 실재하지 않음)`;
  }
  return `${kept.join(", ")}  (보고된 ${paths.length}건 중 ${dropped}건은 잡 종료 시점에 실재하지 않아 제외됨)`;
}

/**
 * QA 요청문 «판정 대상 고정» 절을 만든다 — 절대경로 + mtime 스탬프.
 *
 * 배경(2026-08-21, QA FAIL #1): QA가 planner-researcher의 **이전 회차** 산출물을 보고
 * 「png 언급 자체가 없음」·「45a9ad09 판독불가 주장」 2건을 FAIL로 냈다. 정본(재제출본)에는
 * 둘 다 기재돼 있었다 — 지적 2건 전부 stale. 총계(6/7)만 맞았고 누락 대상은 오지목이었다.
 *
 * 원인은 QA의 태만이 아니라 **요청문이 판정 대상을 특정하지 않은 것**이다.
 * formatArtifactListForHandoff는 상대경로만 나열하므로, 같은 주제의 구본이 다른 디렉터리에
 * 남아 있으면 어느 쪽을 열어도 지시 위반이 아니다. mtime을 박아 «이 파일이 최신본이다»를
 * 요청문 안에서 증명한다.
 *
 * ★ 표시 전용이다. formatArtifactListForHandoff와 마찬가지로 precheckArtifacts(FAIL 판정기)에
 *   끼워넣지 말 것 — 핸드오프 목록을 stat했다가 오탐 FAIL이 났던 전례가 있다.
 * ★ 실존분만 남긴다. 유령 산출물이 «판정 대상» 으로 승격되면 stale 판정보다 나쁘다.
 */
export function formatQaTargetsWithStamp(paths: string[], baseDir: string): string {
  if (!paths.length) return "(없음 — 산출물 없는 잡)";
  const lines: string[] = [];
  for (const p of paths) {
    const fullPath = isAbsolute(p) ? p : join(baseDir, p);
    const real = resolveExistingArtifact(fullPath, p, baseDir);
    if (!real) continue; // 유령 — 조용히 빼되 아래 계수 문구로 드러낸다
    let stamp = "mtime 조회 실패";
    try {
      const st = statSync(real);
      stamp = `mtime ${st.mtime.toISOString()} · ${st.size}B`;
    } catch {
      /* 경합으로 사라진 경우 — 위 문구 유지 */
    }
    lines.push(`- \`${real}\`  (${stamp})`);
  }
  if (!lines.length) {
    return `(없음 — 보고된 ${paths.length}건 전부 잡 종료 시점에 실재하지 않음)`;
  }
  const dropped = paths.length - lines.length;
  const note = dropped > 0 ? `\n(보고된 ${paths.length}건 중 ${dropped}건은 실재하지 않아 제외됨)` : "";
  return lines.join("\n") + note;
}

/** bare 파일명 광역 폴백이 훑는 산출물 루트 (baseDir 기준 상대). */
const BARE_SCAN_ROOTS = ["history", "agentTeam"];
/** BFS 깊이 상한. history/ 실측(2026-08-18) 최대 깊이 6·478디렉터리·83ms. */
const BARE_SCAN_MAX_DEPTH = 6;
/** 방문 디렉터리 상한 — 예기치 못한 트리 폭발에 대한 backstop. */
const BARE_SCAN_MAX_DIRS = 3000;
/** 스캔 제외 — 산출물이 없고 크기만 큰 디렉터리. */
const BARE_SCAN_SKIP = new Set(["node_modules", ".git", "dist", ".codex-homes"]);

/**
 * 디렉터리 없이 보고된 파일명(bare)을 산출물 루트 전역에서 찾는다.
 *
 * [2026-08-18 · 이 검증기의 2번째 경로 결함 — 1차(확장자 절단)와 원인이 다르다]
 *   구 구현은 폴백 대상을 `baseDir` + `history/outputs/<agent>/` **1레벨**로 하드코딩했다.
 *   ax-scout가 `history/ax/cases/`에 정상 생성한 카드를 보고서에 파일명만 적자
 *   (로그 원문: "수정된 파일: `case_현대차그룹-…_2026-08-18.md`, …")
 *   폴백이 그 디렉터리를 아예 보지 않아 '파일 미존재'로 오판 →
 *   [산출물 검증 실패 — 재제출 요구] 잡이 2회 재생성되고 워커가 같은 작업을 3회 반복했다.
 *   ★ 경로 파서(extractArtifactPaths)는 정상이었다. 결함은 폴백의 **스캔 집합**이다.
 *   산출물 루트가 늘 때마다 여기를 고치는 구조가 재발원이라, 목록이 아니라 트리를 훑는다.
 *
 * ★ 이 함수는 bare 보고에만 쓴다. 디렉터리를 명시한 보고는 호출부에서 그 디렉터리로
 *   스코프를 제한한다 — 타 폴더 동명 파일을 '존재'로 오판하지 않기 위한 안전장치이며,
 *   여기서 그 분기를 흡수하면 안 된다(회귀 테스트 B4가 이를 고정한다).
 *
 * ponytail: 이름이 같은 파일이 여러 디렉터리에 있으면 BFS 선착순으로 하나를 고른다.
 *   실 파일명 규약(에이전트 id + 타임스탬프 접미)상 충돌 확률이 낮아 감수한다.
 *   충돌이 실제로 문제가 되면 mtime 최신순 선택으로 승급하면 된다.
 */
function findBareArtifact(baseDir: string, targetBn: string): string | null {
  const queue: Array<[string, number]> = [[baseDir, BARE_SCAN_MAX_DEPTH]]; // baseDir 루트는 평면만
  for (const r of BARE_SCAN_ROOTS) queue.push([join(baseDir, r), 0]);

  let visited = 0;
  while (queue.length > 0 && visited < BARE_SCAN_MAX_DIRS) {
    const [dir, depth] = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 부재·권한 없음 → 건너뜀
    }
    visited++;
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth < BARE_SCAN_MAX_DEPTH && !BARE_SCAN_SKIP.has(e.name)) {
          queue.push([join(dir, e.name), depth + 1]);
        }
        continue;
      }
      if (e.name.normalize("NFC") === targetBn) {
        const full = join(dir, e.name);
        if (existsSync(full)) return full;
      }
    }
  }
  return null;
}

/**
 * 산출물 파일 실존 해석 (오탐 방지)
 * - 1차: 보고된 경로(원본 + NFC 정규화)로 existsSync
 * - 2차: 실패 시 basename을 NFC로 정규화해 후보 디렉터리에서 탐색
 *   · reportedPath에 디렉터리 스코프가 있으면(예: history/outputs/dev-pm/foo.md)
 *     → 그 디렉터리 하나만 스캔한다. 타 폴더의 동명 파일을 '존재'로 오판(false-positive)하지 않게.
 *   · reportedPath가 순수 파일명(bare)이면
 *     → baseDir 루트 + 산출물 루트(history/·agentTeam/) 하위를 깊이 제한 BFS로 광역 스캔
 *       (디렉터리 없이 보고한 오탐 구제).
 *
 * 스코프 제한은 이번 개선의 핵심 안전장치다: NFC/NFD 엇갈림은 '같은 폴더 안'에서만 구제하고,
 * 폴더가 다르면 진짜 미존재로 간주(FAIL 보존)한다.
 *
 * @param fullPath   해석된 절대/상대 후보 경로 (호출부가 baseDir 기준으로 join한 것)
 * @param reportedPath 워커가 보고한 원본 경로 (디렉터리 스코프 판정에 사용)
 * @param baseDir    상대경로·광역 폴백의 기준 디렉터리
 * @returns 실존하는 실제 경로, 없으면 null
 */
export function resolveExistingArtifact(
  fullPath: string,
  reportedPath: string,
  baseDir: string,
): string | null {
  // 1차: 직접 경로 (원본 + NFC 정규화 양쪽 시도)
  if (existsSync(fullPath)) return fullPath;
  const directNFC = fullPath.normalize("NFC");
  if (directNFC !== fullPath && existsSync(directNFC)) return directNFC;

  // 2차: basename NFC 비교 폴백 (평면 스캔만 — node_modules 재귀 회피)
  const targetBn = basenameNFC(reportedPath);

  // 스코프 판정: reportedPath에 디렉터리 성분이 있으면 폴백을 그 디렉터리로 제한한다.
  const reportedDir = dirname(reportedPath);
  const hasScope = reportedDir !== "." && reportedDir !== "" && reportedDir !== sep;
  const scopeAbs = hasScope
    ? (isAbsolute(reportedDir) ? reportedDir : join(baseDir, reportedDir))
    : null;

  // ★ 축퇴 스코프: 스코프가 baseDir 루트 자체면 '디렉터리를 안 적은 것'과 같다.
  //   산출물은 baseDir 루트에 두지 않는 규약이므로 여기서 스코프 제한을 걸 이유가 없고,
  //   걸면 bare 보고보다 오히려 좁아진다. 실사고(2026-08-18 재제출 2·3라운드)에서
  //   워커가 반려 통지에 실린 잘못된 루트 절대경로
  //   `C:\mycrew\mycrew-program\case_….md` 를 그대로 되받아 적자, 이 분기가 루트 1레벨만
  //   훑고 FAIL을 재생산해 오판이 스스로를 증폭시켰다. → bare와 동일 취급한다.
  const scopeIsBaseRoot = scopeAbs !== null && join(scopeAbs, ".") === join(baseDir, ".");

  let flatDirs: string[];
  if (hasScope && !scopeIsBaseRoot) {
    // 스코프 명시 → 보고된 디렉터리 하나만 (절대면 그대로, 상대면 baseDir 기준)
    flatDirs = [scopeAbs!];
  } else {
    // bare 파일명 → 광역 폴백. baseDir 루트를 먼저 보고, 없으면 산출물 루트 BFS.
    // (구 구현은 history/outputs/<agent>/ 1레벨만 봤다 — 결함 상세는 findBareArtifact 주석)
    return findBareArtifact(baseDir, targetBn);
  }

  for (const d of flatDirs) {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      if (n.normalize("NFC") === targetBn) {
        const full = join(d, n);
        if (existsSync(full)) return full;
      }
    }
  }
  return null;
}
