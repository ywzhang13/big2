// 自己補花動畫的序號保護（審伯 2026-11-08 必修②）：showFlower／applyFinal 用巢狀 setTimeout 一張一張播，
// 原本沒有存計時器、取消不了。換新局、換房、元件卸載、伺服器快照已經比動畫新的時候，舊的回呼還是會把
// 手牌蓋回補花演到一半的樣子。做法是每次開始一段新動畫就發一個新序號（start），之後每個 setTimeout 的
// 回呼先比對自己拿到的序號還是不是目前這個（isStale），不是就直接不寫 state；invalidate 給「這段動畫要
// 作廢」的時機呼叫（新局、換房、卸載、快照已經更新），不需要真的拿著計時器 id 逐一 clearTimeout。

export class FlowerAnimGuard {
  private gen = 0;

  /** 開始一段新的補花動畫，回傳這段動畫的序號，setTimeout 的回呼要存著它 */
  start(): number {
    return ++this.gen;
  }

  /** 這個序號還是不是目前這一段動畫（false＝還有效，可以寫 state） */
  isStale(token: number): boolean {
    return token !== this.gen;
  }

  /** 作廢目前這一段動畫：換局、換房、卸載、伺服器快照已經比動畫新的時候呼叫，之後所有舊序號的回呼都會變成 isStale */
  invalidate(): void {
    this.gen++;
  }
}
