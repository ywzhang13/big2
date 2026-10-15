// 測試用：next/server 的 after()（回應送出後才跑的工作）在測試裡不跑——建房後的清理另有 flow-records 測
export function after(_fn: () => unknown) {}
