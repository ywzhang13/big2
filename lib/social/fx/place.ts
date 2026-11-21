// 道具選單貼在名牌旁邊（小宜〈十三支共用聊天互動 v1〉§4-1）：位置由遊戲指定（哪一邊、垂直怎麼對齊），這裡只算座標。
// 麻將的放法（對家橫排、避開海底）在 lib/mahjong/fx/menu.ts placeFxMenu，麻將這次不換。
//   side＝選單在名牌的哪一邊：right＝名牌右緣 +7（箭頭朝左）、left＝名牌左緣 −7（箭頭朝右）
//   align＝center：垂直置中於名牌；top：上緣對齊名牌上緣
// 超出畫面時夾回邊緣 4px 內。提示（冷卻中、理牌中…）放名牌下方、和名牌同寬；名牌下面有別的東西（十三支的「思考中」泡泡）就放在它下面 +6。
import type { Box } from "../anchors";

export const MENU_GAP = 7;
const EDGE = 4;
export type MenuSide = "left" | "right";
export type MenuAlign = "center" | "top";
export type MenuPlacement = { side: MenuSide; align: MenuAlign };

export type SocialMenuPlace = {
  left: number;
  top: number;
  /** 箭頭在選單的哪一邊（朝著名牌）：l 左、r 右 */
  arrowSide: "l" | "r";
  /** 箭頭從選單上緣算的位置（px） */
  arrow: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

export function placeBesidePlate(p: MenuPlacement, plate: Box, w: number, h: number, vw: number, vh: number): SocialMenuPlace {
  const cy = (plate.top + plate.bottom) / 2;
  const rawLeft = p.side === "right" ? plate.right + MENU_GAP : plate.left - MENU_GAP - w;
  const rawTop = p.align === "top" ? plate.top : cy - h / 2;
  const left = clamp(rawLeft, EDGE, Math.max(EDGE, vw - w - EDGE));
  const top = clamp(rawTop, EDGE, Math.max(EDGE, vh - h - EDGE));
  return { left, top, arrowSide: p.side === "right" ? "l" : "r", arrow: clamp(cy - top, 12, h - 12) };
}

/** 提示的位置：名牌下方 +6、和名牌同寬；below＝名牌下面還掛著別的東西（例如思考中泡泡），就放在它下面 +6 */
export function noteUnderPlate(plate: Box, below: Box | null): { left: number; top: number; width: number } {
  return { left: plate.left, top: Math.max(plate.bottom, below?.bottom ?? -Infinity) + 6, width: plate.right - plate.left };
}
