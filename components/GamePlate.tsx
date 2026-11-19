// 三個遊戲共用的名牌（小宜〈共用名牌-設計說明-十三支麻將大老二-2026-11-18〉）：四家同一個尺寸 88×32（基準 844×390），
//   左邊圓頭像（名字第一個字）、右邊兩行（名字、分數）。標記都掛在框外的固定位置，不改變名牌大小：
//   右下角彈孔（十三支被打槍）、左下角離線（樣式先做好，資料還沒有）、思考中泡泡貼在 bubble 錨點外 6px（朝牌桌中心那一邊）。
// 錨點（設計說明 §5）：根元素掛 data-fx-seat，量到的範圍一定是 88×32（×放大倍率）；center＝正中心、bubble＝朝牌桌中心那一邊的中點。
// 樣式前綴 .gp-（gamePlate.css），不借用、不改麻將的 .mjm-*。目前只接十三支；大老二、麻將之後各自一張卡。
import "./gamePlate.css";

/** 座位（相對自己）：b 自己、t 對家、l 左家、r 右家——決定思考中泡泡朝哪邊 */
export type PlateSeat = "b" | "t" | "l" | "r";

export default function GamePlate({ seat, name, score, me = false, offline = false, thinking = false, shot = 0, plateId, className, style, avatarUrl = null }: {
  seat: PlateSeat;
  name: string;
  /** LINE 大頭照（老闆 2026-11-19）；沒有或載不到就照舊顯示名字第一個字。名牌大小、位置不變 */
  avatarUrl?: string | null;
  score: number;
  /** 自己：頭像金圈、名字金色 */
  me?: boolean;
  /** 離線：頭像和文字變灰、左下角「離線」 */
  offline?: boolean;
  /** 十三支理牌中還沒送出 */
  thinking?: boolean;
  /** 十三支被打幾槍（>0 才掛右下角彈孔） */
  shot?: number;
  /** 測試和特效用的座位編號（data-gp-seat） */
  plateId?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const sc = score > 0 ? ["pos", `+${score}`] : score < 0 ? ["neg", `−${-score}`] : ["zero", "0"];
  return (
    <div className={`gp${me ? " is-me" : ""}${offline ? " is-off" : ""}${className ? ` ${className}` : ""}`} data-seat={seat} data-fx-seat={seat} data-gp-seat={plateId} style={style}>
      <span className="gp-av">{Array.from(name)[0] ?? ""}{avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="gp-pic" src={avatarUrl} alt="" draggable={false} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      )}</span>
      <span className="gp-tx">
        <span className="gp-nm">{name}</span>
        <span className="gp-l2"><span className={`gp-sc is-${sc[0]}`}>{sc[1]}</span></span>
      </span>
      {shot > 0 && <span className="gp-hang is-shot" data-gp-shot={shot}><i />−{shot}</span>}
      {offline && <span className="gp-off">離線</span>}
      {thinking && (
        <span className="gp-think" data-gp-thinking={plateId} role="img" aria-label={`${name} 思考中`}>思考中<i>.</i><i>.</i><i>.</i></span>
      )}
    </div>
  );
}
