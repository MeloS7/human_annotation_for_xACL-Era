-- Test-only shim for Supabase's auth.uid() in an isolated PostgreSQL database.
-- NEVER apply this file to Supabase production; Supabase owns auth.uid().
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $auth_uid$
    SELECT COALESCE(
        NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid,
        (
            NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
            ->> 'sub'
        )::uuid
    )
$auth_uid$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
