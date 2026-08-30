// route-golden — 마운트·정적 서빙 유실 회귀 감지 (과거: VAD 404, SSO 폴백 유실, /api/voice 재이식)
// 1) 정적 검사: 골든 라우트 문자열이 src/server 어딘가에 존재하는가 (커밋 시점, 서버 불필요)
// 2) 라이브 검사(옵션): ROUTE_GOLDEN_BASE가 설정되면 실제 GET으로 2xx/3xx/401/403 확인 (404·5xx = FAIL)
const { execSync } = require("child_process");
const fs = require("fs");
const g = JSON.parse(fs.readFileSync("config/route-golden.json", "utf8"));
let fail = 0;
for (const r of [...g.routes, ...g.staticAssets]) {
  let found = false;
  try {
    execSync(`grep -rq "${r.replace(/\/$/, "")}" src/server src/index.ts`, { stdio: "ignore" });
    found = true;
  } catch {}
  console.log(`${found ? "[PASS]" : "[FAIL]"} 정적: ${r} ${found ? "" : "— src/server에 마운트 문자열 없음(유실 의심)"}`);
  if (!found) fail++;
}
const base = process.env.ROUTE_GOLDEN_BASE; // 예: http://localhost:3456
if (base) {
  (async () => {
    for (const r of [...g.routes, ...g.staticAssets]) {
      try {
        const res = await fetch(base + r, { redirect: "manual" });
        const ok = res.status < 404;
        console.log(`${ok ? "[PASS]" : "[FAIL]"} 라이브: ${r} → ${res.status}`);
        if (!ok) fail++;
      } catch (e) { console.log(`[FAIL] 라이브: ${r} — ${e.message}`); fail++; }
    }
    process.exit(fail ? 1 : 0);
  })();
} else process.exit(fail ? 1 : 0);
