// 房卡後台：回收。POST { userId, cards: 1～100000 的整數, opId } → { userId, balance, replay }。可以收到負數，沒有下限（老闆 2026-11-20）
// 只有老闆帳號能用。同一個 opId 重送只扣一次；同一個 opId 拿去做別的事 409 op_conflict
import { adjust } from "@/lib/roomCard/adjust";
export const POST = (request: Request) => adjust(request, "reclaim");
