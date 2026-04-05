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
  scores: Record<string, number>; // playerId -> cumulative score
  roundScores?: Record<string, number>; // this round's scores
}

export type GameMessage =
  | { type: "heartbeat"; playerId: string; name: string; seat: number }
  | { type: "game_start"; hands: Record<string, Card[]>; currentTurn: number; roundStarter: number; players: { id: string; name: string; seat: number }[] }
  | { type: "play_cards"; seat: number; cards: Card[]; combo: Combo; playerName: string; cardCount: number; isFinished: boolean; finishOrder?: number; nextTurn: number }
  | { type: "pass"; seat: number; passCount: number; nextTurn: number; clearRound: boolean }
  | { type: "game_over"; winner: string; hands: Record<string, Card[]> }
  | { type: "reveal_hand"; playerId: string; hand: Card[] }
  | { type: "continue_game"; hands: Record<string, Card[]>; currentTurn: number; roundStarter: number; players: { id: string; name: string; seat: number }[]; scores: Record<string, number> }
  ;
