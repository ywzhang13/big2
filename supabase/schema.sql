create table if not exists big2_rooms (
  id uuid primary key default gen_random_uuid(),
  code char(4) unique not null,
  status text not null default 'waiting', -- waiting, ready_check, playing, finished
  host_id text, -- player who created the room
  current_turn int, -- seat index 0-3
  last_play jsonb, -- {seat, cards[], combo{type,rank,suit,cards[]}, playerName}
  pass_count int not null default 0,
  round_starter int,
  scores jsonb not null default '{}', -- {playerId: cumulativeScore}
  ready_players jsonb not null default '[]', -- array of player IDs who confirmed ready
  created_at timestamptz not null default now()
);

create table if not exists big2_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references big2_rooms(id) on delete cascade,
  player_id text not null, -- client-generated ID
  name text not null,
  seat int not null check (seat >= 0 and seat <= 3),
  hand jsonb not null default '[]', -- array of card strings
  card_count int not null default 0,
  is_finished boolean not null default false,
  finish_order int,
  created_at timestamptz not null default now(),
  unique (room_id, seat),
  unique (room_id, player_id)
);

-- Indexes
create index if not exists idx_big2_rooms_code on big2_rooms(code);
create index if not exists idx_big2_players_room on big2_players(room_id);

-- RLS: allow all for now
alter table big2_rooms enable row level security;
alter table big2_players enable row level security;
create policy "Allow all on big2_rooms" on big2_rooms for all using (true) with check (true);
create policy "Allow all on big2_players" on big2_players for all using (true) with check (true);
