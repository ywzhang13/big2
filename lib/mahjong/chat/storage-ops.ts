// 語音 bucket 的列出、刪除、定期清除、整包清空（純邏輯：bucket 由呼叫端傳入，正式用 Supabase Storage，測試用假的）。
// Supabase Storage 的 list(prefix) 只列「直接底下」一層，一次最多一頁：資料夾的 id 是 null、檔案有 id 和 created_at。
// 一律先把整個範圍分頁列完、再刪（邊刪邊翻頁會讓位移錯開、漏掉後面的）；任何一頁出錯就丟錯，不會只清一半就當成完成。

export interface StorageEntry {
  name: string;
  id: string | null; // null＝資料夾
  created_at?: string | null;
}
export interface VoiceBucket {
  list(
    prefix: string,
    opts: { limit: number; offset: number; sortBy: { column: string; order: string } }
  ): Promise<{ data: StorageEntry[] | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

export const LIST_PAGE = 100;
const REMOVE_BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 列出 prefix 底下一層的全部項目（自動翻頁到最後一頁） */
export async function listAll(bucket: VoiceBucket, prefix: string): Promise<StorageEntry[]> {
  const all: StorageEntry[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`列出語音檔失敗（${prefix || "根目錄"}，第 ${offset / LIST_PAGE + 1} 頁）：${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < LIST_PAGE) return all;
  }
}

/** 列出 prefix 底下所有檔案的完整路徑（含更深的子資料夾）；olderThan 有給就只回比它早建立的 */
async function filesUnder(bucket: VoiceBucket, prefix: string, olderThan?: number): Promise<string[]> {
  const out: string[] = [];
  for (const e of await listAll(bucket, prefix)) {
    const full = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.id === null) out.push(...(await filesUnder(bucket, full, olderThan)));
    else if (olderThan === undefined || Date.parse(e.created_at ?? "") < olderThan) out.push(full);
  }
  return out;
}

async function removeAll(bucket: VoiceBucket, paths: string[]): Promise<number> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { error } = await bucket.remove(paths.slice(i, i + REMOVE_BATCH));
    if (error) throw new Error(`刪除語音檔失敗：${error.message}`);
  }
  return paths.length;
}

/** 刪掉一間房（一個資料夾）的語音檔；olderThan 有給就只刪比它早建立的。回傳刪了幾個 */
export async function removeFolder(bucket: VoiceBucket, roomId: string, olderThan?: number): Promise<number> {
  return removeAll(bucket, await filesUnder(bucket, roomId, olderThan));
}

/**
 * 定期清除：房間已經不在的資料夾整包刪、房間還在的刪超過 maxAgeMs 的檔；根目錄的散檔（不是這套程式放的）也刪。
 * 掃完全部資料夾（不限前 100 個）。existing 回傳哪些房間 id 還在。回傳刪掉幾個檔。
 */
export async function sweep(
  bucket: VoiceBucket,
  existing: (ids: string[]) => Promise<Set<string>>,
  nowMs: number,
  maxAgeMs: number
): Promise<number> {
  const root = await listAll(bucket, "");
  const folders = root.filter((e) => e.id === null).map((e) => e.name);
  const loose = root.filter((e) => e.id !== null).map((e) => e.name);
  // 房間 id 是 uuid；不像 uuid 的資料夾不是這套程式建的房間，當成房間已經不在
  const ids = folders.filter((f) => UUID.test(f));
  const open = new Set<string>();
  for (let i = 0; i < ids.length; i += LIST_PAGE) for (const id of await existing(ids.slice(i, i + LIST_PAGE))) open.add(id);
  let removed = await removeAll(bucket, loose);
  for (const f of folders) removed += await removeFolder(bucket, f, open.has(f) ? nowMs - maxAgeMs : undefined);
  return removed;
}

/** 回滾用：清空整個 bucket（全部資料夾、全部檔案）。回傳刪掉幾個檔 */
export async function purgeAll(bucket: VoiceBucket): Promise<number> {
  return removeAll(bucket, await filesUnder(bucket, ""));
}

/** 只列出（回滾腳本先給人確認用）：有幾個資料夾、幾個檔 */
export async function inventory(bucket: VoiceBucket): Promise<{ folders: number; files: number }> {
  const root = await listAll(bucket, "");
  return { folders: root.filter((e) => e.id === null).length, files: (await filesUnder(bucket, "")).length };
}
