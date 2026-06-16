import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const AUTH_FILE = path.join(process.cwd(), ".auth", "state.json");

async function setupAuth() {
  console.log(`[Auth Setup] Launching headful browser...`);
  console.log(`[Auth Setup] Please log into your Bot's Google Account.`);
  console.log(`[Auth Setup] The browser will close automatically 60 seconds after login.`);

  const dir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Use chromium instead of msedge — avoids the --no-startup-window crash on Windows
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--start-maximized", // Force a visible window
    ],
  });

  const context = await browser.newContext({
    viewport: null, // Required when using --start-maximized
  });

  const page = await context.newPage();

  // Navigate immediately so the window has content and doesn't close
  await page.goto("https://accounts.google.com/signin", { waitUntil: "networkidle" });

  console.log("\n========================================================");
  console.log("   WAITING FOR YOU TO LOG IN...");
  console.log("   DO NOT PRESS CTRL+C OR CLOSE THE TERMINAL!");
  console.log("   The script will save cookies and close in 60 seconds.");
  console.log("========================================================\n");

  // Save cookies every 5 seconds for 60 seconds
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    try {
      await context.storageState({ path: AUTH_FILE });
      console.log(`[Auth Setup] [${(i + 1) * 5}s] Saved cookies to ${AUTH_FILE}`);
    } catch (e) {
      console.warn(`[Auth Setup] Could not save cookies yet:`, e);
    }
  }

  console.log(`[Auth Setup] Done! Closing browser.`);
  await browser.close();
}

setupAuth().catch(console.error);