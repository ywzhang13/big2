// 語音 bucket 的清除邏輯（lib/mahjong/chat/storage-ops.ts）：用照 Supabase Storage 規則分頁的假 bucket 測邊界。
//   假 bucket：list(prefix) 只列直接底下一層、照名字排序、一頁最多 limit 筆；資料夾 id 是 null、檔案有 id 和 created_at
//   S1 定期清除超過 100 個資料夾（250 個房間已經不在＋3 個還在）：全部掃到；房間還在的只刪超過 24 小時的；根目錄散檔、不像房間 id 的資料夾也清
//   S2 查「房間還在不在」分批（每批最多 100 個 id）
//   S3 一個房間超過 100 個檔（關房刪除）：全部刪掉
//   S4 列出到一半出錯：丟錯，而且一個都沒刪（先列完再刪，不會只清一半就當成完成）；刪除出錯也丟錯
//   S5 回滾清空（purgeAll）：多個資料夾、每個超過一頁、還有更深一層的子資料夾，全部清光；inventory 數字正確
//   S6 前 120 個資料夾都要保留、要刪的排在後段：一次 sweep 就刪到
//   S7 根目錄超過 1000 項、單一資料夾超過 1000 個檔：只列出數量正確且不刪，清空後全數刪光
import { LIST_PAGE, inventory, purgeAll, removeFolder, sweep, type StorageEntry, type VoiceBucket } from "../lib/mahjong/chat/storage-ops";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const NOW = Date.parse("2026-10-23T12:00:00Z"), DAY = 24 * 60 * 60 * 1000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** 假 bucket：files＝完整路徑 → 建立時間 */
function fakeBucket(files: Map<string, number>, opts: { failList?: (prefix: string, offset: number) => boolean; failRemove?: () => boolean } = {}) {
  const log = { lists: [] as string[], removes: 0 };
  const bucket: VoiceBucket = {
    async list(prefix, { limit, offset }) {
      log.lists.push(`${prefix}@${offset}`);
      if (opts.failList?.(prefix, offset)) return { data: null, error: { message: "模擬網路錯誤" } };
      const base = prefix ? prefix + "/" : "";
      const kids = new Map<string, StorageEntry>();
      for (const [p, t] of files) {
        if (!p.startsWith(base)) continue;
        const rest = p.slice(base.length), slash = rest.indexOf("/");
        if (slash >= 0) kids.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null });
        else kids.set(rest, { name: rest, id: "id-" + p, created_at: new Date(t).toISOString() });
      }
      const sorted = [...kids.values()].sort((a, b) => a.name.localeCompare(b.name));
      return { data: sorted.slice(offset, offset + Math.min(limit, 100)), error: null };
    },
    async remove(paths) {
      log.removes++;
      if (opts.failRemove?.()) return { error: { message: "模擬刪除失敗" } };
      if (paths.length > 1000) return { error: { message: "一次刪太多" } };
      for (const p of paths) files.delete(p);
      return { error: null };
    },
  };
  return { bucket, log };
}

// S1、S2
{
  const files = new Map<string, number>();
  for (let i = 0; i < 250; i++) files.set(`${uuid(i)}/a.m4a`, NOW - 60000); // 房間已經不在
  for (const r of [900, 901, 902]) { files.set(`${uuid(r)}/old.m4a`, NOW - DAY - 1000); files.set(`${uuid(r)}/new.m4a`, NOW - 1000); }
  files.set("loose.m4a", NOW); files.set("not-a-room/x.m4a", NOW);
  const batches: number[] = [];
  const existing = async (ids: string[]) => { batches.push(ids.length); return new Set(ids.filter((id) => [uuid(900), uuid(901), uuid(902)].includes(id))); };
  const { bucket } = fakeBucket(files);
  const removed = await sweep(bucket, existing, NOW, DAY);
  eq([removed, [...files.keys()].sort()], [250 + 3 + 2, [`${uuid(900)}/new.m4a`, `${uuid(901)}/new.m4a`, `${uuid(902)}/new.m4a`]],
    "S1 254 個資料夾（超過一頁 100 個）全部掃到：250 個房間已經不在的整包刪、3 個還在的只刪超過 24 小時的、根目錄散檔和不像房間 id 的資料夾也清");
  eq([batches, Math.max(...batches) <= LIST_PAGE], [[100, 100, 53], true], "S2 查房間還在不在：分 3 批（100、100、53 個 id），每批不超過 100");
}
// S3
{
  const files = new Map<string, number>();
  for (let i = 0; i < 230; i++) files.set(`${uuid(1)}/v${String(i).padStart(3, "0")}.m4a`, NOW);
  files.set(`${uuid(2)}/keep.m4a`, NOW);
  const { bucket, log } = fakeBucket(files);
  const n = await removeFolder(bucket, uuid(1));
  eq([n, [...files.keys()], log.lists.filter((l) => l.startsWith(uuid(1))).length], [230, [`${uuid(2)}/keep.m4a`], 3],
    "S3 關房刪除：一個房間 230 個檔（3 頁）全部刪掉，別的房間不動");
}
// S4
{
  const files = new Map<string, number>();
  for (let i = 0; i < 150; i++) files.set(`${uuid(i)}/a.m4a`, NOW);
  const before = files.size;
  const { bucket } = fakeBucket(files, { failList: (prefix, offset) => prefix === "" && offset === 100 });
  let err = "";
  try { await sweep(bucket, async () => new Set(), NOW, DAY); } catch (e) { err = (e as Error).message; }
  eq([err.includes("第 2 頁"), files.size], [true, before], "S4a 定期清除列到第 2 頁出錯：丟錯（訊息帶頁數），一個都沒刪");
  const p = fakeBucket(files, { failList: (prefix, offset) => prefix === uuid(120) && offset === 0 });
  err = "";
  try { await purgeAll(p.bucket); } catch (e) { err = (e as Error).message; }
  eq([err.includes(uuid(120)), files.size], [true, before], "S4b 回滾清空時某個資料夾列不出來：丟錯，一個都沒刪（不會清一半就刪 bucket）");
  let calls = 0;
  const r = fakeBucket(files, { failRemove: () => ++calls === 2 });
  err = "";
  try { await purgeAll(r.bucket); } catch (e) { err = (e as Error).message; }
  eq([err.includes("刪除語音檔失敗"), files.size], [true, 50], "S4c 第 2 批刪除失敗：丟錯（第 1 批 100 個已刪、剩 50 個，重跑會繼續清）");
}
// S5
{
  const files = new Map<string, number>();
  for (const r of [10, 11, 12]) for (let i = 0; i < 150; i++) files.set(`${uuid(r)}/v${String(i).padStart(3, "0")}.m4a`, NOW);
  files.set(`${uuid(13)}/sub/deep.m4a`, NOW);
  files.set("loose.m4a", NOW);
  const { bucket } = fakeBucket(files);
  const inv = await inventory(bucket);
  const removed = await purgeAll(bucket);
  eq([inv, removed, files.size, await inventory(bucket)], [{ folders: 4, files: 452 }, 452, 0, { folders: 0, files: 0 }],
    "S5 回滾清空：4 個資料夾（3 個各 150 個檔、1 個有子資料夾）＋根目錄散檔，共 452 個全部刪光");
}

// S6（審伯的修好標準）：前 120 個資料夾都是還開著、沒過期的房間（要保留），要刪的都排在後段
{
  const files = new Map<string, number>();
  for (let i = 0; i < 120; i++) files.set(`${uuid(i)}/keep.m4a`, NOW - 1000);
  for (let i = 120; i < 130; i++) files.set(`${uuid(i)}/gone.m4a`, NOW - 1000); // 房間已經不在
  for (let i = 130; i < 135; i++) { files.set(`${uuid(i)}/old.m4a`, NOW - DAY - 1); files.set(`${uuid(i)}/new.m4a`, NOW - 1000); }
  const alive = new Set([...Array(120).keys(), ...[130, 131, 132, 133, 134]].map(uuid));
  const { bucket } = fakeBucket(files);
  const removed = await sweep(bucket, async (ids) => new Set(ids.filter((id) => alive.has(id))), NOW, DAY);
  const left = [...files.keys()];
  eq([removed, left.length, left.filter((k) => k.endsWith("/keep.m4a")).length, left.filter((k) => k.endsWith("/new.m4a")).length, left.some((k) => /gone|old/.test(k))],
    [15, 125, 120, 5, false], "S6 前 120 個資料夾都要保留、要刪的排在後段：一次 sweep 就把後段 10 個已關房、5 個超過 24 小時的刪掉，保留的 125 個一個不少");
}
// S7（審伯的修好標準）：根目錄超過 1000 項、單一資料夾超過 1000 個檔：先列出（dry-run）數量對，清空後一個不剩
{
  const files = new Map<string, number>();
  for (let i = 0; i < 1050; i++) files.set(`${uuid(i)}/a.m4a`, NOW);
  for (let i = 0; i < 1203; i++) files.set(`${uuid(5000)}/v${String(i).padStart(4, "0")}.m4a`, NOW);
  const { bucket } = fakeBucket(files);
  const dry = await inventory(bucket);
  const sizeAfterDry = files.size;
  const removed = await purgeAll(bucket);
  eq([dry, sizeAfterDry, removed, files.size, await inventory(bucket)], [{ folders: 1051, files: 2253 }, 2253, 2253, 0, { folders: 0, files: 0 }],
    "S7 根目錄 1051 個資料夾、其中一個有 1203 個檔：只列出時數量正確（1051 個資料夾、2253 個檔）且沒刪任何東西；清空後全數刪光");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
