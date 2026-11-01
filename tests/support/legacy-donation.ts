// 測試用：以場結清上線前的「記一筆＝自動抵扣」（mj_donation_record）。舊的抵扣／11/1 重置測試用它代替現在的記帳 API
// （記帳 API 已改成純打賞，2026-11-02），格式和舊 API 一樣回 { id, deduction }。這些測試在套用以場結清 migration 之前的資料庫上跑。
import { OWNER_USER_ID } from "../../lib/mahjong/zimoFx/rules";
import { addDonation, lineProfile } from "./stub-zimofx-store";

export async function legacyDonationsAdd(request: Request): Promise<Response> {
  const b = await request.json();
  const p = await lineProfile(b.userId);
  return Response.json(await addDonation(OWNER_USER_ID, { userId: b.userId, name: p?.name ?? "", avatarUrl: p?.avatarUrl ?? null, amount: b.amount, donatedAt: Date.parse(b.donatedAt), note: b.note ?? "" }));
}
