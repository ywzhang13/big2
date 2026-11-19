"use client";
// 三款共用的結算外框（小宜〈十三支 v15〉§4～6，位置對齊麻將每局結算）：遮罩、左右兩欄、大標題、標題下的小區塊和小按鈕、明細表格、
//   一家一列的框（名字、標記、輸贏和累計、自己那一列金框）、「還在等 A、B」、「確認 2/4」小牌子、右下角主要按鈕、查看牌桌時的「回到結算」。
// 中間放牌的那一塊、名字下的標記、每一行明細的名稱和數字由各遊戲自己交。樣式前綴 .gr-（gameResult.css）。
// 目前十三支在用；麻將、大老二之後各自一張卡再換（這一張不動它們）。
// attrs：各遊戲自己的 data-* 屬性（測試、驗收腳本用），外框原樣掛上去
import type { ReactNode } from "react";
import "./gameResult.css";

type Attrs = Record<`data-${string}`, string | number | undefined>;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "zero");

export interface GrItem { label: string; value: number }
export interface GrRow {
  key: string | number;
  me?: boolean;
  name: string;
  /** 名字下的標記（全壘打、彈孔…） */
  marks?: ReactNode;
  /** 中間放牌的那一塊（遊戲自己畫） */
  body?: ReactNode;
  /** 右邊：這局輸贏（null＝不顯示）、下面一行小字（累計） */
  delta: number | null;
  sub?: ReactNode;
  attrs?: Attrs;
  /** 總結算：名次圓點（0＝第一名）、名字一行、統計欄；有給就畫總結算那種列 */
  rank?: number;
  stats?: { label: string; value: number; attrs?: Attrs }[];
}

export default function GameResultFrame({ title, sub, tool, items, total, rows, next = null, ready = null, primary, peek = false, onBack, error = null, attrs, scaleVar }: {
  title: string;
  /** 標題下的小區塊（十三支：彩金牌；總結算：「8 局・底分 100」） */
  sub?: ReactNode;
  /** 標題下的小按鈕（十三支「查看牌桌」，麻將「看牌庫」的位置） */
  tool?: { label: string; onClick: () => void; attrs?: Attrs };
  /** 明細表格（左欄下半）；total＝最後一行合計 */
  items?: GrItem[];
  total?: GrItem;
  rows: GrRow[];
  /** 「還在等 A、B」；沒有人要等就是 null（位置保留） */
  next?: string | null;
  /** 「確認 2/4」＋四家小牌子；null＝不顯示 */
  ready?: { label: string; chips: { key: string | number; name: string; ok: boolean; attrs?: Attrs }[]; attrs?: Attrs } | null;
  /** 右下角主要按鈕 */
  primary: { label: string; disabled?: boolean; onClick: () => void; attrs?: Attrs };
  /** 查看牌桌：整塊收起來，右下角出現「回到結算」 */
  peek?: boolean;
  onBack?: () => void;
  /** 按主要按鈕失敗的原因（主要按鈕上面一行） */
  error?: string | null;
  attrs?: Attrs;
  /** 整塊放大的倍數（CSS 變數，例如十三支 "var(--th-s2, 1)"）；不給＝1 */
  scaleVar?: string;
}) {
  const z = scaleVar ? ({ "--gr-z": scaleVar } as React.CSSProperties) : undefined;
  return (
    <div className={`gr${peek ? " peek" : ""}`} role="dialog" aria-label={title} style={z} {...attrs}>
      <div className="gr-in">
        <div className="gr-l">
          <div className="gr-title">{title}</div>
          {sub && <div className="gr-sub">{sub}</div>}
          {tool && <button type="button" className="gr-tool" onClick={tool.onClick} {...tool.attrs}>{tool.label}</button>}
          {items && total && (
            <div className="gr-items">
              {items.map((it) => (
                <div key={it.label} className="gr-item"><span className="n">{it.label}</span><b className={`v ${tone(it.value)}`}>{signed(it.value)}</b></div>
              ))}
              <div className="gr-item tot"><span className="n">{total.label}</span><b className={`v ${tone(total.value)}`}>{signed(total.value)}</b></div>
            </div>
          )}
        </div>
        <div className="gr-r">
          <div className="gr-rows">
            {rows.map((r) => (
              <div key={r.key} className={`gr-row${r.me ? " me" : ""}${r.rank !== undefined ? " is-final" : ""}`} {...r.attrs}>
                {r.rank !== undefined ? (
                  <>
                    <span className={`gr-rank r${Math.min(r.rank, 3)}`}>{r.rank + 1}</span>
                    <span className="gr-fname">{r.name}</span>
                    {r.stats?.map((s) => <span key={s.label} className="gr-stat" {...s.attrs}>{s.label}<b>{s.value}</b></span>)}
                  </>
                ) : (
                  <>
                    <div className="gr-who"><span className="nm">{r.name}</span>{r.marks}</div>
                    <div className="gr-body">{r.body}</div>
                  </>
                )}
                {r.delta !== null && (
                  <div className="gr-delta"><b className={tone(r.delta)}>{signed(r.delta)}</b>{r.sub && <small>{r.sub}</small>}</div>
                )}
              </div>
            ))}
          </div>
          <div className="gr-next" role="status">{next ?? ""}</div>
          {error && <div className="gr-err" role="alert">{error}</div>}
          <div className="gr-foot">
            <div className="gr-ready" {...ready?.attrs}>
              {ready && <span className="cnt">{ready.label}</span>}
              {ready?.chips.map((c) => (
                <span key={c.key} className={`gr-chip ${c.ok ? "ok" : "wait"}`} {...c.attrs}><i>{c.ok ? "✓" : "…"}</i><span>{c.name}</span></span>
              ))}
            </div>
            <button type="button" className="gr-btn" disabled={primary.disabled} onClick={primary.onClick} {...primary.attrs}>{primary.label}</button>
          </div>
        </div>
      </div>
      {peek && onBack && <button type="button" className="gr-back" onClick={onBack} {...tool?.attrs}>回到結算</button>}
    </div>
  );
}
