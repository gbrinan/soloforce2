import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';
import { CorpusStore } from '../src/server/corpus/store.js';
import { CorpusService } from '../src/server/corpus/service.js';
import { hash } from '../src/server/corpus/extract.js';
import { WikiService } from '../src/server/wiki/service.js';
import { createWikiRoutes } from '../src/server/wiki/routes.js';
import { callWikiCore, verifyWikiBundle } from '../src/server/wiki/bridge.js';
import type { WikiJob, WikiResponse } from '../src/shared/wiki.js';

const root = mkdtempSync(join(tmpdir(), 'wiki-adapter-'));
const corpus = new CorpusStore(join(root, 'corpus'));
const importer = new CorpusService(corpus);
let authorized = true;
const service = new WikiService(join(root, 'wiki'), corpus, () => authorized);
const scope = { orgId: 'synthetic', projectId: 'boundary' };
const expectCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;
const json = (body: unknown, origin?: string): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
function responseFor(job: WikiJob): WikiResponse {
  const request = job.payload.requests[0];
  return { request_id: request.request_id, results: request.units.map(unit => ({ unit_id: unit.unit_id, status: 'analyzed', needs: [{
    title: '승인 전 초안', statement: '시스템은 초안을 작성하고 최종 주문은 사람이 실행한다.',
    details: ['001200원 표기와 승인 조건 보존'], departments: [], patterns: [], evidence: [unit.text], claim_status: 'source_reported',
  }] })) };
}

try {
  verifyWikiBundle();
  const runtime = await callWikiCore<{ python: string }>({ operation: 'probe' });
  assert.match(runtime.python, /^3\./);
  const original = Buffer.from('# 가상 자료\n\n초안 금액은 001200원이며, 최종 주문은 사람이 실행한다.\n\n다른 부서 내용은 별도 확인한다.');
  const source = await importer.import({ provider: 'local', externalId: 'synthetic.md', name: 'synthetic.md', mime: 'text/markdown', bytes: original });
  const snapshot = corpus.snapshot(source.sourceId)!;
  const selected = snapshot.chunks.slice(0, 1).map(chunk => chunk.id);
  const input = { scope, sourceId: source.sourceId, expectedRevision: source.revision, unitIds: selected, model: 'synthetic-host' };
  const job = await service.prepare(input);
  assert.equal(job.payload.source.sha256, snapshot.contentHash);
  assert.equal(job.payload.requests[0].source_revision, snapshot.contentHash);
  assert.equal(job.payload.requests[0].units[0].locator, snapshot.chunks[0].locator);
  assert.deepEqual(job.payload.coverage.omittedUnitIds, snapshot.chunks.slice(1).map(chunk => chunk.id));
  assert.equal((await service.prepare(input)).id, job.id);
  assert.notEqual((await service.prepare({ ...input, model: 'other-host' })).id, job.id);
  assert.deepEqual(readFileSync(join(corpus.root, source.sourceId, source.revision, 'original.bin')), original);
  console.log('PASS pinned Python, Unicode, source/revision/locator mapping, coverage, request idempotency');

  const response = responseFor(job);
  const badQuote = structuredClone(response); badQuote.results[0].needs[0].evidence = ['원문에 없는 승인'];
  await assert.rejects(service.submit(job.id, { scope, response: badQuote }), expectCode('wiki_response_or_units_invalid'));
  await assert.rejects(service.submit(job.id, { scope, response: { ...response, results: [] } }), expectCode('wiki_response_or_units_invalid'));
  await assert.rejects(service.submit(job.id, { scope, response: { ...response, results: [...response.results, response.results[0]] } }), expectCode('wiki_response_or_units_invalid'));
  await assert.rejects(service.submit(job.id, { scope: { ...scope, orgId: 'other' }, response }), expectCode('wiki_job_not_found'));
  await assert.rejects(service.prepare({ ...input, unitIds: [...selected, ...selected] }), expectCode('wiki_duplicate_units'));
  await assert.rejects(service.prepare({ ...input, unitIds: ['invented'] }), expectCode('wiki_unknown_units'));
  await assert.rejects(service.prepare({ ...input, scope: { ...scope, orgId: '../escape' } }));
  await assert.rejects(service.prepare({ ...input, scope: { ...scope, orgId: 'aux' } }));
  await assert.rejects(service.prepare({ ...input, scope: { ...scope, orgId: 'Example' } }));
  const claimedApproval = structuredClone(response); (claimedApproval.results[0].needs[0] as { claim_status: string }).claim_status = 'approved';
  await assert.rejects(service.submit(job.id, { scope, response: claimedApproval }));
  assert.equal(service.read(scope, job.id).candidates.length, 0);
  console.log('PASS missing/duplicate units, invalid quote, wrong scope, path traversal, fabricated approval rejected without candidate writes');

  const saved = await service.submit(job.id, { scope, response });
  assert.equal(saved.candidates.length, 1);
  assert.equal((await service.submit(job.id, { scope, response })).candidates.length, 1);
  assert.equal(saved.published, false); assert.equal(saved.semanticReview, 'pending');
  const reversed = structuredClone(response); reversed.results[0].needs[0].statement = '시스템이 최종 주문을 자동 실행한다.';
  const reversedJob = await service.submit(job.id, { scope, response: reversed });
  assert.equal(reversedJob.published, false); assert.equal(reversedJob.candidates[1].validation.semantic_review, 'pending');
  assert.equal(existsSync(join(root, 'wiki', 'organizations', scope.orgId, 'projects', scope.projectId, 'knowledge')), false);
  const zip = new AdmZip(service.backup(scope, job.id));
  const entry = zip.getEntries().find(entry => entry.entryName.endsWith('/C0001.json'))!;
  const knowledge = JSON.parse(entry.getData().toString('utf8'));
  assert.equal(knowledge.lifecycle, 'candidate'); assert.equal(knowledge.provenance.locator, snapshot.chunks[0].locator);
  assert.equal(knowledge.provenance.source_revision, snapshot.contentHash);
  const restored = new WikiService(join(root, 'wiki'), corpus, () => authorized);
  assert.equal(restored.read(scope, job.id).candidates.length, 2);
  const summary = restored.list(scope, source.sourceId).find(item => item.id === job.id)!;
  assert.equal(summary.candidateCount, 2);
  assert.equal('payload' in summary || 'candidates' in summary, false);
  console.log('PASS candidate readback, retry, provenance export; semantic reversal remains unapproved candidate');

  const file = join(service.root, 'organizations', scope.orgId, 'projects', scope.projectId, 'changes', job.id, 'candidates', saved.candidates[0].id, 'C0001.json');
  const before = readFileSync(file); writeFileSync(file, '{}');
  assert.throws(() => service.read(scope, job.id), expectCode('wiki_artifact_changed')); writeFileSync(file, before);
  const originalPath = join(corpus.root, source.sourceId, source.revision, 'original.bin');
  const snapshotPath = join(corpus.root, source.sourceId, source.revision, 'snapshot.json');
  const savedSnapshot = readFileSync(snapshotPath);
  const changedBytes = Buffer.from('변조된 원본');
  writeFileSync(originalPath, changedBytes);
  assert.throws(() => service.read(scope, job.id), expectCode('wiki_original_changed'));
  writeFileSync(snapshotPath, JSON.stringify({ ...snapshot, contentHash: hash(changedBytes) }));
  assert.equal(service.read(scope, job.id).sourceState, 'changed');
  await assert.rejects(service.submit(job.id, { scope, response }), expectCode('wiki_source_changed'));
  writeFileSync(originalPath, original); writeFileSync(snapshotPath, savedSnapshot);
  authorized = false;
  assert.throws(() => service.read(scope, job.id), expectCode('wiki_source_unavailable'));
  assert.throws(() => service.backup(scope, job.id), expectCode('wiki_source_unavailable'));
  authorized = true;
  const lateSubmission = service.submit(job.id, { scope, response }); authorized = false;
  await assert.rejects(lateSubmission, expectCode('wiki_source_unavailable')); authorized = true;
  corpus.setEnabled(source.sourceId, false);
  assert.throws(() => service.read(scope, job.id), expectCode('wiki_source_unavailable')); corpus.setEnabled(source.sourceId, true);
  console.log('PASS artifact tamper, revoked source, revocation during validation, disabled source');

  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('표');
  sheet.addRow(['코드', '조건']); sheet.addRow(['0012', '사람 승인 후 발송']);
  const table = await importer.import({ provider: 'local', externalId: 'table.xlsx', name: 'table.xlsx', mime: '', bytes: Buffer.from(await book.xlsx.writeBuffer()) });
  const tableSnapshot = corpus.snapshot(table.sourceId)!;
  const tableJob = await service.prepare({ ...input, sourceId: table.sourceId, expectedRevision: table.revision, unitIds: tableSnapshot.chunks.map(chunk => chunk.id) });
  assert.ok(tableJob.payload.requests.some(request => request.units.some(unit => unit.text.includes('0012') && unit.cells?.includes('0012'))));
  console.log('PASS spreadsheet values and structural source units survive handoff');

  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.MYCREW_REQUIRE_SSO;
  const app = new Hono(); app.route('/api/wiki', createWikiRoutes({ service }));
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/api/wiki/prepare`, json(input))).status, 403);
    assert.equal((await fetch(`${origin}/api/wiki/capabilities`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const capability = await fetch(`${origin}/api/wiki/capabilities`); assert.equal(capability.headers.get('cache-control'), 'no-store');
    assert.equal((await capability.json() as { available: boolean }).available, true);
    const prepared = await fetch(`${origin}/api/wiki/prepare`, json(input, origin)); assert.equal(prepared.status, 201);
    const submission = await fetch(`${origin}/api/wiki/jobs/${job.id}/submit`, json({ scope, response }, origin)); assert.equal(submission.status, 201);
    const query = new URLSearchParams(scope);
    const listing = await fetch(`${origin}/api/wiki/jobs?${query}&sourceId=${source.sourceId}`); assert.equal(listing.status, 200);
    const download = await fetch(`${origin}/api/wiki/jobs/${job.id}/backup?${query}`); assert.equal(download.status, 200);
    assert.ok(new AdmZip(Buffer.from(await download.arrayBuffer())).getEntries().length > 5);
    const other = await fetch(`${origin}/api/wiki/jobs/${job.id}?orgId=other&projectId=boundary`); assert.equal(other.status, 404);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  console.log('PASS real HTTP owner/origin boundary, capabilities, prepare/submit/list/backup');

  await importer.import({ provider: 'local', externalId: 'synthetic.md', name: 'synthetic.md', mime: 'text/markdown', bytes: Buffer.from('수정된 원문. 이전 판의 응답을 재사용하지 않는다.') });
  await assert.rejects(service.submit(job.id, { scope, response }), expectCode('wiki_source_changed'));
  await assert.rejects(service.prepare(input), expectCode('wiki_source_changed'));
  assert.equal(service.read(scope, job.id).sourceState, 'changed');
  assert.equal(service.read(scope, job.id).candidates.length, 2);
  console.log('PASS changed source blocks new writes and preserves previous candidates');
} finally { rmSync(root, { recursive: true, force: true }); }
