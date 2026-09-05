// 커넥터 MCP 서버 — Google Drive · Gmail · Google Calendar · Notion 도구를 에이전트에 연다.
//
// 토큰은 여기에 없다. 호스트의 브로커(/api/connectors/:provider/access-token)에 매 호출
// 되물어 수명 짧은 액세스 토큰만 받는다 — refresh token은 호스트 프로세스 밖으로 나가지 않는다.
// 브로커 인증 토큰은 파일(0600)로 받는다: 자식 env에 실으면 프로세스 목록에 새어나온다.
//
// 환경변수:
//   MCP_CONNECTOR_BASE_URL    호스트 베이스 (예: http://127.0.0.1:3456)
//   MCP_CONNECTOR_TOKEN_FILE  브로커 토큰 파일 경로
//   MCP_CONNECTOR_SERVICES    노출할 서비스 id 콤마 목록 (google-drive,gmail,...)
//                             — 서비스 정책에서 꺼진 서비스는 도구 자체가 등록되지 않는다.

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.MCP_CONNECTOR_BASE_URL || "http://127.0.0.1:3456";
const TOKEN_FILE = process.env.MCP_CONNECTOR_TOKEN_FILE || "";
const SERVICES = new Set(
  (process.env.MCP_CONNECTOR_SERVICES || "google-drive,gmail,google-calendar,notion")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

const NOTION_VERSION = "2022-06-28";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

function brokerToken(): string {
  if (!TOKEN_FILE) throw new Error("MCP_CONNECTOR_TOKEN_FILE 미설정 — 호스트가 커넥터 서버를 잘못 배선했습니다");
  return readFileSync(TOKEN_FILE, "utf8").trim();
}

/**
 * 호스트에서 액세스 토큰을 받는다. 만료·재동의는 호스트가 판단해 remedy 문장으로 돌려주므로
 * 여기서는 그 문장을 그대로 에이전트에게 전달한다 — 에이전트가 사용자에게 재연결을 안내할 수 있다.
 */
async function accessToken(provider: "google" | "notion"): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/connectors/${provider}/access-token`, {
    method: "POST",
    headers: { "x-connector-broker": brokerToken() },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({})) as { accessToken?: string; remedy?: string; error?: string };
  if (!response.ok || !body.accessToken) {
    throw new Error(body.remedy ?? body.error ?? `토큰 브로커 오류 (HTTP ${response.status})`);
  }
  return body.accessToken;
}

type CallOptions = { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean };

async function callApi(provider: "google" | "notion", url: string, options: CallOptions = {}): Promise<unknown> {
  const token = await accessToken(provider);
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    ...(provider === "notion" ? { "Notion-Version": NOTION_VERSION } : {}),
    ...options.headers,
  };
  if (options.body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined
      : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    // 401은 호스트가 아직 needs_reauth로 못 넘긴 경우 — 사람이 읽을 수 있게 그대로 올린다.
    throw new Error(`${provider} API 오류 (HTTP ${response.status}): ${text.slice(0, 400)}`);
  }
  if (options.raw) return text;
  return text ? JSON.parse(text) as unknown : {};
}

const server = new McpServer({ name: "connectors", version: "0.1.0" });

/** 도구 등록 래퍼 — 서비스가 꺼져 있으면 등록 자체를 건너뛴다. */
// McpServer.tool의 6중 오버로드는 제네릭 래퍼를 통과하면 해석되지 않는다 (zod v4 + SDK).
// 등록 시점 한 곳에서만 형을 고정하고, 도구 본체는 아래 tool()의 제네릭으로 타입을 지킨다.
type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type RegisterTool = (
  name: string,
  description: string,
  schema: z.ZodRawShape,
  handler: (args: Record<string, unknown>) => Promise<ToolResult>,
) => void;
const registerTool = server.tool.bind(server) as unknown as RegisterTool;

/** 도구 등록 래퍼 — 서비스가 꺼져 있으면 등록 자체를 건너뛴다. */
function tool<S extends z.ZodRawShape>(
  service: string,
  name: string,
  description: string,
  schema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
): void {
  if (!SERVICES.has(service)) return;
  registerTool(name, description, schema, async (args) => {
    try {
      return ok(await handler(args as z.infer<z.ZodObject<S>>));
    } catch (error) {
      return fail(`${name} 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

// ── Google Drive (Drive API v3) ─────────────────────────────────────────────

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DRIVE_FIELDS = "files(id,name,mimeType,modifiedTime,owners(emailAddress),webViewLink,size),nextPageToken";

/** 구글 네이티브 문서는 바이트가 없다 — export로 텍스트를 뽑아야 한다. */
const EXPORT_AS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

tool("google-drive", "drive_search_files", "구글 드라이브에서 파일을 검색한다 (Drive API v3 q 문법).", {
  query: z.string().min(1).describe("검색어. 파일명 부분일치로 변환됨. 원시 q 문법을 쓰려면 rawQuery 사용"),
  rawQuery: z.string().optional().describe("Drive API q 파라미터를 직접 지정 (예: \"mimeType='application/pdf'\")"),
  pageSize: z.number().int().min(1).max(100).default(20),
}, async ({ query, rawQuery, pageSize }) => {
  const q = rawQuery ?? `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
  const url = `${DRIVE}?q=${encodeURIComponent(q)}&pageSize=${pageSize}&fields=${encodeURIComponent(DRIVE_FIELDS)}`;
  return callApi("google", url);
});

tool("google-drive", "drive_get_file_metadata", "구글 드라이브 파일의 메타데이터를 조회한다.", {
  fileId: z.string().min(1),
}, async ({ fileId }) => callApi(
  "google",
  `${DRIVE}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent("id,name,mimeType,modifiedTime,size,webViewLink,parents,owners(emailAddress)")}`,
));

tool("google-drive", "drive_read_file_content", "구글 드라이브 파일의 본문을 텍스트로 읽는다 (구글 문서는 자동 export).", {
  fileId: z.string().min(1),
  maxChars: z.number().int().min(200).max(200_000).default(40_000),
}, async ({ fileId, maxChars }) => {
  const meta = await callApi("google", `${DRIVE}/${encodeURIComponent(fileId)}?fields=id,name,mimeType`) as { name?: string; mimeType?: string };
  const exportMime = EXPORT_AS[meta.mimeType ?? ""];
  const url = exportMime
    ? `${DRIVE}/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `${DRIVE}/${encodeURIComponent(fileId)}?alt=media`;
  const text = await callApi("google", url, { raw: true }) as string;
  return {
    name: meta.name, mimeType: meta.mimeType,
    truncated: text.length > maxChars,
    content: text.slice(0, maxChars),
  };
});

tool("google-drive", "drive_list_recent_files", "최근 수정된 구글 드라이브 파일 목록.", {
  pageSize: z.number().int().min(1).max(100).default(20),
}, async ({ pageSize }) => callApi(
  "google",
  `${DRIVE}?orderBy=modifiedTime desc&pageSize=${pageSize}&q=${encodeURIComponent("trashed = false")}&fields=${encodeURIComponent(DRIVE_FIELDS)}`,
));

tool("google-drive", "drive_create_file", "구글 드라이브에 텍스트 파일을 만든다 (drive.file 스코프 — 이 앱이 만든 파일만 이후 접근 가능).", {
  name: z.string().min(1),
  content: z.string().default(""),
  mimeType: z.string().default("text/plain"),
  parentFolderId: z.string().optional(),
}, async ({ name, content, mimeType, parentFolderId }) => {
  const boundary = `mycrew${Date.now()}`;
  const metadata = { name, mimeType, ...(parentFolderId ? { parents: [parentFolderId] } : {}) };
  const body =
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;
  return callApi("google", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST", body, headers: { "content-type": `multipart/related; boundary=${boundary}` },
  });
});

// ── Gmail (Gmail API v1) ────────────────────────────────────────────────────

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** 멀티파트 메시지에서 text/plain 본문을 재귀로 긁는다 (없으면 html 폴백). */
function extractBody(payload: unknown): string {
  const node = payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] } | undefined;
  if (!node) return "";
  if (node.mimeType === "text/plain" && node.body?.data) return decodeBase64Url(node.body.data);
  for (const part of node.parts ?? []) {
    const found = extractBody(part);
    if (found) return found;
  }
  if (node.mimeType === "text/html" && node.body?.data) return decodeBase64Url(node.body.data);
  return "";
}

tool("gmail", "gmail_search_threads", "지메일 스레드를 검색한다 (지메일 검색 문법: from:, subject:, newer_than:7d 등).", {
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(50).default(15),
}, async ({ query, maxResults }) => {
  const list = await callApi("google", `${GMAIL}/threads?q=${encodeURIComponent(query)}&maxResults=${maxResults}`) as { threads?: Array<{ id: string; snippet?: string }> };
  return { threads: list.threads ?? [] };
});

tool("gmail", "gmail_get_thread", "지메일 스레드의 메시지 본문을 읽는다.", {
  threadId: z.string().min(1),
  maxChars: z.number().int().min(200).max(100_000).default(20_000),
}, async ({ threadId, maxChars }) => {
  const thread = await callApi("google", `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`) as {
    messages?: Array<{ id: string; internalDate?: string; payload?: { headers?: Array<{ name: string; value: string }> } }>;
  };
  const wanted = new Set(["from", "to", "cc", "subject", "date"]);
  return {
    messages: (thread.messages ?? []).map((message) => {
      const headers: Record<string, string> = {};
      for (const header of message.payload?.headers ?? []) {
        if (wanted.has(header.name.toLowerCase())) headers[header.name.toLowerCase()] = header.value;
      }
      return { id: message.id, headers, body: extractBody(message.payload).slice(0, maxChars) };
    }),
  };
});

tool("gmail", "gmail_list_labels", "지메일 라벨 목록.", {}, async () => callApi("google", `${GMAIL}/labels`));

tool("gmail", "gmail_create_draft", "지메일 임시보관 메일을 만든다 (전송하지 않는다 — 사람이 확인 후 보낸다).", {
  to: z.string().min(1).describe("수신자. 쉼표로 여러 명"),
  subject: z.string().default(""),
  body: z.string().default(""),
  cc: z.string().optional(),
}, async ({ to, subject, body, cc }) => {
  // 제목의 비ASCII는 RFC 2047 인코딩이 필요하다 — 한글 제목이 깨지지 않게.
  const encodedSubject = /^[\x20-\x7E]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const raw = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64"),
  ].join("\r\n");
  return callApi("google", `${GMAIL}/drafts`, {
    method: "POST",
    body: { message: { raw: Buffer.from(raw, "utf8").toString("base64url") } },
  });
});

// ── Google Calendar (Calendar API v3) ───────────────────────────────────────

const CALENDAR = "https://www.googleapis.com/calendar/v3";

tool("google-calendar", "calendar_list_calendars", "접근 가능한 캘린더 목록.", {}, async () =>
  callApi("google", `${CALENDAR}/users/me/calendarList`));

tool("google-calendar", "calendar_list_events", "캘린더 일정을 조회한다.", {
  calendarId: z.string().default("primary"),
  timeMin: z.string().optional().describe("RFC3339 시작 (예: 2026-09-01T00:00:00+09:00)"),
  timeMax: z.string().optional(),
  maxResults: z.number().int().min(1).max(250).default(50),
}, async ({ calendarId, timeMin, timeMax, maxResults }) => {
  const params = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: String(maxResults) });
  if (timeMin) params.set("timeMin", timeMin);
  if (timeMax) params.set("timeMax", timeMax);
  return callApi("google", `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
});

tool("google-calendar", "calendar_create_event", "캘린더에 일정을 만든다.", {
  calendarId: z.string().default("primary"),
  summary: z.string().min(1),
  start: z.string().min(1).describe("RFC3339 시작 시각"),
  end: z.string().min(1).describe("RFC3339 종료 시각"),
  description: z.string().optional(),
  attendees: z.array(z.string()).optional().describe("참석자 이메일"),
}, async ({ calendarId, summary, start, end, description, attendees }) => callApi(
  "google",
  `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events`,
  {
    method: "POST",
    body: {
      summary, description,
      start: { dateTime: start }, end: { dateTime: end },
      ...(attendees?.length ? { attendees: attendees.map((email: string) => ({ email })) } : {}),
    },
  },
));

// ── Notion (API 2022-06-28) ─────────────────────────────────────────────────

const NOTION = "https://api.notion.com/v1";

/** 노션 rich_text 배열 → 평문. 블록 트리를 사람이 읽을 수 있게 눌러 담는다. */
function plainText(richText: unknown): string {
  return Array.isArray(richText)
    ? richText.map((r) => (r as { plain_text?: string }).plain_text ?? "").join("")
    : "";
}

tool("notion", "notion_search", "노션 워크스페이스에서 페이지·데이터베이스를 검색한다.", {
  query: z.string().default(""),
  filter: z.enum(["page", "database", "all"]).default("all"),
  pageSize: z.number().int().min(1).max(100).default(20),
}, async ({ query, filter, pageSize }) => {
  const result = await callApi("notion", `${NOTION}/search`, {
    method: "POST",
    body: {
      query, page_size: pageSize,
      ...(filter === "all" ? {} : { filter: { property: "object", value: filter } }),
    },
  }) as { results?: Array<Record<string, unknown>> };
  return {
    results: (result.results ?? []).map((item) => ({
      id: item.id, object: item.object, url: item.url,
      title: extractNotionTitle(item),
      lastEditedTime: item.last_edited_time,
    })),
  };
});

function extractNotionTitle(item: Record<string, unknown>): string {
  const properties = item.properties as Record<string, { type?: string; title?: unknown }> | undefined;
  for (const value of Object.values(properties ?? {})) {
    if (value?.type === "title") return plainText(value.title);
  }
  return plainText((item as { title?: unknown }).title);
}

tool("notion", "notion_fetch", "노션 페이지의 속성과 블록 본문을 읽는다.", {
  pageId: z.string().min(1),
  maxBlocks: z.number().int().min(1).max(200).default(100),
}, async ({ pageId, maxBlocks }) => {
  const id = encodeURIComponent(pageId);
  const page = await callApi("notion", `${NOTION}/pages/${id}`) as Record<string, unknown>;
  const blocks = await callApi("notion", `${NOTION}/blocks/${id}/children?page_size=${maxBlocks}`) as {
    results?: Array<Record<string, unknown>>;
  };
  return {
    id: page.id, url: page.url, title: extractNotionTitle(page),
    lastEditedTime: page.last_edited_time,
    blocks: (blocks.results ?? []).map((block) => {
      const type = block.type as string;
      const payload = block[type] as { rich_text?: unknown } | undefined;
      return { type, text: plainText(payload?.rich_text), hasChildren: block.has_children };
    }),
  };
});

tool("notion", "notion_create_page", "노션에 페이지를 만든다 (부모 페이지 또는 데이터베이스 아래).", {
  parentId: z.string().min(1),
  parentType: z.enum(["page", "database"]).default("page"),
  title: z.string().min(1),
  body: z.string().default("").describe("본문. 빈 줄로 나뉜 문단이 각각 블록이 된다"),
}, async ({ parentId, parentType, title, body }) => callApi("notion", `${NOTION}/pages`, {
  method: "POST",
  body: {
    parent: parentType === "database" ? { database_id: parentId } : { page_id: parentId },
    properties: parentType === "database"
      ? { Name: { title: [{ text: { content: title } }] } }
      : { title: { title: [{ text: { content: title } }] } },
    children: body.split(/\n{2,}/).filter((p: string) => p.trim().length > 0).map((paragraph: string) => ({
      object: "block", type: "paragraph",
      // 노션 rich_text 하나의 상한이 2000자다 — 넘기면 400이 난다.
      paragraph: { rich_text: [{ type: "text", text: { content: paragraph.slice(0, 2000) } }] },
    })),
  },
}));

tool("notion", "notion_update_page", "노션 페이지의 제목을 바꾸거나 보관 처리한다.", {
  pageId: z.string().min(1),
  title: z.string().optional(),
  archived: z.boolean().optional(),
}, async ({ pageId, title, archived }) => callApi("notion", `${NOTION}/pages/${encodeURIComponent(pageId)}`, {
  method: "PATCH",
  body: {
    ...(archived === undefined ? {} : { archived }),
    ...(title === undefined ? {} : { properties: { title: { title: [{ text: { content: title } }] } } }),
  },
}));

tool("notion", "notion_create_comment", "노션 페이지에 코멘트를 단다.", {
  pageId: z.string().min(1),
  text: z.string().min(1),
}, async ({ pageId, text }) => callApi("notion", `${NOTION}/comments`, {
  method: "POST",
  body: { parent: { page_id: pageId }, rich_text: [{ text: { content: text.slice(0, 2000) } }] },
}));

await server.connect(new StdioServerTransport());
