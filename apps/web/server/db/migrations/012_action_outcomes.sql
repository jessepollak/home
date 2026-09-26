alter table actions add column if not exists account_address text;
alter table actions add column if not exists declined_reported_at timestamptz;
alter table actions add column if not exists dispatch_attempt integer not null default 0;
alter table actions add column if not exists outcome text;
alter table actions add column if not exists outcome_source text;
alter table actions add column if not exists settled_at timestamptz;
alter table actions add column if not exists outcome_recorded_at timestamptz;
update actions set account_address = lower(owner_key::jsonb->>1) where account_address is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'actions_outcome_value' and conrelid = 'actions'::regclass) then
    alter table actions add constraint actions_outcome_value check (outcome in ('succeeded', 'reverted', 'not_submitted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'actions_outcome_source_value' and conrelid = 'actions'::regclass) then
    alter table actions add constraint actions_outcome_source_value check (outcome_source in ('chain', 'wallet'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'actions_outcome_complete' and conrelid = 'actions'::regclass) then
    alter table actions add constraint actions_outcome_complete check (
      (outcome is null and outcome_source is null and outcome_recorded_at is null)
      or (outcome is not null and outcome_source is not null and outcome_recorded_at is not null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'actions_chain_settled' and conrelid = 'actions'::regclass) then
    alter table actions add constraint actions_chain_settled check (outcome_source <> 'chain' or settled_at is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'actions_not_submitted_wallet' and conrelid = 'actions'::regclass) then
    alter table actions add constraint actions_not_submitted_wallet check (outcome <> 'not_submitted' or outcome_source = 'wallet');
  end if;
end $$;
create index if not exists actions_open_by_account on actions (account_address) where confirmed_at is not null and outcome is null;
