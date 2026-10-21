// 偏好設定跟著帳號（GET／PUT /api/mahjong/prefs，2026-10-22；2026-10-23 改成 v3，加語音的自動播放、音量）
//   P1 沒登入 401；P2 第一次讀是 null，回應帶 account
//   P3 存了讀回同一份；別的帳號讀不到
//   P4 白名單：3 款粉紅可以；不在選項裡、多欄位（含 face）、舊的 v1、v2 格式、少欄位、型別不對、語音欄位值不對、超大 body 都擋，原本存的不變
//   P5 PUT 的 account 和登入的人不符 409、沒帶 400：切換帳號後晚到的舊請求不會寫進新帳號
//   P6 body 裡帶別人的 id 也只會寫自己的
//   P7 重送冪等：同一份存兩次，還是一列、內容相同
//   P8 訪客：讀寫都不碰資料庫，回 persisted:false
//   P9 資料庫裡的值不在白名單 → 當沒存；P10 資料庫出錯 → 500；P11 刪帳號連帶刪除
//   P12 上線前存的 v2：讀出來補上語音預設值（自動播放開、音量一般）當成 v3
import { GET as prefsGet, PUT as prefsPut } from "../../app/api/mahjong/prefs/route";
import { tokens } from "../support/stub-auth";
import { addUser, db, fail } from "../support/stub-prefs-store";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const A = "aaaaaaaa-0000-4000-8000-000000000000", B = "bbbbbbbb-0000-4000-8000-000000000000", G = "99999999-0000-4000-8000-000000000000";
tokens.lineA = { id: A, displayName: "A", pictureUrl: null, isGuest: false };
tokens.lineB = { id: B, displayName: "B", pictureUrl: null, isGuest: false };
tokens.guest = { id: G, displayName: "訪客", pictureUrl: null, isGuest: true };
await addUser(A); await addUser(B); await addUser(G, true);

const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
async function get(tok?: string) {
  const r = await prefsGet(new Request("http://x/api/mahjong/prefs", { headers: auth(tok) }));
  return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") };
}
async function put(body: unknown, tok?: string, raw = false) {
  const r = await prefsPut(new Request("http://x/api/mahjong/prefs", { method: "PUT", headers: auth(tok), body: raw ? (body as string) : JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
const rows = async () => (await (await db()).query<{ user_id: string; prefs: unknown }>("select user_id::text, prefs from mj_user_prefs order by 1")).rows;
const SAKURA = { v: 3, back: "sakura", felt: "night", autoVoice: true, voiceVol: "mid" };
const st = (r: { status: number; body: { error?: string } }) => `${r.status}:${r.body.error ?? "ok"}`;

// P1
eq([st(await get()), st(await put({ account: A, prefs: SAKURA }))], ["401:not_logged_in", "401:not_logged_in"], "P1 沒登入：讀、存都 401");

// P2
const g0 = await get("lineA");
eq([g0.status, g0.body, g0.cache], [200, { account: A, persisted: true, prefs: null }, "no-store"], "P2 第一次讀：prefs 是 null，回應帶 account（這份屬於哪個帳號）、不快取");

// P3
const p1 = await put({ account: A, prefs: SAKURA }, "lineA");
eq([p1.status, p1.body, (await get("lineA")).body, (await get("lineB")).body], [200, { account: A, persisted: true, prefs: SAKURA }, { account: A, persisted: true, prefs: SAKURA }, { account: B, persisted: true, prefs: null }],
  "P3 A 存了櫻花夜（櫻花粉＋靜夜藍）讀回同一份；B 讀到的是自己的（null），看不到 A 的");

// P4
const pinks = [];
for (const back of ["sakura", "rosepink", "coral"]) pinks.push((await put({ account: B, prefs: { v: 3, back, felt: "wine", autoVoice: false, voiceVol: "low" } }, "lineB")).status);
eq(pinks, [200, 200, 200], "P4a 三款粉紅牌背（sakura、rosepink、coral）都收");
const bad = [
  { ...SAKURA, back: "rainbow" }, { ...SAKURA, felt: "pink" }, { ...SAKURA, back: "SAKURA" },
  { ...SAKURA, sfx: true }, { v: 3, back: "jade", felt: "green", autoVoice: true }, { ...SAKURA, v: 4 }, { ...SAKURA, v: "3" }, { ...SAKURA, back: 1 },
  { ...SAKURA, autoVoice: "yes" }, { ...SAKURA, voiceVol: 70 }, { ...SAKURA, voiceVol: "loud" }, { v: 2, back: "sakura", felt: "night" },
  [SAKURA], "sakura", null,
];
const badRes = [];
for (const prefs of bad) badRes.push(st(await put({ account: A, prefs }, "lineA")));
const big = await put(JSON.stringify({ account: A, prefs: SAKURA, pad: "x".repeat(2000) }), "lineA", true);
const broken = await put("{壞掉", "lineA", true);
eq([badRes, st(big), st(broken), (await get("lineA")).body.prefs], [Array(bad.length).fill("400:invalid_prefs"), "413:too_large", "400:bad_request", SAKURA],
  "P4b 不在白名單的值（含大小寫不同）、多欄位（音效設定不收）、少欄位、版本不對、型別不對、自動播放不是布林、音量不是 low／mid／high、舊的 v2 格式、不是物件都 400；超大 413、壞 JSON 400；原本存的不變");
const withFace = [
  { ...SAKURA, face: "ivory" }, { ...SAKURA, face: null },
  { v: 1, back: "sakura", face: "ivory", felt: "night" }, { v: 1, back: "sakura", felt: "night" },
];
const before4c = await rows();
const faceRes = [];
for (const prefs of withFace) faceRes.push(st(await put({ account: A, prefs }, "lineA")));
eq([faceRes, JSON.stringify(await rows()) === JSON.stringify(before4c)], [Array(withFace.length).fill("400:invalid_prefs"), true],
  "P4c 帶 face（白名單裡原本有的值、null 都一樣）、舊的 v1 格式（有沒有 face 都一樣）→ 整份 400 invalid_prefs，不會只拿掉 face 存其他的；資料庫完全沒變");

// P5
const before5 = await rows();
const mis = await put({ account: B, prefs: { ...SAKURA, back: "coral" } }, "lineA");
const noAcc = await put({ prefs: { ...SAKURA, back: "coral" } }, "lineA");
eq([st(mis), st(noAcc), JSON.stringify(await rows()) === JSON.stringify(before5)], ["409:account_mismatch", "400:account_required", true],
  "P5 用 A 登入、account 寫 B（例如切換帳號後晚到的舊請求）→ 409；沒帶 account → 400；資料庫完全沒變");

// P6
await put({ account: A, user_id: B, userId: B, prefs: { v: 3, back: "ink", felt: "black", autoVoice: false, voiceVol: "high" } }, "lineA");
const r6 = await rows();
const sorted = (o: unknown) => o && Object.fromEntries(Object.entries(o as object).sort(([x], [y]) => x.localeCompare(y))); // jsonb 會重排鍵的順序
eq([sorted(r6.find((r) => r.user_id === A)?.prefs), sorted(r6.find((r) => r.user_id === B)?.prefs)], [sorted({ v: 3, back: "ink", felt: "black", autoVoice: false, voiceVol: "high" }), sorted({ v: 3, back: "coral", felt: "wine", autoVoice: false, voiceVol: "low" })],
  "P6 body 裡塞 user_id／userId 是 B：只會寫進登入的 A，B 的設定不變");

// P7
const same = { v: 3, back: "rose", felt: "green", autoVoice: true, voiceVol: "high" };
const x1 = await put({ account: A, prefs: same }, "lineA"), x2 = await put({ account: A, prefs: same }, "lineA");
eq([x1.body, x2.body, (await rows()).filter((r) => r.user_id === A).length], [{ account: A, persisted: true, prefs: same }, { account: A, persisted: true, prefs: same }, 1],
  "P7 同一份重送兩次：回應相同，資料庫還是 A 一列");

// P8
const before8 = await rows();
const gg = await get("guest"), gp = await put({ account: G, prefs: SAKURA }, "guest"), gbad = await put({ account: G, prefs: { ...SAKURA, back: "x" } }, "guest");
eq([gg.body, gp.body, st(gbad), JSON.stringify(await rows()) === JSON.stringify(before8)],
  [{ account: G, persisted: false, prefs: null }, { account: G, persisted: false, prefs: SAKURA }, "400:invalid_prefs", true],
  "P8 訪客：讀回 persisted:false、存回 persisted:false（前端改用本機設定），格式不對照樣 400；資料庫完全沒寫");

// P9
await (await db()).query("update mj_user_prefs set prefs = $1 where user_id = $2", [{ v: 3, back: "rainbow", felt: "night", autoVoice: true, voiceVol: "mid" }, B]); // 資料庫的 check 只看結構，值的白名單在伺服器
eq((await get("lineB")).body, { account: B, persisted: true, prefs: null }, "P9 資料庫裡的值不在白名單（例如之後拿掉某個選項）→ 當沒存，前端套本機或預設");

// P10
fail.next = true; const e1 = await get("lineA");
fail.next = true; const e2 = await put({ account: A, prefs: SAKURA }, "lineA");
eq([st(e1), st(e2)], ["500:server_error", "500:server_error"], "P10 資料庫出錯：讀、存都回 500 server_error（不送出內部訊息）");

// P12
await (await db()).query("update mj_user_prefs set prefs = $1 where user_id = $2", [{ v: 2, back: "coral", felt: "wine" }, B]);
eq((await get("lineB")).body, { account: B, persisted: true, prefs: { v: 3, back: "coral", felt: "wine", autoVoice: true, voiceVol: "mid" } },
  "P12 上線前存的 v2（只有牌背、桌布）：讀出來補上語音預設值（自動播放開、音量一般），當成 v3 回給前端");

// P11
await (await db()).query("delete from auth.users where id = $1", [A]);
eq((await rows()).map((r) => r.user_id), [B], "P11 刪掉 A 的帳號：A 的偏好設定跟著刪，B 不動");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
