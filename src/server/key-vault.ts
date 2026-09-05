import { writeEnvKey } from "./utils/safeEnvWriter.js";

export type KeyScope = "client" | "server";

export interface KeyEntry {
  id: string;
  label: string;
  envName?: string;
  scope: KeyScope;
  masked: string;
  hasValue: boolean;
  prefix?: string;
}

interface KeyDef {
  id: string;
  label: string;
  scope: KeyScope;
  envName?: string;
  prefix?: string;
}

const PRESET_KEYS: KeyDef[] = [
  { id: "groq",      label: "GROQ API Key",       scope: "server", envName: "GROQ_API_KEY",      prefix: "gsk_" },
  { id: "anthropic", label: "Anthropic API Key",   scope: "server", envName: "ANTHROPIC_API_KEY", prefix: "sk-ant-" },
  { id: "openai",    label: "OpenAI API Key",      scope: "client",                                prefix: "sk-" },
  { id: "grok-xai",  label: "Grok (xAI) API Key",  scope: "client",                                prefix: "xai-" },
  // 앱 연동 키 — .env에 기록되고 앱 spawn 시 process.env로 전파 (앱 재시작 후 적용)
  { id: "openai-server", label: "OpenAI API Key (디자인 앱 — 이미지 생성)", scope: "server", envName: "OPENAI_API_KEY", prefix: "sk-" },
  { id: "resend",        label: "Resend API Key (메일·예약 앱 — 발송)",     scope: "server", envName: "RESEND_API_KEY", prefix: "re_" },
  { id: "kakao-rest",    label: "Kakao REST Key (책장 앱 — 도서 검색)",     scope: "server", envName: "KAKAO_REST_KEY" },
  { id: "naver-id",      label: "Naver Client ID (책장 앱 — 도서 검색)",    scope: "server", envName: "NAVER_CLIENT_ID" },
  { id: "naver-secret",  label: "Naver Client Secret (책장 앱)",            scope: "server", envName: "NAVER_CLIENT_SECRET" },
  // 원격 MCP 토큰 — mcp-registry headers의 ${PLAYMCP_TOKEN} 플레이스홀더가 spawn 시 이 값으로 치환된다.
  { id: "playmcp",       label: "PlayMCP 툴박스 토큰 (카카오 원격 MCP)",      scope: "server", envName: "PLAYMCP_TOKEN" },
];

export function maskKeyValue(value: string): string {
  if (!value || value.length < 8) return "••••••••";
  const prefix = value.substring(0, Math.min(6, value.length - 4));
  const suffix = value.slice(-4);
  const dots = "•".repeat(Math.max(4, value.length - prefix.length - 4));
  return `${prefix}${dots}${suffix}`;
}

export function validateKeyFormat(id: string, value: string): boolean {
  const def = PRESET_KEYS.find((k) => k.id === id);
  const prefix = def?.prefix;
  if (!prefix) return true;
  return value.startsWith(prefix) && value.length > prefix.length + 4;
}

export function getKeyEntries(): KeyEntry[] {
  return PRESET_KEYS.map((def) => {
    if (def.scope === "server" && def.envName) {
      const raw = process.env[def.envName] ?? "";
      return {
        id: def.id,
        label: def.label,
        envName: def.envName,
        scope: def.scope,
        masked: raw ? maskKeyValue(raw) : "",
        hasValue: !!raw,
        prefix: def.prefix,
      };
    }
    return {
      id: def.id,
      label: def.label,
      scope: def.scope,
      masked: "",
      hasValue: false,
      prefix: def.prefix,
    };
  });
}

export function getKeyRawValue(id: string): string | null {
  const def = PRESET_KEYS.find((k) => k.id === id);
  if (!def || def.scope !== "server" || !def.envName) return null;
  return process.env[def.envName] ?? null;
}

export function saveServerKey(id: string, value: string): void {
  const def = PRESET_KEYS.find((k) => k.id === id);
  if (!def || def.scope !== "server" || !def.envName) return;
  writeEnvKey(def.envName, value);
  process.env[def.envName] = value;
}

export function deleteServerKey(id: string): void {
  const def = PRESET_KEYS.find((k) => k.id === id);
  if (!def || def.scope !== "server" || !def.envName) return;
  writeEnvKey(def.envName, "");
  delete process.env[def.envName];
}
