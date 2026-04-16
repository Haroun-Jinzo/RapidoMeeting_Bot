import { chromium, BrowserContext, Page } from "playwright";
import { ProviderDriver } from "./index";
import path from "path";
import fs from "fs";

export class GoogleMeetDriver implements ProviderDriver {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private maxDurationMs: number;

  constructor(maxDurationMs: number = 5400 * 1000) {
    this.maxDurationMs = maxDurationMs;
  }

  async join(meetingUrl: string): Promise<void> {
    console.log(`[GoogleMeet] Launching browser to join ${meetingUrl}`);
    
    const authFile = path.join(process.cwd(), ".auth", "state.json");
    const debugDir = path.join(process.cwd(), ".auth");
    
    // Check if auth state exists
    const hasAuth = fs.existsSync(authFile);
    if (!hasAuth) console.warn("[GoogleMeet] No state.json found. Bot will join as anonymous.");

    // Launch a standard browser instead of persistent context to be cross-platform compatible
    const browser = await chromium.launch({
      headless: true, // Run headlessly in the background
      ignoreDefaultArgs: ["--mute-audio"], // CRITICAL: Playwright automatically adds --mute-audio by default. We MUST remove it!
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--disable-blink-features=AutomationControlled",
        "--autoplay-policy=no-user-gesture-required", // Ensure audio plays automatically
      ],
      env: {
         ...process.env,
         PULSE_SERVER: process.env.PULSE_SERVER || "unix:/var/run/pulse/native",
         PULSE_SINK: "MeetingAudio",
      }
    });

    this.context = await browser.newContext({
      // Provide the OS-independent json cookies instead of Windows-encrypted profile folders
      storageState: hasAuth ? authFile : undefined,
    });

    this.page = await this.context.newPage();
    
    console.log(`[GoogleMeet] Navigating to meeting URL directly...`);
    await this.page.goto(meetingUrl, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(5000); // Extra time for React to fully render and hydrate
    console.log(`[GoogleMeet] Navigated to ${meetingUrl}`);
    
    // Attempt to dismiss permission popups if they surface differently or enter name if not logged in
    try {
      await this.page.waitForTimeout(3000); // Wait for React to render
      await this.page.screenshot({ path: path.join(debugDir, 'debug1_loaded.png') });

      // The name input could be selected in several ways
      const nameInput = this.page.locator('input[placeholder="Your name"], input[aria-label="Your name"], input[type="text"]').first();
      // On some layouts, returning to home screen is forced if the meeting URL param isn't right, or we just hit the "Ready to join?" page
      if (await nameInput.isVisible({ timeout: 5000 })) {
         // Focus first so it clears any placeholder text or triggers JS listeners correctly
         await nameInput.focus();
         await nameInput.fill("Meeting Bot Transcriber");
         await this.page.waitForTimeout(1000); // Wait for the join button to become enabled
      }

      // Try checking for a generic "Got it" button which appears on the "You are using a browser that isn't fully supported" pop-up
      const gotItBtn = this.page.locator('button:has-text("Got it"), span:has-text("Got it")').first();
      if (await gotItBtn.isVisible({ timeout: 2000 })) {
          await gotItBtn.click({ force: true });
          await this.page.waitForTimeout(2000);
      }

      // Look for the "Use microphone and camera" vs "Continue without microphone and camera" dialog unconditionally
      console.log("[GoogleMeet] Checking for microphone dialogs...");
      const continueWithoutMicBtn = this.page.locator(
        'button:has-text("Continuer sans micro"), ' +
        'span:has-text("Continuer sans micro"), ' +
        'button:has-text("Continue without"), ' +
        'span:has-text("Continue without")'
      ).locator('visible=true').first();

      if (await continueWithoutMicBtn.isVisible({ timeout: 5000 })) {
          console.log("[GoogleMeet] Dismissing microphone/camera popup before join...");
          await continueWithoutMicBtn.click({ force: true });
          await this.page.waitForTimeout(2000);
      }
    } catch(e) { /* Ignore */ }

    // Click "Ask to join" or "Join now"
    try {
      const debugDir = path.join(process.cwd(), ".auth");
      await this.page.screenshot({ path: path.join(debugDir, 'debug2_before_join.png') });

      // Use a pure CSS selector fallback designed for the prominent blue joining button
      // Look explicitly for visible Join buttons to avoid hidden/disabled templates (Google Meet has many).
      const joinButton = this.page.locator(
        'button:has-text("Join now"), ' +
        'button:has-text("Ask to join"), ' +
        'button:has-text("ask to join"), ' +
        'button:has-text("Participer"), ' +
        'button:has-text("Demander")'
      ).locator('visible=true').first();
      
      // Wait for it to become visible and enabled naturally
      await joinButton.waitFor({ timeout: 15000, state: 'visible' });
      
      // Click normally. We added { force: true } because Google Meet renders invisible overlay dialogs that intercept clicks
      await joinButton.click({ force: true });
      console.log(`[GoogleMeet] Clicked join button.`);
      
      await this.page.waitForTimeout(3000); // 3 seconds after clicking

      // The microphone popup sometimes appears AFTER hitting join (especially on instant joins with no lobby check)
      const postJoinMicBtn = this.page.locator(
        'button:has-text("Continuer sans micro"), ' +
        'span:has-text("Continuer sans micro"), ' +
        'button:has-text("Continue without"), ' +
        'span:has-text("Continue without")'
      ).locator('visible=true').first();

      if (await postJoinMicBtn.isVisible({ timeout: 3000 })) {
          console.log("[GoogleMeet] Dismissing microphone/camera popup after join...");
          await postJoinMicBtn.click({ force: true });
          await this.page.waitForTimeout(1000);
      }

      await this.page.screenshot({ path: path.join(debugDir, 'debug3_after_join.png') });
    } catch(e) {
      console.error("[GoogleMeet] Failed to find join button. May require manual auth or layout changed.", e);
      throw e;
    }
  }

  async waitUntilInCall(): Promise<void> {
    if (!this.page) throw new Error("Page not initialized. Call join() first.");

    console.log(`[GoogleMeet] Waiting to be admitted to the call...`);
    // Need to look for the red "Leave call" button specifically to confirm we are INSIDE.
    // The lobby/preview screen also has microphone buttons, so checking for mic buttons causes false positives!
    try {
        await this.page.waitForSelector('[aria-label="Leave call"], [aria-label="Quitter l\'appel"]', { timeout: 60000 });
        console.log(`[GoogleMeet] In call confirmed.`);
    } catch (e) {
        console.error("[GoogleMeet] Timeout waiting to be admitted.");
        throw Error("Timeout waiting to join call.");
    }
  }

  async waitUntilEnded(): Promise<void> {
    if (!this.page) return;
    console.log(`[GoogleMeet] Monitoring call state...`);
    
    return new Promise((resolve, reject) => {
      // Hard timeout
      const hardTimeout = setTimeout(() => {
        console.log(`[GoogleMeet] Max duration reached (${this.maxDurationMs}ms). Ending recording.`);
        resolve();
      }, this.maxDurationMs);

      // Periodically check page state
      const interval = setInterval(async () => {
        if (!this.page || this.page.isClosed()) {
            clearInterval(interval);
            clearTimeout(hardTimeout);
            resolve();
            return;
        }

        try {
           // Create a live screenshot every 5 seconds
           const debugDir = path.join(process.cwd(), ".auth");
           await this.page.screenshot({ path: path.join(debugDir, 'debug4_live_call.png') });

           // 1. Google Meet sometimes throws the microphone dialog repeatedly, even mid-call!
           // If we see it, we shoot it down immediately.
           const midCallMicBtn = this.page.locator(
             'button:has-text("Continuer sans micro"), ' +
             'span:has-text("Continuer sans micro"), ' +
             'button:has-text("Continue without"), ' +
             'span:has-text("Continue without")'
           ).locator('visible=true').first();

           if (await midCallMicBtn.isVisible({ timeout: 1000 })) {
               console.log("[GoogleMeet] Dismissing persistent microphone popup mid-call...");
               await midCallMicBtn.click({ force: true });
               await this.page.waitForTimeout(500);
           }

           // 2. Instead of scanning all HTML (which matches hidden templates), we only check if 
           // specific end-screen elements are currently VISIBLE on the screen to the human eye.
           const leftMeeting = await this.page.locator('text="Vous avez quitté la réunion"').isVisible();
           const returnHome = await this.page.locator('text="Retourner à l\'écran d\'accueil"').isVisible();
           const returnHomeEn = await this.page.locator('text="Return to home screen"').isVisible();
           const rejoinBtn = await this.page.locator('text="Rejoindre"').isVisible();
           const removedText = await this.page.locator('text="Vous avez été exclu"').isVisible();
           
           // We also wiggle the mouse to wake up the toolbar. If the red Leave button is permanently missing, we are out.
           await this.page.mouse.move(500, 500);
           await this.page.mouse.move(600, 600);
           // Wait just a sec for animations
           await this.page.waitForTimeout(500);
           const leaveBtnCount = await this.page.locator('[aria-label="Leave call"], [aria-label="Quitter l\'appel"]').count();
           const leaveBtnVisible = leaveBtnCount > 0 && await this.page.locator('[aria-label="Leave call"], [aria-label="Quitter l\'appel"]').first().isVisible();

           if (leftMeeting || returnHome || returnHomeEn || rejoinBtn || removedText || !leaveBtnVisible) {
             console.log(`[GoogleMeet] Meeting ended (UI returned ${!leaveBtnVisible ? 'no leave button' : 'end-screen text'}).`);
             clearInterval(interval);
             clearTimeout(hardTimeout);
             resolve();
           }
        } catch(e) { 
           console.log("[GoogleMeet] Interval error:", e);
        }
      }, 5000);
    });
  }

  async leave(): Promise<void> {
    console.log(`[GoogleMeet] Leaving meeting and closing browser...`);
    if (this.page && !this.page.isClosed()) {
      try {
        // Try to click "Leave call" politely
        const leaveBtn = this.page.locator('[aria-label="Leave call"], [aria-label="Quitter l\'appel"]').first();
        if (await leaveBtn.isVisible({ timeout: 2000 })) {
            await leaveBtn.click();
            await this.page.waitForTimeout(2000);
        }
      } catch (e) { /* Ignore */ }
    }
    
    if (this.context) {
       await this.context.close();
    }
    console.log(`[GoogleMeet] Browser closed.`);
  }
}