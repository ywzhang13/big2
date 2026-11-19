"use client";
// 十三支大廳：版面和按鈕直接沿用麻將大廳（app/mahjong/page.tsx 的 .mjl-* 結構與樣式，老闆 2026-11-18：三個遊戲的大廳要同一套風格）
//   首頁：品牌（三張牌＋十三支）＋右欄按鈕（回到房間／建立房間／加入房間／返回首頁）
//   建立房間：理牌時間（15～120 秒，可直接輸入、「＋」加 15 秒）、局數、底分，同麻將的設定卡和選項鈕
//   加入房間：4 位數房號
import { useState } from "react";
import { makeCard } from "@/lib/thirteen";
import type { MjAuthUser } from "@/hooks/useMjAuth";
import { AuthBar } from "@/components/mahjong/MjLobbyAuth";
import { cardSrc } from "./cardArt";
import { ARRANGE_DEFAULT, ARRANGE_MAX, ARRANGE_MIN, minusArrangeSec, normalizeArrangeSec, plusArrangeSec } from "./arrangeTime";

export const HAND_OPTIONS = [8, 16, 32]; // 老闆 2026-11-18：開房局數只能選 8／16／32（伺服器其他值回 400）
/** 底分（老闆 2026-11-19）：每局分數＝墩數 × 底分；伺服器乘好再回傳，前端只顯示。預設四顆，更大或其他數字用「自訂」（10～100000 的整數） */
export const BASE_SCORE_OPTIONS = [30, 50, 100, 200];
export const BASE_SCORE_DEFAULT = 100;
export const BASE_SCORE_MIN = 10, BASE_SCORE_MAX = 100000;
/** 自訂底分：只收 10～100000 的整數，其他（空白、小數、超出範圍）回 null＝不能開房 */
export function parseBaseScore(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= BASE_SCORE_MIN && n <= BASE_SCORE_MAX ? n : null;
}
const BRAND_CARDS = [makeCard("S", 14, 1), makeCard("H", 13, 1), makeCard("D", 12, 1)];
const CARD_BOX = { background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)", border: "1px solid rgba(201,169,110,0.15)" };
const OPT = "mjl-opt py-2.5 rounded-xl text-base font-bold cursor-pointer transition-all duration-150 active:scale-95";
const OPT_ON = "bg-[#C9A96E] text-[#0f2a1a] shadow-lg shadow-[#C9A96E]/20";
const OPT_OFF = "bg-white/5 text-white/60 hover:bg-white/10 border border-white/5";

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

export default function ThLobby({ user, onSignOut, busy, error, resume, onCreate, onJoin, onHome }: {
  user: MjAuthUser;
  onSignOut: () => void;
  busy: boolean;
  error: string;
  resume: { code: string; status: string } | null;
  onCreate: (arrangeSec: number, totalHands: number, baseScore: number) => void;
  onJoin: (code: string) => void;
  onHome: () => void;
}) {
  const [screen, setScreen] = useState<"home" | "create" | "join">("home");
  const [secText, setSecText] = useState(String(ARRANGE_DEFAULT));
  const [hands, setHands] = useState(8);
  const [base, setBase] = useState(BASE_SCORE_DEFAULT);
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const baseScore = custom ? parseBaseScore(customText) : base; // null＝自訂的數字不合法，不能開房
  const [code, setCode] = useState("");
  const sec = normalizeArrangeSec(secText);

  return (
    <div className={`mjl mjl-lobby flex-1 bg-[#0f2a1a]${screen === "create" ? " is-create" : ""}`} data-th-lobby={screen}>
      <AuthBar user={user} onSignOut={onSignOut} />
      <ThBrand />
      <div className={`mjl-col${screen === "create" ? " mjl-form" : ""}`}>
        {screen === "home" ? (
          <div className="mjl-col fade-in">
            {resume && (
              <button onClick={() => onJoin(resume.code)} disabled={busy} className="mjl-btn resume">
                {resume.status === "waiting" ? "你在房間等開局，" : "你有一局還沒打完，"}
                <b>回到房間 {resume.code}</b>
              </button>
            )}
            <button onClick={() => setScreen("create")} className="mjl-btn primary">建立房間</button>
            <button onClick={() => setScreen("join")} className="mjl-btn second">加入房間</button>
            <button onClick={onHome} className="mjl-foot">返回首頁</button>
          </div>
        ) : screen === "create" ? (
          <div className="mjl-create flex flex-col gap-4 w-full fade-in">
            <div className="mjl-cgrid flex flex-col gap-3">
              <div className="mjl-cset">
                <div className="mjl-card rounded-2xl p-4" style={CARD_BOX}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">理牌時間</span>
                    <span className="mjl-sub text-white/40 text-xs">{ARRANGE_MIN}～{ARRANGE_MAX} 秒</span>
                  </div>
                  <div className="grid grid-cols-[auto_1fr_auto] gap-2">
                    <button data-th-sec-minus aria-label="減 15 秒" disabled={sec <= ARRANGE_MIN}
                      onClick={() => setSecText(String(minusArrangeSec(sec)))}
                      style={{ minWidth: 56 }}
                      className={`${OPT} ${OPT_OFF} px-5 text-xl disabled:opacity-30 disabled:cursor-not-allowed`}>−</button>
                    <label className={`${OPT} ${OPT_ON} flex items-center justify-center gap-1 cursor-text`}>
                      <input
                        data-th-sec
                        type="text"
                        inputMode="numeric"
                        aria-label="理牌秒數"
                        value={secText}
                        onChange={(e) => setSecText(e.target.value.replace(/\D/g, "").slice(0, 3))}
                        onBlur={() => setSecText(String(sec))}
                        className="w-14 bg-transparent text-center outline-none font-bold"
                      />
                      <span className="text-sm">秒</span>
                    </label>
                    <button data-th-sec-plus aria-label="加 15 秒" disabled={sec >= ARRANGE_MAX}
                      onClick={() => setSecText(String(plusArrangeSec(sec)))}
                      style={{ minWidth: 56 }} /* 麻將的 .mjl-opt 在手機橫向 padding 0，不給寬度會縮成一條 */
                      className={`${OPT} ${OPT_OFF} px-5 text-xl disabled:opacity-30 disabled:cursor-not-allowed`}>＋</button>
                  </div>
                </div>
              </div>
              <div className="mjl-cset">
                <div className="mjl-card rounded-2xl p-4" style={CARD_BOX}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">局數</span>
                    <span className="mjl-sub text-white/40 text-xs">4 人 · 65 張</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {HAND_OPTIONS.map((n) => (
                      <button key={n} data-th-hands={n} onClick={() => setHands(n)} className={`${OPT} ${hands === n ? OPT_ON : OPT_OFF}`}>{n}局</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mjl-cset">
                <div className="mjl-card rounded-2xl p-4" style={CARD_BOX}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">底分</span>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1.5fr] gap-2">
                    {BASE_SCORE_OPTIONS.map((n) => (
                      <button key={n} data-th-base={n} aria-pressed={!custom && base === n} onClick={() => { setBase(n); setCustom(false); }} className={`${OPT} ${!custom && base === n ? OPT_ON : OPT_OFF}`}>{n}</button>
                    ))}
                    {custom ? (
                      <label className={`${OPT} ${OPT_ON} flex items-center justify-center cursor-text${baseScore === null ? " ring-2 ring-red-400/70" : ""}`}>
                        <input data-th-base-custom type="text" inputMode="numeric" aria-label="自訂底分" autoFocus value={customText}
                          onChange={(e) => setCustomText(e.target.value.slice(0, 8))} // 不偷刪字元（小測 2026-11-19：12.5 曾被刪成 125 還能開房）；照原樣交給 parseBaseScore 判斷
                          className="w-full min-w-0 bg-transparent text-center outline-none font-bold" />
                      </label>
                    ) : (
                      <button data-th-base="custom" aria-pressed={false} onClick={() => setCustom(true)} className={`${OPT} ${OPT_OFF}`}>自訂</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <button data-th-create onClick={() => { if (baseScore !== null) onCreate(sec, hands, baseScore); }} disabled={busy || baseScore === null}
              className="mjl-go w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg cursor-pointer active:scale-95 transition-all duration-150 hover:brightness-110 disabled:opacity-60 disabled:cursor-wait">
              {busy ? "建立中..." : "建立房間"}
            </button>
            <button onClick={() => setScreen("home")} className="mjl-back text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors">返回</button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full fade-in">
            <input
              data-th-code
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="房間碼 (4位數)"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && /^\d{4}$/.test(code) && !busy) onJoin(code); }}
              className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-2xl tracking-[0.5em] placeholder:text-white/30 placeholder:tracking-normal placeholder:text-base outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
            />
            <button data-th-join onClick={() => onJoin(code)} disabled={busy || !/^\d{4}$/.test(code)}
              className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg cursor-pointer active:scale-95 transition-all duration-150 hover:brightness-110 disabled:opacity-60 disabled:cursor-wait">
              {busy ? "加入中..." : "加入遊戲"}
            </button>
            <button onClick={() => setScreen("home")} className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors">返回</button>
          </div>
        )}
        {error && <p className="text-red-400 text-sm text-center fade-in">{error}</p>}
      </div>
    </div>
  );
}
