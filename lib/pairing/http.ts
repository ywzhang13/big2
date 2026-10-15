// 登入交接三支路由共用的回應格式
export const NO_STORE = { "Cache-Control": "no-store" }; // 回應含代碼或登入憑證，不能被快取

export function failResponse(f: { status: number; error: string; retryAfter?: number }): Response {
  return Response.json(
    { error: f.error, ...(f.retryAfter ? { retryAfter: f.retryAfter } : {}) },
    { status: f.status, headers: { ...NO_STORE, ...(f.retryAfter ? { "Retry-After": String(f.retryAfter) } : {}) } }
  );
}
