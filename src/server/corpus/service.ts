import type { CorpusSnapshot, CorpusSource } from '../../shared/corpus.js';
import { CorpusError, extract, hash, MAX_SOURCE_BYTES, PIPELINE_VERSION } from './extract.js';
import { type CorpusEmbedder, validateVectors } from './search.js';
import { CorpusStore } from './store.js';

export interface CorpusInput {
  provider: CorpusSnapshot['provider']; externalId: string; name: string; mime: string; bytes: Buffer;
  labels?: string[]; connectionId?: string; providerRevision?: string; sourceUrl?: string;
  backup?: CorpusSnapshot['backup']; extracted?: Awaited<ReturnType<typeof extract>>;
}
export class CorpusService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly store: CorpusStore, readonly embedder?: CorpusEmbedder) {}
  import(input: CorpusInput, stillAuthorized: () => boolean = () => true): Promise<CorpusSource> {
    const run = this.queue.then(async () => {
      if (!input.bytes.length) throw new CorpusError('empty_file', 400);
      if (input.bytes.length > MAX_SOURCE_BYTES) throw new CorpusError('file_too_large', 413);
      const labels = [...new Set((input.labels ?? []).map(label => label.normalize('NFKC').trim()).filter(Boolean))].sort();
      if (labels.length > 20 || labels.some(label => label.length > 80)) throw new CorpusError('labels_limit', 400);
      if (!input.name || input.name.length > 250 || input.externalId.length > 1000) throw new CorpusError('invalid_source_name', 400);
      const sourceId = hash(`${input.provider}\0${input.connectionId ?? ''}\0${input.externalId}`);
      const contentHash = hash(input.bytes);
      const revision = hash(JSON.stringify({ contentHash, version: PIPELINE_VERSION, labels, providerRevision: input.providerRevision, name: input.name, mime: input.mime }));
      const parsed = input.extracted ?? await extract(input.name, input.mime, input.bytes, labels);
      if (!stillAuthorized()) throw new CorpusError('connection_inactive', 403);
      const snapshot: CorpusSnapshot = {
        schemaVersion: 1, pipelineVersion: PIPELINE_VERSION, sourceId, revision, contentHash,
        provider: input.provider, externalId: input.externalId, name: input.name, importedAt: new Date().toISOString(),
        connectionId: input.connectionId, providerRevision: input.providerRevision, sourceUrl: input.sourceUrl,
        labels, bytes: input.bytes.length, ...parsed, backup: input.backup ?? 'original',
      };
      return this.store.commit(snapshot, input.bytes);
    });
    this.queue = run.catch(() => {});
    return run;
  }
  async indexVectors(id: string, allowed: (snapshot: CorpusSnapshot) => boolean = () => true): Promise<{ chunks: number; model: string }> {
    if (!this.embedder) throw new CorpusError('local_embedding_not_configured', 503);
    const snapshot = this.store.snapshot(id);
    if (!snapshot) throw new CorpusError('source_not_found', 404);
    if (!allowed(snapshot) || !this.store.list().find(s => s.sourceId === id)?.enabled) throw new CorpusError('source_inactive', 403);
    if (!snapshot.chunks.length) throw new CorpusError('no_extracted_chunks', 409);
    if (snapshot.chunks.length > 1000) throw new CorpusError('vector_index_limit_1000_chunks', 413);
    const vectors = await this.embedder.embed(snapshot.chunks.map(c => `${snapshot.name}\n${c.text}`));
    if (!validateVectors(vectors, snapshot.chunks.length)) throw new CorpusError('invalid_embedding', 502);
    if (!allowed(snapshot) || !this.store.list().find(s => s.sourceId === id)?.enabled) throw new CorpusError('source_inactive', 403);
    this.store.writeVectors(id, snapshot.revision, this.embedder.model, vectors);
    return { chunks: vectors.length, model: this.embedder.model };
  }
}
