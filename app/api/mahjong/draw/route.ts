import { applyZimoFx, prefetchZimoFx } from "@/lib/mahjong/zimoFx/attach";
import {
  loadRoom,
  saveGameStateIfUnchanged,
  findSeatByPlayerId,
  retryOnConflict,
} from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { drawTile, ownTurnActions } from "@/lib/mahjong/gameLogic";
import { applySettlement, drawEvents, eyeAutoplay, eyeViewEvents, gameOverEvent } from "@/lib/mahjong/events";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { closeMahjongIfOver } from "@/lib/records/close";
import { applyPace, paceMs, newPaceBudget, waitPaceOnce, type PaceBudget } from "@/lib/mahjong/pace";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  const budget = newPaceBudget(); // 這個請求只等一次、最多 4 秒（衝突重試也共用）
  return retryOnConflict((fresh) => handleDraw(request, body, fresh, budget));
}

async function handleDraw(request: Request, body: unknown, fresh: boolean, budget: PaceBudget): Promise<Response> {
  const { roomId, playerId } = body as {
    roomId?: string;
    playerId?: string;
  };

  if (!roomId || !playerId) {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }

  // Load room and state
  const room = await loadRoom(roomId, { fresh });
  if (!room || !room.game_state) {
    return Response.json({ error: "找不到遊戲" }, { status: 404 });
  }
  // 自摸特效：先發出查詢，和下面的登入檢查、等特效時間同時進行（不多串一次往返）；進遊戲邏輯前才等結果
  const zimoFxPrefs = prefetchZimoFx(room.game_state);
  // 確認是這個座位的本人（一律要登入）
  const denied = await seatOwnerError(request, room.game_state, playerId);
  if (denied) return denied;

  const state = room.game_state as MahjongGameState;
  // 補花／眼牌摸牌的特效還沒播完：等到伺服器記的時間再處理（重新讀最新狀態）
  if (await waitPaceOnce(state, budget)) return handleDraw(request, body, true, budget);
  if (state.status !== "playing") {
    return Response.json({ error: "遊戲未在進行中" }, { status: 400 });
  }
  // 自摸特效：這次請求就可能胡牌，填上這一刻四家的特效（過期、收回就沒有）
  applyZimoFx(state, await zimoFxPrefs);

  // Verify turn
  const seat = findSeatByPlayerId(state, playerId);
  if (seat === -1) {
    return Response.json({ error: "玩家不在此房間" }, { status: 403 });
  }
  if (state.currentTurn !== seat) {
    return Response.json({ error: "還沒輪到你" }, { status: 400 });
  }
  if (state.hasDrawn) {
    return Response.json({ error: "已經摸過牌了" }, { status: 400 });
  }

  // Don't allow draw if there are pending actions (chi/pong/kong in progress)
  if (state.pendingActions && state.pendingActions.potentialActors.length > 0) {
    const allPassed = state.pendingActions.potentialActors.every(
      (s) => state.pendingActions!.passedActors.includes(s)
    );
    if (!allPassed) {
      return Response.json({ error: "等待其他玩家動作中" }, { status: 400 });
    }
  }

  // Draw tile（含補花；可能流局、八仙過海，或進入七搶一等待）
  const newState = drawTile(state);

  if (newState.status === "finished") {
    applySettlement(newState);
    const sv = await saveGameStateIfUnchanged(roomId, state.stateVersion, newState, "finished");
    await mjBroadcastBatch(room.code, [gameOverEvent(newState)], sv);
    await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房
    return Response.json({ success: true, draw: !newState.winners?.length });
  }

  const events = drawEvents(newState, seat);
  // 地聽／眼牌的人摸到不能胡的牌：伺服器直接幫他打出這張；眼牌的人能胡就自動胡（也包括別的眼牌者胡這張、七搶一）
  const auto = eyeAutoplay(newState);
  // 補到花：等補花特效；眼牌的人摸牌：等翻牌＋停 1 秒（自動打出／自動胡要等這段播完，別人才能接著動）
  applyPace(auto.s, paceMs(state, newState, seat));
  const sv = await saveGameStateIfUnchanged(roomId, state.stateVersion, auto.s, auto.finished ? "finished" : undefined);
  await mjBroadcastBatch(room.code, [...events, ...auto.events, ...eyeViewEvents(auto.s)], sv);
  if (auto.finished) await closeMahjongIfOver(roomId, room.code, auto.s); // 整場打完：寫紀錄後關房

  const player = newState.players[seat];
  const actions = ownTurnActions(newState, seat);
  return Response.json({
    success: true,
    drawnTile: player.hand[player.hand.length - 1],
    canWin: actions.some((a) => a.type === "win"),
    canKong: actions.some((a) => a.type === "kong"),
    addKongOptions: actions.filter((a) => a.type === "add_kong").map((a) => a.tiles![0].id),
    flowerRob: !!newState.pendingFlowerRob,
    autoDiscarded: auto.autoDiscarded ?? null,
    autoWin: auto.finished && !!auto.s.winners?.some((w) => w.seat === seat),
  });
}
