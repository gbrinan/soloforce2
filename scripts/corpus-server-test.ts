import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';

const root = mkdtempSync(join(tmpdir(), 'corpus-real-server-'));
process.env.MYCREW_HOME = root; process.env.WORKSPACE_ROOT = root; process.env.PROJECTS_FOLDER = 'projects';
delete process.env.CORPUS_EMBED_MODEL;
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
try {
  const { createServerApp } = await import('../src/server/create-server-app.js');
  const { getCorpusService } = await import('../src/server/corpus/runtime.js');
  const { restoreFromZip } = await import('../src/server/data-backup.js');
  const { buildWorkspaceAskContext } = await import('../src/server/ai-search.js');
  const app = createServerApp();
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/api/health`)).status, 200);
    assert.equal((await fetch(`${origin}/api/data/backup`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/data/restore`, { method: 'POST' })).status, 403);
    const form = new FormData(); form.set('file', new File(['검증프로젝트 오로라의 확정 예산은 001200원입니다.'], '검증프로젝트.txt'));
    const imported = await fetch(`${origin}/api/corpus/import/local`, { method: 'POST', headers: { origin }, body: form });
    assert.equal(imported.status, 201, await imported.clone().text());
    const { source } = await imported.json() as { source: { sourceId: string; revision: string } };
    const response = await fetch(`${origin}/api/ai/search?q=${encodeURIComponent('검증프로젝트')}`);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json() as { results: { source: string; snippet: string }[] };
    assert.ok(result.results.some(hit => hit.source === 'corpus' && hit.snippet.includes('001200')));
    const context = await buildWorkspaceAskContext('검증프로젝트', true);
    assert.ok(context.context.includes('001200')); assert.ok(context.sources[0].locator);
    const denied = await buildWorkspaceAskContext('검증프로젝트', false);
    assert.ok(denied.sources.every(hit => hit.source !== 'corpus'));
    const backup = await fetch(`${origin}/api/corpus/sources/${source.sourceId}/backup`);
    const zipPath = join(root, 'restore-fixture.zip'); writeFileSync(zipPath, Buffer.from(await backup.arrayBuffer()));
    rmSync(join(root, 'history', 'corpus', source.sourceId), { force: true, recursive: true });
    assert.equal(getCorpusService().store.list().length, 0);
    assert.equal(restoreFromZip(zipPath).restored, 3);
    assert.equal(getCorpusService().store.snapshot(source.sourceId)?.revision, source.revision);
    assert.ok((await buildWorkspaceAskContext('검증프로젝트', true)).context.includes('001200'));
    console.log('PASS shipped server: health, corpus upload, SQLite-backed unified search, Ask context authorization, backup restore');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
} finally { rmSync(root, { force: true, recursive: true }); }
// 실제 앱 조합의 기존 background watchers/timers는 테스트 종료 시 함께 정리한다.
process.exit(0);
