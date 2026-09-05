// 커넥터 비밀 금고 — AES-256-GCM으로 토큰을 디스크에 봉인한다.
//
// connection-secret-broker.ts와 같은 암호 방식을 쓰되 별도 모듈이다:
// 그쪽 ConnectionSecretSchema는 `{refreshToken}` strict라 액세스 토큰·만료·워크스페이스
// 메타를 함께 담을 수 없고, 그 모듈은 google-readonly 계약 테스트 4종이 모양을 고정하고
// 있다. (docs/connector-tools/findings.md D1)

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFileSync } from "../utils/atomic-write.js";

export const ConnectorSecretSchema = z.object({
  /** 갱신용 장기 토큰. 노션 내부 통합처럼 없을 수 있다. */
  refreshToken: z.string().min(1).nullable(),
  /** 마지막으로 받은 액세스 토큰. 없으면 다음 호출에서 갱신한다. */
  accessToken: z.string().min(1).nullable(),
  /** 액세스 토큰 만료 시각(epoch ms). null이면 무만료(노션 통합 토큰). */
  accessTokenExpiresAt: z.number().int().nullable(),
}).strict();

export type ConnectorSecret = z.infer<typeof ConnectorSecretSchema>;

const EnvelopeSchema = z.object({
  version: z.literal(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  ciphertext: z.string().min(1),
}).strict();

export class ConnectorVaultError extends Error {
  readonly name = "ConnectorVaultError";
  constructor(readonly reason: "invalid_key" | "unreadable") {
    super(`connector vault: ${reason}`);
  }
}

/**
 * 금고 키 해결. 우선순위:
 *   1. SOLOFORCE_CONNECTION_ENCRYPTION_KEY (base64 32B) — 멀티 인스턴스/도커에서 명시
 *   2. <historyDir>/.connector-key (0600) — 없으면 생성. 단일 사용자 설치본의 기본값.
 * 2번을 두는 이유: 키를 필수로 만들면 커넥터가 "설정 안 하면 안 되는 것"이 되어
 * .sso-secret과 같은 이유로 아무도 안 쓰게 된다.
 */
export function resolveVaultKey(historyDir: string, env: NodeJS.ProcessEnv = process.env): Buffer {
  const fromEnv = env.SOLOFORCE_CONNECTION_ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.byteLength !== 32) throw new ConnectorVaultError("invalid_key");
    return key;
  }
  const keyPath = join(historyDir, ".connector-key");
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    if (key.byteLength !== 32) throw new ConnectorVaultError("invalid_key");
    return key;
  }
  mkdirSync(historyDir, { recursive: true });
  const key = randomBytes(32);
  atomicWriteFileSync(keyPath, `${key.toString("base64")}\n`);
  chmodSync(keyPath, 0o600);
  return key;
}

export class ConnectorVault {
  readonly #dir: string;
  readonly #key: Buffer;

  constructor(options: { readonly directory: string; readonly key: Buffer }) {
    if (options.key.byteLength !== 32) throw new ConnectorVaultError("invalid_key");
    this.#dir = options.directory;
    this.#key = options.key;
    mkdirSync(this.#dir, { recursive: true });
  }

  write(providerId: string, secret: ConnectorSecret): void {
    const parsed = ConnectorSecretSchema.parse(secret);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(parsed), "utf8"), cipher.final()]);
    const path = this.#path(providerId);
    atomicWriteFileSync(path, `${JSON.stringify(EnvelopeSchema.parse({
      version: 1,
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    }), null, 2)}\n`);
    chmodSync(path, 0o600);
  }

  read(providerId: string): ConnectorSecret | null {
    const path = this.#path(providerId);
    if (!existsSync(path)) return null;
    try {
      const envelope = EnvelopeSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
      const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      return ConnectorSecretSchema.parse(JSON.parse(plaintext) as unknown);
    } catch {
      // 키 교체·파일 손상 — 지우지 않는다. 재연결하면 덮어쓰이고, 남겨 두면 원인 추적이 된다.
      throw new ConnectorVaultError("unreadable");
    }
  }

  erase(providerId: string): void {
    const path = this.#path(providerId);
    if (existsSync(path)) rmSync(path);
  }

  #path(providerId: string): string {
    return join(this.#dir, `${providerId}.json`);
  }
}
