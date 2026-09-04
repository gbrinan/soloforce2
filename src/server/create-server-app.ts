import { Hono } from "hono";
import { z } from "zod";
import { createGoogleReadonlyServerRoutes } from "./google-readonly-server.js";
import { createConnectorRoutes } from "./connectors/routes.js";
import { prepareUpdate, applyPreparedUpdate } from "./update-apply.js";
import { checkUpdatesNow, getUpdateStatus } from "./update-check.js";
import { registerRoutes } from "./routes.js";
import { storeRoutes } from "./routes/store.js";
import { voiceRoutes } from "./routes/voice.js";
import { storeCatalogRoutes } from "./routes/store-catalog.js";
import { storeGithubSkillsRoutes } from "./routes/store-github-skills.js";
import { storeInstalledRoutes } from "./routes/store-installed.js";
import { storePartnerInstallRoutes } from "./routes/store-partner-install.js";

const ConfirmUpdateSchema = z.object({ confirm: z.literal(true) }).passthrough();

export function createServerApp(): Hono {
  const app = new Hono();
  registerRoutes(app);
  app.route("/api/store", storeRoutes);
  app.route("/api/voice", voiceRoutes); // 자비스뷰 음성 TTS/STT/프로필
  app.route("/api/store/catalog", storeCatalogRoutes);
  app.route("/api/store/installed", storeInstalledRoutes);
  app.route("/api/store/github-skills", storeGithubSkillsRoutes);
  app.get("/api/update-status", (context) => context.json(getUpdateStatus()));
  app.post("/api/update-status/check", async (context) => context.json(await checkUpdatesNow()));
  app.post("/api/update-status/prepare", async (context) => context.json(await prepareUpdate()));
  app.post("/api/update-status/apply", async (context) => {
    let body: unknown = null;
    try {
      body = await context.req.json<unknown>();
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (!ConfirmUpdateSchema.safeParse(body).success) {
      return context.json({ ok: false, error: "confirm_required" }, 400);
    }
    return context.json(await applyPreparedUpdate());
  });
  app.route("/api/external", storePartnerInstallRoutes);
  app.route("/api/connections/google-drive", createGoogleReadonlyServerRoutes());
  // Drive·Gmail·Calendar·Notion 커넥터 — 연결 상태/OAuth/토큰 브로커 (docs/connector-tools)
  app.route("/api/connectors", createConnectorRoutes());
  return app;
}
