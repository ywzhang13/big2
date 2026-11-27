// 大老二完整一局＋舊分頁跨上線（老柯 2026-11-27，手牌不外流的補證：小測驗收①③④、審伯 R2、continue 冒名）。
// 記憶體 PostgreSQL（PGlite）跑正式站現況的 schema，大老二的路由和 lib/big2/*Store.ts 都是真程式碼（真的 supabase-js），
// 透過 tests/support/thirteen-postgrest.ts 打進資料庫；只有廣播（stub-broadcast 的 sent＝公開頻道上的全部事件）、對局紀錄、after() 用替身。
//   F1～F6 完整一局：開房 → 四家入座 → 開局確認 → 發牌 → 出牌、過（照規則一張一張打）→ 有人出完、結束 → 四家按繼續 → 下一局
//     全程每一個動作之後檢查公開頻道（＝知道房號、沒入座的訂閱者收得到的全部事件）：不帶任何一家還握在手上的牌；
//     只有結束時 game_over 亮出全部手牌（原本的規則，保留）
//   F7 第二局四家合起來 52 張不重複，和存檔一致；F8 模擬重新整理：帶原本的入座憑證重新加入、讀狀態，拿得到自己的牌
//   K  繼續（下一局）只有座位本人能按：沒帶憑證、拿別人的憑證、亂猜 → 403 not_your_seat，名單不變
//   O  上線前就開著的舊分頁（306ea2f 的請求格式：開局請求沒有 proto、讀狀態不帶憑證）在上線後：
//     舊房主按開始、舊的「開始遊戲」入口、舊玩家按同意都回 426 client_outdated，牌局開不起來、沒有發牌（不會進到缺牌的牌局）；
//     開局確認取消後回到等人，舊分頁在自動換新版的安全時機（lib/autoUpdate.ts big2RoomSafe）會被重新整理成新版
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

if (process.env.TEST_BIG2_REAL_DB !== "1") { // npm test 每個檔案用一般設定跑；這支要大老二 store 走真程式碼，自己重開一個行程
  const register = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../support/register.mjs")).href;
  const r = spawnSync(process.execPath, ["--import", register, fileURLToPath(import.meta.url)], { encoding: "utf8", env: { ...process.env, TEST_BIG2_REAL_DB: "1" } });
  process.stdout.write((r.stdout ?? "") + (r.stderr ?? ""));
  process.exit(r.status ?? 1);
}

const { PGlite } = await import("@electric-sql/pglite");
const { readFileSync } = await import("node:fs");
const { installPostgrest } = await import("../support/thirteen-postgrest");
const { SUPABASE_SETUP } = await import("../support/pg-mj");
const { sent } = await import("../support/stub-broadcast");
const { compareCards } = await import("../../lib/card");
const { detectCombo } = await import("../../lib/combo");
const { beats } = await import("../../lib/compare");
const { big2RoomSafe } = await import("../../lib/autoUpdate");
type Card = import("../../lib/constants").Card;

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}

const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase");
const db = new PGlite();
await db.exec(SUPABASE_SETUP);
for (const f of ["schema.sql", "mahjong-schema.sql", "migrations/20261016_match_records.sql", "migrations/20261017_mahjong_login.sql",
  "migrations/20261019_mahjong_rls_enforce.sql", "migrations/20261120_big2_start_confirm.sql"]) await db.exec(readFileSync(path.join(SUPA, f), "utf8"));
const BASE = "http://big2-full.test", ANON = "test-anon-key";
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
installPostgrest(db, BASE, { anonKey: ANON }); // 大老二路由用哪把金鑰，就用哪個身分跑（和正式站一樣）

const { POST: create } = await import("../../app/api/game/create/route");
const { POST: join } = await import("../../app/api/game/join/route");
const { GET: state } = await import("../../app/api/game/state/route");
const { POST: readyCheck } = await import("../../app/api/game/ready-check/route");
const { POST: ready } = await import("../../app/api/game/ready/route");
const { POST: readyCancel } = await import("../../app/api/game/ready-cancel/route");
const { POST: deal } = await import("../../app/api/game/deal/route");
const { POST: play } = await import("../../app/api/game/play/route");
const { POST: pass } = await import("../../app/api/game/pass/route");
const { POST: cont } = await import("../../app/api/game/continue/route");

type Res = { status: number; body: Record<string, unknown> };
const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown): Promise<Res> =>
  fn(new Request(`http://x${url}`, { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, body: await r.json() }));
const getState = async (roomId: string, playerId: string, seatKey?: string): Promise<Res> => {
  const url = `http://x/api/game/state?roomId=${roomId}&playerId=${playerId}`;
  const req = new Request(url, { headers: seatKey ? { "x-big2-seat-key": seatKey } : {} });
  const r = await state(Object.assign(req, { nextUrl: new URL(url) }) as unknown as Parameters<typeof state>[0]);
  return { status: r.status, body: await r.json() };
};
const room = async (id: string) => (await db.query<{ status: string; current_turn: number; last_play: { cards: Card[] } | null; start_confirm: { id: string } | null; ready_players: string[] }>(
  `select status, current_turn, last_play, start_confirm, ready_players from big2_rooms where id = $1`, [id])).rows[0];
const dbHands = async (id: string) => Object.fromEntries((await db.query<{ player_id: string; hand: Card[] }>(
  `select player_id, hand from big2_players where room_id = $1 order by seat`, [id])).rows.map((r) => [r.player_id, r.hand]));
const sortC = (h: Card[]) => [...h].sort(compareCards);

/** 公開頻道上新出現的事件裡，有沒有某一家「現在還握在手上」的牌（任何欄位、任何深度；打出去的牌已經不在手上，不算） */
function leaks(events: { event: string; payload: Record<string, unknown> }[], hands: Record<string, Card[]>): string[] {
  const inHand = new Set(Object.values(hands).flat());
  const out: string[] = [];
  const walk = (v: unknown, p: string, ev: string) => {
    if (typeof v === "string" && inHand.has(v as Card)) out.push(`${ev}:${p}=${v}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, ev));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`, ev);
  };
  for (const e of events) { if (e.event === "deal_hand") out.push("deal_hand"); walk(e.payload, "", e.event); }
  return out;
}

/** 開房 → 四家入座（新版前端，拿入座憑證） */
async function seatedRoom(tag: string) {
  const ps = ["a", "b", "c", "d"].map((x) => `${x}-${tag}`);
  const { code, roomId } = (await post(create, "/api/game/create", { hostId: ps[0] })).body as { code: string; roomId: string };
  const keys: Record<string, string> = {};
  for (const p of ps) keys[p] = (await post(join, "/api/game/join", { code, playerId: p, name: "N" + p })).body.seatKey as string;
  return { roomId, code, ps, keys };
}

// ═══ F 完整一局 ═══
{
  const r = await seatedRoom("full");
  sent.length = 0; // 從開局確認開始收：外人訂閱 big2-<房號> 收得到的全部
  const allLeaks: string[] = [];
  let seen = 0;
  /** 每一個動作之後：檢查新出現的公開事件（game_over 例外：結束亮牌是原本的規則） */
  const audit = async (allowGameOver = false) => {
    const fresh = sent.slice(seen); seen = sent.length;
    const hands = await dbHands(r.roomId);
    allLeaks.push(...leaks(fresh.filter((e) => !(allowGameOver && e.event === "game_over")), hands));
  };
  const rc = await post(readyCheck, "/api/game/ready-check", { roomId: r.roomId, playerId: r.ps[0], seatKey: r.keys[r.ps[0]], proto: 2 });
  await audit();
  const cid = (await room(r.roomId)).start_confirm?.id;
  const rd: number[] = [];
  for (const p of r.ps.slice(1)) { rd.push((await post(ready, "/api/game/ready", { roomId: r.roomId, playerId: p, confirmId: cid, proto: 2 })).status); await audit(); }
  const h1 = await dbHands(r.roomId);
  eq([rc.status, rd, (await room(r.roomId)).status, Object.values(h1).map((h) => h.length)], [200, [200, 200, 200], "playing", [13, 13, 13, 13]],
    "F1 開房、四家入座、房主按開始、三家同意 → 發牌開局，每家 13 張");
  const mine = await Promise.all(r.ps.map(async (p) => sortC((await getState(r.roomId, p, r.keys[p])).body.myHand as Card[])));
  eq(mine, r.ps.map((p) => sortC(h1[p])), "F2 第一局：四家帶自己的入座憑證讀狀態，各拿到自己的牌（和存檔一致）");

  // 照規則打：自由出牌出最小的單張（第一手一定是 3♣），跟牌出最小能壓過的單張，壓不過就過
  const bad: string[] = [];
  let plays = 0, passes = 0, over = false;
  for (let step = 0; step < 400 && !over; step++) {
    const rm = await room(r.roomId);
    const p = r.ps[rm.current_turn];
    const hand = sortC((await getState(r.roomId, p, r.keys[p])).body.myHand as Card[]);
    const last = rm.last_play ? detectCombo(rm.last_play.cards) : null;
    const card = last ? hand.find((c) => { const cb = detectCombo([c]); return cb && beats(last, cb); }) : hand[0];
    if (card) {
      const res = await post(play, "/api/game/play", { roomId: r.roomId, playerId: p, seatKey: r.keys[p], cards: [card] });
      if (res.status !== 200) bad.push(`play ${p} ${card} → ${res.status} ${JSON.stringify(res.body)}`);
      plays++; over = res.body.gameOver === true;
      await audit(over);
    } else {
      const res = await post(pass, "/api/game/pass", { roomId: r.roomId, playerId: p, seatKey: r.keys[p] });
      if (res.status !== 200) bad.push(`pass ${p} → ${res.status} ${JSON.stringify(res.body)}`);
      passes++;
      await audit();
    }
  }
  eq([bad, over, (await room(r.roomId)).status, plays > 13, passes > 0], [[], true, "finished", true, true], "F3 一張一張打到有人出完：出牌、過全部 200，這局結束（finished）");
  const go = sent.filter((e) => e.event === "game_over");
  const left = await dbHands(r.roomId);
  eq([go.length, Object.fromEntries(Object.entries((go[0]?.payload.hands ?? {}) as Record<string, Card[]>).map(([k, v]) => [k, sortC(v)]))],
    [1, Object.fromEntries(Object.entries(left).map(([k, v]) => [k, sortC(v)]))], "F4 結束時 game_over 亮出各家剩下的牌（原本的規則，保留）");

  // K 冒名按繼續
  const other = r.ps[1];
  const imp = [
    await post(cont, "/api/game/continue", { roomId: r.roomId, playerId: other }),
    await post(cont, "/api/game/continue", { roomId: r.roomId, playerId: other, seatKey: r.keys[r.ps[0]] }),
    await post(cont, "/api/game/continue", { roomId: r.roomId, playerId: other, seatKey: "猜的" }),
  ];
  eq([imp.map((x) => x.status), imp.map((x) => x.body.error), (await room(r.roomId)).ready_players], [[403, 403, 403], ["not_your_seat", "not_your_seat", "not_your_seat"], []],
    "K1 繼續（下一局）：沒帶憑證、拿別人的憑證、亂猜都 403 not_your_seat，準備名單沒變");
  await audit(true);

  // 下一局
  const cs: number[] = [];
  for (const p of r.ps) { cs.push((await post(cont, "/api/game/continue", { roomId: r.roomId, playerId: p, seatKey: r.keys[p] })).status); await audit(); }
  const h2 = await dbHands(r.roomId);
  const all2 = Object.values(h2).flat();
  eq([cs, (await room(r.roomId)).status], [[200, 200, 200, 200], "playing"], "F5 四家帶自己的憑證按繼續 → 下一局開局");
  eq([Object.values(h2).map((h) => h.length), all2.length, new Set(all2).size], [[13, 13, 13, 13], 52, 52], "F7 第二局：每家 13 張，四家合起來 52 張不重複");
  const mine2 = await Promise.all(r.ps.map(async (p) => sortC((await getState(r.roomId, p, r.keys[p])).body.myHand as Card[])));
  eq(mine2, r.ps.map((p) => sortC(h2[p])), "F7 第二局：四家讀狀態各拿到自己的新牌，和存檔一致");

  // 第二局出一手、過一手
  const rm2 = await room(r.roomId);
  const s2 = r.ps[rm2.current_turn];
  const first = sortC(h2[s2])[0];
  const pr = await post(play, "/api/game/play", { roomId: r.roomId, playerId: s2, seatKey: r.keys[s2], cards: [first] }); await audit();
  const n2 = r.ps[(await room(r.roomId)).current_turn];
  const pa = await post(pass, "/api/game/pass", { roomId: r.roomId, playerId: n2, seatKey: r.keys[n2] }); await audit();
  eq([pr.status, pa.status], [200, 200], "F5 第二局出牌、過照常");

  // F8 模擬重新整理：新分頁（同一台、localStorage 還有原本的憑證）重新加入 → 讀狀態
  const rj = await Promise.all(r.ps.map((p) => post(join, "/api/game/join", { code: r.code, playerId: p, name: "N" + p })));
  const h2now = await dbHands(r.roomId);
  const after = await Promise.all(r.ps.map(async (p) => sortC((await getState(r.roomId, p, r.keys[p])).body.myHand as Card[])));
  const noKey = await Promise.all(r.ps.map(async (p) => ((await getState(r.roomId, p)).body.myHand as Card[]).length));
  eq([rj.map((x) => [x.status, x.body.rejoined, "seatKey" in x.body]), after, noKey],
    [r.ps.map(() => [200, true, false]), r.ps.map((p) => sortC(h2now[p])), [0, 0, 0, 0]],
    "F8 重新整理：重新加入回原座位（不重發憑證），帶原本的憑證讀狀態拿得到自己的牌；不帶憑證拿不到");
  eq(allLeaks, [], "F6 從開局確認、發牌、出牌、過、結束到下一局，公開頻道上沒有任何一家還握在手上的牌（結束時 game_over 亮牌除外）");
}

// ═══ O 舊分頁跨上線（306ea2f 的請求格式）═══
{
  // O1 四家都是舊分頁：房主按開始（ready-check 有憑證、沒有 proto）、舊的「開始遊戲」入口
  const r = await seatedRoom("old1");
  const a = await post(readyCheck, "/api/game/ready-check", { roomId: r.roomId, playerId: r.ps[0], seatKey: r.keys[r.ps[0]] });
  const d = await post(deal, "/api/game/deal", { roomId: r.roomId, playerId: r.ps[0], seatKey: r.keys[r.ps[0]] });
  eq([a.status, a.body.error, d.status, d.body.error, (await room(r.roomId)).status, Object.values(await dbHands(r.roomId)).map((h) => h.length)],
    [426, "client_outdated", 426, "client_outdated", "waiting", [0, 0, 0, 0]], "O1 舊房主按開始、按舊的「開始遊戲」：426 client_outdated，牌局沒開、沒有發牌");
}
{
  // O2 新房主＋一個舊分頁：舊分頁按同意（沒有 proto）被擋 → 永遠湊不滿四家，不會發牌；取消後回到等人
  const r = await seatedRoom("old2");
  await post(readyCheck, "/api/game/ready-check", { roomId: r.roomId, playerId: r.ps[0], seatKey: r.keys[r.ps[0]], proto: 2 });
  const cid = (await room(r.roomId)).start_confirm?.id;
  const newer = [];
  for (const p of r.ps.slice(1, 3)) newer.push((await post(ready, "/api/game/ready", { roomId: r.roomId, playerId: p, confirmId: cid, proto: 2 })).status);
  const old = await post(ready, "/api/game/ready", { roomId: r.roomId, playerId: r.ps[3], confirmId: cid });
  eq([newer, old.status, old.body.error, (await room(r.roomId)).status, Object.values(await dbHands(r.roomId)).map((h) => h.length)],
    [[200, 200], 426, "client_outdated", "ready_check", [0, 0, 0, 0]], "O2 新版三家同意、舊分頁按同意 426：湊不滿四家、沒有發牌（舊分頁不會進到沒有牌的牌局）");
  const c = await post(readyCancel, "/api/game/ready-cancel", { roomId: r.roomId, playerId: r.ps[1], confirmId: cid, seatKey: r.keys[r.ps[1]] });
  const st = (await getState(r.roomId, r.ps[3])).body;
  eq([c.status, st.status, big2RoomSafe({ nameReady: true, inRoom: true, status: String(st.status), confirming: st.startConfirm != null, closed: false })], [200, "waiting", true],
    "O3 有人取消對戰 → 回到等人；舊分頁這時是自動換新版的安全時機，下一次查版本就重新整理成新版");
}
{
  // O4 舊房主＋新版三家：舊房主按開始被擋，新版三家沒有確認可以按，牌局開不起來
  const r = await seatedRoom("old3");
  const a = await post(readyCheck, "/api/game/ready-check", { roomId: r.roomId, playerId: r.ps[0], seatKey: r.keys[r.ps[0]] });
  const n = await post(ready, "/api/game/ready", { roomId: r.roomId, playerId: r.ps[1], confirmId: "x", proto: 2 });
  eq([a.status, (await room(r.roomId)).status, n.status, Object.values(await dbHands(r.roomId)).map((h) => h.length)], [426, "waiting", 409, [0, 0, 0, 0]],
    "O4 舊房主按開始 426；新版的人沒有開局確認可以同意（409），牌局開不起來、沒有發牌");
}

console.log(results.join("\n"));
process.exit(results.some((x) => x.startsWith("❌")) ? 1 : 0);
