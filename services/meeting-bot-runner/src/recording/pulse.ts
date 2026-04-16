import { execSync } from "child_process";

export function ensurePulseAudio(): void {
  try {
    // DBUS or entrypoint started the system daemon. We just check if it answers.
    execSync("pactl info");
    console.log("[PulseAudio] Daemon is answering.");
  } catch (error) {
    console.warn("[PulseAudio] Daemon failed pactl info. Attempting fallback start as root system daemon...");
    try {
      execSync("pulseaudio -D --exit-idle-time=-1 --system --disallow-exit");
      console.log("[PulseAudio] Daemon started successfully as system.");
    } catch (startError) {
      console.error("[PulseAudio] Failed to start daemon (might already be running or missing dbus):", startError);
    }
  }
}

export function createVirtualSink(sinkName: string = "MeetingAudio"): string {
  try {
    // Check if sink exists
    const sinks = execSync("pactl list short sinks").toString();
    if (sinks.includes(sinkName)) {
      console.log(`[PulseAudio] Sink ${sinkName} already exists.`);
    } else {
      console.log(`[PulseAudio] Creating virtual sink ${sinkName}...`);
      execSync(`pactl load-module module-null-sink sink_name=${sinkName} sink_properties=device.description=${sinkName}`);
    }
    
    // Set as default sink to ensure browser uses it
    execSync(`pactl set-default-sink ${sinkName}`);
    console.log(`[PulseAudio] Set ${sinkName} as default sink.`);
    
    // Return the monitor name for recording
    return `${sinkName}.monitor`;
  } catch (error) {
    console.error(`[PulseAudio] Failed to create or set virtual sink ${sinkName}:`, error);
    throw error;
  }
}