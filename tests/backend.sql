-- PostgreSQL integration checks for the anonymous-auth/recovery-code backend.
-- Run only in an isolated disposable PostgreSQL database as its owner.
-- All fixture identities and records roll back. Never use real participant data.
BEGIN;

DO $security_metadata$
DECLARE
    v_function record;
    v_rpc regprocedure;
    v_role text;
    v_table text;
    v_expected record;
    v_private_tables integer;
BEGIN
    IF (SELECT pg_catalog.count(*) FROM xacl_private.study_config) <> 1 THEN
        RAISE EXCEPTION 'expected exactly one frozen study configuration';
    END IF;

    SELECT pg_catalog.count(*) INTO v_private_tables
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'xacl_private' AND c.relkind = 'r' AND c.relrowsecurity;
    IF v_private_tables <> 5 THEN
        RAISE EXCEPTION 'all five private tables must have row-level security enabled (got %)', v_private_tables;
    END IF;

    IF pg_catalog.to_regprocedure('public.xacl_load_annotations(text,text)') IS NOT NULL
       OR pg_catalog.to_regprocedure('public.xacl_save_annotations(text,text,jsonb,text,text,text)') IS NOT NULL THEN
        RAISE EXCEPTION 'obsolete capability-based RPC signatures must be removed';
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'xacl_%') <> 6 THEN
        RAISE EXCEPTION 'expected exactly six public xACL RPCs';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = 'xacl_private.participants'::pg_catalog.regclass
          AND a.attname = 'access_code_sha256' AND NOT a.attisdropped
    ) THEN
        RAISE EXCEPTION 'legacy access-code digest column remains';
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF pg_catalog.has_schema_privilege(v_role, 'xacl_private', 'USAGE') THEN
            RAISE EXCEPTION 'role % unexpectedly has private-schema usage', v_role;
        END IF;
        FOREACH v_table IN ARRAY ARRAY[
            'xacl_private.study_config', 'xacl_private.participants',
            'xacl_private.participant_sessions', 'xacl_private.annotation_records',
            'xacl_private.annotation_history'
        ] LOOP
            IF pg_catalog.has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
                RAISE EXCEPTION 'role % unexpectedly has privileges on %', v_role, v_table;
            END IF;
        END LOOP;
    END LOOP;

    FOR v_function IN
        SELECT p.oid, p.proname, p.proacl, p.prosecdef, p.proconfig, n.nspname
        FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE (n.nspname = 'public' AND p.proname LIKE 'xacl_%')
           OR n.nspname = 'xacl_private'
    LOOP
        IF EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(COALESCE(
                v_function.proacl,
                pg_catalog.acldefault('f', (SELECT p.proowner FROM pg_catalog.pg_proc AS p WHERE p.oid = v_function.oid))
            )) AS acl
            WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) THEN
            RAISE EXCEPTION 'function %.% is executable by PUBLIC', v_function.nspname, v_function.proname;
        END IF;
        IF v_function.nspname = 'public'
           AND (NOT v_function.prosecdef
                OR NOT ('search_path=""' = ANY(COALESCE(v_function.proconfig, ARRAY[]::text[])))) THEN
            RAISE EXCEPTION 'public RPC %.% must be SECURITY DEFINER with an empty search_path',
                v_function.nspname, v_function.proname;
        END IF;
        IF v_function.nspname = 'xacl_private' THEN
            IF pg_catalog.has_function_privilege('anon', v_function.oid, 'EXECUTE')
               OR pg_catalog.has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
               OR pg_catalog.has_function_privilege('service_role', v_function.oid, 'EXECUTE') THEN
                RAISE EXCEPTION 'private helper % is executable by an application role', v_function.proname;
            END IF;
        END IF;
    END LOOP;

    FOR v_expected IN
        SELECT * FROM (VALUES
            ('public.xacl_annotation_health()'::regprocedure, true, true),
            ('public.xacl_register_annotator(text,text)'::regprocedure, false, true),
            ('public.xacl_resume_annotator(text,text)'::regprocedure, false, true),
            ('public.xacl_current_annotations()'::regprocedure, false, true),
            ('public.xacl_load_annotations(text)'::regprocedure, false, true),
            ('public.xacl_save_annotations(text,jsonb,text,text,text)'::regprocedure, false, true)
        ) AS expected(rpc, anon_exec, authenticated_exec)
    LOOP
        IF pg_catalog.has_function_privilege('anon', v_expected.rpc, 'EXECUTE') IS DISTINCT FROM v_expected.anon_exec
           OR pg_catalog.has_function_privilege('authenticated', v_expected.rpc, 'EXECUTE') IS DISTINCT FROM v_expected.authenticated_exec
           OR pg_catalog.has_function_privilege('service_role', v_expected.rpc, 'EXECUTE') THEN
            RAISE EXCEPTION 'public RPC grants are incorrect for %', v_expected.rpc;
        END IF;
    END LOOP;
END
$security_metadata$;

SET LOCAL ROLE anon;
DO $anonymous_checks$
DECLARE
    v_health jsonb;
BEGIN
    v_health := public.xacl_annotation_health();
    IF v_health <> pg_catalog.jsonb_build_object(
        'ready', true,
        'auth_mode', 'anonymous_recovery_v1',
        'dataset_id', 'revisionlens-alignment30-v1',
        'manifest_sha256', 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'rubric_version', 'alignment-rubric-v1',
        'guidance_version', 'alignment-guidance-20261022-v2',
        'guidance_sha256', '7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3'
    ) THEN
        RAISE EXCEPTION 'health RPC returned the wrong frozen study identity: %', v_health;
    END IF;
    IF v_health ? 'annotator_id' OR v_health ? 'record' OR v_health ? 'participants' OR v_health ? 'answers' THEN
        RAISE EXCEPTION 'health RPC leaked participant data';
    END IF;
    IF pg_catalog.has_function_privilege(current_user, 'public.xacl_register_annotator(text,text)', 'EXECUTE')
       OR pg_catalog.has_function_privilege(current_user, 'public.xacl_resume_annotator(text,text)', 'EXECUTE')
       OR pg_catalog.has_function_privilege(current_user, 'public.xacl_current_annotations()', 'EXECUTE')
       OR pg_catalog.has_function_privilege(current_user, 'public.xacl_load_annotations(text)', 'EXECUTE')
       OR pg_catalog.has_function_privilege(current_user, 'public.xacl_save_annotations(text,jsonb,text,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon can execute a profile or annotation RPC';
    END IF;
    BEGIN
        EXECUTE 'SELECT count(*) FROM xacl_private.participants';
        RAISE EXCEPTION 'anon could query the private participants table';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    BEGIN
        PERFORM public.xacl_register_annotator('QA_TEST_A01', pg_catalog.repeat('a', 64));
        RAISE EXCEPTION 'anon unexpectedly executed profile registration';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END
$anonymous_checks$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $unauthenticated_checks$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated"}', true);

    v_result := public.xacl_register_annotator('QA_TEST_NO_UID', pg_catalog.repeat('a', 64));
    IF v_result->>'error' <> 'invalid_access' THEN RAISE EXCEPTION 'registration without auth.uid was accepted: %', v_result; END IF;
    v_result := public.xacl_resume_annotator('QA_TEST_NO_UID', pg_catalog.repeat('a', 64));
    IF v_result->>'error' <> 'invalid_access' THEN RAISE EXCEPTION 'resume without auth.uid was accepted: %', v_result; END IF;
    v_result := public.xacl_current_annotations();
    IF v_result->>'error' <> 'invalid_access' THEN RAISE EXCEPTION 'current-record RPC accepted a null auth.uid: %', v_result; END IF;
    v_result := public.xacl_load_annotations('QA_TEST_A01');
    IF v_result->>'error' <> 'invalid_access' THEN RAISE EXCEPTION 'load without auth.uid was accepted: %', v_result; END IF;
    v_result := public.xacl_save_annotations('QA_TEST_A01', NULL, NULL, NULL, 'save');
    IF v_result->>'error' <> 'invalid_access' THEN RAISE EXCEPTION 'save without auth.uid was accepted: %', v_result; END IF;
END
$unauthenticated_checks$;

DO $identity_checks$
DECLARE
    v_uid_a uuid := '10000000-0000-4000-8000-000000000001';
    v_uid_b uuid := '10000000-0000-4000-8000-000000000002';
    v_uid_c uuid := '10000000-0000-4000-8000-000000000003';
    v_uid_d uuid := '10000000-0000-4000-8000-000000000004';
    v_code_a text := pg_catalog.repeat('a', 64);
    v_code_b text := pg_catalog.repeat('b', 64);
    v_a jsonb;
    v_result jsonb;
    v_unknown jsonb;
    v_wrong jsonb;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_uid_a, 'role', 'authenticated')::text, true);
    v_result := public.xacl_register_annotator('QA_TEST_A01', v_code_a);
    IF v_result->>'error' IS NOT NULL
       OR v_result#>>'{record,annotator_id}' <> 'QA_TEST_A01'
       OR v_result#>>'{record,revision}' <> '0'
       OR v_result#>'{record,annotations}' <> '{}'::jsonb
       OR pg_catalog.strpos(v_result::text, v_code_a) > 0 THEN
        RAISE EXCEPTION 'new profile registration returned an invalid or secret-bearing record: %', v_result;
    END IF;
    v_a := v_result->'record';
    IF public.xacl_current_annotations()->'record' <> v_a THEN
        RAISE EXCEPTION 'current-record RPC did not return the caller profile';
    END IF;
    IF public.xacl_register_annotator('QA_TEST_A01', v_code_a)->'record' <> v_a THEN
        RAISE EXCEPTION 'same UID and same recovery code were not idempotent';
    END IF;
    IF public.xacl_register_annotator('QA_TEST_A01', v_code_b)->>'error' <> 'profile_exists' THEN
        RAISE EXCEPTION 'same UID with a different recovery code was not rejected';
    END IF;
    IF public.xacl_register_annotator('QA_TEST_A99', pg_catalog.repeat('9', 64))->>'error' <> 'profile_exists' THEN
        RAISE EXCEPTION 'one UID registered two profiles';
    END IF;
    IF public.xacl_register_annotator('not valid', v_code_a)->>'error' <> 'invalid_access'
       OR public.xacl_register_annotator('QA_TEST_BAD_CODE', 'short')->>'error' <> 'invalid_access' THEN
        RAISE EXCEPTION 'malformed nickname or recovery code was accepted';
    END IF;

    PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_uid_b, 'role', 'authenticated')::text, true);
    v_result := public.xacl_register_annotator('QA_TEST_A01', v_code_a);
    IF v_result->>'error' <> 'name_taken' THEN
        RAISE EXCEPTION 'duplicate nickname did not return name_taken: %', v_result;
    END IF;
    v_result := public.xacl_register_annotator('QA_TEST_A02', v_code_b);
    IF v_result->>'error' IS NOT NULL OR v_result#>>'{record,annotator_id}' <> 'QA_TEST_A02' THEN
        RAISE EXCEPTION 'second anonymous user failed to register: %', v_result;
    END IF;
    IF public.xacl_current_annotations()#>>'{record,annotator_id}' <> 'QA_TEST_A02' THEN
        RAISE EXCEPTION 'current-record RPC returned another user profile';
    END IF;
    v_result := public.xacl_load_annotations('QA_TEST_A01');
    IF v_result->>'error' <> 'invalid_access' THEN
        RAISE EXCEPTION 'cross-UID load was not denied: %', v_result;
    END IF;
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_a, 'alignment-guidance-20261022-v2',
        '7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3', 'save');
    IF v_result->>'error' <> 'invalid_access' THEN
        RAISE EXCEPTION 'cross-UID save was not denied: %', v_result;
    END IF;

    PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_uid_c, 'role', 'authenticated')::text, true);
    IF public.xacl_current_annotations() <> '{"record":null}'::jsonb THEN
        RAISE EXCEPTION 'an authenticated but unlinked device should have no current profile';
    END IF;
    v_wrong := public.xacl_resume_annotator('QA_TEST_A01', v_code_b);
    v_unknown := public.xacl_resume_annotator('QA_TEST_UNKNOWN', v_code_a);
    IF v_wrong->>'error' <> 'invalid_access' OR v_wrong <> v_unknown THEN
        RAISE EXCEPTION 'wrong code and unknown nickname were distinguishable: %, %', v_wrong, v_unknown;
    END IF;
    v_result := public.xacl_resume_annotator('QA_TEST_A01', v_code_a);
    IF v_result->>'error' IS NOT NULL OR v_result#>>'{record,annotator_id}' <> 'QA_TEST_A01' THEN
        RAISE EXCEPTION 'valid recovery code did not link a second device: %', v_result;
    END IF;
    IF public.xacl_current_annotations()->'record' <> v_a THEN
        RAISE EXCEPTION 'recovered device did not receive the original profile';
    END IF;
    IF public.xacl_load_annotations('QA_TEST_A01')->'record' <> v_a THEN
        RAISE EXCEPTION 'recovered device cannot load its linked profile';
    END IF;
    IF public.xacl_register_annotator('QA_TEST_A01', v_code_a)->'record' <> v_a THEN
        RAISE EXCEPTION 'same linked identity registration retry was not idempotent';
    END IF;
    IF public.xacl_register_annotator('QA_TEST_A02', v_code_b)->>'error' <> 'profile_exists'
       OR public.xacl_resume_annotator('QA_TEST_A02', v_code_b)->>'error' <> 'profile_exists' THEN
        RAISE EXCEPTION 'a device linked to one profile was rebound to another';
    END IF;

    PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_uid_d, 'role', 'authenticated')::text, true);
    v_wrong := public.xacl_resume_annotator('QA_TEST_A01', v_code_b);
    v_unknown := public.xacl_resume_annotator('QA_TEST_UNKNOWN', v_code_a);
    IF v_wrong <> v_unknown THEN
        RAISE EXCEPTION 'wrong code and unknown nickname differ for an unlinked device';
    END IF;
END
$identity_checks$;
RESET ROLE;

DO $identity_persistence_checks$
DECLARE
    v_sessions integer;
    v_participants integer;
BEGIN
    SELECT pg_catalog.count(*) INTO v_participants
    FROM xacl_private.participants
    WHERE study_id = 'revisionlens-alignment30-v1'
      AND annotator_id IN ('QA_TEST_A01', 'QA_TEST_A02');
    SELECT pg_catalog.count(*) INTO v_sessions
    FROM xacl_private.participant_sessions
    WHERE study_id = 'revisionlens-alignment30-v1'
      AND annotator_id IN ('QA_TEST_A01', 'QA_TEST_A02');
    IF v_participants <> 2 OR v_sessions <> 3 THEN
        RAISE EXCEPTION 'registration/recovery created unexpected participant/session rows: %, %', v_participants, v_sessions;
    END IF;
    IF EXISTS (
        SELECT 1 FROM xacl_private.annotation_records
        WHERE study_id = 'revisionlens-alignment30-v1'
          AND annotator_id IN ('QA_TEST_A01', 'QA_TEST_A02')
    ) THEN
        RAISE EXCEPTION 'profile registration or load eagerly created an annotation row';
    END IF;
    IF (SELECT recovery_code_sha256 FROM xacl_private.participants
        WHERE study_id = 'revisionlens-alignment30-v1' AND annotator_id = 'QA_TEST_A01')
       IS DISTINCT FROM extensions.digest(pg_catalog.convert_to(pg_catalog.repeat('a', 64), 'UTF8'), 'sha256') THEN
        RAISE EXCEPTION 'participant recovery credential is not stored as its SHA-256 digest';
    END IF;
END
$identity_persistence_checks$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);

DO $record_checks$
DECLARE
    v_record jsonb;
    v_annotation jsonb;
    v_result jsonb;
    v_saved jsonb;
    v_bad jsonb;
    v_initial jsonb;
    v_guidance text := 'alignment-guidance-20261022-v2';
    v_guidance_hash text := '7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3';
    v_now text := '2026-10-01T12:00:00.000Z';
BEGIN
    v_initial := public.xacl_current_annotations()->'record';
    IF v_initial->>'revision' <> '0' THEN
        RAISE EXCEPTION 'strict checks did not start from revision zero: %', v_initial;
    END IF;
    v_annotation := pg_catalog.jsonb_build_object(
        'scores', pg_catalog.jsonb_build_object(
            'text_alignment', 5, 'figure_alignment', 5, 'table_alignment', 5,
            'equation_alignment', 5, 'structure_alignment', 5, 'content_coverage', 5,
            'overall_alignment', 5, 'visual_integrity', 5
        ),
        'objects', pg_catalog.jsonb_build_object(
            'figure', pg_catalog.jsonb_build_object('compiled', 'present', 'official', 'present'),
            'table', pg_catalog.jsonb_build_object('compiled', 'present', 'official', 'present'),
            'equation', pg_catalog.jsonb_build_object('compiled', 'present', 'official', 'present')
        ),
        'evidence', '', 'notes', '', 'flags', '[]'::jsonb,
        'reviewed_full_scope', false, 'status', 'draft', 'updated_at', v_now
    );
    v_record := pg_catalog.jsonb_build_object(
        'schema', 'revisionlens.alignment-annotations.v1',
        'dataset_id', 'revisionlens-alignment30-v1',
        'manifest_sha256', 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'rubric_version', 'alignment-rubric-v1', 'annotator_id', 'QA_TEST_A01',
        'revision', 0, 'created_at', v_now, 'updated_at', v_now,
        'annotations', pg_catalog.jsonb_build_object('RL01', v_annotation)
    );

    v_result := public.xacl_save_annotations('QA_TEST_A01', v_record, v_guidance, v_guidance_hash, 'save'
    );
    IF v_result->>'error' IS NOT NULL THEN
        RAISE EXCEPTION 'valid draft save failed: %', v_result;
    END IF;
    v_saved := v_result->'record';
    IF v_saved->>'revision' <> '1'
       OR v_saved->>'created_at' IS DISTINCT FROM v_initial->>'created_at'
       OR v_saved->>'updated_at' <> v_result->>'saved_at' THEN
        RAISE EXCEPTION 'first save did not set server-owned revision and timestamps';
    END IF;

    v_result := public.xacl_save_annotations('QA_TEST_A01', v_record, v_guidance, v_guidance_hash, 'save'
    );
    IF v_result->>'error' <> 'revision_conflict'
       OR v_result->>'current_revision' <> '1' THEN
        RAISE EXCEPTION 'stale revision did not return an optimistic conflict: %', v_result;
    END IF;

    v_bad := v_saved || pg_catalog.jsonb_build_object('extra', true);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record' THEN RAISE EXCEPTION 'unknown top-level field was accepted: %', v_result; END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{manifest_sha256}', '"0000000000000000000000000000000000000000000000000000000000000000"'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'study_mismatch' THEN RAISE EXCEPTION 'wrong manifest was accepted: %', v_result; END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotator_id}', '"QA_TEST_A02"'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record' THEN RAISE EXCEPTION 'cross-annotator record was accepted: %', v_result; END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL31}', v_saved#>'{annotations,RL01}', true);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record' THEN RAISE EXCEPTION 'unknown sample_id was accepted: %', v_result; END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01,scores,text_alignment}', 'true'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record' THEN RAISE EXCEPTION 'boolean score was accepted: %', v_result; END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01,scores,text_alignment}', '1.5'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record' THEN RAISE EXCEPTION 'fractional score was accepted: %', v_result; END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01,scores,figure_alignment}', '"na"'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record' THEN RAISE EXCEPTION 'N/A with present figures was accepted: %', v_result; END IF;

    v_result := public.xacl_save_annotations('QA_TEST_A01', v_saved, 'wrong-guidance', v_guidance_hash, 'save'
    );
    IF v_result->>'error' <> 'study_mismatch' THEN RAISE EXCEPTION 'wrong guidance version was accepted: %', v_result; END IF;
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_saved, v_guidance, '0000000000000000000000000000000000000000000000000000000000000000', 'save'
    );
    IF v_result->>'error' <> 'study_mismatch' THEN RAISE EXCEPTION 'wrong guidance hash was accepted: %', v_result; END IF;

    v_bad := pg_catalog.jsonb_set(
        v_saved, '{annotations,RL01,notes}',
        pg_catalog.to_jsonb(pg_catalog.repeat('x', 8388609))
    );
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record'
       OR v_result->>'message' NOT LIKE '%8 MiB%' THEN
        RAISE EXCEPTION 'record size limit was not enforced: %', v_result;
    END IF;

    -- Complete with both PDFs lacking all three optional object types: N/A is
    -- required. One-sided content cannot receive score 5 and needs evidence.
    v_annotation := pg_catalog.jsonb_build_object(
        'scores', pg_catalog.jsonb_build_object(
            'text_alignment', 5, 'figure_alignment', 'na', 'table_alignment', 'na',
            'equation_alignment', 'na', 'structure_alignment', 5, 'content_coverage', 5,
            'overall_alignment', 5, 'visual_integrity', 5
        ),
        'objects', pg_catalog.jsonb_build_object(
            'figure', pg_catalog.jsonb_build_object('compiled', 'absent', 'official', 'absent'),
            'table', pg_catalog.jsonb_build_object('compiled', 'absent', 'official', 'absent'),
            'equation', pg_catalog.jsonb_build_object('compiled', 'absent', 'official', 'absent')
        ),
        'evidence', '', 'notes', '', 'flags', '[]'::jsonb,
        'reviewed_full_scope', true, 'status', 'completed', 'updated_at', v_now
    );

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01}', v_annotation);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,scores,text_alignment}', 'null'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record'
       OR v_result->>'message' NOT LIKE '%requires all eight scores%' THEN
        RAISE EXCEPTION 'completed annotation with a missing score was accepted: %', v_result;
    END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01}', v_annotation);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,objects,figure,compiled}', 'null'::jsonb);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,scores,figure_alignment}', '4'::jsonb);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,evidence}', '"Uncertain figure match."'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record'
       OR v_result->>'message' NOT LIKE '%requires presence values%' THEN
        RAISE EXCEPTION 'completed annotation with missing object presence was accepted: %', v_result;
    END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01}', v_annotation);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,reviewed_full_scope}', 'false'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record'
       OR v_result->>'message' NOT LIKE '%reviewed_full_scope=true%' THEN
        RAISE EXCEPTION 'completed annotation without full-scope review was accepted: %', v_result;
    END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01}', v_annotation);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,scores,figure_alignment}', '5'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record'
       OR v_result->>'message' NOT LIKE '%must use N/A%' THEN
        RAISE EXCEPTION 'completed annotation without N/A for an absent object type was accepted: %', v_result;
    END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01}', v_annotation);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,objects,figure,compiled}', '"present"'::jsonb);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,objects,figure,official}', '"absent"'::jsonb);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,scores,figure_alignment}', '5'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record'
       OR v_result->>'message' NOT LIKE '%cannot be 5%' THEN
        RAISE EXCEPTION 'one-sided figure with score 5 was accepted: %', v_result;
    END IF;
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,scores,figure_alignment}', '4'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record'
       OR v_result->>'message' NOT LIKE '%requires evidence%' THEN
        RAISE EXCEPTION 'one-sided figure without evidence was accepted: %', v_result;
    END IF;

    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,evidence}', '"Figure 1 appears only in the compiled version."'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' IS NOT NULL OR v_result#>>'{record,revision}' <> '2' THEN
        RAISE EXCEPTION 'valid completed annotation failed: %', v_result;
    END IF;
    v_saved := v_result->'record';

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01,flags}', '["critical_difference"]'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record'
       OR v_result->>'message' NOT LIKE '%Overall%' THEN
        RAISE EXCEPTION 'critical_difference with Overall 5 was accepted: %', v_result;
    END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01,objects,figure,compiled}', '"uncertain"'::jsonb);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,evidence}', '""'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'save');
    IF v_result->>'error' <> 'invalid_record'
       OR v_result->>'message' NOT LIKE '%requires evidence%' THEN
        RAISE EXCEPTION 'uncertain presence without evidence was accepted: %', v_result;
    END IF;

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01,objects,figure,compiled}', '"uncertain"'::jsonb);
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL01,evidence}', '"The compiled figure content is unclear."'::jsonb);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'import'
    );
    IF v_result->>'error' IS NOT NULL OR v_result#>>'{record,revision}' <> '3' THEN
        RAISE EXCEPTION 'valid imported revision failed: %', v_result;
    END IF;

END
$record_checks$;

RESET ROLE;

UPDATE xacl_private.participants
SET revoked_at = pg_catalog.clock_timestamp()
WHERE study_id = 'revisionlens-alignment30-v1'
  AND annotator_id = 'QA_TEST_A01';

SET LOCAL ROLE authenticated;
DO $revocation_checks$
DECLARE
    v_uid_a uuid := '10000000-0000-4000-8000-000000000001';
    v_uid_c uuid := '10000000-0000-4000-8000-000000000003';
    v_uid_d uuid := '10000000-0000-4000-8000-000000000004';
    v_code text := pg_catalog.repeat('a', 64);
    v_invalid jsonb;
    v_result jsonb;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_uid_a, 'role', 'authenticated')::text, true);
    v_result := public.xacl_current_annotations();
    IF v_result->>'error' <> 'invalid_access'
       OR public.xacl_load_annotations('QA_TEST_A01')->>'error' <> 'invalid_access' THEN
        RAISE EXCEPTION 'revoked profile remained available to its original device';
    END IF;
    v_result := public.xacl_save_annotations('QA_TEST_A01', NULL, 'alignment-guidance-20261022-v2',
        '7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3', 'save');
    IF v_result->>'error' <> 'invalid_access' THEN
        RAISE EXCEPTION 'revoked profile remained writable';
    END IF;

    PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_uid_c, 'role', 'authenticated')::text, true);
    IF public.xacl_current_annotations()->>'error' <> 'invalid_access'
       OR public.xacl_load_annotations('QA_TEST_A01')->>'error' <> 'invalid_access' THEN
        RAISE EXCEPTION 'recovered device remained linked to a revoked profile';
    END IF;

    PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_uid_d, 'role', 'authenticated')::text, true);
    v_result := public.xacl_resume_annotator('QA_TEST_A01', v_code);
    v_invalid := public.xacl_resume_annotator('QA_TEST_UNKNOWN', v_code);
    IF v_result->>'error' <> 'invalid_access' OR v_result <> v_invalid THEN
        RAISE EXCEPTION 'revoked and unknown profiles were distinguishable during recovery';
    END IF;
END
$revocation_checks$;
RESET ROLE;

DO $history_checks$
DECLARE
    v_count integer;
BEGIN
    SELECT pg_catalog.count(*) INTO v_count
    FROM xacl_private.annotation_history
    WHERE study_id = 'revisionlens-alignment30-v1'
      AND annotator_id = 'QA_TEST_A01';
    IF v_count <> 3 THEN
        RAISE EXCEPTION 'expected three append-only revisions, found %', v_count;
    END IF;
    IF EXISTS (
        SELECT 1 FROM xacl_private.annotation_history
        WHERE annotator_id = 'QA_TEST_A01'
          AND (guidance_version <> 'alignment-guidance-20261022-v2'
               OR guidance_sha256 <> '7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3')
    ) THEN
        RAISE EXCEPTION 'history did not retain frozen guidance version/hash';
    END IF;
    IF (SELECT operation FROM xacl_private.annotation_history WHERE annotator_id = 'QA_TEST_A01' AND revision = 1) <> 'save'
       OR (SELECT operation FROM xacl_private.annotation_history WHERE annotator_id = 'QA_TEST_A01' AND revision = 2) <> 'save'
       OR (SELECT operation FROM xacl_private.annotation_history WHERE annotator_id = 'QA_TEST_A01' AND revision = 3) <> 'import' THEN
        RAISE EXCEPTION 'history operation provenance is incorrect';
    END IF;
    IF (SELECT revision FROM xacl_private.annotation_records WHERE annotator_id = 'QA_TEST_A01') <> 3 THEN
        RAISE EXCEPTION 'current record revision does not match latest history';
    END IF;

    BEGIN
        UPDATE xacl_private.annotation_history SET operation = 'save'
        WHERE annotator_id = 'QA_TEST_A01' AND revision = 1;
        RAISE EXCEPTION 'history update unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    BEGIN
        DELETE FROM xacl_private.annotation_history
        WHERE annotator_id = 'QA_TEST_A01' AND revision = 1;
        RAISE EXCEPTION 'history delete unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
    BEGIN
        EXECUTE 'TRUNCATE xacl_private.annotation_history';
        RAISE EXCEPTION 'history truncate unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
END
$history_checks$;

ROLLBACK;
