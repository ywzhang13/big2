// 如來神掌（rulai，老闆專屬，老闆 2026-11-05；20261107_mahjong_fx_rulai.sql），走真的 API 和 migration（PGlite）
//   R1 GET：只有老闆的回應帶 ownerFx、available 有 rulai；一般玩家（含永久開通）都沒有，遊客 403、沒登入 401
//   R2 POST：非老闆選 rulai 403 not_granted（永久開通也一樣），原本的選用不變、沒有操作紀錄；老闆可以選，寫操作紀錄
//   R3 不能開通：開通全部不含 rulai；後台指定 rulai 400；資料庫直接寫開通被擋
//   R4 非老闆的列就算被直接寫成 rulai：GET 回金色、牌局也是金色
//   R5 老闆自摸：胡牌紀錄、廣播、同桌 state、座位公開資料、觀戰者畫面都帶 rulai；老闆胡別人打的牌沒有；沒有帳號 id
//   M1 回滾：選了 rulai 的改回金色並留紀錄，其他人的選用和開通不變，檢查限制收回；再套一次 migration 老闆又能選
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GET as fxGet, POST as fxPost } from "../../app/api/mahjong/admin/fx/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as respond } from "../../app/api/mahjong/spectate/respond/route";
import { POST as requestRoute } from "../../app/api/mahjong/spectate/request/route";
import { GET as view } from "../../app/api/mahjong/spectate/view/route";
import { GET as getState } from "../../app/api/mahjong/state/route";
import { GET as myGet, POST as mySet } from "../../app/api/mahjong/zimo-fx/route";
import { applyZimoFx, prefetchZimoFx } from "../../lib/mahjong/zimoFx/attach";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import { rooms } from "../support/stub-db";
import { addUser } from "../support/stub-donate-store";
import { clock, db, users } from "../support/stub-zimofx-store";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const id = (n: number) => `ad000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const [A, B, C] = [1, 2, 3].map(id);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
tokens.a = { id: A, displayName: "阿明", pictureUrl: null, isGuest: false };
tokens.b = { id: B, displayName: "阿華", pictureUrl: null, isGuest: false };
tokens.c = { id: C, displayName: "阿美", pictureUrl: null, isGuest: false };
tokens.guest = { id: "uid-guest", displayName: null, pictureUrl: null, isGuest: true };
tokens.spec = { id: "uid-spec", displayName: "觀戰者", pictureUrl: null, isGuest: false };
for (const [u, n] of [[BOSS, "張育瑋"], [A, "阿明"], [B, "阿華"], [C, "阿美"]]) { users[u] = { name: n, avatarUrl: null }; await addUser(u); }
const d = await db();
clock.now = Date.parse("2026-11-05T12:00:00+08:00");
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const get = async (fn: (r: Request) => Promise<Response>, url: string, tok?: string) => { const r = await fn(new Request("http://x" + url, { headers: auth(tok) })); return { status: r.status, body: await r.json() }; };
const post = async (fn: (r: Request) => Promise<Response>, body: object, tok?: string) => { const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const pref = async (u: string) => (await d.query<{ fx: string }>("select fx from mj_fx_prefs where user_id = $1", [u])).rows[0]?.fx ?? null;
const auditN = async (u: string) => Number((await d.query<{ n: number }>("select count(*)::int n from mj_fx_audit where target_user_id = $1 and action = 'fx_select'", [u])).rows[0].n);
const SIX = { meteor: null, thunder: null, storm: null, frost: null, blackhole: null, sakura: null };

// ---- 先開通 A（永久），選風暴；B 什麼都沒開 ----
await post(fxPost, { userId: A }, "boss");
await post(mySet, { fx: "storm" }, "a");

// ---- R1 GET ----
{
  const [boss, a, b, g, none] = [await get(myGet, "/", "boss"), await get(myGet, "/", "a"), await get(myGet, "/", "b"), await get(myGet, "/", "guest"), await get(myGet, "/")];
  eq([boss.body.ownerFx, boss.body.available.rulai, "ownerFx" in a.body, "ownerFx" in b.body, a.body.available, b.body.available, g.status, none.status],
    [["rulai", "nuke"], null, false, false, { golden: null, ...SIX }, { golden: null }, 403, 401],
    "R1 老闆的回應帶 ownerFx=[rulai, nuke]（核彈 2026-11-10 加入，同樣老闆專屬）、available 有 rulai（永久）；永久開通的玩家和沒開通的玩家都沒有 ownerFx、available 沒有 rulai；遊客 403、沒登入 401");
}

// ---- R2 POST ----
{
  const [auditA, auditB] = [await auditN(A), await auditN(B)];
  const [a, b] = [await post(mySet, { fx: "rulai" }, "a"), await post(mySet, { fx: "rulai" }, "b")];
  eq([a.status, a.body.error, a.body.selected, await pref(A), await auditN(A) - auditA, b.status, b.body.error, b.body.selected, await pref(B), await auditN(B) - auditB],
    [403, "not_granted", "storm", "storm", 0, 403, "not_granted", "golden", null, 0],
    "R2 非老闆選 rulai 403 not_granted：永久開通的玩家也一樣，回目前實際的選用，資料庫沒變、沒有操作紀錄");
  const auditBoss = await auditN(BOSS);
  const set = await post(mySet, { fx: "rulai" }, "boss");
  const [mine, admin] = [await get(myGet, "/", "boss"), await get(fxGet, `/?userId=${BOSS}`, "boss")];
  eq([set.status, set.body, await pref(BOSS), await auditN(BOSS) - auditBoss, mine.body.selected, admin.body.selected, admin.body.permanent],
    [200, { selected: "rulai" }, "rulai", 1, "rulai", "rulai", true],
    "R2 老闆選 rulai 成功、寫 1 筆操作紀錄；玩家 API 和後台都讀到 rulai（不會被打回金色）");
}

// ---- R3 不能開通 ----
{
  const fxOf = async (u: string) => (await d.query<{ fx: string }>("select distinct fx from mj_fx_grants where user_id = $1 order by fx", [u])).rows.map((r) => r.fx);
  const g = await post(fxPost, { userId: C }, "boss");
  const [act, list] = [await post(fxPost, { userId: C, active: "rulai" }, "boss"), await post(fxPost, { userId: C, fx: ["rulai"], active: "rulai" }, "boss")];
  let direct = "沒擋";
  try { await d.exec(`insert into mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at) values ('${C}', 'rulai', 'x', now(), 'infinity')`); } catch { direct = "擋下"; }
  eq([g.body.granted, await fxOf(C), act.status, list.status, direct, (await get(fxGet, `/?userId=${C}`, "boss")).body.active],
    [6, ["blackhole", "frost", "meteor", "sakura", "storm", "thunder"], 400, 400, "擋下", SIX],
    "R3 開通全部只有 6 種、不含 rulai；後台指定 rulai 400；資料庫直接寫開通被檢查限制擋下");
}

// ---- R4 非老闆的列被直接寫成 rulai ----
{
  await d.query("insert into mj_fx_prefs (user_id, fx, updated_at) values ($1, 'rulai', now())", [C]);
  const st = { players: [{ userId: C }, { userId: BOSS }] } as unknown as MahjongGameState;
  applyZimoFx(st, await prefetchZimoFx(st));
  eq([(await get(myGet, "/", "c")).body.selected, st.players[0].zimoFx, st.players[1].zimoFx],
    ["golden", { code: "golden", until: null }, { code: "rulai", until: null }],
    "R4 非老闆的列就算是 rulai：玩家 API 回金色、牌局用金色（已開通也一樣）；老闆是 rulai、永久");
  await d.query("delete from mj_fx_prefs where user_id = $1", [C]);
}

// ---- R5 牌局和觀戰 ----
let nextId = 90000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const WAIT25 = "m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1"; // 聽二五萬
const JUNK = "m1 m1 m9 m9 p1 p9 s1 s9 z2 z3 z4 z6 z7 s5 s7 p5";
const tok = (seat: number) => (seat === 1 ? "boss" : `as:p${seat}`);
const st = () => rooms.R.game_state as MahjongGameState;
const call = (fn: (r: Request) => Promise<Response>, seat: number, body: object) => post(fn, { roomId: "R", playerId: "p" + seat, ...body }, tok(seat));
function setup(turn: number) {
  const s = {
    roomCode: "1234", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(seat === 1 ? WAIT25 : JUNK), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0, isGuest: false, userId: seat === 1 ? BOSS : `u:p${seat}` })),
    wall: tiles(Array(40).fill("p9").join(" ")), currentTurn: turn, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as unknown as MahjongGameState;
  rooms.R = { id: "R", code: "1234", game_state: s, status: "playing" };
}
function drawn(seat: number, key: string) {
  const s = st();
  const tile = t(key);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
}
{
  setup(1);
  // 開局就要看得到代號（前端先預載）：同桌和觀戰者
  const stateOf = async (seat: number) => (await get(getState, `/?roomId=R&playerId=p${seat}`, tok(seat))).body;
  sent.length = 0;
  await post(requestRoute, { roomId: "R", targetPlayerId: "p0" }, "spec");
  const requestId = sent.find((e) => e.event === "mj_spectate_request")?.payload.requestId as string;
  await post(respond, { roomId: "R", playerId: "p0", requestId, approve: true }, "as:p0");
  const viewNow = () => get(view, "/?roomId=R&target=p0", "spec");
  // 同桌的座位資料要先查過一次特效：打牌請求會查，這裡直接套用
  applyZimoFx(st(), await prefetchZimoFx(st()));
  const seatFx = (b: { gameState?: { players: { seat: number; winFx?: string }[] }; players?: { seat: number; winFx?: string }[] }) => (b.gameState?.players ?? b.players ?? []).find((p) => p.seat === 1)?.winFx;
  const [before, specBefore] = [await stateOf(2), await viewNow()];
  eq([seatFx(before), specBefore.status, seatFx(specBefore.body)], ["rulai", 200, "rulai"], "R5 開局：同桌和觀戰者都看得到老闆座位的 rulai（可以先預載素材）");

  drawn(1, "m5");
  const r = await call(action, 1, { actionType: "win" });
  const over = sent.find((e) => e.event === "mj_game_over")?.payload as { winners?: { winFx?: string }[] } | undefined;
  const [other, spec] = [await stateOf(2), await viewNow()];
  const text = JSON.stringify([sent, other, spec.body]);
  eq([r.status, st().winners?.map((w) => [w.seat, w.from, w.winFx]), over?.winners?.map((w) => w.winFx), other.gameState?.winners?.map((w: { winFx?: string }) => w.winFx), spec.body.gameState?.winners?.map((w: { winFx?: string }) => w.winFx), text.includes(BOSS)],
    [200, [[1, null, "rulai"]], ["rulai"], ["rulai"], ["rulai"], false],
    "R5 老闆自摸：胡牌紀錄、mj_game_over 廣播、同桌 state、觀戰者畫面都是 rulai；都沒有帳號 id");

  setup(0);
  drawn(0, "m5");
  await call(discard, 0, { tileId: st().players[0].hand.at(-1)!.id });
  const ron = await call(action, 1, { actionType: "win" });
  eq([ron.status, st().winners?.map((w) => [w.seat, w.from, w.winFx ?? null])], [200, [[1, 0, null]]], "R5 老闆胡別人打的牌：沒有特效代號");
}

// ---- M1 回滾 ----
{
  const others = async () => JSON.stringify([
    (await d.query("select user_id, fx from mj_fx_prefs where user_id <> $1 order by user_id", [BOSS])).rows,
    (await d.query("select id, user_id, fx, expires_at, revoked_at from mj_fx_grants order by id")).rows]);
  const before = await others();
  const auditBoss = await auditN(BOSS);
  await d.exec(readFileSync(path.join(MIG, "20261107_mahjong_fx_rulai_rollback.sql"), "utf8"));
  const row = (await d.query<{ actor_id: string; detail: { fx: string; from: string; rollback: boolean } }>("select actor_id, detail from mj_fx_audit where target_user_id = $1 and action = 'fx_select' order by id desc limit 1", [BOSS])).rows[0];
  let direct = "沒擋";
  try { await d.exec(`insert into mj_fx_prefs (user_id, fx, updated_at) values ('${B}', 'rulai', now())`); } catch { direct = "擋下"; }
  const old = (await d.query<{ user_id: string; fx: string }>("select user_id, fx from mj_fx_prefs where user_id = $1", [BOSS])).rows[0];
  eq([old.fx, await auditN(BOSS) - auditBoss, row.actor_id, row.detail, direct, await others() === before],
    ["golden", 1, "system", { fx: "golden", from: "rulai", rollback: true }, "擋下", true],
    "M1 回滾：選了 rulai 的改回金色、留 1 筆 system 操作紀錄（標 rollback）；檢查限制收回（直接寫 rulai 被擋）；其他人的選用和開通完全不變");
  await d.exec(readFileSync(path.join(MIG, "20261107_mahjong_fx_rulai.sql"), "utf8"));
  const again = await post(mySet, { fx: "rulai" }, "boss");
  eq([again.status, await pref(BOSS), await pref(A)], [200, "rulai", "storm"], "M1 再套一次 migration：老闆又能選 rulai；其他人的選用不變");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
