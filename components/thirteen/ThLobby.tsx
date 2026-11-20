"use client";
// 十三支大廳：首頁沿用麻將大廳（.mjl-*，品牌＋回到房間／建立房間／加入房間／返回首頁）；
//   建立房間、加入房間用三款共用的元件（components/gameLobby，小宜〈共用開房流程 v1.1〉2026-11-19）：
//   建立：暱稱＋理牌時間（15～120 秒，每次 15）、局數 8／16／32、底分 30／50／100／200＋自訂 10～100000
//   加入：房號 4 碼＋暱稱
// 房卡第二批（小宜〈房卡 v1.2〉2-4、第 3 節）：被暫停時按鈕上面紅條「帳號已暫停」、建立／加入變灰不能按；「歷史紀錄」進總大廳紀錄的十三支頁籤
import { useState } from "react";
import { CreateRoomShell, JoinByCode, parseCustom, type LobbySection } from "@/components/gameLobby/GameLobby";
import { makeCard } from "@/lib/thirteen";
import type { MjAuthUser } from "@/hooks/useMjAuth";
import { AuthBar } from "@/components/mahjong/MjLobbyAuth";
import { useMyCards } from "@/components/roomCard/useMyCards";
import { cardSrc } from "./cardArt";
import { ARRANGE_DEFAULT, ARRANGE_MAX, ARRANGE_MIN, ARRANGE_STEP, normalizeArrangeSec } from "./arrangeTime";

export const HAND_OPTIONS = [8, 16, 32]; // 老闆 2026-11-18：開房局數只能選 8／16／32（伺服器其他值回 400）
/** 底分（老闆 2026-11-19）：每局分數＝墩數 × 底分；伺服器乘好再回傳，前端只顯示。預設四顆，更大或其他數字用「自訂」（10～100000 的整數） */
export const BASE_SCORE_OPTIONS = [30, 50, 100, 200];
export const BASE_SCORE_DEFAULT = 100;
export const BASE_SCORE_MIN = 10, BASE_SCORE_MAX = 100000;
/** 自訂底分：只收 10～100000 的整數，其他（空白、小數、超出範圍）回 null＝不能開房 */
export const parseBaseScore = (text: string): number | null => parseCustom(text, BASE_SCORE_MIN, BASE_SCORE_MAX);
/** 開房設定卡（共用外框照這個畫；順序照設計稿：理牌時間、局數、底分） */
export const TH_SECTIONS: LobbySection[] = [
  { kind: "stepper", key: "sec", title: "理牌時間", min: ARRANGE_MIN, max: ARRANGE_MAX, step: ARRANGE_STEP, unit: "秒", value: ARRANGE_DEFAULT, normalize: normalizeArrangeSec },
  { kind: "single", key: "hands", title: "局數", cols: 3, options: HAND_OPTIONS, unit: "局", value: 8 },
  { kind: "custom", key: "base", title: "底分", cols: 5, options: BASE_SCORE_OPTIONS, value: BASE_SCORE_DEFAULT, min: BASE_SCORE_MIN, max: BASE_SCORE_MAX },
];
const BRAND_CARDS = [makeCard("S", 14, 1), makeCard("H", 13, 1), makeCard("D", 12, 1)];

export function ThBrand() {
  return (
    <div className="mjl-brand">
      <span className="tiles">
        {BRAND_CARDS.map((c) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={c.id} src={cardSrc(c)} alt="" draggable={false} style={{ width: "var(--brand-tile-w)", height: "var(--brand-tile-h)", maxWidth: "none", borderRadius: 4 }} />
        ))}
      </span>
      <span className="rule" />
      <span className="txt">
        <h1>十三支</h1>
        <p>THIRTEEN · 4 PLAYERS</p>
      </span>
    </div>
  );
}

export default function ThLobby({ user, onSignOut, busy, error, resume, nameInit, onCreate, onJoin, onResume, onHome }: {
  user: MjAuthUser;
  onSignOut: () => void;
  busy: boolean;
  error: string;
  resume: { code: string; status: string } | null;
  /** 暱稱欄預設值（game_name → LINE 名稱前 8 個字） */
  nameInit: { name: string; fromLine: boolean };
  onCreate: (arrangeSec: number, totalHands: number, baseScore: number, name: string) => void;
  onJoin: (code: string, name: string) => void;
  onResume: (code: string) => void;
  onHome: () => void;
}) {
  const [screen, setScreen] = useState<"home" | "create" | "join">("home");
  const top = <AuthBar user={user} onSignOut={onSignOut} />;
  const sus = !!useMyCards(user)?.suspended;
  if (screen === "create") {
    return <CreateRoomShell className="mjl" attrs={{ "data-th-lobby": "create" }} brand={<ThBrand />} top={top} sections={TH_SECTIONS} initialName={nameInit} busy={busy} error={error}
      onCreate={(v, name) => onCreate(v.sec, v.hands, v.base, name)} onBack={() => setScreen("home")} />;
  }
  if (screen === "join") {
    return <JoinByCode className="mjl" brand={<ThBrand />} top={top} initialName={nameInit} busy={busy} error={error} onJoin={onJoin} onBack={() => setScreen("home")} />;
  }
  return (
    <div className="mjl mjl-lobby flex-1 bg-[#0f2a1a]" data-th-lobby="home">
      {top}
      <ThBrand />
      <div className="mjl-col">
        <div className="mjl-col fade-in">
          {resume && (
            <button onClick={() => onResume(resume.code)} disabled={busy} className="mjl-btn resume">
              {resume.status === "waiting" ? "你在房間等開局，" : "你有一局還沒打完，"}
              <b>回到房間 {resume.code}</b>
            </button>
          )}
          {sus && <div className="rc-ban" role="status" data-rc-suspended-ban>帳號已暫停</div>}
          <button onClick={() => setScreen("create")} disabled={sus} className={`mjl-btn primary${sus ? " rc-lock" : ""}`}>建立房間</button>
          <button onClick={() => setScreen("join")} disabled={sus} className={`mjl-btn second${sus ? " rc-lock" : ""}`}>加入房間</button>
          <a href="/records?game=thirteen" className="mjl-btn ghost text-center" data-th-records>歷史紀錄</a>
          <button onClick={onHome} className="mjl-foot">返回首頁</button>
        </div>
        {error && <p className="text-red-400 text-sm text-center fade-in">{error}</p>}
      </div>
    </div>
  );
}
