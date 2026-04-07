import type { Card } from "./constants";
import type { Combo } from "./combo";

export interface Player {
  id: string;
  name: string;
  seat: number;
  cardCount: number;
  isFinished: boolean;
  finishOrder?: number;
  hand?: Card[];
}

export interface GameState {
  roomCode: string;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  myId: string;
  mySeat: number;
  myHand: Card[];
  currentTurn: number;
  lastPlay: { seat: number; cards: Card[]; combo: Combo; playerName: string } | null;
  passCount: number;
  roundStarter: number;
  winner?: string;
  finishedHands?: Record<string, Card[]>;
  winnerLastPlay?: { cards: Card[]; comboType: string; playerName: string };
  scores: Record<string, number>; // playerId -> cumulative score
  roundScores?: Record<string, number>; // this round's scores
  hostId: string; // first player to join — only they can start/continue
  readyCheck: boolean;
  readyPlayers: Set<string>;
}

export type GameMessage =
  | { type: "heartbeat"; playerId: string; name: string; seat: number }
  | { type: "ready_check"; hostId: string }
  | { type: "player_ready"; playerId: string }
  | { type: "game_start"; hands: Record<string, Card[]>; currentTurn: number; roundStarter: number; players: { id: string; name: string; seat: number }[] }
  | { type: "play_cards"; seat: number; cards: Card[]; combo: Combo; playerName: string; cardCount: number; isFinished: boolean; finishOrder?: number; nextTurn: number; gameOver?: boolean; winner?: string }
  | { type: "pass"; seat: number; passCount: number; nextTurn: number; clearRound: boolean }
  | { type: "game_over"; winner: string; hands: Record<string, Card[]> }
  | { type: "reveal_hand"; playerId: string; hand: Card[] }
  | { type: "continue_game"; hands: Record<string, Card[]>; currentTurn: number; roundStarter: number; players: { id: string; name: string; seat: number }[]; scores: Record<string, number> }
  | { type: "sync_request"; fromId: string }
  | { type: "sync_state"; status: "playing"; players: { id: string; name: string; seat: number; cardCount: number; isFinished: boolean; finishOrder?: number }[]; currentTurn: number; lastPlay: GameState["lastPlay"]; passCount: number; roundStarter: number; scores: Record<string, number>; hands: Record<string, Card[]> }
  ;
