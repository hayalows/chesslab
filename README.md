# RivalMind

A calm chess practice platform. Play legal chess against Stockfish, ask an independent coach for help, and use RivalMind's separate game assistant to turn engine lines into understandable lessons.

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
- A separate, toggleable Game Assistant that updates after every move
- Stockfish-derived position health, outlook, momentum, alternatives, tactical radar, confidence, and mistake timeline
- Expandable evidence cards with principal variations, depth, time, and real node counts
- Supabase email sign-in, guest upgrades, cross-device cloud sync, and a player journey dashboard
- A real home and session setup flow with open practice, 10-minute, and 15+10 games
- Post-game training reviews with total time, active thinking time, coach use, move quality, key moments, points, and milestones
- A transparent adaptive ladder that waits for clear multi-game form before changing Stockfish strength
- Learning analytics for training time, coach independence, streaks, move quality, and playing style after 20 games

Every computer reply and coach analysis now runs through the threaded [`lichess-org/stockfish.wasm`](https://github.com/lichess-org/stockfish.wasm) engine using the UCI protocol. Difficulty uses Stockfish's `UCI_LimitStrength` and `UCI_Elo` controls plus a bounded search time; coaching runs at full strength with MultiPV candidate lines. RivalMind shows real nodes, depth, elapsed search time, evaluation, and engine readiness rather than simulated telemetry.

The requested compatibility build uses Stockfish's classical evaluation rather than a current NNUE network. The distributed engine is GPL-3.0; its license is served with the WASM assets at `/stockfish/Copying.txt`, and source is available from the linked upstream repository.

## Evidence boundary

Stockfish is the only analysis and opponent engine. RivalMind converts its score, WDL (when emitted), MultiPV alternatives, and principal variation into shorter language. It never substitutes its own move search. Tactical labels are conservative: if a fork, pin, or skewer is not verified in a displayed engine line, the UI says so instead of inventing one. When native WDL is unavailable, the UI explicitly labels W/D/L as a RivalMind outlook calculated from the displayed Stockfish score.

## Cloud setup

Copy `.env.example` to `.env.local` and provide a Supabase project URL and publishable key. Never expose a secret or service-role key. Apply migrations in `supabase/migrations`, then configure the Supabase Auth URL allow list with your local and production `/auth/callback` URLs. RivalMind uses email and password authentication with one-time email confirmation and password recovery.

See [docs/CLOUD.md](docs/CLOUD.md) for the table model, RLS contract, and client API flows.
