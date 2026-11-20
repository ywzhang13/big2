// 房卡後台：充值。POST { userId, cards: 1～100000 的整數, opId: uuid（視窗打開時產生，重試用同一個） } → { userId, balance, replay }
// 只有老闆帳號能用。同一個 opId 重送只加一次、回第一次的餘額（replay: true）；同一個 opId 拿去做別的事 409 op_conflict
import { adjust } from "@/lib/roomCard/adjust";
export const POST = (request: Request) => adjust(request, "topup");
