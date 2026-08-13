import { rngFloat, rngFloatStream } from './rng.js';
import type { GameType } from './types.js';

export const HOUSE_EDGE = 0.01;
export const MAX_PAYOUT_MULTIPLIER = 1_000_000;
export const DEFAULT_BALANCE = 10000;
export const CRASH_GROWTH_K = 0.35;

export const DICE_MIN_CHANCE = 0.01;
export const DICE_MAX_CHANCE = 98;

export type DiceSide = 'over' | 'under';
export type RiskLevel = 'low' | 'medium' | 'high' | 'rain';
export type KenoRisk = 'classic' | 'low' | 'medium' | 'high';

export interface DiceParams {
  side: DiceSide;
  winChance: number;
}

export interface LimboParams {
  target: number;
}

export interface CrashParams {
  autoCashout?: number;
}

export interface PlinkoParams {
  rows: number;
  risk: RiskLevel;
}

export interface MinesParams {
  mines: number;
  tileIndex?: number;
}

export interface WheelParams {
  segments: number;
  risk: RiskLevel;
}

export interface KenoParams {
  picks: number[];
  risk: KenoRisk;
}

export interface RpsParams { choice: 'rock' | 'paper' | 'scissors'; }
export interface TowerParams { difficulty: 'easy' | 'medium' | 'hard'; level?: number; }
export interface ChickenParams { difficulty: 'easy' | 'medium' | 'hard'; step?: number; }

const beats: Record<RpsParams['choice'], RpsParams['choice']> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export function rpsOutcome(f: number, params: RpsParams, houseEdge = HOUSE_EDGE): BetResult {
  const options: RpsParams['choice'][] = ['rock', 'paper', 'scissors'];
  const opponent = options[Math.min(2, Math.floor(f * 3))];
  const draw = opponent === params.choice;
  const won = beats[params.choice] === opponent;
  const multiplier = won ? Number((3 * (1 - houseEdge)).toFixed(2)) : draw ? 1 : 0;
  return { game: 'rps', outcome: `${params.choice} vs ${opponent}`, won: won || draw, payout: multiplier, multiplier, details: { choice: params.choice, opponent, draw } };
}

export function blackjackOutcome(floats: number[], houseEdge = HOUSE_EDGE): BetResult {
  const rank = (f: number) => Math.min(13, Math.floor(f * 13) + 1);
  const value = (r: number) => r === 1 ? 11 : Math.min(10, r);
  const cards = floats.slice(0, 6).map(rank);
  const total = (rs: number[]) => { let sum = rs.reduce((s,r)=>s+value(r),0); let aces=rs.filter(r=>r===1).length; while(sum>21&&aces--)sum-=10; return sum; };
  const player=[cards[0],cards[2]], dealer=[cards[1],cards[3]];
  while(total(player)<17 && player.length<4) player.push(cards[player.length+2]);
  while(total(dealer)<17 && dealer.length<4) dealer.push(cards[dealer.length+2]);
  const p=total(player), d=total(dealer), natural=p===21&&player.length===2;
  const push=p<=21&&p===d; const won=p<=21&&(d>21||p>d);
  const multiplier=push?1:won?(natural?Number((2.5*(1-houseEdge)).toFixed(2)):Number((2*(1-houseEdge)).toFixed(2))):0;
  return { game:'blackjack', outcome: push?`Push ${p}`:won?`${p} beats ${d}`:`${p} loses to ${d}`, won:won||push, payout:multiplier, multiplier, details:{player,dealer,playerTotal:p,dealerTotal:d,push,natural} };
}

function progressionOutcome(game: 'tower'|'chicken', f: number, difficulty: 'easy'|'medium'|'hard', requested=1, houseEdge=HOUSE_EDGE): BetResult {
  const safeChance = difficulty==='easy'?.8:difficulty==='medium'?.67:.5;
  const max = game==='tower'?9:15; const target=Math.max(1,Math.min(max,Math.floor(requested)));
  let reached=0; let cursor=f;
  for(let i=0;i<target;i++){ cursor=(cursor*9301+0.49297)%1; if(cursor>safeChance)break; reached++; }
  const won=reached===target; const multiplier=won?Number(((1-houseEdge)/(safeChance**target)).toFixed(2)):0;
  return { game, outcome: won?`${game==='tower'?'Level':'Step'} ${target} cleared`:`Trap at ${reached+1}`, won, payout:multiplier, multiplier, details:{reached,target,difficulty,safeChance} };
}

export const towerOutcome=(f:number,p:TowerParams,e=HOUSE_EDGE)=>progressionOutcome('tower',f,p.difficulty,p.level,e);
export const chickenOutcome=(f:number,p:ChickenParams,e=HOUSE_EDGE)=>progressionOutcome('chicken',f,p.difficulty,p.step,e);

export interface BetResult {
  game: GameType;
  outcome: string;
  won: boolean;
  payout: number;
  multiplier: number;
  details?: Record<string, unknown>;
}

export function diceTargetFromChance(winChance: number): number {
  const probability = Math.min(1, Math.max(DICE_MIN_CHANCE / 100, winChance / 100));
  const target = probability * 100;
  return Math.min(100, Math.max(0, target));
}

export function diceMultiplier(winChance: number, houseEdge = HOUSE_EDGE): number {
  return Number(((1 - houseEdge) / (winChance / 100)).toFixed(4));
}

export function extractDiceRoll(f: number): number {
  const roll = Math.floor(f * 10001) / 100;
  return Math.min(100, roll);
}

export function diceOutcome(f: number, params: DiceParams, houseEdge = HOUSE_EDGE): BetResult {
  const roll = extractDiceRoll(f);
  const target = diceTargetFromChance(params.winChance);
  const win = params.side === 'over' ? roll > target : roll < target;
  return {
    game: 'dice',
    outcome: `${roll.toFixed(2)} ${params.side === 'over' ? '>' : '<'} ${target.toFixed(2)}`,
    won: win,
    payout: win ? diceMultiplier(params.winChance, houseEdge) : 0,
    multiplier: win ? diceMultiplier(params.winChance, houseEdge) : 0,
    details: { roll, target }
  };
}

export function limboResult(f: number, params: LimboParams, houseEdge = HOUSE_EDGE): BetResult {
  let raw = 1 / (1 - f);
  let result = Math.floor(raw * (1 - houseEdge) * 100) / 100;
  result = Math.max(1, Math.min(MAX_PAYOUT_MULTIPLIER, result));
  const win = result >= params.target;
  return {
    game: 'limbo',
    outcome: `${result.toFixed(2)}x`,
    won: win,
    payout: win ? params.target : 0,
    multiplier: result,
    details: { result, target: params.target }
  };
}

export function crashPointFromFloat(f: number, houseEdge = HOUSE_EDGE): number {
  let raw = 1 / (1 - f);
  let point = Math.floor(raw * (1 - houseEdge) * 100) / 100;
  return Math.max(1, Math.min(MAX_PAYOUT_MULTIPLIER, point));
}

export function crashMultiplierAtTime(elapsedSeconds: number): number {
  return Math.exp(CRASH_GROWTH_K * elapsedSeconds);
}

export function crashOutcome(crashPoint: number, cashoutAt?: number): BetResult {
  const effectiveCashout = typeof cashoutAt === 'number' ? cashoutAt : 1;
  const won = cashoutAt !== undefined && cashoutAt < crashPoint;
  return {
    game: 'crash',
    outcome: `Crashed at ${crashPoint.toFixed(2)}x`,
    won,
    payout: won ? effectiveCashout : 0,
    multiplier: effectiveCashout,
    details: { crashPoint, cashoutAt }
  };
}

function binomialPmf(rows: number, k: number): number {
  let coeff = 1;
  for (let i = 1; i <= k; i += 1) {
    coeff = (coeff * (rows - i + 1)) / i;
  }
  return coeff / (2 ** rows);
}

export function generatePlinkoPayout(rows: number, risk: RiskLevel, houseEdge = HOUSE_EDGE): number[] {
  const values: number[] = [];
  const center = rows / 2;
  const factor = risk === 'low' ? 0.4 : risk === 'medium' ? 0.9 : risk === 'high' ? 1.8 : 3.2;
  const minValue = risk === 'low' ? 0.7 : risk === 'medium' ? 0.5 : risk === 'high' ? 0.2 : 0.1;
  for (let k = 0; k <= rows; k += 1) {
    const distance = Math.abs(k - center);
    values[k] = Math.max(minValue, 1 + distance * factor / (rows / 2));
  }
  const ev = values.reduce((sum, value, k) => sum + value * binomialPmf(rows, k), 0);
  const scale = (1 - houseEdge) / ev;
  return values.map((value) => Math.max(0.01, Number((value * scale).toFixed(2))));
}

export function getPlinkoLayout(rows: number, risk: RiskLevel): number[] {
  return generatePlinkoPayout(rows, risk);
}

export function plinkoOutcome(bucketIndex: number, multipliers: number[]): BetResult {
  const multiplier = multipliers[bucketIndex] ?? 0;
  return {
    game: 'plinko',
    outcome: `Bucket ${bucketIndex}`,
    won: multiplier > 0,
    payout: multiplier,
    multiplier,
    details: { bucketIndex }
  };
}

export function generateWheelLayout(segments: number, risk: RiskLevel, houseEdge = HOUSE_EDGE): number[] {
  const total = segments * (1 - houseEdge);
  const layout = Array(segments).fill(0);
  if (risk === 'high') {
    layout[0] = Number(total.toFixed(2));
    return layout;
  }
  if (risk === 'medium') {
    const winners = Math.max(3, Math.round(segments * 0.3));
    const weights = [5, 2, ...Array(Math.max(1, winners - 2)).fill(1)];
    const unit = total / weights.reduce((sum, value) => sum + value, 0);
    weights.forEach((weight, index) => { layout[index] = Number((weight * unit).toFixed(2)); });
    return layout;
  }
  const losers = Math.max(1, Math.round(segments * 0.1));
  const jackpot = Math.max(1, Math.round(segments * 0.1));
  const regular = segments - losers - jackpot;
  const jackpotValue = 2;
  const regularValue = (total - jackpot * jackpotValue) / regular;
  for (let i = losers; i < losers + regular; i += 1) layout[i] = Number(regularValue.toFixed(2));
  for (let i = losers + regular; i < segments; i += 1) layout[i] = jackpotValue;
  return layout;
}

export function wheelOutcome(index: number, layout: number[]): BetResult {
  const multiplier = layout[index] ?? 0;
  return {
    game: 'wheel',
    outcome: `Segment ${index}`,
    won: multiplier > 0,
    payout: multiplier,
    multiplier,
    details: { index }
  };
}

export function generateKenoTable(risk: KenoRisk, houseEdge = HOUSE_EDGE): Record<number, number[]> {
  const tables: Record<number, number[]> = {};
  const exponent = risk === 'classic' ? 1.4 : risk === 'low' ? 1.8 : risk === 'medium' ? 2.4 : 3.2;
  for (let picks = 1; picks <= 10; picks += 1) {
    const base: number[] = Array(picks + 1).fill(0);
    for (let hits = 0; hits <= picks; hits += 1) {
      base[hits] = hits === 0 ? 0 : Math.pow(hits, exponent);
    }
    const ev = base.reduce((sum, value, hits) => sum + value * kenoProbability(picks, hits), 0);
    const scale = (1 - houseEdge) / Math.max(ev, 1e-9);
    tables[picks] = base.map((value) => Number((value * scale).toFixed(2)));
  }
  return tables;
}

function kenoProbability(picks: number, hits: number): number {
  const total = choose(40, 10);
  const hitCount = choose(picks, hits) * choose(40 - picks, 10 - hits);
  return hitCount / total;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result *= (n - i + 1) / i;
  }
  return result;
}

export const kenoPayoutTables: Record<KenoRisk, Record<number, number[]>> = {
  classic: generateKenoTable('classic'),
  low: generateKenoTable('low'),
  medium: generateKenoTable('medium'),
  high: generateKenoTable('high')
};

export function kenoDraw(floats: number[]): number[] {
  const numbers = Array.from({ length: 40 }, (_, i) => i + 1);
  for (let i = 39; i > 0; i -= 1) {
    const j = Math.floor(floats[(39 - i) % floats.length] * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers.slice(0, 10).sort((a, b) => a - b);
}

export function kenoOutcome(draw: number[], picks: number[], risk: KenoRisk, houseEdge = HOUSE_EDGE): BetResult {
  const hits = picks.filter((value) => draw.includes(value)).length;
  const payoutMultiplier = generateKenoTable(risk, houseEdge)[picks.length][hits] ?? 0;
  return {
    game: 'keno',
    outcome: `${hits} hits`,
    won: payoutMultiplier > 0,
    payout: payoutMultiplier,
    multiplier: payoutMultiplier,
    details: { draw, hits }
  };
}

export async function diceBet(serverSeed: string, clientSeed: string, nonce: number, params: DiceParams, houseEdge = HOUSE_EDGE): Promise<BetResult> {
  const f = await rngFloat(serverSeed, clientSeed, nonce);
  return diceOutcome(f, params, houseEdge);
}

export async function limboBet(serverSeed: string, clientSeed: string, nonce: number, params: LimboParams, houseEdge = HOUSE_EDGE): Promise<BetResult> {
  const f = await rngFloat(serverSeed, clientSeed, nonce);
  return limboResult(f, params, houseEdge);
}

export async function crashBet(serverSeed: string, clientSeed: string, nonce: number, houseEdge = HOUSE_EDGE): Promise<number> {
  const f = await rngFloat(serverSeed, clientSeed, nonce);
  return crashPointFromFloat(f, houseEdge);
}

export async function plinkoBet(serverSeed: string, clientSeed: string, nonce: number, params: PlinkoParams, houseEdge = HOUSE_EDGE): Promise<BetResult> {
  const floats = await rngFloatStream(serverSeed, clientSeed, nonce, params.rows);
  const rightCount = floats.reduce((count, f) => count + (f < 0.5 ? 0 : 1), 0);
  const layout = generatePlinkoPayout(params.rows, params.risk, houseEdge);
  return plinkoOutcome(rightCount, layout);
}

export async function wheelBet(serverSeed: string, clientSeed: string, nonce: number, params: WheelParams, houseEdge = HOUSE_EDGE): Promise<BetResult> {
  const f = await rngFloat(serverSeed, clientSeed, nonce);
  const layout = generateWheelLayout(params.segments, params.risk, houseEdge);
  const index = Math.floor(f * params.segments);
  return wheelOutcome(index, layout);
}

export async function kenoBet(serverSeed: string, clientSeed: string, nonce: number, params: KenoParams, houseEdge = HOUSE_EDGE): Promise<BetResult> {
  const floats = await rngFloatStream(serverSeed, clientSeed, nonce, 40);
  const draw = kenoDraw(floats);
  return kenoOutcome(draw, params.picks, params.risk, houseEdge);
}

export async function rpsBet(serverSeed:string,clientSeed:string,nonce:number,params:RpsParams,houseEdge=HOUSE_EDGE){ return rpsOutcome(await rngFloat(serverSeed,clientSeed,nonce),params,houseEdge); }
export async function blackjackBet(serverSeed:string,clientSeed:string,nonce:number,houseEdge=HOUSE_EDGE){ return blackjackOutcome(await rngFloatStream(serverSeed,clientSeed,nonce,6),houseEdge); }
export async function towerBet(serverSeed:string,clientSeed:string,nonce:number,params:TowerParams,houseEdge=HOUSE_EDGE){ return towerOutcome(await rngFloat(serverSeed,clientSeed,nonce),params,houseEdge); }
export async function chickenBet(serverSeed:string,clientSeed:string,nonce:number,params:ChickenParams,houseEdge=HOUSE_EDGE){ return chickenOutcome(await rngFloat(serverSeed,clientSeed,nonce),params,houseEdge); }

export function minesPayoutMultiplier(mines: number, safeReveals: number, total = 25, houseEdge = HOUSE_EDGE): number {
  const safe = total - mines;
  let probability = 1;
  for (let i = 0; i < safeReveals; i += 1) {
    probability *= (safe - i) / (total - i);
  }
  const fairMultiplier = 1 / Math.max(1e-9, probability);
  return Number((fairMultiplier * (1 - houseEdge)).toFixed(2));
}

export async function minesBoard(serverSeed: string, clientSeed: string, nonce: number, mines: number, total = 25): Promise<boolean[]> {
  const positions = Array.from({ length: total }, (_, i) => i);
  const floats = await rngFloatStream(serverSeed, clientSeed, nonce, total);
  for (let i = positions.length - 1; i > 0; i -= 1) {
    const j = Math.floor(floats[positions.length - 1 - i] * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const board = Array(total).fill(false);
  for (let i = 0; i < mines; i += 1) {
    board[positions[i]] = true;
  }
  return board;
}

export async function mineRevealOutcome(board: boolean[], revealed: boolean[], index: number, mines: number): Promise<{ hit: boolean; multiplier: number; payout: number; safeReveals: number; }> {
  const hit = board[index];
  const newRevealed = [...revealed];
  newRevealed[index] = true;
  const safeReveals = newRevealed.filter((_, i) => !board[i] && newRevealed[i]).length;
  const multiplier = hit ? 0 : minesPayoutMultiplier(mines, safeReveals);
  return { hit, multiplier, payout: hit ? 0 : multiplier, safeReveals };
}
