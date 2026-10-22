// 牌桌音效（老闆 2026-10-22 選定：出牌聲 Q1、提醒聲 B2「滴滴」；提醒 6 秒（同日從 8 秒改））：
//   R  提醒聲計時：輪到自己要打牌 6 秒響第 1 次，之後每 6 秒，最多 3 次；各種情況停掉並歸零（假時鐘）
//   S  什麼時候算「輪到自己要打牌」：打出去了、輪到別人（含等自己決定吃碰胡別人的牌）、結算、離開房間都不算；
//      切到別的分頁照樣算（老闆 2026-10-22：切換分頁就沒有滴滴），切回來不補響、不從頭算；
//      輪到自己時有自摸、暗槓、加槓、眼牌按鈕照樣算（老闆 2026-10-22 電腦版沒聽到滴滴聲：伺服器送來這些按鈕後計時 0.5 秒就被停掉）
//   D  出牌聲：四家任何一家打出一張牌都響一次；同一張牌的重複更新、剛進房看到的那張、沒有牌時都不響
//   E  出聲：走互動音效的音量和靜音；出牌聲只用一個樣本（每次同一聲）；提醒聲只用 turn-remind；
//      iPhone 音訊被暫停或打斷時先叫醒再播，叫不醒就回報沒出聲（老闆 2026-10-22：沒聽到滴滴聲）
import { el, installFakeDom } from "./support/fake-dom";
import { REMIND_MAX, REMIND_MS, createDiscardWatcher, createTurnReminder, discardKey, remindActive } from "../lib/mahjong/tableSound";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

// ---- 假時鐘 ----
let now = 0;
let timers: { at: number; f: () => void; id: number }[] = [];
let nid = 1;
const clock = {
  setTimeout: (f: () => void, ms: number) => { const id = nid++; timers.push({ at: now + ms, f, id }); return id as unknown as ReturnType<typeof setTimeout>; },
  clearTimeout: (t: ReturnType<typeof setTimeout>) => { timers = timers.filter((x) => x.id !== (t as unknown as number)); },
};
const advance = (ms: number) => {
  const end = now + ms;
  for (;;) {
    const next = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    timers = timers.filter((x) => x !== next);
    now = next.at;
    next.f();
  }
  now = end;
};

// ---------- R 提醒聲計時 ----------
{
  const at: number[] = [];
  const r = createTurnReminder(() => at.push(now), clock);
  now = 0; timers = [];
  r.set(true);
  advance(REMIND_MS - 1);
  ok(at.length === 0, "R1 輪到自己要打牌，未滿 6 秒不響");
  advance(1);
  ok(at.join() === "6000", `R2 滿 6 秒響第 1 次（${at.join("、")}ms）`);
  advance(REMIND_MS * 5);
  ok(at.join() === "6000,12000,18000" && REMIND_MAX === 3, `R3 之後每 6 秒再響，最多 3 次就不再響（${at.join("、")}ms，再等 40 秒也沒有第 4 次）`);
  ok(!r.state().pending && r.state().count === 3, "R4 響完 3 次後沒有計時器在跑");
  r.set(false);
  ok(r.state().count === 0 && !r.state().active, "R5 打出牌（不再輪到自己）：停掉、次數歸零");
}
{
  const at: number[] = [];
  const r = createTurnReminder(() => at.push(now), clock);
  now = 0; timers = [];
  r.set(true); advance(5999); r.set(false); advance(30000);
  ok(at.length === 0 && !r.state().pending, "R6 6 秒內打出牌：一次都不響，計時器清掉");
  const t0 = now;
  r.set(true); advance(6000);
  ok(at.length === 1 && at[0] - t0 === 6000, `R7 下一次輪到自己：重新從 0 算 6 秒（第 1 響在重新開始後 ${at[0] - t0}ms）`);
}
{
  // 響過 2 次後中斷（例如換局），再回來：重新算、又可以響 3 次
  const at: number[] = [];
  const r = createTurnReminder(() => at.push(now), clock);
  now = 0; timers = [];
  r.set(true); advance(12000);
  ok(at.length === 2, "R8 響了 2 次（12 秒）");
  r.set(false); advance(5000); const t0 = now;
  r.set(true); advance(18000);
  const again = at.slice(2).map((x) => x - t0);
  ok(at.length === 5 && again.join() === "6000,12000,18000", `R9 中斷後再輪到自己：重新計時，又是 6／12／18 秒各響一次（${again.join("、")}ms）`);
  r.set(true); advance(30000);
  ok(at.length === 5, "R10 狀態沒變（重複 set(true)）不會重新開始，也不會多響");
}

// ---------- S 什麼時候算「輪到自己要打牌」 ----------
{
  const base = { needsDiscard: true, status: "playing", inRoom: true };
  ok(remindActive(base), "S1 輪到自己要打牌、在打牌、在房間：計時");
  const cases: [string, Partial<typeof base>][] = [
    ["打出牌後／輪到別人（needsDiscard＝false）", { needsDiscard: false }],
    ["別人打牌、自己在決定吃碰胡（needsDiscard＝false）", { needsDiscard: false }],
    ["結算畫面（status＝finished）", { status: "finished" }],
    ["等待開局（status＝waiting）", { status: "waiting" }],
    ["離開牌桌（不在房間）", { inRoom: false }],
  ];
  for (const [label, patch] of cases) ok(!remindActive({ ...base, ...patch }), `S2 ${label}：不計時`);
  // 接到計時器上：任何一種情況出現就停掉歸零
  for (const [label, patch] of cases) {
    const at: number[] = [];
    const r = createTurnReminder(() => at.push(now), clock);
    now = 0; timers = [];
    r.set(remindActive(base)); advance(6000);
    r.set(remindActive({ ...base, ...patch })); advance(40000);
    ok(at.length === 1 && r.state().count === 0 && !r.state().pending, `S3 響過 1 次後「${label}」：停掉、不再響、次數歸零`);
  }
  // 輪到自己、伺服器接著送來自己回合的按鈕：牌桌上 needsDiscard 一直是 true，計時不能被打斷
  for (const btn of ["declare_eye（眼牌）", "kong（暗槓）", "add_kong（加槓）", "win（自摸）"]) {
    const at: number[] = [];
    const r = createTurnReminder(() => at.push(now), clock);
    now = 0; timers = [];
    // 0 秒輪到自己（還沒有按鈕）；0.5 秒伺服器送來按鈕；之後按鈕一直在
    const table = (buttons: string[]) => ({ needsDiscard: true, status: "playing", availableActions: buttons });
    const feed = (t: ReturnType<typeof table>) => r.set(remindActive({ needsDiscard: t.needsDiscard, status: t.status, inRoom: true }));
    feed(table([])); advance(500);
    feed(table([btn])); advance(29500);
    ok(at.join() === "6000,12000,18000", `S4 輪到自己、有 ${btn} 按鈕：照樣在 6／12／18 秒響，第 4 次不響（${at.join("、")}ms）`);
  }
}

// ---------- S5 切到別的分頁 ----------
{
  // 畫面在不在前景不影響要不要計時（remindActive 根本不看）：模擬 4 秒切走、15 秒切回來，計時器一直沒被重設
  const at: number[] = [];
  const r = createTurnReminder(() => at.push(now), clock);
  now = 0; timers = [];
  const env = { needsDiscard: true, status: "playing", inRoom: true };
  r.set(remindActive(env)); advance(4000);
  r.set(remindActive(env)); advance(11000); // 切到別的分頁（4～15 秒）
  r.set(remindActive(env)); advance(15000); // 切回來
  ok(at.join() === "6000,12000,18000", `S5 第 4 秒切到別的分頁、第 15 秒切回來：照樣在 6／12／18 秒響（${at.join("、")}ms），切回來不補響、不從頭算`);
}

// ---------- D 出牌聲 ----------
{
  let n = 0;
  const w = createDiscardWatcher(() => n++);
  const k = (from: number, id: number) => discardKey({ tile: { id }, from });
  w.update(k(2, 40));
  ok(n === 0, "D1 剛進房看到的那張（別人之前打的）只記下，不響");
  for (const [seat, id] of [[0, 11], [1, 12], [2, 13], [3, 14]]) w.update(k(seat, id));
  ok(n === 4, `D2 四家（座位 0～3）各打出一張：響 4 次（${n}）`);
  w.update(k(3, 14)); w.update(k(3, 14));
  ok(n === 4, "D3 同一張牌的重複更新（自己先畫、伺服器廣播再到、重新同步）不重響");
  w.update(null);
  ok(n === 4, "D4 牌被吃碰走、換局（沒有那張牌）：不響");
  w.update(k(1, 14));
  ok(n === 5, "D5 下一局同一個 id 的牌再被打出（id 每局重用）：照樣響");
  w.reset(); w.update(k(0, 99));
  ok(n === 5, "D6 換房後看到的第一張只記下，不響");
  w.update(k(1, 100));
  ok(n === 6, "D7 換房後再有人打牌：照常響");
  ok(discardKey(null) === null && discardKey({ tile: { id: 7 }, from: 2 }) === "2:7", "D8 比對用的 key＝座位＋牌的 id");
}

// ---------- E 出聲：互動音效音量、靜音 ----------
installFakeDom();
type Played = { name: string; vol: number };
const played: Played[] = [];
const nameOf = new WeakMap<ArrayBuffer, string>();
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true, blob: async () => new Blob(["x"]), text: async () => JSON.stringify({ w: 700, h: 525, fr: 30, op: 121 }),
  arrayBuffer: async () => { const ab = new ArrayBuffer(8); nameOf.set(ab, String(url).replace(/^.*\/s\/|\.mp3$/g, "")); return ab; },
});
const param = (value = 0) => ({ value, setTargetAtTime(v: number) { this.value = v; } });
const node = () => ({ connect: (x: unknown) => x });
// 假的 AudioContext：state 可以設成 suspended／interrupted（iPhone 沒解鎖、切回前景），resume 可以設成叫得醒或叫不醒
let resumable = true, resumeCalls = 0;
class FakeAC {
  currentTime = 0; state = "running"; destination = node();
  resume() { resumeCalls++; if (resumable) this.state = "running"; return Promise.resolve(); }
  createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
  createGain() { return { ...node(), gain: param(1) }; }
  async decodeAudioData(ab: ArrayBuffer) { return { name: nameOf.get(ab) ?? "?" }; }
  createBufferSource() {
    const s = { buffer: null as { name: string } | null, g: null as null | { gain: { value: number } }, playbackRate: param(1),
      connect(g: { gain: { value: number } }) { s.g = g; return g; },
      start() { played.push({ name: s.buffer?.name ?? "?", vol: +(s.g?.gain.value ?? 0).toFixed(3) }); }, stop() {} };
    return s;
  }
}
let theAC: FakeAC | null = null;
(globalThis as unknown as { AudioContext: unknown }).AudioContext = function () { theAC = new FakeAC(); return theAC; };
const E = await import("../lib/mahjong/fx/engine");
ok(!(await E.playTableSound("tile")).played, "E1 音效還沒載好：不出聲（played＝false），也不會出錯");
ok(await E.preloadFx(), "E2 預載完成（含 tile、turn-remind）");
E.setFxLayer(el() as unknown as HTMLElement);
for (let i = 0; i < 4; i++) await E.playTableSound("tile");
ok(played.length === 4 && played.every((p) => p.name === "tile" && p.vol === 0.726), `E3 出牌聲只用一個樣本：連打 4 張都是同一聲、同樣音量（${played.map((p) => `${p.name} ${p.vol}`).join("、")}）`);
played.length = 0;
const r5 = await E.playTableSound("remind");
ok(r5.played && r5.ac === "running" && played.map((p) => `${p.name} ${p.vol}`).join() === "turn-remind 1", "E4 提醒聲播 turn-remind，音量 1");
played.length = 0;
E.setFxVolume(0);
ok(!(await E.playTableSound("tile")).played && !(await E.playTableSound("remind")).played && played.length === 0, "E5 互動音效靜音：出牌聲、提醒聲都不出聲");
E.setFxVolume(0.5);
ok((await E.playTableSound("tile")).played && E.getFxVolume() === 0.5, "E6 互動音效調成一半：照樣出聲，經過互動音效總音量（0.5）");
E.setFxVolume(1);
// iPhone：音訊被暫停（沒經過點擊解鎖、切回前景後 interrupted）
for (const st of ["suspended", "interrupted"]) {
  played.length = 0; resumeCalls = 0; resumable = true; theAC!.state = st;
  const r = await E.playTableSound("remind");
  ok(r.played && r.ac === "running" && resumeCalls === 1 && played.length === 1, `E7 音訊是 ${st}、叫得醒：先叫醒再播，提醒聲照樣響`);
  played.length = 0; resumeCalls = 0; resumable = false; theAC!.state = st;
  const r2 = await E.playTableSound("remind");
  ok(!r2.played && r2.ac === st && played.length === 0, `E8 音訊是 ${st}、叫不醒：不播、回報沒出聲（${r2.ac}），不會假裝有響`);
  resumeCalls = 0;
  E.unlockAudio();
  ok(resumeCalls === 1, `E9 音訊是 ${st} 時使用者點一下：叫醒（呼叫 resume）`);
}
resumable = true; theAC!.state = "running";
ok(E.fxAudioState() === "running", "E10 可以查目前音訊狀態（預覽站紀錄用）");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
