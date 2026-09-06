import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import { z } from 'zod';
import { getCurrentSession, isSsoEnabled } from '../auth-google.js';
import { CorpusError, MAX_SOURCE_BYTES } from './extract.js';
import { NotionReadonlyProvider } from './notion.js';
import { type CorpusService } from './service.js';
import { searchCorpus } from './search.js';
import { corpusSourceAllowed, getCorpusService } from './runtime.js';
import type { CorpusSnapshot } from '../../shared/corpus.js';

export const CorpusLabelsSchema = z.array(z.string().trim().min(1).max(80)).max(20).default([]);
export function corpusAccessAllowed(c: Context, mutation = false): boolean {
  const url = new URL(c.req.url);
  if (c.req.header('Sec-Fetch-Site') === 'cross-site') return false;
  if (mutation && c.req.header('Origin') !== url.origin) return false;
  if (isSsoEnabled()) return getCurrentSession(c) !== null;
  try {
    const address = getConnInfo(c).remote.address;
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '') && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

interface Options {
  service?: CorpusService;
  notion?: NotionReadonlyProvider;
  authorize?: (c: Context, mutation: boolean) => boolean;
  allowed?: (snapshot: CorpusSnapshot) => boolean;
}
export function createCorpusRoutes(options: Options = {}): Hono {
  const app = new Hono();
  const service = options.service ?? getCorpusService();
  const authorize = options.authorize ?? corpusAccessAllowed;
  const allowed = options.allowed ?? corpusSourceAllowed;
  const notion = options.notion ?? (process.env.NOTION_ACCESS_TOKEN ? new NotionReadonlyProvider(process.env.NOTION_ACCESS_TOKEN) : undefined);
  let busy = false;
  app.use('*', async (c, next) => {
    if (!authorize(c, !['GET', 'HEAD'].includes(c.req.method))) return c.json({ error: 'owner_same_origin_required' }, 403);
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.use('*', bodyLimit({ maxSize: MAX_SOURCE_BYTES + 64 * 1024, onError: c => c.json({ error: 'file_too_large' }, 413) }));
  app.onError((error, c) => {
    if (error instanceof CorpusError) return c.json({ error: error.code }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'invalid_request' }, 400);
    return c.json({ error: 'corpus_operation_failed' }, 500);
  });
  app.get('/status', c => c.json({ maxFileBytes: MAX_SOURCE_BYTES, notionConfigured: Boolean(notion), embeddingConfigured: Boolean(service.embedder), embeddingModel: service.embedder?.model ?? null }));
  app.get('/sources', c => c.json({ sources: service.store.list().map(source => ({ ...source, retrievalAllowed: allowed(service.store.snapshot(source.sourceId)!) })) }));
  app.post('/import/local', async c => {
    const form = await c.req.formData(); const file = form.get('file');
    if (!(file instanceof File)) throw new CorpusError('file_required', 400);
    const labels = CorpusLabelsSchema.parse(JSON.parse(String(form.get('labels') ?? '[]')));
    const source = await service.import({ provider: 'local', externalId: file.name, name: file.name, mime: file.type, bytes: Buffer.from(await file.arrayBuffer()), labels });
    return c.json({ source }, 201);
  });
  app.post('/import/notion', async c => {
    if (!notion) throw new CorpusError('notion_not_configured', 503);
    const body = z.object({ page: z.string().min(1).max(1000), labels: CorpusLabelsSchema }).strict().parse(await c.req.json());
    if (busy) throw new CorpusError('import_busy_retry', 409);
    busy = true;
    try { return c.json({ source: await service.import(await notion.readPage(body.page, body.labels)) }, 201); }
    finally { busy = false; }
  });
  app.get('/search', async c => c.json(await searchCorpus(service.store, c.req.query('q') ?? '', { embedder: service.embedder, allowed })));
  app.get('/sources/:id', c => {
    const snapshot = service.store.snapshot(c.req.param('id'), c.req.query('revision'));
    if (!snapshot) throw new CorpusError('source_not_found', 404);
    if (!allowed(snapshot)) throw new CorpusError('connection_inactive', 403);
    return c.json({ snapshot, revisions: service.store.revisions(snapshot.sourceId) });
  });
  app.post('/sources/:id/enabled', async c => {
    const body = z.object({ enabled: z.boolean() }).strict().parse(await c.req.json());
    service.store.setEnabled(c.req.param('id'), body.enabled); return c.json({ ok: true });
  });
  app.post('/sources/:id/vectors', async c => {
    if (busy) throw new CorpusError('import_busy_retry', 409);
    busy = true;
    try { return c.json(await service.indexVectors(c.req.param('id'), allowed)); }
    finally { busy = false; }
  });
  app.get('/sources/:id/backup', c => {
    const bytes = service.store.backup(c.req.param('id'));
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', 'attachment; filename="corpus-source-backup.zip"');
    return c.body(new Uint8Array(bytes));
  });
  return app;
}
