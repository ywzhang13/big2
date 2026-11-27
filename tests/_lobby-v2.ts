// 大廳 v2（明亮娛樂城風，小宜〈大廳素材v2-驗收與四大廳排版規格〉2026-11-27；老馬實作）：素材、長期快取、四個大廳都換上、刪掉的兩段說明
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
export {};
const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);

const hashes = JSON.parse(readFileSync("scripts/immutable-assets.json", "utf8")) as Record<string, string>;
/** WebP 有沒有透明通道（VP8X 旗標的 alpha 位元，或 VP8L 帶 alpha） */
const webpAlpha = (buf: Buffer) => {
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") return (buf[20] & 0x10) !== 0;
  if (chunk === "VP8L") return ((buf[24] >> 4) & 1) === 1;
  return false;
};
/** WebP 寬高（VP8X：24～29 位元組；有損 VP8：26～29 位元組各 14 位元） */
const webpSize = (buf: Buffer) => {
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  return null;
};

// 1. 素材：透明的 6 種、背景 4 種，桌機＋手機各一張；登記長期快取；透明的真的有 alpha
const ALPHA = ["card-thirteen", "card-mahjong", "card-big2", "btn-primary", "btn-second", "logo"];
const BG = ["bg-home", "bg-mahjong", "bg-thirteen", "bg-big2"];
for (const k of [...ALPHA, ...BG]) {
  for (const suf of [".v1.webp", ".v1.m.webp"]) {
    const url = `/home/lobby-${k}${suf}`, file = `public${url}`;
    const has = existsSync(file);
    const buf = has ? readFileSync(file) : Buffer.alloc(0);
    const alphaOk = !ALPHA.includes(k) || webpAlpha(buf);
    ok(has && !!hashes[url] && alphaOk && statSync(file).size < 200_000, `A1 ${url}：檔案在、登記長期快取、${ALPHA.includes(k) ? "有透明通道、" : ""}< 200KB`);
  }
}
ok(!readdirSync("public/home").some((f) => /^lobby-.*\.(jpe?g|png)$/i.test(f)), "A2 原始 JPG／PNG 沒有放進 public（只有 WebP）");
// 背景已經裁掉原圖 12%、88% 的兩條淡橫線（2752×1140 等比縮）：比例約 2.41
for (const k of BG) {
  const s = webpSize(readFileSync(`public/home/lobby-${k}.v1.webp`)) ?? { w: 0, h: 1 };
  ok(Math.abs(s.w / s.h - 2752 / 1140) < 0.02, `A3 ${k} 裁掉上下淡橫線（比例 ${(s.w / s.h).toFixed(3)}）`);
}

// 2. 總大廳：只留 LOGO、遊戲名稱；三張卡照規格順序（十三支、台灣麻將、大老二）
const home = readFileSync("app/page.tsx", "utf8").replace(/^\s*\/\/.*$/gm, ""); // 註解不算（註解裡寫了拿掉哪兩段）
ok(!/多人線上|選擇遊戲開始遊玩/.test(home), "H1 總大廳拿掉「多人線上桌遊平台」「選擇遊戲開始遊玩 · 支援多人即時對戰」");
const order = [...home.matchAll(/key: "(\w+)", href: "([^"]+)", name: "([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}`);
ok(order.join(",") === "thirteen:/thirteen:十三支,mahjong:/mahjong:台灣麻將,big2:/big2:大老二", `H2 三張卡：${order.join("、")}`);
ok(/<LobbyBg kind="home" \/>/.test(home) && /<LobbyHero \/>/.test(home) && /<HomeAccount \/>/.test(home), "H3 總大廳：背景、LOGO 底牌、右上帳號列");

// 3. 三款遊戲大廳首頁都換上（背景、LOGO＋遊戲名稱、圖片按鈕）；建立／加入畫面不動
const lobbies: [string, string, string][] = [["app/mahjong/page.tsx", "mahjong", "台灣麻將"], ["components/thirteen/ThLobby.tsx", "thirteen", "十三支"], ["app/big2/page.tsx", "big2", "大老二"]];
for (const [file, kind, name] of lobbies) {
  const s = readFileSync(file, "utf8");
  ok(s.includes(`<LobbyBg kind="${kind}" />`) && s.includes(`<LobbyHero name="${name}" />`) && /lv2-btn primary/.test(s) && /lv2-btn second/.test(s),
    `L1 ${kind} 大廳首頁：背景、LOGO＋「${name}」、主次按鈕`);
  ok(!/StartConfirm/.test(readFileSync("components/gameLobby/LobbyHero.tsx", "utf8")), `L2 ${kind}：大廳元件沒碰開局確認`);
}
ok(/className="lv2-btn ghost"[^>]*>\s*歷史紀錄|歷史紀錄/.test(readFileSync("app/mahjong/page.tsx", "utf8")) && /data-lobby-board>排行榜/.test(readFileSync("app/mahjong/page.tsx", "utf8")),
  "L3 麻將：歷史紀錄、排行榜照舊在（次要藍鈕）");
ok(/data-th-records>歷史紀錄/.test(readFileSync("components/thirteen/ThLobby.tsx", "utf8")), "L4 十三支：歷史紀錄照舊在");

// 4. 樣式：手機用 .m 小圖、桌機用原圖；觸控至少 44；圖沒到時有底色
const css = readFileSync("app/lobby-v2.css", "utf8");
ok(/url\("\/home\/lobby-bg-home\.v1\.m\.webp"\)/.test(css) && /@media \(min-width: 1100px\) and \(min-height: 700px\) \{[\s\S]*url\("\/home\/lobby-bg-home\.v1\.webp"\)/.test(css), "C1 背景：手機 .m、桌機原圖");
ok(/\.lv2-btn \{[^}]*min-height: 44px/.test(css) && /\.lv2-foot::after \{ content: ""; position: absolute; inset: -3px; \}/.test(css), "C2 按鈕最少 44 高；手機的「返回首頁」看起來 38、點擊範圍 44");
ok(/\.lv2-bg \{[^}]*background: #D0B5B4/.test(css) && /\.lv2-bg\[data-lv2-bg="big2"\][^}]*background: #E2B491/.test(css), "C3 背景圖還沒載好時先顯示同色系的底（不會白一下）");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
