import fs from "fs";

// Loads an internal ingest secret from Docker secrets (or fallback locations)
// and sets both BOT_INTERNAL_SECRET and INTERNAL_INGEST_SECRET env vars if missing.
const SECRET_PATHS = [
  "/run/secrets/internal_ingest_secret",
  "/run/secrets/INTERNAL_INGEST_SECRET",
  "/run/secrets/internal_ingest_secret.txt",
  "/run/secrets/INTERNAL_INGEST_SECRET.txt",
  "/app/.auth/internal_ingest_secret",
  "./.auth/internal_ingest_secret"
];

for (const p of SECRET_PATHS) {
  try {
    if (fs.existsSync(p)) {
      const val = fs.readFileSync(p, "utf8").trim();
      if (val) {
        if (!process.env.BOT_INTERNAL_SECRET) process.env.BOT_INTERNAL_SECRET = val;
        if (!process.env.INTERNAL_INGEST_SECRET) process.env.INTERNAL_INGEST_SECRET = val;
      }
      break;
    }
  } catch {
    // ignore and continue
  }
}

export {};