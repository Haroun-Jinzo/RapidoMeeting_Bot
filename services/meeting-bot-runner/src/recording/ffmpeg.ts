import { spawn, ChildProcess } from "child_process";

export interface RecordingOptions {
  outputPath: string;
  deviceName: string;
  format?: string;
  channels?: number;
  sampleRate?: number;
}

export function startRecording({
  outputPath,
  deviceName,
  format = "wav", // prefers wav
  channels = 2,
  sampleRate = 44100
}: RecordingOptions): ChildProcess {
  console.log(`[FFmpeg] Starting recording from device ${deviceName} to ${outputPath}`);
  
  // FFmpeg command to record from PulseAudio monitor
  const args = [
    "-f", "pulse",
    "-i", deviceName,
    "-ac", channels.toString(),
    "-ar", sampleRate.toString(),
    "-y", // Overwrite output file
    outputPath
  ];

  const ffmpegProcess = spawn("ffmpeg", args);

  ffmpegProcess.stderr?.on("data", (data) => {
    // FFmpeg writes everything to stderr, even progress
    const output = data.toString();
    if (output.toLowerCase().includes("error")) {
      console.error(`[FFmpeg Error]: ${output}`);
    }
  });

  ffmpegProcess.on("close", (code) => {
    console.log(`[FFmpeg] Process exited with code ${code}`);
  });

  return ffmpegProcess;
}

export function stopRecording(processHandle: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[FFmpeg] Stopping recording (PID: ${processHandle.pid})...`);
    
    const timeoutId = setTimeout(() => {
      if (!processHandle.killed) {
        console.warn(`[FFmpeg] Force killing process ${processHandle.pid}...`);
        processHandle.kill("SIGKILL");
        resolve(); // resolve anyway
      }
    }, 5000);

    processHandle.on("close", () => {
      console.log(`[FFmpeg] Recording stopped gracefully.`);
      clearTimeout(timeoutId);
      resolve();
    });

    processHandle.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    // Safest way to stop FFmpeg cleanly and ensure it writes the headers to finalize the WAV file 
    // is to pass the "q" character directly to its standard input, which tells it to quit normally.
    if (processHandle.stdin && processHandle.stdin.writable) {
      processHandle.stdin.write("q\n");
    } else {
      processHandle.kill("SIGINT");
    }
  });
}