-- xACL-Era first-nine-pages LaTeX writing quality protocol setup.
-- Requires migrations 001_annotation.sql, 002_document_quality.sql, and 003_latex_writing.sql.
-- Execute as the project database owner (normally `postgres`).

-- Add the isolated first-nine-pages LaTeX writing protocol after migration 003.
-- Requires 001, 002, and 003 in this same database.
-- Existing protocol rows, annotations, revision history, profiles and recovery
-- codes remain unchanged. This migration adds a blank, separately keyed protocol.

BEGIN;

DO $writing9p_prerequisites$
DECLARE
    v_missing text[] := ARRAY[]::text[];
BEGIN
    IF pg_catalog.to_regclass('xacl_private.study_config') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'xacl_private.study_config');
    END IF;
    IF pg_catalog.to_regclass('xacl_private.quality_protocol_config') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'xacl_private.quality_protocol_config');
    END IF;
    IF pg_catalog.to_regclass('xacl_private.quality_annotation_records') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'xacl_private.quality_annotation_records');
    END IF;
    IF pg_catalog.to_regclass('xacl_private.quality_annotation_history') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'xacl_private.quality_annotation_history');
    END IF;
    IF pg_catalog.to_regprocedure('public.xacl_writing_annotation_health()') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'public.xacl_writing_annotation_health() from migration 003');
    END IF;
    IF pg_catalog.to_regprocedure('xacl_private.validate_writing_annotation_record(jsonb,text,text,text,text,text,text)') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'xacl_private.validate_writing_annotation_record(jsonb,text,text,text,text,text,text) from migration 003');
    END IF;
    IF pg_catalog.to_regprocedure('xacl_private.quality_record_or_empty(text,text,text)') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'xacl_private.quality_record_or_empty(text,text,text) from migration 002');
    END IF;
    IF pg_catalog.cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'latex-writing-quality-9p-v1 requires the original writing migration (003); missing: '
                || pg_catalog.array_to_string(v_missing, ', '),
            HINT = 'Verify the active Supabase project and confirm migrations 001, 002, and 003 plus their writing helpers are installed there. Do not rerun older setup bundles to repair this condition.';
    END IF;
END
$writing9p_prerequisites$;

REVOKE ALL ON SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;

DO $writing9p_base_assert$
DECLARE
    v_study xacl_private.study_config%ROWTYPE;
    v_base xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT s.* INTO v_study FROM xacl_private.study_config AS s
    WHERE s.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND
       OR v_study.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_study.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_study.rubric_version IS DISTINCT FROM 'alignment-rubric-v1'
       OR v_study.guidance_version IS DISTINCT FROM 'alignment-guidance-20261024-v4'
       OR v_study.guidance_sha256 IS DISTINCT FROM 'a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c' THEN
        RAISE EXCEPTION 'xACL-Era frozen cohort configuration differs from the nine-page protocol';
    END IF;
    SELECT q.* INTO v_base FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-v1';
    IF NOT FOUND
       OR v_base.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_base.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_base.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_base.record_schema IS DISTINCT FROM 'xacl.latex-writing-annotations.v1'
       OR v_base.rubric_version IS DISTINCT FROM 'latex-writing-quality-rubric-v1'
       OR v_base.rubric_sha256 IS DISTINCT FROM 'a5a6696e57bc70720c8305b2a1e530de892e203d3c951e09c4cd20ec8b430dfa'
       OR v_base.guidance_version IS DISTINCT FROM 'latex-writing-quality-guidance-20261026-v1'
       OR v_base.guidance_sha256 IS DISTINCT FROM '7d7a76a2ba140306843b3d955c73f095b083a0938ecd4f5b20cc3494c46b6ce6' THEN
        RAISE EXCEPTION 'The previous writing-quality configuration differs from the expected migration-003 version';
    END IF;
END
$writing9p_base_assert$;

INSERT INTO xacl_private.quality_protocol_config (
    protocol_id, study_id, dataset_id, manifest_sha256, record_schema,
    rubric_version, rubric_sha256, guidance_version, guidance_sha256
) VALUES (
    'latex-writing-quality-9p-v1',
    'revisionlens-alignment30-v1',
    'revisionlens-alignment30-v1',
    'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
    'xacl.latex-writing-9p-annotations.v1',
    'latex-writing-quality-9p-rubric-v1',
    '02e538e65740f9aa27ea69cdaede14625ca755447162f3641be4d69fcdfa8db0',
    'latex-writing-quality-9p-guidance-20261104-v1',
    '4ea4026501ff23bb3b209bf8815ed8209b15cdd5675f82c0aa9fce2ab866f58f'
)
ON CONFLICT (protocol_id) DO NOTHING;

DO $writing9p_config_assert$
DECLARE
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-9p-v1' FOR UPDATE;
    IF NOT FOUND
       OR v_config.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_config.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_config.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_config.record_schema IS DISTINCT FROM 'xacl.latex-writing-9p-annotations.v1'
       OR v_config.rubric_version IS DISTINCT FROM 'latex-writing-quality-9p-rubric-v1'
       OR v_config.rubric_sha256 IS DISTINCT FROM '02e538e65740f9aa27ea69cdaede14625ca755447162f3641be4d69fcdfa8db0'
       OR v_config.guidance_version IS DISTINCT FROM 'latex-writing-quality-9p-guidance-20261104-v1'
       OR v_config.guidance_sha256 IS DISTINCT FROM '4ea4026501ff23bb3b209bf8815ed8209b15cdd5675f82c0aa9fce2ab866f58f' THEN
        RAISE EXCEPTION 'latex-writing-quality-9p-v1 configuration differs from its frozen site protocol';
    END IF;
END
$writing9p_config_assert$;

CREATE OR REPLACE FUNCTION public.xacl_writing9p_annotation_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing9p_annotation_health$
DECLARE
    v_protocol xacl_private.quality_protocol_config%ROWTYPE;
    v_study xacl_private.study_config%ROWTYPE;
BEGIN
    SELECT q.* INTO v_protocol
    FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-9p-v1';
    SELECT s.* INTO v_study
    FROM xacl_private.study_config AS s
    WHERE s.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND
       OR v_protocol.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_protocol.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_protocol.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_protocol.record_schema IS DISTINCT FROM 'xacl.latex-writing-9p-annotations.v1'
       OR v_protocol.rubric_version IS DISTINCT FROM 'latex-writing-quality-9p-rubric-v1'
       OR v_protocol.rubric_sha256 IS DISTINCT FROM '02e538e65740f9aa27ea69cdaede14625ca755447162f3641be4d69fcdfa8db0'
       OR v_protocol.guidance_version IS DISTINCT FROM 'latex-writing-quality-9p-guidance-20261104-v1'
       OR v_protocol.guidance_sha256 IS DISTINCT FROM '4ea4026501ff23bb3b209bf8815ed8209b15cdd5675f82c0aa9fce2ab866f58f'
       OR v_study.dataset_id IS DISTINCT FROM v_protocol.dataset_id
       OR v_study.manifest_sha256 IS DISTINCT FROM v_protocol.manifest_sha256
       OR v_study.rubric_version IS DISTINCT FROM 'alignment-rubric-v1'
       OR v_study.guidance_version IS DISTINCT FROM 'alignment-guidance-20261024-v4'
       OR v_study.guidance_sha256 IS DISTINCT FROM 'a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c' THEN
        RETURN pg_catalog.jsonb_build_object('ready', false);
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'ready', true,
        'auth_mode', 'anonymous_recovery_v1',
        'dataset_id', v_protocol.dataset_id,
        'manifest_sha256', v_protocol.manifest_sha256,
        'rubric_version', v_protocol.rubric_version,
        'guidance_version', v_protocol.guidance_version,
        'guidance_sha256', v_protocol.guidance_sha256,
        'protocol_id', v_protocol.protocol_id,
        'record_schema', v_protocol.record_schema,
        'rubric_sha256', v_protocol.rubric_sha256
    );
END
$xacl_writing9p_annotation_health$;

CREATE OR REPLACE FUNCTION public.xacl_writing9p_register_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing9p_register_annotator$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_register_annotator(p_annotator_id, p_recovery_code);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-9p-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_writing9p_register_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_writing9p_resume_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing9p_resume_annotator$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_resume_annotator(p_annotator_id, p_recovery_code);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-9p-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_writing9p_resume_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_writing9p_current_annotations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing9p_current_annotations$
DECLARE
    v_legacy jsonb;
    v_annotator_id text;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_current_annotations();
    IF v_legacy ? 'error' THEN
        RETURN v_legacy;
    END IF;
    IF NOT (v_legacy ? 'record') THEN
        RETURN pg_catalog.jsonb_build_object('error', 'invalid_access');
    END IF;
    IF pg_catalog.jsonb_typeof(v_legacy->'record') = 'null' THEN
        RETURN pg_catalog.jsonb_build_object('record', NULL);
    END IF;
    v_annotator_id := v_legacy#>>'{record,annotator_id}';
    IF v_annotator_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('error', 'invalid_access');
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-9p-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, v_annotator_id
        )
    );
END
$xacl_writing9p_current_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_writing9p_load_annotations(p_annotator_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing9p_load_annotations$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_load_annotations(p_annotator_id);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-9p-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_writing9p_load_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_writing9p_save_annotations(
    p_annotator_id text,
    p_record jsonb,
    p_guidance_version text,
    p_guidance_sha256 text,
    p_operation text DEFAULT 'save'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing9p_save_annotations$
DECLARE
    v_authorization jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
    v_current_record jsonb;
    v_current_revision bigint := 0;
    v_new_revision bigint;
    v_saved_at timestamp with time zone;
    v_saved_at_text text;
    v_created_at text;
    v_saved_record jsonb;
    v_validation_error text;
    v_has_current boolean := false;
    v_sample_id text;
    v_existing_annotation jsonb;
    v_submitted_annotation jsonb;
BEGIN
    -- Reuse the established session-binding and revocation check. The archived
    -- record returned by the old endpoint remains private to this wrapper.
    v_authorization := public.xacl_load_annotations(p_annotator_id);
    IF v_authorization ? 'error' OR NOT (v_authorization ? 'record') THEN
        RETURN v_authorization;
    END IF;

    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-9p-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    IF p_guidance_version IS DISTINCT FROM v_config.guidance_version
       OR p_guidance_sha256 IS DISTINCT FROM v_config.guidance_sha256 THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'study_mismatch', 'message', 'The scoring guidance does not match this frozen protocol.'
        );
    END IF;
    IF p_operation IS NULL OR p_operation NOT IN ('save', 'import') THEN
        RETURN pg_catalog.jsonb_build_object('error', 'invalid_operation');
    END IF;

    v_validation_error := xacl_private.validate_writing_annotation_record(
        p_record,
        p_annotator_id,
        v_config.protocol_id,
        v_config.dataset_id,
        v_config.manifest_sha256,
        v_config.record_schema,
        v_config.rubric_version
    );
    IF v_validation_error IS NOT NULL THEN
        IF v_validation_error LIKE 'record schema or protocol%'
           OR v_validation_error LIKE 'record study, manifest, or rubric%' THEN
            RETURN pg_catalog.jsonb_build_object('error', 'study_mismatch', 'message', v_validation_error);
        END IF;
        RETURN pg_catalog.jsonb_build_object('error', 'invalid_record', 'message', v_validation_error);
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'xacl-quality:' || v_config.protocol_id || ':' || v_config.study_id || ':' || p_annotator_id,
        0
    ));
    SELECT r.revision, r.current_record
    INTO v_current_revision, v_current_record
    FROM xacl_private.quality_annotation_records AS r
    WHERE r.protocol_id = v_config.protocol_id
      AND r.study_id = v_config.study_id
      AND r.annotator_id COLLATE "C" = p_annotator_id COLLATE "C"
    FOR UPDATE;
    v_has_current := FOUND;
    IF NOT v_has_current THEN
        v_current_revision := 0;
    END IF;
    IF (p_record->>'revision')::bigint <> v_current_revision THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'revision_conflict',
            'current_revision', v_current_revision,
            'message', 'This annotation changed since it was loaded.'
        );
    END IF;
    IF v_current_revision = 9007199254740991 THEN
        RETURN pg_catalog.jsonb_build_object('error', 'revision_exhausted');
    END IF;

    IF v_has_current THEN
        FOR v_sample_id, v_existing_annotation IN
            SELECT e.key, e.value
            FROM pg_catalog.jsonb_each(v_current_record->'annotations') AS e(key, value)
        LOOP
            IF v_existing_annotation->'reference_exposed' IS DISTINCT FROM 'true'::jsonb THEN
                CONTINUE;
            END IF;
            IF NOT ((p_record->'annotations') ? v_sample_id) THEN
                RETURN pg_catalog.jsonb_build_object(
                    'error', 'invalid_record',
                    'message', pg_catalog.format('annotation %s cannot be removed after reference exposure', v_sample_id)
                );
            END IF;
            v_submitted_annotation := p_record#>ARRAY['annotations', v_sample_id];
            IF v_submitted_annotation->'reference_exposed' IS DISTINCT FROM 'true'::jsonb THEN
                RETURN pg_catalog.jsonb_build_object(
                    'error', 'invalid_record',
                    'message', pg_catalog.format('annotation %s reference_exposed cannot be reset', v_sample_id)
                );
            END IF;
        END LOOP;
    END IF;

    v_saved_at := pg_catalog.clock_timestamp();
    v_saved_at_text := pg_catalog.to_char(
        v_saved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    IF v_has_current THEN
        v_created_at := v_current_record->>'created_at';
    ELSE
        SELECT pg_catalog.to_char(
            GREATEST(p.created_at, v_config.created_at) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) INTO v_created_at
        FROM xacl_private.participants AS p
        WHERE p.study_id = v_config.study_id
          AND p.annotator_id COLLATE "C" = p_annotator_id COLLATE "C";
    END IF;
    v_new_revision := v_current_revision + 1;
    v_saved_record := p_record || pg_catalog.jsonb_build_object(
        'revision', v_new_revision,
        'created_at', v_created_at,
        'updated_at', v_saved_at_text
    );

    INSERT INTO xacl_private.quality_annotation_records (
        protocol_id, study_id, annotator_id, revision, current_record,
        rubric_version, rubric_sha256, guidance_version, guidance_sha256, saved_at
    ) VALUES (
        v_config.protocol_id, v_config.study_id, p_annotator_id, v_new_revision,
        v_saved_record, v_config.rubric_version, v_config.rubric_sha256,
        v_config.guidance_version, v_config.guidance_sha256, v_saved_at
    )
    ON CONFLICT (protocol_id, study_id, annotator_id) DO UPDATE
       SET revision = EXCLUDED.revision,
           current_record = EXCLUDED.current_record,
           rubric_version = EXCLUDED.rubric_version,
           rubric_sha256 = EXCLUDED.rubric_sha256,
           guidance_version = EXCLUDED.guidance_version,
           guidance_sha256 = EXCLUDED.guidance_sha256,
           saved_at = EXCLUDED.saved_at;

    INSERT INTO xacl_private.quality_annotation_history (
        protocol_id, study_id, annotator_id, revision, full_record,
        rubric_version, rubric_sha256, guidance_version, guidance_sha256, operation, saved_at
    ) VALUES (
        v_config.protocol_id, v_config.study_id, p_annotator_id, v_new_revision,
        v_saved_record, v_config.rubric_version, v_config.rubric_sha256,
        v_config.guidance_version, v_config.guidance_sha256, p_operation, v_saved_at
    );

    RETURN pg_catalog.jsonb_build_object('record', v_saved_record, 'saved_at', v_saved_at_text);
END
$xacl_writing9p_save_annotations$;

-- Cached alignment and document-quality frontends may still read their
-- archived answers, but neither can write after this protocol is installed.
REVOKE ALL ON FUNCTION public.xacl_save_annotations(text, jsonb, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_quality_save_annotations(text, jsonb, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing9p_annotation_health() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing9p_register_annotator(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing9p_resume_annotator(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing9p_current_annotations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing9p_load_annotations(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing9p_save_annotations(text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.xacl_writing9p_annotation_health() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing9p_register_annotator(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing9p_resume_annotator(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing9p_current_annotations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing9p_load_annotations(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing9p_save_annotations(text, jsonb, text, text, text) TO authenticated;

-- Retain old ratings for review, and prevent edits from being mistaken for
-- fresh ratings against the first-nine-pages scope.
REVOKE ALL ON FUNCTION public.xacl_writing_save_annotations(text, jsonb, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
