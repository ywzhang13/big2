// iPhone 加到主畫面沒聲音（老馬 2026-11-22）：牌桌頁的音訊模式 lib/gameAudioSession.ts
// 2026-11-23 老闆改成「不要暫停背景音樂」：牌桌從 playback 改成 ambient（跟音樂混音；代價是靜音開關打開時沒聲音），拿掉無聲 <audio>。
// 換掉 navigator.audioSession、document，檢查：進房間改 ambient、離開還原、錄音切 play-and-record、全部錄完回 ambient、
// 回到前景叫醒被中斷的 AudioContext、任何情況都不建 <audio>（媒體播放會暫停背景音樂）；以及三款牌桌入口都有接上
import { readFileSync } from "node:fs";
import { __testGameAudio, enterGameAudio, registerAudioContext, resumeAudioContexts, withCaptureSession } from "../lib/gameAudioSession";

// 計算有沒有人建 <audio>（new Audio）：媒體元素是 MediaPlayback，會暫停 Spotify 等背景音樂
let audioMade = 0;
(globalThis as unknown as { Audio: unknown }).Audio = class { constructor() { audioMade++; } play() { return Promise.resolve(); } pause() {} };

const results: string[] = [];
const ok = (c: boolean, m: string) => results.push(`${c ? "✅" : "❌"} ${m}`);

type Sess = { type: "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record" };
class FakeDoc extends EventTarget { visibilityState: "visible" | "hidden" = "visible"; defaultView = new EventTarget(); }
const fakeCtx = (state: string) => {
  const c = { state, resumed: 0, resume() { c.resumed++; c.state = "running"; return Promise.resolve(); } };
  return c;
};
const asCtx = (c: ReturnType<typeof fakeCtx>) => c as unknown as AudioContext;

// A1 大廳：沒有進房間，模式不動
{
  const s: Sess = { type: "auto" }, d = new FakeDoc();
  __testGameAudio({ ios: () => true, session: () => s, doc: () => d as unknown as Document });
  ok(s.type === "auto", "A1 大廳（沒進房間）audioSession 維持 auto");
}
// A2 進房間 ambient、離開還原；兩個牌桌元件同時掛著，要兩個都離開才還原
{
  const s: Sess = { type: "auto" }, d = new FakeDoc();
  __testGameAudio({ ios: () => true, session: () => s, doc: () => d as unknown as Document });
  const leaveA = enterGameAudio();
  ok(s.type === "ambient", "A2 進房間 audioSession 改成 ambient（跟背景音樂混音、不暫停音樂；錄過語音也回喇叭）");
  const leaveB = enterGameAudio();
  leaveA(); leaveA();
  ok(s.type === "ambient", "A3 還有另一個牌桌掛著時，離開其中一個（重複呼叫也一樣）不還原");
  leaveB();
  ok(s.type === "auto", "A4 都離開後還原成進房前的 auto（大廳不受影響）");
}
// A5 錄音：開麥克風前 play-and-record，錄完、取消、開不了麥克風都回 ambient（不會卡在聽筒）
{
  const s: Sess = { type: "auto" }, d = new FakeDoc();
  __testGameAudio({ ios: () => true, session: () => s, doc: () => d as unknown as Document });
  const leave = enterGameAudio();
  let during = "";
  let finish: (b: string | null, ms: number) => void = () => {};
  const rec = withCaptureSession((onDone: (b: string | null, ms: number) => void) => { during = s.type; finish = onDone; return Promise.resolve({ stop() {} } as { stop: () => void } | "denied"); });
  const got: unknown[] = [];
  await rec((b, ms) => got.push(b, ms));
  ok(during === "play-and-record" && s.type === "play-and-record", "A5 錄音中 audioSession 是 play-and-record（ambient 錄不到）");
  finish("blob", 1200);
  ok(s.type === "ambient" && got[0] === "blob" && got[1] === 1200, "A6 錄完回 ambient，錄音結果照常交出去");
  const denied = withCaptureSession(() => Promise.resolve("denied" as { stop: () => void } | "denied"));
  const r = await denied(() => {});
  ok(r === "denied" && s.type === "ambient", "A7 麥克風被拒：回 ambient，錯誤照常回傳");
  // A7b 上滑取消：錄音器停掉後 onDone(null)（chatClient startRecording 的 cancel 走 rec.stop → onstop → onDone(null)）
  const rec2 = withCaptureSession((onDone: (b: string | null, ms: number) => void) => { finish = onDone; return Promise.resolve({ stop() {} } as { stop: () => void } | "denied"); });
  let cancelled: unknown = "沒呼叫";
  await rec2((b) => { cancelled = b; });
  const midCancel = s.type;
  finish(null, 300);
  ok(midCancel === "play-and-record" && s.type === "ambient" && cancelled === null, "A7b 錄音中上滑取消：回 ambient，取消結果（null）照常交出去");
  for (const why of ["unsupported", "failed"] as const) {
    const f = withCaptureSession(() => Promise.resolve(why as { stop: () => void } | typeof why));
    const rr = await f(() => {});
    ok(rr === why && s.type === "ambient", `A7c 開不了麥克風（${why}）：回 ambient`);
  }
  const boom = withCaptureSession(() => Promise.reject(new Error("x")));
  let threw = false;
  try { await boom(() => {}); } catch { threw = true; }
  ok(threw && s.type === "ambient", "A7d 開麥克風時丟錯：回 ambient，錯誤照常丟出");
  leave();
  ok(s.type === "auto", "A8 錄完再離開房間還原成 auto");
}
// A9 回到前景、pageshow：叫醒被系統中斷（interrupted）或暫停的音訊；running 的不動
{
  const s: Sess = { type: "auto" }, d = new FakeDoc();
  __testGameAudio({ ios: () => true, session: () => s, doc: () => d as unknown as Document });
  const leave = enterGameAudio();
  const a = fakeCtx("interrupted"), b = fakeCtx("running"), c = fakeCtx("suspended");
  registerAudioContext(asCtx(a)); registerAudioContext(asCtx(b)); registerAudioContext(asCtx(c));
  d.visibilityState = "visible"; d.dispatchEvent(new Event("visibilitychange"));
  ok(a.resumed === 1 && c.resumed === 1 && b.resumed === 0, "A9 回到前景叫醒 interrupted／suspended 的音訊，running 的不動");
  a.state = "interrupted"; d.defaultView.dispatchEvent(new Event("pageshow"));
  ok(a.resumed === 2, "A10 pageshow（從主畫面切回來）也叫醒");
  a.state = "interrupted"; d.dispatchEvent(new Event("touchend"));
  ok(a.resumed === 3, "A11 點畫面（touchend）也叫醒");
  a.state = "suspended"; d.dispatchEvent(new Event("click"));
  ok(a.resumed === 4, "A11b 點畫面（click，iPhone 算使用者手勢）叫醒 suspended 的音訊，叫醒後是 running");
  ok(a.state === "running", "A11c 手勢後 AudioContext 狀態是 running");
  leave();
  a.state = "interrupted"; d.dispatchEvent(new Event("visibilitychange"));
  ok(a.resumed === 4, "A12 離開房間後不再掛事件");
  a.state = "suspended"; resumeAudioContexts();
  ok(a.resumed === 5, "A13 resumeAudioContexts 直接呼叫也叫得醒");
}
// A14 舊版 iOS（沒有 audioSession）：維持原本行為，不建任何 <audio>（2026-11-23 拿掉無聲音軌：它會暫停背景音樂）
{
  const d = new FakeDoc();
  __testGameAudio({ ios: () => true, session: () => null, doc: () => d as unknown as Document });
  audioMade = 0;
  const leave = enterGameAudio();
  d.dispatchEvent(new Event("click")); d.dispatchEvent(new Event("touchend"));
  d.visibilityState = "hidden"; d.dispatchEvent(new Event("visibilitychange"));
  d.visibilityState = "visible"; d.dispatchEvent(new Event("visibilitychange"));
  ok(audioMade === 0, "A14 沒有 audioSession：進房間、點畫面、切背景回來都不建 <audio>（不暫停背景音樂）");
  const c = fakeCtx("interrupted"); registerAudioContext(asCtx(c));
  d.dispatchEvent(new Event("click"));
  ok(c.resumed === 1, "A15 沒有 audioSession：點畫面照樣叫醒 AudioContext");
  leave();
}
// A19 有 audioSession 時也不建 <audio>
{
  const s: Sess = { type: "auto" }, d = new FakeDoc();
  __testGameAudio({ ios: () => true, session: () => s, doc: () => d as unknown as Document });
  audioMade = 0;
  const leave = enterGameAudio();
  d.dispatchEvent(new Event("click"));
  ok(audioMade === 0 && s.type === "ambient", "A19 有 audioSession：進房間點畫面也不建 <audio>，模式是 ambient");
  leave();
}
// R1（審伯 2026-11-23）：每筆錄音各自持有錄音模式；舊錄音晚到的完成、取消、出錯不能把還在錄的新錄音切回 ambient
{
  type Fin = (b: string | null, ms: number) => void;
  type H = { stop: () => void } | "denied" | "failed";
  // 可控的錄音：start 時記下 onDone；權限結果由測試決定何時回來
  const mk = () => {
    const r: { done: Fin; grant: (h: H) => void } = { done: () => {}, grant: () => {} };
    const fn = withCaptureSession((onDone: Fin) => { r.done = onDone; return new Promise<H>((res) => { r.grant = res; }); });
    return { r, fn };
  };
  const setup = () => {
    const s: Sess = { type: "auto" }, d = new FakeDoc();
    __testGameAudio({ ios: () => true, session: () => s, doc: () => d as unknown as Document });
    return s;
  };
  const both = async () => {
    const A = mk(), B = mk();
    const pa = A.fn(() => {}); A.r.grant({ stop() {} }); await pa;
    const pb = B.fn(() => {}); B.r.grant({ stop() {} }); await pb;
    return { A, B };
  };
  // R1a A 開始、B 開始、A 先結束、B 再結束
  {
    const s = setup(); const leave = enterGameAudio();
    const { A, B } = await both();
    A.r.done("a", 100);
    ok(s.type === "play-and-record", "R1a A、B 都在錄，A 先錄完：B 還在錄，維持 play-and-record");
    B.r.done("b", 100);
    ok(s.type === "ambient", "R1a-2 最後一筆 B 也錄完才回 ambient");
    leave();
  }
  // R1b B 先結束
  {
    const s = setup(); const leave = enterGameAudio();
    const { A, B } = await both();
    B.r.done(null, 10);
    ok(s.type === "play-and-record", "R1b B 先取消、A 還在錄：維持 play-and-record");
    A.r.done("a", 100);
    ok(s.type === "ambient", "R1b-2 A 也錄完才回 ambient");
    leave();
  }
  // R1c 重複完成不誤減：A 的完成回呼叫兩次，B 還在錄
  {
    const s = setup(); const leave = enterGameAudio();
    const { A, B } = await both();
    A.r.done("a", 1); A.r.done("a", 1);
    ok(s.type === "play-and-record", "R1c 舊錄音的完成回呼重複兩次：不誤減，B 還在錄所以維持 play-and-record");
    B.r.done("b", 1);
    ok(s.type === "ambient", "R1c-2 B 錄完回 ambient");
    leave();
  }
  // R1d A 等麥克風權限時換房（離開舊房、進新房），B 在新房開始錄音，A 隨後被拒
  {
    const s = setup(); const leave1 = enterGameAudio();
    const A = mk();
    const pa = A.fn(() => {}); // 等權限中
    leave1(); const leave2 = enterGameAudio();
    const B = mk();
    const pb = B.fn(() => {}); B.r.grant({ stop() {} }); await pb;
    A.r.grant("denied"); await pa;
    ok(s.type === "play-and-record", "R1d A 等權限時換房、B 在新房錄音，A 才被拒：B 維持 play-and-record");
    B.r.done("b", 1);
    ok(s.type === "ambient", "R1d-2 B 錄完回 ambient");
    leave2();
  }
  // R1e 同上，但 A 取得權限後立刻被取消（chatMic 換場 cancel → onstop → onDone(null)）
  {
    const s = setup(); const leave1 = enterGameAudio();
    const A = mk();
    const pa = A.fn(() => {});
    leave1(); const leave2 = enterGameAudio();
    const B = mk();
    const pb = B.fn(() => {}); B.r.grant({ stop() {} }); await pb;
    A.r.grant({ stop() {} }); await pa; A.r.done(null, 0);
    ok(s.type === "play-and-record", "R1e A 換房後才拿到權限又被取消：B 維持 play-and-record");
    B.r.done("b", 1);
    ok(s.type === "ambient", "R1e-2 B 錄完回 ambient");
    leave2();
  }
  // R1f 錄音中離開房間：立刻還原成進房前的 auto；之後才收到舊回呼，大廳模式不被改
  {
    const s = setup(); const leave = enterGameAudio();
    const A = mk();
    const pa = A.fn(() => {}); A.r.grant({ stop() {} }); await pa;
    ok(s.type === "play-and-record", "R1f 錄音中是 play-and-record");
    leave();
    ok(s.type === "auto", "R1f-2 錄音中離開房間：回大廳立刻還原 auto，不留在 play-and-record");
    A.r.done(null, 0);
    ok(s.type === "auto", "R1f-3 離開房間後才收到舊錄音的回呼：大廳維持 auto");
    const leave2 = enterGameAudio();
    ok(s.type === "ambient", "R1f-4 舊錄音結束後再進房：是 ambient，不會卡在 play-and-record");
    leave2();
  }
  // R1g 舊錄音開麥克風丟錯晚到，不影響新錄音
  {
    const s = setup(); const leave = enterGameAudio();
    let rejectA: (e: Error) => void = () => {};
    const A = withCaptureSession(() => new Promise<H>((_, rej) => { rejectA = rej; }));
    const pa = A(() => {}).catch(() => "thrown");
    const B = mk();
    const pb = B.fn(() => {}); B.r.grant({ stop() {} }); await pb;
    rejectA(new Error("x")); await pa;
    ok(s.type === "play-and-record", "R1g 舊錄音開麥克風丟錯晚到：B 還在錄，維持 play-and-record");
    B.r.done("b", 1);
    ok(s.type === "ambient", "R1g-2 B 錄完回 ambient");
    leave();
  }
}
__testGameAudio(null);

// A20 桌機、Android（不是 iPhone／iPad）：什麼都不動，也不播無聲音軌
{
  const s: Sess = { type: "auto" }, d = new FakeDoc();
  audioMade = 0;
  __testGameAudio({ ios: () => false, session: () => s, doc: () => d as unknown as Document });
  const leave = enterGameAudio();
  d.dispatchEvent(new Event("click"));
  ok(s.type === "auto" && audioMade === 0, "A20 桌機（不是 iPhone／iPad）進房間：audioSession 不動、不建無聲音軌");
  __testGameAudio({ ios: () => false, session: () => null, doc: () => d as unknown as Document });
  const leave2 = enterGameAudio();
  d.dispatchEvent(new Event("click"));
  ok(audioMade === 0, "A21 桌機 Chrome（沒有 audioSession）也不播無聲音軌");
  leave(); leave2();
}
__testGameAudio(null);

// B 入口：三款牌桌頁、兩個音訊模組、錄音都有接上（大老二目前沒有任何音效，不用接）
const src = (p: string) => readFileSync(p, "utf8");
ok(/registerAudioContext\(ctx\)/.test(src("components/thirteen/thAudio.ts")), "B1 十三支音訊（thAudio）建好就登記，回前景叫得醒");
ok(/registerAudioContext\(AC\)/.test(src("lib/mahjong/fx/engine.ts")), "B2 麻將音訊（fx/engine）建好就登記");
ok(/useGameAudioSession\(!!join\)/.test(src("app/thirteen/page.tsx")), "B3 十三支：進房間（join）才開遊戲播放模式");
ok(/useGameAudioSession\(!!roomId\)/.test(src("hooks/useTableSounds.ts")), "B4 麻將打牌頁：在房間（roomId）才開");
ok(/useGameAudioSession\(!!room\)/.test(src("app/mahjong/watch/page.tsx")), "B5 麻將觀戰頁：開始觀戰才開");
ok(/createChatMic\(withCaptureSession\(startRecording\)/.test(src("components/mahjong/MjChat.tsx")), "B6 麻將語音錄音前後切換模式");
ok(!/AudioContext|new Audio\(/.test(src("app/big2/page.tsx")), "B7 大老二牌桌沒有音效（不用接）");

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
