import type { JobState } from "./jobTypes";

export function appendJobLog(job: JobState, message: string): void {
  if (!job.logs) job.logs = [];
  const last = job.logs[job.logs.length - 1];
  if (last !== message) {
    job.logs.push(message);
  }
  console.log(message);
}

export function setJobPhase(
  job: JobState,
  status: JobState["status"],
  message: string,
  progress?: number,
): void {
  job.status = status;
  job.message = message;
  if (typeof progress === "number") {
    job.progress = progress;
  }
  appendJobLog(job, `[Job ${job.id}] ${message}`);
}
