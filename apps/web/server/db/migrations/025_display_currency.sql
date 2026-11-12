alter table customer_preferences add column if not exists display_currency text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customer_preferences_display_currency_value' and conrelid = 'customer_preferences'::regclass) then
    alter table customer_preferences add constraint customer_preferences_display_currency_value check (display_currency ~ '^[A-Z]{3}$' or display_currency = 'country-default');
  end if;
end $$;
