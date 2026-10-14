// 座位風位：開門那家是東，接著 南、西、北（和後端算台 refSeat = doorSeat ?? dealerSeat 一致）
const WIND_CHARS = ["東", "南", "西", "北"];

export function seatWindChar(seat: number, doorSeat: number | undefined, dealerSeat: number): string {
  if (seat < 0) return "?";
  const ref = doorSeat ?? dealerSeat;
  return WIND_CHARS[(seat - ref + 4) % 4];
}
