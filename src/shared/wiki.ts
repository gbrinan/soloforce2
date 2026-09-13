export interface WikiScope { orgId: string; projectId: string }
export interface WikiUnit { unit_id: string; locator: string; text: string; cells?: string[] }
export interface WikiRequest {
  schema_version: string; request_id: string; source_id: string; source_revision: string;
  org_id: string; project_id: string; model: string; prompt: string; units: WikiUnit[]; structure: unknown;
}
export interface WikiNeed {
  /** Optional for legacy responses; allowed kinds are validated by the pinned core. */
  kind?: string;
  title: string; statement: string; details: string[]; departments: string[];
  patterns: string[]; evidence: string[]; claim_status: 'source_reported';
}
export interface WikiResponse {
  request_id: string;
  results: { unit_id: string; status: 'analyzed' | 'ambiguous'; needs: WikiNeed[] }[];
}
export interface WikiPayload {
  schemaVersion: 1; upstreamCommit: string; scope: WikiScope;
  source: { sourceId: string; revision: string; sha256: string; parserVersion: string; name: string };
  coverage: { totalUnits: number; selectedUnitIds: string[]; omittedUnitIds: string[]; pendingRoutes: string[] };
  requests: WikiRequest[];
}
export interface WikiCandidate {
  id: string; requestId: string; response: WikiResponse;
  artifacts: Record<string, string>;
  validation: { structural_pass: boolean; semantic_review: 'pending'; published: false; needs: number; ambiguous_units: string[] };
}
export interface WikiJob {
  id: string; payload: WikiPayload; candidates: WikiCandidate[];
  sourceState: 'unchanged' | 'changed'; state: 'awaiting_response' | 'partial' | 'candidate_saved';
  semanticReview: 'pending'; published: false; driveSync: 'not_configured';
}
export interface WikiJobSummary {
  id: string; sourceState: 'unchanged' | 'changed'; candidateCount: number; requestCount: number;
}
