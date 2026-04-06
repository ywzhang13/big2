import { chromium, type Page, type BrowserContext } from "playwright";

const BASE_URL = "http://localhost:3000";
const PLAYERS = ["玩家A", "玩家B", "玩家C", "玩家D"];

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("🃏 Starting Big Two 4-player video test...\n");

  const browser = await chromium.launch({ headless: true });
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  // Create 4 contexts — record video on Player A
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, // iPhone 15 size
      ...(i === 0 ? { recordVideo: { dir: "test-videos/", size: { width: 390, height: 844 } } } : {}),
    });
    contexts.push(ctx);
  }

  try {
    // Player A creates room
    console.log("1️⃣ Player A creates room...");
    pages[0] = await contexts[0].newPage();
    await pages[0].goto(BASE_URL);
    await delay(1500);
    await pages[0].click("text=建立房間");
    await delay(500);
    await pages[0].fill('input[placeholder="你的暱稱"]', PLAYERS[0]);
    await pages[0].click("text=建立房間");
    await delay(2000);

    const url = pages[0].url();
    const roomCode = url.match(/#room=(\d{4})/)?.[1] || "";
    console.log(`   Room: ${roomCode}`);

    // Players B, C, D join
    for (let i = 1; i < 4; i++) {
      console.log(`2️⃣ ${PLAYERS[i]} joins...`);
      pages[i] = await contexts[i].newPage();
      await pages[i].goto(BASE_URL);
      await delay(1000);
      await pages[i].click("text=加入房間");
      await delay(500);
      await pages[i].fill('input[placeholder="房間碼 (4位數)"]', roomCode);
      await pages[i].fill('input[placeholder="你的暱稱"]', PLAYERS[i]);
      await pages[i].click("text=加入遊戲");
      await delay(2000);
    }

    await delay(3000); // heartbeats sync

    // Host starts
    console.log("3️⃣ Host starts game...");
    const startBtn = pages[0].locator("text=開始遊戲");
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startBtn.click();
    }
    await delay(1500);

    // All players confirm ready
    console.log("4️⃣ All confirm ready...");
    for (let i = 0; i < 4; i++) {
      const readyBtn = pages[i].locator("text=準備好了！");
      if (await readyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await readyBtn.click();
        console.log(`   ${PLAYERS[i]} ready ✅`);
      }
      await delay(500);
    }

    await delay(3000); // game starts

    // Find who has the turn (has 梅花3)
    console.log("5️⃣ Game started, finding first player...");
    let firstPlayer = -1;
    for (let i = 0; i < 4; i++) {
      const text = await pages[i].innerText("body").catch(() => "");
      if (text.includes("輪到你出牌")) {
        firstPlayer = i;
        console.log(`   ${PLAYERS[i]} has first turn`);
        break;
      }
    }

    if (firstPlayer >= 0) {
      // First player plays a single card (click first card, then play)
      console.log("6️⃣ First player plays a card...");
      const cards = pages[firstPlayer].locator(".card-base");
      const cardCount = await cards.count();
      console.log(`   Has ${cardCount} cards`);

      if (cardCount > 0) {
        // Click the first card (should be smallest, hopefully includes 3C)
        await cards.first().click();
        await delay(500);

        // Click play
        const playBtn = pages[firstPlayer].locator("text=出牌");
        if (await playBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
          await playBtn.click();
          console.log("   Played a card ✅");
        } else {
          console.log("   Play button disabled — might need 3C");
          // Try clicking more cards to find 3C combo
          await cards.first().click(); // deselect
          await delay(200);
          // Just select first card again for demo
          await cards.first().click();
          await delay(500);
        }
      }

      await delay(2000);

      // Next player passes
      console.log("7️⃣ Next player passes...");
      for (let i = 0; i < 4; i++) {
        if (i === firstPlayer) continue;
        const text = await pages[i].innerText("body").catch(() => "");
        if (text.includes("輪到你出牌")) {
          const passBtn = pages[i].locator("text=Pass");
          if (await passBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
            await passBtn.click();
            console.log(`   ${PLAYERS[i]} passed ✅`);
          }
          break;
        }
      }

      await delay(2000);
    }

    // Wait a moment for video to capture final state
    await delay(3000);
    console.log("\n📹 Saving video...");

  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    // Close pages to finalize video
    for (const page of pages) {
      if (page) await page.close();
    }
    for (const ctx of contexts) {
      await ctx.close();
    }
    await browser.close();
    console.log("✅ Video saved to test-videos/");
  }
}

main();
