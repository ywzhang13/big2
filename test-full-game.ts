import { chromium, type Page, type BrowserContext } from "playwright";

const BASE_URL = "http://localhost:3000";
const PLAYERS = ["Alice", "Bob", "Carol", "Dave"];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function isMyTurn(page: Page): Promise<boolean> {
  return page.locator("text=輪到你出牌").isVisible({ timeout: 500 }).catch(() => false);
}

async function isGameOver(page: Page): Promise<boolean> {
  return page.locator("text=遊戲結束").isVisible({ timeout: 500 }).catch(() => false);
}

async function canPass(page: Page): Promise<boolean> {
  const btn = page.locator("button:has-text('Pass')");
  return btn.isEnabled({ timeout: 300 }).catch(() => false);
}

async function deselectAll(page: Page) {
  const selected = page.locator(".card-selected");
  const count = await selected.count();
  for (let i = count - 1; i >= 0; i--) {
    await selected.nth(i).click();
    await delay(100);
  }
}

// Try playing single cards from left (smallest) to right
async function trySingleCard(page: Page): Promise<boolean> {
  const cards = page.locator(".card-base:not(.card-glow):not([class*='w-[38px]'])");
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    await deselectAll(page);
    await delay(150);
    await cards.nth(i).click();
    await delay(300);
    const playBtn = page.locator("button:has-text('出牌')");
    if (await playBtn.isEnabled({ timeout: 300 }).catch(() => false)) {
      await playBtn.click();
      await delay(300);
      return true;
    }
  }
  await deselectAll(page);
  return false;
}

async function main() {
  console.log("🃏 Full game test with video\n");
  const browser = await chromium.launch({ headless: true });
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  for (let i = 0; i < 4; i++) {
    contexts.push(await browser.newContext({
      viewport: { width: 390, height: 844 },
      recordVideo: { dir: "test-videos-fullgame/", size: { width: 390, height: 844 } },
    }));
  }

  try {
    // Setup
    console.log("Setting up room...");
    pages[0] = await contexts[0].newPage();
    await pages[0].goto(BASE_URL);
    await delay(1500);
    await pages[0].click("text=建立房間");
    await delay(500);
    await pages[0].fill('input[placeholder="你的暱稱"]', PLAYERS[0]);
    await pages[0].click("text=建立房間");
    await delay(2500);
    const roomCode = pages[0].url().match(/#room=(\d{4})/)?.[1] || "";
    console.log(`Room: ${roomCode}`);

    for (let i = 1; i < 4; i++) {
      pages[i] = await contexts[i].newPage();
      await pages[i].goto(`${BASE_URL}#room=${roomCode}`);
      await delay(1000);
      // If name input shown, fill it
      const nameInput = pages[i].locator('input[placeholder="你的暱稱"]');
      if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nameInput.fill(PLAYERS[i]);
        await pages[i].locator("button:has-text('加入')").click();
      }
      await delay(2000);
    }
    await delay(4000);
    console.log("All joined ✅");

    // Start game
    console.log("Starting game...");
    const startBtn = pages[0].locator("text=開始遊戲");
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
    }
    await delay(2000);

    for (let i = 0; i < 4; i++) {
      const btn = pages[i].locator("text=準備好了！");
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        console.log(`${PLAYERS[i]} ready`);
      }
      await delay(800);
    }
    await delay(4000);

    // Debug: screenshot all to see state
    for (let i = 0; i < 4; i++) {
      await pages[i].screenshot({ path: `test-videos-fullgame/debug-start-${i}.png` });
    }

    // Check who has turn
    for (let i = 0; i < 4; i++) {
      const hasTurn = await isMyTurn(pages[i]);
      console.log(`${PLAYERS[i]} turn: ${hasTurn}`);
    }

    // Play the game!
    let round = 0;
    const MAX_ROUNDS = 60;

    while (round < MAX_ROUNDS) {
      round++;
      let acted = false;

      for (let i = 0; i < 4; i++) {
        if (await isGameOver(pages[i])) {
          console.log(`\n🏆 Game over after ${round} rounds!`);
          await pages[i].screenshot({ path: `test-videos-fullgame/gameover-${PLAYERS[i]}.png` });
          round = MAX_ROUNDS; // exit outer loop
          acted = true;
          break;
        }

        if (!(await isMyTurn(pages[i]))) continue;

        // It's player i's turn
        const played = await trySingleCard(pages[i]);
        if (played) {
          console.log(`R${round}: ${PLAYERS[i]} plays single`);
          acted = true;
          await delay(1500);
          break;
        }

        // Can't play single — try pass
        if (await canPass(pages[i])) {
          await pages[i].locator("button:has-text('Pass')").click();
          console.log(`R${round}: ${PLAYERS[i]} passes`);
          acted = true;
          await delay(1500);
          break;
        }

        console.log(`R${round}: ${PLAYERS[i]} stuck — screenshot`);
        await pages[i].screenshot({ path: `test-videos-fullgame/stuck-r${round}-${PLAYERS[i]}.png` });
        acted = true;
        break;
      }

      if (!acted) {
        await delay(1000);
      }
    }

    await delay(3000);
    console.log("\nSaving videos...");

  } catch (err) {
    console.error("Error:", err);
  } finally {
    for (const p of pages) if (p) await p.close();
    for (const c of contexts) await c.close();
    await browser.close();
    console.log("Done!");
  }
}

main();
