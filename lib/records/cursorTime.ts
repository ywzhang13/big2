// 分頁游標裡的時間（老柯 2026-11-20，審伯房卡第二批初審必修）：只收真的存在的日期、時間和時區，原字串原樣交給資料庫（保留六位小數秒）。
// 格式：YYYY-MM-DD（T 或空白）hh:mm:ss[.1～6 位] 再接 Z 或 ±hh[:mm]（資料庫回的 "+00"、"+00:00" 都收）。
// 會擋：13 月、2/30、平年 2/29、24 點以後、60 分、60 秒以後、時區超過 ±14:00 或分鐘 ≥ 60——這些以前會送進資料庫變成 500。
const TS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/;

export function isCursorTime(s: string): boolean {
  const m = TS.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  const oh = m[8] === undefined ? 0 : Number(m[8]), om = m[9] === undefined ? 0 : Number(m[9]);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return false;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return false; // 這個月的最後一天（含閏年）
  if (om > 59 || oh * 60 + om > 14 * 60) return false;
  return true;
}
