create table if not exists operator_fee_records (
  id bigserial primary key,
  action_id uuid not null unique references actions(id) on delete cascade,
  action_kind text not null,
  amount_base_units numeric(78, 0) not null check (amount_base_units > 0),
  token_asset_id text not null,
  token_address text not null,
  token_decimals integer not null,
  bps integer not null check (bps between 1 and 300),
  recipient text not null,
  collected_by text not null check (collected_by in ('in-batch-transfer', 'provider-native')),
  recorded_at timestamptz not null default now()
);
create index if not exists operator_fee_records_recorded_at on operator_fee_records (recorded_at desc);
