// QA «판정 대상 고정» 산출물 해석이 MYCREW_HOME(데이터 루트)까지 본다는 것을 고정한다.
//
// 재발 방지 대상 (2026-10-03, 잡 1a689a52):
//   baseDir = job.cwd ?? PROJECT_SELF_DIR (코드 루트) 인데 산출물은 MYCREW_HOME 아래에 있다.
//   두 루트가 다른 인스턴스에서는 상대경로 산출물이 전부 유령으로 판정되어 요청문의
//   «판정 대상»이 "(없음)"이 되고, QA가 피검체 부재로 «검증 불가»를 낸다.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataRoot = mkdtempSync(join(tmpdir(), "mycrew-home-"));
const codeRoot = mkdtempSync(join(tmpdir(), "code-root-"));
process.env.MYCREW_HOME = dataRoot; // ★ import 전에 설정해야 config.ts가 읽는다

const outDir = join(dataRoot, "history", "outputs", "ax-consultant");
mkdirSync(outDir, { recursive: true });
const rel = "history/outputs/ax-consultant/4주차_테스트_ax-consultant_2026-10-03_150236.md";
writeFileSync(join(dataRoot, rel), "# 피검체\n");

const { formatQaTargetsWithStamp, formatArtifactListForHandoff } = await import(
  "../src/server/utils/path-normalize.js"
);

let failed = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " — " + detail}`);
  if (!ok) failed++;
}

// T1: 데이터 루트에 있는 산출물이 코드 루트 baseDir로도 고정된다
const t1 = formatQaTargetsWithStamp([rel], codeRoot);
check("T1 데이터 루트 산출물이 판정 대상으로 고정됨", t1.includes(join(dataRoot, rel)), t1);

// T2: 핸드오프 목록에서도 실존으로 집계된다
const t2 = formatArtifactListForHandoff([rel], codeRoot);
check("T2 핸드오프 목록에 유지됨", t2 === rel, t2);

// T3 (음성 대조): 정말 없는 파일은 여전히 유령으로 걸러진다 — 베이스를 늘려 FAIL이 무력화되지 않았음
const ghost = "history/outputs/ax-consultant/존재하지않는파일_2026-10-03.md";
const t3 = formatQaTargetsWithStamp([ghost], codeRoot);
check("T3 유령 산출물은 여전히 제외", t3.startsWith("(없음 —"), t3);

// T4 (축 격리): mtime·크기 스탬프가 실제로 박힌다 (경로만 맞고 stat이 죽은 경우를 배제)
check("T4 mtime·크기 스탬프 포함", /mtime \d{4}-.*· \d+B/.test(t1), t1);

rmSync(dataRoot, { recursive: true, force: true });
rmSync(codeRoot, { recursive: true, force: true });

if (failed > 0) {
  console.error(`${failed}건 실패`);
  process.exit(1);
}
console.log("qa-artifact-base-test: 4건 통과");
