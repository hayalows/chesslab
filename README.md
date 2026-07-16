# RivalMind

A calm, single-player chess practice room. Play legal chess against a worker-backed opponent, ask an independent coach for help at four disclosure levels, and build a lightweight adaptive player profile stored only in the browser.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What is included

- Legal drag-and-drop and click-to-move play powered by `chess.js`
- Easy, medium, hard, and understandable adaptive difficulty
- Separate opponent and coach engine adapters
- Gentle hints, candidate moves, best move, plain-English reasoning, and visible search counts
- Local games, record, hint usage, recent results, and adaptive level
- Short post-game coaching summary

The current engine is a compact alpha-beta search running in web workers. `OpponentEngine` and `CoachEngine` interfaces keep a future Stockfish upgrade isolated from the game UI.
