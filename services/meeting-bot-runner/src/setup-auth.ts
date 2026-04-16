import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const AUTH_FILE = path.join(process.cwd(), ".auth", "state.json");

async function setupAuth() {
  console.log(`[Auth Setup] Launching headful browser...`);
  console.log(`[Auth Setup] Please log into your Bot's Google Account.`);
  console.log(`[Auth Setup] The browser will close automatically 1 minute after login, or you can close it manually.`);

  const dir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // We DO NOT use persistent context here, because Windows profile files 
  // are encrypted and cannot be read by the Linux Docker container later.
  // Instead, we launch a normal browser, sign in, and export the raw JSON cookies.
  const browser = await chromium.launch({
    headless: false, 
    channel: "msedge", // Use Edge Windows to bypass bot detection during login
    args: [
      "--no-sandbox", 
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled"
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Go to Google login page
  await page.goto("https://accounts.google.com/signin", { waitUntil: "networkidle" });

  console.log("\n========================================================");
  console.log("   WAITING FOR YOU TO LOG IN...");
  console.log("   DO NOT PRESS CTRL+C OR CLOSE THE TERMINAL!");
  console.log("   The script will automatically grab the cookies");
  console.log("   and close in exactly 60 seconds.");
  console.log("========================================================\n");

  // Save the cookies aggressively every 5 seconds for a minute
  for (let i = 0; i < 12; i++) {
     try {
         await context.storageState({ path: AUTH_FILE });
         console.log(`[Auth Setup] Saved cookies to ${AUTH_FILE} ...`);
     } catch (e) {}
     await page.waitForTimeout(5000); 
  }

  console.log(`[Auth Setup] Finished grabbing session state!`);
  await browser.close();
}

setupAuth().catch(console.error);
