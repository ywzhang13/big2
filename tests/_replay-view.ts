// 麻將回放播放器的小工具（components/mahjong/replay/replayView.ts）：到期文字、時間格式、播放間隔
import { clock, expiryText, stepDelay } from "../components/mahjong/replay/replayView";
import type { ReplayView } from "../lib/mahjong/replay/log";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

const H = 3_600_000;
const now = Date.parse("2026-11-13T06:30:00Z"); // 台北 14:30
const at = (ms: number) => new Date(now + ms).toISOString();

// 到期（小宜規格：大於 24 小時向上取整「剩 N 天到期」；0～24 小時「即將到期」＋台北時間）
check(expiryText(at(7 * 24 * H), now).text === "剩 7 天到期", "剛結束（剩整整 7 天）：剩 7 天到期");
check(expiryText(at(6 * 24 * H + 1), now).text === "剩 7 天到期", "剩 6 天又 1 毫秒：向上取整＝剩 7 天到期");
check(expiryText(at(25 * H), now).text === "剩 2 天到期", "剩 25 小時：剩 2 天到期");
{
  const e = expiryText(at(23 * H), now);
  check(e.text === "即將到期" && e.at === "到期：11/14 13:30", `剩 23 小時：即將到期＋台北時間（${e.at}）`);
}
check(expiryText(at(24 * H), now).text === "即將到期", "剛好剩 24 小時：即將到期");

// 時間
check(clock(0) === "00:00" && clock(134_900) === "02:14" && clock(3_725_000) === "62:05", "毫秒換成 mm:ss（不足一秒捨去、超過一小時照分鐘累加）");

// 播放間隔：照實際打牌的間隔，最短 0.3 秒、最長 3 秒，再除以倍速
const rec = { events: [{ t: 100 }, { t: 1600 }, { t: 61600 }, { t: 61700 }] } as unknown as ReplayView;
check(stepDelay(rec, 0, 1) === 300, "發牌→第一步只隔 0.1 秒：至少等 0.3 秒");
check(stepDelay(rec, 1, 1) === 1500, "隔 1.5 秒：照實際等 1.5 秒");
check(stepDelay(rec, 2, 1) === 3000, "有人想了 60 秒：最多等 3 秒，不讓回放卡住");
check(stepDelay(rec, 1, 2) === 750 && stepDelay(rec, 2, 4) === 750, "2×、4× 倍速：間隔除以倍速");

if (failed) process.exit(1);
