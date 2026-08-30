import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { HISTORY_DIR, PROJECTS_DIR } from "../config.js";
import { getCurrentSession, isSsoEnabled } from "./auth-google.js";
import { EncryptedConnectionSecretBroker } from "./connection-secret-broker.js";
import type { ConnectedIngestCredential } from "./connected-ingest-auth.js";
import { GoogleConnectionRegistry } from "./google-connection-registry.js";
import {
  GoogleReadonlyHttpProvider,
  type GoogleReadonlyProvider,
} from "./google-readonly-provider.js";
import { createGoogleReadonlyRoutes } from "./google-readonly-routes.js";
import { GoogleReadonlyConnectionService } from "./google-readonly-service.js";
import { OwnerPrincipalStore } from "./owner-principal-store.js";

const CALLBACK_PATH = "/api/connections/google-drive/oauth/callback";
const RECENT_AUTH_MS = 15 * 60 * 1000;

const ProjectPathSchema = z.string().min(1).max(200).refine((value) => {
  const segments = value.split("/");
  return segments.length <= 2
    && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes(":"))
    && !value.includes("\\");
});

const EncryptionKeySchema = z.string()
  .regex(/^[A-Za-z0-9+/]{43}=$/)
  .transform((value) => Buffer.from(value, "base64"))
  .refine((value) => value.byteLength === 32);

const ConnectorConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  callbackUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (url.protocol === "https:" || localHttp)
      && url.pathname === CALLBACK_PATH
      && url.search === ""
      && url.hash === "";
  }),
  projectId: ProjectPathSchema,
  encryptionKey: EncryptionKeySchema,
}).strict();

type ServerRouteOptions = {
  readonly env: NodeJS.ProcessEnv;
  readonly storage: {
    readonly historyDirectory: string;
    readonly projectsDirectory: string;
  };
  readonly provider?: GoogleReadonlyProvider;
  readonly now?: () => string;
};

type CredentialResolverOptions = {
  readonly registry: GoogleConnectionRegistry;
  readonly trustedOrigin: string;
  readonly localOwnerAllowed: boolean;
  readonly now: () => string;
};

export function createGoogleReadonlyServerRoutes(options: ServerRouteOptions = productionOptions()): Hono {
  const app = new Hono();
  const config = ConnectorConfigSchema.safeParse({
    clientId: options.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_ID,
    clientSecret: options.env.GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET,
    callbackUrl: options.env.GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL,
    projectId: options.env.GOOGLE_DRIVE_CONNECTOR_PROJECT_ID,
    encryptionKey: options.env.SOLOFORCE_CONNECTION_ENCRYPTION_KEY,
  });
  if (!config.success) return disabledRoutes(app);
  const projectRoot = resolveProjectRoot(options.storage.projectsDirectory, config.data.projectId);
  if (projectRoot === null) return disabledRoutes(app);

  const now = options.now ?? (() => new Date().toISOString());
  const registry = new GoogleConnectionRegistry({ projectRoot, now });
  const broker = new EncryptedConnectionSecretBroker({
    rootDirectory: resolve(projectRoot, ".connections", "secrets"),
    encryptionKey: config.data.encryptionKey,
  });
  const provider = options.provider ?? new GoogleReadonlyHttpProvider({
    clientId: config.data.clientId,
    clientSecret: config.data.clientSecret,
    redirectUri: config.data.callbackUrl,
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    driveFilesEndpoint: "https://www.googleapis.com/drive/v3/files",
  });
  const service = new GoogleReadonlyConnectionService({
    projectRoot,
    projectId: config.data.projectId,
    registry,
    broker,
    provider,
    now,
  });
  const ownerPrincipals = new OwnerPrincipalStore({
    historyDirectory: options.storage.historyDirectory,
    now,
  });
  const callback = new URL(config.data.callbackUrl);
  const credentialResolverOptions: CredentialResolverOptions = {
    registry,
    trustedOrigin: callback.origin,
    localOwnerAllowed: callback.hostname === "localhost" || callback.hostname === "127.0.0.1",
    now,
  };

  app.get("/status", (context) => context.json({ configured: true, projectId: config.data.projectId }));
  app.route("/", createGoogleReadonlyRoutes({
    projectId: config.data.projectId,
    service,
    resolveCredential: (context) => resolveCredential(context, credentialResolverOptions),
    resolveOwnerPrincipalId: () => ownerPrincipals.getOrCreate(),
  }));
  return app;
}

function productionOptions(): ServerRouteOptions {
  return {
    env: process.env,
    storage: { historyDirectory: HISTORY_DIR, projectsDirectory: PROJECTS_DIR },
  };
}

function disabledRoutes(app: Hono): Hono {
  app.get("/status", (context) => context.json({ configured: false }));
  app.all("*", (context) => context.json({ error: "google_connector_not_configured" }, 503));
  return app;
}

function resolveProjectRoot(projectsDirectory: string, projectId: string): string | null {
  if (!existsSync(projectsDirectory)) return null;
  const root = realpathSync(projectsDirectory);
  const candidate = resolve(root, ...projectId.split("/"));
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) return null;
  const projectRoot = realpathSync(candidate);
  return projectRoot.startsWith(`${root}/`) || projectRoot.startsWith(`${root}\\`)
    ? projectRoot
    : null;
}

function resolveCredential(
  context: Context,
  options: CredentialResolverOptions,
): ConnectedIngestCredential {
  if (context.req.path.endsWith("/oauth/callback")) {
    return options.registry.hasActiveTransaction(context.req.query("state") ?? "")
      ? { kind: "oauth_transaction", state: "active", provider: "google-drive" }
      : { kind: "invalid" };
  }
  const csrfValid = context.req.header("Origin") === options.trustedOrigin;
  if (!isSsoEnabled()) {
    return options.localOwnerAllowed
      ? { kind: "owner", csrfValid, recentAuth: true }
      : { kind: "none" };
  }
  const session = getCurrentSession(context);
  if (session === null) return { kind: "none" };
  return {
    kind: "owner",
    csrfValid,
    recentAuth: Date.parse(options.now()) - session.createdAt <= RECENT_AUTH_MS,
  };
}
