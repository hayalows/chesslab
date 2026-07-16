# RivalMind

A calm, single-player chess practice room. Play legal chess against a worker-backed opponent, ask an independent coach for help at four disclosure levels, and build a lightweight adaptive player profile stored only in the browser.

**Play online:** [chesslab-gamma.vercel.app](https://chesslab-gamma.vercel.app)

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What is included

- Legal drag-and-drop and click-to-move play powered by `chess.js`
- Easy, medium, hard, and understandable adaptive difficulty
- Separate Stockfish opponent and coach engine adapters
- Gentle hints, candidate moves, best move, plain-English reasoning, and visible search counts
- Local games, record, hint usage, recent results, and adaptive level
- Short post-game coaching summary

Every computer reply and coach analysis now runs through the threaded [`lichess-org/stockfish.wasm`](https://github.com/lichess-org/stockfish.wasm) engine using the UCI protocol. Difficulty uses Stockfish's `UCI_LimitStrength` and `UCI_Elo` controls plus a bounded search time; coaching runs at full strength with MultiPV candidate lines. RivalMind shows real nodes, depth, elapsed search time, evaluation, and engine readiness rather than simulated telemetry.

The requested compatibility build uses Stockfish's classical evaluation rather than a current NNUE network. The distributed engine is GPL-3.0; its license is served with the WASM assets at `/stockfish/Copying.txt`, and source is available from the linked upstream repository.
