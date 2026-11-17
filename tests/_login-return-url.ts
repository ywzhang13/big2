// LINE 登入完回到哪裡（審伯對十三支前端的必修 5，2026-11-18）：lib/mahjong/clientAuth.ts 的 loginReturnUrl
//   原本寫死回 /mahjong：從十三支（含帶房號的邀請網址）按 LINE 登入，回來變成麻將頁、房號也不見
//   L1 十三支：從 /thirteen 登入 → 回 /thirteen
//   L2 帶房號的十三支邀請：/thirteen#room=1234、/thirteen?room=1234 → 回 /thirteen?room=1234（#room 會被登入流程蓋掉，所以改放 query）；
//      其他查詢參數保留，登入用的參數（pairing、error…）不帶回去
//   L3 麻將：所有 /mahjong 開頭的頁面照舊回 /mahjong（有房號帶 ?room=），和修改前的結果逐字相同
//   L4 大老二：大老二頁面沒有 LINE 登入入口（不 import useMjAuth、loginReturnUrl），回跳行為不受影響
//   L5 只回站內：網址是別的網域、//evil.com、/\\evil.com、/api/…、編碼過的 //，一律回 /mahjong（不會開放式重導）；
//      含 .. 的路徑會先被網址解析化成站內路徑，結果一定還在本站
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginReturnUrl } from "../lib/mahjong/clientAuth";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const SITE = "https://big2-three.vercel.app";
/** 模擬在某個網址按 LINE 登入（瀏覽器的 window.location） */
function from(href: string, roomCode: string | null = null): string {
  const u = new URL(href, SITE);
  (globalThis as { window?: unknown }).window = { location: { origin: SITE, href: u.href, pathname: u.pathname, search: u.search, hash: u.hash } };
  try { return loginReturnUrl(roomCode); } catch (e) { return `丟錯：${(e as Error).message}`; }
}
/** 修改前的寫法（對照「麻將完全不變」用） */
function oldMahjong(roomCode: string | null): string {
  const url = new URL("/mahjong", SITE);
  if (roomCode && /^\d{4}$/.test(roomCode)) url.searchParams.set("room", roomCode);
  return url.toString();
}

// L1、L2
eq([from("/thirteen"), from("/thirteen?x=1")], [`${SITE}/thirteen`, `${SITE}/thirteen?x=1`], "L1 從十三支登入：回十三支（其他查詢參數保留）");
eq([from("/thirteen#room=1234"), from("/thirteen?room=1234"), from("/thirteen?pairing=ABCD&error=x&room=1234#room=1234"), from("/thirteen#room=12a4")],
  [`${SITE}/thirteen?room=1234`, `${SITE}/thirteen?room=1234`, `${SITE}/thirteen?room=1234`, `${SITE}/thirteen`],
  "L2 帶房號的十三支邀請（#room= 或 ?room=）：回 /thirteen?room=1234；登入用的 pairing、error 不帶回去；房號不是 4 位數字就不帶");
eq(from("/thirteen", "5678"), `${SITE}/thirteen?room=5678`, "L2 呼叫端直接給房號（例如已在房裡）：照樣帶 ?room=");

// L3
const cases: [string, string | null][] = [["/mahjong", null], ["/mahjong#room=1234", "1234"], ["/mahjong?room=1234", "1234"], ["/mahjong/watch?code=0000", null],
  ["/mahjong?guest=1", null], ["/mahjong", "12a4"], ["/mahjong/admin", null]];
eq(cases.map(([h, r]) => from(h, r)), cases.map(([, r]) => oldMahjong(r)), "L3 麻將（大廳、帶房號、觀戰、遊客入口、管理頁）：回跳網址和修改前逐字相同（一律 /mahjong，有房號帶 ?room=）");

// L4
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []; });
const big2Files = [...files(path.join(ROOT, "app/big2")), ...(readdirSync(path.join(ROOT, "components")).includes("big2") ? files(path.join(ROOT, "components/big2")) : [])];
eq([big2Files.length > 0, big2Files.filter((f) => /useMjAuth|loginReturnUrl|signInWithOAuth/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f))], [true, []],
  "L4 大老二頁面沒有 LINE 登入入口（沒有用 useMjAuth、loginReturnUrl、signInWithOAuth），登入回跳行為不受影響");

// L5
const evil = ["https://evil.com/thirteen", "//evil.com/x", "/\\evil.com", "/api/thirteen/state?x=1", "/%2F%2Fevil.com", "/thirteen/../../evil"];
const got = evil.map((h) => {
  if (h.startsWith("https://evil.com")) { (globalThis as { window?: unknown }).window = { location: { origin: SITE, href: h, pathname: "/thirteen", search: "", hash: "" } }; try { return loginReturnUrl(null); } catch (e) { return String(e); } }
  // 站內網址但路徑怪：直接放進 pathname（瀏覽器真的可能出現 https://站/\\evil.com、https://站//evil.com/x 這種網址）
  (globalThis as { window?: unknown }).window = { location: { origin: SITE, href: SITE + h, pathname: h.split("?")[0], search: h.includes("?") ? "?" + h.split("?")[1] : "", hash: "" } };
  try { return loginReturnUrl(null); } catch (e) { return String(e); }
});
eq([got.map((u) => new URL(u).origin === SITE), got], [evil.map(() => true), [...evil.slice(0, 5).map(() => `${SITE}/mahjong`), `${SITE}/evil`]],
  "L5 只回站內：別的網域、//evil.com、/\\evil.com、/api/…、編碼過的 // 一律回 /mahjong；含 .. 的路徑瀏覽器會先化成站內的 /evil，一樣留在本站。全部都不會被導到站外");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
