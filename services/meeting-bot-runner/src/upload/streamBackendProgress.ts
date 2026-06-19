export interface BackendProgressEvent {
  sessionId: string;
  step: string;
  message: string;
  progress: number;
  detail?: string;
  error?: string;
  timestamp: string;
}

const STEP_CONSOLE_LABELS: Record<string, string> = {
  started: "Upload received",
  transcription: "Step 1: Transcription",
  skill_detection: "Step 2: Skill detection",
  extraction: "Step 3: NLP extraction",
  routing: "Step 4: Intent routing",
  action: "Step 5: Executing action",
  confirmation: "Awaiting confirmation",
  complete: "Complete",
  error: "Failed",
};

export function getBackendBaseUrl(): string {
  const uploadUrl = process.env.UPLOAD_MEETING_URL || "";
  if (uploadUrl) {
    return uploadUrl.replace(/\/upload-meeting\/?$/i, "");
  }
  return (process.env.EXPRESS_API_BASE_URL || "http://host.docker.internal:3000").replace(/\/$/, "");
}

/** Mirrors openclaw-server console + progressBus wording. */
export function formatPipelineLog(event: BackendProgressEvent): string {
  const label = STEP_CONSOLE_LABELS[event.step] || event.step;
  let line = `[Pipeline] ${event.sessionId} — ${label}`;

  if (event.message && event.message !== label) {
    line += `: ${event.message}`;
  }

  if (event.detail) {
    line += ` (${event.detail})`;
  }

  if (typeof event.progress === "number") {
    line += ` [${event.progress}%]`;
  }

  return line;
}

function parseSseBlock(block: string): BackendProgressEvent | null {
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  try {
    return JSON.parse(dataLines.join("\n")) as BackendProgressEvent;
  } catch {
    return null;
  }
}

export async function streamBackendProgress(
  sessionId: string,
  options: {
    userId?: string;
    onEvent: (event: BackendProgressEvent) => void;
    signal?: AbortSignal;
  },
): Promise<"complete" | "error"> {
  const baseUrl = getBackendBaseUrl();
  const secret = process.env.BOT_INTERNAL_SECRET || process.env.INTERNAL_INGEST_SECRET;
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };

  if (secret) {
    headers["X-Internal-Auth"] = secret;
    if (options.userId) {
      headers["x-internal-user-id"] = options.userId;
    }
  } else if (process.env.SUPABASE_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`;
  } else {
    throw new Error("No backend auth configured for pipeline progress stream");
  }

  const url = `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/progress`;
  const res = await fetch(url, { headers, signal: options.signal });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Pipeline progress stream failed (${res.status}): ${detail}`);
  }

  if (!res.body) {
    throw new Error("Pipeline progress stream returned an empty body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: "complete" | "error" | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const event = parseSseBlock(block);
      if (event) {
        options.onEvent(event);
        if (event.step === "complete") terminal = "complete";
        if (event.step === "error") terminal = "error";
      }

      boundary = buffer.indexOf("\n\n");
    }

    if (terminal) break;
  }

  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    if (event) {
      options.onEvent(event);
      if (event.step === "complete") terminal = "complete";
      if (event.step === "error") terminal = "error";
    }
  }

  return terminal || "complete";
}
