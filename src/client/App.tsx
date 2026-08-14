import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type BetResult, type BlackjackAction, type BlackjackCardView, type BlackjackRound, type SessionState, type ShellView, type GameType, type PlatformConfig } from '../common/types.js';
import {
  diceMultiplier,
  diceTargetFromChance,
  DICE_MAX_CHANCE,
  DICE_MIN_CHANCE,
  generatePlinkoPayout,
  generateWheelLayout,
  kenoPayoutTables,
  generateKenoTable,
  minesPayoutMultiplier,
  crashMultiplierAtTime,
  diceOutcome,
  limboResult,
  plinkoOutcome,
  wheelOutcome,
  kenoDraw,
  kenoOutcome,
  minesPayoutMultiplier as computeMinesPayoutMultiplier,
  BLACKJACK_HOUSE_EDGE,
  BLACKJACK_MIN_RTP,
  blackjackHandValue
} from '../common/game.js';
import { rngFloat } from '../common/rng.js';

const gameList: Array<{ type: GameType; label: string; description: string }> = [
  { type: 'dice', label: 'Dice', description: 'Roll over/under a target with live multiplier.' },
  { type: 'limbo', label: 'Limbo', description: 'Pick a target multiplier and win if result reaches it.' },
  { type: 'crash', label: 'Crash', description: 'Cash out before the round crashes.' },
  { type: 'plinko', label: 'Plinko', description: 'Drop a ball through pegs to a payout bucket.' },
  { type: 'mines', label: 'Mines', description: 'Reveal safe tiles, cash out before a mine.' },
  { type: 'wheel', label: 'Wheel', description: 'Spin a segment wheel for a payout.' },
  { type: 'keno', label: 'Keno', description: 'Pick numbers, match the draw for hits.' }
  ,{ type: 'blackjack', label: 'Blackjack', description: 'Beat the dealer in a fast infinite-shoe round.' }
  ,{ type: 'rps', label: 'Rock Paper Scissors', description: 'Choose a hand and challenge the house.' }
  ,{ type: 'tower', label: 'Tower', description: 'Climb levels as the risk and multiplier rise.' }
  ,{ type: 'chicken', label: 'Chicken', description: 'Cross safe steps before finding a trap.' }
];

const gameIcons: Record<GameType, string> = {
  dice: '🎲',
  limbo: '🚀',
  crash: '💥',
  plinko: '🎯',
  mines: '🧨',
  wheel: '🎡',
  keno: '🔢', blackjack: '🃏', rps: '✊', tower: '🏰', chicken: '🐔'
};

const gameThemes: Record<GameType, { kicker: string; tone: string; players: string }> = {
  dice: { kicker: 'Roll the edge', tone: 'violet', players: '8.2K playing' },
  limbo: { kicker: 'How high can it go?', tone: 'cyan', players: '5.7K playing' },
  crash: { kicker: 'Cash out in time', tone: 'coral', players: '12.4K playing' },
  plinko: { kicker: 'Drop into multipliers', tone: 'gold', players: '9.8K playing' },
  mines: { kicker: 'Find gems, dodge mines', tone: 'emerald', players: '14.1K playing' },
  wheel: { kicker: 'Spin your multiplier', tone: 'pink', players: '4.3K playing' },
  keno: { kicker: 'Pick ten lucky numbers', tone: 'blue', players: '6.9K playing' },
  blackjack: { kicker: 'Beat the dealer', tone: 'emerald', players: '11.2K playing' },
  rps: { kicker: 'Choose your hand', tone: 'violet', players: '3.8K playing' },
  tower: { kicker: 'Climb the risk', tone: 'blue', players: '7.1K playing' },
  chicken: { kicker: 'Cross or cash out', tone: 'gold', players: '8.6K playing' }
};

function GameVisual({ game, houseEdge, running, result, blackjackRound, blackjackDealerVisibleCount, crashValue, crashPhase, minesRound, minesGridSize, kenoNumbers, kenoRisk, wheelSegments, wheelLayout, wheelRotation, limboTarget, plinkoRows, plinkoRisk, diceChance, diceSide, kenoPicks, kenoAnimating, onMineClick, onKenoClick }: { game: GameType; houseEdge: number; running: boolean; result: BetResult | null; blackjackRound: BlackjackRound | null; blackjackDealerVisibleCount: number | null; crashValue: number; crashPhase: string; minesRound: any; minesGridSize: number; kenoNumbers: number[]; kenoRisk: 'classic' | 'low' | 'medium' | 'high'; wheelSegments: number; wheelLayout: number[]; wheelRotation: number; limboTarget: number; plinkoRows: number; plinkoRisk: 'low' | 'medium' | 'high' | 'rain'; diceChance: number; diceSide: 'over' | 'under'; kenoPicks: number[]; kenoAnimating: boolean; onMineClick: (index: number) => void; onKenoClick: (value: number) => void }) {
  const status = running ? 'BET IN PLAY' : result ? `${result.won ? 'WIN' : 'LOSS'} · ${result.outcome}` : 'READY';
  if (game === 'plinko') {
    const bucket = Number(result?.details?.bucketIndex ?? Math.floor(plinkoRows / 2));
    const spacing = 29;
    const targetX = 320 + (bucket - plinkoRows / 2) * spacing;
    const rowStep = 360 / Math.max(1, plinkoRows - 1);
    // Build a legal peg path containing exactly `bucket` right deflections. Its
    // final x coordinate therefore always matches the server-selected bucket.
    const rights = new Set(Array.from({ length: bucket }, (_, i) => Math.floor(((i + .5) * plinkoRows) / Math.max(1, bucket))));
    let rightCount = 0;
    const pathPoints = Array.from({ length: plinkoRows }, (_, row) => {
      if (rights.has(row)) rightCount += 1;
      const steps = row + 1;
      const x = 320 + (rightCount * 2 - steps) * spacing / 2;
      return { x, y: 72 + row * rowStep };
    });
    const ballPath = `M 320 30 ${pathPoints.map(({x,y}, row) => `Q ${x + (rights.has(row) ? -7 : 7)} ${y - 10} ${x} ${y}`).join(' ')} L ${targetX} 478`;
    const pegRadius = 4.5 + (16 - plinkoRows) * .42;
    const boardWidth = (plinkoRows + 1) * spacing;
    const boardInset = Math.max(2, ((640 - boardWidth) / 2 / 640) * 100);
    return <div className={`visual-stage plinko-visual ${running ? 'is-running' : ''}`} style={{ '--payout-inset': `${boardInset}%`, '--plinko-columns': plinkoRows + 1 } as React.CSSProperties}>
      <svg className="plinko-board-svg" viewBox="0 0 640 500" preserveAspectRatio="xMidYMid meet" aria-label="Plinko peg board">
        {Array.from({ length: plinkoRows }, (_, row) => {
          const count = row + 3;
          const y = 72 + row * rowStep;
          return Array.from({ length: count }, (_, peg) => <circle className="plinko-peg" key={`${row}-${peg}`} cx={320 + (peg - (count - 1) / 2) * spacing} cy={y} r={pegRadius}/>);
        })}
        {running && result && <><path className="plinko-route" pathLength="1" d={ballPath}/><circle key={`${result.outcome}-${bucket}-${running}`} className="plinko-ball" r="7" cx="0" cy="0"><animateMotion dur="1.85s" path={ballPath} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .08 .2 1"/></circle><circle className="plinko-launch" cx="320" cy="30" r="11"/></>}
      </svg>
      <div className="payout-slots">{generatePlinkoPayout(plinkoRows, plinkoRisk).map((x, i) => <b className={!running && result?.details?.bucketIndex === i ? 'landed' : ''} key={i}>{x.toFixed(1)}×</b>)}</div>
      <div className="stage-status">{status}</div>
    </div>;
  }
  if (game === 'mines') {
    const total = minesRound?.gridSize ?? minesGridSize;
    const multiplier = minesRound?.safeCount > 0 ? minesPayoutMultiplier(minesRound.mines, minesRound.safeCount, total, houseEdge) : 1;
    const roundClass = !minesRound ? 'is-ready' : minesRound.resolved ? (minesRound.won ? 'is-won' : 'is-lost') : 'is-active';
    return <div className={`visual-stage mines-visual ${roundClass}`}>
      <div className="mines-grid" role="grid" aria-label="Mines board">
        {Array.from({ length: total }, (_, index) => {
          const revealed = Boolean(minesRound?.revealed?.[index]);
          const boardMine = Boolean(minesRound?.board?.[index]);
          const showMine = Boolean(minesRound?.resolved && boardMine);
          const safe = revealed && !boardMine;
          const tileClass = showMine ? `tile-mine ${revealed ? 'was-picked' : 'was-hidden'}` : safe ? 'tile-safe' : 'tile-hidden';
          return <button
            type="button"
            role="gridcell"
            aria-label={showMine ? `Mine at tile ${index + 1}` : safe ? `Gem at tile ${index + 1}` : `Hidden tile ${index + 1}`}
            key={index}
            disabled={!minesRound || revealed || minesRound.resolved}
            onClick={() => onMineClick(index)}
            className={tileClass}
          ><span>{showMine ? '💣' : safe ? '◆' : ''}</span></button>;
        })}
      </div>
      {minesRound && !minesRound.resolved && minesRound.safeCount > 0 && <div className="mines-live-multiplier"><small>Current payout</small><strong>{multiplier.toFixed(2)}×</strong></div>}
      <div className="stage-status">{minesRound ? (minesRound.resolved ? (minesRound.won ? `CASHED OUT · ${minesRound.payout.toFixed(2)}×` : 'MINE HIT') : `${minesRound.safeCount} GEMS · ${minesRound.mines} MINES`) : 'PLACE A BET TO START'}</div>
    </div>;
  }
  if (game === 'wheel') { const colors = ['#e83f5f','#28b7e8','#62df54','#ffc83d','#9b5de5','#ff8a3d']; const uniqueOdds = [...new Set(wheelLayout)].sort((a,b) => a-b); const colorForOdd = (odd:number) => colors[uniqueOdds.indexOf(odd) % colors.length]; return <div className="visual-stage wheel-visual"><div className={`wheel-disc ${running ? 'is-spinning' : ''}`} style={{ background: `conic-gradient(${wheelLayout.map((value, i) => `${colorForOdd(value)} ${i * 360 / wheelSegments}deg ${(i + 1) * 360 / wheelSegments}deg`).join(',')})`, transform: `rotate(${wheelRotation}deg)` }}><span>{!running && result ? `${result.multiplier.toFixed(2)}×` : running ? 'SPIN' : 'READY'}</span></div><div className="wheel-pointer">▼</div><div className="wheel-odds">{uniqueOdds.map(odd=><b key={odd} style={{'--odd-color': colorForOdd(odd)} as React.CSSProperties}>{odd.toFixed(2)}×</b>)}</div><div className="stage-status">{status}</div></div>; }
  if (game === 'keno') { const hits = kenoNumbers.filter(number => kenoPicks.includes(number)).length; const paytable = kenoPayoutTables[kenoRisk][kenoPicks.length] ?? []; return <div className="visual-stage keno-visual"><div className="keno-paytable"><span className="paytable-label">Hits / payout</span>{paytable.map((odd, count) => <div key={count} className={hits === count && kenoNumbers.length === 10 ? 'reached' : ''}><b>{count} hit</b><small>{odd.toFixed(2)}×</small></div>)}</div><div className="keno-play-grid">{Array.from({ length: 40 }, (_, i) => i + 1).map(value => { const selected = kenoPicks.includes(value); const drawn = kenoNumbers.includes(value); return <button key={value} disabled={kenoAnimating} onClick={() => onKenoClick(value)} className={`${selected ? 'selected' : ''} ${drawn ? 'drawn' : ''} ${selected && drawn ? 'hit' : ''}`}>{value}</button>; })}</div><div className="stage-status">{running ? `DRAWING ${kenoNumbers.length}/10 · ${hits} HITS` : `${kenoPicks.length}/10 SELECTED${kenoNumbers.length ? ` · ${hits} HITS` : ''}`}</div></div>; }
  if (game === 'dice') { const target = diceTargetFromChance(diceChance, diceSide); const marker = result ? Number(result.details?.roll ?? target) : target; return <div className={`visual-stage dice-visual ${running ? 'is-running' : ''}`}><div className="dice-scale-labels"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div><div className={`range-track ${diceSide}`}><span style={{ left: `${marker}%` }}/><b>{marker.toFixed(2)}</b></div><div className="dice-metrics"><div><small>Multiplier</small><strong>{diceMultiplier(diceChance).toFixed(4)}×</strong></div><div><small>Roll {diceSide === 'over' ? 'Over' : 'Under'}</small><strong>{target.toFixed(2)}</strong></div><div><small>Win Chance</small><strong>{diceChance.toFixed(2)}%</strong></div></div><div className="stage-status">{status}</div></div>; }
  if (game === 'limbo') return <div className={`visual-stage limbo-visual ${running ? 'is-running' : ''} ${!running && result ? (result.won ? 'won' : 'lost') : ''}`}><span>{running ? '···' : result ? result.outcome : `${limboTarget.toFixed(2)}×`}</span><div className="orbit one"/><div className="orbit two"/><div className="stage-status">{status}</div></div>;
  if (game === 'blackjack') {
    const rankLabel = (rank?: number) => rank === 1 ? 'A' : rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : String(rank ?? '');
    const suitLabel = (suit?: BlackjackCardView['suit']) => ({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' }[String(suit)] ?? '');
    const card = (item: BlackjackCardView, index: number, dealStep = 0, motion: 'deal' | 'reveal' | 'static' = 'static', stableKey?: string) => {
      const redSuit = item.suit === 'diamonds' || item.suit === 'hearts';
      const classes = ['playing-card', item.hidden ? 'hidden-card' : '', redSuit ? 'red-suit' : '', motion === 'deal' ? 'dealing-card' : '', motion === 'reveal' ? 'dealer-reveal' : ''].filter(Boolean).join(' ');
      return <b key={stableKey ?? `${item.index}-${index}`} className={classes} aria-label={item.hidden ? 'Hidden dealer card' : `${rankLabel(item.rank)} of ${item.suit}`} style={{ '--deal-step': dealStep, '--card-position': index } as React.CSSProperties}>
        {!item.hidden && <span className="card-value">{rankLabel(item.rank)}<i>{suitLabel(item.suit)}</i></span>}
        {(item.hidden || motion === 'reveal') && <span className="card-back-mark" aria-hidden="true">O</span>}
      </b>;
    };
    const initialDeal = blackjackRound?.version === 1 && blackjackRound.phase !== 'settled';
    const dealerCard = (item: BlackjackCardView, index: number) => {
      if (initialDeal) return card(item, index, index * 2 + 1, 'deal', `dealer-card-${index}`);
      if (blackjackRound?.phase === 'settled' && index === 1) return card(item, index, 0, 'reveal', `dealer-card-${index}`);
      if (blackjackRound?.phase === 'settled' && index >= 2) return card(item, index, index, 'deal', `dealer-card-${index}`);
      return card(item, index, 0, 'static', `dealer-card-${index}`);
    };
    const playerCard = (item: BlackjackCardView, index: number, handIndex: number) => {
      const splitReplacement = blackjackRound?.hands.length === 2 && index === 1;
      const motion = initialDeal || index >= 2 || splitReplacement ? 'deal' : 'static';
      const dealStep = initialDeal ? index * 2 : splitReplacement ? handIndex + 1 : 0;
      return card(item, index, dealStep, motion);
    };
    const stagedDealerCards = blackjackDealerVisibleCount === null ? [] : blackjackRound?.dealerCards.slice(0, blackjackDealerVisibleCount).filter((item): item is BlackjackCardView & { rank: number } => typeof item.rank === 'number') ?? [];
    const stagedDealerTotal = blackjackDealerVisibleCount === null ? blackjackRound?.dealerTotal : blackjackDealerVisibleCount === 0 ? '—' : blackjackHandValue(stagedDealerCards).total;
    const tableStatus = running ? 'DEALING…' : !blackjackRound ? 'PLACE A BET TO START' : blackjackRound.phase === 'insurance' ? 'INSURANCE DECISION' : blackjackRound.phase === 'player' ? `HAND ${blackjackRound.activeHandIndex + 1} · YOUR MOVE` : `${blackjackRound.outcome?.toUpperCase()} · ${blackjackRound.net >= 0 ? '+' : ''}${formatCash(blackjackRound.net)}`;
    return <div className={`visual-stage table-visual blackjack-${blackjackRound?.phase ?? 'ready'} ${running ? 'is-running' : ''}`} aria-live="polite">
      <div className="shoe-stack">▤<small>INFINITE SHOE</small></div>
      <div className="dealer-hand"><small>DEALER <em key={`dealer-total-${blackjackDealerVisibleCount}-${stagedDealerTotal}`} className={blackjackDealerVisibleCount !== null ? 'dealer-total-counting' : ''}>{stagedDealerTotal ?? '—'}</em></small><div>{blackjackRound?.dealerCards.map(dealerCard)}</div></div>
      <div className="felt-mark"><b>BLACKJACK PAYS 3 TO 2</b><span>INSURANCE PAYS 2 TO 1</span></div>
      <div className={`blackjack-hands ${blackjackRound?.hands.length === 2 ? 'is-split' : ''}`}>
        {(blackjackRound?.hands ?? []).map((hand, handIndex) => <div className={`player-hand ${blackjackRound?.phase === 'player' && blackjackRound.activeHandIndex === handIndex ? 'active-hand' : ''}`} key={hand.id}>
          <small>HAND {handIndex + 1} <em>{hand.total}</em>{hand.result && <strong className={`hand-result ${hand.result}`}>{hand.result}</strong>}</small>
          <div>{hand.cards.map((item, index) => playerCard(item, index, handIndex))}</div>
          <span className="hand-wager">{formatCash(hand.wager)}{hand.doubled ? ' · DOUBLED' : hand.splitAces ? ' · SPLIT ACES' : ''}{hand.payout > 0 ? ` · Return ${formatCash(hand.payout)}` : ''}</span>
        </div>)}
        {!blackjackRound && <div className="player-hand empty-hand"><small>PLAYER <em>—</em></small><div><span>Deal to begin</span></div></div>}
      </div>
      <div className="bet-ring">BET</div><div className="stage-status">{tableStatus}</div>
    </div>;
  }
  if (game === 'rps') { const icons:any={rock:'✊',paper:'✋',scissors:'✌️'}; return <div className={`visual-stage duel-visual ${running?'is-running':''}`}><div className="duel-side player"><small>YOUR HAND</small><b>{icons[String(result?.details?.choice??'rock')]}</b><i>LOCKED</i></div><div className="duel-center"><span>VS</span><em>{result?.multiplier?.toFixed(2)??'2.97'}×</em></div><div className="duel-side house"><small>HOUSE HAND</small><b>{running?'❔':icons[String(result?.details?.opponent??'paper')]}</b><i>{running?'REVEALING':'REVEALED'}</i></div><div className="stage-status">{status}</div></div>; }
  if (game === 'tower') { const reached=Number(result?.details?.reached??0), target=Number(result?.details?.target??5); return <div className="visual-stage tower-visual"><div className="tower-pillars left"/><div className="tower-pillars right"/><div className="tower-grid">{Array.from({length:9},(_,i)=>8-i).map(level=><div key={level} className={`${level<reached?'safe':result&&!result.won&&level===reached?'trap':''} ${level===target-1?'target':''}`}><span>{level+1}<small>{(1.25**(level+1)).toFixed(2)}×</small></span>{[0,1,2,3].map(x=><b key={x}>{level<reached?'◆':result&&!result.won&&level===reached&&x===2?'💣':'?'}</b>)}</div>)}</div><strong className="progress-caption">Target level {target}</strong><div className="stage-status">{status}</div></div>; }
  if (game === 'chicken') { const reached=Number(result?.details?.reached??0), target=Number(result?.details?.target??5); return <div className="visual-stage chicken-visual"><div className="road">{Array.from({length:15},(_,i)=><span key={i} className={i<reached?'safe':result&&!result.won&&i===reached?'trap':''}>{i<reached?'✓':result&&!result.won&&i===reached?'💥':i+1}</span>)}<b className="chicken-runner" style={{left:`${Math.min(94,reached/15*100)}%`}}>🐔</b></div><strong className="progress-caption">Cross {target} steps</strong><div className="stage-status">{status}</div></div>; }
  const flightProgress = Math.min(.94, Math.max(.04, Math.log(Math.max(1, crashValue)) / Math.log(12)));
  const planeX = 35 + flightProgress * 515;
  const planeY = 210 - Math.pow(flightProgress, 1.45) * 175;
  return <div className={`visual-stage crash-visual ${crashPhase}`}><span>{crashValue.toFixed(2)}×</span><svg viewBox="0 0 600 230" preserveAspectRatio="none"><path className="crash-curve" pathLength="1" style={{ strokeDasharray: 1, strokeDashoffset: 1 - flightProgress }} d="M0 215 C130 210 250 190 340 145 S485 40 600 10" /><g className="aviator-plane" style={{ transform: `translate(${planeX}px,${planeY}px) rotate(-16deg)` }}><path d="M-28 3 L-5-2 L15-20 L23-18 L14-1 L34 5 L35 11 L10 10 L-3 25 L-10 23 L-5 9 L-29 10 Z"/><path className="plane-wing" d="M-3 1 L-19-15 L-11-17 L10 2 Z"/></g></svg><div className="flight-clouds"/><div className="burst" style={{ left: `${planeX / 6}%`, top: `${planeY / 2.3}%` }}>💥</div><div className="stage-status">{crashPhase === 'busted' ? `BUSTED AT ${crashValue.toFixed(2)}×` : crashPhase === 'cashed' ? `CASHED OUT AT ${crashValue.toFixed(2)}×` : crashPhase === 'flying' ? 'ROUND IN PROGRESS' : 'PLACE A BET'}</div></div>;
}

const riskOptions = ['low', 'medium', 'high'] as const;
const plinkoRiskOptions = ['low', 'medium', 'high', 'rain'] as const;
const kenoRiskOptions = ['classic', 'low', 'medium', 'high'] as const;

function formatCash(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const apiFetch = async <T,>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error || 'API request failed');
  }
  return json as T;
};

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [view, setView] = useState<ShellView>('web');
  const [screen, setScreen] = useState<'lobby' | 'game' | 'admin'>('lobby');
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig | null>(null);
  const [adminDraft, setAdminDraft] = useState<PlatformConfig | null>(null);
  const [adminAudit, setAdminAudit] = useState<Array<{version:number;updatedAt:string;summary:string}>>([]);
  const [adminMessage, setAdminMessage] = useState('');
  const [lobbyFilter, setLobbyFilter] = useState<'all' | 'favorites' | 'recent'>('all');
  const [gameSearch, setGameSearch] = useState('');
  const [gameSort, setGameSort] = useState<'recommended' | 'name' | 'players'>('recommended');
  const [betFeed, setBetFeed] = useState<'all' | 'high' | 'mine'>('all');
  const [selectedGame, setSelectedGame] = useState<GameType>('dice');
  const [showFairness, setShowFairness] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSeedInput, setClientSeedInput] = useState('');
  const [verifierOpen, setVerifierOpen] = useState(false);
  const [verifierState, setVerifierState] = useState({ serverSeed: '', clientSeed: '', nonce: 0, game: 'dice' as GameType, params: '{}' });
  const [verifyResult, setVerifyResult] = useState<string>('');

  const [diceSide, setDiceSide] = useState<'over' | 'under'>('over');
  const [diceChance, setDiceChance] = useState(50);
  const [limboTarget, setLimboTarget] = useState(2);
  const [plinkoRows, setPlinkoRows] = useState(16);
  const [plinkoRisk, setPlinkoRisk] = useState<'low' | 'medium' | 'high' | 'rain'>('low');
  const [wheelSegments, setWheelSegments] = useState(20);
  const [wheelRisk, setWheelRisk] = useState<'low' | 'medium' | 'high'>('low');
  const [kenoRisk, setKenoRisk] = useState<'classic' | 'low' | 'medium' | 'high'>('classic');
  const [kenoPicks, setKenoPicks] = useState<number[]>([1, 2, 3, 4, 5]);
  const [kenoDrawRun, setKenoDrawRun] = useState<number[]>([]);
  const [kenoDrawReveal, setKenoDrawReveal] = useState<number[]>([]);
  const [kenoDrawIndex, setKenoDrawIndex] = useState(0);
  const [kenoAnimating, setKenoAnimating] = useState(false);
  const [kenoResult, setKenoResult] = useState<BetResult | null>(null);
  const [kenoMessage, setKenoMessage] = useState('Select 1-10 numbers and place your bet.');
  const [minesCount, setMinesCount] = useState(6);
  const minesGridSize = 25;
  const [crashAuto, setCrashAuto] = useState(2);
  const [amountInput, setAmountInput] = useState(10);
  const [cashoutError, setCashoutError] = useState<string | null>(null);
  const [crashRound, setCrashRound] = useState<any>(null);
  const [minesRound, setMinesRound] = useState<any>(null);
  const [blackjackRound, setBlackjackRound] = useState<BlackjackRound | null>(null);
  const [blackjackBusy, setBlackjackBusy] = useState(false);
  const [blackjackDealerVisibleCount, setBlackjackDealerVisibleCount] = useState<number | null>(null);
  const blackjackAnimationRunRef = useRef(0);
  const [minesSelected, setMinesSelected] = useState<number[]>([]);
  const [visualRunning, setVisualRunning] = useState(false);
  const [visualResult, setVisualResult] = useState<BetResult | null>(null);
  const [crashValue, setCrashValue] = useState(1);
  const [crashPhase, setCrashPhase] = useState<'ready' | 'flying' | 'busted' | 'cashed'>('ready');
  const [animationMode, setAnimationMode] = useState<'advanced' | 'instant'>('advanced');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [betMode, setBetMode] = useState<'manual' | 'auto'>('manual');
  const [autoRounds, setAutoRounds] = useState(5);
  const [autoRemaining, setAutoRemaining] = useState(0);
  const [autoInfinite, setAutoInfinite] = useState(false);
  const [autoDelay, setAutoDelay] = useState(400);
  const [autoMinesGems, setAutoMinesGems] = useState(3);
  const [autoWinIncrease, setAutoWinIncrease] = useState(0);
  const [autoLossIncrease, setAutoLossIncrease] = useState(0);
  const [autoStopProfit, setAutoStopProfit] = useState(0);
  const [autoStopLoss, setAutoStopLoss] = useState(0);
  const [autoProfit, setAutoProfit] = useState(0);
  const [autoCompleted, setAutoCompleted] = useState(0);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoStatus, setAutoStatus] = useState('Ready');
  const [rpsChoice, setRpsChoice] = useState<'rock'|'paper'|'scissors'>('rock');
  const [progressDifficulty, setProgressDifficulty] = useState<'easy'|'medium'|'hard'>('medium');
  const [progressTarget, setProgressTarget] = useState(5);
  const autoStopRef = useRef(false);
  const autoRunningRef = useRef(false);
  const autoRunIdRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    autoStopRef.current = true;
    autoRunIdRef.current += 1;
    autoRunningRef.current = false;
    setAutoRunning(false);
    setAutoRemaining(0);
    setAutoProfit(0);
    setAutoCompleted(0);
    setAutoStatus('Ready');
    setVisualRunning(false);
    setVisualResult(null);
    setKenoResult(null);
    setKenoDrawReveal([]);
    setKenoAnimating(false);
    setCrashPhase('ready');
    if (selectedGame === 'blackjack') setBetMode('manual');
  }, [selectedGame]);

  const playTone = (kind: 'click' | 'start' | 'tick' | 'win' | 'lose', game: GameType = selectedGame) => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === 'suspended') void context.resume();
      const bases: Record<GameType, number> = { dice: 250, limbo: 330, crash: 120, plinko: 510, mines: 190, wheel: 390, keno: 610, blackjack: 280, rps: 440, tower: 170, chicken: 560 };
      const pattern = kind === 'win' ? [1,1.26,1.5] : kind === 'lose' ? [1,.78,.56] : kind === 'start' ? [1,1.18] : kind === 'tick' ? [1,1.06] : [1];
      pattern.forEach((ratio,index) => {
        const oscillator = context.createOscillator(); const gain = context.createGain();
        oscillator.type = game === 'crash' ? 'sawtooth' : game === 'plinko' ? 'sine' : game === 'wheel' ? 'triangle' : 'square';
        const begins = context.currentTime + index * .065;
        oscillator.frequency.setValueAtTime(bases[game] * ratio, begins);
        gain.gain.setValueAtTime(kind === 'click' ? .012 : .025, begins);
        gain.gain.exponentialRampToValueAtTime(.0001, begins + (kind === 'win' ? .18 : .09));
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(begins); oscillator.stop(begins + .2);
      });
    } catch { /* sound is optional */ }
  };

  useEffect(() => {
    apiFetch<SessionState>('/api/session')
      .then((data) => {
        setSession(data);
        setClientSeedInput(data.clientSeed);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { apiFetch<PlatformConfig>('/api/config').then(config => { setPlatformConfig(config); setAdminDraft(structuredClone(config)); }).catch(() => undefined); }, []);

  useEffect(() => {
    if (selectedGame !== 'blackjack') return;
    apiFetch<{round: BlackjackRound | null; balance: number; nonce: number}>('/api/blackjack/state')
      .then(payload => {
        setBlackjackRound(payload.round);
        setSession(current => current ? { ...current, balance: payload.balance, nonce: payload.nonce } : current);
      })
      .catch((err: Error) => setError(err.message));
  }, [selectedGame]);

  const openBackoffice = async () => {
    const payload = await apiFetch<{config: PlatformConfig; audit: typeof adminAudit}>('/api/admin/config');
    setPlatformConfig(payload.config); setAdminDraft(structuredClone(payload.config)); setAdminAudit(payload.audit); setScreen('admin');
  };

  const publishConfig = async () => {
    if (!adminDraft) return;
    try {
      const payload = await apiFetch<{config: PlatformConfig; audit: typeof adminAudit}>('/api/admin/config', { games: adminDraft.games });
      setPlatformConfig(payload.config); setAdminDraft(structuredClone(payload.config)); setAdminAudit(payload.audit); setAdminMessage(`Version ${payload.config.version} published`);
    } catch (err:any) { setAdminMessage(err.message); }
  };

  const refreshSession = async () => {
    try {
      const data = await apiFetch<SessionState>('/api/session');
      setSession(data);
      setClientSeedInput(data.clientSeed);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const updateClientSeed = async () => {
    try {
      const data = await apiFetch<{ clientSeed: string }>('/api/client-seed', { clientSeed: clientSeedInput });
      setSession((prev) => (prev ? { ...prev, clientSeed: data.clientSeed, nonce: 0 } : prev));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const rotateSeed = async () => {
    try {
      await apiFetch<{ serverSeedHash: string; revealed: string }>('/api/rotate-seed');
      await refreshSession();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const placeBet = async (game: GameType, params: Record<string, unknown>, amount = amountInput) => {
    setError(null);
    setVisualRunning(true);
    playTone('start', game);
    try {
      const result = await apiFetch<BetResult & { balance: number; nonce: number }>('/api/bet', {
        game,
        amount,
        params
      });
      setVisualResult(result);
      if (game === 'wheel') {
        const segmentAngle = 360 / wheelSegments;
        const index = Number(result.details?.index ?? 0);
        const currentNormalized = ((wheelRotation % 360) + 360) % 360;
        const targetNormalized = ((-(index * segmentAngle + segmentAngle / 2) % 360) + 360) % 360;
        const delta = (targetNormalized - currentNormalized + 360) % 360;
        setWheelRotation((current) => current + (animationMode === 'instant' ? 0 : 5 * 360) + delta);
      }
      if (animationMode === 'advanced' && game === 'plinko') Array.from({ length: plinkoRows }, (_, index) => window.setTimeout(() => playTone('tick', 'plinko'), 110 + index * (1450 / plinkoRows)));
      if (animationMode === 'advanced' && game === 'wheel') Array.from({ length: 12 }, (_, index) => window.setTimeout(() => playTone('tick', 'wheel'), 100 + index * 155));
      const duration = animationMode === 'instant' ? 0 : game === 'wheel' ? 2300 : game === 'plinko' ? 1850 : game === 'blackjack' ? 1250 : game === 'tower'||game==='chicken' ? 1100 : game === 'dice' ? 700 : game === 'limbo' ? 850 : 600;
      await new Promise((resolve) => window.setTimeout(resolve, duration));
      setVisualRunning(false);
      playTone(result.won ? 'win' : 'lose', game);
      await refreshSession();
      return result;
    } catch (err: any) {
      setVisualRunning(false);
      setError(err.message);
      throw err;
    }
  };

  const applyBlackjackResponse = async (payload: { round: BlackjackRound; balance: number; nonce: number }, transition: BlackjackAction | 'insurance' | 'start') => {
    const animationRun = ++blackjackAnimationRunRef.current;
    const advancedInitialDeal = animationMode === 'advanced' && transition === 'start' && payload.round.version === 1 && payload.round.phase !== 'settled';
    const advancedDealerSequence = animationMode === 'advanced' && payload.round.phase === 'settled';
    if (advancedInitialDeal) setBlackjackDealerVisibleCount(0);
    else if (advancedDealerSequence) setBlackjackDealerVisibleCount(1);
    else if (transition === 'start') setBlackjackDealerVisibleCount(null);
    setBlackjackRound(payload.round);
    setSession(current => current ? { ...current, balance: payload.balance, nonce: payload.nonce } : current);
    if (animationMode === 'advanced') {
      const extraDealerCards = Math.max(0, payload.round.dealerCards.length - 2);
      const dealerSequenceDuration = extraDealerCards === 0 ? 775 : 638 + (extraDealerCards + 1) * 350;
      const playerSequenceDuration = transition === 'split' ? 1338 : transition === 'insurance' ? 0 : 638;
      const animationDuration = advancedInitialDeal ? 1688 : payload.round.phase === 'settled' ? Math.max(playerSequenceDuration, dealerSequenceDuration) : playerSequenceDuration;
      let elapsed = 0;
      const revealAt = async (time: number, visibleCount: number) => {
        await new Promise(resolve => window.setTimeout(resolve, Math.max(0, time - elapsed)));
        elapsed = time;
        if (blackjackAnimationRunRef.current === animationRun) setBlackjackDealerVisibleCount(visibleCount);
      };
      if (advancedInitialDeal) await revealAt(913, 1);
      if (advancedDealerSequence) {
        await revealAt(350, Math.min(2, payload.round.dealerCards.length));
        for (let index = 2; index < payload.round.dealerCards.length; index += 1) await revealAt(index * 350 + 563, index + 1);
      }
      await new Promise(resolve => window.setTimeout(resolve, Math.max(0, animationDuration - elapsed)));
      if (advancedDealerSequence && blackjackAnimationRunRef.current === animationRun) setBlackjackDealerVisibleCount(payload.round.dealerCards.length);
    }
    if (payload.round.phase === 'settled') {
      playTone(payload.round.net > 0 ? 'win' : 'lose', 'blackjack');
      await refreshSession();
    }
  };

  const startBlackjack = async () => {
    setError(null);
    setBlackjackBusy(true);
    setVisualRunning(true);
    playTone('start', 'blackjack');
    try {
      const requestId = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const payload = await apiFetch<{round: BlackjackRound; balance: number; nonce: number}>('/api/blackjack/start', { amount: amountInput, requestId });
      await applyBlackjackResponse(payload, 'start');
    } catch (err: any) {
      setError(err.message);
      try {
        const recovered = await apiFetch<{round: BlackjackRound | null; balance: number; nonce: number}>('/api/blackjack/state');
        if (recovered.round) setBlackjackRound(recovered.round);
      } catch { /* retain the original action error */ }
    } finally {
      setVisualRunning(false);
      setBlackjackBusy(false);
    }
  };

  const decideBlackjackInsurance = async (take: boolean) => {
    setError(null);
    setBlackjackBusy(true);
    try {
      if (!blackjackRound) throw new Error('No Blackjack round found');
      const requestId = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const payload = await apiFetch<{round: BlackjackRound; balance: number; nonce: number}>('/api/blackjack/insurance', { take, requestId, roundId: blackjackRound.id, version: blackjackRound.version });
      await applyBlackjackResponse(payload, 'insurance');
    } catch (err: any) { setError(err.message); }
    finally { setBlackjackBusy(false); }
  };

  const actBlackjack = async (action: BlackjackAction) => {
    setError(null);
    setBlackjackBusy(true);
    setVisualRunning(true);
    try {
      if (!blackjackRound) throw new Error('No Blackjack round found');
      const requestId = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const payload = await apiFetch<{round: BlackjackRound; balance: number; nonce: number}>('/api/blackjack/action', { action, requestId, roundId: blackjackRound.id, version: blackjackRound.version });
      await applyBlackjackResponse(payload, action);
    } catch (err: any) {
      setError(err.message);
      try {
        const recovered = await apiFetch<{round: BlackjackRound | null; balance: number; nonce: number}>('/api/blackjack/state');
        if (recovered.round) setBlackjackRound(recovered.round);
      } catch { /* retain the original action error */ }
    } finally {
      setVisualRunning(false);
      setBlackjackBusy(false);
    }
  };

  const autoPickKeno = () => {
    const available = Array.from({ length: 40 }, (_, index) => index + 1);
    const shuffled = available.sort(() => Math.random() - 0.5).slice(0, 10).sort((a, b) => a - b);
    setKenoPicks(shuffled);
  };

  const clearKeno = () => {
    setKenoPicks([]);
    setKenoResult(null);
    setKenoDrawRun([]);
    setKenoDrawReveal([]);
    setKenoDrawIndex(0);
    setKenoAnimating(false);
    setKenoMessage('Select 1-10 numbers and place your bet.');
  };

  const toggleKenoNumber = (value: number) => {
    if (kenoAnimating || autoRunningRef.current) return;
    setKenoPicks((current) => current.includes(value) ? current.filter((number) => number !== value) : current.length < 10 ? [...current, value] : current);
  };

  const revealKenoNumbers = async (draw: number[]) => {
    setKenoDrawRun(draw);
    setKenoDrawReveal([]);
    setKenoDrawIndex(0);
    setKenoAnimating(true);
    setKenoMessage('Drawing numbers...');
  };

  useEffect(() => {
    if (!kenoAnimating || kenoDrawIndex >= kenoDrawRun.length) {
      if (kenoAnimating && kenoDrawIndex >= kenoDrawRun.length) {
        setKenoAnimating(false);
        setVisualRunning(false);
        if (kenoResult) setVisualResult(kenoResult);
        const hits = kenoResult?.details?.draw.filter((num: number) => kenoPicks.includes(num)).length ?? 0;
        setKenoMessage(`Draw complete — ${hits} hit${hits === 1 ? '' : 's'}!`);
        if (kenoResult) playTone(kenoResult.won ? 'win' : 'lose');
      }
      return;
    }

    const timer = window.setTimeout(() => {
      playTone('tick');
      setKenoDrawReveal((prev) => [...prev, kenoDrawRun[kenoDrawIndex]]);
      setKenoDrawIndex((current) => current + 1);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [kenoAnimating, kenoDrawIndex, kenoDrawRun, kenoResult, kenoPicks]);

  const placeKenoBet = async (amount = amountInput) => {
    setError(null);
    if (kenoPicks.length < 1) {
      const message = 'Choose at least one number for Keno.';
      setError(message);
      throw new Error(message);
    }

    try {
      setVisualResult(null);
      setVisualRunning(true);
      const result = await apiFetch<BetResult & { balance: number; nonce: number }>('/api/bet', {
        game: 'keno',
        amount,
        params: { picks: kenoPicks, risk: kenoRisk }
      });
      setKenoResult(result);
      const draw = result.details?.draw as number[] ?? [];
      await refreshSession();
      await revealKenoNumbers(draw);
      return result;
    } catch (err: any) {
      setVisualRunning(false);
      setError(err.message);
      throw err;
    }
  };

  const startCrash = async () => {
    setCashoutError(null);
    try {
      playTone('start');
      const payload = await apiFetch<any>('/api/crash/start', { amount: amountInput, autoCashout: crashAuto > 1 ? crashAuto : undefined });
      setCrashRound(payload.round);
      setCrashValue(1);
      setCrashPhase('flying');
      await refreshSession();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const cashoutCrash = async () => {
    try {
      const payload = await apiFetch<any>('/api/crash/cashout', {});
      setCrashRound(payload.round);
      setCrashValue(payload.round.payout > 0 ? (payload.round.cashedOutAt ?? crashValue) : (payload.round.crashPoint ?? crashValue));
      setCrashPhase(payload.round.payout > 0 ? 'cashed' : 'busted');
      setCashoutError(null);
      await refreshSession();
    } catch (err: any) {
      setCashoutError(err.message);
    }
  };

  useEffect(() => {
    if (!crashRound || crashRound.resolved || crashPhase !== 'flying') return;
    if (autoRunningRef.current && selectedGame === 'crash') return;
    let settling = false;
    const timer = window.setInterval(async () => {
      const elapsed = (Date.now() - new Date(crashRound.startedAt).getTime()) / 1000;
      const next = crashMultiplierAtTime(elapsed);
      const crashPoint = Number(crashRound.crashPoint ?? Number.POSITIVE_INFINITY);
      setCrashValue(Math.min(next, crashPoint));
      const reachedAuto = typeof crashRound.autoCashout === 'number' && next >= crashRound.autoCashout;
      const reachedCrash = next >= crashPoint;
      if (!settling && (reachedAuto || reachedCrash)) {
        settling = true;
        window.clearInterval(timer);
        try {
          const payload = await apiFetch<any>('/api/crash/cashout', {});
          setCrashRound(payload.round);
          setCrashValue(payload.round.payout > 0 ? (payload.round.cashedOutAt ?? next) : (payload.round.crashPoint ?? next));
          setCrashPhase(payload.round.payout > 0 ? 'cashed' : 'busted');
          playTone(payload.round.payout > 0 ? 'win' : 'lose');
          setCashoutError(null);
          await refreshSession();
        } catch (err: any) {
          setCrashPhase('busted');
          setCashoutError(err.message);
        }
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [crashRound, crashPhase]);

  const startMines = async () => {
    setError(null);
    try {
      playTone('start', 'mines');
      const payload = await apiFetch<any>('/api/mines/start', { amount: amountInput, mines: minesCount });
      setMinesRound(payload.round);
      setMinesSelected([]);
      setVisualResult(null);
      await refreshSession();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const revealMine = async (index: number) => {
    if (!minesRound || minesRound.resolved || minesRound.revealed[index]) return;
    try {
      setVisualRunning(true);
      const payload = await apiFetch<any>('/api/mines/reveal', { index });
      setMinesRound(payload.round);
      setMinesSelected((current) => [...current, index]);
      playTone(payload.round.resolved && !payload.round.won ? 'lose' : payload.round.resolved ? 'win' : 'tick');
      if (payload.round.resolved) setVisualResult({ game: 'mines', outcome: payload.round.won ? 'All safe tiles cleared' : 'Mine hit', won: payload.round.won, payout: payload.round.payout, multiplier: payload.round.payout });
      window.setTimeout(() => setVisualRunning(false), animationMode === 'instant' ? 0 : 240);
      await refreshSession();
    } catch (err: any) {
      setVisualRunning(false);
      setError(err.message);
    }
  };

  const cashoutMines = async () => {
    try {
      const payload = await apiFetch<any>('/api/mines/cashout', {});
      setMinesRound(payload.round);
      setVisualResult({ game: 'mines', outcome: `Cashed out at ${payload.round.payout.toFixed(2)}x`, won: true, payout: payload.round.payout, multiplier: payload.round.payout });
      playTone('win', 'mines');
      await refreshSession();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const pause = (duration: number) => new Promise<void>((resolve) => window.setTimeout(resolve, duration));

  const secureChoice = (values: number[]) => {
    const random = new Uint32Array(1);
    window.crypto.getRandomValues(random);
    return values[random[0] % values.length];
  };

  const runMinesAutoRound = async (amount: number): Promise<BetResult> => {
    const started = await apiFetch<any>('/api/mines/start', { amount, mines: minesCount });
    let round = started.round;
    setMinesRound(round);
    setMinesSelected([]);
    setVisualResult(null);
    playTone('start', 'mines');

    const available = Array.from({ length: 25 }, (_, index) => index);
    const gemsToReveal = clamp(autoMinesGems, 1, 25 - minesCount);
    for (let pick = 0; pick < gemsToReveal; pick += 1) {
      const index = secureChoice(available);
      available.splice(available.indexOf(index), 1);
      const response = await apiFetch<any>('/api/mines/reveal', { index });
      round = response.round;
      setMinesRound(round);
      setMinesSelected((current) => [...current, index]);
      playTone(round.resolved ? 'lose' : 'tick', 'mines');
      if (animationMode === 'advanced') await pause(260);
      if (round.resolved) {
        const result: BetResult = { game: 'mines', outcome: 'Mine hit', won: false, payout: 0, multiplier: 0 };
        setVisualResult(result);
        await refreshSession();
        return result;
      }
      if (autoStopRef.current) break;
    }

    const cashed = await apiFetch<any>('/api/mines/cashout', {});
    round = cashed.round;
    setMinesRound(round);
    const result: BetResult = { game: 'mines', outcome: `Cashed out at ${round.payout.toFixed(2)}x`, won: true, payout: round.payout * amount, multiplier: round.payout };
    setVisualResult(result);
    playTone('win', 'mines');
    await refreshSession();
    return result;
  };

  const runCrashAutoRound = async (amount: number): Promise<BetResult> => {
    const target = Math.max(1.01, crashAuto > 1 ? crashAuto : 2);
    const started = await apiFetch<any>('/api/crash/start', { amount, autoCashout: target });
    setCrashRound(started.round);
    setCrashValue(1);
    setCrashPhase('flying');
    playTone('start', 'crash');
    const finishAt = Math.min(target, Number(started.round.crashPoint ?? target));
    await pause(Math.log(Math.max(1.01, finishAt)) / .35 * 1000 + 120);
    const settled = await apiFetch<any>('/api/crash/cashout', {});
    const round = settled.round;
    const won = round.payout > 0;
    setCrashRound(round);
    setCrashValue(won ? (round.cashedOutAt ?? target) : round.crashPoint);
    setCrashPhase(won ? 'cashed' : 'busted');
    playTone(won ? 'win' : 'lose', 'crash');
    await refreshSession();
    return { game: 'crash', outcome: `Crash at ${round.crashPoint.toFixed(2)}x`, won, payout: round.payout * amount, multiplier: round.payout };
  };

  const runAutoBets = async () => {
    if (autoRunningRef.current) {
      autoStopRef.current = true;
      setAutoStatus('Stopping after current round…');
      return;
    }
    if (selectedGame === 'mines' && minesRound && !minesRound.resolved) {
      setError('Cash out or finish the active Mines round before starting Auto Bet.');
      return;
    }
    if (selectedGame === 'crash' && crashRound && !crashRound.resolved) {
      setError('Finish the active Crash round before starting Auto Bet.');
      return;
    }
    if (selectedGame === 'blackjack') {
      setError('Blackjack Auto Bet is unavailable until an autoplay decision strategy is defined. Use the complete manual action flow.');
      return;
    }

    autoRunningRef.current = true;
    autoStopRef.current = false;
    setAutoRunning(true);
    setAutoProfit(0);
    setAutoCompleted(0);
    setAutoStatus('Running');
    setError(null);
    const runId = ++autoRunIdRef.current;
    const game = selectedGame;
    const totalRounds = Math.max(1, Math.floor(autoRounds));
    let completed = 0;
    let profit = 0;
    let currentAmount = amountInput;
    let stopStatus = '';

    try {
      while (!autoStopRef.current && runId === autoRunIdRef.current && (autoInfinite || completed < totalRounds)) {
        setAutoRemaining(autoInfinite ? -1 : totalRounds - completed);
        let result: BetResult;
        if (game === 'dice') result = await placeBet('dice', { side: diceSide, winChance: diceChance }, currentAmount);
        else if (game === 'limbo') result = await placeBet('limbo', { target: limboTarget }, currentAmount);
        else if (game === 'plinko') result = await placeBet('plinko', { rows: plinkoRows, risk: plinkoRisk }, currentAmount);
        else if (game === 'wheel') result = await placeBet('wheel', { segments: wheelSegments, risk: wheelRisk }, currentAmount);
        else if (game === 'keno') {
          result = await placeKenoBet(currentAmount);
          await pause(animationMode === 'instant' ? 120 : 900);
        }
        else if (game === 'rps') result = await placeBet('rps', { choice: rpsChoice }, currentAmount);
        else if (game === 'tower') result = await placeBet('tower', { difficulty: progressDifficulty, level: progressTarget }, currentAmount);
        else if (game === 'chicken') result = await placeBet('chicken', { difficulty: progressDifficulty, step: progressTarget }, currentAmount);
        else if (game === 'mines') result = await runMinesAutoRound(currentAmount);
        else result = await runCrashAutoRound(currentAmount);

        const roundProfit = result.won ? currentAmount * (result.multiplier - 1) : -currentAmount;
        profit = Number((profit + roundProfit).toFixed(2));
        completed += 1;
        setAutoProfit(profit);
        setAutoCompleted(completed);
        setAutoRemaining(autoInfinite ? -1 : Math.max(0, totalRounds - completed));

        if (autoStopProfit > 0 && profit >= autoStopProfit) {
          stopStatus = `Profit target reached at ${formatCash(profit)}`;
          setAutoStatus(stopStatus);
          autoStopRef.current = true;
        } else if (autoStopLoss > 0 && profit <= -autoStopLoss) {
          stopStatus = `Loss limit reached at ${formatCash(Math.abs(profit))}`;
          setAutoStatus(stopStatus);
          autoStopRef.current = true;
        }

        const change = result.won ? autoWinIncrease : autoLossIncrease;
        if (change > 0) currentAmount = clamp(currentAmount * (1 + change / 100), .1, 10000);
        setAmountInput(Number(currentAmount.toFixed(2)));
        if (!autoStopRef.current && (autoInfinite || completed < totalRounds)) await pause(autoDelay);
      }
      setAutoStatus(stopStatus || (autoStopRef.current ? 'Stopped' : 'Completed'));
    } catch (err: any) {
      autoStopRef.current = true;
      setAutoStatus('Stopped on error');
      setError(`Auto Bet stopped: ${err.message}`);
    } finally {
      if (runId === autoRunIdRef.current) {
        autoRunningRef.current = false;
        setAutoRunning(false);
        setAutoRemaining(0);
      }
    }
  };

  const verifyLocal = async () => {
    try {
      const params = JSON.parse(verifierState.params || '{}');
      const floats = await rngFloat(verifierState.serverSeed, verifierState.clientSeed, verifierState.nonce);
      let message = '';
      switch (verifierState.game) {
        case 'dice': {
          const outcome = diceOutcome(floats, params as any);
          message = `Result ${outcome.outcome} ${outcome.won ? 'win' : 'loss'} x${outcome.multiplier}`;
          break;
        }
        case 'limbo': {
          const outcome = limboResult(floats, params as any);
          message = outcome.outcome;
          break;
        }
        default:
          message = 'Verifier supports dice and limbo in this demo';
      }
      setVerifyResult(message);
    } catch (err: any) {
      setVerifyResult(err.message);
    }
  };

  const dashboardClass = view === 'mobile' ? 'main-grid mobile' : 'main-grid';

  const selectedGameItem = gameList.find((item) => item.type === selectedGame);
  const plinkoLayout = useMemo(() => generatePlinkoPayout(plinkoRows, plinkoRisk, platformConfig?.games.plinko.houseEdge ?? .01), [plinkoRows, plinkoRisk, platformConfig]);
  const wheelLayout = useMemo(() => generateWheelLayout(wheelSegments, wheelRisk, platformConfig?.games.wheel.houseEdge ?? .01), [wheelSegments, wheelRisk, platformConfig]);
  const kenoTable = useMemo(() => generateKenoTable(kenoRisk, platformConfig?.games.keno.houseEdge ?? .01)[kenoPicks.length] ?? [], [kenoRisk, kenoPicks.length, platformConfig]);
  const visibleGames = useMemo(() => {
    const favorites: GameType[] = ['mines', 'plinko', 'crash'];
    const recent = new Set(session?.recentResults.map((result) => result.game) ?? []);
    let games = gameList.filter((game) => game.label.toLowerCase().includes(gameSearch.toLowerCase().trim()));
    if (lobbyFilter === 'favorites') games = games.filter((game) => favorites.includes(game.type));
    if (lobbyFilter === 'recent') games = games.filter((game) => recent.has(game.type));
    if (gameSort === 'name') games = [...games].sort((a, b) => a.label.localeCompare(b.label));
    if (gameSort === 'players') games = [...games].sort((a, b) => Number.parseFloat(gameThemes[b.type].players) - Number.parseFloat(gameThemes[a.type].players));
    return games;
  }, [gameSearch, gameSort, lobbyFilter, session]);
  const feedResults = useMemo(() => {
    const results = session?.recentResults ?? [];
    if (betFeed === 'mine') return results.slice(0, 8);
    if (betFeed === 'high') return results.filter((result) => result.payout >= 20).slice(0, 8);
    return results.slice(0, 8);
  }, [session, betFeed]);

  const renderAutoBetControls = () => <div className="auto-bet-box">
    <div className="auto-bet-heading"><div><strong>Auto Bet</strong><small>{autoStatus}</small></div><span className={autoProfit >= 0 ? 'positive' : 'negative'}>{autoProfit >= 0 ? '+' : '-'}{formatCash(Math.abs(autoProfit))}</span></div>
    <div className="auto-fields two-columns">
      <label><span>Number of bets</span><input className="input" type="number" min="1" max="10000" disabled={autoInfinite || autoRunning} value={autoRounds} onChange={event => setAutoRounds(clamp(Number(event.target.value), 1, 10000))}/></label>
      <label className="check-field"><span>Run continuously</span><input type="checkbox" checked={autoInfinite} disabled={autoRunning} onChange={event => setAutoInfinite(event.target.checked)}/></label>
    </div>
    {selectedGame === 'mines' && <label className="auto-field"><span>Gems per round</span><input className="input" type="number" min="1" max={25 - minesCount} disabled={autoRunning} value={autoMinesGems} onChange={event => setAutoMinesGems(clamp(Number(event.target.value), 1, 25 - minesCount))}/><small>Auto-selects unique tiles, then cashes out after this many safe reveals.</small></label>}
    <div className="auto-fields two-columns">
      <label><span>On win · increase bet %</span><input className="input" type="number" min="0" max="1000" disabled={autoRunning} value={autoWinIncrease} onChange={event => setAutoWinIncrease(clamp(Number(event.target.value), 0, 1000))}/></label>
      <label><span>On loss · increase bet %</span><input className="input" type="number" min="0" max="1000" disabled={autoRunning} value={autoLossIncrease} onChange={event => setAutoLossIncrease(clamp(Number(event.target.value), 0, 1000))}/></label>
    </div>
    <div className="auto-fields two-columns">
      <label><span>Stop on profit</span><input className="input" type="number" min="0" step="0.1" disabled={autoRunning} value={autoStopProfit} onChange={event => setAutoStopProfit(Math.max(0, Number(event.target.value)))}/></label>
      <label><span>Stop on loss</span><input className="input" type="number" min="0" step="0.1" disabled={autoRunning} value={autoStopLoss} onChange={event => setAutoStopLoss(Math.max(0, Number(event.target.value)))}/></label>
    </div>
    <label className="auto-field"><span>Delay between bets · {autoDelay} ms</span><input type="range" min="100" max="3000" step="100" disabled={autoRunning} value={autoDelay} onChange={event => setAutoDelay(Number(event.target.value))}/></label>
    <div className="auto-progress"><span>{autoCompleted} completed</span><span>{autoRemaining === -1 ? '∞ remaining' : `${autoRemaining} remaining`}</span></div>
    <button className={`button ${autoRunning ? 'danger' : 'success'}`} onClick={runAutoBets}>{autoRunning ? 'Stop Auto Bet' : 'Start Auto Bet'}</button>
  </div>;

  return (
    <div className={`app-shell ${screen === 'game' ? 'game-mode' : 'lobby-mode'} ${animationMode === 'instant' ? 'animation-instant' : 'animation-advanced'}`}>
      <header className="header">
        <div className="header-left">
          <button className="menu-button" aria-label="Open menu">☰</button>
          <button className="logo" onClick={() => setScreen('lobby')}><span>O</span> Originals</button>
          <nav className="top-nav" aria-label="Primary navigation">
            <button className="top-nav-item active">Casino</button>
            <button className="top-nav-item">Sports</button>
          </nav>
        </div>
        <div className="header-right">
          <div className="balance"><span className="coin">$</span>{session ? session.balance.toFixed(2) : '0.00'}</div>
          <button className="wallet-button">Wallet</button>
          <button className="icon-button admin-link" onClick={openBackoffice} aria-label="Backoffice">▦</button>
          <button className="icon-button" onClick={() => setShowFairness(true)} aria-label="Fairness">⚙</button>
        </div>
      </header>

      <div className="subnav">
        <button className="subnav-item active">◆ Originals</button>
        <button className="subnav-item">▦ Slots</button>
        <button className="subnav-item">● Live Casino</button>
        <button className="subnav-item">♛ Game Shows</button>
        <button className="subnav-search">⌕ Search games</button>
      </div>

      {screen === 'admin' && adminDraft && <main className="backoffice">
        <div className="backoffice-header"><div><p className="eyebrow">OPERATIONS / GAME CONFIGURATION</p><h1>Originals Backoffice</h1><p>Configure margin, RTP and financial limits. Changes apply only after publishing.</p></div><div><button className="button secondary" onClick={() => setScreen('lobby')}>← Casino</button><button className="button success" onClick={publishConfig}>Publish configuration</button></div></div>
        <section className="admin-summary"><div><small>Published version</small><strong>v{platformConfig?.version}</strong></div><div><small>Last updated</small><strong>{new Date(platformConfig?.updatedAt ?? '').toLocaleString()}</strong></div><div><small>Games enabled</small><strong>{Object.values(adminDraft.games).filter(game => game.enabled).length}/{gameList.length}</strong></div><div><small>Average RTP</small><strong>{(Object.values(adminDraft.games).reduce((sum,game)=>sum+1-game.houseEdge,0)/gameList.length*100).toFixed(2)}%</strong></div></section>
        {adminMessage && <div className="admin-notice">{adminMessage}</div>}
        <section className="admin-games">{gameList.map(item => { const config = adminDraft.games[item.type]; const blackjack = item.type === 'blackjack'; const update = (field: string, value: number | boolean) => setAdminDraft(current => current ? ({...current,games:{...current.games,[item.type]:{...current.games[item.type],[field]:field === 'houseEdge' && blackjack ? Math.min(BLACKJACK_HOUSE_EDGE, Number(value)) : value}}}) : current); return <article className={`admin-game ${blackjack ? 'blackjack-config' : ''}`} key={item.type}><header><span>{gameIcons[item.type]}</span><div><h3>{item.label}</h3><small>{item.description}</small></div><label className="admin-switch"><input type="checkbox" checked={config.enabled} onChange={event=>update('enabled',event.target.checked)}/><i/></label></header><div className="margin-control"><label>House margin <b>{(config.houseEdge*100).toFixed(2)}%</b></label><input type="range" min="0.1" max={blackjack ? String(BLACKJACK_HOUSE_EDGE * 100) : '15'} step={blackjack ? '0.01' : '0.1'} value={config.houseEdge*100} onChange={event=>update('houseEdge',Number(event.target.value)/100)}/><div className="rtp-preview"><span>Calculated RTP</span><strong>{((1-config.houseEdge)*100).toFixed(2)}%</strong></div>{blackjack && <small className="rtp-floor">Protected minimum RTP {(BLACKJACK_MIN_RTP * 100).toFixed(2)}% · maximum margin {(BLACKJACK_HOUSE_EDGE * 100).toFixed(2)}%</small>}</div><div className="admin-fields"><label>Minimum bet<input type="number" value={config.minBet} onChange={event=>update('minBet',Number(event.target.value))}/></label><label>Maximum bet<input type="number" value={config.maxBet} onChange={event=>update('maxBet',Number(event.target.value))}/></label><label>Maximum payout<input type="number" value={config.maxPayout} onChange={event=>update('maxPayout',Number(event.target.value))}/></label></div><div className="odds-preview"><span>Odds engine</span><b>{item.type === 'dice' ? `${diceMultiplier(50,config.houseEdge).toFixed(4)}× at 50%` : item.type === 'wheel' ? generateWheelLayout(20,'low',config.houseEdge).slice(-1)[0].toFixed(2)+'× boost' : item.type === 'plinko' ? `${generatePlinkoPayout(16,'medium',config.houseEdge)[0].toFixed(2)}× edge` : item.type === 'keno' ? `${generateKenoTable('classic',config.houseEdge)[5][5].toFixed(2)}× 5 hits` : blackjack ? '3:2 natural · 1:1 normal · S17' : `${((1-config.houseEdge)*100).toFixed(2)}% theoretical RTP`}</b></div></article>})}</section>
        <section className="admin-audit"><h2>Configuration history</h2>{adminAudit.map(entry=><div key={entry.version}><b>v{entry.version}</b><span>{entry.summary}</span><time>{new Date(entry.updatedAt).toLocaleString()}</time></div>)}</section>
      </main>}

      {screen === 'lobby' && (
        <main className={`lobby ${view === 'mobile' ? 'mobile-preview' : ''}`}>
          <aside className="lobby-sidebar">
            <p>PLAY</p>
            <button onClick={() => setLobbyFilter('all')}>⌂ Home</button>
            <button className={lobbyFilter === 'favorites' ? 'active' : ''} onClick={() => setLobbyFilter('favorites')}>♥ Favorites</button>
            <button className={lobbyFilter === 'recent' ? 'active' : ''} onClick={() => setLobbyFilter('recent')}>↻ Recently Played</button>
            <button className={lobbyFilter === 'all' ? 'active' : ''} onClick={() => setLobbyFilter('all')}>◆ Originals</button>
            <p>CASINO</p>
            <button>▦ Slots</button><button>♠ Blackjack</button><button>● Roulette</button><button>♛ Live Casino</button>
            <div className="sidebar-promo"><span>WEEKLY RAFFLE</span><strong>$20,000</strong><small>Draw in 02d 14h</small></div>
          </aside>
          <div className="lobby-content">
          <section className="lobby-hero">
            <div className="hero-copy">
              <span className="hero-pill">ORIGINAL GAMES · INSTANT PLAY</span>
              <h1>Pick a game.<br/><em>Make your move.</em></h1>
              <p>Fast, transparent games with simple controls, vivid feedback, and provably fair results.</p>
              <button className="button success hero-cta" onClick={() => { setSelectedGame('mines'); setScreen('game'); }}>Play featured game</button>
            </div>
            <div className="hero-art" aria-hidden="true"><div className="hero-orb orb-one"/><div className="hero-orb orb-two"/><span className="hero-gem">◆</span><span className="hero-dice">⚄</span><b>100×</b></div>
          </section>

          <section className="recent-wins">
            <div className="section-heading"><span className="pulse-dot"/>Recent wins</div>
            <div className="wins-track">
              {(session?.recentResults.length ? session.recentResults.slice(0, 7) : gameList.slice(0, 7).map((game, index) => ({ game: game.type, won: index % 3 !== 0, payout: 12.4 + index * 17.83 } as BetResult))).map((result, index) => (
                <button key={index} onClick={() => { setSelectedGame(result.game); setScreen('game'); }}><i>{gameIcons[result.game]}</i><span><b>{gameList.find(game => game.type === result.game)?.label}</b><small>{result.won ? `+$${result.payout.toFixed(2)}` : 'Played now'}</small></span></button>
              ))}
            </div>
          </section>

          <div className="lobby-toolbar">
            <div><p className="eyebrow">EXPLORE</p><h2>Originals</h2></div>
            <div className="lobby-tools">
              <label className="game-search">⌕<input value={gameSearch} onChange={(event) => setGameSearch(event.target.value)} placeholder="Search games" /></label>
              <select value={gameSort} onChange={(event) => setGameSort(event.target.value as typeof gameSort)}><option value="recommended">Recommended</option><option value="players">Most played</option><option value="name">A–Z</option></select>
            </div>
            <div className="device-switch" aria-label="Preview size">
              <button className={view === 'web' ? 'active' : ''} onClick={() => setView('web')}>▰ Web</button>
              <button className={view === 'mobile' ? 'active' : ''} onClick={() => setView('mobile')}>▯ Mobile</button>
            </div>
          </div>

          <section className="lobby-game-grid">
            {visibleGames.map((game, index) => (
              <button className={`lobby-game-card ${gameThemes[game.type].tone}`} key={game.type} onClick={() => { setSelectedGame(game.type); setScreen('game'); }}>
                <div className="card-shine" />
                <span className="game-number">0{index + 1}</span>
                <div className="lobby-card-art"><span>{gameIcons[game.type]}</span><i /></div>
                <div className="lobby-card-info"><small>{gameThemes[game.type].kicker}</small><strong>{game.label}</strong><span>{gameThemes[game.type].players}</span></div>
                <b className="play-arrow">→</b>
              </button>
            ))}
            {!visibleGames.length && <div className="empty-games"><strong>No games found</strong><span>Try another search or category.</span></div>}
          </section>

          <section className="live-bets">
            <div className="bet-feed-header"><h3><span className="pulse-dot"/>Live Bets</h3><div><button className={betFeed === 'all' ? 'active' : ''} onClick={() => setBetFeed('all')}>All Bets</button><button className={betFeed === 'high' ? 'active' : ''} onClick={() => setBetFeed('high')}>High Rollers</button><button className={betFeed === 'mine' ? 'active' : ''} onClick={() => setBetFeed('mine')}>My Bets</button></div></div>
            <div className="bet-table"><div className="bet-row head"><span>Game</span><span>Player</span><span>Bet</span><span>Multiplier</span><span>Payout</span></div>{(feedResults.length ? feedResults : [{ game: 'plinko', payout: 84.22, multiplier: 8, won: true }, { game: 'mines', payout: 24.4, multiplier: 2.44, won: true }, { game: 'dice', payout: 0, multiplier: 0, won: false }] as BetResult[]).map((result, index) => <div className="bet-row" key={index}><span>{gameIcons[result.game]} {gameList.find(game => game.type === result.game)?.label}</span><span>Player••{42 + index}</span><span>${Math.max(1, result.payout / Math.max(1, result.multiplier)).toFixed(2)}</span><span>{result.multiplier.toFixed(2)}×</span><strong className={result.won ? 'positive' : ''}>{result.won ? `+$${result.payout.toFixed(2)}` : '$0.00'}</strong></div>)}</div>
          </section>
          <p className="responsible-note">Demo balance only · Play responsibly · 18+</p>
          </div>
        </main>
      )}

      <div className={`${dashboardClass} ${screen === 'lobby' ? 'is-hidden' : ''}`}>
        <section className="panel sidebar">
          <div className="wallet-card">
            <div>
              <p className="small-text">PLAY BALANCE</p>
              <strong>{session ? formatCash(session.balance) : '$0.00'}</strong>
            </div>
            <div className="wallet-status">
              <span className="badge">{view === 'web' ? 'Desktop' : 'Mobile'}</span>
              <span className="badge">{selectedGameItem?.label ?? 'Dice'}</span>
            </div>
          </div>

          <div className="game-grid">
            <div className="section-title"><span>◆</span> Originals</div>
            {gameList.map((game) => (
              <button
                key={game.type}
                className={`game-card ${selectedGame === game.type ? 'active' : ''}`}
                onClick={() => setSelectedGame(game.type)}
              >
                <div className="game-icon">{gameIcons[game.type]}</div>
                <div className="game-card-body">
                  <strong>{game.label}</strong>
                  <p className="small-text">Play now</p>
                </div>
              </button>
            ))}
          </div>

          <div className="card stats-card">
            <h2>Fairness</h2>
            <p className="small-text">Seed hash ready for verification.</p>
            <code className="seed-hash">{session?.serverSeedHash}</code>
            <button className="button secondary" onClick={() => setShowFairness(true)} style={{ marginTop: '1rem' }}>Open fairness panel</button>
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
              <div>
                <p className="small-text">Recent results</p>
                <div className="outcome-strip">
                  {session?.recentResults.map((result, idx) => (
                    <span key={idx} className={`outcome-pill ${result.won ? 'win' : 'loss'}`}>
                      {result.game}
                    </span>
                  ))}
                </div>
              </div>
              <button className="button secondary" onClick={refreshSession}>Refresh</button>
            </div>
          </div>
        </section>

        <section className={`panel game-board bet-mode-${betMode} ${autoRunning ? 'auto-session-active' : ''}`} onClickCapture={(event) => { if ((event.target as HTMLElement).closest('button,input')) playTone('click', selectedGame); }}>
          <div className="game-header">
            <div>
              <button className="back-link" onClick={() => setScreen('lobby')}>← All games</button>
              <p className="eyebrow">ORIGINALS / GAME</p>
              <h2><span className="title-icon">{gameIcons[selectedGame]}</span>{selectedGameItem?.label}</h2>
              <p className="small-text">{selectedGameItem?.description}</p>
            </div>
            <div className="game-header-actions">
              <div className="in-game-device-switch" aria-label="Game preview mode"><button className={view === 'web' ? 'active' : ''} onClick={() => setView('web')}>▰ Web</button><button className={view === 'mobile' ? 'active' : ''} onClick={() => setView('mobile')}>▯ Mobile</button></div>
              <button className={`mode-chip ${animationMode === 'advanced' ? 'active' : ''}`} onClick={() => setAnimationMode(animationMode === 'advanced' ? 'instant' : 'advanced')}>{animationMode === 'advanced' ? '✦ Advanced animation' : '⚡ Instant mode'}</button>
              <button className={`mode-chip ${soundEnabled ? 'active' : ''}`} onClick={() => setSoundEnabled(!soundEnabled)}>{soundEnabled ? '🔊 Sound' : '🔇 Muted'}</button>
              <button className="button secondary" onClick={() => setShowFairness(true)}>⚙</button>
            </div>
          </div>

          <div className="game-history-strip">
            <span>Bet history</span>
            {(session?.recentResults.filter(item => item.game === selectedGame).slice(0, 8) ?? []).map((item, index) => <i key={index} className={item.won ? 'win' : 'loss'}>{item.multiplier.toFixed(2)}×</i>)}
            {!session?.recentResults.some(item => item.game === selectedGame) && <small>No rounds yet</small>}
          </div>

          {error ? (
            <div className="card" style={{ marginTop: '1rem', background: 'rgba(251,115,133,0.12)' }}>
              <strong>Error</strong>
              <p>{error}</p>
            </div>
          ) : null}

          <GameVisual game={selectedGame} houseEdge={platformConfig?.games[selectedGame].houseEdge ?? .01} running={visualRunning || kenoAnimating} result={selectedGame === 'keno' ? kenoResult : visualResult} blackjackRound={blackjackRound} blackjackDealerVisibleCount={blackjackDealerVisibleCount} crashValue={crashValue} crashPhase={crashPhase} minesRound={minesRound} minesGridSize={minesGridSize} kenoNumbers={kenoDrawReveal} kenoRisk={kenoRisk} wheelSegments={wheelSegments} wheelLayout={wheelLayout} wheelRotation={wheelRotation} limboTarget={limboTarget} plinkoRows={plinkoRows} plinkoRisk={plinkoRisk} diceChance={diceChance} diceSide={diceSide} kenoPicks={kenoPicks} kenoAnimating={kenoAnimating} onMineClick={revealMine} onKenoClick={toggleKenoNumber} />

          {selectedGame !== 'keno' && <div className="card common-bet-card" style={{ marginTop: '1rem' }}>
            <div className="control-tabs">
              <button disabled={autoRunning} className={betMode === 'manual' ? 'active' : ''} onClick={() => setBetMode('manual')}>Manual</button>
              <button disabled={autoRunning || selectedGame === 'blackjack'} title={selectedGame === 'blackjack' ? 'Autoplay strategy is not defined in the Blackjack specification' : undefined} className={betMode === 'auto' ? 'active' : ''} onClick={() => setBetMode('auto')}>Auto</button>
            </div>
            <label className="label">Bet amount</label>
            <input
              type="number"
              className="input"
              value={amountInput}
              min={0.1}
              step={0.1}
              disabled={autoRunning || Boolean(selectedGame === 'blackjack' && blackjackRound && blackjackRound.phase !== 'settled')}
              onChange={(event) => setAmountInput(Number(event.target.value))}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              {[0.5, 2, 5].map((value) => (
                <button
                  key={value}
                  className="button secondary"
                  disabled={autoRunning || Boolean(selectedGame === 'blackjack' && blackjackRound && blackjackRound.phase !== 'settled')}
                  onClick={() => setAmountInput(clamp(amountInput * value, 0.1, 10000))}
                >
                  {value}×
                </button>
              ))}
            </div>
            {betMode === 'auto' && renderAutoBetControls()}
          </div>}

          {selectedGame === 'dice' && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <label className="label">Win chance</label>
              <input
                type="range"
                min={DICE_MIN_CHANCE}
                max={DICE_MAX_CHANCE}
                value={diceChance}
                step={0.01}
                onChange={(event) => setDiceChance(Number(event.target.value))}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>{diceChance.toFixed(2)}%</span>
                <span>{diceMultiplier(diceChance).toFixed(2)}×</span>
              </div>
              <div className="toggle-group" style={{ marginTop: '0.75rem' }}>
                {['over', 'under'].map((option) => (
                  <button
                    key={option}
                    className={`toggle-button ${diceSide === option ? 'active' : ''}`}
                    onClick={() => setDiceSide(option as 'over' | 'under')}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <button className="button success" disabled={visualRunning} style={{ marginTop: '1rem' }} onClick={() => placeBet('dice', { side: diceSide, winChance: diceChance })}>
                {visualRunning ? 'Rolling…' : 'Bet'}
              </button>
            </div>
          )}

          {selectedGame === 'limbo' && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <label className="label">Target multiplier</label>
              <input
                type="number"
                className="input"
                value={limboTarget}
                min={1.01}
                step={0.01}
                onChange={(event) => setLimboTarget(Number(event.target.value))}
              />
              <p className="small-text">Win chance {Number((99 / limboTarget).toFixed(2))}%</p>
              <button className="button success" disabled={visualRunning} style={{ marginTop: '1rem' }} onClick={() => placeBet('limbo', { target: limboTarget })}>
                {visualRunning ? 'Launching…' : 'Bet'}
              </button>
            </div>
          )}

          {selectedGame === 'crash' && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <label className="optional-control"><input type="checkbox" checked={crashAuto > 1} onChange={(event) => setCrashAuto(event.target.checked ? 2 : 0)} /><span>Auto cashout</span></label>
              <label className="label">Target multiplier (optional)</label>
              <input
                type="number"
                className="input"
                value={crashAuto}
                disabled={crashAuto <= 1}
                min={1.01}
                step={0.1}
                onChange={(event) => setCrashAuto(Number(event.target.value))}
              />
              <button className={`button ${crashPhase === 'flying' ? 'danger' : 'success'} primary-game-action`} style={{ marginTop: '1rem' }} onClick={crashPhase === 'flying' ? cashoutCrash : startCrash}>
                {crashPhase === 'flying' ? `Cash Out · ${crashValue.toFixed(2)}×` : 'Place Bet'}
              </button>
              {crashRound && (
                <div style={{ marginTop: '1rem' }}>
                  <p>Round started. Auto target {crashRound.autoCashout?.toFixed(2) ?? 'manual'}x</p>
                  <p className="small-text">Current multiplier {crashValue.toFixed(2)}x</p>
                  {crashRound.resolved && (
                    <p>Result {crashRound.payout > 0 ? 'Won' : 'Lost'} at {crashRound.cashedOutAt?.toFixed(2)}x (crashed at {crashRound.crashPoint?.toFixed(2)}x)</p>
                  )}
                  {cashoutError && <p style={{ color: '#fb7185' }}>{cashoutError}</p>}
                </div>
              )}
            </div>
          )}

          {selectedGame === 'plinko' && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <p className="label">Risk</p>
              <div className="toggle-group">
                {plinkoRiskOptions.map((option) => (
                  <button
                    key={option}
                    className={`toggle-button ${plinkoRisk === option ? 'active' : ''}`}
                    onClick={() => setPlinkoRisk(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <label className="label" style={{ marginTop: '0.75rem' }}>Rows</label>
              <input
                type="range"
                min={8}
                max={16}
                value={plinkoRows}
                onChange={(event) => setPlinkoRows(Number(event.target.value))}
              />
              <p className="small-text">Rows: {plinkoRows}</p>
              <button className="button success" disabled={visualRunning} style={{ marginTop: '1rem' }} onClick={() => placeBet('plinko', { rows: plinkoRows, risk: plinkoRisk })}>
                {visualRunning ? 'Dropping…' : 'Place Demo Bet'}
              </button>
            </div>
          )}

          {selectedGame === 'mines' && (
            <div className="card mines-controls" style={{ marginTop: '1rem' }}>
              <div className="mines-settings-row">
                <label><span>Number of mines</span><select className="input" disabled={autoRunning || Boolean(minesRound && !minesRound.resolved)} value={minesCount} onChange={(event) => { const count = Number(event.target.value); setMinesCount(count); setAutoMinesGems((current) => Math.min(current, 25 - count)); }}>{Array.from({ length: 24 }, (_, index) => index + 1).map(count => <option value={count} key={count}>{count}</option>)}</select></label>
                <label><span>Gems</span><div className="mine-readonly">{25 - minesCount}</div></label>
              </div>
              <div className="mine-count-label"><span>5 × 5 grid</span><strong>{minesCount} mine{minesCount === 1 ? '' : 's'} · {25 - minesCount} gems</strong></div>
              {minesRound && !minesRound.resolved && <div className="mines-payout-preview"><span>Next gem</span><strong>{computeMinesPayoutMultiplier(minesRound.mines, minesRound.safeCount + 1, 25).toFixed(2)}×</strong></div>}
              {betMode === 'manual' && (!minesRound || minesRound.resolved) && <button className="button success primary-game-action" disabled={autoRunning} onClick={startMines}>Bet</button>}
              {betMode === 'manual' && minesRound && !minesRound.resolved && <button className="button success primary-game-action" onClick={cashoutMines} disabled={minesRound.safeCount < 1}>Cash Out{minesRound.safeCount >= 1 ? ` · ${computeMinesPayoutMultiplier(minesRound.mines, minesRound.safeCount, 25).toFixed(2)}×` : ''}</button>}
              <p className="mines-help">Every gem increases the multiplier. Cash out at any time before hitting a mine.</p>
            </div>
          )}

          {selectedGame === 'wheel' && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <p className="label">Risk</p>
              <div className="toggle-group">
                {riskOptions.map((option) => (
                  <button
                    key={option}
                    className={`toggle-button ${wheelRisk === option ? 'active' : ''}`}
                    onClick={() => setWheelRisk(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <p className="label" style={{ marginTop: '0.75rem' }}>Segments</p>
              <div className="toggle-group">
                {[8, 10, 12, 16, 20, 30, 40, 50].map((value) => (
                  <button
                    key={value}
                    className={`toggle-button ${wheelSegments === value ? 'active' : ''}`}
                    onClick={() => setWheelSegments(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="outcome-strip" style={{ marginTop: '1rem' }}>
                {wheelLayout.slice(0, 10).map((value, idx) => (
                  <div key={idx} className="outcome-pill">{value.toFixed(2)}x</div>
                ))}
                {wheelLayout.length > 10 && <span className="badge">+ {wheelLayout.length - 10} more</span>}
              </div>
              <button className="button success" disabled={visualRunning} style={{ marginTop: '1rem' }} onClick={() => placeBet('wheel', { segments: wheelSegments, risk: wheelRisk })}>
                {visualRunning ? 'Spinning…' : 'Spin'}
              </button>
            </div>
          )}

          {selectedGame === 'keno' && (
            <div className="keno-panel">
              <div className="keno-sidebar card">
                <div className="control-tabs"><button disabled={autoRunning} className={betMode === 'manual' ? 'active' : ''} onClick={() => setBetMode('manual')}>Manual</button><button disabled={autoRunning} className={betMode === 'auto' ? 'active' : ''} onClick={() => setBetMode('auto')}>Auto</button></div>
                <div className="keno-bet-amount">
                  <label className="label">Bet amount</label>
                  <div className="keno-amount-row">
                    <input type="number" className="input" disabled={autoRunning} value={amountInput} min={0.1} step={0.1} onChange={(event) => setAmountInput(Number(event.target.value))}/>
                    <button className="button secondary" disabled={autoRunning} onClick={() => setAmountInput(clamp(amountInput / 2, .1, 10000))}>½</button>
                    <button className="button secondary" disabled={autoRunning} onClick={() => setAmountInput(clamp(amountInput * 2, .1, 10000))}>2×</button>
                  </div>
                </div>
                <div>
                  <p className="small-text">Risk profile</p>
                  <div className="toggle-group" style={{ marginTop: '0.5rem' }}>
                    {kenoRiskOptions.map((option) => (
                      <button
                        key={option}
                        disabled={autoRunning}
                        className={`toggle-button ${kenoRisk === option ? 'active' : ''}`}
                        onClick={() => setKenoRisk(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <p className="small-text">Pick numbers</p>
                  <p className="label" style={{ marginTop: '0.5rem' }}>Tap 1-10 tiles</p>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                    <button className="button" disabled={autoRunning} style={{ flex: 1 }} onClick={autoPickKeno}>Auto Pick</button>
                    <button className="button secondary" disabled={autoRunning} style={{ flex: 1 }} onClick={clearKeno}>Clear Table</button>
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <p className="small-text">Selected numbers</p>
                  <div className="outcome-strip" style={{ marginTop: '0.75rem' }}>
                    {kenoPicks.length ? kenoPicks.map((value) => (
                      <span key={value} className="outcome-pill">{value}</span>
                    )) : <span className="badge">No numbers picked</span>}
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  {betMode === 'manual' && <button
                    className="button success"
                    style={{ width: '100%' }}
                    onClick={() => placeKenoBet()}
                    disabled={autoRunning || kenoPicks.length < 1 || kenoAnimating}
                  >
                    {kenoAnimating ? 'Drawing...' : 'Place Bet'}
                  </button>}
                  {betMode === 'auto' && renderAutoBetControls()}
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <p className="small-text">Status</p>
                  <div className="seed-hash" style={{ padding: '0.85rem 1rem' }}>{kenoMessage}</div>
                </div>
              </div>

              <div className="keno-board card">
                <div className="keno-drop-zone">
                  <div className="keno-draw-header">
                    <div>
                      <h3>Draw results</h3>
                      <p className="small-text">Numbers appear one by one after bet acceptance.</p>
                    </div>
                    <div className="outcome-strip" style={{ justifyContent: 'flex-end' }}>
                      {(kenoDrawReveal.length ? kenoDrawReveal : []).map((number) => (
                        <span key={number} className={`outcome-pill ${kenoPicks.includes(number) ? 'win' : ''}`}>
                          {number}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: '1rem' }}>
                    <p className="small-text">Hits</p>
                    <div className="outcome-strip">
                      {(kenoResult?.details?.draw ?? []).filter((num: number) => kenoPicks.includes(num)).map((num: number) => (
                        <span key={num} className="outcome-pill win">{num}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedGame === 'blackjack' && <div className="card game-specific-controls blackjack-controls">
            <div className="info-ribbon"><span>Infinite shoe</span><b>Dealer stands on all 17s</b><span>Blackjack 3:2</span><span>RTP {(BLACKJACK_MIN_RTP * 100).toFixed(2)}%</span></div>
            {!blackjackRound || blackjackRound.phase === 'settled' ? <>
              {blackjackRound?.phase === 'settled' && <div className={`blackjack-settlement ${blackjackRound.net > 0 ? 'positive' : blackjackRound.net < 0 ? 'negative' : ''}`}><span>{blackjackRound.outcome}</span><strong>{blackjackRound.net >= 0 ? '+' : ''}{formatCash(blackjackRound.net)}</strong><small>Risked {formatCash(blackjackRound.totalRisked)} · Returned {formatCash(blackjackRound.payout)}</small></div>}
              <button className="button success primary-game-action" disabled={blackjackBusy} onClick={startBlackjack}>{blackjackBusy ? 'Dealing…' : blackjackRound ? 'Bet Again' : 'Deal'}</button>
            </> : null}
            {blackjackRound?.phase === 'insurance' && <div className="insurance-offer"><div><strong>Insurance?</strong><span>Dealer shows an Ace. Side wager {formatCash(blackjackRound.baseBet / 2)} · pays 2:1.</span></div><div className="blackjack-action-grid two-actions"><button className="button secondary" disabled={blackjackBusy} onClick={() => decideBlackjackInsurance(false)}>No Insurance</button><button className="button success" disabled={blackjackBusy || (session?.balance ?? 0) < blackjackRound.baseBet / 2} title={(session?.balance ?? 0) < blackjackRound.baseBet / 2 ? 'Insufficient balance for insurance' : undefined} onClick={() => decideBlackjackInsurance(true)}>Take Insurance</button></div></div>}
            {blackjackRound?.phase === 'player' && <>
              <div className="active-hand-summary"><span>Playing hand {blackjackRound.activeHandIndex + 1} of {blackjackRound.hands.length}</span><strong>{blackjackRound.hands[blackjackRound.activeHandIndex]?.total}{blackjackRound.hands[blackjackRound.activeHandIndex]?.soft ? ' soft' : ''}</strong></div>
              <div className="blackjack-action-grid">
                <button className="button blackjack-hit" disabled={blackjackBusy || !blackjackRound.actions.hit} onClick={() => actBlackjack('hit')}>Hit</button>
                <button className="button blackjack-stand" disabled={blackjackBusy || !blackjackRound.actions.stand} onClick={() => actBlackjack('stand')}>Stand</button>
                <button className="button secondary" disabled={blackjackBusy || !blackjackRound.actions.double} title={!blackjackRound.actions.double ? 'Requires an eligible two-card hand and enough balance' : undefined} onClick={() => actBlackjack('double')}>Double</button>
                <button className="button secondary" disabled={blackjackBusy || !blackjackRound.actions.split} title={!blackjackRound.actions.split ? 'Requires equal card values and enough balance; 10/J/Q/K may split together and re-splitting is disabled' : undefined} onClick={() => actBlackjack('split')}>Split</button>
              </div>
            </>}
            {blackjackRound && blackjackRound.phase !== 'settled' && <div className="round-ledger"><span>Base bet <b>{formatCash(blackjackRound.baseBet)}</b></span><span>Total risked <b>{formatCash(blackjackRound.totalRisked)}</b></span><span>Round <b>#{blackjackRound.nonce}</b></span></div>}
          </div>}

          {selectedGame === 'rps' && <div className="card game-specific-controls"><p className="label">Choose your hand</p><div className="choice-cards">{([['rock','✊'],['paper','✋'],['scissors','✌️']] as const).map(([choice,icon])=><button key={choice} className={rpsChoice===choice?'active':''} onClick={()=>setRpsChoice(choice)}><b>{icon}</b><span>{choice}</span></button>)}</div><button className="button success primary-game-action" disabled={visualRunning} onClick={()=>placeBet('rps',{choice:rpsChoice})}>{visualRunning?'Revealing…':'Play round'}</button></div>}

          {(selectedGame === 'tower'||selectedGame === 'chicken') && <div className="card game-specific-controls"><p className="label">Difficulty</p><div className="toggle-group">{(['easy','medium','hard'] as const).map(x=><button key={x} className={`toggle-button ${progressDifficulty===x?'active':''}`} onClick={()=>setProgressDifficulty(x)}>{x}</button>)}</div><label className="label">{selectedGame==='tower'?'Target level':'Steps to cross'} · {progressTarget}</label><input type="range" min="1" max={selectedGame==='tower'?9:15} value={progressTarget} onChange={e=>setProgressTarget(Number(e.target.value))}/><p className="small-text">Calculated payout rises exponentially with every safe {selectedGame==='tower'?'level':'step'}.</p><button className="button success primary-game-action" disabled={visualRunning} onClick={()=>placeBet(selectedGame,selectedGame==='tower'?{difficulty:progressDifficulty,level:progressTarget}:{difficulty:progressDifficulty,step:progressTarget})}>{visualRunning?'In progress…':selectedGame==='tower'?'Climb tower':'Start crossing'}</button></div>}
        </section>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className="active"><span>◆</span>Casino</button>
        <button><span>⌕</span>Search</button>
        <button><span>▥</span>Bets</button>
        <button onClick={() => setShowFairness(true)}><span>⚙</span>Fairness</button>
      </nav>

      {showFairness && session && (
        <div className="modal" onClick={() => setShowFairness(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Fairness controls</h2>
                <p className="small-text">Your current seed pair and verifier options.</p>
              </div>
              <button className="button secondary" onClick={() => setShowFairness(false)}>Close</button>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <p className="label">Server seed hash</p>
              <pre style={{ whiteSpace: 'break-spaces', overflowX: 'auto', padding: '0.75rem', borderRadius: 14, background: '#07101a' }}>{session.serverSeedHash}</pre>
              <p className="label" style={{ marginTop: '1rem' }}>Client seed</p>
              <input className="input" value={clientSeedInput} onChange={(event) => setClientSeedInput(event.target.value)} />
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button className="button" onClick={updateClientSeed}>Update client seed</button>
                <button className="button danger" onClick={rotateSeed}>Rotate server seed</button>
                <button className="button secondary" onClick={() => setVerifierOpen(true)}>Verifier</button>
              </div>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <h3>Seed history</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {session.seedHistory.map((entry, index) => (
                  <div key={index} className="card" style={{ background: '#0b1520' }}>
                    <p className="small-text">Hash {index + 1}</p>
                    <code>{entry.hash}</code>
                    {entry.reveal ? <p className="small-text">Revealed: {entry.reveal}</p> : <p className="small-text">Active seed, not revealed yet.</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {verifierOpen && (
        <div className="modal" onClick={() => setVerifierOpen(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Verifier</h2>
                <p className="small-text">Reproduce result from public inputs.</p>
              </div>
              <button className="button secondary" onClick={() => setVerifierOpen(false)}>Close</button>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <label className="label">Server seed</label>
              <input className="input" value={verifierState.serverSeed} onChange={(event) => setVerifierState((prev) => ({ ...prev, serverSeed: event.target.value }))} />
              <label className="label">Client seed</label>
              <input className="input" value={verifierState.clientSeed} onChange={(event) => setVerifierState((prev) => ({ ...prev, clientSeed: event.target.value }))} />
              <label className="label">Nonce</label>
              <input className="input" type="number" value={verifierState.nonce} onChange={(event) => setVerifierState((prev) => ({ ...prev, nonce: Number(event.target.value) }))} />
              <label className="label">Game</label>
              <select className="input" value={verifierState.game} onChange={(event) => setVerifierState((prev) => ({ ...prev, game: event.target.value as GameType }))}>
                {gameList.map((game) => (
                  <option key={game.type} value={game.type}>{game.label}</option>
                ))}
              </select>
              <label className="label">Params</label>
              <textarea className="input" rows={4} value={verifierState.params} onChange={(event) => setVerifierState((prev) => ({ ...prev, params: event.target.value }))} />
              <button className="button" style={{ marginTop: '1rem' }} onClick={verifyLocal}>Verify</button>
              {verifyResult ? <p className="small-text" style={{ marginTop: '0.75rem' }}>{verifyResult}</p> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
