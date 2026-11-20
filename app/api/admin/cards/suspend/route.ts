// 房卡後台：暫停。POST { userId, opId } → { userId, suspended: true, suspendedAt, replay }。不用填原因（老闆 2026-11-20）
// 被暫停的人不能開新房、不能加入新房；正在打的那一場照常打完、照常扣卡。已經暫停中再按一次不動
import { setSuspension } from "@/lib/roomCard/adjust";
export const POST = (request: Request) => setSuspension(request, true);
