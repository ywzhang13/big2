"use client";
// 胡牌演出（大牌段 → 自摸／胡浮層或隕石 → 結算）的排程，打牌頁（app/mahjong/page.tsx）和觀戰頁（app/mahjong/watch/page.tsx）共用同一份：
// 老馬 2026-10-30 從打牌頁原封搬出來（邏輯、時間、跳過都沒改），觀戰者才會看到和玩家本人一樣的播法和順序。
//   useWinShow：這一手要不要播、播到哪一段、結算要不要先等（holdResult）；WinShowLayer：把浮層、隕石、大牌段畫出來
import { useEffect, useRef, useState } from "react";
import type { MjWinner, MjHandReveal } from "@/hooks/useMahjong";
import type { RoundInfo } from "@/lib/mahjong/gameState";
import type { Tile } from "@/lib/mahjong/tiles";
import BigWin8Fx, { preloadBigWin8 } from "@/components/mahjong/BigWin8Fx";
import MeteorFx, { preloadMeteorFx } from "@/components/mahjong/MeteorFx";
import ZimoFx, { preloadZimoFx } from "@/components/mahjong/ZimoFx";
import WinCelebration from "@/components/mahjong/WinCelebration";
import { bigWinKey, bigWinPlayed, markBigWinPlayed, pickBigWin, type BigWinPick } from "@/lib/mahjong/bigWin";
import { CELE_MS, isZimoFxNew, planWinShow, type WinShowStage } from "@/lib/mahjong/winShow";

const FLOWER_WIN_NAMES = ["八仙過海", "七搶一"];

type Winner = MjWinner & { allHands?: MjHandReveal[] };

/** status／winner／roundInfo：牌局狀態；roomId：房間 id（播過的記號用）；roomOk：房間還開著（或整場打完的最後一局），false＝不播 */
export function useWinShow({ winner, status, roundInfo, roomId, roomOk }: {
  winner: Winner | undefined; status: string; roundInfo: RoundInfo | undefined; roomId: string; roomOk: boolean;
}) {
  // Detect win type for celebration overlay
  const isZimoWin =
    winner != null &&
    winner.seat >= 0 &&
    winner.score.fans.some((f) => f.name.includes("自摸") || f.name === "天胡"); // 天胡沒有自摸台，但一定是自摸
  const isRonWin =
    winner != null &&
    winner.seat >= 0 &&
    !isZimoWin;
  // 八仙過海／七搶一：花牌立刻胡，沒有自摸或放槍
  const flowerWinName = winner?.score.fans.find((f) => FLOWER_WIN_NAMES.includes(f.name))?.name;

  // Celebration overlay (shown briefly on all players' screens)
  const [celebrationMode, setCelebrationMode] = useState<"zimo" | "ron" | null>(null);
  const lastWinnerSeatRef = useRef<number | null>(null);
  useEffect(() => {
    const w = winner;
    if (!w || w.seat < 0) {
      lastWinnerSeatRef.current = null;
      // 新的一局（贏家清掉）：浮層 3.5 秒還沒播完就按下一局時，收掉的計時器跟著被清掉，浮層模式會一直留著，
      // 下一手胡牌那一刻先閃出上一手的「自摸」。這裡一起收掉
      setCelebrationMode(null);
      return;
    }
    if (lastWinnerSeatRef.current === w.seat) return;
    lastWinnerSeatRef.current = w.seat;
    // 大牌（天胡、字一色、大四喜、大三元…，見 lib/mahjong/bigWin.ts）、帳號專屬的隕石自摸：整串由下面的 winShow 依序播，這裡不播
    if (planWinShow({ pick: pickBigWin(w), zimo: isZimoWin, winFx: w.winFx }).join() !== "cele") return;
    if (isZimoWin) {
      setCelebrationMode("zimo");
      const t = setTimeout(() => setCelebrationMode(null), CELE_MS.zimo);
      return () => clearTimeout(t);
    }
    if (isRonWin) {
      setCelebrationMode("ron");
      const t = setTimeout(() => setCelebrationMode(null), CELE_MS.ron);
      return () => clearTimeout(t);
    }
  }, [winner, isZimoWin, isRonWin]);

  // 胡牌演出（大牌胡牌特效 2026-10-23、帳號專屬隕石自摸 2026-10-25、八台大牌新版＋大牌先播 2026-10-25，順序見 lib/mahjong/winShow.ts）：
  //   一般人大牌：大牌專屬段 → 自摸／胡浮層 → 結算；帳號專屬隕石（伺服器給 winner.winFx="meteor"）自摸：（大牌專屬段 →）隕石自摸 → 結算；
  //   天胡、八仙過海、七搶一：只播大牌專屬段。一般胡牌（沒有大牌、沒有專屬特效）照舊由上面的浮層播，不擋結算。
  //   大牌段排第一：播完不卸下，只留暗幕墊在後面那一段底下，整串結束才收（交接時牌桌不會先亮一下）。
  //   10 種大牌都用新版 BigWin8Fx（八台 7 種、16 台以上的天胡、字一色、大四喜；天胡播完直接結算，隕石帳號也一樣）。
  // 這一局結束、順位第一的贏家才看（四家各自看到同一份結果）。播過就記在這個分頁（重新整理、斷線重連不重播）。播的時候先不出結算浮層，播完（或跳過）才出
  const handKey = `${roundInfo?.currentRound}-${roundInfo?.currentGame}-${roundInfo?.dealerConsecutive}`;
  type WinShow = { key: string; plan: WinShowStage[]; i: number; pick: BigWinPick | null; seat: number; zimo: boolean; tile: Tile | undefined; name: string; winFx?: string };
  const [winShow, setWinShow] = useState<WinShow | null>(null);
  const showWinner = status === "finished" && winner && winner.seat >= 0 ? winner : null;

  const showPick = showWinner ? pickBigWin(showWinner) : null;
  const showPlan = showWinner ? planWinShow({ pick: showPick, zimo: isZimoWin, winFx: showWinner.winFx }) : null;
  // 整場打完（completed）時伺服器結算後馬上關房：最後一局照樣播，播完才出最終結算；解散等其他原因關房不播（審伯 2026-10-23）
  const winShowKey = showPlan && showPlan.join() !== "cele" && roomOk ? bigWinKey(roomId, handKey, showWinner) : null;
  useEffect(() => {
    if (!showPlan || !winShowKey || bigWinPlayed(winShowKey) || !showWinner) return;
    const key = winShowKey;
    const show: WinShow = { key, plan: showPlan, i: 0, pick: showPick, seat: showWinner.seat, zimo: isZimoWin, tile: showWinner.winTile, name: showWinner.name, winFx: showWinner.winFx };
    // 下一個畫面才掛上；「記下播過」和「掛上特效」放在同一刻，中間不會有一次重繪讓結算浮層先閃出來。
    // 素材還沒載好就先等它載好再播，最多等 1.5 秒，第一次播也不會閃空白：
    //   ・隕石（例如伺服器沒先告訴我們房間裡有這個帳號）
    //   ・大牌新版 10 種：只有這一手真的是那一種時才下載那一種的圖、牌型名字型、專屬音效（八台約 0.3～0.6MB、16 台約 0.7～1.3MB），一般牌局不下載
    let cancelled = false;
    const loads: Promise<unknown>[] = [];
    if (showPlan.includes("meteor")) loads.push(preloadMeteorFx());
    // 自摸特效庫的新特效（雷霆、風暴、冰封、黑洞、櫻花）：只有這一手真的要播那一種才下載那一種（約 0.8～1.3MB）
    if (showPlan.includes("zfx") && isZimoFxNew(showWinner.winFx)) loads.push(preloadZimoFx(showWinner.winFx));
    if (showPick) loads.push(preloadBigWin8(showPick.theme));
    const ready = loads.length ? Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
    // 不在這裡預熱（老闆 2026-10-25：來不及預熱就直接播，不能讓玩家多等）
    void ready.then(() => setTimeout(() => {
      if (cancelled || bigWinPlayed(key)) return;
      markBigWinPlayed(key);
      setWinShow(show);
    }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只看這一手的識別：同一手只啟動一次
  }, [winShowKey]);
  // 換局、離開房間：還沒播完的收掉
  const winShowLive = winShow && winShow.key === winShowKey ? winShow : null;
  const winStage = winShowLive ? winShowLive.plan[winShowLive.i] : null;
  // 這一手的演出還沒播（剛結束、下一個畫面才掛上）或正在播：先不出結算浮層
  const winShowHoldResult = !!winShowKey && (!!winShowLive || !bigWinPlayed(winShowKey));
  const nextWinStage = () => setWinShow((w) => (w && w.i + 1 < w.plan.length ? { ...w, i: w.i + 1 } : null));
  const endWinShow = () => { setCelebrationMode(null); setWinShow(null); };
  // 浮層那一段（排在大牌段後面，是最後一段）：照原本長度播完才出結算；底下墊著大牌段留下的暗幕，浮層淡入時牌桌不會先亮一下。
  // 點畫面、Enter、Space 直接進結算（跳過那一下不會按到結算的按鈕）
  const celeOffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (winStage !== "cele" || !winShowLive) return;
    const mode = winShowLive.zimo ? "zimo" : "ron";
    setCelebrationMode(mode);
    const t = setTimeout(nextWinStage, CELE_MS[mode]);
    celeOffRef.current = setTimeout(() => setCelebrationMode((m) => (m === mode ? null : m)), CELE_MS[mode]);
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      document.addEventListener("click", swallow, true);
      setTimeout(() => document.removeEventListener("click", swallow, true), 500);
      if (celeOffRef.current) clearTimeout(celeOffRef.current);
      endWinShow();
    };
    document.addEventListener("pointerdown", skip, true);
    document.addEventListener("keydown", skip, true);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", skip, true); document.removeEventListener("keydown", skip, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 每一段只排一次
  }, [winStage, winShowLive?.key]);
  // 換局、離開房間：浮層的收尾計時器也收掉
  useEffect(() => () => { if (celeOffRef.current) clearTimeout(celeOffRef.current); }, [winShowKey]);

  return { isZimoWin, isRonWin, flowerWinName, celebrationMode, showWinner, winShowKey, winShowLive, winStage, winShowHoldResult, endWinShow, nextWinStage };
}

export type WinShowState = ReturnType<typeof useWinShow>;

/** 浮層（一般胡牌，或大牌後面那一段）、隕石、大牌段；mySeat：隕石鏡頭朝誰（觀戰者傳目前視角的座位） */
export function WinShowLayer({ ws, winner, mySeat, mobile }: { ws: WinShowState; winner: Winner | undefined; mySeat: number; mobile: boolean }) {
  const { celebrationMode, flowerWinName, winShowLive, winStage, endWinShow, nextWinStage } = ws;
  return (
    <>
      {/* Celebration overlay — shown briefly on all 4 screens before settlement */}
      {celebrationMode && winner && winner.seat >= 0 && (
        <WinCelebration mode={celebrationMode} flowerWinName={flowerWinName} name={winner.name} totalFan={winner.score.totalFan} />
      )}

      {/* 帳號專屬「隕石自摸」：取代自摸浮層；接在大牌專屬段後面（或單獨播），播完出結算，點畫面任一處跳過 */}
      {winShowLive && winStage === "meteor" && (
        <MeteorFx key={`mt|${winShowLive.key}`} seat={winShowLive.seat} mySeat={mySeat} mobile={mobile} tile={winShowLive.tile} name={winShowLive.name}
          onDone={(skipped) => (skipped ? endWinShow() : nextWinStage())} />
      )}
      {/* 自摸特效庫的新特效（雷霆、風暴、冰封、黑洞、櫻花）：播完接自摸浮層；播完不卸下（只留暗幕墊在浮層底下），整串結束才收。點畫面任一處跳過整串 */}
      {winShowLive && isZimoFxNew(winShowLive.winFx) && winShowLive.plan.indexOf("zfx") >= 0 && winShowLive.plan.indexOf("zfx") <= winShowLive.i && (
        <ZimoFx key={`zf|${winShowLive.key}`} fx={winShowLive.winFx} seat={winShowLive.seat} mySeat={mySeat} mobile={mobile} tile={winShowLive.tile} name={winShowLive.name}
          onDone={(skipped) => (skipped ? endWinShow() : winStage === "zfx" ? nextWinStage() : undefined)} />
      )}
      {/* 大牌胡牌特效：蓋在牌桌上（pointer-events: none），排第一段；播完不卸下（只留暗幕），等後面的浮層／隕石播完一起收。點畫面任一處跳過整串。
          和隕石同時掛著，key 要和隕石分開（同一層兄弟用同一個 key，React 會多掛一個收不掉的隕石） */}
      {winShowLive && winShowLive.pick && (
        <BigWin8Fx key={`big|${winShowLive.key}`} theme={winShowLive.pick.theme} title={winShowLive.pick.title} fan={winShowLive.pick.fan} seat={winShowLive.seat}
          mobile={mobile} winTile={winShowLive.tile} hand={winner?.allHands?.find((h) => h.seat === winShowLive.seat)?.hand} name={winShowLive.name}
          onDone={(skipped) => (skipped ? endWinShow() : nextWinStage())} />
      )}
    </>
  );
}
