// 서비스 정책 → spawn 게이트 변환 (순수 함수).
//
// service-policies.ts에 두지 않는 이유: 그 모듈은 jobs.ts(→ node-pty 네이티브)를 끌고 와서
// 계약 테스트가 실행 환경에 묶인다. 규칙 자체는 정책 배열만 있으면 결정되므로 여기 둔다.

import { CONNECTOR_MCP_SERVER } from "./catalog.js";

export interface ConnectorGateInput {
  readonly id: string;
  readonly mcpServerId: string;
  readonly connected: boolean;
  readonly enabled: boolean;
  readonly readPolicy: "auto" | "approval";
  readonly writePolicy: "auto" | "approval";
  readonly readTools: readonly string[];
  readonly writeTools: readonly string[];
}

export interface ConnectorGates {
  /** 노출할 서비스 id — MCP 자식이 이 목록의 도구만 등록한다. */
  services: string[];
  /** 승인 없이 허용할 도구 전체 이름 (`mcp__connectors__<도구>`). */
  allowedTools: string[];
  /** PreToolUse 승인 훅 매처에 넣을 짧은 도구 이름. */
  approvalTools: string[];
}

/**
 * MCP 도구 전체 이름 접두사. Claude CLI는 서버 이름의 비영숫자를 전부 `_`로 눌러
 * `mcp__<서버>__<도구>` 를 만든다 — 점·공백만 바꾸던 옛 규칙은 그 외 문자에서 어긋났다.
 */
export function toolPrefix(mcpServerId: string): string {
  return `mcp__${mcpServerId.replace(/[^A-Za-z0-9_]/g, "_")}__`;
}

/**
 * 노출·허용·승인 3분류.
 * 연결되지 않았거나 꺼진 서비스는 **아무 목록에도 들어가지 않는다** — 도구가 아예 없다.
 * (연결 표시만 되고 실체가 없던 결함의 반대 계약: docs/connector-tools/findings.md 결함 1)
 */
export function computeConnectorGates(policies: readonly ConnectorGateInput[]): ConnectorGates {
  const gates: ConnectorGates = { services: [], allowedTools: [], approvalTools: [] };
  for (const policy of policies) {
    if (policy.mcpServerId !== CONNECTOR_MCP_SERVER) continue;
    if (!policy.enabled || !policy.connected) continue;
    gates.services.push(policy.id);
    const prefix = toolPrefix(policy.mcpServerId);
    const lanes = [
      { tools: policy.readTools, mode: policy.readPolicy },
      { tools: policy.writeTools, mode: policy.writePolicy },
    ];
    for (const lane of lanes) {
      for (const tool of lane.tools) {
        if (lane.mode === "auto") gates.allowedTools.push(prefix + tool);
        else gates.approvalTools.push(tool);
      }
    }
  }
  return gates;
}
