// mcp-http-registry 계약 테스트 — docs/toolbox-concierge/plan.md Step 1
// T1 http 엔트리 / T2 ${ENV} 치환·미정의 fail-closed / T3 toolModes 분류 / T4 기존 mode-only 항목 불변
// 픽스처 주입(resolveFromRegistry)이라 history/ 파일·서버 불필요.
import {
  resolveFromRegistry, interpolateSecrets, globToRegexSource, toolModesFor,
  type McpServerDef,
} from "../src/server/mcp-registry.js";

let fail = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${!ok && detail ? " — " + detail : ""}`);
  if (!ok) fail++;
}

const env = { PLAYMCP_TOKEN: "tok_abc123" } as NodeJS.ProcessEnv;
const reg: Record<string, McpServerDef> = {
  playwright: { command: "npx", args: ["@playwright/mcp@latest", "--headless"], mode: "allow" },
  excel: { command: "npx", args: ["-y", "@negokaz/excel-mcp-server"] },
  PlayMCP: {
    type: "http", url: "https://example.invalid/mcp",
    headers: { Authorization: "Bearer ${PLAYMCP_TOKEN}" },
    toolModes: { allow: ["*-list*", "*-get*", "*-search*"] },
  },
  broken: { type: "http", url: "https://example.invalid/x", headers: { Authorization: "Bearer ${MISSING_TOKEN}" } },
};

// T1: http 엔트리
const r = resolveFromRegistry(reg, ["playwright", "excel", "PlayMCP", "broken"], env);
const pm = r.servers.PlayMCP as { type?: string; url?: string; headers?: Record<string, string> };
check("T1 http 엔트리 type/url", pm?.type === "http" && pm.url === "https://example.invalid/mcp");
check("T1 http 엔트리에 command 없음", !("command" in (pm ?? {})));

// T2: 시크릿 치환 / 미정의 fail-closed
check("T2 ${PLAYMCP_TOKEN} 치환", pm?.headers?.Authorization === "Bearer tok_abc123", JSON.stringify(pm?.headers));
check("T2 미정의 시크릿 서버는 spawn 제외", !("broken" in r.servers));
check("T2 errors에 사유 기록", r.errors.some((e) => e.includes("MISSING_TOKEN")), JSON.stringify(r.errors));
check("T2 제외된 서버는 훅 관할에도 없음", !r.approvalNames.includes("broken") && !r.allowNames.includes("broken"));
let threw = false;
try { interpolateSecrets({ a: "${NOPE}" }, "t", {} as NodeJS.ProcessEnv); } catch { threw = true; }
check("T2 interpolateSecrets 미정의 throw", threw);
check("T2 interpolateSecrets 플레이스홀더 없는 값 그대로", interpolateSecrets({ a: "plain" }, "t", env)?.a === "plain");

// T3: toolModes → 훅 관할 + 정규식
check("T3 toolModes 서버는 approvalNames(훅 관할)", r.approvalNames.includes("PlayMCP"));
check("T3 toolModes 서버는 allowNames 아님", !r.allowNames.includes("PlayMCP"));
const tm = r.toolModes.PlayMCP;
check("T3 toolModes default=approval", tm?.default === "approval");
const re = (s: string) => new RegExp(`^${s}$`);
check("T3 allow 패턴이 읽기 도구에 매칭", tm.allow.some((s) => re(s).test("talkcalendar-list_events")));
check("T3 allow 패턴이 발송 도구에 비매칭", !tm.allow.some((s) => re(s).test("kakaotalk-send_to_me")));
check("T3 glob 이스케이프", globToRegexSource("a.b*c?") === "a\\.b.*c.");
check("T3 toolModes 없는 서버는 undefined", toolModesFor(reg.excel) === undefined);

// T4: 기존 mode-only 항목 불변
const legacy = resolveFromRegistry({ playwright: reg.playwright, excel: reg.excel }, ["playwright", "excel"], env);
check("T4 allow 서버 → allowNames", legacy.allowNames.includes("playwright") && !legacy.approvalNames.includes("playwright"));
check("T4 mode 미지정 → approvalNames(기본 approval)", legacy.approvalNames.includes("excel"));
check("T4 stdio 엔트리에 command 존재", "command" in (legacy.servers.playwright as object));
check("T4 toolModes 맵 비어 있음", Object.keys(legacy.toolModes).length === 0);
check("T4 errors 없음", legacy.errors.length === 0);

// 훅 스크립트 존재 (Step 0 — approval 모드 fail-open 방지)
import { existsSync } from "node:fs";
for (const f of ["scripts/mcp-approval-hook.mjs", "scripts/stop-response-hook.mjs", "scripts/agent-event-hook.mjs"]) {
  check(`훅 존재: ${f}`, existsSync(f));
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
