-- Hardening: unique category names + auto-maintained updated_at.

alter table categories add constraint categories_name_key unique (name);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger transactions_set_updated_at
  before update on transactions
  for each row execute function set_updated_at();

create trigger merchant_map_set_updated_at
  before update on merchant_map
  for each row execute function set_updated_at();
