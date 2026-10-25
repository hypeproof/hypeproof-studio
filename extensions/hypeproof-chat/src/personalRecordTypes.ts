/** Synthetic personal-record protocol presentation. Never contains a bearer or local path. */
export interface RecordMessage { id: string; role: 'user' | 'assistant' | 'tool_status'; content: string; created_at: number }
export interface RecordFile { client_ref: string; name: string; bytes: number; sha256: string; media_type: string }
export interface RecordManifest { schema: 'hps-personal-record/1'; source: { kind: 'synthetic-personal'; task_id: string; revision: number }; title: string; messages: RecordMessage[]; artifacts: RecordFile[] }
export interface RecordScope { service: string; accountId: string; workspaceId: string; projectId: string }
export interface PersonalRecord { id: string; workspace_id: string; project_id: string; state: 'staging' | 'complete'; revision: 1; manifest_sha256: string; created_at: number; completed_at: number | null; manifest?: RecordManifest; artifacts: Array<RecordFile & { id: string }> }
export interface RecordPreview { nonce: string; digest: string; account: string; service: string; destination: string; manifest: RecordManifest; files: Array<RecordFile & { text: string }> }
export interface PersonalRecordsView {
  enabled: true; projectId?: string; busy?: boolean; loaded?: boolean; preview?: RecordPreview;
  pending?: { mutation_id: string; digest: string; title: string };
  records: PersonalRecord[]; selected?: PersonalRecord; message?: string; failed?: boolean; authenticationRequired?: boolean;
}
export interface RecordIntent {
  version: 1; scope: RecordScope; mutation_id: string; manifest: RecordManifest; manifest_sha256: string;
  consent: { purpose: 'personal-record-save'; notice_version: 'synthetic-record-notice-v1'; manifest_sha256: string };
  files: Array<{ client_ref: string; base64: string }>;
}
