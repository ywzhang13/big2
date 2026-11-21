// 麻將換成共用開房畫面要的後端（老柯 2026-11-20，跟十三支的行為一致）：
//   N1 名字去掉前後空白後要 1～8 個字（Array.from 算字數，表情符號算 1 個字）：9 個字、只有空白回 400 bad_name，不入座；8 個字、表情符號照常入座、存去掉空白後的名字
//   N2 等人時同一個帳號重新加入、名字換了：座位的名字換成新的，廣播 mj_player_joined（renamed: true）；名字沒換不廣播；開局後重新加入名字不變
//   N3 等人狀態（GET state）每個座位帶大頭照 avatarUrl（照帳號查，沒有的是 null）；有人入座的廣播也帶 avatarUrl
import { tokens } from "../support/stub-auth";
import { lobbyHooks, opts, rooms, seats } from "../support/stub-db";
import { POST as startRoute } from "../../app/api/mahjong/start/route";
import { POST as confirmRoute } from "../../app/api/mahjong/start-confirm/route";
import { sent } from "../support/stub-broadcast";
import { POST as join } from "../../app/api/mahjong/join/route";
import { GET as stateRoute } from "../../app/api/mahjong/state/route";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const KEYS = ["a", "b", "c", "d"];
const U = Object.fromEntries(KEYS.map((k, i) => [k, `00000000-0000-4000-8000-0000000002${(0xa1 + i).toString(16)}`]));
for (const k of KEYS) tokens[`nk-${k}`] = { id: U[k], displayName: k, pictureUrl: k === "a" ? "https://pic.example/a.png" : null, isGuest: false };
type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function doJoin(code: string, playerId: string, name: string, as: string): Promise<Res> {
  const r = await join(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer nk-${as}` }, body: JSON.stringify({ code, playerId, name }) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string): Promise<Res> {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}`));
  return { status: r.status, body: await r.json() };
}
let n = 0;
function lobby() {
  const id = `NL${++n}`, code = `N${n}`;
  rooms[id] = { id, code, status: "waiting", host_id: "m0", game_state: { roomSettings: { totalRounds: 1, basePoints: 10, fanPoints: 10 } } as unknown as MahjongGameState };
  seats[id] = [];
  return { id, code };
}
const names = (id: string) => seats[id].map((p) => p.name);
const joined = () => sent.filter((e) => e.event === "mj_player_joined").map((e) => e.payload);

// N1
{
  const r = lobby();
  const nine = await doJoin(r.code, "m0", "一二三四五六七八九", "a");
  const blank = await doJoin(r.code, "m0", "　 ", "a");
  const eight = await doJoin(r.code, "m0", "  一二三四五六七八 ", "a");
  const emoji = await doJoin(r.code, "m1", "🀄️🀄️🀄️🀄️", "b"); // 4 個麻將牌加異體選擇字元＝8 個字元以內
  eq([nine.status, nine.body.error, blank.status, blank.body.error, eight.status, emoji.status, names(r.id)],
    [400, "bad_name", 400, "bad_name", 200, 200, ["一二三四五六七八", "🀄️🀄️🀄️🀄️"]],
    "N1 名字 9 個字、只有空白回 400 bad_name（不入座）；8 個字、表情符號照常入座，存去掉前後空白的名字");
}
// N2
{
  const r = lobby();
  await doJoin(r.code, "m0", "阿華", "a");
  await doJoin(r.code, "m1", "阿明", "b");
  sent.length = 0;
  const same = await doJoin(r.code, "m1", "阿明", "b");
  const quiet = joined().length;
  const renamed = await doJoin(r.code, "m1", "明仔", "b");
  const ev = joined();
  rooms[r.id].status = "playing"; // 開局後重新加入
  const late = await doJoin(r.code, "m1", "大明", "b");
  eq([same.body.rejoined, quiet, renamed.body.rejoined, names(r.id), ev.map((e) => [e.playerId, e.name, e.renamed]), late.body.rejoined, seats[r.id][1].name],
    [true, 0, true, ["阿華", "明仔"], [["m1", "明仔", true]], true, "明仔"],
    "N2 等人時重新加入換名字：座位名字換新、廣播 renamed；名字沒換不廣播；開局後重新加入名字不變");
}
// N3
{
  const r = lobby();
  sent.length = 0;
  await doJoin(r.code, "m0", "阿華", "a");
  await doJoin(r.code, "m1", "阿明", "b");
  const st = await state(r.id);
  eq([st.body.lobbyPlayers?.map((p: { id: string; avatarUrl?: string | null }) => [p.id, p.avatarUrl]), joined().map((e) => ("avatarUrl" in e ? e.avatarUrl : "沒有欄位"))],
    [[["m0", "https://pic.example/a.png"], ["m1", null]], ["https://pic.example/a.png", null]],
    "N3 等人狀態每個座位帶 avatarUrl（照帳號查，沒有的是 null）；入座廣播也帶 avatarUrl");
}

// N4（審伯 R2）：code、playerId 都有時，名字不合法一律 400 bad_name（附說明），不入座、不改名、不廣播；合法的 1 字、8 字、去空白後合法照常
{
  const r = lobby();
  await doJoin(r.code, "m0", "阿華", "a");
  sent.length = 0;
  const bad = [];
  for (const name of ["", "   ", "　　", "一二三四五六七八九"]) bad.push(await doJoin(r.code, "m1", name, "b"));
  const raw = async (name: unknown) => { const res = await join(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer nk-b" }, body: JSON.stringify({ code: r.code, playerId: "m1", name }) })); return { status: res.status, body: await res.json() }; };
  bad.push(await raw(123), await raw(null));
  const renameBad = await doJoin(r.code, "m0", "  ", "a"); // 已經坐下的人用空白名字重新加入：不改名
  const one = await doJoin(r.code, "m1", "明", "b");
  const eight = await doJoin(r.code, "m2", " 一二三四五六七八 ", "c");
  eq([bad.map((x) => [x.status, x.body.error, x.body.message]), renameBad.status, renameBad.body.error, joined().filter((e) => e.renamed).length, one.status, eight.status, names(r.id)],
    [Array(6).fill([400, "bad_name", "名字要是 1～8 個字"]), 400, "bad_name", 0, 200, 200, ["阿華", "明", "一二三四五六七八"]],
    "N4 空字串、半形空白、全形空白、9 個字、不是字串（數字、null）都 400 bad_name，不入座不改名不廣播；1 字、8 字、去空白後合法照常");
}
// N5（審伯 R1 交錯一）：改名請求讀到「還在等人」之後、寫入之前，房間先開局了 → 不改座位名字、不廣播 renamed
{
  const r = lobby();
  await doJoin(r.code, "m0", "阿華", "a");
  await doJoin(r.code, "m1", "阿明", "b");
  sent.length = 0;
  const saved = opts.delayMs;
  opts.delayMs = 30;
  setTimeout(() => { rooms[r.id].status = "playing"; }, 45); // 審伯的重現：第 45ms 房間變 playing
  const res = await doJoin(r.code, "m1", "明仔", "b");
  opts.delayMs = saved;
  eq([res.status, res.body.rejoined, seats[r.id][1].name, joined().filter((e) => e.renamed).length], [200, true, "阿明", 0],
    "N5 改名途中房間先開局：照常回原座位，但座位名字不改、不廣播 renamed（和牌局裡的名字一致）");
}
// N6（審伯 R1 交錯二）：最後一家同意、要發牌的那一刻，有人先改好名字 → 發牌那次存檔版本對不上、重讀，牌局裡用新名字
{
  const r = lobby();
  for (const [i, k] of ["a", "b", "c", "d"].entries()) await doJoin(r.code, `m${i}`, `玩家${k}`, k);
  const s = await (await startRoute(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer nk-a" }, body: JSON.stringify({ roomId: r.id, playerId: "m0" }) }))).json();
  const confirmId = s.confirm?.id as string;
  const agree = async (i: number, k: string) => (await confirmRoute(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer nk-${k}` }, body: JSON.stringify({ roomId: r.id, playerId: `m${i}`, confirmId }) }))).json();
  await agree(1, "b"); await agree(2, "c");
  let renamed = false;
  lobbyHooks.beforeClaim = async (roomId) => { // 最後一家同意要寫入的那一刻，玩家b 先改好名字
    if (renamed || roomId !== r.id) return;
    renamed = true;
    await doJoin(r.code, "m1", "改名了", "b");
  };
  const last = await agree(3, "d");
  lobbyHooks.beforeClaim = undefined;
  const gs = rooms[r.id].game_state as MahjongGameState;
  eq([renamed, last.started === true, rooms[r.id].status, seats[r.id][1].name, gs.players?.find((p) => p.id === "m1")?.name], [true, true, "playing", "改名了", "改名了"],
    "N6 發牌前一刻有人改名：照樣開局，牌局裡用的是新名字（座位和牌局一致）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
