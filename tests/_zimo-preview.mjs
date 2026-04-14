import { chromium } from "playwright";
const html = `<!doctype html><html><head><style>
body { margin: 0; background: radial-gradient(ellipse at center top, #2a1f0e 0%, #1a1408 40%, #0f0e08 100%); min-height: 100vh; position: relative; overflow: hidden; }
.content { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #666; font-size: 14px; }
.overlay { position: absolute; inset: 0; z-index: 65; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; background: rgba(0,0,0,0.88); }
.glow { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); border-radius: 50%; width: 220vmax; height: 220vmax; background: radial-gradient(circle, rgba(255,215,0,0.55) 0%, rgba(255,165,0,0.25) 18%, rgba(255,100,0,0.08) 30%, transparent 45%); }
.rays { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); border-radius: 50%; width: 200vmax; height: 200vmax;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(255,215,0,0.35) 15deg, transparent 30deg, transparent 45deg, rgba(255,215,0,0.35) 60deg, transparent 75deg, transparent 90deg, rgba(255,215,0,0.35) 105deg, transparent 120deg, transparent 135deg, rgba(255,215,0,0.35) 150deg, transparent 165deg, transparent 180deg, rgba(255,215,0,0.35) 195deg, transparent 210deg, transparent 225deg, rgba(255,215,0,0.35) 240deg, transparent 255deg, transparent 270deg, rgba(255,215,0,0.35) 285deg, transparent 300deg, transparent 315deg, rgba(255,215,0,0.35) 330deg, transparent 345deg);
  -webkit-mask-image: radial-gradient(circle, black 0%, black 14%, transparent 28%); mask-image: radial-gradient(circle, black 0%, black 14%, transparent 28%); }
.text { position: relative; text-align: center; }
.zimo { font-size: 14vw; font-weight: 900; letter-spacing: 0.3em; color: #fff8dc; font-family: serif; line-height: 1;
  text-shadow: 0 0 50px #FFD700, 0 0 100px #FFA500, 0 0 150px #FF6347, 0 4px 12px rgba(0,0,0,0.6); }
.name { margin-top: 16px; color: #f0d68a; font-weight: bold; font-size: 24px; text-shadow: 0 0 20px rgba(240,214,138,0.7); }
</style></head><body>
<div class="content">[ game UI behind ]</div>
<div class="overlay">
  <div class="glow"></div>
  <div class="rays"></div>
  <div class="text"><p class="zimo">自摸</p><p class="name">P1</p></div>
</div>
</body></html>`;

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true });
const p = await c.newPage();
await p.setContent(html);
await p.waitForTimeout(300);
await p.screenshot({ path: "/tmp/zimo-new.png" });
await b.close();
console.log("done");
