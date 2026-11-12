// 麻將回放播放器（老馬 2026-11-13）：回放畫面每一步，要和打牌當下那位玩家自己的畫面一模一樣。
// 機器人透過真的 route handler 打完多局；每次存檔都用 toPlayerGameState 記下四家「本人看到的牌局」，
// 局結束後用老柯的回放紀錄＋前端的 boardAt（components/mahjong/replay/replayView.ts）一步一步重建，四個視角逐步比對。
//   P1 手牌、四家吃碰槓（別家暗槓蓋著、自己的看得到）、花、海底（被吃碰胡走的不顯示）、張數、輪到誰、牌牆剩幾張、眼牌／地聽座位
//   P2 眼牌的人看到的三家手牌（opponentHands）
//   P3 剛打出的那張（lastDiscard）、自己剛摸進的那張（drawnTileId）
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as nextGame } from "../../app/api/mahjong/next-game/route";
import { rooms, hooks, opts, saveGameState } from "../support/stub-db";
import { asSeat } from "../support/stub-auth";
import { db } from "../support/stub-replay-store";
import { paceClock } from "../../lib/mahjong/pace";
import { canDeclareTingNow, dealTiles, getAvailableActions, initGame, isChiForbidden, isLocked, ownTurnActions, eyeDiscardOptions } from "../../lib/mahjong/gameLogic";
import { decodeRecord, replayFrames, snapshot, type ReplayRecord } from "../../lib/mahjong/replay/log";
import { toPlayerGameState } from "../../lib/mahjong/db";
import { tileKey, type Tile } from "../../lib/mahjong/tiles";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import { boardAt, type ReplayBoard } from "../../components/mahjong/replay/replayView";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

let seed = 20261114;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = () => Math.random();
let now = Date.parse("2026-11-13T12:00:00Z");
paceClock.now = () => now;
paceClock.sleep = async (ms: number) => { now += ms; };
opts.delayMs = 0;
await db();

type View = ReturnType<typeof toPlayerGameState>;
// 每次存檔：四家的樣子（拿來對齊步數）＋四位玩家本人看到的牌局
const saved: Record<string, { status: string; done: number; key: string; views: View[]; drawn: number | undefined }[]> = {};
hooks.onSaved = async (id, s) => {
  const views = s.players.map((p) => JSON.parse(JSON.stringify(toPlayerGameState(s, p.id))) as View);
  (saved[id] ??= []).push({ status: s.status, done: s.handsCompleted ?? 0, key: JSON.stringify(snapshot(s)), views, drawn: s.drawnTileId });
};

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


const ids = (ts: { id: number }[] | undefined) => (ts ?? []).map((t) => t.id);
const sortedIds = (ts: { id: number }[] | undefined) => ids(ts).sort((a, b) => a - b);
const melds = (ms: Meld[]) => ms.map((m) => [m.type, m.from ?? -1, ...ids(m.tiles)]);
const sortSeats = (xs: number[] | undefined) => [...(xs ?? [])].sort();

/** 本人畫面上看得到的牌局（打牌時：toPlayerGameState；回放：boardAt） */
function fromReal(v: View, playing: boolean) {
  return {
    hand: sortedIds(v.hand),
    players: v.players.map((p) => ({ seat: p.seat, n: p.tileCount, f: ids(p.flowers), d: ids(p.discards), m: melds(p.revealed) })),
    turn: v.currentTurn, wall: v.wallCount, eye: sortSeats(v.eyeSeats), ting: sortSeats(v.tingSeats),
    opp: playing ? (v.opponentHands ?? null)?.map((h) => [h.seat, sortedIds(h.hand), melds(h.revealed)]) ?? null : "-",
  };
}
function fromReplay(b: ReplayBoard, playing: boolean) {
  return {
    hand: sortedIds(b.myHand),
    players: b.players.map((p) => ({ seat: p.seat, n: p.tileCount, f: ids(p.flowers), d: ids(p.discards), m: melds(p.revealed) })),
    turn: b.currentTurn, wall: b.wallRemaining, eye: sortSeats(b.eyeSeats), ting: sortSeats(b.tingSeats),
    opp: playing ? b.opponentHands?.map((h) => [h.seat, sortedIds(h.hand), melds(h.revealed)]) ?? null : "-",
  };
}

let hands = 0, steps = 0, eyeSteps = 0, concealedSteps = 0;
const mismatch: string[] = [];
let lastMis = 0, drawnMis = 0, drawnChecked = 0;
for (let roomN = 1; roomN <= 4; roomN++) {
  const id = `ac000000-0000-4000-8000-00000000000${roomN}`;
  newRoom(id);
  saved[id] = [];
  await saveGameState(id, rooms[id].game_state);
  for (let hand = 1; hand <= 10; hand++) {
    let guard = 0;
    while (await step(id)) if (++guard > 1500) { errors.push(`${id} 走不完`); break; }
    const gs = rooms[id].game_state;
    if (gs.status !== "finished") break;
    const done = gs.handsCompleted!;
    // 實際：這局每一個「牌有動」的存檔，取第一次出現的那個（之後的 pass 只換輪到誰，回放不記）
    const all = saved[id].filter((x) => (x.done === done - 1 && x.status === "playing")).concat(saved[id].filter((x) => x.done === done && x.status === "finished").slice(0, 1));
    const actual = all.filter((x, i) => i === 0 || x.key !== all[i - 1].key);
    const row = (await (await db()).query<{ data: ReplayRecord }>("select data from mj_hand_replays where room_id = $1 and hand_no = $2", [id, done])).rows[0];
    if (!row) { errors.push(`${id} 第 ${done} 局沒有回放`); break; }
    const rec = decodeRecord(row.data);
    const frames = replayFrames(rec);
    const firstStep = frames.map((f, i) => i).filter((i) => i === 0 || JSON.stringify(frames[i]) !== JSON.stringify(frames[i - 1]));
    if (firstStep.length !== actual.length) { mismatch.push(`${id} 第 ${done} 局步數不同：回放 ${firstStep.length}、實際 ${actual.length}`); continue; }
    hands++;
    firstStep.forEach((st, i) => {
      const a = actual[i];
      const playing = a.status === "playing";
      for (let seat = 0; seat < 4; seat++) {
        const b = boardAt(rec, frames, st, seat);
        const want = fromReal(a.views[seat], playing), got = fromReplay(b, playing);
        steps++;
        if (b.opponentHands) eyeSteps++;
        if (b.players.some((p) => p.revealed.some((m) => m.type === "concealed_kong"))) concealedSteps++;
        if (JSON.stringify(want) !== JSON.stringify(got) && mismatch.length < 3) mismatch.push(`${id} 第 ${done} 局第 ${st} 步座位 ${seat}：\n     實際=${JSON.stringify(want)}\n     回放=${JSON.stringify(got)}`);
        if (playing && (a.views[seat].lastDiscard?.tile.id ?? null) !== (b.lastDiscard?.tile.id ?? null) && st > 0) lastMis++;
        if (playing && st > 0 && a.views[seat].currentTurn === seat && a.views[seat].hasDrawn) {
          drawnChecked++;
          if ((a.views[seat].myDrawnTileId ?? null) !== b.drawnTileId) drawnMis++;
        }
      }
    });
    if (gs.gameOver) break;
    for (const p of gs.players) await call(nextGame, { roomId: id, playerId: p.id });
  }
}

eq(errors, [], "機器人打牌過程中每個請求都是 200");
eq(hands >= 20, true, `打完 ${hands} 局、比對 ${steps} 個「步數×視角」`);
eq(mismatch, [], `P1／P2 ${hands} 局每一步、四個視角：手牌、吃碰槓（別家暗槓蓋著）、花、海底、張數、輪到誰、牌牆、眼牌／地聽、眼牌看到的三家手牌，都和打牌當下本人畫面一致`);
eq(eyeSteps > 0 && concealedSteps > 0, true, `涵蓋：眼牌看三家手牌 ${eyeSteps} 次、畫面上有暗槓 ${concealedSteps} 次`);
eq(lastMis, 0, "P3 剛打出的那張（lastDiscard）每一步都一致");
eq([drawnChecked > 0, drawnMis], [true, 0], `P3 自己剛摸進、還沒打出的那張（分開放在手牌右邊）一致（檢查 ${drawnChecked} 次）`);

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
