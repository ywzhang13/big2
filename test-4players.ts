import { chromium, type Page, type BrowserContext } from "playwright";

const BASE_URL = "http://localhost:3000";
const PLAYERS = ["玩家A", "玩家B", "玩家C", "玩家D"];

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createPlayer(name: string, context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  // Each context has isolated localStorage (incognito)
  await page.goto(BASE_URL);
  await delay(1000);
  return page;
}

async function joinRoom(page: Page, name: string, roomCode?: string) {
  if (roomCode) {
    // Join existing room
    await page.click("text=加入房間");
    await delay(300);
    await page.fill('input[placeholder="房間碼 (4位數)"]', roomCode);
    await page.fill('input[placeholder="你的暱稱"]', name);
    await page.click("text=加入遊戲");
  } else {
    // Create room
    await page.click("text=建立房間");
    await delay(300);
    await page.fill('input[placeholder="你的暱稱"]', name);
    await page.click("text=建立房間");
  }
  await delay(1000);
}

async function getRoomCode(page: Page): Promise<string> {
  // Room code is in the URL hash
  const url = page.url();
  const match = url.match(/#room=(\d{4})/);
  return match ? match[1] : "";
}

async function getPageText(page: Page): Promise<string> {
  return page.innerText("body").catch(() => "");
}

async function main() {
  console.log("🃏 Starting Big Two 4-player test...\n");

  const browser = await chromium.launch({ headless: true });

  // Create 4 separate browser contexts (like 4 incognito windows)
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
  }

  try {
    // Step 1: Player A creates room
    console.log("1️⃣ Player A creating room...");
    pages[0] = await createPlayer(PLAYERS[0], contexts[0]);
    await joinRoom(pages[0], PLAYERS[0]);
    await delay(2000);

    const roomCode = await getRoomCode(pages[0]);
    console.log(`   Room code: ${roomCode}`);

    if (!roomCode) {
      console.error("❌ Failed to get room code");
      return;
    }

    // Check Player A sees themselves
    let text = await getPageText(pages[0]);
    const aVisible = text.includes(PLAYERS[0]);
    console.log(`   Player A visible: ${aVisible ? "✅" : "❌"}`);

    // Step 2: Players B, C, D join
    for (let i = 1; i < 4; i++) {
      console.log(`\n2️⃣ Player ${String.fromCharCode(65 + i)} joining room ${roomCode}...`);
      pages[i] = await createPlayer(PLAYERS[i], contexts[i]);
      await joinRoom(pages[i], PLAYERS[i], roomCode);
      await delay(2000);
    }

    // Step 3: Check all players see 4 seats filled
    console.log("\n3️⃣ Checking player visibility...");
    await delay(3000); // Wait for heartbeats

    for (let i = 0; i < 4; i++) {
      text = await getPageText(pages[i]);
      const seesFour = text.includes("4/4") || text.includes("開始遊戲");
      console.log(`   ${PLAYERS[i]} sees 4/4: ${seesFour ? "✅" : "❌"}`);
      if (!seesFour) {
        // Log what they see
        const countMatch = text.match(/(\d)\/4/);
        console.log(`   → Actually sees: ${countMatch ? countMatch[0] : "unknown"}`);
      }
    }

    // Step 4: Host starts game (ready check)
    console.log("\n4️⃣ Host starting game (ready check)...");
    const startBtn = pages[0].locator("text=開始遊戲");
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await delay(1000);
    } else {
      console.log("   ❌ Start button not visible for host");
    }

    // Step 5: All players confirm ready
    console.log("\n5️⃣ All players confirming ready...");
    for (let i = 0; i < 4; i++) {
      const readyBtn = pages[i].locator("text=準備好了！");
      await delay(500);
      if (await readyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await readyBtn.click();
        console.log(`   ${PLAYERS[i]} ready ✅`);
      } else {
        console.log(`   ${PLAYERS[i]} no ready button found ❌`);
      }
    }

    await delay(3000); // Wait for game to start

    // Step 6: Check game started — look for hand cards
    console.log("\n6️⃣ Checking game started...");
    for (let i = 0; i < 4; i++) {
      text = await getPageText(pages[i]);
      const hasCards = text.includes("張") && (text.includes("Pass") || text.includes("出牌"));
      console.log(`   ${PLAYERS[i]} in game: ${hasCards ? "✅" : "❌"}`);
    }

    // Step 7: Find who has 梅花3 (whose turn it is)
    console.log("\n7️⃣ Checking turn and 梅花3...");
    for (let i = 0; i < 4; i++) {
      text = await getPageText(pages[i]);
      const isMyTurn = text.includes("輪到你出牌");
      if (isMyTurn) {
        console.log(`   ${PLAYERS[i]} has the turn (should have ♣3) ✅`);
      }
    }

    // Step 8: Take screenshots
    console.log("\n📸 Taking screenshots...");
    for (let i = 0; i < 4; i++) {
      await pages[i].screenshot({ path: `test-screenshots/player-${String.fromCharCode(65 + i)}.png` });
      console.log(`   ${PLAYERS[i]} screenshot saved`);
    }

    console.log("\n✅ Test complete!");

  } catch (err) {
    console.error("❌ Test error:", err);
  } finally {
    for (const ctx of contexts) await ctx.close();
    await browser.close();
  }
}

main();
