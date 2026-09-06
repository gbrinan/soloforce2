export type CorpusFormat = 'text' | 'markdown' | 'csv' | 'json' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'hwpx' | 'image' | 'audio' | 'video' | 'unknown';
export type CorpusRoute = 'text' | 'table' | 'graph' | 'ocr' | 'transcription' | 'review';
export interface CorpusProfile {
  format: CorpusFormat;
  mime: string;
  evidence: string[];
  warnings: string[];
  routes: { route: CorpusRoute; status: 'ready' | 'needs_tool' | 'needs_review'; detail: string }[];
}
export interface CorpusChunk {
  id: string;
  kind: 'text' | 'table';
  locator: string;
  text: string;
  // 표의 값은 문자열로 보존한다. 숫자 변환이나 수식 재계산을 하지 않는다.
  cells?: string[];
}
export interface CorpusSnapshot {
  schemaVersion: 1;
  pipelineVersion: string;
  sourceId: string;
  revision: string;
  contentHash: string;
  provider: 'local' | 'google-drive' | 'notion';
  externalId: string;
  connectionId?: string;
  providerRevision?: string;
  sourceUrl?: string;
  name: string;
  importedAt: string;
  bytes: number;
  // 사용자가 입력한 업무 분류. 추론한 관계를 사실로 승격하지 않는다.
  labels: string[];
  profile: CorpusProfile;
  chunks: CorpusChunk[];
  backup: 'original' | 'export' | 'page_snapshot';
}
export interface CorpusSource extends Omit<CorpusSnapshot, 'chunks'> {
  chunkCount: number;
  enabled: boolean;
  revisions: number;
}
export interface CorpusHit {
  sourceId: string;
  revision: string;
  chunkId: string;
  title: string;
  locator: string;
  text: string;
  score: number;
  signals: ('keyword' | 'vector' | 'graph')[];
}
export interface CorpusSearchResult {
  hits: CorpusHit[];
  mode: 'keyword_graph' | 'keyword_vector_graph';
  warnings: string[];
}
