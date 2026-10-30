// 自摸特效庫＋斗內後台（老闆 2026-10-31 定案），走真的 API、真的 migration（記憶體 PostgreSQL）
//   Z1 後台 8 支 API：沒登入 401；一般玩家、遊客、遊客身分的老闆帳號都 403，回應沒有任何資料
//   Z2 記帳、作廢：只記帳不開通；作廢要原因、只能一次；排行榜扣回；操作紀錄都在；資料庫刪不掉、改不了
//   Z3 排行榜：只算本週有效；顯示 LINE 名稱和頭像（老闆 2026-10-31 不做匿名）；公開 API 沒有任何帳號 id
//   Z10 總斗內（range=all）：累計多週的有效斗內、作廢不算、名稱頭像用最新一筆有效的、沒有帳號 id；本週榜不受影響；range 亂填 400
//   Z11 打牌、摸牌、動作、下一局：查自摸特效的請求在登入檢查之前就發出（和登入檢查同時進行，不多串一次往返）
//   Z12 烈焰（flame）已移除：後台開通、收回、玩家選用都 400；資料庫也寫不進去；老闆帳號的清單沒有烈焰
//   Z9 老闆記帳＝斗內卡自摸次數歸零（同一個交易）；非老闆呼叫記帳 403、次數不變；作廢不還原
//   Z4 開通到下週日 23:59:59（老闆 2026-10-31）：開通後第一個週一照樣有特效；下週日 23:59:59 自摸帶特效，再下一個週一 00:00:00 回金色自摸（固定時鐘）；
//      到期那一刻設定頁的套用狀態也回金色
//   Z14 沒權限的特效：選用被拒（403）不會改到原本的選用，回應和之後的查詢都回目前實際套用的；過期後設定頁、後台、牌桌公開資料、自摸全都是金色
//   Z5 提前收回：下一次自摸回金色自摸；只收回一種時，選用的不是那種就照舊
//   Z6 老闆帳號：6 種永久全開；沒選過＝金色自摸；選雷霆後自摸帶 thunder；不能被開通／收回；資料庫查不到時回金色
//   Z7 玩家自己選：金色自摸永久可選；其他只能選有效開通的；過期、收回後 403；遊客 403
//   Z8 胡別人打的牌不帶特效；牌局狀態、廣播沒有帳號 id；存著的特效過期了（沒重查）也不播
import { GET as players } from "../../app/api/mahjong/admin/players/route";
import { GET as donationsGet, POST as donationsAdd } from "../../app/api/mahjong/admin/donations/route";
import { POST as donationVoid } from "../../app/api/mahjong/admin/donations/void/route";
import { GET as fxGet, POST as fxGrant } from "../../app/api/mahjong/admin/fx/route";
import { POST as fxRevoke } from "../../app/api/mahjong/admin/fx/revoke/route";
import { GET as audit } from "../../app/api/mahjong/admin/audit/route";
import { GET as board } from "../../app/api/mahjong/donations/leaderboard/route";
import { GET as myFxGet, POST as myFxSet } from "../../app/api/mahjong/zimo-fx/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { GET as getState } from "../../app/api/mahjong/state/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import { clock, db, fail as storeFail, order, users } from "../support/stub-zimofx-store";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as nextGame } from "../../app/api/mahjong/next-game/route";
import { addUser } from "../support/stub-donate-store";
import { GET as donateGet } from "../../app/api/mahjong/donate/route";
import { POST as donateAck } from "../../app/api/mahjong/donate/ack/route";
import { selfDrawWinFx } from "../../lib/mahjong/winFx";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const A = "aaaa1111-0000-4000-8000-000000000001", B = "bbbb2222-0000-4000-8000-000000000002", G = "99993333-0000-4000-8000-000000000003";
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
tokens.bossGuest = { id: BOSS, displayName: null, pictureUrl: null, isGuest: true };
tokens.a = { id: A, displayName: "阿明", pictureUrl: null, isGuest: false };
tokens.b = { id: B, displayName: "阿華", pictureUrl: null, isGuest: false };
tokens.guest = { id: G, displayName: null, pictureUrl: null, isGuest: true };
users[A] = { name: "阿明", avatarUrl: "https://pic/a" };
users[B] = { name: "阿華", avatarUrl: "https://pic/b" };
users[G] = { name: "遊客", avatarUrl: null, guest: true };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
for (const u of [A, B, BOSS]) await addUser(u); await addUser(G, true); // 斗內卡的歸零點有外鍵連到 auth.users

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const T = (s: string) => Date.parse(s + "+08:00");
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
async function get(fn: (r: Request) => Promise<Response>, url: string, tok?: string) {
  const r = await fn(new Request("http://x" + url, { headers: auth(tok) }));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}
async function post(fn: (r: Request) => Promise<Response>, body: object, tok?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) }));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}
const IDS = [BOSS, A, B, G];
const leaks = (text: string) => IDS.filter((id) => text.includes(id)).length + (/"userId"/.test(text) ? 1 : 0);

// ---- 牌局：座位 1 綁 who，手上聽二五萬；摸進五萬自摸 ----
let nextId = 50000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const WAIT25 = "m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1";
const JUNK = "m1 m1 m9 m9 p1 p9 s1 s9 z2 z3 z4 z6 z7 s5 s7 p5";
const st = () => rooms.R.game_state as MahjongGameState;
function setup(who: string, turn = 1) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(seat === 1 ? WAIT25 : JUNK), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0, userId: seat === 1 ? who : `u:p${seat}` })),
    wall: tiles(Array(40).fill("p9").join(" ")), currentTurn: turn, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as unknown as MahjongGameState;
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
const seatTok = (who: string) => (who === BOSS ? "boss" : who === A ? "a" : "b");
/** who 坐座位 1、摸進五萬自摸；回傳 winners[0].winFx（沒有＝null）、廣播和 state 的文字 */
async function zimo(who: string) {
  setup(who);
  const tile = t("m5"); const s = st();
  s.players[1].hand.push(tile); s.hasDrawn = true; s.drawnTileId = tile.id;
  const r = await post(action, { roomId: "R", playerId: "p1", actionType: "win" }, seatTok(who));
  const other = await get(getState, "/?roomId=R&playerId=p2", "as:p2");
  const over = sent.find((e) => e.event === "mj_game_over")?.payload as { winners?: { winFx?: string }[] } | undefined;
  return { status: r.status, fx: st().winners?.[0]?.winFx ?? null, overFx: over?.winners?.[0]?.winFx ?? null, text: JSON.stringify(sent) + other.text + r.text };
}

// ---- Z1 後台權限 ----
{
  const res: string[] = [];
  let dataLeak = 0;
  for (const tok of [undefined, "a", "guest", "bossGuest", "as:p1"]) {
    const rs = [
      await get(players, "/?q=阿明", tok), await get(donationsGet, "/", tok), await post(donationsAdd, { userId: A, amount: 100, donatedAt: "2026-10-30T10:00:00+08:00" }, tok),
      await post(donationVoid, { id: "00000000-0000-0000-0000-000000000000", reason: "x" }, tok), await get(fxGet, `/?userId=${A}`, tok),
      await post(fxGrant, { userId: A, fx: ["storm"], active: "storm" }, tok), await post(fxRevoke, { userId: A }, tok), await get(audit, "/", tok),
    ];
    res.push(`${tok ?? "沒登入"}:${[...new Set(rs.map((r) => r.status))].join("/")}`);
    dataLeak += rs.filter((r) => Object.keys(r.body ?? {}).some((k) => k !== "error")).length;
  }
  const d = await db();
  const rows = (await d.query<{ n: number }>("select (select count(*) from mj_donations)::int + (select count(*) from mj_fx_grants)::int + (select count(*) from mj_fx_audit)::int as n")).rows[0].n;
  eq([res, dataLeak, rows], [["沒登入:401", "a:403", "guest:403", "bossGuest:403", "as:p1:403"], 0, 0],
    "Z1 後台 8 支 API：沒登入 401；一般玩家、遊客、遊客身分的老闆帳號、牌桌座位都 403；回應只有 error；資料庫沒有寫入任何東西");
}

// ---- Z2 記帳、作廢 ----
let idA = "", idB = "";
{
  clock.now = T("2026-10-29T12:00:00"); // 週四
  const a1 = await post(donationsAdd, { userId: A, amount: 500, donatedAt: "2026-10-27T20:00:00+08:00", note: "LINE Pay" }, "boss");
  const b1 = await post(donationsAdd, { userId: B, amount: 800, donatedAt: "2026-10-28T20:00:00+08:00" }, "boss");
  await post(donationsAdd, { userId: A, amount: 300, donatedAt: "2026-10-25T23:59:59+08:00" }, "boss"); // 上週日
  idA = a1.body.id; idB = b1.body.id;
  const bad = [
    (await post(donationsAdd, { userId: A, amount: 0, donatedAt: "2026-10-27T20:00:00+08:00" }, "boss")).status,
    (await post(donationsAdd, { userId: A, amount: 1.5, donatedAt: "2026-10-27T20:00:00+08:00" }, "boss")).status,
    (await post(donationsAdd, { userId: A, amount: 1000000, donatedAt: "2026-10-27T20:00:00+08:00" }, "boss")).status,
    (await post(donationsAdd, { userId: A, amount: 100, donatedAt: "2026-11-05T20:00:00+08:00" }, "boss")).status,
    (await post(donationsAdd, { userId: G, amount: 100, donatedAt: "2026-10-27T20:00:00+08:00" }, "boss")).body.error,
  ];
  const fxAfterDonate = await get(myFxGet, "/", "a");
  eq([a1.status, b1.status, bad, fxAfterDonate.body.available], [200, 200, [400, 400, 400, 400, "unknown_player"], { golden: null }],
    "Z2 老闆記兩筆 200；金額 0、小數、超過 999999、未來日期 400；遊客帳號 unknown_player；記帳不會開通特效");
  const before = (await get(board, "/")).body.rows.map((r: { name: string; amount: number }) => `${r.name}:${r.amount}`);
  const v1 = await post(donationVoid, { id: idB, reason: "金額打錯" }, "boss");
  const v2 = await post(donationVoid, { id: idB, reason: "再一次" }, "boss");
  const v3 = await post(donationVoid, { id: idA, reason: "" }, "boss");
  const after = (await get(board, "/")).body.rows.map((r: { name: string; amount: number }) => `${r.name}:${r.amount}`);
  const list = (await get(donationsGet, "/?scope=all", "boss")).body;
  const vb = list.records.find((r: { id: string }) => r.id === idB);
  eq([before, v1.status, v2.status, v2.body.error, v3.status, after, list.records.length, [vb.voided, vb.voidReason, vb.voidedAt === clock.now], list.weekTotal],
    [["阿華:800", "阿明:500"], 200, 409, "not_voidable", 400, ["阿明:500"], 3, [true, "金額打錯", true], 500],
    "Z2 作廢 B 的 800：排行榜扣回只剩阿明 500；再作廢一次 409、沒原因 400；後台照樣列出 3 筆、B 那筆標作廢原因和時間；本週合計 500");
  const d = await db();
  const tries: string[] = [];
  for (const s of [`delete from mj_donations where id = '${idA}'`, `update mj_donations set amount = 1 where id = '${idA}'`, `update mj_donations set voided_at = null, voided_by = null, void_reason = null where id = '${idB}'`, "delete from mj_fx_audit", "update mj_fx_audit set action = 'x'"]) {
    try { await d.exec(s); tries.push("沒擋"); } catch { tries.push("擋下"); }
  }
  const au = (await get(audit, "/", "boss")).body.records.map((r: { action: string }) => r.action);
  eq([tries, au], [["擋下", "擋下", "擋下", "擋下", "擋下"], ["donation_void", "donation_add", "donation_add", "donation_add"]],
    "Z2 資料庫層：刪斗內、改金額、取消作廢、刪或改操作紀錄全部被擋；操作紀錄有 3 筆記帳＋1 筆作廢（失敗的作廢不記）");
}

// ---- Z3 排行榜不外露 ----
{
  const b2 = await post(donationsAdd, { userId: B, amount: 900, donatedAt: "2026-10-29T10:00:00+08:00" }, "boss");
  const r = await get(board, "/");
  eq([b2.status, r.status, r.body.rows.map((x: { rank: number; name: string; avatarUrl: string | null; amount: number }) => [x.rank, x.name, x.avatarUrl, x.amount]), Object.keys(r.body.rows[0]).sort(), leaks(r.text), /anonym|熱心玩家/.test(r.text)],
    [200, 200, [[1, "阿華", "https://pic/b", 900], [2, "阿明", "https://pic/a", 500]], ["amount", "avatarUrl", "name", "rank"], 0, false],
    "Z3 公開排行榜：顯示 LINE 名稱和頭像（阿華 900、阿明 500），每列只有名次、名稱、頭像、金額，沒有任何帳號 id，也沒有匿名欄位");
  clock.now = T("2026-11-02T00:00:00");
  const next = await get(board, "/");
  eq([next.body.rows.length, next.body.weekStart === T("2026-11-02T00:00:00")], [0, true], "Z3 到了週一 00:00 排行榜從 0 開始");
}

// ---- Z4 開通到期邊界 ----
{
  clock.now = T("2026-10-29T12:00:00");
  const g = await post(fxGrant, { userId: A, fx: ["thunder", "storm"], active: "storm" }, "boss");
  const bad = [(await post(fxGrant, { userId: A, fx: ["storm"], active: "thunder" }, "boss")).status, (await post(fxGrant, { userId: A, fx: ["rainbow"], active: "rainbow" }, "boss")).status,
    (await post(fxGrant, { userId: BOSS, fx: ["storm"], active: "storm" }, "boss")).body.error];
  clock.now = T("2026-11-02T00:00:00");
  const mon1 = await zimo(A);
  clock.now = T("2026-11-08T23:59:59");
  const sun = await zimo(A);
  const sunMine = (await get(myFxGet, "/", "a")).body;
  clock.now = T("2026-11-09T00:00:00");
  const mon = await zimo(A);
  const monMine = (await get(myFxGet, "/", "a")).body;
  eq([g.status, g.body.granted, g.body.expiresAt === T("2026-11-09T00:00:00"), bad, [mon1.fx, mon1.overFx], [sun.fx, sun.overFx], [sunMine.selected, sunMine.available.storm === T("2026-11-09T00:00:00")], [mon.fx, mon.overFx], [monMine.selected, monMine.available]],
    [200, 2, true, [400, 400, "owner_permanent"], ["storm", "storm"], ["storm", "storm"], ["storm", true], ["golden", "golden"], ["golden", { golden: null }]],
    "Z4 週四（10/29）開通雷霆、風暴（套用風暴）到 11/9 週一 00:00 前：隔週一 11/2 照樣帶 storm；下週日 11/8 23:59:59 自摸帶 storm（廣播也有）、設定頁顯示風暴；11/9 00:00:00 自摸安全回退金色、設定頁也回金色只剩金色可選");
}

// ---- Z5 提前收回 ----
{
  clock.now = T("2026-11-03T12:00:00");
  await post(fxGrant, { userId: B, fx: ["blackhole", "frost"], active: "blackhole" }, "boss");
  const r1 = await post(fxRevoke, { userId: B, fx: ["frost"] }, "boss");
  const z1 = await zimo(B);
  const r2 = await post(fxRevoke, { userId: B, fx: ["blackhole"] }, "boss");
  const z2 = await zimo(B);
  const r3 = await post(fxRevoke, { userId: B }, "boss");
  const info = (await get(fxGet, `/?userId=${B}`, "boss")).body;
  eq([r1.body.revoked, z1.fx, r2.body.revoked, z2.fx, r3.body.revoked, info.active, info.selected, info.grants.length, (await post(fxRevoke, { userId: BOSS }, "boss")).body.error],
    [1, "blackhole", 1, "golden", 0, {}, "golden", 2, "owner_permanent"],
    "Z5 收回冰封（沒在用）：自摸照樣黑洞；收回黑洞（正在用）：自摸安全回退金色自摸；開通紀錄保留 2 筆；老闆帳號不能收回");
}

// ---- Z6 老闆永久 ----
{
  clock.now = T("2099-06-15T12:00:00");
  const z1 = await zimo(BOSS);
  const mine = await get(myFxGet, "/", "boss");
  const sel = await post(myFxSet, { fx: "thunder" }, "boss");
  const z2 = await zimo(BOSS);
  storeFail.zimoFxFor = true;
  const z3 = await zimo(BOSS);
  clock.now = T("2026-10-29T12:00:00"); await post(fxGrant, { userId: A, fx: ["sakura"], active: "sakura" }, "boss");
  const z4 = await zimo(A);
  storeFail.zimoFxFor = false;
  eq([z1.fx, Object.keys(mine.body.available).sort(), Object.values(mine.body.available).every((v) => v === null), mine.body.selected, sel.status, z2.fx, z3.fx, z4.fx],
    ["golden", ["blackhole", "frost", "golden", "meteor", "sakura", "storm", "thunder"], true, "golden", 200, "thunder", "golden", "golden"],
    "Z6 老闆帳號到 2099 年還有效：沒選過＝金色自摸；6 種付費特效永久可選；選雷霆後自摸帶 thunder；資料庫查不到時所有帳號安全回退金色自摸");
}

// ---- Z7 玩家自己選 ----
{
  clock.now = T("2026-10-29T13:00:00");
  const list = await get(myFxGet, "/", "a");
  const ok1 = await post(myFxSet, { fx: "thunder" }, "a");
  const no1 = await post(myFxSet, { fx: "blackhole" }, "a");
  const z1 = await zimo(A);
  await post(fxRevoke, { userId: A, fx: ["thunder"] }, "boss");
  const no2 = await post(myFxSet, { fx: "thunder" }, "a");
  clock.now = T("2026-11-09T00:00:00");
  const no3 = await post(myFxSet, { fx: "sakura" }, "a");
  const after = await get(myFxGet, "/", "a");
  const guest = [(await get(myFxGet, "/", "guest")).status, (await post(myFxSet, { fx: "meteor" }, "guest")).status, (await get(myFxGet, "/")).status];
  eq([list.body.displayName, Object.keys(list.body.available).sort(), list.body.selected, ok1.status, no1.body.error, z1.fx, no2.body.error, no3.body.error, after.body.available, after.body.selected, guest],
    ["阿明", ["golden", "sakura", "storm", "thunder"], "sakura", 200, "not_granted", "thunder", "not_granted", "not_granted", { golden: null }, "golden", [403, 403, 401]],
    "Z7 API 回傳登入者 LINE 顯示名供預覽大字使用；阿明這週有金色自摸、雷霆、風暴、櫻花，選雷霆後自摸帶 thunder；沒開通的黑洞、收回的雷霆、11/9 週一過期的櫻花都 403；過期後只剩金色自摸；遊客 403、沒登入 401");
}

// ---- Z8 胡別人的牌、帳號 id、存著的特效過期 ----
{
  clock.now = T("2026-11-03T12:00:00");
  await post(fxGrant, { userId: A, fx: ["storm"], active: "storm" }, "boss");
  setup(A, 0);
  const tile = t("m5"); const s = st(); s.players[0].hand.push(tile); s.hasDrawn = true; s.drawnTileId = tile.id;
  await post(discard, { roomId: "R", playerId: "p0", tileId: tile.id }, "as:p0");
  const ron = await post(action, { roomId: "R", playerId: "p1", actionType: "win" }, "a");
  const ronWin = st().winners?.map((w) => [w.seat, w.from, w.winFx ?? null]);
  const zz = await zimo(A);
  const pub = await get(getState, "/?roomId=R&playerId=p2", "as:p2");
  eq([ron.status, ronWin, zz.fx, leaks(zz.text) + leaks(pub.text)], [200, [[1, 0, null]], "storm", 0], "Z8 阿明胡別人打的牌：不帶特效；自摸帶 storm；廣播和 state 都沒有帳號 id");
  eq([selfDrawWinFx({ userId: A, zimoFx: { code: "storm", until: Date.now() - 1 } }) ?? null, selfDrawWinFx({ userId: A, zimoFx: { code: "storm", until: Date.now() + 60000 } }), selfDrawWinFx({ userId: BOSS, zimoFx: undefined }), selfDrawWinFx({ userId: A, zimoFx: undefined }) ?? null],
    ["golden", "storm", "golden", "golden"], "Z8 牌局裡存著的特效已經過期（沒來得及重查）：安全回退金色自摸；舊牌局沒查過也回金色自摸");
}

// ---- Z9 老闆記帳＝斗內卡次數歸零 ----
{
  const d = await db();
  clock.now = T("2026-11-04T12:00:00");
  for (const [i, ts] of ["2026-11-04T10:00:00", "2026-11-04T11:00:00"].entries()) await d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, $2, $3, $4)", ["00000000-0000-4000-8000-00000000009" + i, 1, A, new Date(T(ts)).toISOString()]);
  const cnt = async () => (await (await donateGet(new Request("http://x", { headers: auth("a") }))).json()).count;
  const before = await cnt();
  const ackR = await post(donateAck, {}, "a");
  const afterAck = await cnt();
  const byA = await post(donationsAdd, { userId: A, amount: 100, donatedAt: "2026-11-04T11:30:00+08:00" }, "a");
  const byB = await post(donationsAdd, { userId: A, amount: 100, donatedAt: "2026-11-04T11:30:00+08:00" }, "b");
  const afterNonOwner = await cnt();
  clock.now = T("2026-11-04T12:05:00");
  const rec = await post(donationsAdd, { userId: A, amount: 100, donatedAt: "2026-11-04T11:30:00+08:00" }, "boss");
  const afterOwner = await cnt();
  const bCount = (await (await donateGet(new Request("http://x", { headers: auth("b") }))).json()).count;
  await post(donationVoid, { id: rec.body.id, reason: "測試" }, "boss");
  const afterVoid = await cnt();
  eq([before, ackR.body, afterAck, byA.status, byB.status, afterNonOwner, rec.status, afterOwner, bCount, afterVoid],
    [2, { count: 2 }, 2, 403, 403, 2, 200, 0, 0, 0],
    "Z9 阿明斗內卡 2 次：自己按斗內回 2、次數不變；阿明、阿華呼叫記帳 403、還是 2；老闆記一筆後歸零；作廢那筆不還原");
}

// ---- Z10 總斗內 ----
{
  // 到這裡為止的有效斗內：阿明 500（10/27）＋300（10/25，上一週）；阿華 900（10/29）；作廢的：阿華 800、阿明 100（Z9）
  clock.now = T("2026-11-10T12:00:00");
  users[B] = { name: "阿華新名", avatarUrl: "https://pic/b2" };
  await post(donationsAdd, { userId: B, amount: 50, donatedAt: "2026-11-10T10:00:00+08:00" }, "boss");
  users[A] = { name: "阿明改名", avatarUrl: "https://pic/a2" };
  const a2 = await post(donationsAdd, { userId: A, amount: 70, donatedAt: "2026-11-10T11:00:00+08:00" }, "boss");
  await post(donationVoid, { id: a2.body.id, reason: "打錯" }, "boss");
  const all = await get(board, "/?range=all");
  const week = await get(board, "/?range=week");
  const dflt = await get(board, "/");
  const rowsOf = (r: { body: { rows: { rank: number; name: string; avatarUrl: string | null; amount: number }[] } }) => r.body.rows.map((x) => [x.rank, x.name, x.avatarUrl, x.amount]);
  eq([all.status, all.body.range, rowsOf(all), Object.keys(all.body.rows[0]).sort(), leaks(all.text), "weekStart" in all.body],
    [200, "all", [[1, "阿華新名", "https://pic/b2", 950], [2, "阿明", "https://pic/a", 800]], ["amount", "avatarUrl", "name", "rank"], 0, false],
    "Z10 總斗內：阿華跨兩週 900＋50＝950、名稱頭像換成最新一筆的；阿明跨兩週 500＋300＝800，作廢的 100、70 不算，改名那筆作廢所以名稱還是「阿明」；每列只有 4 個欄位、沒有帳號 id");
  eq([rowsOf(week), week.body.range, rowsOf(dflt), (await get(board, "/?range=month")).status],
    [[[1, "阿華新名", "https://pic/b2", 50]], "week", [[1, "阿華新名", "https://pic/b2", 50]], 400],
    "Z10 本週榜（range=week 和不帶參數一樣）只有這週的阿華 50；range 亂填 400");
}

// ---- Z11 查特效不多串一次往返 ----
{
  clock.now = T("2026-11-10T12:00:00");
  const real = tokens.a;
  Object.defineProperty(tokens, "a", { get() { order.push("auth"); return real; }, configurable: true, enumerable: true });
  const seq = async (fn: () => Promise<unknown>) => { order.length = 0; await fn(); await new Promise((r) => setTimeout(r, 50)); return order.slice(0, 3).join(">"); }; // 提早回錯誤的請求不等查詢，稍等它回來再看順序
  setup(A, 1);
  const r1 = await seq(() => post(draw, { roomId: "R", playerId: "p1" }, "a"));
  const r2 = await seq(() => post(discard, { roomId: "R", playerId: "p1", tileId: st().players[1].hand.at(-1)!.id }, "a"));
  setup(A, 1);
  const r3 = await seq(() => post(action, { roomId: "R", playerId: "p1", actionType: "pass" }, "a"));
  const r4 = await seq(() => post(nextGame, { roomId: "R", playerId: "p1" }, "a"));
  Object.defineProperty(tokens, "a", { value: real, writable: true, configurable: true, enumerable: true });
  eq([r1, r2, r3, r4], Array(4).fill("fx>auth>fx-done"),
    "Z11 摸牌、打牌、動作、下一局：先發出查自摸特效 → 查詢還沒回來就做登入檢查 → 之後才查完（兩件事同時進行，不是先等查完再檢查）");
}

// ---- Z12 烈焰已移除 ----
{
  clock.now = T("2026-11-10T13:00:00");
  const g1 = await post(fxGrant, { userId: A, fx: ["flame"], active: "flame" }, "boss");
  const g2 = await post(fxGrant, { userId: A, fx: ["storm", "flame"], active: "storm" }, "boss");
  const rv = await post(fxRevoke, { userId: A, fx: ["flame"] }, "boss");
  const s1 = await post(myFxSet, { fx: "flame" }, "a");
  const s2 = await post(myFxSet, { fx: "flame" }, "boss");
  const d = await db();
  const sqlTries: string[] = [];
  for (const sql of [`insert into mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at) values ('x', 'flame', 'boss', now(), now() + interval '1 day')`,
    `insert into mj_fx_prefs (user_id, fx, updated_at) values ('x', 'flame', now())`]) {
    try { await d.exec(sql); sqlTries.push("沒擋"); } catch { sqlTries.push("擋下"); }
  }
  const mine = (await get(myFxGet, "/", "boss")).body.available;
  eq([[g1.status, g1.body.error], [g2.status, g2.body.error], [rv.status, rv.body.error], [s1.status, s1.body.error], [s2.status, s2.body.error], sqlTries, "flame" in mine, Object.keys(mine).length],
    [[400, "bad_request"], [400, "bad_request"], [400, "bad_request"], [400, "bad_request"], [400, "bad_request"], ["擋下", "擋下"], false, 7],
    "Z12 烈焰已移除：後台開通（單選、混在別種裡）、收回、玩家和老闆選用都 400；資料庫直接寫開通和選用都被檢查限制擋下；老闆帳號清單沒有烈焰，另含全帳號金色自摸預設共 7 種");
}

// ---- Z13 金色自摸永久回退 ----
{
  clock.now = T("2026-11-10T14:00:00");
  const d = await db();
  await d.query("delete from mj_fx_prefs where user_id = $1", [B]); // 模擬尚未選過任何特效的新帳號
  const unset = await get(myFxGet, "/", "b");
  const fallback = await zimo(B);
  const denied = await post(myFxSet, { fx: "meteor" }, "b");
  const golden = await post(myFxSet, { fx: "golden" }, "b");
  const selected = await get(myFxGet, "/", "b");
  let invalidPref = "沒擋";
  try { await d.exec("insert into mj_fx_prefs (user_id, fx, updated_at) values ('invalid-fx', 'rainbow', now())"); } catch { invalidPref = "擋下"; }
  eq([unset.body.available, unset.body.selected, fallback.fx, denied.body.error, golden.status, golden.body.selected, selected.body.selected, invalidPref],
    [{ golden: null }, "golden", "golden", "not_granted", 200, "golden", "golden", "擋下"],
    "Z13 金色自摸：未設定帳號自摸和 API 都回金色；未開通的隕石不能套用；金色可永久套用；資料庫拒絕未知代號");
}

// ---- Z14 沒權限的特效不會變成「看起來有套用」 ----
{
  clock.now = T("2026-11-20T12:00:00");
  await post(fxGrant, { userId: B, fx: ["frost"], active: "frost" }, "boss");
  const d = await db();
  const selects = async () => Number((await d.query<{ n: number }>("select count(*)::int n from mj_fx_audit where action = 'fx_select' and target_user_id = $1", [B])).rows[0].n);
  const before = await selects();
  const deny = await post(myFxSet, { fx: "blackhole" }, "b");
  const mine = (await get(myFxGet, "/", "b")).body;
  const admin = (await get(fxGet, `/?userId=${B}`, "boss")).body;
  const z1 = await zimo(B);
  const after = await selects();
  clock.now = T("2026-11-30T00:00:00");
  const mine2 = (await get(myFxGet, "/", "b")).body;
  const admin2 = (await get(fxGet, `/?userId=${B}`, "boss")).body;
  const deny2 = await post(myFxSet, { fx: "frost" }, "b");
  const z2 = await zimo(B);
  eq([[deny.status, deny.body.error, deny.body.selected], [mine.selected, Object.keys(mine.available).sort()], admin.selected, z1.fx, after - before,
    [mine2.selected, mine2.available], [admin2.selected, admin2.active], [deny2.status, deny2.body.selected], [z2.fx, z2.overFx]],
    [[403, "not_granted", "frost"], ["frost", ["frost", "golden"]], "frost", "frost", 0,
      ["golden", { golden: null }], ["golden", {}], [403, "golden"], ["golden", "golden"]],
    "Z14 阿華只開通冰封：選沒開通的黑洞 403、回應附目前實際套用的冰封、選用沒被改、沒寫選用紀錄，自摸照樣冰封；冰封 11/30 到期後設定頁、後台都顯示金色、再選冰封 403 回金色，自摸金色");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
