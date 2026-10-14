export const sent: { event: string; payload: Record<string, unknown> }[] = [];
export async function mjBroadcast(_c: string, event: string, payload: Record<string, unknown>) { sent.push({ event, payload }); }
export async function mjBroadcastBatch(_c: string, evs: { event: string; payload: Record<string, unknown> }[]) { sent.push(...evs); }
