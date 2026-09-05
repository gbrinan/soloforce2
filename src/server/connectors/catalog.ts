// 커넥터 카탈로그 — provider(인증 단위)와 service(정책 단위)의 정본.
//
// provider ≠ service: 구글은 OAuth grant 하나로 Drive·Gmail·Calendar를 함께 받지만
// 승인 정책은 서비스별로 따로 걸린다. 토큰은 provider 단위로 보관하고, 도구 노출은
// service 단위로 가른다. (docs/connector-tools/findings.md D2)
//
// 도구 이름은 여기가 정본이다 — MCP 서버(src/mcp/connectors-server.ts)의 등록 이름과
// config/service-policies.json의 readTools/writeTools가 모두 이 표를 따라야 한다.

export type ConnectorProviderId = "google" | "notion";

/** MCP 서버 이름 — spawn 시 `mcp__<name>__<tool>` 접두사의 근거. */
export const CONNECTOR_MCP_SERVER = "connectors";

export interface ConnectorProviderDef {
  readonly id: ConnectorProviderId;
  readonly label: string;
  /** OAuth client id/secret을 읽는 환경변수 이름. */
  readonly clientIdEnv: string;
  readonly clientSecretEnv: string;
  /**
   * OAuth 없이 바로 연결로 인정할 정적 토큰 환경변수.
   * google은 refresh token(장기), notion은 내부 통합 토큰(무만료).
   * (.env.example이 이미 GOOGLE_OAUTH_REFRESH_TOKEN을 약속하고 있었다 — findings D4)
   */
  readonly staticTokenEnv: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly scopes: readonly string[];
  /** 콜백 경로 — 구글/노션 콘솔의 승인된 리디렉션 URI와 정확히 같아야 한다. */
  readonly callbackPath: string;
}

export const CONNECTOR_PROVIDERS: readonly ConnectorProviderDef[] = [
  {
    id: "google",
    label: "Google",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    staticTokenEnv: "GOOGLE_OAUTH_REFRESH_TOKEN",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      // Drive API v3 — 검색/읽기 + 이 앱이 만든 파일 쓰기
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
      // Gmail API v1 — 읽기 + 초안 작성 + 라벨
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.labels",
      // Calendar API v3
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    callbackPath: "/api/connectors/google/oauth/callback",
  },
  {
    id: "notion",
    label: "Notion",
    clientIdEnv: "NOTION_OAUTH_CLIENT_ID",
    clientSecretEnv: "NOTION_OAUTH_CLIENT_SECRET",
    staticTokenEnv: "NOTION_API_TOKEN",
    authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
    tokenEndpoint: "https://api.notion.com/v1/oauth/token",
    // 노션은 스코프를 통합 설정에서 정한다 — authorize URL에 scope 파라미터가 없다.
    scopes: [],
    callbackPath: "/api/connectors/notion/oauth/callback",
  },
] as const;

export function getProviderDef(id: string): ConnectorProviderDef | undefined {
  return CONNECTOR_PROVIDERS.find((p) => p.id === id);
}

/** 정책 단위 서비스 → 그 서비스를 떠받치는 provider. */
export const SERVICE_PROVIDER: Readonly<Record<string, ConnectorProviderId>> = {
  "google-drive": "google",
  "gmail": "google",
  "google-calendar": "google",
  "notion": "notion",
};

/** 도구 이름 → 서비스 id. MCP 서버와 정책 게이트가 공유하는 유일한 매핑. */
export const TOOL_SERVICE: Readonly<Record<string, string>> = {
  drive_search_files: "google-drive",
  drive_get_file_metadata: "google-drive",
  drive_read_file_content: "google-drive",
  drive_list_recent_files: "google-drive",
  drive_create_file: "google-drive",

  gmail_search_threads: "gmail",
  gmail_get_thread: "gmail",
  gmail_list_labels: "gmail",
  gmail_create_draft: "gmail",

  calendar_list_calendars: "google-calendar",
  calendar_list_events: "google-calendar",
  calendar_create_event: "google-calendar",

  notion_search: "notion",
  notion_fetch: "notion",
  notion_create_page: "notion",
  notion_update_page: "notion",
  notion_create_comment: "notion",
};

/** 서비스별 읽기/쓰기 도구 — service-policies의 readTools/writeTools 정본. */
export const SERVICE_TOOLS: Readonly<Record<string, { read: readonly string[]; write: readonly string[] }>> = {
  "google-drive": {
    read: ["drive_search_files", "drive_get_file_metadata", "drive_read_file_content", "drive_list_recent_files"],
    write: ["drive_create_file"],
  },
  "gmail": {
    read: ["gmail_search_threads", "gmail_get_thread", "gmail_list_labels"],
    write: ["gmail_create_draft"],
  },
  "google-calendar": {
    read: ["calendar_list_calendars", "calendar_list_events"],
    write: ["calendar_create_event"],
  },
  "notion": {
    read: ["notion_search", "notion_fetch"],
    write: ["notion_create_page", "notion_update_page", "notion_create_comment"],
  },
};
