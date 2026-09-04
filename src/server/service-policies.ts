import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { emitGlobalEvent } from "./jobs.js";
import { CONNECTOR_MCP_SERVER, SERVICE_PROVIDER, SERVICE_TOOLS } from "./connectors/catalog.js";
import { ConnectorTokenStore } from "./connectors/token-store.js";
import { computeConnectorGates, toolPrefix, type ConnectorGates } from "./connectors/gates.js";
import { HISTORY_DIR } from "../config.js";

export type PolicyMode = "auto" | "approval";

export interface ServicePolicy {
  id: string;
  label: string;
  mcpServerId: string;
  category: string;
  connected: boolean;
  enabled: boolean;
  readPolicy: PolicyMode;
  writePolicy: PolicyMode;
  readTools: string[];
  writeTools: string[];
}

export interface ToolApprovalRequest {
  id: string;
  serviceId: string;
  serviceLabel: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  humanReadableDesc: string;
  requestedAt: number;
  timeoutMs: number;
}

export type ApprovalDecision = "approve" | "reject";

const POLICIES_FILE = resolve(".", "config", "service-policies.json");

// 도구 이름·서비스 매핑의 정본은 connectors/catalog.ts다 — 여기서는 참조만 한다.
// (2026-09-04 이전 이 배열은 mcpServerId를 "claude.ai Google_Drive"로 들고 있었다.
//  그런 MCP 서버는 존재한 적이 없어 getPolicyDisallowedTools의 차단 목록이 늘 공집합과
//  같았고, connected:true는 뒤에 아무 연결도 없는 표시뿐이었다. docs/connector-tools/findings.md 결함 1·2)
function connectorPolicy(
  id: keyof typeof SERVICE_TOOLS,
  label: string,
  category: string,
  writePolicy: PolicyMode,
): ServicePolicy {
  return {
    id, label, mcpServerId: CONNECTOR_MCP_SERVER, category,
    connected: false,   // 실제 연결 상태로 매 조회마다 덮어쓴다 (overlayConnectionState)
    enabled: true, readPolicy: "auto", writePolicy,
    readTools: [...SERVICE_TOOLS[id].read],
    writeTools: [...SERVICE_TOOLS[id].write],
  };
}

const DEFAULT_POLICIES: ServicePolicy[] = [
  connectorPolicy("google-drive", "Google Drive", "google", "approval"),
  connectorPolicy("google-calendar", "Google Calendar", "google", "approval"),
  connectorPolicy("gmail", "Gmail", "google", "approval"),
  connectorPolicy("notion", "Notion", "productivity", "approval"),
  {
    // 커넥터 미구현 — 표에는 남기되 연결됐다고 말하지 않는다.
    id: "slack", label: "Slack", mcpServerId: "",
    category: "communication", connected: false, enabled: false, readPolicy: "approval", writePolicy: "approval",
    readTools: [], writeTools: [],
  },
  {
    id: "asana", label: "Asana", mcpServerId: "",
    category: "productivity", connected: false, enabled: false, readPolicy: "approval", writePolicy: "approval",
    readTools: [], writeTools: [],
  },
];

// ── 정책 파일 읽기/쓰기 ──────────────────────────────────────────────────────

export function loadServicePolicies(): ServicePolicy[] {
  let stored: ServicePolicy[] = DEFAULT_POLICIES;
  try {
    if (existsSync(POLICIES_FILE)) {
      const raw = JSON.parse(readFileSync(POLICIES_FILE, "utf-8"));
      if (Array.isArray(raw.services)) stored = raw.services as ServicePolicy[];
    }
  } catch { /* 손상 파일 → 기본값 */ }
  return overlayConnectionState(stored.map(normalizeToCatalog));
}

/**
 * 디스크에 굳은 항목을 카탈로그로 재동기화한다.
 * 사람이 정한 것(enabled/readPolicy/writePolicy)은 지키고, 기계가 아는 것
 * (mcpServerId·도구 이름)은 카탈로그가 이긴다 — 이미 배포된 설치본의
 * "claude.ai Google_Drive" 같은 죽은 참조가 그대로 살아 있지 않게.
 */
function normalizeToCatalog(policy: ServicePolicy): ServicePolicy {
  const tools = SERVICE_TOOLS[policy.id as keyof typeof SERVICE_TOOLS];
  if (!tools) return policy;
  return {
    ...policy,
    mcpServerId: CONNECTOR_MCP_SERVER,
    readTools: [...tools.read],
    writeTools: [...tools.write],
  };
}

/**
 * connected 를 실제 커넥터 연결 상태로 덮는다.
 * 이 값은 파일에 저장되지 않는다 — 저장하면 다시 "표시만 되는 거짓말"이 된다.
 */
function overlayConnectionState(policies: ServicePolicy[]): ServicePolicy[] {
  let connectedProviders: Set<string>;
  try {
    connectedProviders = new Set(
      connectorStatus().filter((s) => s.state === "connected").map((s) => s.provider),
    );
  } catch {
    connectedProviders = new Set();   // 커넥터 계층이 죽어도 정책 조회는 살아야 한다
  }
  return policies.map((policy) => {
    const provider = SERVICE_PROVIDER[policy.id];
    return provider ? { ...policy, connected: connectedProviders.has(provider) } : policy;
  });
}

/** 커넥터 상태 조회 — 순환 import를 피하려 지연 로드한다. */
let statusFn: (() => Array<{ provider: string; state: string }>) | null = null;
function connectorStatus(): Array<{ provider: string; state: string }> {
  if (!statusFn) {
    const store = new ConnectorTokenStore({ historyDir: HISTORY_DIR });
    statusFn = () => store.status();
  }
  return statusFn();
}

export function getServicePolicy(id: string): ServicePolicy | undefined {
  return loadServicePolicies().find((p) => p.id === id);
}

export function updateServicePolicy(id: string, patch: Partial<ServicePolicy>): ServicePolicy {
  const policies = loadServicePolicies();
  const idx = policies.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`service policy not found: ${id}`);

  // 허용 필드만 patch — id/mcpServerId/readTools/writeTools 변경 불허
  const ALLOWED: Array<keyof ServicePolicy> = ["enabled", "readPolicy", "writePolicy"];
  const safe: Partial<ServicePolicy> = {};
  for (const key of ALLOWED) {
    if (key in patch) (safe as Record<string, unknown>)[key] = patch[key as keyof ServicePolicy];
  }

  const updated = { ...policies[idx], ...safe };
  policies[idx] = updated;

  try {
    mkdirSync(dirname(POLICIES_FILE), { recursive: true });
    const existing = existsSync(POLICIES_FILE)
      ? JSON.parse(readFileSync(POLICIES_FILE, "utf-8"))
      : { version: "1" };
    writeFileSync(POLICIES_FILE, JSON.stringify({ ...existing, services: policies }, null, 2), "utf-8");
  } catch { /* best-effort */ }

  return updated;
}

// ── 승인 대기 큐 ────────────────────────────────────────────────────────────

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof globalThis.setTimeout>;
}

const pendingApprovals = new Map<string, PendingApproval>();

export function requestApproval(
  serviceId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<ApprovalDecision> {
  const policy = getServicePolicy(serviceId);
  const serviceLabel = policy?.label ?? serviceId;
  const id = randomUUID();

  const request: ToolApprovalRequest = {
    id,
    serviceId,
    serviceLabel,
    toolName,
    toolInput,
    humanReadableDesc: buildHumanReadableDesc(serviceId, serviceLabel, toolName, toolInput),
    requestedAt: Date.now(),
    timeoutMs,
  };

  return new Promise<ApprovalDecision>((resolve) => {
    const timer = globalThis.setTimeout(() => {
      pendingApprovals.delete(id);
      emitGlobalEvent("tool-approval", { type: "timeout", requestId: id });
      resolve("reject");
    }, timeoutMs);

    pendingApprovals.set(id, { request, resolve, timer });
    emitGlobalEvent("tool-approval", { type: "request", ...request });
  });
}

export function resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingApprovals.delete(requestId);
  pending.resolve(decision);
  emitGlobalEvent("tool-approval", { type: "resolved", requestId, decision });
  return true;
}

// ── 정책 체크 (MCP 도구 호출 전 삽입 지점) ──────────────────────────────────

export async function checkToolPolicy(
  serviceId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ApprovalDecision> {
  const policy = getServicePolicy(serviceId);
  if (!policy || !policy.enabled) return "approve";

  const isWrite = policy.writeTools.includes(toolName);
  const mode = isWrite ? policy.writePolicy : policy.readPolicy;

  if (mode === "approval") {
    return requestApproval(serviceId, toolName, toolInput, 30_000);
  }
  return "approve";
}

// ── 정책 기반 차단 도구 목록 ─────────────────────────────────────────────────

export function getPolicyDisallowedTools(): string[] {
  const policies = loadServicePolicies();
  const result: string[] = [];
  for (const p of policies) {
    if (!p.mcpServerId) continue;
    const prefix = toolPrefix(p.mcpServerId);
    if (!p.enabled) {
      result.push(...p.readTools.map((t) => prefix + t));
      result.push(...p.writeTools.map((t) => prefix + t));
    } else {
      if (p.writePolicy === "approval") result.push(...p.writeTools.map((t) => prefix + t));
      if (p.readPolicy === "approval") result.push(...p.readTools.map((t) => prefix + t));
    }
  }
  return result;
}

// ── 설명 생성 헬퍼 ───────────────────────────────────────────────────────────

function buildHumanReadableDesc(
  serviceId: string,
  serviceLabel: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  const descriptions: Record<string, (input: Record<string, unknown>) => string> = {
    "slack_send_message": (i) => `Slack ${String(i.channel ?? "")} 채널에 메시지 전송`,
    "create_event": (i) => `Google Calendar에 이벤트 생성: "${String(i.summary ?? "")}"`,
    "create_file": (i) => `Google Drive에 파일 생성: "${String(i.name ?? "")}"`,
    "create_draft": (i) => `Gmail 임시 메일 작성: 수신자 ${String(i.to ?? "")}`,
    "notion-create-pages": (i) => `Notion 페이지 생성: "${String(i.title ?? "")}"`,
    "notion-update-page": (i) => `Notion 페이지 수정`,
  };
  const builder = descriptions[toolName];
  if (builder) return builder(toolInput);
  return `${serviceLabel} — ${toolName} 실행`;
}

// ── spawn 게이트 (지니·워커 PTY용) ───────────────────────────────────────────

/**
 * PTY spawn이 물어보는 것: 어떤 커넥터 도구를 승인 없이 열고, 어떤 것을 승인 훅에 걸고,
 * 어떤 서비스를 아예 노출하지 않을지.
 *
 * ★ 이 함수가 있어야 설정 화면의 정책이 인터랙티브 세션에 닿는다.
 * getPolicyDisallowedTools는 jobs.ts의 워커 잡 경로(src/agent.ts)에만 실리므로,
 * 지니 PTY(terminal-ws)와 워커 PTY(worker-pty)는 정책 밖에 있었다.
 * 규칙 본체는 connectors/gates.ts의 순수 함수다 (계약 테스트가 그쪽을 겨눈다).
 */
export function getConnectorToolGates(): ConnectorGates {
  return computeConnectorGates(loadServicePolicies());
}
