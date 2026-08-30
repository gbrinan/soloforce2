export interface TranscribeLocalOpts { tmpDir?: string; language?: string }
export interface TranscribeLocalResult { text: string; engine?: string; [k: string]: unknown }
export declare function transcribeLocal(path: string, opts?: TranscribeLocalOpts): Promise<TranscribeLocalResult>;
