// 測試用（老柯 2026-11-27）：取代 "@/lib/supabase"，給 hooks/useGame.ts 一個假的 Realtime 頻道。
// 測試用 emit(event, payload) 假裝收到廣播；不連任何服務。
export const handlers = {};
export const channels = { live: 0 };
export function emit(event, payload) {
  const fn = handlers[event];
  if (!fn) throw new Error(`沒有訂閱 ${event}`);
  fn({ payload });
}
export function getSupabase() {
  return {
    channel: () => {
      channels.live++;
      const ch = {
        on: (_type, filter, fn) => { handlers[filter.event] = fn; return ch; },
        subscribe: (cb) => { cb("SUBSCRIBED"); return ch; },
      };
      return ch;
    },
    removeChannel: () => { channels.live--; },
  };
}
