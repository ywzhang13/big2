-- Big Two card game schema

-- Rooms table
create table if not exists big2_rooms (
  id uuid primary key default gen_random_uuid(),
  code char(4) unique not null,
  status text not null default 'waiting',
  current_turn int,
  last_play jsonb,
  pass_count int not null default 0,
  round_starter int,
  created_at timestamptz not null default now()
);

-- Players table
create table if not exists big2_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references big2_rooms(id) on delete cascade,
  name text not null,
  seat int not null check (seat >= 0 and seat <= 3),
  hand jsonb not null default '[]',
  card_count int not null default 0,
  session_token text not null,
  is_finished boolean not null default false,
  finish_order int,
  created_at timestamptz not null default now(),
  unique (room_id, seat)
);

-- Indexes
create index if not exists idx_big2_rooms_code on big2_rooms(code);
create index if not exists idx_big2_players_room_id on big2_players(room_id);
create index if not exists idx_big2_players_session_token on big2_players(session_token);

-- RLS: enable but allow all for dev mode
alter table big2_rooms enable row level security;
alter table big2_players enable row level security;

create policy "Allow all on big2_rooms" on big2_rooms
  for all using (true) with check (true);

create policy "Allow all on big2_players" on big2_players
  for all using (true) with check (true);
