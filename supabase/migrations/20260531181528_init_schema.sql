-- 8-table schema for AI Budget Assistant (single-user).
-- Amounts are stored as signed minor units (bigint): negative = outflow, positive = inflow.

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'PLN',
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('expense','income','transfer')),
  color text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table import_profiles (
  id uuid primary key default gen_random_uuid(),
  header_signature text not null unique,
  column_mapping jsonb not null,
  date_format text,
  delimiter text,
  decimal_sep text,
  encoding text,
  created_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  file_name text,
  storage_path text,
  column_mapping jsonb,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending','mapped','imported','failed')),
  created_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  booked_at date not null,
  amount_minor bigint not null,
  currency text not null,
  raw_description text not null,
  merchant text,
  category_id uuid references categories(id) on delete set null,
  category_source text not null default 'uncategorized'
    check (category_source in ('rule','ai','user','uncategorized')),
  ai_confidence real,
  import_batch_id uuid references import_batches(id) on delete set null,
  dedup_hash text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, dedup_hash)
);

create table merchant_map (
  id uuid primary key default gen_random_uuid(),
  match_type text not null check (match_type in ('exact','contains','regex')),
  pattern text not null,
  category_id uuid not null references categories(id) on delete cascade,
  source text not null check (source in ('user','ai','seed')),
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table insights (
  id uuid primary key default gen_random_uuid(),
  period_type text not null check (period_type in ('month','week')),
  period_start date not null,
  summary_md text,
  stats jsonb,
  stale boolean not null default false,
  generated_at timestamptz not null default now()
);

create table qa_history (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer_md text,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

create index idx_transactions_account_date on transactions (account_id, booked_at desc);
create index idx_transactions_category on transactions (category_id);
create index idx_merchant_map_category on merchant_map (category_id);
create index idx_insights_period on insights (period_type, period_start desc);
