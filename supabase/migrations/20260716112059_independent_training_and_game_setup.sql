alter table public.profiles
  add column avatar_seed text not null default 'rivalmind-player' check (char_length(avatar_seed) between 1 and 120),
  add column independent_moves integer not null default 0 check (independent_moves >= 0),
  add column independent_accuracy numeric(5,2) not null default 0 check (independent_accuracy between 0 and 100),
  add column estimated_strength integer not null default 900 check (estimated_strength between 100 and 4000);

comment on column public.profiles.independent_accuracy is 'Evaluation-loss score calculated only from moves made without opening the optional coach.';
comment on column public.profiles.estimated_strength is 'Conservative training estimate driven primarily by independent move quality and sample size.';

alter table public.games drop constraint games_difficulty_check;
alter table public.games add constraint games_difficulty_check check (difficulty in ('beginner', 'easy', 'medium', 'hard', 'expert', 'master', 'adaptive'));
alter table public.games drop constraint games_time_control_check;
alter table public.games add constraint games_time_control_check check (time_control in ('open', 'blitz5', 'rapid10', 'steady15'));
alter table public.games add column player_color text not null default 'w' check (player_color in ('w', 'b'));

alter table public.moves
  add column decision_source text check (decision_source in ('independent', 'coach-guided', 'coach-followed', 'coach-diverged')),
  add column coach_suggestions jsonb not null default '[]'::jsonb;

comment on column public.moves.decision_source is 'Whether the player chose independently, used a gentle hint, followed a shown move, or chose differently.';
