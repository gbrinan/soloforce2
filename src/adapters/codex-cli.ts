import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import type { AgentAdapter, AdapterOptions, AdapterResult } from "./types.js";
import type { AgentConfig, AgentResult } from "../types.js";
import { PROJECT_SELF_DIR, PROJECTS_DIR, MYCREW_HOME, TSX_BIN, TSX_CLI_ARGS } from "../config.js";
import { computeMemoryDir } from "../mcp/memory-dir.js";
import { safeKill } from "../server/utils/platform.js";
import { findLatestCodexSessionModel } from "./codex-session-model.js";

const CODEX_PATH = process.env.CODEX_PATH || "codex";
const PROCESS_TIMEOUT = 60 * 60 * 1000;
const USER_AUTH = join(homedir(), ".codex", "auth.json");
// [로컬 패치] .bin/tsx는 Windows에서 실행 불가 — config의 node+cli.mjs 방식 사용

const SAFE_ENV_KEYS = [
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR",
  "NODE_OPTIONS", "NODE_PATH", "NODE_ENV",
  "WORKSPACE_ROOT", "PROJECTS_FOLDER", "PORT", "NGROK_URL", "TUNNEL_URL",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  "SSL_CERT_FILE", "SSL_CERT_DIR",
];

function safeChildEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const v = process.env[key];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

function buildSafefsEnv(config: AgentConfig, taskId: string, cwd: string): Record<string, string> {
  const port = process.env.PORT ?? "3456";
  return {
    MCP_WRITE_PATHS: (() => {
      const base = config.writePaths ?? [];
      if (base.length === 0) return "";
      const augmented = new Set(base);
      augmented.add("/history/external/partners.json");
      return Array.from(augmented).join(",");
    })(),
    MCP_READ_PATHS: config.readPaths?.join(",") ?? "",
    MCP_BASH_ENABLED: (config.allowedTools.includes("Bash") || (config.bashCommands?.length ?? 0) > 0) ? "1" : "",
    MCP_BASH_COMMANDS: config.bashCommands?.join(",") ?? "",
    MCP_BASH_PATHS: config.bashPaths?.join(",") ?? "",
    MCP_READ_SENSITIVE: config.readSensitivePaths?.join(",") ?? "",
    MCP_WRITE_SENSITIVE: config.writeSensitivePaths?.join(",") ?? "",
    MCP_BASH_SENSITIVE_PATTERNS: config.bashSensitivePatterns?.join(",") ?? "",
    MCP_APPROVAL_URL: `http://127.0.0.1:${port}/api/approvals`,
    MCP_DELEGATE_URL: `http://127.0.0.1:${port}/api/delegate`,
    MCP_SEND_PARTNER_URL: `http://127.0.0.1:${port}/api/genie/external-send`,
    MCP_REQUEST_PARTNERSHIP_URL: `http://127.0.0.1:${port}/api/genie/external-partner-request`,
    MCP_ROTATE_TOKEN_URL: `http://127.0.0.1:${port}/api/genie/external-rotate-token`,
    MCP_AGENT_ROLE: config.role,
    MCP_JOB_ID: taskId,
    MCP_CWD: cwd,
    MCP_SELF_DIR: PROJECT_SELF_DIR,
    MCP_MYCREW_HOME: MYCREW_HOME,
    MCP_PROJECTS_DIR: PROJECTS_DIR,
    MCP_EXTRA_BASES: (() => {
      const memDir = computeMemoryDir(cwd);
      return existsSync(memDir) ? memDir : "";
    })(),
  };
}

interface IsolatedHome {
  home: string;
  cleanup: () => void;
}

function makeIsolatedCodexHome(safefsEnv: Record<string, string>): IsolatedHome {
  if (!existsSync(USER_AUTH)) {
    throw new Error(
      "Codex CLI 인증 필요. 터미널에서 `codex login` 실행 부탁드립니다. " +
      "(ChatGPT Plus/Pro 구독 인증 → ~/.codex/auth.json 생성됨)"
    );
  }
  // [로컬 패치 2026-07-16] codex 0.130+는 임시 폴더 아래 codex_home을 거부(헬퍼 바이너리 생성 불가)
  // → MYCREW_HOME/history/.codex-homes/ 로 이동 (일회성 홈, spawn 종료 시 rmSync로 정리됨)
  const home = join(MYCREW_HOME, "history", ".codex-homes", `job-${process.pid}-${Date.now()}`);
  mkdirSync(home, { recursive: true });
  const targetAuth = join(home, "auth.json");
  copyFileSync(USER_AUTH, targetAuth);
  try { chmodSync(targetAuth, 0o600); } catch { /* */ }

  // [로컬 패치 2026-07-18] codex가 MCP 서버(env 테이블)를 최소 env로 스폰 — Windows에서
  // SystemRoot/PATH 없이는 node가 기동 못 해 SafeWrite 등 MCP 도구가 "취소"로 실패한다.
  const sysEnv: Record<string, string> = {};
  for (const k of ["SystemRoot", "SYSTEMROOT", "PATH", "TEMP", "TMP", "COMSPEC", "WINDIR", "USERPROFILE"]) {
    const v = process.env[k];
    if (typeof v === "string") sysEnv[k] = v;
  }
  const envLines = Object.entries({ ...sysEnv, ...safefsEnv })
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k} = ${JSON.stringify(String(v))}`)
    .join("\n");
  const argsJson = JSON.stringify([...TSX_CLI_ARGS, join(PROJECT_SELF_DIR, "src", "mcp", "safefs-server.ts")]);
  const toml = [
    `# mycrew auto-generated codex config (job=${safefsEnv.MCP_JOB_ID})`,
    ``,
    // [로컬 패치 2026-07-18] codex 0.144 exec 모드가 MCP 도구 호출을 승인 대상으로 취급해
    // 비대화형에서 자동 취소하던 문제 — 승인은 safefs가 자체 수행하므로 codex 단 승인은 끔.
    `approval_policy = "never"`,
    // [로컬 패치 2026-07-18] 0.144는 CLI --sandbox보다 config가 우선 — 쓰기 허용 루트를 config에 명시
    `sandbox_mode = "workspace-write"`,
    ``,
    `[sandbox_workspace_write]`,
    `writable_roots = [${(safefsEnv.MCP_WRITE_PATHS || "")
      .split(",")
      .filter(Boolean)
      .map((w) => {
        const cleaned = w.replace(/^\//, "").replace(/\/?\*\*$/, "");
        return JSON.stringify(join(PROJECT_SELF_DIR, cleaned));
      })
      .join(", ")}]`,
    ``,
    `[mcp_servers.safefs]`,
    `command = ${JSON.stringify(TSX_BIN)}`,
    `args = ${argsJson}`,
    ``,
    `[mcp_servers.safefs.env]`,
    envLines,
    ``,
  ].join("\n");
  writeFileSync(join(home, "config.toml"), toml, "utf-8");
  // [디버그 2026-07-18] 마지막 생성 설정 사본 (문제 진단용 — 안정화 후 제거 가능)
  try { writeFileSync(join(MYCREW_HOME, "history", ".codex-homes", "last-config.toml"), toml, "utf-8"); } catch { /* */ }
  return {
    home,
    cleanup: () => {
      try { rmSync(home, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

interface SpawnResult {
  output: string;
  sessionId?: string;
  cost?: AgentResult["cost"];
  isError: boolean;
  errorMsg?: string;
}

function spawnCodex(
  args: string[],
  stdinData: string,
  cwd: string,
  childEnv: Record<string, string>,
  options: AdapterOptions | undefined,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(CODEX_PATH, args, {
      cwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (proc.pid && options?.onSpawn) {
      try { options.onSpawn(proc.pid); } catch { /* */ }
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      safeKill(proc, "SIGTERM");
      reject(new Error("codex 프로세스 타임아웃 (60분)"));
    }, PROCESS_TIMEOUT);

    let buffer = "";
    let finalText = "";
    let streamingText = "";
    let sessionId: string | undefined;
    let cost: AgentResult["cost"] | undefined;
    let isError = false;
    let errorMsg: string | undefined;
    const errChunks: Buffer[] = [];

    const processEvent = (event: Record<string, unknown>) => {
      const t = event.type;

      if (t === "thread.started" && typeof event.thread_id === "string") {
        sessionId = event.thread_id;
      }

      if (t === "item.completed") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item && typeof item === "object") {
          const itemType = item.type;
          if (itemType === "agent_message" && typeof item.text === "string") {
            finalText = item.text;
            streamingText += item.text;
            if (options?.onText) {
              try { options.onText(item.text); } catch { /* */ }
            }
          }
          if (itemType === "command_execution" && typeof item.command === "string" && options?.onProgress) {
            try { options.onProgress(`명령 실행: ${item.command.slice(0, 60)}`); } catch { /* */ }
          }
        }
      }

      if (t === "turn.started" && options?.onProgress) {
        try { options.onProgress("새 턴 시작"); } catch { /* */ }
      }

      if (t === "turn.completed") {
        const usage = event.usage as Record<string, unknown> | undefined;
        if (usage && typeof usage === "object") {
          cost = {
            costUsd: 0,
            inputTokens: Number(usage.input_tokens ?? 0),
            outputTokens: Number(usage.output_tokens ?? 0),
            cacheReadTokens: Number(usage.cached_input_tokens ?? 0),
            cacheCreateTokens: 0,
            durationMs: 0,
          };
        }
      }

      if (t === "error") {
        isError = true;
        errorMsg = String(event.message ?? event.error ?? "codex error");
      }

      if (options?.onSystemMessage) {
        try { options.onSystemMessage(event); } catch { /* */ }
      }
    };

    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          processEvent(event);
        } catch { /* JSON 아닌 줄 무시 */ }
      }
    });
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d));

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as Record<string, unknown>;
          processEvent(event);
        } catch { /* JSON 아닌 줄 무시 */ }
        buffer = "";
      }
      const stderr = Buffer.concat(errChunks).toString("utf-8");
      const output = finalText || streamingText;
      if (code === 0 || output) {
        resolve({ output, sessionId, cost, isError, errorMsg });
      } else {
        reject(new Error(`codex exited ${code}: ${stderr || "(no stderr)"}${cwd ? ` (cwd: ${cwd})` : ""}`));
      }
    });

    if (proc.stdin) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }
  });
}

export const codexCliAdapter: AgentAdapter = {
  id: "codex-cli",
  supportedModels: [
    { id: "auto", label: "Codex 자동 라우팅 (기본)" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5-codex", label: "GPT-5 Codex (코드 작업)" },
    { id: "gpt-image-2", label: "GPT Image 2 (이미지 생성/편집)" },
  ],
  async execute(config, taskId, prompt, options): Promise<AdapterResult> {
    const cwd = options?.cwd ?? PROJECT_SELF_DIR;
    const safefsEnv = buildSafefsEnv(config, taskId, cwd);

    let isolated: IsolatedHome;
    try {
      isolated = makeIsolatedCodexHome(safefsEnv);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        agentRole: config.role,
        taskId,
        success: false,
        output: "",
        error: msg,
      };
    }

    const args: string[] = [
      "exec", "-",
      "--experimental-json",
      "--sandbox", "workspace-write",
      "--skip-git-repo-check",
    ];
    if (config.writePaths) {
      for (const p of config.writePaths) {
        const abs = p.startsWith("/") ? join(PROJECT_SELF_DIR, p.replace(/^\//, "")) : p;
        args.push("--add-dir", abs);
      }
    }
    if (config.model && config.model !== "auto") {
      args.push("--model", config.model);
    }

    const childEnv: Record<string, string> = {
      ...safeChildEnv(),
      CODEX_HOME: isolated.home,
    };

    console.log(`\n[${config.name}] (codex) 작업 시작: ${prompt.slice(0, 80)}...`);

    try {
      const r = await spawnCodex(args, prompt, cwd, childEnv, options);
      const explicitModel = config.model && config.model !== "auto" ? config.model : null;
      const actualModel = findLatestCodexSessionModel(join(isolated.home, "sessions")) ?? explicitModel;
      if (r.cost && actualModel) r.cost.model = actualModel;
      if (r.isError) {
        return {
          agentRole: config.role,
          taskId,
          success: false,
          output: r.output,
          error: r.errorMsg ?? "codex error",
          sessionId: r.sessionId,
          cost: r.cost,
        };
      }
      // [로컬 패치 2026-07-18] codex(Windows)는 샌드박스로 파일 쓰기가 막히고 safefs MCP도
      // 로드되지 않아, 라운지 게시를 응답 마커 [CREW_POST]...[/CREW_POST]로 받으면
      // 어댑터가 대신 crew-chat 아웃박스 파일로 기록한다 (crew-chat 워처가 10초 내 게시).
      try {
        const OPEN = "[CREW_POST]";
        const CLOSE = "[/CREW_POST]";
        const si = r.output.indexOf(OPEN);
        const ei = si >= 0 ? r.output.indexOf(CLOSE, si + OPEN.length) : -1;
        const postText = si >= 0 && ei > si ? r.output.slice(si + OPEN.length, ei).trim().slice(0, 2000) : "";
        if (postText) {
          const outboxDir = join(MYCREW_HOME, "history", "crew-chat-outbox");
          mkdirSync(outboxDir, { recursive: true });
          writeFileSync(
            join(outboxDir, `${config.role}-${Date.now()}.json`),
            JSON.stringify({ agentId: config.role, text: postText }),
            "utf-8",
          );
          console.log(`[${config.name}] (codex) CREW_POST 마커 → 라운지 아웃박스 기록`);
        }
      } catch (err) {
        console.warn(`[${config.name}] CREW_POST 처리 실패:`, err instanceof Error ? err.message : err);
      }
      console.log(`[${config.name}] (codex) 작업 완료`);
      return {
        agentRole: config.role,
        taskId,
        success: true,
        output: r.output,
        sessionId: r.sessionId,
        cost: r.cost,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${config.name}] (codex) 작업 실패: ${errorMsg.slice(0, 300)}`);
      return {
        agentRole: config.role,
        taskId,
        success: false,
        output: "",
        error: errorMsg,
      };
    } finally {
      isolated.cleanup();
    }
  },
};
