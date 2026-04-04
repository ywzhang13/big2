import type { Card } from "./constants";
import type { Combo } from "./combo";

export interface Player {
  id: string;
  name: string;
  seat: number;
  cardCount: number;
  isFinished: boolean;
  finishOrder?: number;
  hand?: Card[]; // only set for the local player or during game over
}

export interface GameState {
  roomCode: string;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  myId: string;
  mySeat: number;
  myHand: Card[];
  currentTurn: number; // seat index
  lastPlay: { seat: number; cards: Card[]; combo: Combo; playerName: string } | null;
  passCount: number;
  roundStarter: number;
  winner?: string;
  finishedHands?: Record<string, Card[]>; // playerId -> remaining hand at game end
}

// Broadcast message types
export type GameMessage =
  | { type: "player_joined"; player: { id: string; name: string; seat: number } }
  | { type: "player_left"; playerId: string }
  | { type: "game_start"; hands: Record<string, Card[]>; currentTurn: number; roundStarter: number }
  | { type: "play_cards"; seat: number; cards: Card[]; combo: Combo; playerName: string; cardCount: number; isFinished: boolean; finishOrder?: number }
  | { type: "pass"; seat: number }
  | { type: "turn_change"; currentTurn: number; passCount: number; lastPlay: GameState["lastPlay"]; roundStarter: number }
  | { type: "round_clear"; currentTurn: number; roundStarter: number }
  | { type: "game_over"; winner: string; hands: Record<string, Card[]> }
  | { type: "sync_request"; fromId: string }
  | { type: "sync_response"; state: SyncState }
  ;

export interface SyncState {
  players: Player[];
  status: "waiting" | "playing" | "finished";
  currentTurn: number;
  lastPlay: GameState["lastPlay"];
  passCount: number;
  roundStarter: number;
}
