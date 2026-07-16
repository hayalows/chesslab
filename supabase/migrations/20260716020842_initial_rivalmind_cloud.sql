create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Chess learner' check (char_length(display_name) between 1 and 60),
  rating integer not null default 800 check (rating between 100 and 4000),
  adaptive_level smallint not null default 4 check (adaptive_level between 1 and 10),
  total_games integer not null default 0 check (total_games >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  hint_usage integer not null default 0 check (hint_usage >= 0),
  assistant_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One private RivalMind learning profile per authenticated user.';

create table public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'complete', 'abandoned')),
  result text check (result in ('win', 'loss', 'draw')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard', 'adaptive')),
  opponent_elo integer,
  pgn text not null default '',
  initial_fen text not null default 'start',
  final_fen text,
  opening_code text,
  opening_name text,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.games is 'User-owned games and post-game summaries; PGN is the portable source of truth.';

create table public.moves (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ply smallint not null check (ply > 0),
  san text not null,
  uci text,
  fen_after text not null,
  evaluation_cp integer,
  wdl jsonb,
  depth smallint,
  nodes bigint,
  classification text check (classification in ('steady', 'inaccuracy', 'mistake', 'blunder')),
  explanation text,
  principal_variation jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (game_id, ply)
);

comment on table public.moves is 'Move ledger with optional Stockfish evidence and RivalMind plain-English interpretation.';

create table public.achievements (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null check (char_length(code) between 1 and 80),
  name text not null,
  description text not null,
  progress jsonb not null default '{}'::jsonb,
  unlocked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code)
);

comment on table public.achievements is 'Private achievement progress and unlock history.';

create table public.player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favorite_openings jsonb not null default '[]'::jsonb,
  style_metrics jsonb not null default '{}'::jsonb,
  style_label text,
  average_accuracy numeric(5,2),
  analyzed_games integer not null default 0 check (analyzed_games >= 0),
  last_calculated_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.player_stats is 'Aggregated learning signals. Style labels unlock only after at least twenty analyzed games.';

create table public.rating_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid references public.games(id) on delete set null,
  rating integer not null check (rating between 100 and 4000),
  recorded_at timestamptz not null default now()
);

comment on table public.rating_history is 'Append-only rating points used by the dashboard trend.';

create index games_user_completed_idx on public.games (user_id, completed_at desc);
create index moves_user_id_idx on public.moves (user_id);
create index moves_game_ply_idx on public.moves (game_id, ply);
create index achievements_user_unlocked_idx on public.achievements (user_id, unlocked_at desc);
create index rating_history_user_recorded_idx on public.rating_history (user_id, recorded_at desc);
create index rating_history_game_id_idx on public.rating_history (game_id);

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.moves enable row level security;
alter table public.achievements enable row level security;
alter table public.player_stats enable row level security;
alter table public.rating_history enable row level security;

create policy profiles_owner on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy games_owner on public.games for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy moves_owner on public.moves for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy achievements_owner on public.achievements for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy player_stats_owner on public.player_stats for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy rating_history_owner on public.rating_history for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.games, public.moves, public.achievements, public.player_stats, public.rating_history to authenticated;
grant usage, select on all sequences in schema public to authenticated;
