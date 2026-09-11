// ※ 여기서 import하는 것은 node 내장과 load-dotenv뿐이어야 한다 — config.ts가 모듈 평가
// 시점에 process.env를 굳히므로, .env가 적용되기 전에 그 그래프가 딸려오면 안 된다.
// (아래 server/index.js를 동적 import하는 이유이기도 하다)
import { loadDotenv } from "./load-dotenv.js";

loadDotenv();

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
