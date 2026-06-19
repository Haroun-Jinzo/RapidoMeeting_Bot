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
  console.log("   1. Pick your bot account and complete sign-in (password + 2FA).");
  console.log("   2. Wait until you see your Google account home page.");
  console.log("   DO NOT close the browser until the script finishes.");
  console.log("========================================================\n");

  const deadline = Date.now() + 5 * 60 * 1000; // 5 minutes max
  let loggedIn = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);

    const url = page.url();
    const onSignInPage = /accounts\.google\.com\/(signin|v3\/signin|AccountChooser)/i.test(url);
    const chooseAccount = await page.locator('text="Choose an account", text="Choisir un compte"').isVisible().catch(() => false);
    const signedOut = await page.locator('text="Signed out", text="Déconnecté"').isVisible().catch(() => false);

    if (!onSignInPage && !chooseAccount && !signedOut) {
      loggedIn = true;
      break;
    }

    console.log(`[Auth Setup] Still waiting for login... (current page: ${url})`);
  }

  if (!loggedIn) {
    console.error("[Auth Setup] Timed out waiting for login. No auth file was saved.");
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: AUTH_FILE });
  console.log(`[Auth Setup] Login detected. Saved session to ${AUTH_FILE}`);
  console.log(`[Auth Setup] Done! Closing browser.`);
  await browser.close();
}

setupAuth().catch(console.error);