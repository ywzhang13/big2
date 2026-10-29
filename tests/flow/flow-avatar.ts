// 同桌 LINE 大頭貼（老闆 2026-10-29）：開局時伺服器從登入資料取大頭貼網址，放在公開座位資料 players[i].avatarUrl
//   A1 開局廣播 mj_game_start、牌局中讀 state（別家看）都有：LINE 登入的座位是網址，遊客、沒有大頭貼的座位是 null
//   A2 回應和廣播裡沒有帳號 id、沒有 userId 欄位
//   A3 下一局沿用（startNextGame 不清掉）
import { POST as start } from "../../app/api/mahjong/start/route";
import { GET as getState } from "../../app/api/mahjong/state/route";
import { rooms, seats } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import { startNextGame } from "../../lib/mahjong/gameLogic";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const PIC = "https://profile.line-scdn.net/abc123";
tokens.host = { id: "uid-host-0000", displayName: "房主", pictureUrl: PIC, isGuest: false };
tokens.guest = { id: "uid-guest-0001", displayName: null, pictureUrl: "https://x/guest.png", isGuest: true };
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
rooms.R = { id: "R", code: "T", status: "waiting", host_id: "p0", game_state: { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } } as unknown as MahjongGameState };
seats.R = [
  { player_id: "p0", name: "P0", seat: 0, user_id: "uid-host-0000" },
  { player_id: "p1", name: "P1", seat: 1, user_id: "uid-guest-0001" },
  { player_id: "p2", name: "P2", seat: 2, user_id: "u:p2" },
  { player_id: "p3", name: "P3", seat: 3, user_id: "u:p3" },
];
sent.length = 0;
const sr = await start(new Request("http://x", { method: "POST", headers: { authorization: "Bearer host" }, body: JSON.stringify({ roomId: "R", playerId: "p0" }) }));
const startEv = sent.find((e) => e.event === "mj_game_start");
const byId = (list: { id: string; avatarUrl?: string | null }[] | undefined) => Object.fromEntries((list ?? []).map((p) => [p.id, p.avatarUrl ?? null]).sort());
const want = { p0: PIC, p1: null, p2: null, p3: null };
const stRes = await getState(new Request("http://x/api/mahjong/state?roomId=R&playerId=p2", { headers: { authorization: "Bearer as:p2" } }));
const stBody = await stRes.json();
eq([sr.status, byId((startEv?.payload as { players?: [] })?.players), stRes.status, byId(stBody.gameState?.players)], [200, want, 200, want],
  "A1 開局廣播和牌局中 state（p2 看）：LINE 登入的房主有大頭貼網址，遊客、沒大頭貼的是 null");
const blob = JSON.stringify(sent) + JSON.stringify(stBody);
eq([blob.includes("uid-host-0000"), blob.includes("uid-guest-0001"), /"userId"/.test(blob)], [false, false, false], "A2 廣播和 state 沒有帳號 id、沒有 userId 欄位");
const next = startNextGame(rooms.R.game_state as MahjongGameState);
eq(next.players.map((p) => p.avatarUrl ?? null).filter(Boolean), [PIC], "A3 下一局沿用大頭貼");
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
