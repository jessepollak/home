alter table actions add column if not exists observed_receipt_transaction_hash text;
alter table actions add column if not exists observed_receipt_block_number numeric;
alter table actions add column if not exists observed_receipt_block_hash text;
alter table actions add column if not exists observed_receipt_outcome text;
alter table actions add column if not exists observed_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'actions_observed_receipt_outcome_value' and conrelid = 'actions'::regclass) then
    alter table actions add constraint actions_observed_receipt_outcome_value check (observed_receipt_outcome in ('succeeded', 'reverted'));
  end if;
end $$;
