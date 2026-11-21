// 麻將自摸特效「點了就存」的儲存佇列（審伯〈麻將共用設定面板初審〉R1、R2，2026-11-21）。
// 放在元件外面：同一頁只有一條（關閉面板不會清掉），所以關閉再打開、連點，在途的 POST 永遠最多一筆，最後存的一定是最後點的。
//   ・confirmed：伺服器確認過的「使用中」；null＝目前不確定（回應遺失又補抓失敗），畫面不標使用中
//   ・save：正在存（saving）、確定沒存成（failed）、不知道有沒有存成（unconfirmed）的那一張
//   ・POST 沒有明確成功或明確被拒（網路斷、500…）→ 用 GET 向伺服器確認；GET 也失敗就停在「未確認」，再點一次會重送
//   ・每一次 POST／GET 都記序號：發出之後如果已經有別的寫入完成或比它新的讀取發出，它回來的結果就不採用（舊的補抓不會蓋掉新的成功）
import type { MyZimoFx, Res, ZimoFxChoice } from "@/lib/mahjong/zimoFxClient";

export type FxSaveState = { code: ZimoFxChoice; state: "saving" | "failed" | "unconfirmed" } | null;
export interface FxSnapshot { data: MyZimoFx | null; confirmed: ZimoFxChoice | null; save: FxSaveState }
type IO = { get: () => Promise<Res<MyZimoFx>>; post: (fx: ZimoFxChoice) => Promise<Res<{ selected: ZimoFxChoice }>> };

const rejected = (r: Res<unknown>): ZimoFxChoice | null =>
  !r.ok && r.status === 403 && typeof r.body?.selected === "string" ? (r.body.selected as ZimoFxChoice) : null;

export function createZimoFxSaver(io: IO) {
  let snap: FxSnapshot = { data: null, confirmed: null, save: null };
  const listeners = new Set<() => void>();
  const set = (p: Partial<FxSnapshot>) => { snap = { ...snap, ...p }; listeners.forEach((l) => l()); };
  let wanted: ZimoFxChoice | null = null;
  let running = false;
  let version = 0; // 伺服器狀態每確認一次就加一（POST 成功、被拒、GET 採用）
  let readSeq = 0; // 每發一次 GET 加一：只採用最新那一次

  /** 向伺服器讀一次；發出後有別的確認或更新的讀取就不採用。回傳讀到的值（不採用、失敗回 undefined） */
  async function read(): Promise<ZimoFxChoice | null | undefined> {
    const mySeq = ++readSeq, myVer = version;
    const r = await io.get();
    // 沒登入 LINE（401／403）：沒有自摸特效頁，清掉前一個帳號留下的清單
    if (!r.ok && (r.status === 401 || r.status === 403) && mySeq === readSeq) { set({ data: null, confirmed: null }); return undefined; }
    if (!r.ok || mySeq !== readSeq || myVer !== version) return undefined;
    version++;
    set({ data: r.data, confirmed: r.data.selected ?? "golden" });
    return snap.confirmed;
  }

  async function pump() {
    running = true;
    try {
      while (wanted && wanted !== snap.confirmed) {
        const code = wanted;
        set({ save: { code, state: "saving" } });
        const r = await io.post(code);
        if (r.ok) { version++; set({ confirmed: r.data.selected, data: snap.data && { ...snap.data, selected: r.data.selected } }); continue; }
        const now = rejected(r);
        if (now) {
          // 被拒（剛好被收回）：照伺服器說的改回實際套用的那一種，再補抓一次清單（補抓在佇列裡做完，後面的 POST 才送）
          version++;
          set({ confirmed: now, data: snap.data && { ...snap.data, selected: now } });
          if (wanted === code) { wanted = null; set({ save: { code, state: "failed" } }); }
          await read();
          continue;
        }
        // 不確定有沒有寫進去：先不標任何使用中、這張標「未確認」（審伯複審：補抓回來之前不能沿用舊快取），再問伺服器
        set({ confirmed: null, save: { code, state: "unconfirmed" } });
        const got = await read();
        if (got === undefined) {
          // 補抓也失敗：不知道伺服器現在是什麼，不標使用中；這張標「未確認」，再點一次會重送
          set({ confirmed: null, save: { code, state: "unconfirmed" } });
          if (wanted === code) wanted = null;
          continue;
        }
        if (wanted === code) {
          wanted = null;
          set({ save: got === code ? null : { code, state: "failed" } });
        }
      }
      if (wanted === snap.confirmed) { wanted = null; if (snap.save?.state === "saving") set({ save: null }); }
    } finally {
      running = false;
    }
  }

  return {
    /** 打開面板時讀一次（佇列在跑就不讀，跑完的結果就是最新的） */
    load: async () => { if (!running) await read(); },
    /** 點卡片：記下最後點的；沒有在送就開始送（已是使用中的不送） */
    choose(code: ZimoFxChoice) {
      if (!snap.data || !(code in snap.data.available)) return;
      wanted = code;
      if (snap.save && snap.save.code !== code && snap.save.state !== "saving") set({ save: null });
      if (!running) void pump();
    },
    get: (): FxSnapshot => snap,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}
