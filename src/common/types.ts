export type GameType = 'dice' | 'limbo' | 'crash' | 'plinko' | 'mines' | 'wheel' | 'keno' | 'blackjack' | 'rps' | 'tower' | 'chicken';

export type ShellView = 'web' | 'mobile';

export interface GameConfig {
  enabled: boolean;
  houseEdge: number;
  minBet: number;
  maxBet: number;
  maxPayout: number;
}

export interface PlatformConfig {
  version: number;
  updatedAt: string;
  games: Record<GameType, GameConfig>;
}

export interface BetRequest {
  game: GameType;
  amount: number;
  params: Record<string, unknown>;
}

export interface BetResult {
  game: GameType;
  outcome: string;
  won: boolean;
  payout: number;
  multiplier: number;
  details?: Record<string, unknown>;
}

export interface SessionState {
  balance: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  recentResults: BetResult[];
  seedHistory: Array<{ hash: string; reveal?: string }>;
}

export interface MineRound {
  id: string;
  bet: number;
  mines: number;
  gridSize: number;
  board: boolean[];
  revealed: boolean[];
  safeCount: number;
  startedAt: number;
  resolved: boolean;
  won: boolean;
  payout: number;
}

export interface CrashRound {
  id: string;
  bet: number;
  autoCashout?: number;
  crashPoint: number;
  startedAt: number;
  resolved: boolean;
  cashedOutAt?: number;
  payout: number;
}
