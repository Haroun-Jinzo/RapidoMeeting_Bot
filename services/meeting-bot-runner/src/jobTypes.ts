export type JobStatus =
  | "pending"
  | "joining"
  | "in_call"
  | "recording"
  | "uploading"
  | "processing"
  | "completed"
  | "failed";

export interface JobState {
  id: string;
  status: JobStatus;
  metadata: Record<string, unknown>;
  message?: string;
  progress?: number;
  session_id?: string;
  logs?: string[];
  error?: string;
  backendResponse?: unknown;
}
