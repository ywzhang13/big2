// 麻將自摸特效「點了就存」的儲存佇列（審伯〈麻將共用設定面板初審〉R1、R2，2026-11-21）：
//   R1 關閉再打開面板：同一頁只有一條有序的儲存佇列，在途 POST 永遠最多一筆，舊面板不會另送過時的選項，最後存的是最後點的
//   R2 回應遺失、500、網路斷：重新向伺服器確認；確認前不把快取當「使用中」；補抓失敗留「未確認」可重試；舊的補抓結果不蓋掉後來成功的寫入
// 伺服器是假的：POST 在測試按下「完成」那一刻才寫入（可以先寫入再把回應弄丟）；GET 回當下伺服器的值。
// FX_SAVER＝要測的模組（預設正式的 components/mahjong/zimoFxSaver；修改前的紀錄用 .tmp 裡 v1 原樣搬出的 saver-v1.ts）
import type { MyZimoFx, Res, ZimoFxChoice } from "../lib/mahjong/zimoFxClient";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const path = process.env.FX_SAVER ?? "../components/mahjong/zimoFxSaver";
const { createZimoFxSaver } = (await import(path)) as { createZimoFxSaver: (io: IO) => Saver };
type IO = { get: () => Promise<Res<MyZimoFx>>; post: (fx: ZimoFxChoice) => Promise<Res<{ selected: ZimoFxChoice }>> };
type Saver = { load(): Promise<void>; choose(c: ZimoFxChoice): void; get(): { confirmed: ZimoFxChoice | null; save: { code: ZimoFxChoice; state: string } | null } };

const ALL: ZimoFxChoice[] = ["golden", "meteor", "thunder", "storm", "frost", "blackhole", "sakura"];
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

/** 假伺服器：posts 是還沒完成的 POST（測試決定完成順序）；gets 可以設成手動完成 */
function fake(initial: ZimoFxChoice = "golden") {
  const server = { selected: initial as ZimoFxChoice };
  let inflight = 0, maxInflight = 0;
  const posts: { code: ZimoFxChoice; done: (how?: "ok" | "lost" | "fail500" | "reject") => void }[] = [];
  const gets: { done: (how?: "ok" | "fail") => void }[] = [];
  let manualGet = false, getFails = false;
  const data = (): MyZimoFx => ({ serverNow: 0, displayName: "阿線", isOwner: false, available: Object.fromEntries(ALL.map((c) => [c, null])), selected: server.selected });
  const io: IO = {
    get: () => {
      if (!manualGet) return Promise.resolve(getFails ? { ok: false, status: 0, error: "network" } : { ok: true, data: data() });
      return new Promise((res) => gets.push({ done: (how = "ok") => res(how === "fail" ? { ok: false, status: 0, error: "network" } : { ok: true, data: data() }) }));
    },
    post: (code) => {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      return new Promise((res) => posts.push({ code, done: (how = "ok") => {
        inflight--;
        if (how === "ok") { server.selected = code; res({ ok: true, data: { selected: code } }); }
        else if (how === "lost") { server.selected = code; res({ ok: false, status: 0, error: "network" }); } // 伺服器已寫入，回應掉了
        else if (how === "fail500") res({ ok: false, status: 500, error: "server_error" }); // 確實沒寫入
        else res({ ok: false, status: 403, error: "not_granted", body: { selected: server.selected } });
      } }));
    },
  };
  return { server, io, posts, gets, max: () => maxInflight, setManualGet: (v: boolean) => { manualGet = v; }, setGetFails: (v: boolean) => { getFails = v; } };
}
/** 依序完成目前在途的 POST，直到沒有 */
async function drain(f: ReturnType<typeof fake>, how: "ok" = "ok") { await tick(); while (f.posts.length) { f.posts.shift()!.done(how); await tick(); } }

// ---- R1 關閉再打開 ----
{
  const f = fake(); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  s.choose("meteor"); await tick();                      // meteor 在途
  await s.load(); await tick();                          // 關閉再打開（伺服器還是 golden）
  s.choose("storm"); await tick();
  const meteor = f.posts.find((p) => p.code === "meteor");
  const storm = f.posts.find((p) => p.code === "storm");
  storm?.done("ok"); await tick(); meteor?.done("ok"); await tick(); // 先讓 storm 完成、再讓 meteor
  await drain(f);
  await s.load(); await tick();
  ok(f.max() === 1 && f.server.selected === "storm" && s.get().confirmed === "storm", `R1-1 meteor 在途→關閉重開→storm：在途最多 1 筆（實際 ${f.max()}），伺服器 ${f.server.selected}、畫面使用中 ${s.get().confirmed}，都要是 storm`);
}
{
  const f = fake(); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  s.choose("meteor"); await tick(); s.choose("thunder"); await tick(); // meteor 在途、thunder 排隊
  await s.load(); await tick();
  s.choose("storm"); await tick();
  await drain(f);
  await s.load(); await tick();
  ok(f.max() === 1 && f.server.selected === "storm" && s.get().confirmed === "storm", `R1-2 meteor 在途＋thunder 排隊→關閉重開→storm：在途最多 1 筆（實際 ${f.max()}），最後伺服器 ${f.server.selected}、使用中 ${s.get().confirmed}`);
}
{
  const f = fake(); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  s.choose("meteor"); s.choose("thunder"); s.choose("storm"); await drain(f);
  ok(f.max() === 1 && f.server.selected === "storm" && s.get().confirmed === "storm" && s.get().save === null, "R1-3 同一個面板連點三張：一次一筆、最後是 storm（原本的行為不變）");
}

// ---- R2 不確定的寫入結果 ----
{
  const f = fake(); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  s.choose("meteor"); await tick(); f.posts.shift()!.done("lost"); await tick(10);
  ok(f.server.selected === "meteor" && s.get().confirmed === "meteor" && s.get().save === null, `R2-1 已寫入但回應遺失：重新向伺服器確認，使用中＝伺服器（伺服器 ${f.server.selected}、畫面 ${s.get().confirmed}）`);
}
{
  const f = fake(); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  s.choose("meteor"); await tick(); f.posts.shift()!.done("fail500"); await tick(10);
  ok(f.server.selected === "golden" && s.get().confirmed === "golden" && s.get().save?.code === "meteor" && s.get().save?.state === "failed", `R2-2 確實沒寫入（500）：確認後使用中＝golden，那張寫「儲存失敗」（畫面 ${s.get().confirmed}／${JSON.stringify(s.get().save)}）`);
}
{
  const f = fake(); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  f.setGetFails(true);
  s.choose("meteor"); await tick(); f.posts.shift()!.done("lost"); await tick(10);
  const v = s.get();
  ok(v.confirmed === null && v.save?.code === "meteor" && v.save?.state === "unconfirmed", `R2-3 回應遺失、補抓也失敗：不把快取當使用中（${v.confirmed}），那張標「未確認」（${JSON.stringify(v.save)}）`);
  f.setGetFails(false);
  s.choose("meteor"); await drain(f); await tick(10);
  ok(f.server.selected === "meteor" && s.get().confirmed === "meteor" && s.get().save === null, "R2-4 恢復連線後再點一次：確認完成，使用中＝伺服器");
}
{
  const f = fake("golden"); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  f.setManualGet(true);
  s.choose("meteor"); await tick(); f.posts.shift()!.done("reject"); await tick(); // 403，伺服器說還是 golden，接著補抓 GET（暫扣）
  s.choose("storm"); await tick();
  while (f.posts.length) { f.posts.shift()!.done("ok"); await tick(); }      // storm 成功
  await tick();
  while (f.gets.length) { f.gets.shift()!.done("ok"); await tick(); }        // 舊的補抓才回來（這時伺服器已是 storm，但舊 GET 是在 storm 之前發的）
  f.setManualGet(false);
  await drain(f); await tick(10);
  ok(f.server.selected === "storm" && s.get().confirmed === "storm", `R2-5 403→舊補抓延遲→新 POST 成功→舊補抓才回：使用中仍是 storm（畫面 ${s.get().confirmed}）`);
}
{
  // 更直接的舊補抓：GET 回應內容是「發出時」的伺服器值
  const f = fake("golden"); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  const snapshot: MyZimoFx[] = [];
  const realGet = f.io.get;
  let hold: ((v: Res<MyZimoFx>) => void) | null = null;
  f.io.get = () => { if (hold === null && snapshot.length === 0) { return realGet().then((r) => { if (r.ok) snapshot.push(r.data); return new Promise<Res<MyZimoFx>>((res) => { hold = res; }); }); } return realGet(); };
  s.choose("meteor"); await tick(); f.posts.shift()!.done("reject"); await tick(10); // 補抓 GET 拿到 golden 但先扣住
  f.io.get = realGet;
  s.choose("storm"); await tick(); while (f.posts.length) { f.posts.shift()!.done("ok"); await tick(); }
  await tick(10);
  (hold as ((v: Res<MyZimoFx>) => void) | null)?.({ ok: true, data: snapshot[0] ?? { serverNow: 0, displayName: "", isOwner: false, available: {}, selected: "golden" } }); await tick(10);
  await drain(f); await tick(10); // 新做法：storm 排在補抓後面才送，讓佇列跑完
  ok(f.server.selected === "storm" && s.get().confirmed === "storm", `R2-6 舊補抓帶的是 golden、晚到：不蓋掉後來成功的 storm（畫面 ${s.get().confirmed}）`);
}

// ---- R2 補（審伯複審）：補抓 GET 還沒回來之前，就不能再標舊的「使用中」 ----
{
  const f = fake("golden"); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  f.setManualGet(true);
  s.choose("meteor"); await tick(); f.posts.shift()!.done("lost"); await tick(); // 伺服器已寫成 meteor、回應掉了，補抓 GET 暫扣
  const mid = s.get();
  ok(f.gets.length === 1 && mid.confirmed === null && mid.save?.code === "meteor" && mid.save?.state === "unconfirmed",
    `R2-7 補抓還沒回來：不標任何使用中（${mid.confirmed}），那張標「未確認」（${JSON.stringify(mid.save)}）`);
  f.gets.shift()!.done("ok"); await tick(10);
  ok(s.get().confirmed === "meteor" && s.get().save === null, `R2-8 補抓成功：照伺服器恢復使用中＝meteor（${s.get().confirmed}）`);
}
{
  const f = fake("golden"); const s = createZimoFxSaver(f.io);
  await s.load(); await tick();
  f.setManualGet(true);
  s.choose("meteor"); await tick(); f.posts.shift()!.done("fail500"); await tick();
  const mid = s.get();
  f.gets.shift()!.done("fail"); await tick(10);
  const end = s.get();
  ok(mid.confirmed === null && mid.save?.state === "unconfirmed" && end.confirmed === null && end.save?.code === "meteor" && end.save?.state === "unconfirmed",
    `R2-9 500 後補抓前、補抓失敗後：都不標使用中、維持「未確認」可再點（補抓前 ${mid.confirmed}／${mid.save?.state}，失敗後 ${end.confirmed}／${end.save?.state}）`);
  f.setManualGet(false);
  s.choose("meteor"); await drain(f); await tick(10);
  ok(f.max() === 1 && s.get().confirmed === "meteor" && s.get().save === null, "R2-10 再點一次：送出、確認後使用中＝meteor，在途仍最多 1 筆");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
