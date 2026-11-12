# 麻將牌局回放 API（第一階段，給老馬）

老柯 2026-11-13。分支 `feat/mj-replay-backend`。老闆定案：保留 7 天、只有上桌 4 人能看、可以切換四家視角。

- 兩支都是 `GET`，要帶登入：`Authorization: Bearer <access token>`，跟 `/api/mahjong/records` 一樣。
- 場次用 `matchId`，也就是 `/api/mahjong/records` 回傳的 `items[].id`（對戰紀錄 id）。不是房號，也不是 roomId。
- 打牌當下完全不會呼叫這兩支。回放只在整場結束後讀，一局讀一次就好，重播都在前端算。

## 1. 列出這場有哪些局可以回放

`GET /api/mahjong/replay?matchId=<uuid>`

200 回傳：

```jsonc
{
  "matchId": "…",
  "roomCode": "5501",
  "endedAt": "2026-11-13T13:10:00.000Z",
  "expiresAt": "2026-11-20T13:10:00.000Z",  // 整場結束 + 7 天，過了就 410
  "mySeat": 0,                                // 我坐哪個座位（0～3），預設視角用這個
  "players": [{ "seat": 0, "name": "玩家1" }, …],
  "hands": [
    {
      "handNo": 1,                 // 第幾局，拿去呼叫第 2 支
      "recordedAt": "…",
      "hand": 1, "round": 1, "game": 1,   // 第幾局／第幾圈／圈內第幾局
      "wind": 1, "dealer": 0,             // 圈風 1東 2南 3西 4北；莊家座位
      "reason": "self_draw",              // win 放槍胡、self_draw 自摸、draw 流局
      "winners": [{ "seat": 0, "from": null, "selfDraw": true, "totalFan": 5 }],
      "deltas": [300, -100, -100, -100],  // 這局每家輸贏
      "steps": 87,                        // 事件數
      "durationMs": 165000                // 這局實際打多久
    }
  ]
}
```

注意以下兩種情況：
- 上線前打的局，以及上線當下正打到一半的局，都沒有紀錄，所以 `hands` 可能少於這場實際的局數。
- 解散的場次也算結束，已經打完的局照樣讀得到。

## 2. 取得某一局的完整紀錄

`GET /api/mahjong/replay/hand?matchId=<uuid>&hand=<handNo>`

200 回傳：

```jsonc
{
  "matchId": "…", "roomCode": "5501", "expiresAt": "…", "mySeat": 0,
  "tiles": { "12": { "suit": "m", "rank": 4, "display": "4萬" }, … },   // 這局 144 張牌：id → 牌面
  "replay": {
    "v": 1, "hand": 1, "round": 1, "game": 1, "dealerConsecutive": 0,
    "wind": 1, "dealer": 0, "door": 2, "dice": [3, 5, 1],
    "seats": [{ "seat": 0, "name": "玩家1" }, …],
    "init": {                         // 發完牌、起手補花之後的樣子
      "seats": [ { "h": [手牌 id…], "m": [], "f": [花 id…], "d": [] }, … ],   // 依座位 0～3
      "wall": [剩下的牌牆 id…]        // 照摸牌順序：第 0 張是下一張要摸的，補花／槓的補牌從最後一張拿
    },
    "events": [
      {
        "t": 4100,          // 距離這局開始幾毫秒（精度 0.1 秒）
        "k": ["draw"],      // 這一步發生的事，可能同時有好幾個
        "c": 1,             // 這一步之後輪到誰
        "w": 79,            // 牌牆剩幾張
        "p": [ { "s": 1, "ha": [57] } ],   // 有變化的座位（見下表）
        "e": [2],           // （選填）這一步新宣告眼牌的座位
        "ti": [2]           // （選填）這一步新宣告地聽的座位
      }
    ],
    "result": {
      "reason": "self_draw",
      "winners": [{ "seat": 0, "from": null, "selfDraw": true, "winTile": 57,
                    "fans": [{ "name": "自摸", "value": 1 }, …], "totalFan": 5 }],
      "deltas": [300, -100, -100, -100],
      "scores": [300, -100, -100, -100]   // 這局結束後的累計
    },
    "durationMs": 165000
  }
}
```

### `k` 會出現的值

| 值 | 意思 |
|---|---|
| `draw` | 摸牌（含補花、槓之後的補牌） |
| `flower` | 補花 |
| `discard` | 打牌 |
| `chi` / `pong` / `kong` | 吃／碰／明槓 |
| `concealed_kong` / `add_kong` | 暗槓／加槓 |
| `eye` / `ting` | 宣告眼牌／地聽 |
| `win` / `zimo` / `draw_game` | 放槍胡（含搶槓）／自摸／流局，只出現在最後一步 |

- 眼牌的人會自動摸打，所以同一步可能同時有 `draw` 和 `discard`。
- `pass` 這種牌沒有動的步驟不會記。

### `p[]` 一個座位這一步的變化（只列有變的欄位）

| 欄位 | 意思 |
|---|---|
| `s` | 座位 0～3 |
| `ha` / `hr` | 手牌多了／少了哪些 id |
| `m` | 吃碰槓整組換成這份。每一副是 `[種類, 打出來的座位（-1＝自己）, 牌 id…]`，種類為 `chi` `pong` `kong` `concealed_kong` |
| `fa` / `da` | 花／海底接在後面多了哪些 |
| `f` / `d` | 花／海底整份換掉（正常不會出現，保險用） |

### 海底的顯示

`d` 是「這家打過的每一張」。被吃、碰、槓、胡走的那張也會留在這裡，跟牌局狀態一樣。要像牌桌那樣不顯示被拿走的牌，就把出現在任何人 `m` 裡的 id，以及 `result.winners[].winTile`（放槍那張）從海底濾掉。

### 重播不用自己寫

`lib/mahjong/replay/log.ts` 是純函式，前端可以直接 import：
- `replayFrames(replay)` 回傳每一步四家的樣子：`[0]` 是發完牌，`[i]` 是第 i 個事件之後。每家是 `{ h, m, f, d }`。
- `applyEvent(seats, event)` 一次只往前一步。
- `tileFace(id)` 把 id 換成牌面，跟回應裡的 `tiles` 一樣。

切換視角時，四家的完整資料都在，只要換「誰的手牌正面朝上」就好，不用重新呼叫 API。

## 錯誤碼（兩支相同）

| HTTP | `error` | 什麼時候 |
|---|---|---|
| 401 | `not_logged_in` | 沒登入 |
| 400 | `bad_match_id` | matchId 不是 uuid |
| 400 | `bad_hand` | hand 不是 1 以上的整數（只有第 2 支） |
| 403 | `not_finished` | 這場還沒結束，或 matchId 不存在。這兩種刻意不分開，避免有人拿 id 試探 |
| 403 | `not_player` | 不是這場上桌的 4 人之一，觀戰者也是這個 |
| 404 | `not_found` | 這場有結束，但這一局沒有紀錄（只有第 2 支） |
| 410 | `expired` | 整場結束滿 7 天，會附 `expiresAt` |
| 500 | `server_error` | 伺服器錯誤 |

判斷順序依序是：登入、參數、`not_finished`、`not_player`、`expired`。所以沒上桌的人就算遇到已過期的場次，也只會拿到 403，不會知道到期資訊。
