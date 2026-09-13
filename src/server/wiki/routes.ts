import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { join } from 'node:path';
import { HISTORY_DIR } from '../../config.js';
import { CorpusError } from '../corpus/extract.js';
import { corpusAccessAllowed } from '../corpus/routes.js';
import { corpusSourceAllowed, getCorpusService } from '../corpus/runtime.js';
import { callWikiCore, UPSTREAM_COMMIT } from './bridge.js';
import { WikiScopeSchema, WikiService } from './service.js';

export function createWikiRoutes(options: { service?: WikiService; authorize?: (c: Context, mutation: boolean) => boolean } = {}): Hono {
  const app = new Hono();
  const service = options.service ?? new WikiService(join(HISTORY_DIR, 'wiki'), getCorpusService().store, corpusSourceAllowed);
  const authorize = options.authorize ?? corpusAccessAllowed;
  let busy = false;
  const scope = (c: Context) => WikiScopeSchema.parse({ orgId: c.req.query('orgId'), projectId: c.req.query('projectId') });
  app.use('*', async (c, next) => {
    if (!authorize(c, !['GET', 'HEAD'].includes(c.req.method))) return c.json({ error: 'owner_same_origin_required' }, 403);
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: c => c.json({ error: 'wiki_batch_too_large' }, 413) }));
  app.onError((error, c) => {
    if (error instanceof CorpusError) return c.json({ error: error.code }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid_request' }, 400);
    return c.json({ error: 'wiki_operation_failed' }, 500);
  });
  app.get('/capabilities', async c => {
    try {
      const runtime = await callWikiCore<{ python: string }>({ operation: 'probe' });
      return c.json({ available: true, python: runtime.python, upstreamCommit: UPSTREAM_COMMIT, candidateBuild: true, publish: false, driveSync: false });
    } catch (error) {
      return c.json({ available: false, error: error instanceof CorpusError ? error.code : 'wiki_core_failed', upstreamCommit: UPSTREAM_COMMIT, candidateBuild: false, publish: false, driveSync: false });
    }
  });
  app.get('/jobs', c => c.json({ jobs: service.list(scope(c), c.req.query('sourceId') ?? '') }));
  app.get('/jobs/:id', c => c.json({ job: service.read(scope(c), c.req.param('id')) }));
  app.post('/prepare', async c => {
    if (busy) throw new CorpusError('wiki_busy_retry', 409);
    busy = true;
    try { return c.json({ job: await service.prepare(await c.req.json()) }, 201); }
    finally { busy = false; }
  });
  app.post('/jobs/:id/submit', async c => {
    if (busy) throw new CorpusError('wiki_busy_retry', 409);
    busy = true;
    try { return c.json({ job: await service.submit(c.req.param('id'), await c.req.json()) }, 201); }
    finally { busy = false; }
  });
  app.get('/jobs/:id/backup', c => {
    const bytes = service.backup(scope(c), c.req.param('id'));
    c.header('Content-Type', 'application/zip'); c.header('Content-Disposition', 'attachment; filename="ingestiger-candidates.zip"');
    return c.body(new Uint8Array(bytes));
  });
  return app;
}
