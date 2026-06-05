-- Persist the structured fields the importer already derives but previously collapsed
-- into raw_description. Nullable: existing rows stay null until enriched from their CSV.
alter table transactions
  add column title text,
  add column counterparty text,
  add column counterparty_account text;
