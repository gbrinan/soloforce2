import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR, PROJECT_SELF_DIR } from "./config.js";
import type { AgentConfig } from "./types.js";
import { getUserTitle } from "./server/user-title.js";
import { resolveDeprecatedModel, recordSuccession } from "./server/model-catalog.js";

export interface WorkerAgentDef {
  id: string;
  name: string;
  systemPrompt?: string;
  allowedTools: string[];
  maxTurns: number;
  bashTagSupport: boolean;
  planGate?: boolean;
  postValidation?: string[];
  team?: string;
  manager?: string;
  role?: string;
  jobType?: string;
  isCore?: boolean;
  routeKeywords: string[];
  isDefault?: boolean;
  adapter?: string;
  readPaths?: string[];
  writePaths?: string[];
  denyPaths?: string[];
  bashCommands?: string[];
  bashPaths?: string[];
  bashExtraBases?: string[];
  writeExtraBases?: string[];
  readSensitivePaths?: string[];
  writeSensitivePaths?: string[];
  bashSensitivePatterns?: string[];
  maxCacheTokens?: number;
  model?: string | null;
  /** v0.1.6 nested runtime schema. flat adapter/model 필드와 병행 — 신규 직원만 사용, 기존 직원은 flat 유지. */
  runtime?: { adapter?: string; model?: string | null; provider?: string; mode?: string };
  interactive?: boolean;
  /** claude -p(runAgent) 경로에서 playwright MCP 부착 여부 (agent.ts에서 참조) */
  enablePlaywright?: boolean;
  /** 할당된 추가 MCP 서버 이름들 (mcp-registry.json 참조) */
  mcpServers?: string[];
  permissionLevel?: string;
}

/** v0.1.6 runtime 해석기. nested runtime{adapter,model,provider} 우선, 없으면 flat adapter/model 폴백.
 *  현재 9명 + genie 직원은 모두 flat 필드만 가지므로 결과는 기존 동작과 동일하다 (하위호환).
 *  antigravity-cli 등 v0.1.0 고유 어댑터 ID도 그대로 보존 (normalizeAdapterId 미적용). */
export function resolveWorkerRuntime(
  agent: Pick<WorkerAgentDef, "adapter" | "model" | "runtime">,
): { adapter: string; model: string | null } {
  const adapter = agent.runtime?.adapter ?? agent.runtime?.provider ?? agent.adapter ?? "claude-code";
  const model = agent.runtime?.model !== undefined ? agent.runtime.model : (agent.model ?? null);
  return { adapter, model };
}

const AGENTS_FILE = join(HISTORY_DIR, "agents.json");
const TEMPLATES_DIR = join(PROJECT_SELF_DIR, "config", "system-prompt-templates");

let cache: WorkerAgentDef[] | null = null;
let lastMtime = 0;
let lastConfigDirMtime = 0;
const unknownJobTypes = new Set<string>();
const reportedJobTypes = new Set<string>();

function buildCoworkers(self: WorkerAgentDef, all: WorkerAgentDef[]): string {
  return all
    .filter((a) => a.id !== self.id)
    .map((a) => `${a.name}(${a.team ?? a.role ?? a.id})`)
    .join(", ");
}

function applyPlaceholders(template: string, agent: WorkerAgentDef, all: WorkerAgentDef[]): string {
  // 핵심 직원 이름은 agents.json에서 동적 조회 — onboarding이 사용자 입력 이름으로 채움.
  // 못 찾으면 placeholder를 그대로 남김(사용자가 바로 알아채게).
  const nameOf = (id: string) => all.find(a => a.id === id)?.name;
  const cto = nameOf("dev-pm");
  const cqo = nameOf("qa");
  const cso = nameOf("planner-researcher");
  const replacements: Record<string, string> = {
    "{{ID}}": agent.id,
    "{{NAME}}": agent.name,
    "{{ROLE}}": agent.role ?? "팀장",
    "{{TEAM}}": agent.team ?? "",
    "{{MANAGER}}": agent.manager ?? "마이크루",
    "{{COWORKERS}}": buildCoworkers(agent, all),
    "{{OUTPUT_DIR}}": `history/outputs/${agent.id}`,
    "{{WIKI_DIR}}": `history/agents/${agent.id}/wiki`,
    "{{GENIE}}": "마이크루",
    "{{USER}}": getUserTitle(),
    ...(cto ? { "{{CTO}}": cto } : {}),
    ...(cqo ? { "{{CQO}}": cqo } : {}),
    ...(cso ? { "{{CSO}}": cso } : {}),
  };
  let out = template;
  for (const [key, val] of Object.entries(replacements)) {
    out = out.split(key).join(val);
  }
  return out;
}

function loadSystemPrompt(agent: WorkerAgentDef, all: WorkerAgentDef[]): string {
  // 0단계: config/agents/{id}/system-prompt.md (씨앗 레벨 오버라이드)
  const seedPromptPath = join(PROJECT_SELF_DIR, "config", "agents", agent.id, "system-prompt.md");
  if (existsSync(seedPromptPath)) {
    return applyPlaceholders(readFileSync(seedPromptPath, "utf-8"), agent, all);
  }
  // 1단계: history/agents/{id}/system-prompt.md (로컬 개인 오버라이드)
  const localPath = join(HISTORY_DIR, "agents", agent.id, "system-prompt.md");
  if (existsSync(localPath)) {
    return applyPlaceholders(readFileSync(localPath, "utf-8"), agent, all);
  }
  // 2단계: config/system-prompt-templates/{jobType}.md
  const jobType = agent.jobType ?? "general";
  const jobPath = join(TEMPLATES_DIR, `${jobType}.md`);
  if (existsSync(jobPath)) {
    return applyPlaceholders(readFileSync(jobPath, "utf-8"), agent, all);
  }
  // jobType 미존재 시 폴백 + toast 대상 등록 (BOOST-3)
  if (jobType !== "general") unknownJobTypes.add(jobType);
  // 3단계: general.md 폴백
  const generalPath = join(TEMPLATES_DIR, "general.md");
  if (existsSync(generalPath)) {
    return applyPlaceholders(readFileSync(generalPath, "utf-8"), agent, all);
  }
  return "";
}

export function ensureAgentDirs(agent: WorkerAgentDef, all?: WorkerAgentDef[]): void {
  const agentDir = join(HISTORY_DIR, "agents", agent.id);
  const wikiDir = join(agentDir, "wiki");
  const dailyDir = join(wikiDir, "daily");
  const outputsDir = join(HISTORY_DIR, "outputs", agent.id);

  if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
  if (!existsSync(outputsDir)) mkdirSync(outputsDir, { recursive: true });

  const indexPath = join(wikiDir, "index.md");
  if (!existsSync(indexPath)) {
    writeFileSync(
      indexPath,
      `# ${agent.name}의 기억\n\n## 기억\n- [role-directive](role-directive.md)\n\n## 주요 산출물 (최대 5건)\n(전체: history/outputs/${agent.id}/ — Glob/Read로 접근)\n`,
    );
  }

  const rdPath = join(wikiDir, "role-directive.md");
  // 1순위: config/agents/{id}/role-directive.md (신규 구조)
  const newTmplPath = join(PROJECT_SELF_DIR, "config", "agents", agent.id, "role-directive.md");
  // 2순위: config/role-directives/{id}.md (기존 구조 폴백)
  const tmplPath = join(PROJECT_SELF_DIR, "config", "role-directives", `${agent.id}.md`);
  const seedPath = existsSync(newTmplPath) ? newTmplPath : existsSync(tmplPath) ? tmplPath : null;

  if (existsSync(rdPath)) {
    // 씨앗이 갱신되면 wiki 사본도 따라간다. 이 재동기화가 없으면 config/agents/<id>/role-directive.md
    // 수정이 "이미 만들어진" 직원에게는 영원히 전달되지 않는다(loadIdentity는 wiki 사본만 읽는다).
    // 손으로 고친 사본(씨앗보다 최신)은 건드리지 않고, 씨앗이 더 최신일 때만 .bak 백업 후 교체한다.
    if (seedPath) {
      try {
        // mtime 먼저 비교 — 레지스트리 갱신마다 전 직원 파일을 읽지 않기 위한 값싼 게이트.
        if (statSync(seedPath).mtimeMs > statSync(rdPath).mtimeMs) {
          const expected = applyPlaceholders(readFileSync(seedPath, "utf-8"), agent, all ?? [agent]);
          const current = readFileSync(rdPath, "utf-8");
          if (current !== expected) {
            writeFileSync(`${rdPath}.bak`, current, "utf-8");
            writeFileSync(rdPath, expected, "utf-8");
            console.log(`[Registry] ${agent.id} role-directive 재동기화 (이전본 → role-directive.md.bak)`);
          }
        }
      } catch (e) {
        console.error(`[Registry] ${agent.id} role-directive 재동기화 실패:`, e);
      }
    }
  } else {
    if (seedPath) {
      const raw = readFileSync(seedPath, "utf-8");
      writeFileSync(rdPath, applyPlaceholders(raw, agent, all ?? [agent]));
    } else {
      writeFileSync(
        rdPath,
        `# ${agent.name}(${agent.role ?? "팀장"}) 역할 지시서\n\n> 이 문서는 사용자/마이크루가 관리합니다. 본인이 수정하지 마세요.\n\n## 역할\n${agent.role ?? "팀장"}. 마이크루의 지시를 받아 ${agent.team ?? ""} 업무를 수행합니다.\n\n## 업무 원칙\n- 지시받은 작업을 반드시 완료합니다.\n- 결과를 간결하게 보고합니다.\n`,
      );
    }
  }
}

export function ensureAllAgentDirs(): void {
  const agents = loadAgents();
  for (const agent of agents) {
    ensureAgentDirs(agent, agents);
  }
}

export function consumeUnknownJobTypes(): string[] {
  const fresh = Array.from(unknownJobTypes).filter((t) => !reportedJobTypes.has(t));
  fresh.forEach((t) => reportedJobTypes.add(t));
  return fresh;
}

function loadAgents(): WorkerAgentDef[] {
  try {
    const { mtimeMs } = statSync(AGENTS_FILE);
    const configAgentsDir = join(PROJECT_SELF_DIR, "config", "agents");
    let configDirMtime = 0;
    try { configDirMtime = statSync(configAgentsDir).mtimeMs; } catch { /* */ }
    if (cache && mtimeMs === lastMtime && configDirMtime === lastConfigDirMtime) return cache;
    lastMtime = mtimeMs;
    lastConfigDirMtime = configDirMtime;
  } catch {
    return cache ?? [];
  }

  try {
    const raw = readFileSync(AGENTS_FILE, "utf-8");
    const data = JSON.parse(raw) as { agents: WorkerAgentDef[] };
    const agents = data.agents;

    // 15-D: config/agents/*/meta.json 스캔 → agents.json에 없는 직원 자동 등록
    const configAgentsScanDir = join(PROJECT_SELF_DIR, "config", "agents");
    if (existsSync(configAgentsScanDir)) {
      try {
        const subdirs = readdirSync(configAgentsScanDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
        for (const agentId of subdirs) {
          if (agentId === 'genie') continue; // genie is the orchestrator, handled by genie.ts — not a worker agent
          if (agents.find(a => a.id === agentId)) continue;
          const metaPath = join(configAgentsScanDir, agentId, "meta.json");
          if (!existsSync(metaPath)) continue;
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
              id?: string; name?: string; jobTitle?: string; team?: string;
              adapter?: string; model?: string; isCore?: boolean; permLevel?: string;
              maxTurns?: number;
            };
            agents.push({
              id: meta.id ?? agentId,
              name: meta.name ?? agentId,
              team: meta.team,
              role: meta.jobTitle,
              adapter: meta.adapter ?? "claude-code",
              model: meta.model ?? null,
              isCore: meta.isCore ?? false,
              permissionLevel: meta.permLevel,
              allowedTools: [],
              // 다턴 누적(캐시읽기) 절감: meta.json에서 per-agent 상한 지정 가능, 미설정 시 20.
              maxTurns: (typeof meta.maxTurns === "number" && meta.maxTurns > 0) ? meta.maxTurns : 20,
              bashTagSupport: false,
              routeKeywords: [],
            });
          } catch (e) {
            console.error(`[Registry] meta.json 로드 실패 (${agentId}):`, e);
          }
        }
      } catch (e) {
        console.error("[Registry] config/agents 스캔 실패:", e);
      }
    }

    // 지원 종료 모델 자동 승계 — 카탈로그의 replacement 로 바꿔 읽는다.
    // 저장된 값(agents.json · 씨앗 meta.json)은 건드리지 않는다. 이유는 model-catalog.ts 참고.
    // 이 자리인 이유: agents.json 등재분과 meta.json 자동 등재분이 여기서 한 배열로 합쳐진다.
    for (const agent of agents) {
      const successor = resolveDeprecatedModel(agent.model);
      if (successor) {
        recordSuccession(agent.id, agent.model!, successor);
        agent.model = successor;
      }
    }

    // systemPrompt 4단 우선순위 (인라인 > 로컬 > jobType 템플릿 > general 폴백)
    for (const agent of agents) {
      if (!agent.systemPrompt) {
        agent.systemPrompt = loadSystemPrompt(agent, agents);
      }
    }

    // 자동 디렉토리/파일 생성 (agents.json 변경 시 신규 직원 즉시 반영)
    for (const agent of agents) {
      try { ensureAgentDirs(agent, agents); } catch (e) { console.error(`[Registry] ${agent.id} 디렉토리 생성 실패:`, e); }
    }

    // 핵심 직원(isCore=true) 보호: agents-default.json 기준 누락 시 경고
    try {
      const defaultPath = join(PROJECT_SELF_DIR, "config", "agents-default.json");
      if (existsSync(defaultPath)) {
        const defaultData = JSON.parse(readFileSync(defaultPath, "utf-8")) as { agents: WorkerAgentDef[] };
        for (const def of defaultData.agents) {
          if (def.isCore && !agents.find((a) => a.id === def.id)) {
            console.warn(`[Registry] 핵심 직원 ${def.id}가 agents.json에서 누락됨`);
          }
        }
      }
    } catch { /* */ }

    cache = agents;
    return cache;
  } catch (err) {
    console.error("[Registry] agents.json 로드 실패:", err);
    return cache ?? [];
  }
}

export function getAllWorkerAgents(): WorkerAgentDef[] {
  return loadAgents();
}

export function getWorkerAgent(id: string): WorkerAgentDef | undefined {
  return loadAgents().find((a) => a.id === id);
}

export function getDefaultAgent(): WorkerAgentDef | undefined {
  return loadAgents().find((a) => a.isDefault);
}

export function routeToAgent(request: string, projectName?: string): WorkerAgentDef | undefined {
  const agents = loadAgents();
  if (agents.length === 0) return undefined;

  // longest-match 우선: 각 에이전트에서 매칭된 키워드 중 가장 긴 것을 대표로 삼고,
  // 전 에이전트 대표 키워드를 길이 내림차순으로 정렬해 winner를 선택한다.
  // 동점 시 agents.json 배열 뒤(더 구체적으로 등록된) 에이전트를 우선한다.
  // 이 방식은 "리서치" < "딥리서치", "분석" < "심층 분석" 같은 substring 충돌을 방어한다.
  const lower = request.toLowerCase();

  interface RouteCandidate {
    agent: WorkerAgentDef;
    keyword: string;
    agentIndex: number;
  }

  const candidates: RouteCandidate[] = [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    let bestKw: string | undefined;
    for (const kw of agent.routeKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        if (!bestKw || kw.length > bestKw.length) bestKw = kw;
      }
    }
    if (bestKw) candidates.push({ agent, keyword: bestKw, agentIndex: i });
  }

  if (candidates.length === 0) {
    console.log(`[Route] "${request.slice(0, 60)}" → 매칭 실패 (적합한 직원 없음)`);
    return undefined;
  }

  candidates.sort((a, b) => {
    const lenDiff = b.keyword.length - a.keyword.length;
    if (lenDiff !== 0) return lenDiff;
    return b.agentIndex - a.agentIndex; // 동점: 배열 뒤(더 구체적) 에이전트 우선
  });

  const winner = candidates[0];
  console.log(`[Route] "${request.slice(0, 60)}" → ${winner.agent.name} (keyword: "${winner.keyword}")`);
  return winner.agent;
}

export function toAgentConfig(def: WorkerAgentDef): AgentConfig {
  const runtime = resolveWorkerRuntime(def);
  return {
    role: def.id as AgentConfig["role"],
    name: def.name,
    systemPrompt: def.systemPrompt ?? "",
    allowedTools: def.allowedTools,
    maxTurns: def.maxTurns,
    readPaths: def.readPaths,
    writePaths: def.writePaths,
    denyPaths: def.denyPaths,
    bashCommands: def.bashCommands,
    bashPaths: def.bashPaths,
    bashExtraBases: def.bashExtraBases,
    writeExtraBases: def.writeExtraBases,
    readSensitivePaths: def.readSensitivePaths,
    writeSensitivePaths: def.writeSensitivePaths,
    bashSensitivePatterns: def.bashSensitivePatterns,
    maxCacheTokens: def.maxCacheTokens,
    model: runtime.model,
    interactive: def.interactive,
    enablePlaywright: def.enablePlaywright,
    mcpServers: def.mcpServers,
    permissionLevel: def.permissionLevel,
  };
}
