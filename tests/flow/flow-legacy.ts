// 上線「麻將一律要登入」時關舊房（lib/records/legacy.ts、scripts/close-legacy-mahjong-rooms.ts）：
// 列出上線前建、座位沒綁帳號的房，標出可能有人在打的；確認後打過牌的記紀錄、沒打過的直接刪；新房不動。
import { rooms, seats } from "../support/stub-db";
import * as rs from "../support/stub-records-store";
import { closeLegacyMahjongRooms, findLegacyMahjongRooms, formatLegacyReport } from "../../lib/records/legacy";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const NOW = Date.parse("2026-10-16T10:30:00.000Z");
const CUTOFF = new Date(NOW).toISOString(); // 新版上線的時間
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const NAMES = ["阿瑋", "小林", "阿德", "Kevin"];

/** 建一間房：game=null 表示還在大廳；bound=true 表示座位綁了帳號（新版程式建的房） */
function room(id: string, code: string, o: { createdMin: number; updatedMin: number; game?: Partial<MahjongGameState> | null; bound?: boolean; seatsN?: number }) {
  const n = o.seatsN ?? 4;
  const players = NAMES.slice(0, n).map((name, seat) => ({ id: `${id}-p${seat}`, name, seat, hand: [], revealed: [], flowers: [], discards: [], isDealer: seat === 0 }));
  const gs = o.game === null || o.game === undefined
    ? ({ roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } } as unknown as MahjongGameState)
    : ({ roomCode: code, status: "playing", players, wall: [], currentTurn: 0, lastDiscard: null, dealerSeat: 0, prevalentWind: 1, turnCount: 3, hasDrawn: false,
        isFirstRound: false, isAfterKong: false, stateVersion: 7, roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
        roundInfo: { currentRound: 1, currentGame: 2, dealerConsecutive: 0, initialDealerSeat: 0 }, ...o.game } as MahjongGameState);
  rooms[id] = { id, code, status: o.game ? (o.game.status ?? "playing") : "waiting", host_id: `${id}-p0`, game_state: gs };
  seats[id] = players.map((p) => ({ player_id: p.id, name: p.name, seat: p.seat, user_id: o.bound ? `u-${p.id}` : null }));
  rs.mjCreatedAt[id] = ago(o.createdMin);
  rs.mjUpdatedAt[id] = ago(o.updatedMin);
}
function fixtures() {
  rs.reset();
  for (const k of Object.keys(rooms)) delete rooms[k];
  room("L1", "8101", { createdMin: 90, updatedMin: 5, game: { handsCompleted: 2, startedAt: ago(80), playerScores: [300, -100, -100, -100] } }); // 上線時正在打
  room("L2", "8102", { createdMin: 200, updatedMin: 180, game: null, seatsN: 2 }); // 還在等人
  room("L3", "8103", { createdMin: 150, updatedMin: 120, game: { handsCompleted: 0, startedAt: ago(130), playerScores: [0, 0, 0, 0] } }); // 開局了但一局都沒打完
  room("L4", "8104", { createdMin: 3000, updatedMin: 60, game: { playerScores: [100, -100, 0, 0] } }); // f85aa16 以前開局（沒有 handsCompleted）
  room("L5", "8105", { createdMin: 400, updatedMin: 240, game: { status: "finished", gameOver: true, handsCompleted: 4, startedAt: ago(390), playerScores: [500, -100, -200, -200] } }); // 打完了但之前關房失敗
  room("N1", "8201", { createdMin: -2, updatedMin: -2, game: null, seatsN: 1, bound: false }); // 上線後才建（建房者還沒入座完成也不動）
  room("N2", "8202", { createdMin: 1, updatedMin: 1, game: null, seatsN: 2, bound: true }); // 上線前一刻用新版建、座位有綁帳號
}

// --- 列出 ---
fixtures();
let legacy = await findLegacyMahjongRooms(CUTOFF, NOW);
eq(legacy.map((r) => [r.row.code, r.active, r.action]),
  [["8104", false, "delete"], ["8105", false, "record_completed"], ["8102", false, "delete"], ["8103", false, "delete"], ["8101", true, "record_dissolved"]],
  "G1 只列上線前建、座位沒綁帳號的房（建房時間舊到新）；30 分鐘內有動作的標成可能有人在打；打過牌的記紀錄、沒打完任何一局（含 f85aa16 以前開局）的直接刪");
const report = formatLegacyReport(legacy);
console.log("---- 列出的輸出範例 ----\n" + report + "\n------------------------");
eq([report.includes("⚠️ 可能有人在打（30 分鐘內有動作）：1 間"), report.split("全部清單：")[0].includes("房 8101｜playing｜最後動作 5 分鐘前｜打完 2 局｜阿瑋、小林、阿德、Kevin"),
  report.includes("8201"), report.includes("8202")], [true, true, false, false], "G2 清單最上面先列出可能有人在打的房（房號、狀態、幾分鐘前有動作、打完幾局、玩家）；新房不出現");

// --- 有人在打：不加 force 一間都不動 ---
const refused = await closeLegacyMahjongRooms(legacy);
eq([refused.refused, Object.keys(rooms).sort(), rs.records.length], [true, ["L1", "L2", "L3", "L4", "L5", "N1", "N2"], 0], "G3 有可能有人在打的房時，沒加 --force 拒絕執行：房間、紀錄都沒變");

// --- 確認沒人在打（等他們打完離開）後執行 ---
rs.mjUpdatedAt.L1 = ago(45);
legacy = await findLegacyMahjongRooms(CUTOFF, NOW);
const done = await closeLegacyMahjongRooms(legacy);
const recs = rs.records.map((r) => [r.roomCode, r.endReason, r.handsPlayed, r.players.map((p) => p.totalScore), r.players.map((p) => p.userId ?? null)]);
eq([done.refused, done.closed, done.skipped, Object.keys(rooms).sort()], [false, ["8104", "8105", "8102", "8103", "8101"], [], ["N1", "N2"]], "G4 沒有人在打時執行：5 間舊房全部關掉，新房（N1、N2）不動");
eq(recs, [["8105", "completed", 4, [500, -100, -200, -200], [null, null, null, null]], ["8101", "dissolved", 2, [300, -100, -100, -100], [null, null, null, null]]],
  "G5 打過牌的留紀錄：正在打的那間記中途解散（當下總分）、之前就打完的記打完；沒打完任何一局的不留紀錄；舊座位沒有帳號，user_id 是空的");
eq((await findLegacyMahjongRooms(CUTOFF, NOW)).length, 0, "G6 執行後再列一次：沒有舊房");

// --- 列出之後、執行之前房間又有人動：那間跳過 ---
fixtures();
rs.mjUpdatedAt.L1 = ago(45);
legacy = await findLegacyMahjongRooms(CUTOFF, NOW);
rs.touch("mahjong", "L3", ago(0));
const raced = await closeLegacyMahjongRooms(legacy);
eq([raced.skipped, !!rooms.L3, raced.closed.length], [["8103"], true, 4], "G7 列出後、刪除前房間有新動作：那間跳過不刪（其他照常），留給閒置清理");

// --- 確定要關：--force ---
fixtures();
const forced = await closeLegacyMahjongRooms(await findLegacyMahjongRooms(CUTOFF, NOW), { force: true });
eq([forced.refused, forced.closed.length, rs.records.find((r) => r.roomCode === "8101")?.endReason], [false, 5, "dissolved"], "G8 確認後加 --force：連正在打的也關掉，那場記中途解散");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
