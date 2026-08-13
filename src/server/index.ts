import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { newSeed, sha256Hex } from '../common/rng.js';
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
  kenoOutcome
  ,rpsBet, blackjackBet, towerBet, chickenBet
} from '../common/game.js';
import type { BetResult, CrashRound, MineRound, GameType, PlatformConfig } from '../common/types.js';

const app = express();
const sessions = new Map<string, any>();
const SESSION_COOKIE = 'originals_session';
const PORT = 4174;
const gameTypes: GameType[] = ['dice', 'limbo', 'crash', 'plinko', 'mines', 'wheel', 'keno', 'blackjack', 'rps', 'tower', 'chicken'];
const defaultGameConfig = { enabled: true, houseEdge: 0.01, minBet: 0.1, maxBet: 1000, maxPayout: 100000 };
let platformConfig: PlatformConfig = { version: 1, updatedAt: new Date().toISOString(), games: Object.fromEntries(gameTypes.map(game => [game, { ...defaultGameConfig }])) as PlatformConfig['games'] };
const configAudit: Array<{ version: number; updatedAt: string; summary: string }> = [{ version: 1, updatedAt: platformConfig.updatedAt, summary: 'Default configuration' }];

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
      mineRound: null as MineRound | null
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
  if (amount < config.minBet || amount > config.maxBet || amount > balance) throw new Error(`Bet must be between ${config.minBet} and ${config.maxBet}`);
  return config;
}

async function runBet(session: any, game: GameType, betFn: Promise<BetResult>, amount: number) {
  const config = validateStake(game, amount, session.balance);
  if (amount <= 0 || amount > session.balance) {
    throw new Error('Invalid bet amount');
  }
  const result = await betFn;
  session.balance -= amount;
  const payout = Math.min(result.payout * amount, config.maxPayout, MAX_PAYOUT_MULTIPLIER * amount);
  if (result.won) {
    session.balance += payout;
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
      case 'blackjack': result = await blackjackBet(session.serverSeed, session.clientSeed, session.nonce, platformConfig.games.blackjack.houseEdge); break;
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

app.post('/api/crash/start', async (req, res) => {
  const session = (req as any).session;
  const { amount, autoCashout } = req.body;
  try { validateStake('crash', amount, session.balance); } catch (error: any) { return res.status(400).json({ error: error.message }); }
  if (typeof amount !== 'number' || amount <= 0 || amount > session.balance) {
    return res.status(400).json({ error: 'Invalid amount' });
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
  session.balance -= amount;
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
    session.balance += payout * round.bet;
  }
  round.resolved = true;
  round.cashedOutAt = cashoutAt;
  round.payout = payout;
  const result: BetResult = {
    game: 'crash',
    outcome: `Crash at ${round.crashPoint.toFixed(2)}x`,
    won: !crashed && cashoutAt < round.crashPoint,
    payout,
    multiplier: payout,
    details: { crashPoint: round.crashPoint, cashoutAt, crashed }
  };
  flushRecent(session, result);
  return res.json({ round, balance: session.balance });
});

app.post('/api/mines/start', async (req, res) => {
  const session = (req as any).session;
  const { amount, mines, gridSize = 25 } = req.body;
  try { validateStake('mines', amount, session.balance); } catch (error: any) { return res.status(400).json({ error: error.message }); }
  if (typeof amount !== 'number' || amount <= 0 || amount > session.balance) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  if (![25, 36, 49, 64].includes(gridSize)) {
    return res.status(400).json({ error: 'Invalid grid size' });
  }
  if (typeof mines !== 'number' || mines < 1 || mines >= gridSize) {
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
  session.balance -= amount;
  session.nonce += 1;
  return res.json({ round, balance: session.balance, nonce: session.nonce });
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
    return res.json({ round, balance: session.balance });
  }
  const safeReveals = round.revealed.filter((revealed: boolean, idx: number) => revealed && !round.board[idx]).length;
  round.safeCount = safeReveals;
  const multiplier = minesPayoutMultiplier(round.mines, safeReveals, round.gridSize, platformConfig.games.mines.houseEdge);
  round.payout = multiplier;
  if (safeReveals === round.gridSize - round.mines) {
    round.resolved = true;
    round.won = true;
    session.balance += multiplier * round.bet;
    const result: BetResult = {
      game: 'mines',
      outcome: 'Cleared all safe tiles',
      won: true,
      payout: multiplier,
      multiplier,
      details: { safeReveals }
    };
    flushRecent(session, result);
    return res.json({ round, balance: session.balance });
  }
  return res.json({ round, balance: session.balance });
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
  session.balance += multiplier * round.bet;
  const result: BetResult = {
    game: 'mines',
    outcome: `Cashed out at ${multiplier.toFixed(2)}x`,
    won: true,
    payout: multiplier,
    multiplier,
    details: { safeReveals }
  };
  flushRecent(session, result);
  return res.json({ round, balance: session.balance });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
