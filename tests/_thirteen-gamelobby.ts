// 三款共用的開房、加入、取名、等人（components/gameLobby，小宜〈共用開房流程 v1.1〉2026-11-19），這一張只接十三支：
//   N 名字規則：最多 8 個字（中文、英文、表情符號都算 1 個）、去掉前後空白後空的不能送
//   M 名字存在這台的 game_name；第一次讀是空的時候搬舊名字（麻將手動改過的 mj_name → 大老二 big2_name），舊 key 不刪
//   I 邀請連結：第一次（這台沒存過名字）問名字，送出成功存起來；第二次直接入座
//   U 畫面：暱稱欄、加入、取名頁、等人座位（不寫多餘的字）
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { GAME_NAME_KEY, NAME_MAX, cutName, initialName, inviteNeedsName, loadGameName, nameLength, saveGameName, validName } from "../components/gameLobby/name";
import { InviteNamePrompt, JoinByCode, WaitingRoom } from "../components/gameLobby/GameLobby";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
/** 假的 Storage（localStorage／sessionStorage 一樣的介面） */
function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), dump: () => Object.fromEntries(m) };
}

// ---- N 名字規則 ----
{
  ok(NAME_MAX === 8 && cutName("一二三四五六七八九十") === "一二三四五六七八" && cutName("abcdefghij") === "abcdefgh" && nameLength(cutName("😀😀😀😀😀😀😀😀😀")) === 8 && cutName("😀😀😀😀😀😀😀😀😀") === "😀😀😀😀😀😀😀😀",
    "N1 名字超過 8 個字被擋：中文 10 個字、英文 10 個字母、9 個表情符號都只留前 8 個（表情符號算 1 個字，不會被切成半個）");
  const cases: [string, string | null][] = [["  阿明  ", "阿明"], ["", null], ["   ", null], ["　", null], ["一二三四五六七八", "一二三四五六七八"], ["一二三四五六七八九", null], [" 一二三四五六七八 ", "一二三四五六七八"]];
  ok(cases.every(([i, o]) => validName(i) === o), `N2 送出前去掉前後空白：空的（含全形空白）不能送、9 個字不能送（${cases.map(([i, o]) => `「${i}」→${o === null ? "不能送" : `「${o}」`}`).join("、")}）`);
}

// ---- M 存放、搬舊名字 ----
{
  const s1 = mem({ mj_name: "麻將手動改的名字很長", mj_name_source: "manual", big2_name: "大老二名" });
  const got1 = loadGameName(s1, { mj: s1, big2: s1 });
  ok(got1 === "麻將手動改的名字" && s1.dump()[GAME_NAME_KEY] === "麻將手動改的名字" && s1.dump().mj_name === "麻將手動改的名字很長" && s1.dump().big2_name === "大老二名",
    `M1 麻將名字是手動改過的（mj_name_source=manual）：搬 mj_name，超過 8 個字取前 8 個（${got1}），存成 game_name；舊 key 不刪`);
  const s2 = mem({ mj_name: "LINE帶的", mj_name_source: "line" }), b2 = mem({ big2_name: "  老二王  " });
  const got2 = loadGameName(s2, { mj: s2, big2: b2 });
  ok(got2 === "老二王" && s2.dump()[GAME_NAME_KEY] === "老二王", `M2 麻將名字是 LINE 自動帶的：不搬它，改搬大老二的 big2_name（去掉前後空白：${got2}）`);
  const s3 = mem({ mj_name: "LINE帶的", mj_name_source: "line" });
  ok(loadGameName(s3, { mj: s3, big2: mem() }) === "" && !(GAME_NAME_KEY in s3.dump()), "M3 都沒有可以搬的：game_name 維持空的（之後照 LINE 名稱帶入）");
  const s4 = mem({ [GAME_NAME_KEY]: "現在的名字", mj_name: "舊", mj_name_source: "manual", big2_name: "更舊" });
  ok(loadGameName(s4, { mj: s4, big2: s4 }) === "現在的名字", "M4 game_name 有值就用它，不再搬舊名字");
  const s5 = mem();
  saveGameName(s5, "  新名字  "); saveGameName(s5, "   ");
  ok(s5.dump()[GAME_NAME_KEY] === "新名字", "M5 送出時存去掉前後空白的名字；空白的不會蓋掉");
  const a = initialName("", "張育瑋 Jay 的很長名字"), b = initialName("阿明", "張育瑋"), c = initialName("", null);
  ok(a.name === "張育瑋 Jay" && a.fromLine && b.name === "阿明" && !b.fromLine && c.name === "" && !c.fromLine,
    `M6 暱稱欄預設：存過的名字優先；沒有才用 LINE 名稱前 8 個字、切完再去掉尾巴空白（「${a.name}」，標「● LINE 名稱」）；都沒有空白`);
}

// ---- I 邀請連結 ----
{
  const store = mem();
  const first = inviteNeedsName(loadGameName(store, { mj: store, big2: mem() }));
  saveGameName(store, "阿明"); // 第一次在取名頁送出成功
  const second = inviteNeedsName(loadGameName(store, { mj: store, big2: mem() }));
  ok(first && !second, "I1 第一次點邀請連結（這台沒存過名字）會問名字；送出成功存起來後，第二次點直接入座");
  const page = readFileSync("app/thirteen/page.tsx", "utf8");
  ok(/if \(inviteNeedsName\(storedName\(\)\)\) setInvite\(code\);[\s\S]{0,80}else void doJoin\(code, autoName\(\)\)/.test(page)
    && /if \(save\) saveGameName\(mjStorage\(\), name\)/.test(page) && /onJoin=\{\(name\) => void doJoin\(invite, name, true\)\}/.test(page)
    && /onResume=\{\(code\) => void doJoin\(code, autoName\(\)\)\}/.test(page),
    "I2 十三支頁面：網址帶房號、沒存過名字 → 取名頁；存過 → 直接用存的名字入座；只有暱稱欄送出的名字成功入座後才存（回到房間不存）");
  const p = html(createElement(InviteNamePrompt, { brand: null, code: "4821", initialName: { name: "", fromLine: false }, busy: false, error: "", onJoin: () => {} }));
  ok(/class="gl-ttl">加入房間<b>4821<\/b>/.test(p) && /placeholder="暱稱"/.test(p) && /disabled=""[^>]*data-gl-go="invite"[^>]*>加入<|data-gl-go="invite"[^>]*disabled=""[^>]*>加入</.test(p),
    "I3 取名頁：標題「加入房間 4821」、暱稱欄、名字空白時「加入」不能按");
}

// ---- Q 瀏覽器存不了名字（審伯 2026-11-19 必修：例如 QuotaExceededError）：不擋流程，改記在這一頁 ----
{
  /** 讀得到、但一寫就丟 QuotaExceededError 的儲存區（手機儲存空間滿了） */
  const full = (init: Record<string, string> = {}) => {
    const m = mem(init);
    return { getItem: m.getItem, setItem: () => { const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; throw e; }, dump: m.dump };
  };
  const tryRun = <T,>(f: () => T): { ok: true; v: T } | { ok: false; err: string } => { try { return { ok: true, v: f() }; } catch (e) { return { ok: false, err: (e as Error).name }; } };
  // Q1 搬舊名字時寫不進去：不丟錯（大廳照常畫得出來），這一頁照樣用搬到的名字
  const s1 = full({ mj_name: "麻將手動名", mj_name_source: "manual" });
  const r1 = tryRun(() => loadGameName(s1, { mj: s1, big2: s1 }));
  const again1 = tryRun(() => loadGameName(s1, { mj: s1, big2: s1 }));
  ok(r1.ok && r1.v === "麻將手動名" && again1.ok && again1.v === "麻將手動名",
    `Q1 搬舊名字時存不進去：不丟錯，這一頁照樣帶入「麻將手動名」（${r1.ok ? "沒丟錯" : "丟出 " + r1.err}）`);
  // Q2 入座成功後存名字失敗：不丟錯（頁面才不會誤報「網路不穩」），這一頁記得送出的名字 → 同一頁再點邀請連結直接入座
  const s2 = full();
  const r2 = tryRun(() => saveGameName(s2, "  阿明  "));
  const after = tryRun(() => loadGameName(s2, { mj: s2, big2: mem() }));
  ok(r2.ok && after.ok && after.v === "阿明" && !inviteNeedsName(after.v),
    `Q2 入座成功後存名字失敗：不丟錯，這一頁記得「阿明」，之後點邀請連結直接入座（${r2.ok ? "沒丟錯" : "丟出 " + r2.err}）`);
  const s2b = full({ [GAME_NAME_KEY]: "舊名字" });
  saveGameName(s2b, "新名字");
  ok(loadGameName(s2b, { mj: s2b, big2: mem() }) === "新名字", "Q2b 儲存區裡已經有舊名字、新名字存不進去：這一頁用剛送出的新名字");
  // Q3 讀也讀不了（例如隱私模式擋住 localStorage）：當成空的，不丟錯
  const deny = { getItem: () => { const e = new Error("denied"); e.name = "SecurityError"; throw e; }, setItem: () => { throw new Error("denied"); } };
  const r3 = tryRun(() => loadGameName(deny, { mj: deny, big2: deny }));
  ok(r3.ok && r3.v === "", `Q3 儲存區連讀都不行：當成沒存過名字，不丟錯（${r3.ok ? "沒丟錯" : "丟出 " + r3.err}）`);
  // Q4 正常可以存時行為不變：記在這一頁的名字不會蓋掉另一個儲存區已有的 game_name
  const s4 = mem({ [GAME_NAME_KEY]: "原本的名字", mj_name: "舊", mj_name_source: "manual" });
  ok(loadGameName(s4, { mj: s4, big2: s4 }) === "原本的名字", "Q4 能正常儲存時照舊：已有的 game_name 不會被舊名字或別頁記的名字蓋掉");
  // Q5 頁面：入座 API 回 200 之後，存名字不能再讓流程掉進「網路不穩」
  const page = readFileSync("app/thirteen/page.tsx", "utf8");
  const after200 = page.slice(page.indexOf("const j = { roomId: r.body.roomId"), page.indexOf("} catch {", page.indexOf("const j = { roomId: r.body.roomId")));
  ok(/setJoin\(j\)/.test(after200) && /saveGameName\(mjStorage\(\), name\)/.test(after200),
    "Q5 十三支頁面：入座成功後存名字（saveGameName 本身不會丟錯，見 Q2），接著照常進房");
}

// ---- U 畫面 ----
{
  const j = html(createElement(JoinByCode, { brand: null, initialName: { name: "張育瑋 Jay", fromLine: true }, busy: false, error: "找不到房間", onJoin: () => {}, onBack: () => {} }));
  ok(/placeholder="房號"/.test(j) && /data-gl-line[^>]*><i><\/i>LINE 名稱/.test(j) && /data-gl-go="join"[^>]*>加入</.test(j) && /gl-err" role="alert">找不到房間</.test(j) && />返回</.test(j) && !/房間碼|4位數|你的暱稱|加入遊戲/.test(j),
    "U1 加入：房號、暱稱（LINE 帶入時標「● LINE 名稱」）、「加入」、錯誤訊息、返回；不再寫「房間碼 (4位數)」「你的暱稱」「加入遊戲」");
  const seats = [{ seat: 0, name: "偉鉅國際張育瑋哥", avatarUrl: "https://example.com/a.jpg", me: true, host: true }, { seat: 2, name: "阿明", avatarUrl: null, me: false, host: false }];
  const w = html(createElement(WaitingRoom, { code: "4821", inviteUrl: "x", summary: [], seats, isHost: true, onStart: async () => ({ ok: true }), onLeave: async () => ({ ok: true }) }));
  ok(/class="gl-seat me" data-gl-seat="0"><span class="av">偉<img src="https:\/\/example\.com\/a\.jpg"[^>]*><\/span><span class="nm">偉鉅國際張育瑋哥<\/span><span class="gl-tag host">房主<\/span>/.test(w)
    && /data-gl-seat="2"><span class="av">阿<\/span><span class="nm">阿明<\/span><\/div>/.test(w) && (w.match(/class="gl-seat empty"/g) ?? []).length === 2 && !/gl-chips/.test(w),
    "U2 等人座位：自己金色（me）、大頭照蓋在第一個字上、8 個字的名字完整放進去、房主膠囊；沒照片放第一個字；兩個空位虛線框；沒有設定摘要就不出現那一排");
  const full = html(createElement(WaitingRoom, { code: "4821", inviteUrl: "x", summary: [], seats, isHost: false, full: true, onStart: async () => ({ ok: true }), onLeave: async () => ({ ok: true }) }));
  ok(/gl-err full" role="alert">房間已滿</.test(full) && /data-gl-leave[^>]*>返回</.test(full), "U3 房間已滿：一行紅字「房間已滿」，「退出房間」改成「返回」");
}

console.log(results.join("\n"));
const fail = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - fail}、失敗 ${fail}`);
process.exit(fail ? 1 : 0);
