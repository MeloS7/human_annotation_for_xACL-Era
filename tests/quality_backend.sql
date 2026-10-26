-- Quality-protocol backend checks. Run only after 001_annotation.sql and
-- 002_document_quality.sql in the isolated disposable PostgreSQL database.
-- All participant fixtures are rolled back.

BEGIN;

DO $quality_security_metadata$
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
        RAISE EXCEPTION 'all three quality tables must have row-level security enabled';
    END IF;
    IF (SELECT pg_catalog.count(*) FROM xacl_private.quality_protocol_config) <> 1 THEN
        RAISE EXCEPTION 'expected exactly one frozen quality protocol configuration';
    END IF;
    IF pg_catalog.has_function_privilege(
        'authenticated', 'public.xacl_save_annotations(text,jsonb,text,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'authenticated role can still call the legacy alignment save endpoint';
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
        WHERE (n.nspname = 'public' AND p.proname LIKE 'xacl_quality_%')
           OR (n.nspname = 'xacl_private' AND p.proname LIKE '%quality%')
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
            RAISE EXCEPTION 'quality RPC %.% must be SECURITY DEFINER with an empty search_path',
                v_function.nspname, v_function.proname;
        END IF;
        IF v_function.nspname = 'xacl_private'
           AND (pg_catalog.has_function_privilege('anon', v_function.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
                OR pg_catalog.has_function_privilege('service_role', v_function.oid, 'EXECUTE')) THEN
            RAISE EXCEPTION 'quality helper % is executable by an application role', v_function.proname;
        END IF;
    END LOOP;

    FOR v_expected IN
        SELECT * FROM (VALUES
            ('public.xacl_quality_annotation_health()'::regprocedure, true, true),
            ('public.xacl_quality_register_annotator(text,text)'::regprocedure, false, true),
            ('public.xacl_quality_resume_annotator(text,text)'::regprocedure, false, true),
            ('public.xacl_quality_current_annotations()'::regprocedure, false, true),
            ('public.xacl_quality_load_annotations(text)'::regprocedure, false, true),
            ('public.xacl_quality_save_annotations(text,jsonb,text,text,text)'::regprocedure, false, true)
        ) AS expected(rpc, anon_exec, authenticated_exec)
    LOOP
        IF pg_catalog.has_function_privilege('anon', v_expected.rpc, 'EXECUTE') IS DISTINCT FROM v_expected.anon_exec
           OR pg_catalog.has_function_privilege('authenticated', v_expected.rpc, 'EXECUTE') IS DISTINCT FROM v_expected.authenticated_exec
           OR pg_catalog.has_function_privilege('service_role', v_expected.rpc, 'EXECUTE') THEN
            RAISE EXCEPTION 'quality RPC grants are incorrect for %', v_expected.rpc;
        END IF;
    END LOOP;
END
$quality_security_metadata$;

DO $quality_record_contract$
DECLARE
    v_now text := '2026-10-26T12:00:00.000Z';
    v_annotation jsonb;
    v_record jsonb;
    v_error text;
    v_scores jsonb;
    v_text_key text;
BEGIN
    v_scores := pg_catalog.jsonb_build_object(
        'language_clarity', 5,
        'coherence_flow', 5,
        'structural_completeness', 5,
        'technical_presentation', 5,
        'visual_integrity', 5,
        'overall_quality', 5
    );
    v_annotation := pg_catalog.jsonb_build_object(
        'scores', v_scores,
        'version_differences', pg_catalog.jsonb_build_array(
            'text_revision', 'scientific_content_revision', 'technical_objects_revision',
            'structure_revision', 'references_revision', 'appendix_revision', 'identity_uncertain'
        ),
        'version_notes', '',
        'evidence', '',
        'notes', '',
        'reviewed_full_scope', true,
        'status', 'completed',
        'updated_at', v_now
    );
    v_record := pg_catalog.jsonb_build_object(
        'schema', 'xacl.document-quality-annotations.v1',
        'protocol_id', 'document-quality-v1',
        'dataset_id', 'revisionlens-alignment30-v1',
        'manifest_sha256', 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'rubric_version', 'document-quality-rubric-v1',
        'annotator_id', 'QA_QUALITY_SQL',
        'revision', 0,
        'created_at', v_now,
        'updated_at', v_now,
        'annotations', pg_catalog.jsonb_build_object('RL01', v_annotation)
    );

    v_error := xacl_private.validate_quality_annotation_record(
        v_record, 'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'all-five completed scores with all seven version flags should be valid: %', v_error;
    END IF;

    -- Uncertain and N/A are answered values; only technical_presentation may
    -- use N/A. Neither version observations nor explanatory text are required.
    v_record := pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,language_clarity}', '"uncertain"'::jsonb),
        '{annotations,RL01,scores,technical_presentation}', '"na"'::jsonb
    );
    v_error := xacl_private.validate_quality_annotation_record(
        v_record, 'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'uncertain plus technical N/A should satisfy completion: %', v_error;
    END IF;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{revision}', '9007199254740991'::jsonb),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'largest JavaScript-safe revision should be valid: %', v_error;
    END IF;
    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{revision}', '9007199254740992'::jsonb),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%non-negative safe integer%' THEN
        RAISE EXCEPTION 'revision beyond the JavaScript-safe range was accepted: %', v_error;
    END IF;

    v_annotation := pg_catalog.jsonb_build_object(
        'scores', pg_catalog.jsonb_build_object(
            'language_clarity', NULL, 'coherence_flow', NULL, 'structural_completeness', NULL,
            'technical_presentation', NULL, 'visual_integrity', NULL, 'overall_quality', NULL
        ),
        'version_differences', '[]'::jsonb,
        'version_notes', '', 'evidence', '', 'notes', '',
        'reviewed_full_scope', false, 'status', 'draft', 'updated_at', v_now
    );
    v_record := pg_catalog.jsonb_set(v_record, '{annotations,RL01}', v_annotation);
    v_error := xacl_private.validate_quality_annotation_record(
        v_record, 'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'blank draft with optional text and differences should be valid: %', v_error;
    END IF;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,notes}',
            pg_catalog.to_jsonb(pg_catalog.repeat('x', 12000))),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NOT NULL THEN
        RAISE EXCEPTION '12,000-character notes should be valid: %', v_error;
    END IF;

    FOREACH v_text_key IN ARRAY ARRAY['version_notes', 'evidence', 'notes']::text[] LOOP
        v_error := xacl_private.validate_quality_annotation_record(
            pg_catalog.jsonb_set(v_record, ARRAY['annotations', 'RL01', v_text_key], 'null'::jsonb),
            'QA_QUALITY_SQL', 'document-quality-v1',
            'revisionlens-alignment30-v1',
            'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
            'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
        );
        IF v_error IS NULL OR v_error NOT LIKE '%must be strings of at most 12,000 characters%' THEN
            RAISE EXCEPTION 'null % was accepted in place of an optional string: %', v_text_key, v_error;
        END IF;
    END LOOP;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,language_clarity}', '"na"'::jsonb),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%score language_clarity must%' THEN
        RAISE EXCEPTION 'N/A was accepted for a score that does not permit it: %', v_error;
    END IF;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores,overall_quality}', '6'::jsonb),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%score overall_quality must%' THEN
        RAISE EXCEPTION 'out-of-range score was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,scores}',
            v_scores || pg_catalog.jsonb_build_object('unexpected', 3)),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%all six quality scores%' THEN
        RAISE EXCEPTION 'unknown score key was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,version_differences}',
            '["text_revision","text_revision"]'::jsonb),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%may not contain duplicates%' THEN
        RAISE EXCEPTION 'duplicate version-difference flag was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,version_differences}', '["future_flag"]'::jsonb),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%supported difference keys%' THEN
        RAISE EXCEPTION 'unknown version-difference flag was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,evidence}', pg_catalog.to_jsonb(pg_catalog.repeat('x', 12001))),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%12,000 characters%' THEN
        RAISE EXCEPTION 'oversized evidence was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL01,notes}',
            pg_catalog.to_jsonb(pg_catalog.repeat('x', 8388609))),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%8 MiB limit%' THEN
        RAISE EXCEPTION 'record larger than 8 MiB was accepted: %', v_error;
    END IF;

    v_error := xacl_private.validate_quality_annotation_record(
        pg_catalog.jsonb_set(v_record, '{annotations,RL31}', v_annotation),
        'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%unknown sample_id%' THEN
        RAISE EXCEPTION 'sample outside RL01–RL30 was accepted: %', v_error;
    END IF;

    v_annotation := pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
            pg_catalog.jsonb_set(v_annotation, '{scores}', v_scores),
            '{status}', '"completed"'::jsonb
        ),
        '{reviewed_full_scope}', 'false'::jsonb
    );
    v_record := pg_catalog.jsonb_set(v_record, '{annotations,RL01}', v_annotation);
    v_error := xacl_private.validate_quality_annotation_record(
        v_record, 'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%reviewed_full_scope=true%' THEN
        RAISE EXCEPTION 'completed annotation without full-scope review was accepted: %', v_error;
    END IF;

    v_annotation := pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
            pg_catalog.jsonb_set(v_annotation, '{scores}',
                pg_catalog.jsonb_build_object(
                    'language_clarity', NULL, 'coherence_flow', NULL, 'structural_completeness', NULL,
                    'technical_presentation', NULL, 'visual_integrity', NULL, 'overall_quality', NULL
                )),
            '{reviewed_full_scope}', 'true'::jsonb
        ),
        '{status}', '"completed"'::jsonb
    );
    v_record := pg_catalog.jsonb_set(v_record, '{annotations,RL01}', v_annotation);
    v_error := xacl_private.validate_quality_annotation_record(
        v_record, 'QA_QUALITY_SQL', 'document-quality-v1',
        'revisionlens-alignment30-v1',
        'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
        'xacl.document-quality-annotations.v1', 'document-quality-rubric-v1'
    );
    IF v_error IS NULL OR v_error NOT LIKE '%requires all six scores%' THEN
        RAISE EXCEPTION 'completed annotation with unanswered scores was accepted: %', v_error;
    END IF;
END
$quality_record_contract$;

DO $quality_history_append_only$
DECLARE
    v_annotator_id text := 'QA_QUALITY_SQL';
    v_rejected boolean;
BEGIN
    IF EXISTS (
        SELECT 1 FROM xacl_private.participants
        WHERE study_id = 'revisionlens-alignment30-v1' AND annotator_id = v_annotator_id
    ) THEN
        RAISE EXCEPTION 'test fixture annotator id already exists';
    END IF;
    INSERT INTO xacl_private.participants (study_id, annotator_id, recovery_code_sha256)
    VALUES (
        'revisionlens-alignment30-v1', v_annotator_id,
        extensions.digest(pg_catalog.convert_to(pg_catalog.repeat('a', 64), 'UTF8'), 'sha256')
    );
    INSERT INTO xacl_private.quality_annotation_history (
        protocol_id, study_id, annotator_id, revision, full_record,
        rubric_version, rubric_sha256, guidance_version, guidance_sha256, operation, saved_at
    ) VALUES (
        'document-quality-v1', 'revisionlens-alignment30-v1', v_annotator_id, 1, '{}'::jsonb,
        'document-quality-rubric-v1',
        '2ddf68ce14b945fa9f96098873cf8c01807ca68540b88332ad52d256e3c5465e',
        'document-quality-guidance-20261026-v1',
        '5355aeeabb9f44c3211a6fa6c606075fc4a06bcdd42464638d93c527301ecf2f',
        'save', pg_catalog.clock_timestamp()
    );

    v_rejected := false;
    BEGIN
        UPDATE xacl_private.quality_annotation_history
        SET operation = 'import'
        WHERE protocol_id = 'document-quality-v1'
          AND study_id = 'revisionlens-alignment30-v1'
          AND annotator_id = v_annotator_id;
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'quality annotation history allowed an UPDATE';
    END IF;

    v_rejected := false;
    BEGIN
        DELETE FROM xacl_private.quality_annotation_history
        WHERE protocol_id = 'document-quality-v1'
          AND study_id = 'revisionlens-alignment30-v1'
          AND annotator_id = v_annotator_id;
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'quality annotation history allowed a DELETE';
    END IF;

    v_rejected := false;
    BEGIN
        TRUNCATE xacl_private.quality_annotation_history;
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'quality annotation history allowed TRUNCATE';
    END IF;
END
$quality_history_append_only$;

ROLLBACK;
