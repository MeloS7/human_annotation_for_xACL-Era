-- Contract and security checks for latex-writing-quality-9p-v1.
-- Execute after migration 004 on the disposable test database.

DO $writing9p_security$
DECLARE
    v_role text;
    v_fn record;
    v_rls_count integer;
BEGIN
    SELECT pg_catalog.count(*) INTO v_rls_count
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'xacl_private' AND c.relkind = 'r'
      AND c.relname IN ('quality_protocol_config', 'quality_annotation_records', 'quality_annotation_history')
      AND c.relrowsecurity;
    IF v_rls_count <> 3 THEN
        RAISE EXCEPTION 'all shared quality tables must retain row-level security';
    END IF;

    IF pg_catalog.has_function_privilege(
        'authenticated', 'public.xacl_writing_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'archived full-scope writing protocol still accepts writes';
    END IF;
    IF NOT pg_catalog.has_function_privilege(
        'anon', 'public.xacl_writing9p_annotation_health()', 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
        'anon', 'public.xacl_writing9p_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
        'authenticated', 'public.xacl_writing9p_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'nine-page protocol RPC grants are incorrect';
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF pg_catalog.has_schema_privilege(v_role, 'xacl_private', 'USAGE') THEN
            RAISE EXCEPTION 'role % unexpectedly has private schema usage', v_role;
        END IF;
        IF pg_catalog.has_table_privilege(
            v_role, 'xacl_private.quality_annotation_records', 'SELECT,INSERT,UPDATE,DELETE'
        ) OR pg_catalog.has_table_privilege(
            v_role, 'xacl_private.quality_annotation_history', 'SELECT,INSERT,UPDATE,DELETE'
        ) THEN
            RAISE EXCEPTION 'role % unexpectedly accesses private quality rows directly', v_role;
        END IF;
    END LOOP;

    FOR v_fn IN
        SELECT p.oid, p.proname, p.proacl, p.prosecdef, p.proconfig
        FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'xacl_writing9p_%'
    LOOP
        IF NOT v_fn.prosecdef OR NOT ('search_path=""' = ANY(COALESCE(v_fn.proconfig, ARRAY[]::text[]))) THEN
            RAISE EXCEPTION 'RPC % must be SECURITY DEFINER with an empty search_path', v_fn.proname;
        END IF;
        IF EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(COALESCE(
                v_fn.proacl,
                pg_catalog.acldefault('f', (SELECT p.proowner FROM pg_catalog.pg_proc AS p WHERE p.oid = v_fn.oid))
            )) AS acl
            WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) THEN
            RAISE EXCEPTION 'RPC % remains executable by PUBLIC', v_fn.proname;
        END IF;
    END LOOP;
END
$writing9p_security$;
