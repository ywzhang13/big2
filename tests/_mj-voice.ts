// 麻將牌桌配音（老闆 2026-11-26）：打牌唸牌名；吃、碰、槓、胡、自摸唸動作
//   V1 素材：34 種牌＋5 個動作共 39 個檔都在 public/mahjong-fx/voice、檔名有版本號、都登記在 scripts/immutable-assets.json
//   V2 牌 → 檔名：萬筒條 1～9、東南西北中發白；花牌、看不到的牌不唸
//   V3 事件 → 要唸什麼：剛進房（沒有上一個狀態）不唸；新打出的牌唸牌名、同一張不重唸；吃、碰、明槓、暗槓、加槓；
//      放槍胡唸「胡」、自摸唸「自摸」、一炮多響只唸一次；打牌和碰在同一次更新裡照順序
//   V4 排隊：一次一句；播的時候再來的只留最新一句（新的取代排著的）；播完接著播排著的
//   V5 播放（真的 engine.ts，假的 AudioContext）：預載 39 個檔；音量 0（互動音效靜音）不唸；音量照設定；排隊時不會疊在一起
//   V6 玩家畫面、觀戰畫面都有接上
// 審伯初審必修（2026-11-26）：
//   R1 流局（winner seat −1 佔位）不唸胡：winner 回退欄位、winners 空陣列兩種
//   R2 一炮多響分次到達只唸一次胡：一家 → 三家、兩響換座位、廣播輪詢交錯；自摸一次；下一局重新唸
//   R3 配音預載排在牌面後面：畫面上的牌面還沒載完時 0 個語音請求，載完才下載；重複呼叫共用同一筆
//   R4 reset（換房、換局、離開）：播放中離開不接候播句、等音訊叫醒時離開不會開始播、馬上重進新句照播、舊的晚回來不影響新的；hook 卸載有清
//   R5 onended 沒來、音訊時鐘停住（鎖屏／中斷）：牆鐘超時也不放下一句；時鐘走過才先停掉舊的再播下一句；同時最多 1 個配音在播
import { existsSync, readFileSync } from "node:fs";
import { installFakeDom } from "./support/fake-dom";

const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 一段檢查丟例外就記成 ❌（修改前的程式沒有新的介面時，各項分別紅，不會整支停掉） */
async function section(name: string, f: () => Promise<void>) { try { await f(); } catch (e) { results.push(`❌ ${name} 例外：${(e as Error).message}`); } }

// 假的 fetch／AudioContext：解碼後的 buffer 記得是哪個檔；記下每一句什麼時候開始、什麼時候結束、經過哪個音量節點
const nameOf = new WeakMap<ArrayBuffer, string>();
const fetched: string[] = [];
installFakeDom({
  fetch: async (url: string) => {
    fetched.push(String(url));
    return { ok: true, blob: async () => new Blob(["x"]), text: async () => "{}",
      arrayBuffer: async () => { const ab = new ArrayBuffer(8); nameOf.set(ab, String(url)); return ab; } };
  },
});
type Played = { url: string; start: number; end: number | null; stopped?: boolean };
const played: Played[] = [];
let noEnded = false; // R5：模擬音訊被中斷，onended 不會來
let active = 0, maxActive = 0;
const node = () => ({ connect: (x: unknown) => x });
const param = (value = 0) => ({ value, setTargetAtTime(v: number) { this.value = v; } });
const made: { gain: { value: number } }[] = [];
const masterGainValue = () => made[0]?.gain.value; // 第一個建出來的音量節點＝總音量（engine.ts ensureAudio）
class FakeAC {
  state = "running"; destination = node(); currentTime = 0;
  static made: FakeAC[] = [];
  constructor() { FakeAC.made.push(this); }
  resume() { return Promise.resolve(); }
  createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
  createGain() { const g = { ...node(), gain: param(1) }; made.push(g); return g; }
  async decodeAudioData(ab: ArrayBuffer) { return { url: nameOf.get(ab) ?? "?", duration: 0.06 }; }
  createBufferSource() {
    const s = { buffer: null as null | { url: string; duration: number }, onended: null as null | (() => void), playbackRate: param(1),
      connect: (x: unknown) => x,
      rec: null as Played | null,
      start() { const rec: Played = { url: s.buffer!.url, start: Date.now(), end: null }; s.rec = rec; played.push(rec); active++; maxActive = Math.max(maxActive, active);
        if (!noEnded) setTimeout(() => { if (rec.end === null) { rec.end = Date.now(); active--; } s.onended?.(); }, s.buffer!.duration * 1000); },
      stop() { const rec = s.rec; if (rec && rec.end === null) { rec.end = Date.now(); rec.stopped = true; active--; } } };
    return s;
  }
}
(globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAC;

const V = await import("../lib/mahjong/tableVoice");
const E = await import("../lib/mahjong/fx/engine");
type Snap = import("../lib/mahjong/tableVoice").VoiceSnapshot;

// V1
{
  const files = V.ALL_VOICE_KEYS.map((k) => `public${V.voiceUrl(k)}`);
  const reg = JSON.parse(readFileSync("scripts/immutable-assets.json", "utf8")) as Record<string, unknown>;
  const regKeys = new Set(Object.keys((reg as { files?: Record<string, unknown> }).files ?? reg));
  const inReg = (f: string) => regKeys.has(f) || regKeys.has(f.replace(/^public\//, "")) || regKeys.has(f.replace(/^public/, ""));
  ok(V.ALL_VOICE_KEYS.length === 39 && new Set(V.ALL_VOICE_KEYS).size === 39 && files.every(existsSync) && files.every((f) => /\.v\d+\.mp3$/.test(f)) && files.every(inReg),
    `V1 素材：39 個檔（34 種牌＋5 個動作）都在、檔名有版本號、都登記在雜湊清單（缺 ${files.filter((f) => !existsSync(f)).length}、沒登記 ${files.filter((f) => !inReg(f)).length}）`);
}
// V2
{
  const k = (suit: string, rank: number) => V.tileVoiceKey({ suit, rank });
  const got = [k("m", 2), k("p", 9), k("s", 1), k("z", 1), k("z", 4), k("z", 5), k("z", 7), k("f", 3), k("z", 0), V.tileVoiceKey(null)];
  ok(JSON.stringify(got) === JSON.stringify(["m2", "p9", "s1", "z1", "z4", "z5", "z7", null, null, null]) && V.voiceUrl("m2") === "/mahjong-fx/voice/mjv-m2.v1.mp3",
    `V2 牌 → 檔名：二萬 m2、九筒 p9、一條 s1、東 z1、北 z4、中 z5、白 z7；花牌、看不到的牌不唸（${JSON.stringify(got)}）`);
}
// V3
{
  const t = (id: number, suit: string, rank: number) => ({ id, suit, rank });
  const base = (): Snap => ({ focusDiscard: null, melds: [[], [], [], []], winners: [] });
  const s1 = { ...base(), focusDiscard: { tile: t(10, "m", 3), from: 0 } };
  const s2 = { ...s1, melds: [[], [{ type: "pong" as const }], [], []] };
  const s3 = { ...s2, focusDiscard: { tile: t(11, "z", 5), from: 1 } };
  const s4 = { ...s3, melds: [[], [{ type: "kong" as const }], [], []] };               // 碰變槓（加槓）
  const s5 = { ...s4, melds: [[{ type: "chi" as const }], [{ type: "kong" as const }], [], []] };
  const s6 = { ...s5, melds: [[{ type: "chi" as const }], [{ type: "kong" as const }], [{ type: "concealed_kong" as const }], []] };
  const hu = { ...s6, winners: [{ seat: 2, from: 1 }] };
  const hu2 = { ...s6, winners: [{ seat: 2, from: 1 }, { seat: 3, from: 1 }] };
  const zimo = { ...s6, winners: [{ seat: 0, from: null }] };
  const both = { ...s1, focusDiscard: { tile: t(12, "s", 7), from: 2 }, melds: [[], [], [], [{ type: "pong" as const }]] };
  const got = {
    join: V.voiceEvents(null, s1), discard: V.voiceEvents(base(), s1), same: V.voiceEvents(s1, s1), pong: V.voiceEvents(s1, s2),
    next: V.voiceEvents(s2, s3), addKong: V.voiceEvents(s3, s4), chi: V.voiceEvents(s4, s5), ckong: V.voiceEvents(s5, s6),
    hu: V.voiceEvents(s6, hu), multi: V.voiceEvents(s6, hu2), multiAgain: V.voiceEvents(hu2, hu2), zimo: V.voiceEvents(s6, zimo),
    both: V.voiceEvents(s1, both), flower: V.voiceEvents(base(), { ...base(), focusDiscard: { tile: t(140, "f", 1), from: 0 } }),
  };
  const want = { join: [], discard: ["m3"], same: [], pong: ["pong"], next: ["z5"], addKong: ["kong"], chi: ["chi"], ckong: ["kong"],
    hu: ["hu"], multi: ["hu"], multiAgain: [], zimo: ["zimo"], both: ["s7", "pong"], flower: [] };
  ok(JSON.stringify(got) === JSON.stringify(want),
    `V3 事件 → 要唸什麼：剛進房不唸、新牌唸牌名、同一張不重唸、碰、加槓、吃、暗槓、放槍「胡」、一炮多響只唸一次、自摸、打牌和碰同一次更新照順序、花牌不唸\n   實際=${JSON.stringify(got)}`);
  const snap = V.voiceSnapshotOf({ status: "finished", focusDiscard: { tile: t(1, "m", 1), from: 0 }, players: [{ revealed: [{ type: "pong" }] }, {}], winner: { seat: 1, from: null } });
  ok(V.voiceSnapshotOf({ status: "waiting", players: [] }) === null && snap?.focusDiscard === null && snap.melds[1].length === 0 && snap.winners[0].from === null,
    "V3b 狀態轉換：等人不唸；結束時不看中間那張牌；沒有 winners 時用 winner");
}
// R3（要在 V5 預載之前跑：預載整個模組只有一筆）
await section("R3", async () => {
  const img = { complete: false, loading: "eager" };
  (globalThis.document as unknown as { images: unknown[] }).images = [img];
  const t0 = Date.now();
  const p1 = E.preloadVoice(), p2 = E.preloadVoice();
  await sleep(900);
  const voiceBefore = fetched.filter((u) => u.includes("/mahjong-fx/voice/")).length;
  img.complete = true;
  const tOpen = Date.now() - t0;
  await p1;
  const voiceAfter = fetched.filter((u) => u.includes("/mahjong-fx/voice/")).length;
  ok(p1 === p2 && voiceBefore === 0 && voiceAfter === 39,
    `R3 牌面還沒載完時語音請求 ${voiceBefore} 個（等了 ${tOpen}ms）；牌面載完後才下載 ${voiceAfter} 個；重複呼叫共用同一筆（${p1 === p2}）`);
  (globalThis.document as unknown as { images: unknown[] }).images = [];
});
// V4
{
  const log: string[] = [];
  const waits: (() => void)[] = [];
  const q = V.createVoiceQueue((k) => { log.push(`start ${k}`); return { done: new Promise<number>((r) => waits.push(() => { log.push(`end ${k}`); r(1); })), stop: () => {} }; });
  q.push(["m3"]); q.push(["pong"]); q.push(["m4", "m5"]);
  const mid = q.state();
  waits.shift()!(); await sleep(0);
  waits.shift()!(); await sleep(0);
  ok(JSON.stringify(log) === JSON.stringify(["start m3", "end m3", "start m5", "end m5"]) && mid.playing && mid.pending === "m5" && !q.state().playing,
    `V4 排隊：一次一句；播的時候再來的只留最新的（m3 播完接 m5，pong、m4 被取代）（${log.join("、")}）`);
}
// V5
{
  E.setFxVolume(1);
  await E.preloadVoice();
  const all = V.ALL_VOICE_KEYS.every((k) => fetched.includes(V.voiceUrl(k)));
  played.length = 0;
  E.setFxVolume(0);
  const r0 = await E.playVoice("m3").done;
  const mutedNone = r0 === 0 && played.length === 0;
  E.setFxVolume(0.5);
  const r1 = await E.playVoice("pong").done;
  const halfVol = masterGainValue() === 0.5;
  ok(all && mutedNone && r1 === 60 && played.length === 1 && played[0].url.endsWith("mjv-pong.v1.mp3") && halfVol,
    `V5a 預載 39 個檔（${all}）；互動音效靜音（音量 0）不唸（${mutedNone}）；開著時唸、走同一個音量（一半＝${masterGainValue()}）`);
  played.length = 0;
  E.setFxVolume(1);
  const q = V.createVoiceQueue(E.playVoice);
  q.push(["m3"]); q.push(["pong"]);
  await sleep(250);
  const [a, b] = played;
  ok(played.length === 2 && !!a && !!b && a.url.endsWith("mjv-m3.v1.mp3") && b.url.endsWith("mjv-pong.v1.mp3") && a.end !== null && b.start >= a.end,
    `V5b 打牌「三萬」後馬上碰：先唸完三萬才唸碰，不會疊在一起（${played.map((p) => p.url.split("/").pop()).join(" → ")}）`);
}
// R1
await section("R1", async () => {
  const t = (id: number, suit: string, rank: number) => ({ id, suit, rank });
  const playing = { status: "playing", focusDiscard: { tile: t(5, "m", 9), from: 1 }, players: [{}, {}, {}, {}] };
  const tr1 = V.createVoiceTracker(), tr2 = V.createVoiceTracker();
  tr1.next(V.voiceSnapshotOf(playing)!); tr2.next(V.voiceSnapshotOf(playing)!);
  const a = tr1.next(V.voiceSnapshotOf({ status: "finished", players: [{}, {}, {}, {}], winner: { seat: -1, from: null } })!);          // 玩家畫面：winner 回退
  const b = tr2.next(V.voiceSnapshotOf({ status: "finished", players: [{}, {}, {}, {}], winners: [], winner: { seat: -1 } })!);       // 觀戰：winners 空陣列
  const c = V.voiceEvents(V.voiceSnapshotOf(playing), V.voiceSnapshotOf({ status: "finished", players: [{}, {}, {}, {}], winner: { seat: 2, from: 1 } })!);
  ok(a.length === 0 && b.length === 0 && JSON.stringify(c) === '["hu"]', `R1 流局（seat −1 佔位）不唸：winner 回退 ${JSON.stringify(a)}、winners 空陣列 ${JSON.stringify(b)}；正常放槍胡照唸 ${JSON.stringify(c)}`);
});
// R2
await section("R2", async () => {
  const base = (): Snap => ({ focusDiscard: null, melds: [[], [], [], []], winners: [] });
  const w = (...ws: [number, number | null][]) => ({ ...base(), winners: ws.map(([seat, from]) => ({ seat, from })) });
  const run = (seq: Snap[]) => { const tr = V.createVoiceTracker(); return seq.flatMap((x) => tr.next(x)).filter((k) => k === "hu" || k === "zimo"); };
  const got = {
    分三次: run([base(), w([1, 0]), w([1, 0], [2, 0]), w([1, 0], [2, 0], [3, 0])]),
    一次三家: run([base(), w([1, 0], [2, 0], [3, 0])]),
    換座位: run([base(), w([2, 0]), w([3, 0])]),
    交錯: run([base(), w([1, 0]), base(), w([1, 0], [3, 0])]),
    自摸: run([base(), w([2, null]), w([2, null])]),
    進房已有贏家: run([w([1, 0]), w([1, 0], [2, 0])]),
  };
  const nextHand = V.createVoiceTracker(); nextHand.next(base());
  const again = nextHand.next(w([0, 3]));
  ok(JSON.stringify(got) === JSON.stringify({ 分三次: ["hu"], 一次三家: ["hu"], 換座位: ["hu"], 交錯: ["hu"], 自摸: ["zimo"], 進房已有贏家: [] }) && JSON.stringify(again) === '["hu"]',
    `R2 一局胡最多唸一次：${JSON.stringify(got)}；下一局重新唸 ${JSON.stringify(again)}`);
});
// R4
await section("R4", async () => {
  type H = { k: string; stopped: boolean; release: () => void };
  const hs: H[] = [];
  const started: string[] = [];
  const q = V.createVoiceQueue((k) => { started.push(k); let r!: (n: number) => void; const h: H = { k, stopped: false, release: () => r(1) };
    hs.push(h); return { done: new Promise<number>((res) => { r = res; }), stop: () => { h.stopped = true; } }; });
  q.push(["m1"]); q.push(["pong"]);
  q.reset();                       // 播放中離開
  hs[0].release(); await sleep(0);
  const a = started.join() === "m1" && hs[0].stopped && !q.state().playing && q.state().pending === null;
  q.push(["m2"]);                  // 馬上重進：新的照播
  const b = started.join() === "m1,m2" && q.state().playing;
  q.push(["p3"]); q.reset(); q.push(["s4"]);   // 舊的 m2 還沒結束就再換房，新的 s4 馬上播
  hs[1].release(); await sleep(0);              // 舊的 m2 晚回來
  const c = started.join() === "m1,m2,s4" && q.state().playing && hs[1].stopped;
  hs[2].release(); await sleep(0);
  const d = started.join() === "m1,m2,s4" && !q.state().playing;
  // 真的 engine：等音訊叫醒時被取消，不會開始播
  played.length = 0;
  FakeAC.made[0].state = "suspended";
  FakeAC.made[0].resume = () => { setTimeout(() => { FakeAC.made[0].state = "running"; }, 100); return Promise.resolve(); };
  const pb = E.playVoice("m1");
  await sleep(20); pb.stop();
  const ms = await pb.done; await sleep(400);
  const e = ms === 0 && played.length === 0;
  FakeAC.made[0].state = "running"; FakeAC.made[0].resume = () => Promise.resolve();
  const hook = readFileSync("hooks/useTableSounds.ts", "utf8");
  const f = /useEffect\(\(\) => \(\) => queue\.reset\(\), \[queue\]\)/.test(hook) && /track\.current\.scope !== scope\) \{ queue\.reset\(\)/.test(hook);
  ok(a && b && c && d && e && f, `R4 離開清乾淨：播放中離開不接候播（${a}）、馬上重進照播（${b}）、舊的晚回來不影響新的（${c}${d}）、等叫醒時離開不播（${e}）、hook 換局和卸載都會 reset（${f}）`);
});
// R5
await section("R5", async () => {
  played.length = 0; active = 0; maxActive = 0;
  noEnded = true; FakeAC.made[0].currentTime = 100;
  const q = V.createVoiceQueue(E.playVoice);
  q.push(["m1"]); q.push(["pong"]);
  await sleep(800);                                 // 牆鐘早就過了 60ms＋300ms，但音訊時鐘停在 100（鎖屏、中斷）
  const held = played.length === 1 && q.state().playing && q.state().pending === "pong";
  FakeAC.made[0].currentTime = 101;                            // 恢復、時鐘走過
  await sleep(400);
  const [m1, pong] = played;
  const handed = played.length === 2 && !!m1?.stopped && !!pong && pong.start >= (m1.end ?? Infinity);
  FakeAC.made[0].currentTime = 102; await sleep(400);
  noEnded = false; FakeAC.made[0].currentTime = 0;
  ok(held && handed && maxActive === 1, `R5 時鐘停住時牆鐘超時也不放下一句（${held}）；時鐘走過才先停掉三萬再唸碰（${handed}）；同時在播最多 ${maxActive} 個`);
});
// V6
{
  const page = readFileSync("app/mahjong/page.tsx", "utf8"), watch = readFileSync("app/mahjong/watch/page.tsx", "utf8");
  ok([page, watch].every((s) => /useTableVoice\(\{[^\n]*snap: voiceSnapshotOf\(/.test(s)), "V6 玩家畫面、觀戰畫面都接上配音（useTableVoice＋voiceSnapshotOf）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
