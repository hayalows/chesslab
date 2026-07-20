alter table public.profiles
  add column training_points integer not null default 0 check (training_points >= 0),
  add column training_minutes integer not null default 0 check (training_minutes >= 0),
  add column current_streak integer not null default 0 check (current_streak >= 0),
  add column best_streak integer not null default 0 check (best_streak >= 0),
  add column last_level_change_game integer not null default 0 check (last_level_change_game >= 0),
  add column milestones jsonb not null default '[]'::jsonb;

comment on column public.profiles.training_points is 'Non-decreasing learning points earned from completed games, move quality, and independent play.';
comment on column public.profiles.last_level_change_game is 'Prevents adaptive strength from changing after every isolated result.';

alter table public.games
  add column time_control text not null default 'open' check (time_control in ('open', 'rapid10', 'steady15')),
  add column total_time_ms bigint not null default 0 check (total_time_ms >= 0),
  add column player_think_ms bigint not null default 0 check (player_think_ms >= 0),
  add column rival_think_ms bigint not null default 0 check (rival_think_ms >= 0),
  add column coach_uses integer not null default 0 check (coach_uses >= 0),
  add column coach_time_ms bigint not null default 0 check (coach_time_ms >= 0),
  add column accuracy numeric(5,2) check (accuracy between 0 and 100),
  add column best_move_matches integer not null default 0 check (best_move_matches >= 0),
  add column analyzed_moves integer not null default 0 check (analyzed_moves >= 0),
  add column adaptive_before smallint check (adaptive_before between 1 and 10),
  add column adaptive_after smallint check (adaptive_after between 1 and 10),
  add column training_points_earned integer not null default 0 check (training_points_earned >= 0);

comment on column public.games.accuracy is 'RivalMind learning score derived from Stockfish evaluation loss; not a separate chess engine.';
comment on column public.games.coach_time_ms is 'Cumulative Stockfish coach search time requested by the player.';
