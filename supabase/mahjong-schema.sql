create table if not exists mj_rooms (
  id uuid primary key default gen_random_uuid(),
  code char(4) unique not null,
  status text not null default 'waiting', -- waiting, playing, finished
  host_id text,
  game_state jsonb, -- serialized MahjongGameState
  created_at timestamptz not null default now()
);

create table if not exists mj_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references mj_rooms(id) on delete cascade,
  player_id text not null,
  name text not null,
  seat int not null check (seat >= 0 and seat <= 3),
  created_at timestamptz not null default now(),
  unique (room_id, seat),
  unique (room_id, player_id)
);

create index if not exists idx_mj_rooms_code on mj_rooms(code);
create index if not exists idx_mj_players_room on mj_players(room_id);

alter table mj_rooms enable row level security;
alter table mj_players enable row level security;
create policy "Allow all on mj_rooms" on mj_rooms for all using (true) with check (true);
create policy "Allow all on mj_players" on mj_players for all using (true) with check (true);
