// 大廳 v2（明亮娛樂城風，小宜〈大廳素材v2-驗收與四大廳排版規格〉2026-11-27）：總大廳和三款遊戲大廳共用的背景、LOGO 底牌＋「阿瑋娛樂城」、遊戲名稱。
// 字都是 HTML（背景、底牌圖上沒有字）；圖都是 CSS 背景，載好前先顯示同色系的底（見 app/lobby-v2.css）。
// 只用在大廳首頁；建立／加入房間、登入、等人、開局確認、牌桌都不用。
import "@/app/lobby-v2.css";

export type LobbyKind = "home" | "mahjong" | "thirteen" | "big2";

/** 鋪滿畫面的背景圖（裝飾，不吃點擊） */
export function LobbyBg({ kind }: { kind: LobbyKind }) {
  return <div className="lv2-bg" data-lv2-bg={kind} aria-hidden="true" />;
}

/** LOGO 底牌＋「阿瑋娛樂城」；name＝遊戲名稱（總大廳不給） */
export function LobbyHero({ name }: { name?: string }) {
  return (
    <header className="lv2-hero">
      <div className="lv2-logo"><span>阿瑋娛樂城</span></div>
      {name && <h1 className="lv2-name">{name}</h1>}
    </header>
  );
}
