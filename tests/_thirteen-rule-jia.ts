// 十三支計分甲案（老闆 2026-11-19 定案）：特殊牌型那一墩只算規則表上的數字，不再加那一墩基本的 1；其他牌型照舊 1 墩；打槍、全壘打不變。
//   J1 每種特殊牌型輸一家各付幾墩：頭墩衝三 2、中墩鐵支 4、中墩同花順 6、中墩五龍 8、尾墩鐵支 2、尾墩同花順 3、尾墩五龍 4；
//      中墩葫蘆（不是特殊牌型）、一般牌型 1
//   J2 被衝三又被打槍：5 墩（衝三 2＋中墩 1＋尾墩 1＋打槍 1；改之前是 6）
//   J3 老闆截圖那一局（2026-11-19）照新規則重算：Ming +7、張育瑋 −3、偉鉅 −4、莊子緣 0（改之前 +8、−6、−4、+2），四家總和 0
//   J4 左欄明細 handStats：「墩分」只算一般墩、特殊牌型那一行是表上數字（被衝三每家 −2），各項加總＝本局墩數
// 做法：兩家只有要比的那一墩不同、另外兩墩點數一樣（不比花色＝平手），那一組的分數就是這一墩的墩數。
import { makeCard, type Card } from "../lib/thirteen/cards";
import { scoreRound } from "../lib/thirteen/score";
import { handStats } from "../lib/thirteen/flow";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const R: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
let n = 0;
const c = (s: string): Card => makeCard(s[0] as Card["suit"], R[s.slice(1)] ?? Number(s.slice(1)), (n++ % 2 + 1) as 1 | 2);
const cards = (s: string) => s.split(" ").map(c);
const hand = (f: string, m: string, b: string) => ({ front: cards(f), middle: cards(m), back: cards(b) });
/** 座位 0 對座位 1 拿幾墩（另外兩家照抄座位 1） */
function pair01(p0: ReturnType<typeof hand>, p1: ReturnType<typeof hand>): number {
  const r = scoreRound([p0, p1, p1, p1]);
  return r.pairs.find((p) => p.a === 0 && p.b === 1)!.points;
}
const LOW_FRONT = "C2 D3 H5", MID = "C4 D5 H6 S7 C8", BACK = "C9 DT HJ SQ CK", FIVE_A = "CA DA HA SA SA";

// J1
const cases: [string, number, ReturnType<typeof hand>, ReturnType<typeof hand>][] = [
  ["頭墩衝三", 2, hand("C5 D5 H5", MID, FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
  ["中墩鐵支", 4, hand(LOW_FRONT, "C7 D7 H7 S7 C2", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
  ["中墩同花順", 6, hand(LOW_FRONT, "H4 H5 H6 H7 H8", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
  ["中墩五龍", 8, hand(LOW_FRONT, "CK DK HK SK SK", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
  ["尾墩鐵支", 2, hand(LOW_FRONT, MID, "C9 D9 H9 S9 C3"), hand(LOW_FRONT, MID, BACK)],
  ["尾墩同花順", 3, hand(LOW_FRONT, MID, "S9 ST SJ SQ SK"), hand(LOW_FRONT, MID, BACK)],
  ["尾墩五龍", 4, hand(LOW_FRONT, MID, FIVE_A), hand(LOW_FRONT, MID, BACK)],
  ["中墩葫蘆（不是特殊牌型）", 1, hand(LOW_FRONT, "C7 D7 H7 S2 C2", FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
  ["頭墩一對（一般）", 1, hand("C9 D9 H5", MID, FIVE_A), hand(LOW_FRONT, MID, FIVE_A)],
];
eq(cases.map(([name, , p0, p1]) => [name, pair01(p0, p1)]), cases.map(([name, want]) => [name, want]),
  "J1 每種牌型輸一家付幾墩：衝三 2、中鐵支 4、中同花順 6、中五龍 8、尾鐵支 2、尾同花順 3、尾五龍 4；中墩葫蘆、一般牌型 1");

// J2
{
  const shooter = hand("C5 D5 H5", "C5 D6 H7 S8 C9", "CT DJ HQ SK CA");
  const victim = hand(LOW_FRONT, MID, BACK);
  const r = scoreRound([shooter, victim, victim, victim]);
  const p = r.pairs.find((x) => x.a === 0 && x.b === 1)!;
  eq([p.gunner, p.points], [0, 5], "J2 被衝三又被打槍：衝三 2＋中墩 1＋尾墩 1＋打槍 1＝5 墩（改之前 6）");
}

// J3 老闆截圖那一局
{
  const arr = [
    hand("SK HQ DT", "S7 S7 SK S8 S6", "SA SK SQ SJ ST"),
    hand("D7 H7 D9", "CA CJ CT C4 C2", "H3 S3 S3 HQ DQ"),
    hand("S5 H5 S5", "CJ CT S9 C8 C7", "HA HK H6 H4 H2"),
    hand("C9 H9 S9", "DA SK SQ HJ HT", "SA S8 S6 S5 S4"),
  ];
  const r = scoreRound(arr);
  eq([r.totals, r.totals.reduce((a, b) => a + b, 0)], [[7, -3, -4, 0], 0], "J3 截圖那一局新規則：Ming +7、張育瑋 −3、偉鉅 −4、莊子緣 0（改之前 +8、−6、−4、+2），四家總和 0");
  // J4：張育瑋的左欄
  const st = handStats(r)[1];
  eq({ rows: st.rows, bonuses: st.bonuses, total: st.total, sum: st.rows + st.bonuses.reduce((a, b) => a + b.points, 0) + st.gunPoints + st.homeRunPoints },
    { rows: 4, bonuses: [{ name: "尾墩同花順", points: -3 }, { name: "衝三", points: -4 }], total: -3, sum: -3 },
    "J4 張育瑋左欄：墩分 +4（只算一般墩：對 Ming 頭墩 +1、中墩 −1；對偉鉅、莊子緣中尾墩各 +2）、被尾墩同花順 −3、被衝三 −4（兩家各 −2），合計 −3");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
