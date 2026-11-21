// 記下送出的事件；麻將事件照真的規則決定頻道（私人事件走座位頻道），記在 channel
import { routeEvents, withVersion } from "../../lib/mahjong/access";
export const sent: { event: string; payload: Record<string, unknown>; channel?: string }[] = [];
export async function mjBroadcast(code: string, event: string, payload: Record<string, unknown>, sv?: number) { sent.push(...routeEvents(code, withVersion([{ event, payload }], sv))); await mjBroadcastHooks.after?.(event, payload); }
/** 測試用（麻將開局確認的交錯，比照審伯 R2）：麻將送出某個廣播之後插進來的事 */
export const mjBroadcastHooks: { after?: (event: string, payload: Record<string, unknown>) => Promise<void> | void } = {};
export async function mjBroadcastBatch(code: string, evs: { event: string; payload: Record<string, unknown>; channel?: string }[], sv?: number) { sent.push(...routeEvents(code, withVersion(evs, sv))); }
// 大老二的廣播（lib/broadcast.ts）也記在同一份 sent 裡
export async function broadcast(_c: string, event: string, payload: Record<string, unknown>) { sent.push({ event, payload }); await big2BroadcastHooks.after?.(event, payload); }
/** 測試用（審伯 R2）：大老二送出某個廣播之後插進來的事（模擬廣播期間別人操作） */
export const big2BroadcastHooks: { after?: (event: string, payload: Record<string, unknown>) => Promise<void> | void } = {};
