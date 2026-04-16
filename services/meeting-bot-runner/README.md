# Meeting Bot Runner
A service to capture meeting audio (Google Meet, Microsoft Teams) using headless Chromium (Playwright), PulseAudio, and FFmpeg, and upload it to a backend endpoint.

## Prerequisites
- Docker & Docker Compose
- Node.js > 18.x (for local testing without docker)

## System Requirements
Must run on a Linux environment or via Docker. The process uses `pulseaudio` to capture the `null-sink` default audio output and pipes it through `ffmpeg` into a wav file.

## Environment Variables
- `UPLOAD_MEETING_URL`: Target endpoint (e.g., `https://api.example.com/upload-meeting`).
- `BOT_INTERNAL_SECRET`: Shared secret sent as `X-Internal-Auth` header.
- `SUPABASE_ACCESS_TOKEN`: Sent as `Authorization: Bearer <token>` if `BOT_INTERNAL_SECRET` is not used.
- `RECORDINGS_DIR`: Absolute path to the recordings directory (Default: `/tmp/recordings`).
- `PORT`: Express server port (Default: `3000`).

## Running with Docker

```bash
cd services/meeting-bot-runner
docker-compose up --build
```
> The `shm_size: 2g` is crucial for stable playback inside headless Playwright Chromium.

## API Usage

### Start a Job
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google_meet",
    "meeting_url": "https://meet.google.com/xxx-yyyy-zzz",
    "meeting_title": "Standup",
    "meeting_type": "general",
    "language": "en",
    "participants": "a@x.com,b@y.com",
    "max_duration_seconds": 3600
  }'
```
Response:
```json
{
  "jobId": "e4b3c...-...",
  "status": "pending"
}
```

### Check Job Status
```bash
curl http://localhost:3000/jobs/<jobId>
```

## Auth / Cookies
The bot mounts a persistent context in `./.auth/google`. If Google meets require authentication (e.g. for non-anonymous accounts), run playwright locally without headless mode and login once:
`npx playwright open --user-data-dir=./.auth/google https://meet.google.com`

## Extensibility
- **Adding more providers:** Check `src/providers/index.ts` and implement `ProviderDriver`. Register your new provider inside `src/index.ts`.
- **Microsoft Teams:** Create `src/providers/teams.ts` mimicking `googleMeet.ts` logic.

## Google Meet "You can't join this video call" Error
Google Meet often blocks anonymous users (not logged into a Google Account) from joining meetings depending on how the organization is set up. **If your bot gets a "You can't join this video call" screen**, it means it was rejected by Google before even typing its name.

To fix this:
1. Open `docker-compose.yml`.
2. Add your new bot email strictly to `GOOGLE_BOT_EMAIL` and `GOOGLE_BOT_PASSWORD`.
3. Stop and rebuild your docker container `docker-compose down` / `docker-compose up --build`.

When those variables exist, the browser will programmatically navigate to accounts.google.com and log itself in safely and organically before joining a meeting without needing Windows browser magic!

## Known Limitations
- Heavy CPU usage: Transcoding audio locally using `ffmpeg` + memory requirements of running Playwright browsers will require at least 1-2 vCPUs and ~2GB RAM per concurrent meeting.
- Scale limits: This runner should ideally process 1 job at a time. To scale, deploy multiple bot-runner containers and use a message queue instead of HTTP POST /jobs.
