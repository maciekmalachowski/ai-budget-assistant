-- Single-user app: any authenticated user has full access. Service role bypasses RLS.
alter table accounts enable row level security;
alter table categories enable row level security;
alter table import_profiles enable row level security;
alter table import_batches enable row level security;
alter table transactions enable row level security;
alter table merchant_map enable row level security;
alter table insights enable row level security;
alter table qa_history enable row level security;

create policy "authenticated_all" on accounts        for all to authenticated using (true) with check (true);
create policy "authenticated_all" on categories       for all to authenticated using (true) with check (true);
create policy "authenticated_all" on import_profiles  for all to authenticated using (true) with check (true);
create policy "authenticated_all" on import_batches   for all to authenticated using (true) with check (true);
create policy "authenticated_all" on transactions     for all to authenticated using (true) with check (true);
create policy "authenticated_all" on merchant_map     for all to authenticated using (true) with check (true);
create policy "authenticated_all" on insights         for all to authenticated using (true) with check (true);
create policy "authenticated_all" on qa_history       for all to authenticated using (true) with check (true);
