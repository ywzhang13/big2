export const sent: { event: string; payload: Record<string, unknown> }[] = [];
export async function mjBroadcast(_c: string, event: string, payload: Record<string, unknown>) { sent.push({ event, payload }); }
export async function mjBroadcastBatch(_c: string, evs: { event: string; payload: Record<string, unknown> }[]) { sent.push(...evs); }
// 大老二的廣播（lib/broadcast.ts）也記在同一份 sent 裡
export async function broadcast(_c: string, event: string, payload: Record<string, unknown>) { sent.push({ event, payload }); }
