// 大老二手牌不外流（老柯 2026-11-27）：big2-<房號> 是公開頻道，知道房號的人都能訂閱；玩家 id 也會在 game_start 公開。
//   H1 第一局：從開局確認到發牌，公開頻道上（＝知道房號、沒入座的訂閱者收得到的全部事件）沒有任何一家的手牌內容
//   H2 第一局：四家帶自己的入座憑證讀狀態，各拿到自己的 13 張（和存檔一致、四家合起來 52 張不重複）
//   H3 讀狀態只拿得到自己的手牌：沒帶憑證、憑證錯、拿別人的憑證、填別人的玩家 id 帶自己的憑證 → myHand 都是空的（牌桌其他狀態照常）；不在房裡 403
//   H4 下一局（finished → 再發牌）：公開頻道一樣沒有手牌；四家重新整理後各拿到新的 13 張
//   H5 出牌、過：沒帶憑證、憑證不對（冒名）一律 403 not_your_seat，在讀牌桌之前就擋（拿不到「沒有這張牌」來試探別人手牌）
//   H6 結束時亮牌照規則保留：game_over 帶全部手牌（play 路由），這裡只確認發牌、讀狀態不帶
import { POST as join } from "../../app/api/game/join/route";
import { GET as state } from "../../app/api/game/state/route";
import { POST as readyCheck } from "../../app/api/game/ready-check/route";
import { POST as ready } from "../../app/api/game/ready/route";
import { POST as play } from "../../app/api/game/play/route";
import { POST as pass } from "../../app/api/game/pass/route";
import { sent } from "../support/stub-broadcast";
import * as rs from "../support/stub-records-store";
import { extra } from "../support/stub-big2-leave-store";
import { dealAndStart } from "../../lib/deal-and-start";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
type Res = { status: number; body: Record<string, unknown> & { myHand?: string[] } };
const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown): Promise<Res> =>
  fn(new Request(`http://x${url}`, { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, body: await r.json() }));
const getState = async (roomId: string, playerId: string, seatKey?: string): Promise<Res> => {
  const url = `http://x/api/game/state?roomId=${roomId}&playerId=${playerId}`;
  const req = new Request(url, { headers: seatKey ? { "x-big2-seat-key": seatKey } : {} });
  const r = await state(Object.assign(req, { nextUrl: new URL(url) }) as unknown as Parameters<typeof state>[0]);
  return { status: r.status, body: await r.json() };
};
const cid = (roomId: string) => (extra[roomId]?.start_confirm as { id?: string } | null | undefined)?.id;
const saved = (roomId: string) => Object.fromEntries(rs.big2Rooms[roomId].players.map((p) => [p.player_id, [...(p.hand as string[])].sort()]));
const sorted = (h: unknown) => [...((h as string[]) ?? [])].sort();

/** 公開頻道上出現的「手牌內容」：任何事件 payload 裡（不管欄位名）出現某一家還握在手上的牌陣列（2 張以上的牌組，game_start 的玩家名單不算） */
function leakedHands(events: { event: string; payload: Record<string, unknown> }[], hands: Record<string, string[]>): string[] {
  const all = new Set(Object.values(hands).flat());
  const out: string[] = [];
  const walk = (v: unknown, path: string, ev: string) => {
    if (Array.isArray(v)) {
      const cards = v.filter((x) => typeof x === "string" && all.has(x));
      if (cards.length >= 2) out.push(`${ev}:${path}(${cards.length} 張)`);
      v.forEach((x, i) => walk(x, `${path}[${i}]`, ev));
    } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, ev);
  };
  for (const e of events) { if (e.event === "deal_hand") out.push("deal_hand"); walk(e.payload, "", e.event); }
  return out;
}

let n = 0;
/** 4 個人用房號加入（拿入座憑證）→ 房主按開始 → 三家同意 → 發牌（正式流程） */
async function startedRoom() {
  const id = "HP" + ++n, code = String(8300 + n);
  rs.big2Rooms[id] = { room: { id, code, status: "waiting", created_at: "2026-11-27T06:00:00Z", records_enabled: true, scores: null, updated_at: "2026-11-27T06:00:00Z", row_version: 1 }, players: [] };
  const ps = ["a", "b", "c", "d"].map((x) => `${x}${n}`);
  extra[id] = { host_id: ps[0], ready_players: [] };
  const keys: Record<string, string> = {};
  for (const p of ps) keys[p] = (await post(join, "/api/game/join", { code, playerId: p, name: "N" + p })).body.seatKey as string;
  sent.length = 0; // 從開局確認開始收（＝外人訂閱公開頻道收到的全部）
  await post(readyCheck, "/api/game/ready-check", { roomId: id, playerId: ps[0], seatKey: keys[ps[0]] });
  for (const p of ps.slice(1)) await post(ready, "/api/game/ready", { roomId: id, playerId: p, confirmId: cid(id) });
  return { id, code, ps, keys };
}

// H1、H2、H3（第一局）
const r = await startedRoom();
{
  const hands = saved(r.id);
  const pub = [...sent];
  eq([rs.big2Rooms[r.id].room.status, pub.filter((e) => e.event === "game_start").length, leakedHands(pub, hands)],
    ["playing", 1, []], "H1 第一局：開局了（game_start 1 次），公開頻道上沒有任何一家的手牌（沒有 deal_hand、任何事件都不帶手牌陣列）");
  const mine = await Promise.all(r.ps.map((p) => getState(r.id, p, r.keys[p])));
  const all52 = new Set(mine.flatMap((s) => s.body.myHand ?? []));
  eq([mine.map((s) => s.status), mine.map((s) => (s.body.myHand ?? []).length), mine.every((s, i) => JSON.stringify(sorted(s.body.myHand)) === JSON.stringify(hands[r.ps[i]])), all52.size],
    [[200, 200, 200, 200], [13, 13, 13, 13], true, 52], "H2 第一局：四家帶自己的入座憑證讀狀態，各拿到自己的 13 張（和存檔一致，四家合起來 52 張）");
  const [a, b] = r.ps;
  const noKey = await getState(r.id, b);
  const wrong = await getState(r.id, b, "not-a-real-key");
  const othersKey = await getState(r.id, b, r.keys[a]);   // a 拿自己的憑證讀 b 的狀態
  const outsider = await getState(r.id, "stranger", r.keys[a]);
  eq([noKey.status, noKey.body.myHand, wrong.body.myHand, othersKey.body.myHand, noKey.body.status, (noKey.body.players as unknown[]).length, outsider.status],
    [200, [], [], [], "playing", 4, 403],
    "H3 讀狀態只拿得到自己的手牌：沒帶憑證、憑證錯、拿別人的憑證讀 → myHand 空（牌桌狀態、四家張數照常）；不在房裡 403");
}

// H4（下一局：打完一場 finished → 發新牌；/api/game/continue 也是呼叫 dealAndStart）
{
  const before = saved(r.id);
  rs.big2Rooms[r.id].room.status = "finished";
  sent.length = 0;
  const ok = await dealAndStart(r.id, r.code, { [r.ps[0]]: 0 }, ["finished"]);
  const hands = saved(r.id);
  const pub = [...sent];
  const mine = await Promise.all(r.ps.map((p) => getState(r.id, p, r.keys[p])));
  const changed = r.ps.some((p) => JSON.stringify(hands[p]) !== JSON.stringify(before[p]));
  eq([ok, pub.filter((e) => e.event === "game_start").length, leakedHands(pub, hands), mine.map((s) => (s.body.myHand ?? []).length),
    mine.every((s, i) => JSON.stringify(sorted(s.body.myHand)) === JSON.stringify(hands[r.ps[i]])), changed, (await getState(r.id, r.ps[1])).body.myHand],
    [true, 1, [], [13, 13, 13, 13], true, true, []],
    "H4 下一局：公開頻道一樣沒有手牌；四家重新整理（帶憑證讀狀態）各拿到新的 13 張；沒帶憑證還是空的");
}

// H5（出牌、過：冒名一律 403，在讀牌桌之前就擋）
{
  const [a, b] = r.ps;
  const bCard = (saved(r.id)[b] ?? [])[0];
  const playNoKey = await post(play, "/api/game/play", { roomId: r.id, playerId: b, cards: [bCard] });
  const playImposter = await post(play, "/api/game/play", { roomId: r.id, playerId: b, cards: [bCard], seatKey: r.keys[a] });
  const playProbe = await post(play, "/api/game/play", { roomId: r.id, playerId: b, cards: ["3C"], seatKey: "guess" });
  const passNoKey = await post(pass, "/api/game/pass", { roomId: r.id, playerId: b });
  const passImposter = await post(pass, "/api/game/pass", { roomId: r.id, playerId: b, seatKey: r.keys[a] });
  eq([playNoKey.status, playNoKey.body.error, playImposter.status, playProbe.status, playProbe.body.error, passNoKey.status, passImposter.status, passImposter.body.error],
    [403, "not_your_seat", 403, 403, "not_your_seat", 403, 403, "not_your_seat"],
    "H5 出牌、過：沒帶憑證、拿別人的憑證、亂猜憑證都 403 not_your_seat（回應一樣，試探不出別人有沒有這張牌）");
  // 本人帶對的憑證會通過座位檢查、往下讀牌桌（測試環境沒接資料庫，後面的回應不看；只確認不是 403）
  const own = await post(play, "/api/game/play", { roomId: r.id, playerId: b, cards: [bCard], seatKey: r.keys[b] });
  const ownPass = await post(pass, "/api/game/pass", { roomId: r.id, playerId: b, seatKey: r.keys[b] });
  eq([own.status !== 403, ownPass.status !== 403], [true, true], "H5 本人帶自己的入座憑證：通過座位檢查（不是 403）");
}

// H6（結束亮牌保留：只確認這支測試範圍內沒有 game_over 以外的手牌）
eq([sent.filter((e) => e.event === "deal_hand").length], [0], "H6 整支測試從頭到尾沒有任何 deal_hand 廣播（結束時的 game_over 亮牌由 play 路由照規則送，不在這裡改）");

console.log(results.join("\n"));
if (results.some((x) => x.startsWith("❌"))) process.exit(1);
