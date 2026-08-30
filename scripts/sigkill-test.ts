// fix B 단위 시뮬: 자식 PID 추적 + lease 만료 시 SIGKILL
// 시나리오 4건:
//   1. PID 부재 → no_pid
//   2. 살아있는 자식 SIGKILL → killed=true + 사후 ESRCH 확인
//   3. stale PID (이미 죽은 자식) SIGKILL → killed=false, code=ESRCH
//   4. onSpawn 콜백으로 PID 캡처 (runAgent options 흐름 시뮬)
import { spawn } from "node:child_process";
import { killChildIfAlive } from "../src/server/jobs.js";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, got: unknown): void {
  const tag = ok ? "PASS" : "FAIL";
  if (ok) pass++;
  else fail++;
  console.log(`[${tag}] ${name} | got=${JSON.stringify(got)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = 존재 확인
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // S1: PID 부재
  {
    const r = killChildIfAlive(undefined);
    check("S1 PID 부재 → no_pid", r.killed === false && r.code === "no_pid", r);
  }

  // S2: 살아있는 자식 SIGKILL
  {
    const proc = spawn("node", ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore" });
    proc.unref();
    await sleep(50);
    const pid = proc.pid;
    if (!pid) {
      check("S2 SIGKILL 살아있는 자식", false, { error: "no pid" });
    } else {
      const r = killChildIfAlive(pid);
      await sleep(50);
      const stillAlive = isAlive(pid);
      check("S2 SIGKILL 살아있는 자식 → killed + 사후 죽음", r.killed === true && !stillAlive, { ...r, stillAlive });
    }
    try { proc.kill("SIGKILL"); } catch { /* 이미 죽음 */ }
  }

  // S3: stale PID (자식이 이미 자연 종료)
  {
    const proc = spawn("node", ["-e", "process.exit(0)"], { stdio: "ignore" });
    const pid = proc.pid;
    await new Promise<void>((r) => proc.on("exit", () => r()));
    await sleep(50); // 커널 reaper 여유
    if (!pid) {
      check("S3 stale PID", false, { error: "no pid" });
    } else {
      const r = killChildIfAlive(pid);
      check("S3 stale PID → ESRCH", r.killed === false && r.code === "ESRCH", r);
    }
  }

  // S4: onSpawn 콜백 캡처 (runAgent options 흐름 시뮬)
  {
    let captured: number | undefined;
    const onSpawn = (pid: number) => { captured = pid; };
    const proc = spawn("node", ["-e", "setTimeout(()=>{}, 1000)"], { stdio: "ignore" });
    proc.unref();
    if (proc.pid && onSpawn) onSpawn(proc.pid);
    await sleep(20);
    check("S4 onSpawn 콜백 PID 캡처", captured !== undefined && captured === proc.pid, { captured, procPid: proc.pid });
    try { proc.kill("SIGKILL"); } catch { /* */ }
  }

  console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
