-- Security contract for migration 006. Run only on a disposable database.
DO $followup49_security$
DECLARE
    v_role text;
    v_rpc regprocedure;
    v_function record;
BEGIN
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c
            WHERE c.oid = 'xacl_private.followup49_issue_allowlist'::pg_catalog.regclass) THEN
        RAISE EXCEPTION 'follow-up issue allowlist must have row-level security enabled';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF pg_catalog.has_schema_privilege(v_role, 'xacl_private', 'USAGE') THEN
            RAISE EXCEPTION 'role % unexpectedly has private-schema usage', v_role;
        END IF;
        IF pg_catalog.has_table_privilege(
            v_role, 'xacl_private.followup49_issue_allowlist', 'SELECT,INSERT,UPDATE,DELETE'
        ) THEN
            RAISE EXCEPTION 'role % unexpectedly has direct access to the follow-up allowlist', v_role;
        END IF;
    END LOOP;

    IF NOT pg_catalog.has_function_privilege(
        'anon', 'public.xacl_followup49_annotation_health()', 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
        'anon', 'public.xacl_followup49_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
        'authenticated', 'public.xacl_followup49_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
        'service_role', 'public.xacl_followup49_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'follow-up RPC grants are incorrect';
    END IF;
    IF NOT pg_catalog.has_function_privilege(
        'authenticated', 'public.xacl_usability_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'installing the follow-up must not disable the original usability save endpoint';
    END IF;

    FOREACH v_rpc IN ARRAY ARRAY[
        'public.xacl_followup49_annotation_health()'::regprocedure,
        'public.xacl_followup49_register_annotator(text,text)'::regprocedure,
        'public.xacl_followup49_resume_annotator(text,text)'::regprocedure,
        'public.xacl_followup49_current_annotations()'::regprocedure,
        'public.xacl_followup49_load_annotations(text)'::regprocedure,
        'public.xacl_followup49_save_annotations(text,jsonb,text,text,text)'::regprocedure
    ] LOOP
        SELECT p.prosecdef, p.proconfig, p.proacl, p.proowner
        INTO v_function
        FROM pg_catalog.pg_proc AS p WHERE p.oid = v_rpc;
        IF NOT v_function.prosecdef
           OR NOT ('search_path=""' = ANY(COALESCE(v_function.proconfig, ARRAY[]::text[]))) THEN
            RAISE EXCEPTION 'follow-up RPC % must be SECURITY DEFINER with an empty search_path', v_rpc;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
                v_function.proacl, pg_catalog.acldefault('f', v_function.proowner)
            )) AS acl WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) THEN
            RAISE EXCEPTION 'follow-up RPC % remains executable by PUBLIC', v_rpc;
        END IF;
    END LOOP;

    IF pg_catalog.has_function_privilege(
        'anon', 'xacl_private.validate_followup49_annotation_record(jsonb,text,text,text,text,text,text)', 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
        'authenticated', 'xacl_private.validate_followup49_annotation_record(jsonb,text,text,text,text,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'follow-up record validator must remain private';
    END IF;
END
$followup49_security$;
