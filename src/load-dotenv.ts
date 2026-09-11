// .env 로더 — 부팅(src/index.ts)과 스크립트(scripts/*)가 공유하는 단일 구현.
//
// ★ 이 모듈은 node 내장 외에 아무것도 import하지 않는다. src/config.ts는 모듈 평가 시점에
// process.env를 읽어 MYCREW_HOME·WORKSPACE_ROOT·CLAUDE_PATH를 굳히므로, config.ts가
// 평가되기 **전에** .env가 적용돼야 한다. 여기서 무언가를 import하면 그 그래프에 config.ts가
// 섞여 들어와 .env를 못 본 값이 굳을 수 있다. (src/index.ts가 서버를 동적 import하는 이유)

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 프로젝트 루트의 .env를 process.env에 실는다.
 * 이미 있는 키는 덮지 않는다 — 실제 환경변수가 .env보다 우선이다.
 */
export function loadDotenv(): void {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim();
  }
}
