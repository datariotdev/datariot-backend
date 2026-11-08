# Datariot Backend

Supabase schema, migrations, policies and server-side infrastructure.

## Current production
Supabase project: `uycrtobdewnscwazshcu`. The production project must not be recreated or reset during migration.

## Structure
- `supabase/migrations/` — versioned SQL migrations (to be exported)
- `supabase/functions/` — Edge Functions (to be synchronized)

Never commit `.env`, provider API keys, service-role keys or database passwords. Existing deployed functions remain live until a tested replacement is deployed.
