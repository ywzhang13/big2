// 麻將開房設定卡（給三款共用的 CreateRoomShell；小宜〈共用開房流程 v1.1〉§5-2）：
//   圈數一列 4 顆、底一列 4 顆、每台一列 3 顆；卡片只有標題和選項（沒有「每圈4局」這類副標，下面也沒有公式）。
//   預設照麻將原本的開房：1 圈、底 100、每台 20。回傳的代號：rounds、base、fan
import type { LobbySection } from "@/components/gameLobby/GameLobby";

export const MJ_SECTIONS: LobbySection[] = [
  { kind: "single", key: "rounds", title: "圈數", cols: 4, options: [1, 2, 4, 8], unit: "圈", value: 1 },
  { kind: "single", key: "base", title: "底", cols: 4, options: [30, 50, 100, 200, 300, 500, 600, 1000], value: 100 },
  { kind: "single", key: "fan", title: "每台", cols: 3, options: [10, 20, 30, 50, 100, 200], value: 20 },
];
