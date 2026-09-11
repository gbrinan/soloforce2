import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

if (!process.argv.includes("--live")) {
  throw new Error("This test makes four paid model calls. Run with --live and CODEX_PATH set to a current CLI.");
}
const root = process.cwd();
const runId = `training-smoke-${Date.now()}`;
const home = join(root, "history", "test-runs", runId);
process.env.MYCREW_HOME = home;
mkdirSync(join(home, "history"), { recursive: true });
writeFileSync(join(home, "history", "agents.json"), readFileSync("config/agents-default.json"));
const { getWorkerAgent, resolveWorkerRuntime, toAgentConfig } = await import("../dist/agent-registry.js");
const { codexCliAdapter } = await import("../dist/adapters/codex-cli.js");
const pipeline = JSON.parse(readFileSync("templates/training-pipeline.json", "utf8"));
assert.equal(pipeline.skipOutput, false);
assert.equal(pipeline.stages.length, 4);
assert.equal(pipeline.stageAgents.length, 4);
const relativeDir = "history/outputs/training-designer/smoke";
const outputDir = join(home, relativeDir);
mkdirSync(outputDir, { recursive: true });
const steps = [
  { files: ["brief.md"], task: "10분짜리 일반 AI 채팅 기반 합계 검산 실습을 brief.md 하나에 설계한다. 합성 데이터는 id,amount 컬럼과 A=10,B=20,C=30이다. 목표, 총 10분 시간표, 정답60, 환경제약을 간결하게 적는다. 전체 교안은 다음 단계가 작성한다." },
  { files: ["data.csv", "session.md"], task: "brief.md를 읽는다. 지정된 세 행을 data.csv(id,amount 헤더)에 쓰고, 그 데이터로 실습하는 session.md를 작성한다. 복사할 프롬프트, 입력, 정답60, 검산방법, 실패 복구를 간결히 포함한다." },
  { files: ["review.md", "review.json"], task: "brief.md, data.csv, session.md를 읽고 행별 amount 합과 시간·환경 적합성을 검토한다. review.md와 기계검사용 review.json을 작성한다. JSON 형식은 {status: PASS 또는 REVISE 또는 BLOCKED, total: 실제 합계, rows: 실제 데이터 행수}이다. 오류가 있으면 명시한다." },
  { files: ["handoff.md", "validation.json"], task: "앞 단계 파일과 review.md를 읽는다. 수정이 필요하면 반영하고, REVISE 판정이면 validation.md에 수정 내용과 재검토 필요 상태를 반드시 기록한다. handoff.md에 파일 연결과 남은 검증을 적고 validation.json에는 실제 확인한 {total: 합계, rows: 행수, reviewStatus: 검토판정}을 쓴다. 실제 실행하지 않은 학습자 환경을 검증했다고 하지 않는다." },
];
const evidence = { runId, outputDir, stages: [] };
let previous = "";
for (const [index, step] of steps.entries()) {
  const agent = getWorkerAgent(pipeline.stageAgents[index]);
  assert.ok(agent, "Stage agent must exist; fallback is forbidden in this test");
  const runtime = resolveWorkerRuntime(agent);
  assert.equal(runtime.model, index % 2 === 0 ? "gpt-6-astra" : "gpt-5.6-terra");
  const role = readFileSync(join(home, "history", "agents", agent.id, "wiki", "role-directive.md"), "utf8");
  const common = readFileSync(join(home, "history", "agents", "training-designer", "wiki", "role-directive.md"), "utf8");
  const prompt = `${role}\n${common}\n현재 단계: ${pipeline.stages[index]}\n소형 합성 테스트만 수행한다. 공동 폴더는 ${relativeDir} 이다. SafeFS 경로는 슬래시로 시작하지 않는 history/... 상대경로로 지정한다. 이 경로는 MYCREW_HOME 기준이다. 도구 발견이 필요하면 검색한다. 외부연동·설치·전송은 하지 않는다.\n${step.task}\n이전 단계 결과: ${previous.slice(0, 3000)}\n해당 파일을 실제 저장하고 경로를 보고한다.`;
  const result = await codexCliAdapter.execute(toAgentConfig(agent), `${runId}-${index}`, prompt, { cwd: root });
  const entry = { agent: agent.id, model: runtime.model, success: result.success, error: result.error ?? null, output: result.output, files: step.files };
  evidence.stages.push(entry);
  writeFileSync(join(outputDir, "smoke-evidence.json"), JSON.stringify(evidence, null, 2));
  assert.equal(result.success, true, result.error);
  for (const file of step.files) {
    const path = join(outputDir, file);
    assert.ok(existsSync(path), `Missing actual artifact: ${path}`);
    assert.ok(readFileSync(path, "utf8").trim().length > 0, `Empty artifact: ${file}`);
  }
  previous = result.output;
  console.log(`PASS stage ${index + 1}: ${agent.id}, artifacts ${step.files.join(", ")}`);
}
const csv = readFileSync(join(outputDir, "data.csv"), "utf8").trim().split(/\r?\n/);
assert.equal(csv.shift()?.replace(/^\uFEFF/, ""), "id,amount");
assert.equal(csv.length, 3);
assert.equal(csv.reduce((sum, row) => sum + Number(row.split(",")[1]), 0), 60);
const review = JSON.parse(readFileSync(join(outputDir, "review.json"), "utf8"));
assert.equal(review.total, 60);
assert.equal(review.rows, 3);
assert.ok(["PASS", "REVISE"].includes(review.status), "Blocked reviews must not pass the smoke test");
assert.deepEqual(JSON.parse(readFileSync(join(outputDir, "validation.json"), "utf8")), { total: 60, rows: 3, reviewStatus: review.status });
if (review.status === "REVISE") {
  assert.ok(readFileSync(join(outputDir, "validation.md"), "utf8").trim().length > 0, "Revisions require a validation record");
}
writeFileSync(join(outputDir, "smoke-evidence.json"), JSON.stringify({ ...evidence, checksPassed: true }, null, 2));
console.log(`PASS all four stages and artifact contents: ${outputDir}`);
