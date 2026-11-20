// 房卡後台：恢復。POST { userId, opId } → { userId, suspended: false, suspendedAt: null, replay }。沒暫停中再按一次不動
import { setSuspension } from "@/lib/roomCard/adjust";
export const POST = (request: Request) => setSuspension(request, false);
