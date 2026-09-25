create table if not exists cashout_orders (
  action_id uuid primary key references actions(id) on delete cascade,
  owner_key text not null,
  provider_id text not null,
  environment text not null,
  region text not null,
  deposit_id text,
  deposit_proven boolean not null default false,
  state text not null default 'submitted',
  platform text not null,
  platform_label text not null,
  amount_atomic text not null,
  filled_atomic text not null default '0',
  returned_atomic text not null default '0',
  remaining_atomic text not null,
  withdrawable boolean not null default false,
  eta_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  refreshed_at timestamptz,
  settled_at timestamptz
);
alter table cashout_orders add column if not exists deposit_proven boolean not null default false;
create unique index if not exists cashout_orders_provider_deposit on cashout_orders (provider_id, lower(deposit_id)) where deposit_id is not null;
create index if not exists cashout_orders_owner_unsettled on cashout_orders (owner_key) where settled_at is null;
