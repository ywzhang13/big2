// 麻將自摸配音跟「自摸」大字同一刻（老闆 2026-11-28「麻將自摸的聲音應該跟自摸的字一起出來」）
//   Z1 閘門：這一手有演出「自摸」字就扣住配音；字出現（cue）那一刻才唸，前後 0 毫秒
//   Z2 字比配音先到（cue 在前）：配音一來就唸，不再等
//   Z3 跳過、換局、離開（release）：扣著的照樣唸；等太久（9 秒）也唸，配音不會被吃掉
//   Z4 不是這一手、沒有演出（沒 arm）：照舊馬上唸；drop（配音那邊換局）扣著的不唸
//   Z5 接線：useWinShow 排演出時（同一個 effect、setWinShow 之前）就 arm，金色浮層出來 cue、演出收掉 release；
//      頁面上 useWinShow 排在 useTableVoice 前面（同一次更新先 arm 才輪到配音）；玩家頁、觀戰頁都一樣
//   Z6 接線：配音的「自摸」先問閘門（hold），其他句子照舊馬上排
//   Z7 自摸特效、隕石：字出現那一刻呼叫 onTitle（跟專屬音效同一個起點＋ZFX_TL.zimo／METEOR_TITLE_AT），WinShowLayer 接到 cue
//   Z8 時間：各特效從演出開始到「自摸」字的時間（舊版配音就是早這麼多）
import { readFileSync } from "node:fs";

const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);
async function section(name: string, f: () => Promise<void> | void) { try { await f(); } catch (e) { results.push(`❌ ${name} 例外：${(e as Error).message}`); } }

// 假計時器：記下排了什麼、手動往前推
let now = 0;
const queue: { at: number; f: () => void; id: number }[] = [];
let seq = 0;
const timers = {
  set: (f: () => void, ms: number) => { const id = ++seq; queue.push({ at: now + ms, f, id }); return id as unknown as ReturnType<typeof setTimeout>; },
  clear: (t: ReturnType<typeof setTimeout>) => { const i = queue.findIndex((q) => q.id === (t as unknown as number)); if (i >= 0) queue.splice(i, 1); },
};
const advance = (ms: number) => { now += ms; for (;;) { queue.sort((a, b) => a.at - b.at); const q = queue[0]; if (!q || q.at > now) break; queue.shift(); q.f(); } };

await section("Z1–Z4", async () => {
  const { createZimoVoiceGate, ZIMO_VOICE_MAX_WAIT_MS } = await import("../lib/mahjong/zimoVoiceGate");
  const playedAt: number[] = [];
  const play = () => playedAt.push(now);

  // Z1：雷霆自摸：演出排好（arm）→ 伺服器說自摸（配音想唸）→ 1.66 秒後字出現（cue）
  let g = createZimoVoiceGate(timers); now = 0; playedAt.length = 0;
  g.arm("1-1-0");
  const held = g.hold("1-1-0", play);
  advance(1659);
  ok(held && playedAt.length === 0, "Z1 這一手有演出「自摸」字：配音先扣住，字出來之前不唸");
  advance(1); g.cue("1-1-0");
  ok(playedAt.length === 1 && playedAt[0] === 1660, `Z1 字出現那一刻（1660ms）才唸，差 ${playedAt[0] - 1660}ms`);

  // Z2：字先出現、配音晚到（例如廣播比輪詢慢）
  g = createZimoVoiceGate(timers); now = 0; playedAt.length = 0;
  g.arm("1-2-0"); advance(1860); g.cue("1-2-0");
  const held2 = g.hold("1-2-0", play);
  ok(!held2, "Z2 字已經出現過：配音一來就照舊馬上唸（不扣）");

  // Z3：字出來前就跳過（release）；或演出卡住等太久
  g = createZimoVoiceGate(timers); now = 0; playedAt.length = 0;
  g.arm("1-3-0"); g.hold("1-3-0", play); advance(500); g.release("1-3-0");
  ok(playedAt.length === 1 && playedAt[0] === 500, "Z3 字出來前跳過演出：扣著的配音照樣唸（不會被吃掉）");
  g = createZimoVoiceGate(timers); now = 0; playedAt.length = 0;
  g.arm("1-4-0"); g.hold("1-4-0", play); advance(ZIMO_VOICE_MAX_WAIT_MS - 1);
  ok(playedAt.length === 0, "Z3 等待中（還沒到上限）不唸");
  advance(1);
  ok(playedAt.length === 1 && playedAt[0] === ZIMO_VOICE_MAX_WAIT_MS, `Z3 演出一直沒出字：最多等 ${ZIMO_VOICE_MAX_WAIT_MS / 1000} 秒照樣唸`);
  g.cue("1-4-0"); advance(1000);
  ok(playedAt.length === 1, "Z3 已經唸過：之後才 cue 也不會唸第二次");

  // Z4：別手、沒演出、配音那邊換局
  g = createZimoVoiceGate(timers); now = 0; playedAt.length = 0;
  ok(!g.hold("2-1-0", play), "Z4 沒有演出（沒 arm，例如一般胡牌、天胡只播大牌段）：照舊馬上唸");
  g.arm("2-2-0");
  ok(!g.hold("2-1-0", play), "Z4 不是這一手：照舊馬上唸");
  g.hold("2-2-0", play); g.drop(); g.cue("2-2-0"); advance(ZIMO_VOICE_MAX_WAIT_MS);
  ok(playedAt.length === 0, "Z4 配音那邊換局、離開（drop）：扣著的不唸、計時器也清掉");
});

await section("Z5", () => {
  const ws = readFileSync("hooks/useWinShow.tsx", "utf8");
  const sched = ws.slice(ws.indexOf("const show: WinShow ="), ws.indexOf("setWinShow(show)"));
  ok(/zimoVoiceGate\.arm\(handKey\)/.test(sched) && /isZimoWin && showPlan\.some\(/.test(sched), "Z5 useWinShow 排演出的同一個 effect、setWinShow 之前就 arm（自摸，而且演出有浮層／自摸特效／隕石）");
  ok(/"cele"[\s\S]{0,40}"zfx"[\s\S]{0,40}"meteor"/.test(sched), "Z5 會演出「自摸」字的三種：浮層 cele、自摸特效 zfx、隕石 meteor（只有大牌段的天胡、八仙過海不扣）");
  const cele = ws.slice(ws.indexOf('if (winStage !== "cele"'), ws.indexOf("celeOffRef.current = setTimeout"));
  ok(/if \(mode === "zimo"\) zimoVoiceGate\.cue\(handKey\)/.test(cele), "Z5 金色自摸浮層掛上那一刻 cue（浮層的「自摸」字從 0 毫秒開始出現）");
  ok(/return \(\) => zimoVoiceGate\.release\(h\)/.test(ws), "Z5 演出收掉（播完、跳過、換局、離開）release：扣著的照樣唸");
  for (const [n, f] of [["玩家頁", "app/mahjong/page.tsx"], ["觀戰頁", "app/mahjong/watch/page.tsx"]]) {
    const s = readFileSync(f, "utf8");
    const a = s.indexOf("useWinShow({"), b = s.indexOf("useTableVoice({");
    ok(a > 0 && b > a, `Z5 ${n}：useWinShow 排在 useTableVoice 前面（同一次更新先 arm，配音才知道要等）`);
  }
});

await section("Z6", () => {
  const h = readFileSync("hooks/useTableSounds.ts", "utf8");
  ok(/keys\.includes\("zimo"\) && zimoVoiceGate\.hold\(hand, \(\) => queue\.push\(\["zimo"\]\)\)/.test(h), "Z6 配音的「自摸」先問閘門，扣住時字出現才排進佇列");
  ok(/queue\.push\(zimo \? keys\.filter\(\(k\) => k !== "zimo"\) : keys\)/.test(h), "Z6 其他句子（牌名、吃碰槓、放槍胡）照舊馬上排，順序不變");
  ok(/zimoVoiceGate\.drop\(\)/.test(h), "Z6 換局、離開：配音那邊也丟掉扣著的（跟佇列 reset 一致）");
});

await section("Z7", () => {
  const zf = readFileSync("components/mahjong/ZimoFx.tsx", "utf8"), mt = readFileSync("components/mahjong/MeteorFx.tsx", "utf8"), ws = readFileSync("hooks/useWinShow.tsx", "utf8");
  ok(/ZFX_TL\[fx\]\.zimo - \(z == null \? 0 : performance\.now\(\) - z\)/.test(zf) && /titleRef\.current\?\.\(\)/.test(zf), "Z7 自摸特效：從動畫真正開始那一刻（跟專屬音效同一個起點）算到 ZFX_TL.zimo 呼叫 onTitle");
  ok(/METEOR_TITLE_AT - \(z == null \? 0 : performance\.now\(\) - z\)/.test(mt) && /titleRef\.current\?\.\(\)/.test(mt), "Z7 隕石：從動畫開始算到 1.25 秒「自摸」砸出呼叫 onTitle");
  ok((ws.match(/onTitle=\{\(\) => zimoVoiceGate\.cue\(ws\.handKey\)\}/g) ?? []).length === 2, "Z7 WinShowLayer：自摸特效、隕石的 onTitle 都接到 cue");
  ok(/zimo-slam|1250ms/.test(readFileSync("components/mahjong/meteorFx.css", "utf8")), "Z7 隕石「自摸」CSS 動畫延遲 1250ms，跟 METEOR_TITLE_AT 一致");
});

await section("Z8", async () => {
  const { ZFX_TL } = await import("../components/mahjong/ZimoFx");
  const { METEOR_TITLE_AT } = await import("../components/mahjong/MeteorFx");
  const rows = Object.entries(ZFX_TL).map(([k, v]) => `${k} ${(v.zimo / 1000).toFixed(2)}s`).concat(`meteor ${(METEOR_TITLE_AT / 1000).toFixed(2)}s`);
  ok(rows.length === 7, `Z8 舊版配音比「自摸」字早（演出開始→字）：${rows.join("、")}；前面有大牌段時再多一段`);
});

for (const r of results) console.log(r);
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`\n${results.length - fail}/${results.length} 通過`);
if (fail) process.exit(1);
