import './loadInternalSecret';
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { GoogleMeetDriver } from "./providers/googleMeet";
import { ensurePulseAudio, createVirtualSink } from "./recording/pulse";
import { startRecording, stopRecording } from "./recording/ffmpeg";
import { uploadMeeting } from "./upload/uploadMeeting";
import { formatPipelineLog, streamBackendProgress } from "./upload/streamBackendProgress";
import { appendJobLog, setJobPhase } from "./jobLog";
import { JobState } from "./jobTypes";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/tmp/recordings";

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

const jobs = new Map<string, JobState>();

function serializeJob(job: JobState) {
  const meetingId =
    (job.metadata.meeting_id as string | undefined) ||
    (job.metadata.meetingId as string | undefined) ||
    (job.metadata.rapidomeet_meeting_id as string | undefined);

  return {
    jobId: job.id,
    id: job.id,
    status: job.status,
    message: job.message,
    progress: job.progress,
    session_id: job.session_id,
    sessionId: job.session_id,
    meeting_id: meetingId,
    meetingId,
    logs: job.logs || [],
    error: job.error,
    backendResponse: job.backendResponse,
    metadata: job.metadata,
  };
}

app.post("/jobs", async (req, res) => {
  const { provider, meeting_url } = req.body;

  if (!meeting_url || !provider) {
    return res.status(400).json({ error: "missing meeting_url or provider" });
  }

  const jobId = uuidv4();
  const jobState: JobState = {
    id: jobId,
    status: "pending",
    metadata: req.body,
    logs: [],
    progress: 0,
    message: "Queued",
  };
  jobs.set(jobId, jobState);

  processJob(jobId, req.body).catch(err => {
    console.error(`[Job ${jobId}] Failed:`, err);
    jobState.status = "failed";
    jobState.error = err.message || "Unknown error";
    appendJobLog(jobState, `[Job ${jobId}] Failed: ${jobState.error}`);
  });

  return res.status(202).json(serializeJob(jobState));
});

app.get("/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json(serializeJob(job));
});

async function processJob(jobId: string, metadata: Record<string, unknown>) {
  const jobState = jobs.get(jobId)!;

  try {
    setJobPhase(jobState, "joining", "Preparing audio environment", 5);
    ensurePulseAudio();
    const monitorName = createVirtualSink("MeetingAudio");

    if (metadata.provider !== "google_meet") {
      throw new Error(`Unsupported provider ${metadata.provider}`);
    }

    const maxDurationMs = ((metadata.max_duration_seconds as number) || 5400) * 1000;
    const driver = new GoogleMeetDriver(maxDurationMs);

    setJobPhase(jobState, "joining", "Joining Google Meet call", 10);
    await driver.join(metadata.meeting_url as string);
    await driver.waitUntilInCall();

    setJobPhase(jobState, "recording", "In call — recording meeting audio", 28);

    const targetAudioFile = path.join(RECORDINGS_DIR, `${jobId}.wav`);
    const processHandle = startRecording({
      outputPath: targetAudioFile,
      deviceName: monitorName,
    });

    await driver.waitUntilEnded();

    setJobPhase(jobState, "uploading", "Meeting ended — stopping recording", 40);
    await stopRecording(processHandle);
    await driver.leave();

    setJobPhase(jobState, "uploading", "Uploading audio to backend pipeline", 42);
    const response = await uploadMeeting(targetAudioFile, {
      meeting_title: (metadata.meeting_title as string) || "Unknown Meeting",
      meeting_type: (metadata.meeting_type as string) || "meeting",
      language: (metadata.language as string) || "en",
      participants: (metadata.participants as string) || "",
      user_instructions: metadata.user_instructions as string | undefined,
      userId: (metadata.userId as string) || (metadata.user_id as string),
    });

    jobState.backendResponse = response;

    const uploadError =
      response &&
      typeof response === "object" &&
      "error" in response &&
      (response as { error?: string }).error;

    if (uploadError) {
      throw new Error(String(uploadError));
    }

    const sessionId =
      (response as { session_id?: string; sessionId?: string })?.session_id ||
      (response as { session_id?: string; sessionId?: string })?.sessionId;

    if (!sessionId) {
      throw new Error("Backend accepted upload but did not return a session_id");
    }

    jobState.session_id = sessionId;
    setJobPhase(
      jobState,
      "processing",
      "Audio uploaded — following backend processing pipeline",
      48,
    );

    const userId = (metadata.userId as string) || (metadata.user_id as string);
    const pipelineResult = await streamBackendProgress(sessionId, {
      userId,
      onEvent: (event) => {
        appendJobLog(jobState, formatPipelineLog(event));
        jobState.progress = event.progress;
        jobState.message = event.message;

        if (event.step === "error") {
          jobState.error = event.error || event.message;
        }
      },
    });

    if (pipelineResult === "error" || jobState.error) {
      jobState.status = "failed";
      appendJobLog(
        jobState,
        `[Job ${jobId}] Backend pipeline failed: ${jobState.error || "unknown error"}`,
      );
      return;
    }

    setJobPhase(jobState, "completed", "Meeting capture and processing complete", 100);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Job ${jobId}] Exception:`, error);
    jobState.status = "failed";
    jobState.error = message;
    appendJobLog(jobState, `[Job ${jobId}] Exception: ${message}`);
  }
}

app.listen(PORT as number, HOST, () => {
  console.log(`[Server] meeting-bot-runner listening on ${HOST}:${PORT}`);
});
