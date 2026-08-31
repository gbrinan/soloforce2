import { createHash } from "node:crypto";
import ky, { type KyInstance } from "ky";
import {
  GoogleDriveFileListSchema,
  GoogleTokenResponseSchema,
  GoogleUserinfoSchema,
  type GoogleDriveFile,
} from "./google-readonly-schema.js";

export const GOOGLE_DRIVE_METADATA_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_READONLY_SCOPES = ["openid", "email", GOOGLE_DRIVE_METADATA_SCOPE] as const;

type ProviderOptions = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userinfoEndpoint: string;
  readonly driveFilesEndpoint: string;
};

export type AuthorizationTokens = {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly grantedScopes: readonly string[];
};

export type GoogleIdentity = {
  readonly providerSubject: string;
  readonly displayEmail: string;
  readonly emailVerified: boolean;
};

export interface GoogleReadonlyProvider {
  buildAuthorizationUrl(input: { readonly state: string; readonly codeVerifier: string }): string;
  exchangeAuthorizationCode(input: { readonly code: string; readonly codeVerifier: string }): Promise<AuthorizationTokens>;
  fetchIdentity(accessToken: string): Promise<GoogleIdentity>;
  listMetadata(refreshToken: string): Promise<readonly GoogleDriveFile[]>;
}

export class GoogleProviderError extends Error {
  readonly name = "GoogleProviderError";

  constructor(readonly operation: "token_exchange" | "userinfo" | "token_refresh" | "drive_list", options?: ErrorOptions) {
    super(`Google provider request failed: ${operation}`, options);
  }
}

export class GoogleReadonlyHttpProvider implements GoogleReadonlyProvider {
  readonly #options: ProviderOptions;
  readonly #http: KyInstance;

  constructor(options: ProviderOptions) {
    this.#options = options;
    this.#http = ky.create({
      timeout: 10_000,
      totalTimeout: 20_000,
      retry: {
        limit: 1,
        methods: ["get"],
        statusCodes: [408, 429, 500, 502, 503, 504],
      },
    });
  }

  buildAuthorizationUrl(input: { readonly state: string; readonly codeVerifier: string }): string {
    const url = new URL(this.#options.authorizationEndpoint);
    url.searchParams.set("client_id", this.#options.clientId);
    url.searchParams.set("redirect_uri", this.#options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_READONLY_SCOPES.join(" "));
    url.searchParams.set("state", input.state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("code_challenge", createHash("sha256").update(input.codeVerifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeAuthorizationCode(input: { readonly code: string; readonly codeVerifier: string }): Promise<AuthorizationTokens> {
    try {
      const untrusted: unknown = await this.#http.post(this.#options.tokenEndpoint, {
        retry: { limit: 0 },
        body: new URLSearchParams({
          code: input.code,
          client_id: this.#options.clientId,
          client_secret: this.#options.clientSecret,
          redirect_uri: this.#options.redirectUri,
          grant_type: "authorization_code",
          code_verifier: input.codeVerifier,
        }),
      }).json();
      const token = GoogleTokenResponseSchema.parse(untrusted);
      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        grantedScopes: (token.scope ?? "").split(" ").filter((scope) => scope.length > 0)
          // Google은 축약 스코프(email/profile)를 전체 URL로 반환한다 — 요구 목록의 축약형과 맞춰 정규화.
          .map((scope) => scope === "https://www.googleapis.com/auth/userinfo.email" ? "email"
            : scope === "https://www.googleapis.com/auth/userinfo.profile" ? "profile" : scope),
      };
    } catch (error) {
      throw new GoogleProviderError("token_exchange", { cause: error });
    }
  }

  async fetchIdentity(accessToken: string): Promise<GoogleIdentity> {
    try {
      const untrusted: unknown = await this.#http.get(this.#options.userinfoEndpoint, {
        headers: { authorization: `Bearer ${accessToken}` },
      }).json();
      const profile = GoogleUserinfoSchema.parse(untrusted);
      return {
        providerSubject: profile.sub,
        displayEmail: profile.email,
        emailVerified: profile.email_verified,
      };
    } catch (error) {
      throw new GoogleProviderError("userinfo", { cause: error });
    }
  }

  async listMetadata(refreshToken: string): Promise<readonly GoogleDriveFile[]> {
    const accessToken = await this.#refreshAccessToken(refreshToken);
    try {
      const files: GoogleDriveFile[] = [];
      const seenPageTokens = new Set<string>();
      let pageToken: string | undefined;
      do {
        const searchParams: Record<string, string> = {
          q: "trashed = false",
          pageSize: "1000",
          fields: "nextPageToken,files(id,name,mimeType,modifiedTime,parents)",
        };
        if (pageToken !== undefined) searchParams.pageToken = pageToken;
        const untrusted: unknown = await this.#http.get(this.#options.driveFilesEndpoint, {
          headers: { authorization: `Bearer ${accessToken}` },
          searchParams,
        }).json();
        const page = GoogleDriveFileListSchema.parse(untrusted);
        files.push(...page.files);
        pageToken = page.nextPageToken;
        if (pageToken !== undefined) {
          if (seenPageTokens.has(pageToken)) throw new GoogleProviderError("drive_list");
          seenPageTokens.add(pageToken);
        }
      } while (pageToken !== undefined);
      return files;
    } catch (error) {
      if (error instanceof GoogleProviderError) throw error;
      throw new GoogleProviderError("drive_list", { cause: error });
    }
  }

  async #refreshAccessToken(refreshToken: string): Promise<string> {
    try {
      const untrusted: unknown = await this.#http.post(this.#options.tokenEndpoint, {
        retry: { limit: 0 },
        body: new URLSearchParams({
          client_id: this.#options.clientId,
          client_secret: this.#options.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      }).json();
      return GoogleTokenResponseSchema.parse(untrusted).access_token;
    } catch (error) {
      throw new GoogleProviderError("token_refresh", { cause: error });
    }
  }
}
