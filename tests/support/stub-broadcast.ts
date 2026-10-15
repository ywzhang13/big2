// 記下送出的事件；麻將事件照真的規則決定頻道（私人事件走座位頻道），記在 channel
import { routeEvents } from "../../lib/mahjong/access";
export const sent: { event: string; payload: Record<string, unknown>; channel?: string }[] = [];
export async function mjBroadcast(code: string, event: string, payload: Record<string, unknown>) { sent.push(...routeEvents(code, [{ event, payload }])); }
export async function mjBroadcastBatch(code: string, evs: { event: string; payload: Record<string, unknown> }[]) { sent.push(...routeEvents(code, evs)); }
// 大老二的廣播（lib/broadcast.ts）也記在同一份 sent 裡
export async function broadcast(_c: string, event: string, payload: Record<string, unknown>) { sent.push({ event, payload }); }
