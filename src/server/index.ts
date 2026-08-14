import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { newSeed, rngFloatStream, sha256Hex } from '../common/rng.js';
import {
  DEFAULT_BALANCE,
  crashBet,
  crashMultiplierAtTime,
  diceBet,
  kenoBet,
  minesBoard,
  minesPayoutMultiplier,
  plinkoBet,
  wheelBet,
  limboBet,
  MAX_PAYOUT_MULTIPLIER,
  kenoOutcome,
  rpsBet,
  towerBet,
  chickenBet,
  BLACKJACK_HOUSE_EDGE,
  BLACKJACK_MIN_RTP,
  blackjackCardFromFloat,
  blackjackHandValue,
  isBlackjackNatural
} from '../common/game.js';
import type { BetResult, BlackjackAction, BlackjackCard, BlackjackHand, BlackjackRound, CrashRound, MineRound, GameType, PlatformConfig } from '../common/types.js';

const app = express();
const sessions = new Map<string, any>();
const SESSION_COOKIE = 'originals_session';
const PORT = Number(process.env.PORT ?? 4174);
const gameTypes: GameType[] = ['dice', 'limbo', 'crash', 'plinko', 'mines', 'wheel', 'keno', 'blackjack', 'rps', 'tower', 'chicken'];
const defaultGameConfig = { enabled: true, houseEdge: 0.01, minBet: 0.1, maxBet: 1000, maxPayout: 100000 };
let platformConfig: PlatformConfig = { version: 1, updatedAt: new Date().toISOString(), games: Object.fromEntries(gameTypes.map(game => [game, { ...defaultGameConfig, houseEdge: game === 'blackjack' ? BLACKJACK_HOUSE_EDGE : defaultGameConfig.houseEdge }])) as PlatformConfig['games'] };
const configAudit: Array<{ version: number; updatedAt: string; summary: string }> = [{ version: 1, updatedAt: platformConfig.updatedAt, summary: 'Default configuration' }];
const money = (value: number) => Number(value.toFixed(2));

const clientDist = path.resolve('dist');
app.use(express.static(clientDist));

async function ensureSession(req: express.Request) {
  let sessionId = req.cookies[SESSION_COOKIE];
  if (!sessionId) {
    sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  let session = sessions.get(sessionId);
  if (!session) {
    const serverSeed = await newSeed();
    const clientSeed = 'player1';
    session = {
      balance: DEFAULT_BALANCE,
      serverSeed,
      serverSeedHash: '',
      clientSeed,
      nonce: 0,
      recentResults: [] as BetResult[],
      seedHistory: [] as Array<{ hash: string; reveal?: string }> ,
      crashRound: null as CrashRound | null,
      mineRound: null as MineRound | null,
      blackjackRound: null as InternalBlackjackRound | null
    };
    session.serverSeedHash = '';
    sessions.set(sessionId, session);
  }
  req.cookies[SESSION_COOKIE] = sessionId;
  return session;
}

async function initSession(session: any) {
  if (!session.serverSeedHash) {
    session.serverSeedHash = await sha256Hex(session.serverSeed);
    session.seedHistory.unshift({ hash: session.serverSeedHash });
  }
}

function flushRecent(session: any, result: BetResult) {
  session.recentResults.unshift(result);
  session.recentResults = session.recentResults.slice(0, 16);
}

function publicMineRound(round: MineRound) {
  return {
    id: round.id,
    bet: round.bet,
    mines: round.mines,
    gridSize: round.gridSize,
    revealed: [...round.revealed],
    safeCount: round.safeCount,
    startedAt: round.startedAt,
    resolved: round.resolved,
    won: round.won,
    payout: round.payout,
    // Keep the committed board server-side until the round is finished. Once
    // resolved it is returned so the client can reveal and verify every mine.
    board: round.resolved ? [...round.board] : undefined
  };
}

type InternalBlackjackRound = Omit<BlackjackRound, 'dealerCards' | 'actions'> & {
  dealerCards: BlackjackCard[];
  stream: BlackjackCard[];
  cursor: number;
  settled: boolean;
  processedRequestIds: Set<string>;
};

const emptyBlackjackActions = (): Record<BlackjackAction, boolean> => ({ hit: false, stand: false, double: false, split: false });

function refreshBlackjackHand(hand: BlackjackHand) {
  const value = blackjackHandValue(hand.cards);
  hand.total = value.total;
  hand.soft = value.soft;
}

function drawBlackjackCard(round: InternalBlackjackRound) {
  const card = round.stream[round.cursor];
  if (!card) throw new Error('Committed Blackjack card stream exhausted');
  round.cursor += 1;
  return card;
}

function dealerHasBlackjack(round: InternalBlackjackRound) {
  return isBlackjackNatural(round.dealerCards);
}

function blackjackActions(round: InternalBlackjackRound, balance: number): Record<BlackjackAction, boolean> {
  const actions = emptyBlackjackActions();
  if (round.phase !== 'player') return actions;
  const hand = round.hands[round.activeHandIndex];
  if (!hand || hand.status !== 'active') return actions;
  actions.hit = hand.total < 21 && !hand.splitAces;
  actions.stand = true;
  actions.double = hand.cards.length === 2 && !hand.splitAces && balance >= hand.wager;
  actions.split = round.hands.length === 1 && hand.cards.length === 2 && hand.cards[0].rank === hand.cards[1].rank && balance >= hand.wager;
  return actions;
}

function publicBlackjackRound(round: InternalBlackjackRound, balance: number): BlackjackRound {
  const concealDealer = round.phase !== 'settled';
  const dealerCards = round.dealerCards.map((card, index) => concealDealer && index === 1 ? { hidden: true } : { ...card });
  const dealerTotal = concealDealer ? blackjackHandValue(round.dealerCards.slice(0, 1)).total : blackjackHandValue(round.dealerCards).total;
  return {
    id: round.id,
    requestId: round.requestId,
    version: round.version,
    nonce: round.nonce,
    baseBet: round.baseBet,
    phase: round.phase,
    dealerCards,
    dealerTotal,
    hands: round.hands.map(hand => ({ ...hand, cards: hand.cards.map(card => ({ ...card })) })),
    activeHandIndex: round.activeHandIndex,
    insurance: { ...round.insurance },
    actions: blackjackActions(round, balance),
    totalRisked: round.totalRisked,
    payout: round.payout,
    net: round.net,
    outcome: round.outcome,
    startedAt: round.startedAt
  };
}

function settleBlackjack(session: any, round: InternalBlackjackRound) {
  if (round.settled) return;
  const dealer = blackjackHandValue(round.dealerCards);
  const dealerNatural = dealerHasBlackjack(round);
  let mainCredit = 0;
  for (const hand of round.hands) {
    refreshBlackjackHand(hand);
    let result: BlackjackHand['result'];
    let credit = 0;
    if (hand.total > 21) result = 'bust';
    else if (dealerNatural) {
      if (hand.natural) { result = 'push'; credit = hand.wager; }
      else result = 'loss';
    } else if (hand.natural) { result = 'blackjack'; credit = hand.wager * 2.5; }
    else if (dealer.total > 21 || hand.total > dealer.total) { result = 'win'; credit = hand.wager * 2; }
    else if (hand.total === dealer.total) { result = 'push'; credit = hand.wager; }
    else result = 'loss';
    hand.result = result;
    hand.payout = money(credit);
    hand.status = 'resolved';
    mainCredit += hand.payout;
  }
  round.payout = money(mainCredit + round.insurance.payout);
  round.net = money(round.payout - round.totalRisked);
  round.phase = 'settled';
  round.settled = true;
  const wins = round.hands.filter(hand => hand.result === 'win' || hand.result === 'blackjack').length;
  const pushes = round.hands.filter(hand => hand.result === 'push').length;
  const losses = round.hands.length - wins - pushes;
  round.outcome = wins ? `${wins} hand${wins === 1 ? '' : 's'} won${losses ? `, ${losses} lost` : ''}` : pushes && !losses ? 'Push' : losses ? `${losses} hand${losses === 1 ? '' : 's'} lost` : 'Settled';
  session.balance = money(session.balance + round.payout);
  const result: BetResult = {
    game: 'blackjack',
    outcome: round.outcome,
    won: round.net > 0,
    payout: round.payout,
    multiplier: round.totalRisked ? Number((round.payout / round.totalRisked).toFixed(2)) : 0,
    details: { roundId: round.id, nonce: round.nonce, baseBet: round.baseBet, totalRisked: round.totalRisked, insurance: { ...round.insurance }, dealer: round.dealerCards, dealerTotal: dealer.total, hands: round.hands }
  };
  flushRecent(session, result);
}

function finishBlackjackPlayerTurn(session: any, round: InternalBlackjackRound) {
  const nextIndex = round.hands.findIndex((hand, index) => index > round.activeHandIndex && hand.status === 'pending');
  if (nextIndex >= 0) {
    round.activeHandIndex = nextIndex;
    round.hands[nextIndex].status = 'active';
    return;
  }
  const liveHand = round.hands.some(hand => hand.total <= 21);
  if (liveHand) {
    while (blackjackHandValue(round.dealerCards).total < 17) round.dealerCards.push(drawBlackjackCard(round));
  }
  settleBlackjack(session, round);
}

app.use(express.json());
app.use(cookieParser());
app.use(async (req, res, next) => {
  const session = await ensureSession(req);
  await initSession(session);
  res.cookie(SESSION_COOKIE, req.cookies[SESSION_COOKIE], { httpOnly: true });
  (req as any).session = session;
  next();
});

app.post('/api/client-seed', async (req, res) => {
  const session = (req as any).session;
  if (session.blackjackRound && session.blackjackRound.phase !== 'settled') return res.status(409).json({ error: 'Finish the active Blackjack round before changing seeds' });
  const { clientSeed } = req.body;
  if (!clientSeed || typeof clientSeed !== 'string') {
    return res.status(400).json({ error: 'clientSeed required' });
  }
  session.clientSeed = clientSeed;
  session.nonce = 0;
  return res.json({ clientSeed });
});

app.get('/api/session', (req, res) => {
  const session = (req as any).session;
  return res.json({
    balance: session.balance,
    serverSeedHash: session.serverSeedHash,
    clientSeed: session.clientSeed,
    nonce: session.nonce,
    recentResults: session.recentResults,
    seedHistory: session.seedHistory
  });
});

app.post('/api/rotate-seed', async (req, res) => {
  const session = (req as any).session;
  if (session.blackjackRound && session.blackjackRound.phase !== 'settled') return res.status(409).json({ error: 'Finish the active Blackjack round before rotating seeds' });
  const previous = session.serverSeed;
  const previousHash = session.serverSeedHash;
  const revealed = previous;
  session.seedHistory[0] = { hash: previousHash, reveal: revealed };
  session.serverSeed = await newSeed();
  session.serverSeedHash = await sha256Hex(session.serverSeed);
  session.seedHistory.unshift({ hash: session.serverSeedHash });
  session.nonce = 0;
  return res.json({ serverSeedHash: session.serverSeedHash, revealed });
});

function validateStake(game: GameType, amount: number, balance: number) {
  const config = platformConfig.games[game];
  if (!config.enabled) throw new Error(`${game} is temporarily disabled`);
  if (!Number.isFinite(amount)) throw new Error('Bet amount must be a valid number');
  if (amount < config.minBet || amount > config.maxBet || amount > balance) throw new Error(`Bet must be between ${config.minBet} and ${config.maxBet}`);
  return config;
}

function validateBetParams(game: GameType, params: any) {
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (game === 'dice' && (!['over', 'under'].includes(params.side) || !finite(params.winChance) || params.winChance < 0.01 || params.winChance > 98)) throw new Error('Invalid Dice settings');
  if (game === 'limbo' && (!finite(params.target) || params.target < 1.01 || params.target > MAX_PAYOUT_MULTIPLIER)) throw new Error('Invalid Limbo target');
  if (game === 'plinko' && (!Number.isInteger(params.rows) || params.rows < 8 || params.rows > 16 || !['low', 'medium', 'high', 'rain'].includes(params.risk))) throw new Error('Invalid Plinko settings');
  if (game === 'wheel' && (![8, 10, 12, 16, 20, 30, 40, 50].includes(params.segments) || !['low', 'medium', 'high'].includes(params.risk))) throw new Error('Invalid Wheel settings');
  if (game === 'keno') {
    const picks = params.picks;
    if (!Array.isArray(picks) || picks.length < 1 || picks.length > 10 || new Set(picks).size !== picks.length || picks.some((value: unknown) => !Number.isInteger(value) || Number(value) < 1 || Number(value) > 40) || !['classic', 'low', 'medium', 'high'].includes(params.risk)) throw new Error('Invalid Keno settings');
  }
  if (game === 'rps' && !['rock', 'paper', 'scissors'].includes(params.choice)) throw new Error('Invalid hand');
  if ((game === 'tower' || game === 'chicken') && !['easy', 'medium', 'hard'].includes(params.difficulty)) throw new Error('Invalid difficulty');
}

async function runBet(session: any, game: GameType, betFn: Promise<BetResult>, amount: number) {
  const config = validateStake(game, amount, session.balance);
  if (amount <= 0 || amount > session.balance) {
    throw new Error('Invalid bet amount');
  }
  const result = await betFn;
  session.balance = money(session.balance - amount);
  const payout = money(Math.min(result.payout * amount, config.maxPayout, MAX_PAYOUT_MULTIPLIER * amount));
  if (result.won) {
    session.balance = money(session.balance + payout);
  }
  flushRecent(session, { ...result, payout });
  session.nonce += 1;
  return { ...result, balance: session.balance, nonce: session.nonce };
}

app.get('/api/config', (_req, res) => res.json(platformConfig));
app.get('/api/admin/config', (_req, res) => res.json({ config: platformConfig, audit: configAudit.slice(0, 20) }));
app.post('/api/admin/config', (req, res) => {
  const proposed = req.body?.games as PlatformConfig['games'];
  if (!proposed) return res.status(400).json({ error: 'Games configuration required' });
  try {
    const games = {} as PlatformConfig['games'];
    for (const game of gameTypes) {
      const item = proposed[game];
      if (!item || typeof item.enabled !== 'boolean') throw new Error(`Invalid ${game} configuration`);
      const houseEdge = Number(item.houseEdge); const minBet = Number(item.minBet); const maxBet = Number(item.maxBet); const maxPayout = Number(item.maxPayout);
      if (houseEdge < 0.001 || houseEdge > 0.15) throw new Error(`${game} margin must be between 0.1% and 15%`);
      if (game === 'blackjack' && houseEdge > BLACKJACK_HOUSE_EDGE + Number.EPSILON) throw new Error(`Blackjack RTP cannot be lower than ${(BLACKJACK_MIN_RTP * 100).toFixed(2)}% (maximum house margin ${(BLACKJACK_HOUSE_EDGE * 100).toFixed(2)}%)`);
      if (minBet <= 0 || maxBet < minBet || maxPayout < maxBet) throw new Error(`${game} limits are inconsistent`);
      games[game] = { enabled: item.enabled, houseEdge, minBet, maxBet, maxPayout };
    }
    platformConfig = { version: platformConfig.version + 1, updatedAt: new Date().toISOString(), games };
    configAudit.unshift({ version: platformConfig.version, updatedAt: platformConfig.updatedAt, summary: 'Published game margins and limits' });
    return res.json({ config: platformConfig, audit: configAudit.slice(0, 20) });
  } catch (error: any) { return res.status(400).json({ error: error.message }); }
});

app.post('/api/bet', async (req, res) => {
  const session = (req as any).session;
  const { game, amount, params } = req.body as { game: string; amount: number; params: any };
  if (!game || typeof amount !== 'number' || !params) {
    return res.status(400).json({ error: 'Invalid bet request' });
  }
  try {
    validateBetParams(game as GameType, params);
    let result: BetResult;
    switch (game) {
      case 'dice':
        result = await diceBet(session.serverSeed, session.clientSeed, session.nonce, params, platformConfig.games.dice.houseEdge);
        break;
      case 'limbo':
        result = await limboBet(session.serverSeed, session.clientSeed, session.nonce, params, platformConfig.games.limbo.houseEdge);
        break;
      case 'plinko':
        result = await plinkoBet(session.serverSeed, session.clientSeed, session.nonce, params, platformConfig.games.plinko.houseEdge);
        break;
      case 'wheel':
        result = await wheelBet(session.serverSeed, session.clientSeed, session.nonce, params, platformConfig.games.wheel.houseEdge);
        break;
      case 'keno':
        result = await kenoBet(session.serverSeed, session.clientSeed, session.nonce, params, platformConfig.games.keno.houseEdge);
        break;
      case 'blackjack': return res.status(400).json({ error: 'Use the Blackjack round controls to Deal and choose actions' });
      case 'rps': result = await rpsBet(session.serverSeed, session.clientSeed, session.nonce, params, platformConfig.games.rps.houseEdge); break;
      case 'tower': result = await towerBet(session.serverSeed, session.clientSeed, session.nonce, params, platformConfig.games.tower.houseEdge); break;
      case 'chicken': result = await chickenBet(session.serverSeed, session.clientSeed, session.nonce, params, platformConfig.games.chicken.houseEdge); break;
      default:
        return res.status(400).json({ error: 'Game not supported for immediate bet' });
    }
    const payload = await runBet(session, game as GameType, Promise.resolve(result), amount);
    return res.json(payload);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Bet failed' });
  }
});

app.get('/api/blackjack/state', (req, res) => {
  const session = (req as any).session;
  const round = session.blackjackRound as InternalBlackjackRound | null;
  return res.json({ round: round ? publicBlackjackRound(round, session.balance) : null, balance: session.balance, nonce: session.nonce });
});

app.post('/api/blackjack/start', async (req, res) => {
  const session = (req as any).session;
  const amount = Number(req.body?.amount);
  const requestId = typeof req.body?.requestId === 'string' && req.body.requestId ? req.body.requestId : '';
  const existing = session.blackjackRound as InternalBlackjackRound | null;
  if (existing && existing.requestId === requestId && requestId) return res.json({ round: publicBlackjackRound(existing, session.balance), balance: session.balance, nonce: session.nonce });
  if (existing && existing.phase !== 'settled') return res.status(409).json({ error: 'A Blackjack round is already in progress', round: publicBlackjackRound(existing, session.balance) });
  if (!requestId) return res.status(400).json({ error: 'A request key is required' });
  try {
    validateStake('blackjack', amount, session.balance);
    const nonce = session.nonce;
    const floats = await rngFloatStream(session.serverSeed, session.clientSeed, nonce, 128);
    const stream = floats.map(blackjackCardFromFloat);
    const round: InternalBlackjackRound = {
      id: `${Date.now()}-${nonce}`,
      requestId,
      version: 1,
      nonce,
      baseBet: money(amount),
      phase: 'player',
      dealerCards: [],
      hands: [],
      activeHandIndex: 0,
      insurance: { offered: false, decided: false, taken: false, wager: 0, payout: 0 },
      totalRisked: money(amount),
      payout: 0,
      net: money(-amount),
      startedAt: Date.now(),
      stream,
      cursor: 0,
      settled: false,
      processedRequestIds: new Set()
    };
    const playerCards = [drawBlackjackCard(round)];
    round.dealerCards.push(drawBlackjackCard(round));
    playerCards.push(drawBlackjackCard(round));
    round.dealerCards.push(drawBlackjackCard(round));
    const playerValue = blackjackHandValue(playerCards);
    round.hands.push({ id: 'hand-1', cards: playerCards, wager: money(amount), status: 'active', total: playerValue.total, soft: playerValue.soft, natural: isBlackjackNatural(playerCards), splitAces: false, doubled: false, payout: 0 });
    session.balance = money(session.balance - amount);
    session.nonce += 1;
    session.blackjackRound = round;

    const upRank = round.dealerCards[0].rank;
    if (upRank === 1) {
      round.phase = 'insurance';
      round.insurance.offered = true;
    } else if (upRank >= 10 && dealerHasBlackjack(round)) {
      settleBlackjack(session, round);
    } else if (round.hands[0].natural) {
      settleBlackjack(session, round);
    }
    return res.json({ round: publicBlackjackRound(round, session.balance), balance: session.balance, nonce: session.nonce });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to start Blackjack round' });
  }
});

app.post('/api/blackjack/insurance', (req, res) => {
  const session = (req as any).session;
  const round = session.blackjackRound as InternalBlackjackRound | null;
  if (!round) return res.status(400).json({ error: 'No Blackjack round found' });
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : '';
  if (requestId && round.processedRequestIds.has(requestId)) return res.json({ round: publicBlackjackRound(round, session.balance), balance: session.balance, nonce: session.nonce });
  if (!requestId) return res.status(400).json({ error: 'A request key is required for the insurance decision' });
  if (req.body?.roundId !== round.id || req.body?.version !== round.version) return res.status(409).json({ error: 'Blackjack round changed; restored the latest state', round: publicBlackjackRound(round, session.balance) });
  if (round.phase !== 'insurance') return res.status(409).json({ error: 'Insurance decision is no longer available', round: publicBlackjackRound(round, session.balance) });
  const take = req.body?.take === true;
  const stake = money(round.baseBet / 2);
  if (take && session.balance < stake) return res.status(400).json({ error: 'Insufficient balance for insurance', round: publicBlackjackRound(round, session.balance) });
  round.insurance.decided = true;
  round.insurance.taken = take;
  if (take) {
    round.insurance.wager = stake;
    round.totalRisked = money(round.totalRisked + stake);
    session.balance = money(session.balance - stake);
  }
  if (dealerHasBlackjack(round)) {
    if (take) round.insurance.payout = money(stake * 3);
    settleBlackjack(session, round);
  } else if (round.hands[0].natural) {
    settleBlackjack(session, round);
  } else {
    round.phase = 'player';
  }
  round.processedRequestIds.add(requestId);
  round.version += 1;
  return res.json({ round: publicBlackjackRound(round, session.balance), balance: session.balance, nonce: session.nonce });
});

app.post('/api/blackjack/action', (req, res) => {
  const session = (req as any).session;
  const round = session.blackjackRound as InternalBlackjackRound | null;
  const action = req.body?.action as BlackjackAction;
  if (!round) return res.status(400).json({ error: 'No Blackjack round found' });
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : '';
  if (requestId && round.processedRequestIds.has(requestId)) return res.json({ round: publicBlackjackRound(round, session.balance), balance: session.balance, nonce: session.nonce });
  if (!requestId) return res.status(400).json({ error: 'A request key is required for the Blackjack action' });
  if (req.body?.roundId !== round.id || req.body?.version !== round.version) return res.status(409).json({ error: 'Blackjack round changed; restored the latest state', round: publicBlackjackRound(round, session.balance) });
  if (round.phase !== 'player') return res.status(409).json({ error: 'The Blackjack round is not awaiting a player action', round: publicBlackjackRound(round, session.balance) });
  if (!['hit', 'stand', 'double', 'split'].includes(action)) return res.status(400).json({ error: 'Invalid Blackjack action' });
  const allowed = blackjackActions(round, session.balance);
  if (!allowed[action]) return res.status(400).json({ error: action === 'double' || action === 'split' ? `Unable to ${action}; check hand eligibility and balance` : `${action} is unavailable`, round: publicBlackjackRound(round, session.balance) });
  const hand = round.hands[round.activeHandIndex];
  if (action === 'hit') {
    hand.cards.push(drawBlackjackCard(round));
    refreshBlackjackHand(hand);
    if (hand.total >= 21) {
      hand.status = hand.total > 21 ? 'bust' : 'standing';
      finishBlackjackPlayerTurn(session, round);
    }
  } else if (action === 'stand') {
    hand.status = 'standing';
    finishBlackjackPlayerTurn(session, round);
  } else if (action === 'double') {
    session.balance = money(session.balance - hand.wager);
    round.totalRisked = money(round.totalRisked + hand.wager);
    hand.wager = money(hand.wager * 2);
    hand.doubled = true;
    hand.cards.push(drawBlackjackCard(round));
    refreshBlackjackHand(hand);
    hand.status = hand.total > 21 ? 'bust' : 'standing';
    finishBlackjackPlayerTurn(session, round);
  } else {
    session.balance = money(session.balance - hand.wager);
    round.totalRisked = money(round.totalRisked + hand.wager);
    const firstCard = hand.cards[0];
    const secondCard = hand.cards[1];
    const splitAces = firstCard.rank === 1;
    const firstCards = [firstCard, drawBlackjackCard(round)];
    const secondCards = [secondCard, drawBlackjackCard(round)];
    const makeHand = (id: string, cards: BlackjackCard[], status: BlackjackHand['status']): BlackjackHand => {
      const value = blackjackHandValue(cards);
      return { id, cards, wager: hand.wager, status, total: value.total, soft: value.soft, natural: false, splitAces, doubled: false, payout: 0 };
    };
    round.hands = [makeHand('hand-1', firstCards, splitAces ? 'locked' : 'active'), makeHand('hand-2', secondCards, splitAces ? 'locked' : 'pending')];
    round.activeHandIndex = 0;
    if (splitAces) finishBlackjackPlayerTurn(session, round);
  }
  round.processedRequestIds.add(requestId);
  round.version += 1;
  return res.json({ round: publicBlackjackRound(round, session.balance), balance: session.balance, nonce: session.nonce });
});

app.post('/api/crash/start', async (req, res) => {
  const session = (req as any).session;
  const { amount, autoCashout } = req.body;
  try { validateStake('crash', amount, session.balance); } catch (error: any) { return res.status(400).json({ error: error.message }); }
  if (typeof amount !== 'number' || amount <= 0 || amount > session.balance) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  if (autoCashout !== undefined && (typeof autoCashout !== 'number' || !Number.isFinite(autoCashout) || autoCashout < 1.01 || autoCashout > MAX_PAYOUT_MULTIPLIER)) {
    return res.status(400).json({ error: 'Invalid auto cashout target' });
  }
  if (session.crashRound && !session.crashRound.resolved) {
    return res.status(400).json({ error: 'Crash round already in progress' });
  }
  const crashPoint = await crashBet(session.serverSeed, session.clientSeed, session.nonce, platformConfig.games.crash.houseEdge);
  const round: CrashRound = {
    id: `${Date.now()}-${session.nonce}`,
    bet: amount,
    autoCashout: typeof autoCashout === 'number' ? autoCashout : undefined,
    crashPoint,
    startedAt: Date.now(),
    resolved: false,
    payout: 0
  };
  session.crashRound = round;
  session.balance = money(session.balance - amount);
  session.nonce += 1;
  // The demo client uses the committed point to synchronize its real-time curve and burst animation.
  const publicRound = { id: round.id, bet: round.bet, autoCashout: round.autoCashout, crashPoint: round.crashPoint, startedAt: round.startedAt, resolved: round.resolved, payout: round.payout };
  return res.json({ round: publicRound, balance: session.balance, nonce: session.nonce });
});

app.post('/api/crash/cashout', (req, res) => {
  const session = (req as any).session;
  const round = session.crashRound;
  if (!round || round.resolved) {
    return res.status(400).json({ error: 'No active crash round' });
  }
  const elapsed = (Date.now() - round.startedAt) / 1000;
  const crashTime = Math.log(round.crashPoint) / 0.35;
  const crashed = elapsed >= crashTime;
  const cashoutAt = round.autoCashout ?? crashMultiplierAtTime(elapsed);
  const won = !crashed && typeof round.autoCashout === 'number' ? cashoutAt < round.crashPoint : !crashed;
  let payout = 0;
  if (!crashed) {
    payout = won ? Math.min(cashoutAt, round.crashPoint) : 0;
    session.balance = money(session.balance + payout * round.bet);
  }
  round.resolved = true;
  round.cashedOutAt = cashoutAt;
  round.payout = payout;
  const result: BetResult = {
    game: 'crash',
    outcome: `Crash at ${round.crashPoint.toFixed(2)}x`,
    won: !crashed && cashoutAt < round.crashPoint,
    payout: money(payout * round.bet),
    multiplier: payout,
    details: { crashPoint: round.crashPoint, cashoutAt, crashed }
  };
  flushRecent(session, result);
  return res.json({ round, balance: session.balance });
});

app.post('/api/mines/start', async (req, res) => {
  const session = (req as any).session;
  const { amount, mines } = req.body;
  const gridSize = 25;
  try { validateStake('mines', amount, session.balance); } catch (error: any) { return res.status(400).json({ error: error.message }); }
  if (typeof amount !== 'number' || amount <= 0 || amount > session.balance) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  if (!Number.isInteger(mines) || mines < 1 || mines >= gridSize) {
    return res.status(400).json({ error: 'Invalid mine count' });
  }
  const board = await minesBoard(session.serverSeed, session.clientSeed, session.nonce, mines, gridSize);
  const round: MineRound = {
    id: `${Date.now()}-${session.nonce}`,
    bet: amount,
    mines,
    gridSize,
    board,
    revealed: Array(gridSize).fill(false),
    safeCount: 0,
    startedAt: Date.now(),
    resolved: false,
    won: false,
    payout: 0
  };
  session.mineRound = round;
  session.balance = money(session.balance - amount);
  session.nonce += 1;
  return res.json({ round: publicMineRound(round), balance: session.balance, nonce: session.nonce });
});

app.post('/api/mines/reveal', async (req, res) => {
  const session = (req as any).session;
  const round = session.mineRound;
  const { index } = req.body;
  if (!round || round.resolved) {
    return res.status(400).json({ error: 'No active mines round' });
  }
  if (typeof index !== 'number' || index < 0 || index >= round.gridSize || round.revealed[index]) {
    return res.status(400).json({ error: 'Invalid tile index' });
  }
  const hit = round.board[index];
  round.revealed[index] = true;
  if (hit) {
    round.resolved = true;
    round.won = false;
    round.payout = 0;
    const result: BetResult = {
      game: 'mines',
      outcome: 'Mine hit',
      won: false,
      payout: 0,
      multiplier: 0,
      details: { index }
    };
    flushRecent(session, result);
    return res.json({ round: publicMineRound(round), balance: session.balance });
  }
  const safeReveals = round.revealed.filter((revealed: boolean, idx: number) => revealed && !round.board[idx]).length;
  round.safeCount = safeReveals;
  const multiplier = minesPayoutMultiplier(round.mines, safeReveals, round.gridSize, platformConfig.games.mines.houseEdge);
  round.payout = multiplier;
  if (safeReveals === round.gridSize - round.mines) {
    round.resolved = true;
    round.won = true;
    session.balance = money(session.balance + multiplier * round.bet);
    const result: BetResult = {
      game: 'mines',
      outcome: 'Cleared all safe tiles',
      won: true,
      payout: money(multiplier * round.bet),
      multiplier,
      details: { safeReveals }
    };
    flushRecent(session, result);
    return res.json({ round: publicMineRound(round), balance: session.balance });
  }
  return res.json({ round: publicMineRound(round), balance: session.balance });
});

app.post('/api/mines/cashout', (req, res) => {
  const session = (req as any).session;
  const round = session.mineRound;
  if (!round || round.resolved) {
    return res.status(400).json({ error: 'No active mines round' });
  }
  const safeReveals = round.safeCount;
  if (safeReveals < 1) {
    return res.status(400).json({ error: 'Reveal at least one tile before cashing out' });
  }
  const multiplier = minesPayoutMultiplier(round.mines, safeReveals, round.gridSize, platformConfig.games.mines.houseEdge);
  round.resolved = true;
  round.won = true;
  round.payout = multiplier;
  session.balance = money(session.balance + multiplier * round.bet);
  const result: BetResult = {
    game: 'mines',
    outcome: `Cashed out at ${multiplier.toFixed(2)}x`,
    won: true,
    payout: money(multiplier * round.bet),
    multiplier,
    details: { safeReveals }
  };
  flushRecent(session, result);
  return res.json({ round: publicMineRound(round), balance: session.balance });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
