// 十三支理牌畫面（components/thirteen、app/thirteen/preview/arrange）：審伯三項必修＋阿哲拍板的對子例外
//   P 預覽路由：正式環境（含帶查詢參數）一律 404，測試預覽環境（THIRTEEN_PREVIEW=1）、本機開發照常可用
//   S 送出鎖定：倒數到期兩種送出都會清掉拖曳；送出後所有改牌入口都擋下，放開後畫面＝送出內容；送出只發生一次
//   H 手牌參數：先正規化再去重，只收 13 張有效且不同的牌；其他一律回 null（頁面改用預設手牌），推薦和逾時不拋錯
//   R 快捷鈕選出的牌放進墩後，牌型與加分仍由引擎 evalRow／bonusOf 判斷
import { bonusOf, CAT_NAME, CAT, checkArrangement, evalRow, parseCards, type Arrangement } from "../lib/thirteen";
import { arrangeReducer, derive, initArrange, rowLabel, ROW_SIZE, type ArrangeAction, type ArrangeState } from "../components/thirteen/arrangeState";
import { findCombos, SHORTCUTS } from "../components/thirteen/shortcuts";
import { parseHandParam } from "../app/thirteen/preview/arrange/hand";
import { register } from "node:module";

// 預覽頁 import 了 next/navigation（notFound）。Node 的 ESM 找不到沒寫副檔名的 next/navigation，
// 只在這支測試裡加一個解析 hook 指到 next/navigation.js（不改共用的 tests/support/loader-hooks.mjs）
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/navigation" ? "next/navigation.js" : s, c); }'));
const { default: Page } = await import("../app/thirteen/preview/arrange/page");

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);
const env = process.env as Record<string, string | undefined>;
const ids = (a: Arrangement) => [a.front, a.middle, a.back].map((r) => r.map((c) => c.id).join(",")).join(" | ");
const run = (s: ArrangeState, ...acts: ArrangeAction[]) => acts.reduce(arrangeReducer, s);

// ---- P 預覽路由 ----
async function open(nodeEnv: string, flag: string | undefined, q: Record<string, string>) {
  const saved = { n: env.NODE_ENV, f: env.THIRTEEN_PREVIEW };
  env.NODE_ENV = nodeEnv;
  if (flag === undefined) delete env.THIRTEEN_PREVIEW; else env.THIRTEEN_PREVIEW = flag;
  try { await Page({ searchParams: Promise.resolve(q) }); return "rendered"; }
  catch (e) { return (e as { digest?: string }).digest ?? String(e); }
  finally { env.NODE_ENV = saved.n; if (saved.f === undefined) delete env.THIRTEEN_PREVIEW; else env.THIRTEEN_PREVIEW = saved.f; }
}
const NF = "NEXT_HTTP_ERROR_FALLBACK;404";
ok(await open("production", undefined, {}) === NF, "P1 正式環境直接開預覽頁：404，拿不到預覽內容");
ok(await open("production", undefined, { seed: "3", secs: "30", hand: "SA1,SA2" }) === NF, "P2 正式環境帶查詢參數（seed、secs、hand）：一樣 404");
ok(await open("production", "0", { seed: "3" }) === NF && await open("production", "true", {}) === NF, "P3 開關不是剛好 \"1\"（\"0\"、\"true\"）：一樣 404");
ok(await open("production", "1", { seed: "3" }) === "rendered", "P4 測試預覽環境（next start ＋ THIRTEEN_PREVIEW=1）：照常可用");
ok(await open("development", undefined, { seed: "3" }) === "rendered", "P5 本機開發（next dev）：照常可用");

// ---- S 送出鎖定 ----
const HANDTXT = "2D 3S 4S 5S 8C 8D 8H 8S TC TD JH KS AD"; // 預覽 seed=3 那手（含鐵支）
const cards = parseCards(HANDTXT);
const fresh = () => initArrange(cards);
// 倒數到期、還沒排完：用引擎 autoArrange 送出，而且不倒水
{
  const s = run(fresh(), { type: "tapHand", id: cards[0].id }, { type: "tapRow", row: "front" }, { type: "timeout" });
  ok(!!s.submitted && checkArrangement(s.submitted).ok && s.drag === null, "S1 倒數到期、還沒排完：自動排一組不倒水的送出");
}
// 倒數到期、已排好：照目前的排法送出（先推薦再對調兩次＝回到原排法）
{
  const s0 = run(fresh(), { type: "recommend" });
  const mine = derive(s0).arrangement;
  const s = run(s0, { type: "timeout" });
  ok(!!s.submitted && ids(s.submitted) === ids(mine), "S2 倒數到期、已排好不倒水：照目前的排法送出");
}
// 拖到一半時間到：送出要清掉拖曳；之後放開不改任何牌，畫面＝送出內容
for (const kind of ["autoArrange", "placed"] as const) {
  let s = run(fresh(), { type: "recommend" });
  if (kind === "autoArrange") s = run(s, { type: "clearRow", row: "front" }); // 頭墩退回手牌＝沒排完，到期時走 autoArrange
  const v = derive(s);
  // 拿尾墩第一張，拖到中墩第一張上（兩墩都滿時＝互換），拖到一半時間到
  const from = v.arrangement.back[0].id, onto = v.arrangement.middle[0].id;
  s = run(s, { type: "dragStart", id: from, from: "back", pointerId: 1, x: 0, y: 0 }, { type: "dragMove", pointerId: 1, x: 50, y: 50, over: { zone: "middle", cardId: onto } }, { type: "timeout" });
  const sentRows = s.submitted ? ids(s.submitted) : "（沒送出）";
  ok(s.drag === null, `S3-${kind} 拖到一半時間到：送出同時清掉拖曳狀態`);
  s = run(s, { type: "dragEnd", pointerId: 1, over: { zone: "middle", cardId: onto } });
  ok(ids(derive(s).arrangement) === sentRows, `S4-${kind} 送出後才放開：畫面上的牌仍然和送出內容一樣（${kind === "autoArrange" ? "未排完自動排" : "已排好直接送出"}）`);
}
// 送出後，所有改牌入口都要擋下
{
  // 送出一組「和推薦排法不同」的合法排法，按推薦排法才看得出有沒有被擋
  const mine = { front: ["S31", "S41", "S51"], middle: ["CT1", "DT1", "HJ1", "SK1", "DA1"], back: ["D21", "C81", "D81", "H81", "S81"] };
  const s0 = run({ ...fresh(), rows: mine }, { type: "submit" });
  const sent = ids(s0.submitted!);
  ok(!!s0.submitted && sent !== ids(derive(run(fresh(), { type: "recommend" })).arrangement), "S5-0 送出的排法和推薦排法不同（下面按推薦排法才測得出來）");
  const v = derive(s0);
  const tries: [string, ArrangeAction[]][] = [
    ["點選手牌／點墩", [{ type: "tapHand", id: v.arrangement.front[0].id }, { type: "tapRow", row: "front" }]],
    ["點墩裡的牌（退回手牌）", [{ type: "dragStart", id: v.arrangement.back[0].id, from: "back", pointerId: 2, x: 0, y: 0 }, { type: "dragEnd", pointerId: 2, over: null }]],
    ["拖曳放開（互換）", [{ type: "dragStart", id: v.arrangement.back[0].id, from: "back", pointerId: 3, x: 0, y: 0 }, { type: "dragMove", pointerId: 3, x: 80, y: 0, over: { zone: "middle", cardId: v.arrangement.middle[0].id } }, { type: "dragEnd", pointerId: 3, over: { zone: "middle", cardId: v.arrangement.middle[0].id } }]],
    ["快捷鈕", SHORTCUTS.map((x) => ({ type: "shortcut", kind: x.kind, label: x.label }) as ArrangeAction)],
    ["對調中尾墩", [{ type: "swapRows" }]],
    ["重新選牌", [{ type: "reset" }]],
    ["推薦排法", [{ type: "recommend" }]],
    ["✕ 整墩退回", [{ type: "clearRow", row: "middle" }]],
    ["再送出一次", [{ type: "submit" }, { type: "timeout" }]],
  ];
  for (const [name, acts] of tries) {
    const s = run(s0, ...acts);
    ok(ids(derive(s).arrangement) === sent && s.submitted === s0.submitted && s.selected.length === 0 && s.drag === null, `S5 送出後「${name}」被擋下：牌不動、送出內容不變`);
  }
}
// 送出只發生一次：送出後再送出、時間到，submitted 還是同一個物件（元件只在 null → 有值時呼叫 onSubmit）
{
  const s1 = run(fresh(), { type: "recommend" }, { type: "submit" });
  const s2 = run(s1, { type: "submit" }, { type: "timeout" }, { type: "recommend" }, { type: "submit" });
  ok(s1.submitted !== null && s2.submitted === s1.submitted, "S6 送出只發生一次：之後的送出、時間到都不會產生第二次送出");
}

// ---- H 手牌參數 ----
const VALID = "D21,S32,S42,S51,C81,D81,H81,S81,CT1,DT1,HJ1,SK2,DA1";
const h = (p: string | undefined) => parseHandParam(p);
const distinct13 = (c: ReturnType<typeof h>) => !!c && c.length === 13 && new Set(c.map((x) => x.id)).size === 13;
ok(distinct13(h(VALID)), "H1 13 個有效且不同的牌號：收下");
ok(distinct13(h(` ${VALID.replaceAll(",", " , ")} `)) && distinct13(h(VALID.replaceAll(",", "，"))) && distinct13(h(VALID.toLowerCase())) && distinct13(h(VALID.replaceAll(",", "\t,\n"))),
  "H2 空白、全形逗號、小寫、Tab 換行等寫法：正規化後一樣收下，而且 13 張都不同");
ok(h(VALID.replace("D21", "S32")) === null && h(VALID.replace("D21", " S32 ")) === null && h(VALID.replace("D21", "s32")) === null, "H3 有重複（含空白、大小寫不同的重複）：先正規化再去重，去重後不足 13 張就拒絕（不會出現兩張同 id 的牌）");
ok(h(VALID.replace("D21", "ZZ9")) === null && h(VALID.replace("D21", "H22")) === null && h(VALID + ",") !== null, "H4 無效牌號（ZZ9、只有黑桃才有第二副的 H22）：拒絕；多一個結尾逗號不算錯");
ok(h(VALID.split(",").slice(0, 12).join(",")) === null && h(VALID + ",HA1") === null && h("") === null && h(undefined) === null && h(",,,") === null, "H5 不足 13 張、超過 13 張、空字串：拒絕，頁面改用預設手牌");
{
  let threw = "";
  for (const p of [VALID, ` ${VALID} `, VALID.replace("D21", "S32"), "SA1", ""]) {
    const c = h(p) ?? cards;
    try { run(initArrange(c), { type: "recommend" }); run(initArrange(c), { type: "timeout" }); } catch (e) { threw += `${p}: ${(e as Error).message}；`; }
  }
  ok(threw === "", `H6 不論參數怎麼寫，推薦排法、逾時送出都不拋錯${threw ? `（${threw}）` : ""}`);
}

// ---- R 快捷鈕選出的牌：牌型與加分由引擎判斷 ----
{
  const all = parseCards("AS AS AH AD KC KD QS JS TS 9S 2H 2D 7C"); // 湊得出七種快捷牌型
  let n = 0, bad = "";
  for (const sc of SHORTCUTS) {
    for (const pick of findCombos(all, sc.kind)) {
      // 選出的牌放進墩（不滿 5 張的用剩下的牌補滿），墩上的標籤要和引擎直接算的一樣
      const rest = all.filter((c) => !pick.includes(c));
      for (const row of ["front", "middle", "back"] as const) {
        if (pick.length > ROW_SIZE[row]) continue;
        const rowCards = [...pick, ...rest.slice(0, ROW_SIZE[row] - pick.length)];
        const v = evalRow(rowCards), bonus = bonusOf(row, v);
        const expect = `${row === "front" && v.cat === CAT.THREE_KIND ? "衝三" : CAT_NAME[v.cat]}${bonus ? ` +${bonus}` : ""}`;
        if (rowLabel(row, rowCards) !== expect) bad += `${sc.label}/${row}：${rowLabel(row, rowCards)}≠${expect}；`;
        n++;
      }
    }
  }
  ok(n > 30 && bad === "", `R1 七顆快捷鈕選出的每一組放進頭／中／尾墩：牌型與加分都等於引擎 evalRow／bonusOf 的結果（${n} 種放法）${bad}`);
  // 對子快捷鈕只負責「選牌」：選出一對放進中墩，墩的牌型看整墩（補進來的牌可能讓它變兩對、三條），由引擎決定
  const pair = findCombos(all, "pair")[0];
  const mid = [...pair, ...all.filter((c) => !pair.includes(c) && c.rank === 2), all.find((c) => c.rank === 7)!];
  ok(pair.length === 2 && rowLabel("middle", mid) === CAT_NAME[evalRow(mid).cat] && evalRow(mid).cat === CAT.TWO_PAIR, "R2 對子快捷鈕選出 A 對，放進中墩再補 2 對和 7：墩上標「兩對」（引擎判斷），不是「對子」");
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("❌")).length;
console.log(`合計：通過 ${results.length - failed}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
