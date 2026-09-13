create table if not exists actions (
  id                 uuid primary key,
  owner_key          text not null,
  provider           text not null,
  kind               text not null,
  summary            jsonb not null,
  pending            jsonb,
  created_at         timestamptz not null default now(),
  confirmed_at       timestamptz,
  provider_handle    text,
  transaction_hash   text,
  handle_recorded_at timestamptz
);
create index if not exists actions_owner_recent on actions (owner_key, confirmed_at desc) where confirmed_at is not null;
