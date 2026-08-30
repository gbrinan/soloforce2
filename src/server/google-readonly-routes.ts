import { Hono, type Context } from "hono";
import {
  connectedIngestAuth,
  type ConnectedIngestCredential,
  type ConnectedIngestPolicy,
} from "./connected-ingest-auth.js";
import {
  CompleteGoogleConnectionInputSchema,
  GoogleMetadataIngestInputSchema,
} from "./google-readonly-schema.js";
import {
  GoogleReadonlyConnectionService,
  type CompleteConnectionResult,
  type MetadataIngestResult,
} from "./google-readonly-service.js";
import { ConnectionIdSchema } from "./reversible-ingest-schema.js";

type RouteOptions = {
  readonly projectId: string;
  readonly service: GoogleReadonlyConnectionService;
  readonly resolveCredential: (context: Context) => ConnectedIngestCredential | Promise<ConnectedIngestCredential>;
  readonly resolveOwnerPrincipalId: (context: Context) => string | null;
};

export function createGoogleReadonlyRoutes(options: RouteOptions): Hono {
  const app = new Hono();

  app.post(
    "/oauth/start",
    auth(options, () => ({ kind: "owner_mutation" })),
    (c) => {
      const ownerPrincipalId = options.resolveOwnerPrincipalId(c);
      if (ownerPrincipalId === null) return c.json({ error: "owner_principal_missing" }, 401);
      return c.json(options.service.startConnection({ ownerPrincipalId }));
    },
  );

  app.get(
    "/oauth/callback",
    auth(options, () => ({ kind: "oauth_callback", provider: "google-drive" })),
    async (c) => {
      const input = CompleteGoogleConnectionInputSchema.safeParse({
        state: c.req.query("state"),
        code: c.req.query("code"),
      });
      if (!input.success) return c.json({ error: "invalid_oauth_callback" }, 400);
      return completeResponse(c, await options.service.completeConnection(input.data));
    },
  );

  app.post(
    "/:connectionId/ingest",
    auth(options, (c) => ({
      kind: "agent_or_owner",
      capability: "ingest.run",
      resource: {
        projectId: { value: options.projectId },
        connectionId: { value: c.req.param("connectionId") ?? "" },
      },
    })),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json<unknown>();
      } catch (error) {
        if (error instanceof SyntaxError) return c.json({ error: "invalid_json" }, 400);
        throw error;
      }
      const input = GoogleMetadataIngestInputSchema.safeParse({
        ...(typeof body === "object" && body !== null ? body : {}),
        connectionId: c.req.param("connectionId"),
      });
      if (!input.success) return c.json({ error: "invalid_ingest_request" }, 400);
      return ingestResponse(c, await options.service.ingestMetadata(input.data));
    },
  );

  app.post(
    "/:connectionId/revoke",
    auth(options, () => ({ kind: "owner_mutation" })),
    (c) => {
      const connectionId = ConnectionIdSchema.safeParse(c.req.param("connectionId"));
      if (!connectionId.success) return c.json({ error: "invalid_connection_id" }, 400);
      options.service.revokeConnection(connectionId.data);
      return c.body(null, 204);
    },
  );

  return app;
}

function auth(
  options: RouteOptions,
  resolvePolicy: (context: Context) => ConnectedIngestPolicy,
) {
  return connectedIngestAuth({
    resolvePolicy,
    resolveCredential: options.resolveCredential,
  });
}

function completeResponse(c: Context, result: CompleteConnectionResult): Response {
  switch (result.kind) {
    case "connected":
      return c.json({
        connection: {
          connectionId: result.connection.connectionId,
          provider: result.connection.provider,
          displayEmail: result.connection.displayEmail,
          state: result.connection.state,
        },
      }, 201);
    case "denied":
      return c.json({ error: result.reason }, result.reason === "provider_failure" ? 502 : 400);
    default:
      return assertNever(result);
  }
}

function ingestResponse(c: Context, result: MetadataIngestResult): Response {
  switch (result.kind) {
    case "prepared":
    case "committed":
    case "rolled_back":
      return c.json(result, 200);
    case "conflict":
      return c.json(result, 409);
    case "denied":
      return c.json(result, result.reason === "provider_failure" ? 502 : 403);
    default:
      return assertNever(result);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled Google read-only route result: ${JSON.stringify(value)}`);
}
