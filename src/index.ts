import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// .env 로드
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim();
  }
}

// 인자 파싱
const args = process.argv.slice(2);
// PORT 우선, MYCREW_PORT를 alias로 인식 (작업지시 §13: MYCREW_PORT 기본 3456)
const portEnv = process.env.PORT ?? process.env.MYCREW_PORT;
let port = portEnv ? parseInt(portEnv, 10) : 3456;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
}

const { startServer } = await import("./server/index.js");
startServer(port);
