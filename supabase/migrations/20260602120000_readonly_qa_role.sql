-- Defense-in-depth for the Q&A path: a SELECT-only role used only by the
-- question-answering reads. It has no INSERT/UPDATE/DELETE grants, so even if a
-- Q&A tool were ever changed to attempt a write, the database refuses it.
--
-- PostgREST switches into this role when it receives a JWT whose `role` claim is
-- "readonly_qa" (see lib/supabase/readonly.ts). The role must therefore be
-- grantable to PostgREST's login role ("authenticator"), and — because RLS is on —
-- needs a permissive SELECT policy on each table it reads.

create role readonly_qa nologin;
grant readonly_qa to authenticator;

grant usage on schema public to readonly_qa;
grant select on all tables in schema public to readonly_qa;
-- Future tables created by the migration owner are readable too.
alter default privileges in schema public grant select on tables to readonly_qa;

-- RLS is enabled on every table with "authenticated → full access" policies.
-- readonly_qa is a distinct role, so it needs its own SELECT policies. It has no
-- write grants, so SELECT-only policies are sufficient (no write policy can be used).
create policy "readonly_qa reads accounts"        on accounts        for select to readonly_qa using (true);
create policy "readonly_qa reads categories"      on categories      for select to readonly_qa using (true);
create policy "readonly_qa reads transactions"    on transactions    for select to readonly_qa using (true);
create policy "readonly_qa reads merchant_map"    on merchant_map    for select to readonly_qa using (true);
create policy "readonly_qa reads import_profiles" on import_profiles for select to readonly_qa using (true);
create policy "readonly_qa reads import_batches"  on import_batches  for select to readonly_qa using (true);
create policy "readonly_qa reads insights"        on insights        for select to readonly_qa using (true);
create policy "readonly_qa reads qa_history"      on qa_history      for select to readonly_qa using (true);
