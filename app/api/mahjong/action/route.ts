import { applyZimoFx, prefetchZimoFx } from "@/lib/mahjong/zimoFx/attach";
import {
  loadRoom,
  saveGameStateIfUnchanged,
  findSeatByPlayerId,
  toPublicGameState,
  hideConcealedKongs,
  retryOnConflict,
} from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcast, mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import {
  executeAction,
  executeConcealedKong,
  startAddKong,
  completeAddKong,
  canKongNow,
  robFlower,
  passFlowerRob,
  declareWin,
  applyWinnerOrderRule,
  advanceTurn,
  drawTile,
  getAvailableActions,
  AvailableAction,
  isGuoShui,
  isLocked,
  eyeDiscardOptions,
  canDeclareTingNow,
  markGuoShuiOnPass,
  markPongPassOnPass,
  claimBlockReason,
  chiForbiddenKeys,
} from "@/lib/mahjong/gameLogic";
import { MahjongGameState } from "@/lib/mahjong/gameState";
import { closeMahjongIfOver } from "@/lib/records/close";
import { applyPace, paceMs, newPaceBudget, waitPaceOnce, type PaceBudget } from "@/lib/mahjong/pace";
import { Tile } from "@/lib/mahjong/tiles";
import {
  applySettlement,
  drawEvents,
  eyeAutoplay,
  eyeViewEvents,
  flowerRobEvents,
  gameOverEvent,
  type MjEvent,
} from "@/lib/mahjong/events";

/**
 * 加槓完成後的廣播：公開 mj_add_kong（把該組碰升成槓）＋補牌的 mj_draw／mj_draw_tile。
 * 這局因此結束（沒牌可補→流局、補到花湊成八仙過海）時改送 mj_game_over：
 * 會把 settlement 等寫進 s，所以要在存檔「之前」呼叫。
 */
function addKongDoneEvents(s: MahjongGameState, seat: number, tile: Tile): MjEvent[] {
  const done: MjEvent = {
    event: "mj_add_kong",
    payload: { seat, tile, tileCount: s.players[seat].hand.length },
  };
  if (s.status === "finished") {
    applySettlement(s);
    return [done, gameOverEvent(s)];
  }
  return [done, ...drawEvents(s, seat)];
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  const budget = newPaceBudget(); // 這個請求只等一次、最多 4 秒（衝突重試也共用）
  return retryOnConflict((fresh) => handleAction(request, body, fresh, budget));
}

/**
 * 處理一次動作。所有寫入都用條件寫入（讀出時的 stateVersion 沒變才寫），
 * 若同時有人先寫了會丟 StateConflictError，由 retryOnConflict 重新讀取後整個重做，
 * 所以兩個人同時送出的決定不會互相蓋掉。
 */
async function handleAction(request: Request, body: unknown, fresh: boolean, budget: PaceBudget): Promise<Response> {
  const { roomId, playerId, actionType, tiles } = body as {
    roomId?: string;
    playerId?: string;
    actionType?: "chi" | "pong" | "kong" | "add_kong" | "win" | "pass";
    tiles?: number[]; // tile IDs
  };

  if (!roomId || !playerId || !actionType) {
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
  if (await waitPaceOnce(state, budget)) return handleAction(request, body, true, budget);
  const baseVersion = state.stateVersion;
  // 槓後補牌補到花：等補花特效播完，別人才能接著動
  const save = (s: MahjongGameState, status?: string) =>
    saveGameStateIfUnchanged(roomId, baseVersion, applyPace(s, paceMs(state, s)), status);
  if (state.status !== "playing") {
    return Response.json({ error: "遊戲未在進行中" }, { status: 400 });
  }
  // 自摸特效：這次請求就可能胡牌，填上這一刻四家的特效（過期、收回就沒有）
  applyZimoFx(state, await zimoFxPrefs);

  const seat = findSeatByPlayerId(state, playerId);
  if (seat === -1) {
    return Response.json({ error: "玩家不在此房間" }, { status: 403 });
  }

  let newState: MahjongGameState;

  // 七搶一：只有有 7 張花的人能決定（win＝搶、pass＝不搶），其他動作都等
  if (state.pendingFlowerRob) {
    const fr = state.pendingFlowerRob;
    if (seat !== fr.robberSeat || (actionType !== "win" && actionType !== "pass")) {
      return Response.json({ error: "等待其他玩家決定是否七搶一" }, { status: 409 });
    }
    if (actionType === "win") {
      newState = robFlower(state);
      applySettlement(newState);
      await save(newState, "finished");
      await mjBroadcastBatch(room.code, [gameOverEvent(newState)]);
      await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房
      return Response.json({ success: true });
    }
    newState = passFlowerRob(state);
    const events: MjEvent[] = [
      {
        event: "mj_pass",
        payload: { seat, allPassed: true, currentTurn: newState.currentTurn, hasDrawn: newState.hasDrawn },
      },
      // 輪到的人繼續（打牌中＝摸到花的人；開局＝莊家），重送他的摸牌事件和可做的動作
      ...drawEvents(newState, newState.currentTurn),
    ];
    // 摸到花的人已地聽／眼牌：能胡就自動胡（眼牌），不能胡就自動打出摸到的牌
    const auto = eyeAutoplay(newState);
    newState = auto.s;
    events.push(...auto.events, ...eyeViewEvents(newState));
    await save(newState, auto.finished ? "finished" : undefined);
    await mjBroadcastBatch(room.code, events);
    if (auto.finished) await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房
    return Response.json({ success: true });
  }

  // 搶槓窗口：只能胡或 pass，加槓的人自己什麼都不能做
  if (state.pendingAddKong) {
    if (actionType !== "win" && actionType !== "pass") {
      return Response.json({ error: "等待其他玩家決定是否搶槓" }, { status: 409 });
    }
    if (seat === state.pendingAddKong.seat) {
      return Response.json({ error: "等待其他玩家決定是否搶槓" }, { status: 409 });
    }
  }

  // 胡別人的牌（放槍、搶槓）或 pass：只有窗口名單內、還沒決定（胡或 pass）的人可以送出
  const isSelfDrawWin = actionType === "win" && state.currentTurn === seat && state.hasDrawn;
  if (
    (actionType === "win" && !isSelfDrawWin) ||
    (actionType === "pass" && state.pendingActions)
  ) {
    const pending = state.pendingActions;
    if (
      !pending ||
      !pending.potentialActors.includes(seat) ||
      pending.passedActors.includes(seat)
    ) {
      return Response.json({ error: "你不能胡這張牌或已經決定過了" }, { status: 403 });
    }
  }

  // 地聽、眼牌後不能吃、碰、槓（明槓、暗槓、加槓）
  if ((actionType === "chi" || actionType === "pong" || actionType === "kong" || actionType === "add_kong") && isLocked(state, seat)) {
    return Response.json({ error: "地聽、眼牌後不能吃碰槓" }, { status: 400 });
  }

  // 暗槓、加槓只能在自己剛摸進（或補進）一張牌後（和畫面給按鈕的 ownTurnActions 一致）。
  // 吃碰後 hasDrawn 也是 true：碰完馬上加槓會把上家打的牌槓走，繞過「上家的牌不能明槓」
  if (
    (actionType === "add_kong" || (actionType === "kong" && !state.lastDiscard)) &&
    state.currentTurn === seat &&
    state.drawnTileId === undefined
  ) {
    return Response.json({ error: "吃碰後要先打牌，摸牌後才能槓" }, { status: 400 });
  }

  if ((actionType === "kong" || actionType === "add_kong") && !canKongNow(state)) {
    return Response.json({ error: "牌牆剩 16 張，不能再槓" }, { status: 400 });
  }

  if (actionType === "add_kong") {
    if (state.currentTurn !== seat) {
      return Response.json({ error: "還沒輪到你" }, { status: 400 });
    }
    const tile = state.players[seat].hand.find((t) => t.id === tiles?.[0]);
    if (!tile) {
      return Response.json({ error: "找不到要加槓的牌" }, { status: 400 });
    }
    newState = startAddKong(state, tile);

    if (!newState.pendingAddKong) {
      // 沒人能搶：已完成加槓並補牌（沒牌可補則流局）
      const events = addKongDoneEvents(newState, seat, tile);
      // 補到第 8 張花、七搶一輪到眼牌的人：自動搶
      const auto = eyeAutoplay(newState);
      newState = auto.s;
      events.push(...auto.events, ...eyeViewEvents(newState));
      await save(newState, newState.status === "finished" ? "finished" : undefined);
      await mjBroadcastBatch(room.code, events);
      await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房
      return Response.json({ success: true, robWindow: false });
    }
    // 有人能搶：通知所有人「加槓中」，並只給能胡的人 win 選項；眼牌的人能搶就自動搶槓胡
    const p = newState.players[seat];
    const events: MjEvent[] = [
      { event: "mj_add_kong_pending", payload: { seat, tile, tileCount: p.hand.length } },
      { event: "mj_hand_update", payload: { playerId, hand: p.hand.filter((t) => t.suit !== "f") } },
    ];
    const auto = eyeAutoplay(newState);
    newState = auto.s;
    if (auto.finished) {
      await save(newState, "finished");
      await mjBroadcastBatch(room.code, [...events, ...auto.events]);
      await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房
      return Response.json({ success: true, robWindow: true });
    }
    await save(newState);
    events.push(...auto.events);
    const decided = newState.pendingActions!.passedActors;
    for (const robber of newState.pendingActions!.potentialActors.filter((r) => !decided.includes(r))) {
      events.push({
        event: "mj_available_actions",
        payload: {
          playerId: newState.players[robber].id,
          actions: [{ type: "win", playerSeat: robber }],
          robKong: true,
        },
      });
    }
    await mjBroadcastBatch(room.code, [...events, ...eyeViewEvents(newState)]);
    return Response.json({ success: true, robWindow: true });
  }

  if (actionType === "win") {
    // Determine if self-draw or from discard
    const isSelfDraw = state.currentTurn === seat && state.hasDrawn;

    // Prevent duplicate wins by the same seat (idempotent)
    if (state.winners?.some((w) => w.seat === seat)) {
      return Response.json({ error: "你已經胡過了" }, { status: 400 });
    }

    // 過水中不能胡（自摸也一樣）。放槍／搶槓在上面已因不在窗口名單被擋下
    if (isGuoShui(state, seat)) {
      return Response.json({ error: "現在不能胡" }, { status: 400 });
    }
    newState = declareWin(state, seat, isSelfDraw);

    // For self-draw or no pending actions, finalize immediately.
    // For ron (胡別家): check if other potential winners are still undecided
    // to support 一炮多響 (all who can win get to win on the same discard).
    let waitForMoreWinners = false;
    if (!isSelfDraw && state.pendingActions) {
      const pending = { ...state.pendingActions };
      // Mark this seat as decided (won = removed from pending consideration)
      pending.passedActors = Array.from(new Set([...pending.passedActors, seat]));
      // Any remaining seats (in potentialActors, not yet decided) who could win?
      const remaining = pending.potentialActors.filter(
        (s) => !pending.passedActors.includes(s) && s !== seat
      );
      // Check if any remaining seat has a winning hand on the same discard
      const discTile = state.lastDiscard?.tile;
      if (discTile && remaining.length > 0) {
        for (const rs of remaining) {
          const p = state.players[rs];
          const testHand = [...p.hand, discTile];
          // Import isWinningHand lazily via existing getAvailableActions of state
          // Simpler: reuse getAvailableActions which filters by lastDiscard.
          const actionsForRs = getAvailableActions(state).filter(
            (a) => a.playerSeat === rs && a.type === "win"
          );
          if (actionsForRs.length > 0) {
            waitForMoreWinners = true;
            break;
          }
          // suppress unused var lint
          void testHand;
        }
      }
      newState.pendingActions = pending;
    }

    if (waitForMoreWinners) {
      // Keep game in "playing" status; broadcast a partial-win event so UIs
      // know someone has won but settlement waits. Others can still win or pass.
      await save(newState);
      await mjBroadcast(room.code, "mj_partial_win", {
        seat,
        winnerName: newState.players[seat].name,
        score: newState.winners!.find((w) => w.seat === seat)!.score, // winners 照順位排，不是按胡的先後
      });
      return Response.json({ success: true, partial: true });
    }

    // Finalize game. Apply 雙響/三響 order rule to winners first.
    newState = applyWinnerOrderRule(newState);
    newState.status = "finished";
    newState.pendingActions = undefined;
    newState.pendingAddKong = undefined;

    // Calculate settlement if round system is active
    applySettlement(newState);

    await save(newState, "finished");

    // Broadcast game over with all hands revealed（含 winTile／from／waits）
    await mjBroadcastBatch(room.code, [gameOverEvent(newState)]);
    await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房

    return Response.json({ success: true });
  }

  if (actionType === "pass") {
    // Multi-player action window: track who has passed
    if (state.pendingActions) {
      // 本來能胡這張（放槍或搶槓）卻 pass：進入過水；本來能碰或明槓卻 pass：記下這種牌（碰的過水）。
      // 之後的狀態都從這裡接著算
      const passState = markPongPassOnPass(markGuoShuiOnPass(state, seat), seat);
      const pending = { ...state.pendingActions };
      // Add this player to passedActors if they are a potential actor
      if (
        pending.potentialActors.includes(seat) &&
        !pending.passedActors.includes(seat)
      ) {
        pending.passedActors = [...pending.passedActors, seat];
      }

      const allPassed = pending.potentialActors.every((s) =>
        pending.passedActors.includes(s)
      );

      if (allPassed) {
        // Everyone passed. If there are collected winners (一炮多響),
        // finalize the game instead of advancing the turn.
        if (state.winners && state.winners.length > 0) {
          newState = { ...passState, pendingActions: undefined, pendingAddKong: undefined } as MahjongGameState;
          newState = applyWinnerOrderRule(newState);
          newState.status = "finished";
          applySettlement(newState);
          await save(newState, "finished");
          await mjBroadcastBatch(room.code, [gameOverEvent(newState)]);
          await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房
          return Response.json({ success: true, finalized: true });
        }
        if (state.pendingAddKong) {
          // 沒人搶槓：完成加槓並補牌，輪到加槓的人繼續
          const { seat: kongSeat, tile: kongTile } = state.pendingAddKong;
          newState = completeAddKong(passState);
          const events = addKongDoneEvents(newState, kongSeat, kongTile);
          const auto = eyeAutoplay(newState); // 補到花、七搶一輪到眼牌的人：自動搶
          newState = auto.s;
          await save(newState, newState.status === "finished" ? "finished" : undefined);
          await mjBroadcastBatch(room.code, [
            {
              event: "mj_pass",
              payload: { seat, allPassed: true, currentTurn: kongSeat, hasDrawn: newState.hasDrawn },
            },
            ...events,
            ...auto.events,
            ...eyeViewEvents(newState),
          ]);
          await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房
          return Response.json({ success: true });
        }
        // Everyone passed — advance turn, clear pending
        newState = advanceTurn(passState);
        newState.pendingActions = undefined;
      } else {
        // Still waiting for others — just update passedActors
        newState = { ...passState, pendingActions: pending } as MahjongGameState;
      }
    } else {
      // 沒有等待中的窗口就沒有「過」可以按：自己回合送過會跳過打牌，
      // 別人送（例如窗口已關後才到的過）會跳過輪到的人，所以一律拒絕、狀態不變
      return Response.json(
        { error: state.currentTurn === seat ? "輪到你，請打出一張牌" : "現在沒有可以過的牌" },
        { status: 409 }
      );
    }

    await save(newState);

    const turnAdvanced = !newState.pendingActions;
    const events: { event: string; payload: Record<string, unknown> }[] = [
      {
        event: "mj_pass",
        payload: {
          seat,
          allPassed: turnAdvanced,
          currentTurn: newState.currentTurn,
          hasDrawn: newState.hasDrawn,
        },
      },
    ];

    if (newState.pendingActions && state.lastDiscard) {
      const remainingActions = getAvailableActions(newState);
      const passedSet = new Set(newState.pendingActions.passedActors);
      const tierOf = (type: string) =>
        type === "win" ? 0 : type === "pong" || type === "kong" ? 1 : 2;
      const unpassedActions = remainingActions.filter(
        (a) => !passedSet.has(a.playerSeat)
      );
      const playerSeatsWithActions = new Set(
        unpassedActions.map((a) => a.playerSeat)
      );
      for (const actionSeat of playerSeatsWithActions) {
        const playerActions = unpassedActions.filter(
          (a) => a.playerSeat === actionSeat
        );
        const otherTiers = unpassedActions
          .filter((a) => a.playerSeat !== actionSeat)
          .map((a) => tierOf(a.type));
        const minOtherTier =
          otherTiers.length > 0 ? Math.min(...otherTiers) : 999;
        const filtered = playerActions.filter(
          (a) => tierOf(a.type) <= minOtherTier
        );
        if (filtered.length === 0) continue;
        const targetPlayerId = newState.players[actionSeat].id;
        events.push({
          event: "mj_available_actions",
          payload: { playerId: targetPlayerId, actions: filtered },
        });
      }
    }

    await mjBroadcastBatch(room.code, [...events, ...eyeViewEvents(newState)]);
    return Response.json({ success: true });
  }

  // chi / pong / kong
  // Concealed kong (暗槓) is triggered from own hand after drawing — no lastDiscard.
  // Add kong (加槓) may also be triggered on own turn with lastDiscard absent.
  const isConcealedKong =
    actionType === "kong" &&
    state.currentTurn === seat &&
    state.hasDrawn &&
    !state.lastDiscard;

  if (!state.lastDiscard && !isConcealedKong) {
    return Response.json({ error: "沒有可以吃碰槓的牌" }, { status: 400 });
  }

  // Priority tiers: 0=win, 1=pong/kong, 2=chi
  // Reject this action if another seat has a higher-priority (lower-tier)
  // action pending and hasn't passed. Win is always highest; pong/kong beat
  // chi; chi waits for both.
  if (actionType === "chi" || actionType === "pong" || actionType === "kong") {
    const tierOf = (type: string) =>
      type === "win" ? 0 : type === "pong" || type === "kong" ? 1 : 2;
    const myTier = tierOf(actionType);
    const allAvailable = getAvailableActions(state);
    const pending = state.pendingActions;
    const higherPriorityWaiting = allAvailable.some((a) => {
      if (a.playerSeat === seat) return false;
      if (tierOf(a.type) >= myTier) return false;
      const hasPassed = pending?.passedActors.includes(a.playerSeat) ?? false;
      return !hasPassed;
    });
    if (higherPriorityWaiting) {
      return Response.json(
        { error: "等待其他玩家優先決定" },
        { status: 409 }
      );
    }
  }

  // 上家打出的牌不能明槓（只能碰或吃）；加槓、暗槓不受影響
  if (actionType === "kong" && !isConcealedKong && state.lastDiscard && seat === (state.lastDiscard.from + 1) % 4) {
    return Response.json({ error: "上家打的牌不能明槓，可以碰" }, { status: 400 });
  }

  // 牌底不夠再摸一張（吃碰 ≥4、明槓 ≥5）、碰的過水中：不能吃碰明槓別人打的牌
  if ((actionType === "chi" || actionType === "pong" || actionType === "kong") && !isConcealedKong) {
    const blocked = claimBlockReason(state, seat, actionType);
    if (blocked) return Response.json({ error: blocked }, { status: 400 });
  }

  // Resolve tile objects from IDs
  const player = state.players[seat];
  let actionTiles: Tile[] | undefined;
  if (tiles && tiles.length > 0) {
    actionTiles = tiles.map((tileId) => {
      const found = player.hand.find((t) => t.id === tileId);
      if (!found) throw new Error(`找不到牌 id=${tileId}`);
      return found;
    });
  }

  // 食替（老闆 2026-10-21）：吃完沒有能打的牌的吃法不給（getAvailableActions 已經濾掉），這裡擋直接送來的請求
  if (actionType === "chi") {
    const ids = (actionTiles ?? []).map((t) => t.id).sort().join(",");
    const offered = getAvailableActions(state).some((a) => a.playerSeat === seat && a.type === "chi" && a.tiles!.map((t) => t.id).sort().join(",") === ids);
    if (!offered) return Response.json({ error: "不能這樣吃（吃完沒有能打的牌，或不是能吃的組合）", reason: "chi_not_allowed" }, { status: 400 });
  }

  if (isConcealedKong) {
    // 暗槓: 4 tiles from own hand, no discard involved
    if (!actionTiles || actionTiles.length !== 4) {
      return Response.json({ error: "暗槓需要 4 張相同的牌" }, { status: 400 });
    }
    newState = executeConcealedKong(state, actionTiles);
  } else {
    const action: AvailableAction = {
      type: actionType as "chi" | "pong" | "kong",
      playerSeat: seat,
      tiles: actionTiles,
    };
    newState = executeAction(state, action);
  }
  // Clear pendingActions after a successful chi/pong/kong
  newState.pendingActions = undefined;

  // 槓完補牌讓這局結束（沒牌可補→流局、補到花湊成八仙過海）
  if (newState.status === "finished") {
    applySettlement(newState);
    await save(newState, "finished");
    const m = newState.players[seat].revealed[newState.players[seat].revealed.length - 1];
    await mjBroadcastBatch(room.code, [
      { event: "mj_action", payload: { type: m.type, seat, tiles: hideConcealedKongs(newState.players[seat].revealed, seat).at(-1)!.tiles, tileCount: newState.players[seat].hand.length } },
      gameOverEvent(newState),
    ]);
    await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房
    return Response.json({ success: true });
  }

  // 槓後補到第 8 張花、七搶一輪到眼牌的人：自動搶
  const auto = eyeAutoplay(newState);
  newState = auto.s;
  await save(newState, auto.finished ? "finished" : undefined);

  // Broadcast the action (revealed meld) with tileCount
  // Use lastMeld.type so "concealed_kong" (暗槓) is correctly conveyed
  // to clients (for faceDown rendering and scoring).
  const updatedPlayer = newState.players[seat];
  const lastMeld = updatedPlayer.revealed[updatedPlayer.revealed.length - 1];
  const handNoFlowers = newState.players[seat].hand.filter((t) => t.suit !== "f");
  const drawnTileId =
    actionType === "kong" && handNoFlowers.length > 0
      ? handNoFlowers[handNoFlowers.length - 1].id
      : undefined;

  await mjBroadcastBatch(room.code, [
    {
      event: "mj_action",
      payload: {
        type: lastMeld.type,
        seat,
        // 暗槓：公開頻道只送蓋著的 4 張；本人的牌面在下面座位頻道的 mj_hand_update.myRevealed
        tiles: hideConcealedKongs(updatedPlayer.revealed, seat).at(-1)!.tiles,
        tileCount: updatedPlayer.hand.length,
      },
    },
    {
      event: "mj_hand_update",
      // 吃、碰後要打牌：可以一起宣告眼牌的出牌選項
      payload: {
        playerId,
        hand: handNoFlowers,
        drawnTileId,
        eyeOptions: eyeDiscardOptions(newState, seat).map((t) => t.id),
        eyeWithTing: canDeclareTingNow(newState, seat),
        // 食替：吃完這次不能打的牌種（碰、槓是空陣列）
        chiForbidden: chiForbiddenKeys(newState, seat),
        // 暗槓：自己的吃碰槓（有牌面）。公開的 mj_action 是蓋著的，前端拿這份換掉自己那一副
        ...(lastMeld.type === "concealed_kong" ? { myRevealed: updatedPlayer.revealed } : {}),
      },
    },
    // 槓：補牌後能不能自摸（槓上開花）／再槓，以及補到第 8 張花時的七搶一
    ...(actionType === "kong" ? drawEvents(newState, seat) : []),
    ...auto.events,
    ...eyeViewEvents(newState),
  ]);
  if (auto.finished) await closeMahjongIfOver(roomId, room.code, newState); // 整場打完：寫紀錄後關房

  return Response.json({ success: true, chiForbidden: chiForbiddenKeys(newState, seat) });
}
