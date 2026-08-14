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

export type BlackjackSuit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type BlackjackPhase = 'insurance' | 'player' | 'settled';
export type BlackjackAction = 'hit' | 'stand' | 'double' | 'split';
export type BlackjackHandStatus = 'active' | 'pending' | 'standing' | 'bust' | 'locked' | 'resolved';

export interface BlackjackCard {
  index: number;
  rank: number;
  suit: BlackjackSuit;
}

export interface BlackjackCardView extends Partial<BlackjackCard> {
  hidden?: boolean;
}

export interface BlackjackHand {
  id: string;
  cards: BlackjackCard[];
  wager: number;
  status: BlackjackHandStatus;
  total: number;
  soft: boolean;
  natural: boolean;
  splitAces: boolean;
  doubled: boolean;
  result?: 'blackjack' | 'win' | 'push' | 'loss' | 'bust';
  payout: number;
}

export interface BlackjackRound {
  id: string;
  requestId: string;
  version: number;
  nonce: number;
  baseBet: number;
  phase: BlackjackPhase;
  dealerCards: BlackjackCardView[];
  dealerTotal?: number;
  hands: BlackjackHand[];
  activeHandIndex: number;
  insurance: {
    offered: boolean;
    decided: boolean;
    taken: boolean;
    wager: number;
    payout: number;
  };
  actions: Record<BlackjackAction, boolean>;
  totalRisked: number;
  payout: number;
  net: number;
  outcome?: string;
  startedAt: number;
}
