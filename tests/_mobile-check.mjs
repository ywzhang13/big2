import { chromium, devices } from "playwright";
import { writeFileSync } from "node:fs";

// Create a room + join, then open P1 in mobile portrait and screenshot.
const BASE = "http://localhost:3000";
const pid = "mobcheck-" + Date.now();

async function api(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

const created = await api("/api/mahjong/create", { hostId: pid });
console.log("room", created.code);
// Join 4 players
const pids = [pid];
await api("/api/mahjong/join", { code: created.code, name: "P1", playerId: pid });
for (let i = 2; i <= 4; i++) {
  const p = "mc-" + i;
  pids.push(p);
  await api("/api/mahjong/join", { code: created.code, name: "P" + i, playerId: p });
}
await api("/api/mahjong/start", { roomId: created.roomId, playerId: pid });

// Open browser as P1 in portrait mobile
const b = await chromium.launch();
const ctx = await b.newContext({
  ...devices["iPhone 14 Pro"],
  recordVideo: { dir: "/tmp/mobile-check", size: { width: 393, height: 852 } },
});
await ctx.addInitScript((p) => {
  localStorage.setItem("mj_pid", p);
  localStorage.setItem("mj_name", "P1");
}, pid);
const page = await ctx.newPage();
await page.goto(`${BASE}/mahjong#room=${created.code}`);
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/mobile-portrait.png" });
console.log("saved /tmp/mobile-portrait.png");
await ctx.close();
await b.close();
