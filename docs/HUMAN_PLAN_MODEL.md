# RivalMind human plan model

RivalMind uses a compact behavioral sequence model alongside Stockfish. It predicts moves that human players are likely to try; it never determines legality, evaluation, mate, or the rival's move.

## Sources

- `datasnaek/chess` on Kaggle: 20,058 Lichess games with SAN move sequences, ratings, results, time controls, and opening labels.
- `lichess-org/chess-openings`: CC0 opening names and canonical positions.
- Lichess open database documentation: source and licensing context for public Lichess game and evaluation exports.

Raw downloads are ignored by Git. The reproducible training command is:

```bash
npm run train:human-plan
```

## Training and validation

Games are replayed legally with `chess.js`. For each position through ply 36, the trainer counts the human continuation in UCI form. The first 80% of games train the validation model; the remaining 20% measure generalization. The final public artifact is retrained on all games, keeps positions seen at least three times, and retains four continuations per position.

Current held-out results:

- 34,003 repeated positions evaluated
- top-1 accuracy: 52.49%
- top-3 accuracy: 79.00%
- public model: 11,281 positions, 1.47 MB uncompressed
- Lichess opening index: 3,803 named positions

At runtime a four-ply beam search produces likely human continuations. The browser also maintains a small, private position-to-move count model from the player's own choices and gives that evidence extra weight. Personal counts stay on the device in version one.

## Guardrails

- Stockfish remains the only source for best moves, evaluations, WDL, and mate claims.
- `chess.js` remains the legal-move authority.
- Behavioral predictions are labeled separately from engine recommendations.
- No prediction is converted into a tactical or strategic claim unless Stockfish independently supports it.
