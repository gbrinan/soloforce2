// MCP 레지스트리 — 설치 가능한 MCP 서버 "정의"의 중앙 저장소.
// 설치 = 여기 항목 추가 / 할당 = 각 에이전트 config의 mcpServers에 이름 참조.
// (safefs는 시스템 기반 서버라 레지스트리에 없음 — spawn 코드가 항상 직접 포함)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { atomicWriteFileSync } from "./utils/atomic-write.js";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

export interface McpServerDef {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  // allow: allowedTools에 넣어 승인 없이 사용 / approval: PreToolUse 훅 → 승인카드 경유
  mode?: "allow" | "approval";
}

const REGISTRY_FILE = join(HISTORY_DIR, "mcp-registry.json");

// 최초 실행 시 현행 기본값(playwright)을 시드 — 기존 동작 보존
const DEFAULT_REGISTRY: Record<string, McpServerDef> = {
  // playwright는 E2E 브라우저 자동화 전용 — 호출 하나하나 승인받으면 E2E가 사실상 불가(승인 폭탄).
  // 내부 신뢰 워커(qa/dev-pm/planner)만 할당되므로 allow로 둬 승인 없이 사용.
  playwright: { command: "npx", args: ["@playwright/mcp@latest", "--headless"], mode: "allow" },
};

export function loadMcpRegistry(): Record<string, McpServerDef> {
  if (!existsSync(REGISTRY_FILE)) {
    try {
      if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
      writeFileSync(REGISTRY_FILE, JSON.stringify(DEFAULT_REGISTRY, null, 2), "utf-8");
      console.log("[McpRegistry] 기본 레지스트리 시드 (playwright)");
    } catch (e) { console.error("[McpRegistry] 시드 실패:", e); }
    return { ...DEFAULT_REGISTRY };
  }
  try {
    const parsed = JSON.parse(readFileSync(REGISTRY_FILE, "utf-8")) as Record<string, McpServerDef>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error("[McpRegistry] 로드 실패:", e);
    return {};
  }
}

export function getMcpServerDef(name: string): McpServerDef | undefined {
  return loadMcpRegistry()[name];
}

function saveMcpRegistry(reg: Record<string, McpServerDef>): void {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), "utf-8");
}

export function addMcpServer(name: string, def: McpServerDef): void {
  const reg = loadMcpRegistry();
  reg[name] = def;
  saveMcpRegistry(reg);
  console.log(`[McpRegistry] 설치: ${name} (mode=${def.mode ?? "approval"})`);
}

export function removeMcpServer(name: string): boolean {
  const reg = loadMcpRegistry();
  if (!(name in reg)) return false;
  delete reg[name];
  saveMcpRegistry(reg);
  console.log(`[McpRegistry] 제거: ${name}`);
  return true;
}

const AGENTS_FILE = join(HISTORY_DIR, "agents.json");
const GENIE_CONFIG_FILE = join(HISTORY_DIR, "genie-config.json");
const GENIE_IDS = new Set(["genie", "orchestrator"]);

// 에이전트 config의 mcpServers 목록을 수정(add=true 추가 / add=false 제거) + 해당 에이전트 재spawn.
async function editAssignment(agentId: string, serverName: string, add: boolean): Promise<{ ok: boolean; reason?: string }> {
  if (add && !getMcpServerDef(serverName)) return { ok: false, reason: `미설치 서버: ${serverName}` };
  const apply = (list: unknown): string[] => {
    const arr = Array.isArray(list) ? (list as string[]) : [];
    if (add) return arr.includes(serverName) ? arr : [...arr, serverName];
    return arr.filter((s) => s !== serverName);
  };
  try {
    if (GENIE_IDS.has(agentId)) {
      const cfg = JSON.parse(readFileSync(GENIE_CONFIG_FILE, "utf-8"));
      cfg.mcpServers = apply(cfg.mcpServers);
      writeFileSync(GENIE_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
      const tw = await import("./terminal-ws.js");
      void tw.ptyRespawnForReset();   // 새 config로 즉시 재spawn
    } else {
      const data = JSON.parse(readFileSync(AGENTS_FILE, "utf-8")) as { agents: Array<{ id: string; mcpServers?: string[] }> };
      const agent = data.agents.find((a) => a.id === agentId);
      if (!agent) return { ok: false, reason: `미존재 에이전트: ${agentId}` };
      agent.mcpServers = apply(agent.mcpServers);
      atomicWriteFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));
      const wp = await import("./worker-pty.js");
      wp.resetWorker(agentId);        // 종료 → 다음 위임 시 새 config로 재spawn
    }
    console.log(`[McpRegistry] ${add ? "할당" : "해제"}: ${serverName} ${add ? "→" : "✗"} ${agentId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export function assignMcpServer(agentId: string, serverName: string): Promise<{ ok: boolean; reason?: string }> {
  return editAssignment(agentId, serverName, true);
}

// 서버 mode 변경(allow/approval) + 요청 에이전트 재spawn — 승인카드 "항상 허용"이 호출.
export async function setMcpServerModeForAgent(serverName: string, mode: "allow" | "approval", agentId: string): Promise<{ ok: boolean; reason?: string }> {
  const reg = loadMcpRegistry();
  if (!reg[serverName]) return { ok: false, reason: `미설치 서버: ${serverName}` };
  reg[serverName].mode = mode;
  saveMcpRegistry(reg);
  console.log(`[McpRegistry] mode 변경: ${serverName} → ${mode} (요청: ${agentId})`);
  try {
    if (GENIE_IDS.has(agentId)) {
      const tw = await import("./terminal-ws.js");
      void tw.ptyRespawnForReset();
    } else {
      const wp = await import("./worker-pty.js");
      wp.resetWorker(agentId);
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true };
}
export function unassignMcpServer(agentId: string, serverName: string): Promise<{ ok: boolean; reason?: string }> {
  return editAssignment(agentId, serverName, false);
}

/**
 * 에이전트의 mcpServers 할당을 레지스트리 정의로 해석.
 * 반환: spawn --mcp-config에 넣을 서버 맵 + allow/approval 분류.
 */
export function resolveAgentMcpServers(assigned: string[] | undefined): {
  servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  allowNames: string[];     // mode=allow → allowedTools에 mcp__<name> 추가
  approvalNames: string[];  // mode=approval → PreToolUse 훅 매처 추가
} {
  const reg = loadMcpRegistry();
  const servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
  const allowNames: string[] = [];
  const approvalNames: string[] = [];
  for (const name of assigned ?? []) {
    const def = reg[name];
    if (!def) { console.warn(`[McpRegistry] 미정의 서버 할당 무시: ${name}`); continue; }
    servers[name] = { command: def.command, args: def.args, env: def.env };
    if (def.mode === "allow") allowNames.push(name);
    else approvalNames.push(name);  // 기본 approval (안전)
  }
  return { servers, allowNames, approvalNames };
}
