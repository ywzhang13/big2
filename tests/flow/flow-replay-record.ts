// 牌局回放的記錄（lib/mahjong/replay；老闆 2026-11-13）：透過真的 route handler（摸牌、打牌、吃碰槓胡、下一局）打完多局，
// 每次存檔都把四家的手牌、吃碰槓、花、海底記下來，和回放紀錄一步一步重播出來的結果逐步比對。
//   R1 每一局：重播出來的每一步，和實際存檔的每一步完全一致（四家手牌、吃碰槓、花、海底）
//   R2 涵蓋：吃、碰、明槓、暗槓、加槓、補花、眼牌、地聽、自摸、放槍胡、流局都至少出現過一次
//   R3 打牌當下不多任何請求：回放只在每局結算那一次寫資料庫，一局一次；其他存檔照舊只有原本那一次
//   R4 結果：贏家、放槍、台數、輸贏和牌局結算一致
//   R5 大小：一局紀錄的大小、牌局狀態多出來的大小（印出來，並確認在合理範圍）
//   R6 上線當下正在打到一半的局不記；寫回放失敗不影響牌局存檔
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as nextGame } from "../../app/api/mahjong/next-game/route";
import { rooms, hooks, opts, saveGameState } from "../support/stub-db";
import { asSeat } from "../support/stub-auth";
import { db, replayFail, saveCalls } from "../support/stub-replay-store";
import { paceClock } from "../../lib/mahjong/pace";
import { canDeclareTingNow, dealTiles, getAvailableActions, initGame, isChiForbidden, isLocked, ownTurnActions, eyeDiscardOptions } from "../../lib/mahjong/gameLogic";
import { decodeRecord, replayFrames, snapshot, type ReplayRecord, type SeatSnap } from "../../lib/mahjong/replay/log";
import { tileKey, type Tile } from "../../lib/mahjong/tiles";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
function ok(cond: boolean, msg: string, detail: unknown = "") {
  results.push(`${cond ? "✅" : "❌"} ${msg}${cond ? "" : `\n   ${JSON.stringify(detail)}`}`);
}

// 固定亂數：每次跑的牌局都一樣（洗牌、骰子、機器人的選擇）
let seed = 20261113;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = () => Math.random();
let now = Date.parse("2026-11-13T12:00:00Z");
paceClock.now = () => now;
paceClock.sleep = async (ms: number) => { now += ms; };
opts.delayMs = 0;
await db(); // 先建好記憶體資料庫（含回放 migration）

// 每次存檔記下四家樣子（R1 的「實際牌局」）
const saved: Record<string, { status: string; done: number; snap: SeatSnap[] }[]> = {};
hooks.onSaved = async (id, s) => { (saved[id] ??= []).push({ status: s.status, done: s.handsCompleted ?? 0, snap: snapshot(s) }); };

const req = (body: object) => new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...asSeat(body) }, body: JSON.stringify(body) });
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(req(body));
  return { status: r.status, body: await r.json() };
}

function newRoom(id: string): void {
  const s = initGame([0, 1, 2, 3].map((i) => ({ id: "p" + i, name: "玩家" + (i + 1) })), { totalRounds: 8, basePoints: 100, fanPoints: 20 });
  s.roomCode = id.slice(-4);
  const dealt = dealTiles(s);
  dealt.startedAt = new Date(now).toISOString();
  dealt.handsCompleted = 0;
  dealt.handStats = { wins: [0, 0, 0, 0], dealIns: [0, 0, 0, 0], selfDraws: [0, 0, 0, 0] };
  for (const p of dealt.players) p.userId = "u:" + p.id;
  rooms[id] = { id, code: s.roomCode, game_state: { ...dealt, stateVersion: 0 } as MahjongGameState, status: "playing" };
}

const errors: string[] = [];
/** 機器人選要打的牌：和手上其他牌最搭不上的那張（同一種、相鄰的越少越先打），讓牌局常常有人胡 */
function worst(all: Tile[], options: Tile[]): Tile {
  const score = (t: Tile) => all.reduce((n, o) => {
    if (o.id === t.id) return n;
    if (tileKey(o) === tileKey(t)) return n + 3;
    if (t.suit !== "z" && o.suit === t.suit) { const gap = Math.abs(o.rank - t.rank); return n + (gap === 1 ? 2 : gap === 2 ? 1 : 0); }
    return n;
  }, rnd() * 0.5);
  return options.reduce((a, b) => (score(b) < score(a) ? b : a));
}
/** 機器人打一步；回傳 false＝這局結束 */
async function step(id: string): Promise<boolean> {
  now += 700;
  const s = rooms[id].game_state;
  if (s.status !== "playing") return false;
  const room = { roomId: id };
  let r: { status: number; body: { error?: string } };
  if (s.pendingFlowerRob) {
    r = await call(action, { ...room, playerId: s.players[s.pendingFlowerRob.robberSeat].id, actionType: "win" });
  } else if (s.pendingActions && s.lastDiscard) {
    const waiting = s.pendingActions.potentialActors.filter((x) => !s.pendingActions!.passedActors.includes(x));
    const seat = waiting[0];
    const mine = getAvailableActions(s).filter((a) => a.playerSeat === seat);
    const pick = mine.find((a) => a.type === "win")
      ?? (rnd() < 0.85 ? mine.find((a) => a.type === "kong") : undefined)
      ?? (rnd() < 0.6 ? mine.find((a) => a.type === "pong") : undefined)
      ?? (rnd() < 0.5 ? mine.find((a) => a.type === "chi") : undefined);
    r = pick
      ? await call(action, { ...room, playerId: s.players[seat].id, actionType: pick.type, tiles: pick.tiles?.map((t) => t.id) })
      : await call(action, { ...room, playerId: s.players[seat].id, actionType: "pass" });
  } else {
    const seat = s.currentTurn;
    const pid = s.players[seat].id;
    if (!s.hasDrawn) {
      r = await call(draw, { ...room, playerId: pid });
    } else {
      const own = ownTurnActions(s, seat);
      const win = own.find((a) => a.type === "win");
      const kong = own.find((a) => a.type === "kong" || a.type === "add_kong");
      if (win) r = await call(action, { ...room, playerId: pid, actionType: "win" });
      else if (kong && rnd() < 0.9) r = await call(action, { ...room, playerId: pid, actionType: kong.type, tiles: kong.tiles!.map((t) => t.id) });
      else {
        const eye = eyeDiscardOptions(s, seat);
        const hand = s.players[seat].hand.filter((t) => t.suit !== "f" && !isChiForbidden(s, seat, t));
        if (eye.length > 0 && (canDeclareTingNow(s, seat) || rnd() < 0.35)) { // 能地聽就一定宣告（地聽很少見，要打到）
          r = await call(discard, { ...room, playerId: pid, tileId: eye[Math.floor(rnd() * eye.length)].id, declareEye: true });
        } else {
          const locked = isLocked(s, seat);
          const tile = locked && s.drawnTileId !== undefined ? s.drawnTileId : worst(s.players[seat].hand, hand).id;
          r = await call(discard, { ...room, playerId: pid, tileId: tile });
        }
      }
    }
  }
  if (r.status !== 200) errors.push(`${id} ${r.status} ${JSON.stringify(r.body)}`);
  return rooms[id].game_state.status === "playing";
}

/** 把連續重複的樣子合併（pass 之類不動牌的存檔不算一步）；欄位順序統一（資料庫 jsonb 會重排物件的鍵） */
function dedupe(xs: SeatSnap[][]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    const k = JSON.stringify(x.map((p) => ({ h: p.h, m: p.m, f: p.f, d: p.d })));
    if (out[out.length - 1] !== k) out.push(k);
  }
  return out;
}

/** 把指定牌面的牌換進某家手牌（和原本在別家手牌或牌牆的牌對調，總張數、每張 id 不變）；地聽要開局就聽牌，亂數很難遇到 */
function rig(s: MahjongGameState, seat: number, keys: string[]): void {
  const hand = s.players[seat].hand;
  const want: number[] = [];
  const used = new Map<string, number>();
  for (const k of keys) {
    const copy = used.get(k) ?? 0; used.set(k, copy + 1);
    const base = k[0] === "m" ? 0 : k[0] === "p" ? 36 : k[0] === "s" ? 72 : 108;
    want.push(base + (Number(k.slice(1)) - 1) * 4 + copy);
  }
  const spare = hand.filter((t) => !want.includes(t.id));
  for (const id of want) {
    if (hand.some((t) => t.id === id)) continue;
    const pools = [...s.players.filter((p) => p.seat !== seat).map((p) => p.hand), s.wall];
    const pool = pools.find((xs) => xs.some((t) => t.id === id))!;
    const i = pool.findIndex((t) => t.id === id);
    const give = spare.shift()!;
    const j = hand.findIndex((t) => t.id === give.id);
    [pool[i], hand[j]] = [give, pool[i]];
  }
}

// ---- 打 5 間房，每間連打到 12 局（或整場結束）；第 5 間第 1 局莊家起手就聽牌（測地聽） ----
const tags = new Set<string>();
const sizes: number[] = [];
const extraState: number[] = [];
let handsChecked = 0, mismatches = 0, resultMismatch = 0;
for (let roomN = 1; roomN <= 5; roomN++) {
  const id = `ab000000-0000-4000-8000-00000000000${roomN}`;
  newRoom(id);
  if (roomN === 5) {
    const gs = rooms[id].game_state;
    rig(gs, gs.dealerSeat, ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "p1", "p2", "p3", "s1", "s2", "s3", "z1", "z5"].slice(0, gs.players[gs.dealerSeat].hand.length));
  }
  saved[id] = [];
  await saveGameState(id, rooms[id].game_state); // 開局存檔（真的開局路由也會存一次）
  for (let hand = 1; hand <= 12; hand++) {
    let guard = 0;
    while (await step(id)) {
      if (++guard > 1500) { errors.push(`${id} 第 ${hand} 局走不完`); break; }
      const gs = rooms[id].game_state;
      if (gs.replayLog && !gs.replayLog.done) extraState.push(JSON.stringify(gs).length - JSON.stringify({ ...gs, replayLog: undefined }).length);
    }
    const gs = rooms[id].game_state;
    if (gs.status !== "finished") break;
    const done = gs.handsCompleted!;
    // 這局實際的每一步（從這局開始的那次存檔到結算那次）
    const actual = dedupe(saved[id].filter((x) => x.done === done - 1 && x.status === "playing").map((x) => x.snap)
      .concat(saved[id].filter((x) => x.done === done && x.status === "finished").slice(0, 1).map((x) => x.snap)));
    const row = (await (await db()).query<{ data: ReplayRecord; summary: { reason: string } }>("select data, summary from mj_hand_replays where room_id = $1 and hand_no = $2", [id, done])).rows[0];
    if (!row) { errors.push(`${id} 第 ${done} 局沒有回放`); break; }
    const rec = row.data;
    const replayed = dedupe(replayFrames(decodeRecord(rec)));
    handsChecked++;
    if (JSON.stringify(replayed) !== JSON.stringify(actual)) {
      mismatches++;
      if (mismatches === 1) {
        const i = replayed.findIndex((f, j) => JSON.stringify(f) !== JSON.stringify(actual[j]));
        errors.push(`${id} 第 ${done} 局重播不一致：實際 ${actual.length} 步、重播 ${replayed.length} 步；第 ${i} 步 重播=${replayed[i]} 實際=${actual[i]} 事件=${JSON.stringify(rec.events[i - 1])}`);
      }
    }
    // R4 結果
    const winners = (gs.winners?.length ? gs.winners : gs.winner ? [gs.winner] : []).map((w) => [w.seat, w.from ?? null, w.score.totalFan]);
    if (JSON.stringify([rec.result.reason, rec.result.deltas, rec.result.winners.map((w) => [w.seat, w.from, w.totalFan]), row.summary.reason])
      !== JSON.stringify([gs.settlement!.reason, gs.settlement!.deltas, winners, gs.settlement!.reason])) resultMismatch++;
    for (const e of decodeRecord(rec).events) for (const k of e.k) tags.add(k);
    sizes.push(JSON.stringify(rec).length);
    if (gs.gameOver) break;
    for (const p of gs.players) await call(nextGame, { roomId: id, playerId: p.id });
    if (rooms[id].game_state.status !== "playing") { errors.push(`${id} 下一局沒有開始`); break; }
  }
}

eq(errors, [], "機器人打牌過程中每個請求都是 200（沒有卡住）");
ok(handsChecked >= 30, `R1 打完 ${handsChecked} 局（5 間房），每一局都有回放紀錄`, handsChecked);
eq(mismatches, 0, `R1 ${handsChecked} 局逐步重播：四家每一步的手牌、吃碰槓、花、海底都和實際存檔完全一致`);
const need = ["draw", "discard", "flower", "chi", "pong", "kong", "concealed_kong", "add_kong", "eye", "ting", "zimo", "win", "draw_game"];
eq(need.filter((k) => !tags.has(k)), [], `R2 涵蓋：吃、碰、明槓、暗槓、加槓、補花、眼牌、地聽、自摸、放槍胡、流局都有打到（實際出現 ${[...tags].sort().join("、")}）`);
eq(resultMismatch, 0, "R4 每一局的結果（流局／放槍／自摸、贏家、放槍的人、台數、每家輸贏）和牌局結算一致");

// R3 打牌當下不多請求：回放寫入次數＝打完的局數，而且只發生在結算那次存檔；牌局存檔次數不因回放增加
eq(saveCalls.length, handsChecked, `R3 回放只在每局結算時寫一次資料庫：${handsChecked} 局共寫 ${saveCalls.length} 次`);
const finishedSaves = Object.values(saved).flat().filter((x) => x.status === "finished").length;
ok(finishedSaves > handsChecked, "R3 結算後的其他存檔（例如按下一局）不會重複寫回放", [finishedSaves, handsChecked]);

// R5 大小
const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
const max = (xs: number[]) => Math.max(...xs);
console.log(`回放大小：一局平均 ${avg(sizes)} bytes、最大 ${max(sizes)} bytes（${sizes.length} 局）；牌局狀態多出的進行中紀錄平均 ${avg(extraState)} bytes、最大 ${max(extraState)} bytes`);
ok(avg(sizes) < 8000 && max(sizes) < 16000, `R5 一局紀錄平均 ${avg(sizes)} bytes、最大 ${max(sizes)} bytes（JSON，資料庫會再壓縮）`);
ok(max(extraState) < 16000, `R5 打牌中牌局狀態多出的紀錄最大 ${max(extraState)} bytes`);

// R6 打到一半才開始記（上線當下）不記這局；寫失敗不影響存檔
{
  const id = "ab000000-0000-4000-8000-000000000009";
  newRoom(id);
  const s = rooms[id].game_state;
  s.players[0].discards.push(s.players[0].hand.pop()!); // 已經打過牌
  await saveGameState(id, s);
  eq(rooms[id].game_state.replayLog ?? null, null, "R6a 上線當下打到一半的局：不開始記（記不完整的不存）");
  const before = saveCalls.length;
  while (await step(id)) { /* 打完 */ }
  const n = (await (await db()).query("select 1 from mj_hand_replays where room_id = $1", [id])).rows.length;
  eq([rooms[id].game_state.status, saveCalls.length - before, n], ["finished", 0, 0], "R6b 這局打完也不寫回放");
  for (const p of rooms[id].game_state.players) await call(nextGame, { roomId: id, playerId: p.id });
  replayFail.save = true;
  while (await step(id)) { /* 打完下一局 */ }
  replayFail.save = false;
  eq([rooms[id].game_state.status, rooms[id].game_state.handsCompleted, saveCalls.length - before], ["finished", 2, 1], "R6c 下一局從頭開始記；寫回放失敗時牌局照樣結算存檔");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
