# Third-party notices

RivalMind includes and runs third-party chess software in the browser.

## Stockfish 18 and stockfish-web

- Project: Stockfish and `@lichess-org/stockfish-web`
- Source: https://github.com/lichess-org/stockfish-web
- License: GNU Affero General Public License v3.0 or later
- Use in RivalMind: opponent and coach calculation through a WebAssembly worker

The deployed app serves the upstream license beside the generated engine assets at
`/stockfish/Stockfish-Web-License.txt`. RivalMind's interface and interpretation
layer do not replace Stockfish's move search.

## chess.js

- Project: https://github.com/jhlywa/chess.js
- License: BSD-2-Clause
- Use in RivalMind: legal move validation, position state, and game results

## react-chessboard

- Project: https://github.com/Clariity/react-chessboard
- License: MIT
- Use in RivalMind: responsive chessboard interaction and display
