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
  
  const hasAuth = fs.existsSync(authFile);
  if (!hasAuth) console.warn("[GoogleMeet] No state.json found. Bot will join as anonymous.");

  const browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ["--mute-audio"],
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--disable-blink-features=AutomationControlled",
      "--autoplay-policy=no-user-gesture-required",
    ],
    env: {
      ...process.env,
      PULSE_SERVER: process.env.PULSE_SERVER || "unix:/var/run/pulse/native",
      PULSE_SINK: "MeetingAudio",
    }
  });

  this.context = await browser.newContext({
    storageState: hasAuth ? authFile : undefined,
  });

  this.page = await this.context.newPage();
  
  console.log(`[GoogleMeet] Navigating to meeting URL directly...`);
  await this.page.goto(meetingUrl, { waitUntil: "domcontentloaded" });
  console.log(`[GoogleMeet] Navigated to ${meetingUrl}`);

  // Step 1: Wait for the page to show something meaningful
  console.log(`[GoogleMeet] Waiting for page to be ready...`);
  try {
    await this.page.waitForSelector([
      'text="Vous pourrez commencer dans un instant"',
      'text="Souhaitez-vous que les autres"',
      'text="Would you like others to"',
      'button:has-text("Continuer sans micro ni caméra")',
      'button:has-text("Continue without microphone")',
      'input[placeholder="Your name"]',
    ].join(', '), { timeout: 30000, state: "visible" });
    console.log(`[GoogleMeet] Page responded.`);
  } catch (e) {
    console.warn(`[GoogleMeet] Initial page wait timed out — proceeding anyway.`);
  }

  await this.page.screenshot({ path: path.join(debugDir, 'debug1_loaded.png') });

  // Step 2: Dismiss the "use mic and camera?" dialog if present (blocks prep screen)
  console.log(`[GoogleMeet] Checking for camera/mic permission dialog...`);
  try {
    const continueWithoutCamBtn = this.page.locator([
      'button:has-text("Continuer sans micro ni caméra")',
      'span:has-text("Continuer sans micro ni caméra")',
      'a:has-text("Continuer sans micro ni caméra")',
      'button:has-text("Continue without microphone")',
      'button:has-text("Continue without mic")',
    ].join(', ')).filter({ visible: true }).first();

    if (await continueWithoutCamBtn.isVisible({ timeout: 5000 })) {
      console.log("[GoogleMeet] Dismissing camera/mic dialog...");
      await continueWithoutCamBtn.click({ force: true });
      await this.page.waitForTimeout(2000);
    }
  } catch (e) { /* ignore */ }

  // Step 3: Now wait for preparation screen to disappear
  console.log(`[GoogleMeet] Waiting for preparation screen to clear...`);
  try {
    await this.page.waitForSelector(
      'text="Préparation", text="Vous pourrez commencer dans un instant"',
      { state: "hidden", timeout: 30000 }
    );
    console.log(`[GoogleMeet] Preparation screen cleared.`);
  } catch (e) {
    console.warn(`[GoogleMeet] Preparation screen wait timed out — proceeding anyway.`);
  }

  // Step 4: Handle name input if anonymous
  try {
    await this.page.waitForTimeout(2000);
    const nameInput = this.page.locator('input[placeholder="Your name"], input[aria-label="Your name"], input[type="text"]').first();
    if (await nameInput.isVisible({ timeout: 5000 })) {
      await nameInput.focus();
      await nameInput.fill("Meeting Bot Transcriber");
      await this.page.waitForTimeout(1000);
    }

    const gotItBtn = this.page.locator('button:has-text("Got it"), span:has-text("Got it")').first();
    if (await gotItBtn.isVisible({ timeout: 2000 })) {
      await gotItBtn.click({ force: true });
      await this.page.waitForTimeout(2000);
    }

    // Catch any remaining mic-only dialogs (older style)
    const continueWithoutMicBtn = this.page.locator([
      'button:has-text("Continuer sans micro")',
      'span:has-text("Continuer sans micro")',
      'button:has-text("Continue without")',
      'span:has-text("Continue without")'
    ].join(', ')).filter({ visible: true }).first();

    if (await continueWithoutMicBtn.isVisible({ timeout: 3000 })) {
      console.log("[GoogleMeet] Dismissing mic-only popup...");
      await continueWithoutMicBtn.click({ force: true });
      await this.page.waitForTimeout(2000);
    }
  } catch(e) { /* Ignore */ }

  // Step 5: Click join button
  try {
    await this.page.screenshot({ path: path.join(debugDir, 'debug2_before_join.png') });

    const joinButton = this.page.locator([
      'button:has-text("Join now")',
      'button:has-text("Ask to join")',
      'button:has-text("ask to join")',
      'button:has-text("Participer")',
      'button:has-text("Demander")',
      'button:has-text("Join")',
      'span:has-text("Participer à la réunion")',
      'span:has-text("Demander à participer")',
      'button:has-text("Demander à participer")',
      'span:has-text("Ask to join")'
    ].join(', ')).filter({ visible: true }).first();
    
    await joinButton.waitFor({ timeout: 15000, state: 'visible' });
    await joinButton.click({ force: true });
    console.log(`[GoogleMeet] Clicked join button.`);
    
    await this.page.waitForTimeout(3000);

    // Post-join mic dialog
    const postJoinMicBtn = this.page.locator([
      'button:has-text("Continuer sans micro ni caméra")',
      'button:has-text("Continuer sans micro")',
      'span:has-text("Continuer sans micro")',
      'button:has-text("Continue without")',
      'span:has-text("Continue without")'
    ].join(', ')).filter({ visible: true }).first();

    if (await postJoinMicBtn.isVisible({ timeout: 3000 })) {
      console.log("[GoogleMeet] Dismissing post-join dialog...");
      await postJoinMicBtn.click({ force: true });
      await this.page.waitForTimeout(1000);
    }

    await this.page.screenshot({ path: path.join(debugDir, 'debug3_after_join.png') });
  } catch(e) {
    console.error("[GoogleMeet] Failed to find join button.", e);
    throw e;
  }
}
  async waitUntilInCall(): Promise<void> {
    if (!this.page) throw new Error("Page not initialized. Call join() first.");

    console.log(`[GoogleMeet] Waiting to be admitted to the call...`);

    const debugDir = path.join(process.cwd(), ".auth");
    const deadline = Date.now() + 120_000; // 2 minutes max wait to be admitted

    while (Date.now() < deadline) {
      await this.page.waitForTimeout(3000);
      await this.page.screenshot({ path: path.join(debugDir, "debug_waitUntilInCall.png") });

      // Success: we are inside the call
      const inCall = await this.page
        .locator('[aria-label="Leave call"], [aria-label="Quitter l\'appel"]')
        .isVisible()
        .catch(() => false);

      if (inCall) {
        console.log(`[GoogleMeet] In call confirmed.`);
        return;
      }

      // Still in lobby waiting for host approval — keep waiting
      const inLobby = await this.page
        .locator([
          'text="Waiting for someone to let you in"',
          'text="En attente d\'admission"',
          'text="Asking to be let in"',
          'text="Demande d\'accès envoyée"',
        ].join(', '))
        .isVisible()
        .catch(() => false);

      if (inLobby) {
        console.log(`[GoogleMeet] Still in lobby waiting for host admission...`);
        continue;
      }

      // Auth or error screen detected
      const errorScreen = await this.page
        .locator([
          'text="You can\'t join this video call"',
          'text="Invalid meeting code"',
          'text="This meeting hasn\'t started"',
          'input[type="email"]',
        ].join(', '))
        .isVisible()
        .catch(() => false);

      if (errorScreen) {
        await this.page.screenshot({ path: path.join(debugDir, "debug_error_screen.png") });
        throw new Error("Cannot join: auth failure or invalid meeting URL. Check debug_error_screen.png");
      }
    }

    await this.page.screenshot({ path: path.join(debugDir, "debug_timeout.png") });
    throw new Error("Timeout waiting to join call — still not admitted after 2 minutes.");
  }

  async waitUntilEnded(): Promise<void> {
    if (!this.page) return;
    console.log(`[GoogleMeet] Monitoring call state...`);
    
    return new Promise((resolve, reject) => {
      const hardTimeout = setTimeout(() => {
        console.log(`[GoogleMeet] Max duration reached (${this.maxDurationMs}ms). Ending recording.`);
        resolve();
      }, this.maxDurationMs);

      const interval = setInterval(async () => {
        if (!this.page || this.page.isClosed()) {
          clearInterval(interval);
          clearTimeout(hardTimeout);
          resolve();
          return;
        }

        try {
          const debugDir = path.join(process.cwd(), ".auth");
          await this.page.screenshot({ path: path.join(debugDir, 'debug4_live_call.png') });

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

          const leftMeeting = await this.page.locator('text="Vous avez quitté la réunion"').isVisible();
          const returnHome = await this.page.locator('text="Retourner à l\'écran d\'accueil"').isVisible();
          const returnHomeEn = await this.page.locator('text="Return to home screen"').isVisible();
          const rejoinBtn = await this.page.locator('text="Rejoindre"').isVisible();
          const removedText = await this.page.locator('text="Vous avez été exclu"').isVisible();
          
          await this.page.mouse.move(500, 500);
          await this.page.mouse.move(600, 600);
          await this.page.waitForTimeout(500);
          const leaveBtnCount = await this.page.locator('[aria-label="Leave call"], [aria-label="Quitter l\'appel"]').count();
          const leaveBtnVisible = leaveBtnCount > 0 && await this.page.locator('[aria-label="Leave call"], [aria-label="Quitter l\'appel"]').first().isVisible();

          const isAloneEn = await this.page.locator('text="You\'re the only one here"').isVisible();
          const isAloneFr = await this.page.locator('text="Vous êtes la seule personne ici"').isVisible();
          const isAloneFr2 = await this.page.locator('text="Vous êtes le seul participant"').isVisible();

          if (leftMeeting || returnHome || returnHomeEn || rejoinBtn || removedText || !leaveBtnVisible || isAloneEn || isAloneFr || isAloneFr2) {
            console.log(`[GoogleMeet] Meeting ended.`);
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