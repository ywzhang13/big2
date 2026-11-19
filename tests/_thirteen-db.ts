// 十三支資料庫與 db 層（老柯 2026-11-16）：在記憶體 PostgreSQL（PGlite）跑真的 migration，
// 再讓 lib/thirteen/db.ts、lib/records/store.ts 的真程式碼（真的 supabase-js）透過 tests/support/thirteen-postgrest.ts 打進去。
//   M  migration：新表、權限（公開金鑰讀不到也寫不了）、紀錄可記十三支、關房函式的麻將／大老二分支一字不變
//   R  開房：理牌時間 15～120 秒每 15 秒一階（2026-11-18 起；原本 30／45／60）、房號重複、設定存進牌局狀態
//   J  入座：四家、座位重複、玩家重複、座位超出範圍
//   S  存狀態：4 家手牌、理牌截止時間、送出的三墩、每局結果與多局累計；樂觀鎖衝突不覆蓋；trigger 記活動時間
//   C  寫對局紀錄＋關房：版本不對不關、關房寫紀錄並連座位一起刪、重送、沒打完不記紀錄
//   O  麻將、大老二關房照舊
//   B  回滾：有十三支資料就拒絕；清掉後還原成套用前的樣子；可以再套一次
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPostgrest } from "./support/thirteen-postgrest";
import { deal } from "../lib/thirteen/cards";
import { autoArrange } from "../lib/thirteen/arrange";
import { scoreRound } from "../lib/thirteen/score";
import { matchStats } from "../lib/thirteen/flow";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUPA = path.join(ROOT, "supabase");
const MIG = "migrations/20261116_thirteen_rooms.sql";
const RB = "migrations/20261116_thirteen_rooms_rollback.sql";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = new PGlite();
const run = (f: string) => db.exec(readFileSync(path.join(SUPA, f), "utf8"));
type Row = Record<string, unknown>;
const rows = async (q: string, a?: unknown[]) => (await db.query<Row>(q, a)).rows;
const one = async (q: string, a?: unknown[]) => (await rows(q, a))[0];
async function as<T>(role: string, fn: () => Promise<T>): Promise<T | string> {
  await db.exec(`set role ${role}`);
  try { return await fn(); } catch (e) { return "ERR " + (e as Error).message.split("\n")[0]; } finally { await db.exec("reset role"); }
}
const errOf = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as Error).message; } };
/** 跑 SQL 檔：失敗時把整份交易收掉（檔案自己有 begin，出錯後 PGlite 停在中斷的交易裡；正式庫斷線也一樣全部不生效） */
const runSql = async (f: string) => { try { await run(f); return "ok"; } catch (e) { await db.exec("rollback"); return (e as Error).message; } };

// ---------- 正式站現況：Supabase 角色 → 大老二、麻將 → 對局紀錄 → 登入版關房函式 → 麻將鎖權限 ----------
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);
for (const f of ["schema.sql", "mahjong-schema.sql", "migrations/20261016_match_records.sql", "migrations/20261017_mahjong_login.sql", "migrations/20261019_mahjong_rls_enforce.sql"]) await run(f);

const fnSrc = async () => String((await one(`select prosrc from pg_proc where proname = 'close_room_with_record'`)).prosrc);
const fnAcl = async () => String((await one(`select proacl::text a from pg_proc where proname = 'close_room_with_record'`)).a);
const gameCheck = async () => String((await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'match_records_game_check'`)).d);
const structure = async () => rows(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
  where table_schema = 'public' and table_name in ('mj_rooms','mj_players','big2_rooms','big2_players','match_records','match_record_players') order by 1, 2`);
const before = { src: await fnSrc(), acl: await fnAcl(), check: await gameCheck(), structure: await structure() };

await run(MIG);

// ---------- M migration ----------
{
  const t = await rows(`select c.relname, c.relrowsecurity rls from pg_class c where c.relname in ('th_rooms','th_players') order by 1`);
  const anon = await as("anon", () => rows(`select * from th_rooms`));
  const anonIns = await as("authenticated", () => rows(`insert into th_rooms (code) values ('9999') returning id`));
  const anonPl = await as("anon", () => rows(`select * from th_players`));
  const svc = await as("service_role", () => rows(`select count(*)::int n from th_rooms`));
  eq([t, String(anon).startsWith("ERR permission denied"), String(anonIns).startsWith("ERR permission denied"), String(anonPl).startsWith("ERR permission denied"), svc],
    [[{ relname: "th_players", rls: true }, { relname: "th_rooms", rls: true }], true, true, true, [{ n: 0 }]],
    "M1 新表 th_rooms、th_players 開了 RLS；公開金鑰（anon、authenticated）讀不到、也寫不進去；伺服器（service_role）可以讀");
  eq(await gameCheck(), "CHECK ((game = ANY (ARRAY['mahjong'::text, 'big2'::text, 'thirteen'::text])))", "M2 對局紀錄的遊戲種類多了 thirteen（mahjong、big2 還在）");
  const bad = await as("service_role", () => rows(`insert into match_records (game, room_id, room_code, end_reason) values ('poker', gen_random_uuid(), '0000', 'completed')`));
  eq(String(bad).includes("match_records_game_check"), true, "M2 其他沒登記的遊戲種類照樣被擋");
  // 關房函式：把新加的兩段 thirteen 拿掉，剩下的要跟套用前一字不差（麻將、大老二分支沒被動到）
  const now = await fnSrc();
  const stripped = now
    .replace(/  elsif p_game = 'thirteen' then\n    select row_version[\s\S]*?for update;\n(?=  else\n    raise exception)/, "")
    .replace(/  elsif p_game = 'thirteen' then\n    delete from th_rooms[^\n]*\n/, "");
  eq([stripped === before.src, now !== before.src, await fnAcl() === before.acl], [true, true, true],
    "M3 close_room_with_record 只多了 thirteen 的鎖房、刪房兩段，其餘（麻將、大老二分支）一字不差；執行權限不變（只有伺服器能呼叫）");
  eq(await structure(), before.structure, "M4 麻將、大老二、對局紀錄的資料表欄位完全沒變");
  const touch = await rows(`select tgname from pg_trigger where tgrelid = 'th_rooms'::regclass and not tgisinternal`);
  eq(touch, [{ tgname: "trg_th_rooms_updated_at" }], "M5 th_rooms 掛了和麻將同一個 games_touch_room trigger");
  const again = await runSql(MIG);
  eq(again.includes("已經套用過"), true, "M6 重跑 migration 會被擋下（不會蓋掉已經有的表）");
}

// ---------- 讓真的 supabase-js 打進 PGlite ----------
const BASE = "http://thirteen-db.test";
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
const reqLog = installPostgrest(db, BASE);
const T = await import("../lib/thirteen/db");
const { closeRoom } = await import("../lib/records/store"); // 直接用真的（不經過測試替身），打 close_room_with_record

// ---------- R 開房 ----------
let roomId = "";
{
  const settings = { arrangeSec: 45 as const, totalHands: 4 };
  const r = await T.insertRoom({ code: "5201", host_id: "p0", host_user_id: "00000000-0000-4000-8000-0000000000a0", settings });
  roomId = typeof r === "object" ? r.id : "";
  const room = await T.loadRoom(roomId);
  eq([room?.code, room?.status, room?.host_id, room?.game_state?.hostUserId, room?.game_state?.settings, room?.game_state?.phase, room?.game_state?.stateVersion, room?.game_state?.playerScores],
    ["5201", "waiting", "p0", "00000000-0000-4000-8000-0000000000a0", settings, "waiting", 0, [0, 0, 0, 0]], "R1 開房：房號、等人中、房主（含開房帳號）；理牌時間 45 秒和局數存進牌局狀態，版本 0、累計分數 0");
  eq((await T.loadRoomByCode("5201"))?.id === roomId, true, "R2 用房號找得到同一間");
  eq(await T.insertRoom({ code: "5201", host_id: "p9", host_user_id: "00000000-0000-4000-8000-0000000000a0", settings }), "duplicate", "R3 房號重複回 duplicate（呼叫端換一個再試）");
  const okSecs = [];
  for (const [i, sec] of [30, 60].entries()) okSecs.push(typeof (await T.insertRoom({ code: `530${i}`, host_id: "x", host_user_id: "00000000-0000-4000-8000-0000000000a0", settings: { arrangeSec: sec as 30 | 60, totalHands: 1 } })) === "object");
  const bad = await errOf(T.insertRoom({ code: "5309", host_id: "x", host_user_id: "00000000-0000-4000-8000-0000000000a0", settings: { arrangeSec: 40 as unknown as 30, totalHands: 1 } }));
  eq([okSecs, bad, await T.loadRoomByCode("5309")], [[true, true], "理牌時間要是 15～120 秒，每 15 秒一階（15、30、45、60、75、90、105、120）", null], "R4 理牌時間 30、60 秒也能開；40 秒丟錯，而且沒有建出房間");
  eq([T.isArrangeSec(30), T.isArrangeSec(45), T.isArrangeSec(60), T.isArrangeSec(15), T.isArrangeSec(120), T.isArrangeSec(14), T.isArrangeSec(135), T.isArrangeSec("30")],
    [true, true, true, true, true, false, false, false], "R5 isArrangeSec 認 15～120 每 15 秒一階（數字）；14、135、字串都不認");
  eq(await T.loadRoom("00000000-0000-4000-8000-00000000dead"), null, "R6 不存在的房間回 null");
}

// ---------- J 入座 ----------
const U = (n: number) => `00000000-0000-4000-8000-0000000000a${n}`;
{
  const ins = [];
  for (const seat of [2, 0, 3, 1]) ins.push(await T.insertPlayer({ room_id: roomId, player_id: `p${seat}`, name: `玩家${seat}`, seat, user_id: seat === 3 ? null : U(seat) }));
  const pl = await T.loadPlayers(roomId);
  eq([ins, pl.map((p) => [p.seat, p.player_id, p.name, p.user_id])],
    [["ok", "ok", "ok", "ok"], [[0, "p0", "玩家0", U(0)], [1, "p1", "玩家1", U(1)], [2, "p2", "玩家2", U(2)], [3, "p3", "玩家3", null]]],
    "J1 四家入座，讀回來依座位排；登入帳號 user_id 存著（訪客是 null）");
  eq(await T.insertPlayer({ room_id: roomId, player_id: "p9", name: "搶位", seat: 1, user_id: null }), "duplicate", "J2 座位已經有人 → duplicate");
  eq(await T.insertPlayer({ room_id: roomId, player_id: "p1", name: "同一人", seat: 3, user_id: null }), "duplicate", "J3 同一個玩家 id 再坐一次 → duplicate");
  const e = await errOf(T.insertPlayer({ room_id: roomId, player_id: "p8", name: "第五人", seat: 4, user_id: null }));
  eq([e.startsWith("加入十三支房間失敗"), (await T.loadPlayers(roomId)).length], [true, 4], "J4 座位 4 超出 0～3 → 丟錯，房裡還是 4 人");
  const e2 = await errOf(T.insertPlayer({ room_id: "00000000-0000-4000-8000-00000000dead", player_id: "p0", name: "x", seat: 0, user_id: null }));
  eq(e2.startsWith("加入十三支房間失敗"), true, "J5 房間不存在 → 丟錯（外鍵擋下）");
}

// ---------- S 存狀態 ----------
let s = (await T.loadRoom(roomId))!.game_state!;
{
  let seed = 11; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const { hands, rest } = deal(rng);
  const pl = await T.loadPlayers(roomId);
  const deadline = Date.parse("2026-11-16T12:00:45Z");
  s = { ...s, phase: "arranging", handNo: 1, startedAt: "2026-11-16T12:00:00.000Z", arrangeDeadline: deadline, rest,
    players: pl.map((p) => ({ id: p.player_id, name: p.name, seat: p.seat, userId: p.user_id, hand: hands[p.seat], arrangement: null, autoArranged: false })) };
  s.players[2].arrangement = autoArrange(hands[2]); // 2 號已經送出
  const rv0 = Number((await one(`select row_version from th_rooms where id = $1`, [roomId])).row_version);
  const v = await T.saveGameStateIfUnchanged(roomId, 0, s, "playing");
  const back = (await T.loadRoom(roomId))!;
  const g = back.game_state!;
  const rv1 = Number((await one(`select row_version from th_rooms where id = $1`, [roomId])).row_version);
  eq([v, s.stateVersion, back.status, g.stateVersion, g.phase, g.arrangeDeadline, g.settings.arrangeSec],
    [1, 1, "playing", 1, "arranging", deadline, 45], "S1 存狀態：版本 0 → 1、房間改成進行中；理牌截止時間、理牌秒數照存");
  eq([g.players.map((p) => p.hand.map((c) => c.id)), g.rest.map((c) => c.id), new Set([...g.players.flatMap((p) => p.hand), ...g.rest].map((c) => c.id)).size],
    [hands.map((h) => h.map((c) => c.id)), rest.map((c) => c.id), 65], "S2 四家各 13 張手牌、沒發出去的 13 張原樣存回來（65 張不重複）");
  const ids3 = (a: typeof s.players[number]["arrangement"]) => a && [a.front, a.middle, a.back].map((r) => r.map((c) => `${c.id}/${c.suit}${c.rank}`));
  eq([ids3(g.players[2].arrangement), g.players.map((p) => p.arrangement === null)], [ids3(s.players[2].arrangement), [true, true, false, true]],
    "S3 已送出的三墩（頭 3、中 5、尾 5）原樣存回來；還沒送出的是 null");
  eq(rv1 === rv0 + 1, true, "S4 每次存檔 trigger 都把 row_version +1（閒置清房、關房比對用）");

  // 樂觀鎖：兩個請求都讀到版本 1，先存的贏；後存的丟 StateConflictError，不覆蓋
  const a = (await T.loadRoom(roomId))!.game_state!, b = (await T.loadRoom(roomId))!.game_state!;
  a.players[0].arrangement = autoArrange(a.players[0].hand);
  b.players[1].arrangement = autoArrange(b.players[1].hand);
  const va = await T.saveGameStateIfUnchanged(roomId, 1, a);
  let conflict = "";
  try { await T.saveGameStateIfUnchanged(roomId, 1, b); } catch (e) { conflict = e instanceof T.StateConflictError ? "StateConflictError" : String(e); }
  const g2 = (await T.loadRoom(roomId))!.game_state!;
  eq([va, conflict, g2.stateVersion, g2.players[0].arrangement !== null, g2.players[1].arrangement === null, b.stateVersion],
    [2, "StateConflictError", 2, true, true, 1], "S5 樂觀鎖：同時兩個送出都讀到版本 1，先存的成功（版本 2），後存的丟 StateConflictError、沒有蓋掉先存的；失敗的那份版本號不變");
  const stale = await errOf(T.saveGameStateIfUnchanged("00000000-0000-4000-8000-00000000dead", 0, g2));
  eq(stale, "十三支牌局狀態已被其他動作更新", "S6 房間已經不在 → 也是衝突（不會當成成功）");

  // 一局打完：四家都送出 → scoreRound → 每局結果、多局累計
  for (const p of g2.players) if (!p.arrangement) { p.arrangement = autoArrange(p.hand); p.autoArranged = true; }
  const r1 = scoreRound(g2.players.map((p) => p.arrangement!));
  g2.hands.push({ handNo: 1, result: r1 });
  g2.playerScores = g2.playerScores.map((x, i) => x + r1.totals[i]);
  g2.phase = "revealed";
  await T.saveGameStateIfUnchanged(roomId, 2, g2);
  // 第二局（換一副牌）
  const { hands: h2 } = deal(rng);
  const r2 = scoreRound(h2.map((h) => autoArrange(h)));
  g2.hands.push({ handNo: 2, result: r2 });
  g2.playerScores = g2.playerScores.map((x, i) => x + r2.totals[i]);
  g2.handNo = 2;
  await T.saveGameStateIfUnchanged(roomId, 3, g2);
  s = (await T.loadRoom(roomId))!.game_state!;
  eq([s.stateVersion, s.hands.map((h) => h.handNo), s.hands[0].result.totals, s.playerScores, s.playerScores.reduce((x, y) => x + y, 0), s.players.map((p) => p.autoArranged)],
    [4, [1, 2], r1.totals, r1.totals.map((x, i) => x + r2.totals[i]), 0, [false, true, false, true]],
    "S7 每局結果（scoreRound 整包）和多局累計都存得回來，累計四家合計 0；系統自動排的人有標記");
}

// ---------- C 寫對局紀錄＋關房 ----------
{
  const rec = T.buildThirteenRecord(roomId, "5201", s, "completed")!;
  eq([rec.game, rec.handsPlayed, rec.settings, rec.totalRounds, rec.basePoints, rec.fanPoints, rec.players.map((p) => [p.seat, p.playerId, p.userId, p.totalScore])],
    ["thirteen", 2, { arrangeSec: 45, totalHands: 4, baseScore: 1, stats: matchStats(s) }, null, null, null, s.players.map((p) => [p.seat, p.id, p.userId, s.playerScores[p.seat]])],
    "C1 組紀錄：遊戲 thirteen、打了 2 局、理牌秒數、局數、底分（舊房沒設＝1，2026-11-19 起）和整場累計（2026-11-18 起）放 settings（麻將的圈、底、台是 null）、四家總分和帳號");
  const changed = await closeRoom("thirteen", roomId, rec, { stateVersion: 3 });
  eq([changed, (await T.loadRoom(roomId)) !== null, Number((await one(`select count(*)::int n from match_records where room_id = $1`, [roomId])).n)],
    ["changed", true, 0], "C2 關房時版本不對（有人剛存了新的）→ changed，房間和紀錄都沒動");
  const closed = await closeRoom("thirteen", roomId, rec, { stateVersion: 4 });
  const m = await one(`select game, room_code, end_reason, hands_played, settings - 'stats' settings, total_rounds, jsonb_array_length(settings->'stats') nstats from match_records where room_id = $1`, [roomId]);
  const mp = await rows(`select seat, player_name, player_id, total_score, user_id from match_record_players p join match_records r on r.id = p.match_id where r.room_id = $1 order by seat`, [roomId]);
  eq([closed, m, mp.map((x) => [x.seat, x.player_id, x.total_score, x.user_id])],
    ["closed", { game: "thirteen", room_code: "5201", end_reason: "completed", hands_played: 2, settings: { baseScore: 1, arrangeSec: 45, totalHands: 4 }, total_rounds: null, nstats: 4 },
      s.players.map((p) => [p.seat, p.id, s.playerScores[p.seat], p.userId])],
    "C3 版本對 → closed：同一個交易寫進對局紀錄（十三支、2 局、設定、四家總分和帳號）");
  const left = await one(`select (select count(*)::int from th_rooms where id = $1) r, (select count(*)::int from th_players where room_id = $1) p`, [roomId]);
  eq([left, await T.loadRoom(roomId)], [{ r: 0, p: 0 }, null], "C4 關房後房間刪掉，四個座位跟著刪（cascade）");
  eq([await closeRoom("thirteen", roomId, rec, { stateVersion: 4 }), Number((await one(`select count(*)::int n from match_records where room_id = $1`, [roomId])).n)],
    ["already_closed", 1], "C5 重送 → already_closed，不會多寫一筆");
  eq(await closeRoom("thirteen", "00000000-0000-4000-8000-00000000dead", null, {}), "not_found", "C6 不存在的房間 → not_found");
  // 一局都沒打完就解散：不記紀錄，只關房
  const empty = await T.loadRoomByCode("5300");
  const none = T.buildThirteenRecord(empty!.id, "5300", empty!.game_state!, "dissolved");
  eq([none, await closeRoom("thirteen", empty!.id, none, { stateVersion: 0 }), await T.loadRoomByCode("5300"),
    Number((await one(`select count(*)::int n from match_records where room_id = $1`, [empty!.id])).n)],
    [null, "closed", null, 0], "C7 一局都沒打完就解散：buildThirteenRecord 回 null，只關房、不寫紀錄");
  const sent = reqLog.map((r) => `${r.method} ${r.path.split("?")[0]}`);
  eq([sent.includes("POST rpc/close_room_with_record"), sent.includes("PATCH th_rooms"), sent.includes("POST th_players")], [true, true, true],
    "C8 以上都是真的 supabase-js 組出來的請求（存狀態、入座、關房 rpc）打進跑過 migration 的資料庫");
}

// ---------- O 麻將、大老二照舊 ----------
{
  const mj = (await one(`insert into mj_rooms (code, status, game_state) values ('7001', 'playing', '{"stateVersion": 5}') returning id`)).id as string;
  await db.query(`insert into mj_players (room_id, player_id, name, seat) values ($1, 'm0', '麻將', 0)`, [mj]);
  const b2 = (await one(`insert into big2_rooms (code, status) values ('7002', 'playing') returning id`)).id as string;
  const rec = (game: "mahjong" | "big2", id: string, code: string) => ({ game, roomId: id, roomCode: code, startedAt: null, endReason: "completed" as const,
    totalRounds: game === "mahjong" ? 1 : null, basePoints: null, fanPoints: null, settings: {}, handsPlayed: 1,
    players: [{ seat: 0, playerName: "A", playerId: "m0", userId: null, totalScore: 3 }] });
  const r1 = await closeRoom("mahjong", mj, rec("mahjong", mj, "7001"), { stateVersion: 4 });
  const r2 = await closeRoom("mahjong", mj, rec("mahjong", mj, "7001"), { stateVersion: 5 });
  const r3 = await closeRoom("big2", b2, rec("big2", b2, "7002"), {});
  const games = await rows(`select game, room_code from match_records where room_id in ($1, $2) order by game`, [mj, b2]);
  const gone = await one(`select (select count(*)::int from mj_rooms where id = $1) mj, (select count(*)::int from mj_players where room_id = $1) mp, (select count(*)::int from big2_rooms where id = $2) b2`, [mj, b2]);
  eq([r1, r2, r3, games, gone], ["changed", "closed", "closed", [{ game: "big2", room_code: "7002" }, { game: "mahjong", room_code: "7001" }], { mj: 0, mp: 0, b2: 0 }],
    "O1 麻將：版本不對 changed、對了 closed 並連座位刪掉；大老二 closed；兩邊的紀錄照樣寫進去");
  const unknown = await as("service_role", () => rows(`select close_room_with_record('poker', gen_random_uuid())`));
  eq(String(unknown).includes("unknown game poker"), true, "O2 不認得的遊戲照樣丟錯");
}

// ---------- 程式碼：十三支 db 層只用伺服器金鑰 ----------
{
  const src = readFileSync(path.join(ROOT, "lib/thirteen/db.ts"), "utf8");
  eq([/getSupabaseAdmin/.test(src), /getSupabase(Server)?\(\)/.test(src), /from\(\s*["'`]mj_/.test(src)], [true, false, false],
    "P1 lib/thirteen/db.ts 只用 getSupabaseAdmin（service role），也不碰麻將的表");
}

// ---------- B 回滾 ----------
{
  await db.query(`insert into th_rooms (code) values ('5999')`);
  const blocked = await runSql(RB);
  const still = await one(`select to_regclass('public.th_rooms')::text t, (select count(*)::int from match_records where game = 'thirteen') n`);
  eq([blocked.includes("還有十三支房間"), still], [true, { t: "th_rooms", n: 1 }], "B1 還有十三支房間時回滾整份拒絕，表和紀錄都還在");
  await db.query(`delete from th_rooms`);
  const blocked2 = await runSql(RB);
  eq(blocked2.includes("已經有十三支對局紀錄"), true, "B2 已經有十三支對局紀錄時回滾也拒絕（不默默刪掉玩家戰績）");
  await db.query(`delete from match_records where game = 'thirteen'`);
  const ok = await runSql(RB);
  const after = { src: await fnSrc(), acl: await fnAcl(), check: await gameCheck(), structure: await structure() };
  const tables = await one(`select to_regclass('public.th_rooms') r, to_regclass('public.th_players') p`);
  eq([ok, after.src === before.src, after.acl === before.acl, after.check === before.check, JSON.stringify(after.structure) === JSON.stringify(before.structure), tables],
    ["ok", true, true, true, true, { r: null, p: null }], "B3 清掉十三支資料後回滾成功：關房函式、權限、遊戲種類限制、麻將和大老二的表都回到套用前，新表刪掉");
  const re = await runSql(MIG);
  eq([re, await gameCheck()], ["ok", "CHECK ((game = ANY (ARRAY['mahjong'::text, 'big2'::text, 'thirteen'::text])))"], "B4 回滾後可以再套用一次");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
