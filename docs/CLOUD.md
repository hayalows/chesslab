# RivalMind cloud contract

RivalMind uses Supabase Auth plus Postgres. Browser code receives only the project URL and publishable key. Every user-owned table has Row Level Security; policies compare the indexed `user_id` column with `(select auth.uid())`.

## Tables

| Table | Purpose | Ownership |
| --- | --- | --- |
| `profiles` | Record, adaptive level, training points/minutes, streaks, milestones, rating, hint and assistant preferences | `user_id` primary key |
| `games` | Result, PGN, time control, player/engine/coach time, move quality, adaptive change and post-game summary | indexed `user_id` |
| `moves` | SAN/UCI/FEN plus the Stockfish evidence and explanation for each ply | `user_id`; unique game + ply |
| `achievements` | Private progress and unlock history | unique user + achievement code |
| `player_stats` | Favorite openings, accuracy and style metrics | `user_id` primary key |
| `rating_history` | Append-only rating samples for dashboard trends | indexed user + time |

## Client flows

- Email and password: `signUp` sends a one-time confirmation to `/auth/callback`, `signInWithPassword` handles later sign-ins, and `resetPasswordForEmail` routes existing passwordless users through `/reset-password` so they can choose a password.
- Session refresh: Next.js `proxy.ts` calls `auth.getClaims()` and writes refreshed cookies to the response.
- Guest upgrade: local play is never blocked. On authenticated game completion, the local aggregate profile is upserted and the completed game plus move evidence is inserted.
- Dashboard: the browser queries only the signed-in user's profile, games, rating history and aggregate stats; RLS remains the final authorization boundary.
- Adaptive strength: the client retains the last five results, requires at least four results and three games between level changes, and stores the before/after levels with each game.
- Milestones: guest milestones migrate at first sign-in; later unlocks are inserted into `achievements` with the completed game sync.

## Production email

Supabase's built-in Auth email sender is for development and has a small project-wide quota. Before public testing, configure a custom SMTP provider under Authentication > Emails > SMTP Settings, then review the project's Authentication > Rate Limits. Keep email confirmation enabled.

## Interpretation contract

Stored explanations must cite the Stockfish evaluation change or principal variation that produced them. `evaluation_cp`, `wdl`, `depth`, `nodes`, and `principal_variation` remain alongside the prose so every learning claim can be audited. Style detection must remain blank until at least 20 analyzed games.
