# Originals Platform

A responsive web platform for provably-fair casino-style Originals games. The app includes a lobby that lets you choose between a web layout and a mobile-oriented layout, select one of the game titles, and place play-money bets with server-authoritative outcomes.

## Features
- Shared provably-fair RNG using server seed, client seed, nonce, and HMAC-SHA256.
- Play-money wallet and bet lifecycle for instant games.
- Eleven game types: Dice, Limbo, Crash, Plinko, Mines, Wheel, Keno, Blackjack, Rock Paper Scissors, Tower, and Chicken.
- Margin-aware game configuration backoffice with calculated RTP previews and financial limits.
- Advanced and instant animation modes, per-game sound feedback, Auto Bet, and round history.
- Fairness panel with seed commitment, client seed editing, and seed rotation.
- Mobile/web UI toggle in the lobby.
- Interactive Crash and Mines support with server-side round state.

## Project structure
- `src/server/index.ts` — Express backend with session-based state, bet handling, crash and mines rounds, and fairness controls.
- `src/client/App.tsx` — React frontend for the lobby, game shell, bet panel, and game canvases.
- `src/common/rng.ts` — Shared provably-fair RNG utilities.
- `src/common/game.ts` — Shared game math and result mapping based on the PRD documents.

## Run locally
1. Install dependencies with a Node.js package manager.
2. Build the client and server, then start the backend to serve the app.

```bash
npm install
npm run build
npm start
```

For frontend-only development, run `npm run dev` in one terminal and run the backend separately with `npm run start-server` after building the server.

The frontend is configured to proxy `/api` requests to the backend on `http://localhost:4174`.

## Notes
This implementation is a play-money proof-of-concept for the platform and original game family described in the PRD documents.
