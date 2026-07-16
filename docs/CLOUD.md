# RivalMind cloud contract

RivalMind uses Supabase Auth plus Postgres. Browser code receives only the project URL and publishable key. Every user-owned table has Row Level Security; policies compare the indexed `user_id` column with `(select auth.uid())`.

## Tables

| Table | Purpose | Ownership |
| --- | --- | --- |
| `profiles` | Record, adaptive level, rating, hint and assistant preferences | `user_id` primary key |
| `games` | Result, PGN, difficulty, opening metadata, post-game summary | indexed `user_id` |
| `moves` | SAN/UCI/FEN plus the Stockfish evidence and explanation for each ply | `user_id`; unique game + ply |
| `achievements` | Private progress and unlock history | unique user + achievement code |
| `player_stats` | Favorite openings, accuracy and style metrics | `user_id` primary key |
| `rating_history` | Append-only rating samples for dashboard trends | indexed user + time |

## Client flows

- Email: `signInWithOtp` sends a magic link to `/auth/callback`; the route exchanges the PKCE code for a cookie session.
- Google: `signInWithOAuth` returns through the same callback. The provider and redirect allow list must be enabled in the Supabase dashboard.
- Session refresh: Next.js `proxy.ts` calls `auth.getClaims()` and writes refreshed cookies to the response.
- Guest upgrade: local play is never blocked. On authenticated game completion, the local aggregate profile is upserted and the completed game plus move evidence is inserted.
- Dashboard: the browser queries only the signed-in user's profile, games, rating history and aggregate stats; RLS remains the final authorization boundary.

## Interpretation contract

Stored explanations must cite the Stockfish evaluation change or principal variation that produced them. `evaluation_cp`, `wdl`, `depth`, `nodes`, and `principal_variation` remain alongside the prose so every learning claim can be audited. Style detection must remain blank until at least 20 analyzed games.
