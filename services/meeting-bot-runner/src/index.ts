import express from "express";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { GoogleMeetDriver } from "./providers/googleMeet";
import { ensurePulseAudio, createVirtualSink } from "./recording/pulse";
import { startRecording, stopRecording } from "./recording/ffmpeg";
import { uploadMeeting } from "./upload/uploadMeeting";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/tmp/recordings";

// Ensure recordings directory exists
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

interface JobState {
  id: string;
  status: "pending" | "running" | "uploading" | "completed" | "failed";
  metadata: any;
  error?: string;
  backendResponse?: any;
}

const jobs = new Map<string, JobState>();

app.post("/jobs", async (req, res) => {
  const { provider, meeting_url, meeting_title, meeting_type, language, participants, max_duration_seconds } = req.body;

  if (!meeting_url || !provider) {
    return res.status(400).json({ error: "missing meeting_url or provider" });
  }

  const jobId = uuidv4();
  const jobState: JobState = {
    id: jobId,
    status: "pending",
    metadata: req.body
  };
  jobs.set(jobId, jobState);

  // Run job asynchronously
  processJob(jobId, req.body).catch(err => {
    console.error(`[Job ${jobId}] Failed:`, err);
    jobState.status = "failed";
    jobState.error = err.message || "Unknown error";
  });

  return res.status(202).json({ jobId, status: "pending" });
});

app.get("/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json(job);
});

async function processJob(jobId: string, metadata: any) {
  const jobState = jobs.get(jobId)!;
  jobState.status = "running";

  try {
     // 1. Prepare Audio Env
     ensurePulseAudio();
     const monitorName = createVirtualSink("MeetingAudio");

     // 2. Instantiate Provider
     // For now only Google Meet mapped
     if (metadata.provider !== "google_meet") {
       throw new Error(`Unsupported provider ${metadata.provider}`);
     }
     
     const maxDurationMs = (metadata.max_duration_seconds || 5400) * 1000;
     const driver = new GoogleMeetDriver(maxDurationMs);

     // 3. Join Call
     await driver.join(metadata.meeting_url);
     await driver.waitUntilInCall();

     // 4. Start recording
     const targetAudioFile = path.join(RECORDINGS_DIR, `${jobId}.wav`);
     const processHandle = startRecording({
        outputPath: targetAudioFile,
        deviceName: monitorName
     });

     // 5. Wait for call end
     await driver.waitUntilEnded();
     
     // 6. Stop recording & leave
     await stopRecording(processHandle);
     await driver.leave();

     // 7. Upload
     jobState.status = "uploading";
     const response = await uploadMeeting(targetAudioFile, {
       meeting_title: metadata.meeting_title,
       meeting_type: metadata.meeting_type,
       language: metadata.language,
       participants: metadata.participants
     });

     jobState.status = "completed";
     jobState.backendResponse = response;

     // Optionally cleanup local file (commented out to keep locally)
     // fs.unlinkSync(targetAudioFile);

  } catch (error: any) {
     console.error(`[Job ${jobId}] Exception:`, error);
     jobState.status = "failed";
     jobState.error = error.message;
  }
}

app.listen(PORT, () => {
  console.log(`[Server] meeting-bot-runner listening on port ${PORT}`);
});