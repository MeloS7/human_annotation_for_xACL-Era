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

DO $integrated_presence_contract$
DECLARE
    v_now text := '2026-10-24T12:00:00.000Z';
    v_annotation jsonb;
    v_record jsonb;
    v_legacy_annotation jsonb;
    v_error text;
    v_scenario record;
    v_pair jsonb;
BEGIN
    -- Every supported score/presence mapping is accepted on a draft. The old
    -- objects pairs remain in the record as derived compatibility data.
    FOR v_scenario IN
        SELECT * FROM (VALUES
            ('null'::jsonb, NULL::text, NULL::text, NULL::text),
            ('"na"'::jsonb, NULL::text, 'absent'::text, 'absent'::text),
            ('2'::jsonb, NULL::text, 'present'::text, 'present'::text),
            ('3'::jsonb, NULL::text, 'present'::text, 'present'::text),
            ('4'::jsonb, NULL::text, 'present'::text, 'present'::text),
            ('5'::jsonb, NULL::text, 'present'::text, 'present'::text),
            ('"uncertain"'::jsonb, NULL::text, 'uncertain'::text, 'uncertain'::text),
            ('1'::jsonb, NULL::text, NULL::text, NULL::text),
            ('1'::jsonb, 'missing_in_compiled', 'absent', 'present'),
            ('1'::jsonb, 'added_in_compiled', 'present', 'absent'),
            ('1'::jsonb, 'non_corresponding', 'present', 'present')
        ) AS scenarios(score, reason, compiled, official)
    LOOP
        v_pair := pg_catalog.jsonb_build_object(
            'compiled', v_scenario.compiled,
            'official', v_scenario.official
        );
        v_annotation := pg_catalog.jsonb_build_object(
            'scores', pg_catalog.jsonb_build_object(
                'text_alignment', NULL, 'figure_alignment', NULL, 'table_alignment', NULL,
                'equation_alignment', NULL, 'structure_alignment', NULL, 'content_coverage', NULL,
                'overall_alignment', NULL, 'visual_integrity', NULL
            ),
            'objects', pg_catalog.jsonb_build_object(
                'figure', v_pair,
                'table', pg_catalog.jsonb_build_object('compiled', NULL, 'official', NULL),
                'equation', pg_catalog.jsonb_build_object('compiled', NULL, 'official', NULL)
            ),
            'evidence', '', 'notes', '', 'flags', '[]'::jsonb,
            'reviewed_full_scope', false, 'status', 'draft', 'updated_at', v_now,
            'scoring_protocol', 'integrated-presence-v1',
            'object_score_reasons', pg_catalog.jsonb_build_object(
                'figure', CASE WHEN v_scenario.reason IS NULL THEN 'null'::jsonb ELSE pg_catalog.to_jsonb(v_scenario.reason) END,
                'table', 'null'::jsonb,
                'equation', 'null'::jsonb
            )
        );
        v_annotation := pg_catalog.jsonb_set(v_annotation, '{scores,figure_alignment}', v_scenario.score);
        v_record := pg_catalog.jsonb_build_object(
            'schema', 'revisionlens.alignment-annotations.v1',
            'dataset_id', 'revisionlens-alignment30-v1',
            'manifest_sha256', 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
            'rubric_version', 'alignment-rubric-v1', 'annotator_id', 'QA_TEST_A01',
            'revision', 0, 'created_at', v_now, 'updated_at', v_now,
            'annotations', pg_catalog.jsonb_build_object('RL01', v_annotation)
        );
        v_error := xacl_private.validate_annotation_record(
            v_record, 'QA_TEST_A01', 'revisionlens-alignment30-v1',
            'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
            'alignment-rubric-v1'
        );
        IF v_error IS NOT NULL THEN
            RAISE EXCEPTION 'valid integrated score mapping was rejected (score %, reason %): %',
                v_scenario.score, v_scenario.reason, v_error;
        END IF;
    END LOOP;

    -- Legacy 8-key rows keep their original validation semantics and may
    -- coexist with new rows in the same v1 export without promotion.
    v_legacy_annotation := (v_record#>'{annotations,RL01}') - 'scoring_protocol' - 'object_score_reasons';
    v_error := xacl_private.validate_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01}', v_legacy_annotation),
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'legacy annotation was not accepted under its original rules: %', v_error;
    END IF;
    v_error := xacl_private.validate_annotation_record(
        pg_catalog.jsonb_set(
            pg_catalog.jsonb_set(v_record, '{annotations,RL02}', v_legacy_annotation, true),
            '{annotations,RL01}', v_record#>'{annotations,RL01}'
        ),
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NOT NULL OR v_legacy_annotation ? 'scoring_protocol' THEN
        RAISE EXCEPTION 'mixed legacy and integrated annotations were not retained independently: %', v_error;
    END IF;

    -- A mismatched derived pair, malformed reason, unsupported protocol,
    -- partial extension, or unknown key is rejected even on a draft.
    v_error := xacl_private.validate_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,objects,figure,official}', '"absent"'::jsonb),
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%does not match its score and reason%' THEN
        RAISE EXCEPTION 'mismatched derived presence was not rejected: %', v_error;
    END IF;
    v_error := xacl_private.validate_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,object_score_reasons,figure}', '2'::jsonb),
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%reason for figure must be null or a supported score-1 reason%' THEN
        RAISE EXCEPTION 'malformed integrated reason was not rejected: %', v_error;
    END IF;
    v_error := xacl_private.validate_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,object_score_reasons,other}', 'null'::jsonb),
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%exactly one reason for each object score%' THEN
        RAISE EXCEPTION 'unknown object reason key was not rejected: %', v_error;
    END IF;
    v_error := xacl_private.validate_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scoring_protocol}', '"future-protocol"'::jsonb),
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%unsupported scoring protocol%' THEN
        RAISE EXCEPTION 'unsupported integrated protocol was not rejected: %', v_error;
    END IF;
    v_error := xacl_private.validate_annotation_record(
        pg_catalog.jsonb_set(
            pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,figure_alignment}', '2'::jsonb),
            '{annotations,RL01,object_score_reasons,figure}', '"non_corresponding"'::jsonb
        ),
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%only allowed with a score of 1%' THEN
        RAISE EXCEPTION 'score-1 reason was accepted with another score: %', v_error;
    END IF;
    v_error := xacl_private.validate_annotation_record(
        v_record #- '{annotations,RL01,object_score_reasons}',
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%exact legacy or integrated-presence fields%' THEN
        RAISE EXCEPTION 'partial integrated extension was not rejected: %', v_error;
    END IF;
    v_error := xacl_private.validate_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,unknown}', 'true'::jsonb),
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%exact legacy or integrated-presence fields%' THEN
        RAISE EXCEPTION 'unknown integrated annotation key was not rejected: %', v_error;
    END IF;

    -- An unanswered reason for score 1 is a valid draft but cannot be marked
    -- completed. A completed score of 1 with a reason remains independent of
    -- Overall and does not force Overall down to 1.
    v_annotation := pg_catalog.jsonb_build_object(
        'scores', pg_catalog.jsonb_build_object(
            'text_alignment', 5, 'figure_alignment', 1, 'table_alignment', 5,
            'equation_alignment', 5, 'structure_alignment', 5, 'content_coverage', 5,
            'overall_alignment', 5, 'visual_integrity', 5
        ),
        'objects', pg_catalog.jsonb_build_object(
            'figure', pg_catalog.jsonb_build_object('compiled', NULL, 'official', NULL),
            'table', pg_catalog.jsonb_build_object('compiled', 'present', 'official', 'present'),
            'equation', pg_catalog.jsonb_build_object('compiled', 'present', 'official', 'present')
        ),
        'evidence', 'Draft test evidence.', 'notes', '', 'flags', '[]'::jsonb,
        'reviewed_full_scope', true, 'status', 'completed', 'updated_at', v_now,
        'scoring_protocol', 'integrated-presence-v1',
        'object_score_reasons', pg_catalog.jsonb_build_object(
            'figure', NULL, 'table', NULL, 'equation', NULL
        )
    );
    v_record := pg_catalog.jsonb_build_object(
        'schema', 'revisionlens.alignment-annotations.v1',
        'dataset_id', 'revisionlens-alignment30-v1',
        'manifest_sha256', 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'rubric_version', 'alignment-rubric-v1', 'annotator_id', 'QA_TEST_A01',
        'revision', 0, 'created_at', v_now, 'updated_at', v_now,
        'annotations', pg_catalog.jsonb_build_object('RL01', v_annotation)
    );
    v_error := xacl_private.validate_annotation_record(
        v_record, 'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%score of 1 requires an explicit reason%' THEN
        RAISE EXCEPTION 'completed score 1 without a reason was not rejected: %', v_error;
    END IF;
    v_annotation := pg_catalog.jsonb_set(v_annotation, '{objects,figure,compiled}', '"absent"'::jsonb);
    v_annotation := pg_catalog.jsonb_set(v_annotation, '{objects,figure,official}', '"present"'::jsonb);
    v_annotation := pg_catalog.jsonb_set(v_annotation, '{object_score_reasons,figure}', '"missing_in_compiled"'::jsonb);
    v_record := pg_catalog.jsonb_set(v_record, '{annotations,RL01}', v_annotation);
    v_error := xacl_private.validate_annotation_record(
        v_record, 'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'Overall 5 was incorrectly forced down because figure score was 1: %', v_error;
    END IF;
    v_record := pg_catalog.jsonb_set(v_record, '{annotations,RL01,evidence}', '""'::jsonb);
    v_record := pg_catalog.jsonb_set(v_record, '{annotations,RL01,notes}', '""'::jsonb);
    v_record := pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,text_alignment}', '"uncertain"'::jsonb);
    v_record := pg_catalog.jsonb_set(v_record, '{annotations,RL01,flags}', '["references_difference"]'::jsonb);
    v_error := xacl_private.validate_annotation_record(
        v_record, 'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'uncertain score and non-critical flag without evidence were rejected: %', v_error;
    END IF;
    v_error := xacl_private.validate_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,flags}', '["critical_difference"]'::jsonb),
        'QA_TEST_A01', 'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071', 'alignment-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%critical_difference requires Overall%' THEN
        RAISE EXCEPTION 'integrated protocol changed the critical-difference Overall check: %', v_error;
    END IF;
END
$integrated_presence_contract$;

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
        'guidance_version', 'alignment-guidance-20261024-v4',
        'guidance_sha256', 'a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c'
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
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_a, 'alignment-guidance-20261024-v4',
        'a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c', 'save');
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
    v_loaded jsonb;
    v_bad jsonb;
    v_initial jsonb;
    v_guidance text := 'alignment-guidance-20261024-v4';
    v_guidance_hash text := 'a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c';
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
    -- required. A low score can be saved without evidence or private notes.
    v_annotation := pg_catalog.jsonb_build_object(
        'scores', pg_catalog.jsonb_build_object(
            'text_alignment', 4, 'figure_alignment', 'na', 'table_alignment', 'na',
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

    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL01}', v_annotation);
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

    v_annotation := pg_catalog.jsonb_build_object(
        'scores', pg_catalog.jsonb_build_object(
            'text_alignment', 4, 'figure_alignment', 1, 'table_alignment', 'uncertain',
            'equation_alignment', 'na', 'structure_alignment', 3, 'content_coverage', 2,
            'overall_alignment', 4, 'visual_integrity', 1
        ),
        'objects', pg_catalog.jsonb_build_object(
            'figure', pg_catalog.jsonb_build_object('compiled', 'absent', 'official', 'present'),
            'table', pg_catalog.jsonb_build_object('compiled', 'uncertain', 'official', 'uncertain'),
            'equation', pg_catalog.jsonb_build_object('compiled', 'absent', 'official', 'absent')
        ),
        'evidence', '', 'notes', '', 'flags', '["references_difference"]'::jsonb,
        'reviewed_full_scope', true, 'status', 'completed', 'updated_at', v_now,
        'scoring_protocol', 'integrated-presence-v1',
        'object_score_reasons', pg_catalog.jsonb_build_object(
            'figure', 'missing_in_compiled', 'table', NULL, 'equation', NULL
        )
    );
    v_bad := pg_catalog.jsonb_set(v_saved, '{annotations,RL02}', v_annotation, true);

    v_annotation := pg_catalog.jsonb_build_object(
        'scores', pg_catalog.jsonb_build_object(
            'text_alignment', 'uncertain', 'figure_alignment', 2, 'table_alignment', 3,
            'equation_alignment', 4, 'structure_alignment', 4, 'content_coverage', 3,
            'overall_alignment', 2, 'visual_integrity', 4
        ),
        'objects', pg_catalog.jsonb_build_object(
            'figure', pg_catalog.jsonb_build_object('compiled', 'present', 'official', 'present'),
            'table', pg_catalog.jsonb_build_object('compiled', 'present', 'official', 'present'),
            'equation', pg_catalog.jsonb_build_object('compiled', 'present', 'official', 'present')
        ),
        'evidence', '', 'notes', '', 'flags', '["critical_difference"]'::jsonb,
        'reviewed_full_scope', true, 'status', 'completed', 'updated_at', v_now,
        'scoring_protocol', 'integrated-presence-v1',
        'object_score_reasons', pg_catalog.jsonb_build_object(
            'figure', NULL, 'table', NULL, 'equation', NULL
        )
    );
    v_bad := pg_catalog.jsonb_set(v_bad, '{annotations,RL03}', v_annotation, true);
    v_result := public.xacl_save_annotations('QA_TEST_A01', v_bad, v_guidance, v_guidance_hash, 'import');
    IF v_result->>'error' IS NOT NULL OR v_result#>>'{record,revision}' <> '3' THEN
        RAISE EXCEPTION 'completed annotations with low scores, uncertainty, flags, and empty evidence failed: %', v_result;
    END IF;
    v_saved := v_result->'record';
    v_loaded := public.xacl_load_annotations('QA_TEST_A01');
    IF v_loaded->>'error' IS NOT NULL OR v_loaded->'record' IS DISTINCT FROM v_saved THEN
        RAISE EXCEPTION 'saved optional evidence, notes, and annotation values did not round-trip: %', v_loaded;
    END IF;
    IF v_saved#>>'{annotations,RL02,evidence}' IS DISTINCT FROM ''
       OR v_saved#>>'{annotations,RL02,notes}' IS DISTINCT FROM ''
       OR v_saved#>>'{annotations,RL03,evidence}' IS DISTINCT FROM ''
       OR v_saved#>>'{annotations,RL03,notes}' IS DISTINCT FROM ''
       OR v_saved#>>'{annotations,RL02,scores,figure_alignment}' IS DISTINCT FROM '1'
       OR v_saved#>>'{annotations,RL02,scores,table_alignment}' IS DISTINCT FROM 'uncertain'
       OR v_saved#>>'{annotations,RL02,object_score_reasons,figure}' IS DISTINCT FROM 'missing_in_compiled'
       OR v_saved#>'{annotations,RL02,flags}' IS DISTINCT FROM '["references_difference"]'::jsonb
       OR v_saved#>>'{annotations,RL03,scores,overall_alignment}' IS DISTINCT FROM '2'
       OR v_saved#>'{annotations,RL03,flags}' IS DISTINCT FROM '["critical_difference"]'::jsonb THEN
        RAISE EXCEPTION 'saved completed optional-evidence examples did not retain their values: %', v_saved;
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
    v_result := public.xacl_save_annotations('QA_TEST_A01', NULL, 'alignment-guidance-20261024-v4',
        'a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c', 'save');
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
          AND (guidance_version <> 'alignment-guidance-20261024-v4'
               OR guidance_sha256 <> 'a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c')
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
