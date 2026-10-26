-- Latex-writing-quality v1 contract/security checks. Run only after 001, 002,
-- and 003 on the isolated disposable PostgreSQL database. Fixtures roll back.

BEGIN;

DO $writing_security_metadata$
DECLARE
    v_role text;
    v_table text;
    v_function record;
    v_expected record;
    v_quality_tables integer;
BEGIN
    SELECT pg_catalog.count(*) INTO v_quality_tables
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'xacl_private'
      AND c.relkind = 'r'
      AND c.relname IN (
          'quality_protocol_config', 'quality_annotation_records', 'quality_annotation_history'
      )
      AND c.relrowsecurity;
    IF v_quality_tables <> 3 THEN
        RAISE EXCEPTION 'all three multi-protocol quality tables must keep row-level security enabled';
    END IF;
    IF pg_catalog.has_function_privilege(
        'authenticated', 'public.xacl_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
        'authenticated', 'public.xacl_quality_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'an archived alignment or document-quality save RPC remains executable';
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF pg_catalog.has_schema_privilege(v_role, 'xacl_private', 'USAGE') THEN
            RAISE EXCEPTION 'role % unexpectedly has private-schema usage', v_role;
        END IF;
        FOREACH v_table IN ARRAY ARRAY[
            'xacl_private.quality_protocol_config',
            'xacl_private.quality_annotation_records',
            'xacl_private.quality_annotation_history'
        ] LOOP
            IF pg_catalog.has_table_privilege(
                v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
            ) THEN
                RAISE EXCEPTION 'role % unexpectedly has privileges on %', v_role, v_table;
            END IF;
        END LOOP;
    END LOOP;

    FOR v_function IN
        SELECT p.oid, p.proname, p.proacl, p.prosecdef, p.proconfig, n.nspname
        FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE (n.nspname = 'public' AND p.proname LIKE 'xacl_writing_%')
           OR (n.nspname = 'xacl_private' AND p.proname LIKE '%writing%')
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
            RAISE EXCEPTION 'writing RPC %.% must be SECURITY DEFINER with an empty search_path',
                v_function.nspname, v_function.proname;
        END IF;
        IF v_function.nspname = 'xacl_private'
           AND (pg_catalog.has_function_privilege('anon', v_function.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('service_role', v_function.oid, 'EXECUTE')) THEN
            RAISE EXCEPTION 'writing helper % is executable by an application role', v_function.proname;
        END IF;
    END LOOP;

    FOR v_expected IN
        SELECT * FROM (VALUES
            ('public.xacl_writing_annotation_health()'::regprocedure, true, true),
            ('public.xacl_writing_register_annotator(text,text)'::regprocedure, false, true),
            ('public.xacl_writing_resume_annotator(text,text)'::regprocedure, false, true),
            ('public.xacl_writing_current_annotations()'::regprocedure, false, true),
            ('public.xacl_writing_load_annotations(text)'::regprocedure, false, true),
            ('public.xacl_writing_save_annotations(text,jsonb,text,text,text)'::regprocedure, false, true)
        ) AS expected(rpc, anon_exec, authenticated_exec)
    LOOP
        IF pg_catalog.has_function_privilege('anon', v_expected.rpc, 'EXECUTE') IS DISTINCT FROM v_expected.anon_exec
           OR pg_catalog.has_function_privilege('authenticated', v_expected.rpc, 'EXECUTE') IS DISTINCT FROM v_expected.authenticated_exec
           OR pg_catalog.has_function_privilege('service_role', v_expected.rpc, 'EXECUTE') THEN
            RAISE EXCEPTION 'writing RPC grants are incorrect for %', v_expected.rpc;
        END IF;
    END LOOP;
END
$writing_security_metadata$;

DO $writing_record_contract$
DECLARE
    v_now text := '2026-10-26T12:00:00.000Z';
    v_scores jsonb;
    v_annotation jsonb;
    v_record jsonb;
    v_error text;
    v_issue_key text;
BEGIN
    v_scores := pg_catalog.jsonb_build_object(
        'language_clarity', 5,
        'coherence_flow', 5,
        'structural_completeness', 5,
        'technical_expression', 5,
        'overall_writing_quality', 5
    );
    v_annotation := pg_catalog.jsonb_build_object(
        'scores', v_scores,
        'auxiliary_checks', pg_catalog.jsonb_build_object(
            'pdf_visual_integrity', pg_catalog.jsonb_build_object(
                'status', 'not_assessed', 'score', NULL, 'issue_codes', '[]'::jsonb
            )
        ),
        'version_differences', pg_catalog.jsonb_build_array(
            'text_revision', 'scientific_content_revision', 'technical_objects_revision',
            'structure_revision', 'references_revision', 'appendix_revision', 'identity_uncertain'
        ),
        'version_notes', '',
        'reference_exposed', false,
        'reviewed_full_scope', true,
        'status', 'completed',
        'updated_at', v_now
    );
    v_record := pg_catalog.jsonb_build_object(
        'schema', 'xacl.latex-writing-annotations.v1',
        'protocol_id', 'latex-writing-quality-v1',
        'dataset_id', 'revisionlens-alignment30-v1',
        'manifest_sha256', 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'rubric_version', 'latex-writing-quality-rubric-v1',
        'annotator_id', 'QA_WRITING_SQL',
        'revision', 0,
        'created_at', v_now,
        'updated_at', v_now,
        'annotations', pg_catalog.jsonb_build_object('RL01', v_annotation)
    );

    v_error := xacl_private.validate_writing_annotation_record(
        v_record, 'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'five completed scores and all seven difference flags should be valid: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,overall_writing_quality}', '5.0'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'integer-valued JSON number 5.0 should be valid: %', v_error;
    END IF;
    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,overall_writing_quality}', '5.5'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%score overall_writing_quality must%' THEN
        RAISE EXCEPTION 'fractional score 5.5 was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{revision}', '9007199254740991'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'largest JavaScript-safe revision should be valid: %', v_error;
    END IF;
    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{revision}', '9007199254740992'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%non-negative safe integer%' THEN
        RAISE EXCEPTION 'revision beyond the JavaScript-safe range was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{created_at}', '"not-a-timestamp"'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%timestamps must be valid ISO 8601%' THEN
        RAISE EXCEPTION 'invalid record timestamp was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        v_record || pg_catalog.jsonb_build_object('future_field', true),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%exactly the supported protocol identity%' THEN
        RAISE EXCEPTION 'unknown top-level field was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL31}', v_annotation),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%unknown sample_id%' THEN
        RAISE EXCEPTION 'sample outside RL01–RL30 was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,version_notes}',
            pg_catalog.to_jsonb(pg_catalog.repeat('x', 8388609))),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%8 MiB limit%' THEN
        RAISE EXCEPTION 'record larger than 8 MiB was accepted: %', v_error;
    END IF;

    -- Auxiliary score 1 and all-five core scores are valid; the check does not
    -- constrain core scores or completion.
    v_record := pg_catalog.jsonb_set(
        v_record,
        '{annotations,RL01,auxiliary_checks,pdf_visual_integrity}',
        '{"status":"assessed","score":1,"issue_codes":["clipping"]}'::jsonb
    );
    v_error := xacl_private.validate_writing_annotation_record(
        v_record, 'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'auxiliary score 1 must not cap completed core scores: %', v_error;
    END IF;
    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,auxiliary_checks,pdf_visual_integrity,score}', '5.0'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'integer-valued auxiliary JSON number 5.0 should be valid: %', v_error;
    END IF;
    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,auxiliary_checks,pdf_visual_integrity,score}', '5.5'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%assessed pdf_visual_integrity score%' THEN
        RAISE EXCEPTION 'fractional auxiliary score 5.5 was accepted: %', v_error;
    END IF;

    v_record := pg_catalog.jsonb_set(
        v_record, '{annotations,RL01,scores,technical_expression}', '"uncertain"'::jsonb
    );
    v_error := xacl_private.validate_writing_annotation_record(
        v_record, 'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'uncertain is an answered completed core score: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,technical_expression}', '"na"'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%score technical_expression must%' THEN
        RAISE EXCEPTION 'core N/A was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,overall_writing_quality}', '6'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%score overall_writing_quality must%' THEN
        RAISE EXCEPTION 'out-of-range writing score was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores}',
            v_scores || pg_catalog.jsonb_build_object('visual_integrity', 5)),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%exactly all five writing scores%' THEN
        RAISE EXCEPTION 'extra score key was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,auxiliary_checks,pdf_visual_integrity,issue_codes}',
            '["clipping","clipping"]'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%issue_codes must be unique%' THEN
        RAISE EXCEPTION 'duplicate auxiliary issue code was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,auxiliary_checks,pdf_visual_integrity}',
            '{"status":"assessed","score":1,"issue_codes":[],"extra":true}'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%exactly status, score, and issue_codes%' THEN
        RAISE EXCEPTION 'extra nested auxiliary field was accepted: %', v_error;
    END IF;

    FOREACH v_issue_key IN ARRAY ARRAY[
        'missing_glyphs', 'overlap', 'clipping', 'unexpected_blank_regions', 'unreadable_objects'
    ]::text[] LOOP
        v_error := xacl_private.validate_writing_annotation_record(
            pg_catalog.jsonb_set(v_record, '{annotations,RL01,auxiliary_checks,pdf_visual_integrity,issue_codes}',
                pg_catalog.jsonb_build_array(v_issue_key)),
            'QA_WRITING_SQL', 'latex-writing-quality-v1',
            'revisionlens-alignment30-v1',
            'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
            'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
        );
        IF v_error IS NOT NULL THEN
            RAISE EXCEPTION 'supported auxiliary issue code % was rejected: %', v_issue_key, v_error;
        END IF;
    END LOOP;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,auxiliary_checks,pdf_visual_integrity,issue_codes}',
            '["unsupported_visual_issue"]'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%unique supported codes%' THEN
        RAISE EXCEPTION 'unknown auxiliary issue code was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,auxiliary_checks,pdf_visual_integrity,status}', '"other"'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%status must be not_assessed or assessed%' THEN
        RAISE EXCEPTION 'unknown auxiliary status was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,auxiliary_checks,pdf_visual_integrity,score}', 'null'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%assessed pdf_visual_integrity score%' THEN
        RAISE EXCEPTION 'assessed auxiliary check with null score was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,auxiliary_checks,pdf_visual_integrity}',
            '{"status":"not_assessed","score":3,"issue_codes":[]}'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%not_assessed pdf_visual_integrity requires%' THEN
        RAISE EXCEPTION 'not_assessed auxiliary check with a score was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,version_differences}',
            '["text_revision","text_revision"]'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%may not contain duplicates%' THEN
        RAISE EXCEPTION 'duplicate version difference was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,version_differences}', '["future_difference"]'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%supported difference keys%' THEN
        RAISE EXCEPTION 'unknown version difference was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,version_notes}',
            pg_catalog.to_jsonb(pg_catalog.repeat('x', 12001))),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%12,000 characters%' THEN
        RAISE EXCEPTION 'oversized version notes were accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,reference_exposed}', '"true"'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%reference_exposed must be a boolean%' THEN
        RAISE EXCEPTION 'non-boolean reference_exposed was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01}', v_annotation || pg_catalog.jsonb_build_object('notes', 'unexpected')),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%exactly the supported writing fields%' THEN
        RAISE EXCEPTION 'extra annotation field was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,technical_expression}', 'null'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%completed annotation requires all five writing scores%' THEN
        RAISE EXCEPTION 'completed annotation with unanswered core score was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_writing_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,reviewed_full_scope}', 'false'::jsonb),
        'QA_WRITING_SQL', 'latex-writing-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.latex-writing-annotations.v1', 'latex-writing-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%reviewed_full_scope=true%' THEN
        RAISE EXCEPTION 'completed annotation without full-scope review was accepted: %', v_error;
    END IF;
END
$writing_record_contract$;

DO $writing_history_append_only$
DECLARE
    v_annotator_id text := 'QA_WRITING_SQL';
    v_rejected boolean;
BEGIN
    INSERT INTO xacl_private.participants (study_id, annotator_id, recovery_code_sha256)
    VALUES (
        'revisionlens-alignment30-v1', v_annotator_id,
        extensions.digest(pg_catalog.convert_to(pg_catalog.repeat('a', 64), 'UTF8'), 'sha256')
    );
    INSERT INTO xacl_private.quality_annotation_history (
        protocol_id, study_id, annotator_id, revision, full_record,
        rubric_version, rubric_sha256, guidance_version, guidance_sha256, operation, saved_at
    ) VALUES (
        'latex-writing-quality-v1', 'revisionlens-alignment30-v1', v_annotator_id, 1, '{}'::jsonb,
        'latex-writing-quality-rubric-v1',
        'a5a6696e57bc70720c8305b2a1e530de892e203d3c951e09c4cd20ec8b430dfa',
        'latex-writing-quality-guidance-20261026-v1',
        '7d7a76a2ba140306843b3d955c73f095b083a0938ecd4f5b20cc3494c46b6ce6',
        'save', pg_catalog.clock_timestamp()
    );

    v_rejected := false;
    BEGIN
        UPDATE xacl_private.quality_annotation_history
        SET operation = 'import'
        WHERE protocol_id = 'latex-writing-quality-v1'
          AND study_id = 'revisionlens-alignment30-v1'
          AND annotator_id = v_annotator_id;
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'shared quality annotation history allowed an UPDATE';
    END IF;
    v_rejected := false;
    BEGIN
        DELETE FROM xacl_private.quality_annotation_history
        WHERE protocol_id = 'latex-writing-quality-v1'
          AND study_id = 'revisionlens-alignment30-v1'
          AND annotator_id = v_annotator_id;
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'shared quality annotation history allowed a DELETE';
    END IF;
END
$writing_history_append_only$;

ROLLBACK;
