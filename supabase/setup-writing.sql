-- xACL-Era LaTeX writing quality v1 database setup.
-- Requires 001_annotation.sql and 002_document_quality.sql first.
-- Execute as the project database owner (normally `postgres`).

-- Add latex-writing-quality-v1 to the isolated multi-protocol quality store.
-- Requires 001_annotation.sql and 002_document_quality.sql to be installed.
-- Existing alignment and document-quality configuration, records and history
-- remain separate and are not rewritten by this migration.

BEGIN;

DO $writing_protocol_prerequisites$
BEGIN
    IF pg_catalog.to_regclass('xacl_private.study_config') IS NULL
       OR pg_catalog.to_regclass('xacl_private.quality_protocol_config') IS NULL
       OR pg_catalog.to_regclass('xacl_private.quality_annotation_records') IS NULL
       OR pg_catalog.to_regclass('xacl_private.quality_annotation_history') IS NULL
       OR pg_catalog.to_regprocedure('public.xacl_quality_save_annotations(text,jsonb,text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'latex-writing-quality-v1 requires migrations 001 and 002';
    END IF;
END
$writing_protocol_prerequisites$;

REVOKE ALL ON SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;

DO $writing_study_assert$
DECLARE
    v_study xacl_private.study_config%ROWTYPE;
    v_document_quality xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT s.* INTO v_study
    FROM xacl_private.study_config AS s
    WHERE s.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND
       OR v_study.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_study.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_study.rubric_version IS DISTINCT FROM 'alignment-rubric-v1'
       OR v_study.guidance_version IS DISTINCT FROM 'alignment-guidance-20261024-v4'
       OR v_study.guidance_sha256 IS DISTINCT FROM 'a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c' THEN
        RAISE EXCEPTION 'xACL-Era frozen cohort configuration differs from latex-writing-quality-v1';
    END IF;

    SELECT q.* INTO v_document_quality
    FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'document-quality-v1';
    IF NOT FOUND
       OR v_document_quality.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_document_quality.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_document_quality.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_document_quality.record_schema IS DISTINCT FROM 'xacl.document-quality-annotations.v1'
       OR v_document_quality.rubric_version IS DISTINCT FROM 'document-quality-rubric-v1'
       OR v_document_quality.rubric_sha256 IS DISTINCT FROM '2ddf68ce14b945fa9f96098873cf8c01807ca68540b88332ad52d256e3c5465e'
       OR v_document_quality.guidance_version IS DISTINCT FROM 'document-quality-guidance-20261026-v1'
       OR v_document_quality.guidance_sha256 IS DISTINCT FROM '5355aeeabb9f44c3211a6fa6c606075fc4a06bcdd42464638d93c527301ecf2f' THEN
        RAISE EXCEPTION 'document-quality protocol configuration differs from its frozen site protocol';
    END IF;
END
$writing_study_assert$;

INSERT INTO xacl_private.quality_protocol_config (
    protocol_id, study_id, dataset_id, manifest_sha256, record_schema,
    rubric_version, rubric_sha256, guidance_version, guidance_sha256
) VALUES (
    'latex-writing-quality-v1',
    'revisionlens-alignment30-v1',
    'revisionlens-alignment30-v1',
    'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
    'xacl.latex-writing-annotations.v1',
    'latex-writing-quality-rubric-v1',
    'a5a6696e57bc70720c8305b2a1e530de892e203d3c951e09c4cd20ec8b430dfa',
    'latex-writing-quality-guidance-20261026-v1',
    '7d7a76a2ba140306843b3d955c73f095b083a0938ecd4f5b20cc3494c46b6ce6'
)
ON CONFLICT (protocol_id) DO NOTHING;

DO $writing_protocol_config_assert$
DECLARE
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT q.* INTO v_config
    FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-v1'
    FOR UPDATE;
    IF NOT FOUND
       OR v_config.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_config.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_config.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_config.record_schema IS DISTINCT FROM 'xacl.latex-writing-annotations.v1'
       OR v_config.rubric_version IS DISTINCT FROM 'latex-writing-quality-rubric-v1'
       OR v_config.rubric_sha256 IS DISTINCT FROM 'a5a6696e57bc70720c8305b2a1e530de892e203d3c951e09c4cd20ec8b430dfa'
       OR v_config.guidance_version IS DISTINCT FROM 'latex-writing-quality-guidance-20261026-v1'
       OR v_config.guidance_sha256 IS DISTINCT FROM '7d7a76a2ba140306843b3d955c73f095b083a0938ecd4f5b20cc3494c46b6ce6' THEN
        RAISE EXCEPTION 'latex-writing-quality-v1 configuration differs from the frozen site protocol';
    END IF;
END
$writing_protocol_config_assert$;

CREATE OR REPLACE FUNCTION xacl_private.validate_writing_annotation_record(
    p_record jsonb,
    p_annotator_id text,
    p_protocol_id text,
    p_dataset_id text,
    p_manifest_sha256 text,
    p_record_schema text,
    p_rubric_version text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $validate_writing_annotation_record$
DECLARE
    v_annotations jsonb;
    v_annotation jsonb;
    v_scores jsonb;
    v_score jsonb;
    v_auxiliary jsonb;
    v_visual jsonb;
    v_issue_codes jsonb;
    v_differences jsonb;
    v_sample_id text;
    v_score_key text;
    v_status text;
    v_revision_text text;
BEGIN
    IF p_record IS NULL OR pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object' THEN
        RETURN 'record must be a JSON object';
    END IF;
    IF pg_catalog.octet_length(p_record::text) > 8388608 THEN
        RETURN 'record exceeds the 8 MiB limit';
    END IF;
    IF xacl_private.quality_object_key_count(p_record) <> 10
       OR NOT (p_record ?& ARRAY[
           'schema', 'protocol_id', 'dataset_id', 'manifest_sha256', 'rubric_version',
           'annotator_id', 'revision', 'created_at', 'updated_at', 'annotations'
       ]::text[]) THEN
        RETURN 'record must contain exactly the supported protocol identity, revision, timestamps, and annotations fields';
    END IF;
    IF pg_catalog.jsonb_typeof(p_record->'schema') IS DISTINCT FROM 'string'
       OR p_record->>'schema' IS DISTINCT FROM p_record_schema
       OR pg_catalog.jsonb_typeof(p_record->'protocol_id') IS DISTINCT FROM 'string'
       OR p_record->>'protocol_id' IS DISTINCT FROM p_protocol_id THEN
        RETURN 'record schema or protocol does not match this annotation tool';
    END IF;
    IF pg_catalog.jsonb_typeof(p_record->'dataset_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_record->'manifest_sha256') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_record->'rubric_version') IS DISTINCT FROM 'string'
       OR p_record->>'dataset_id' IS DISTINCT FROM p_dataset_id
       OR p_record->>'manifest_sha256' IS DISTINCT FROM p_manifest_sha256
       OR p_record->>'rubric_version' IS DISTINCT FROM p_rubric_version THEN
        RETURN 'record study, manifest, or rubric does not match this frozen study';
    END IF;
    IF pg_catalog.jsonb_typeof(p_record->'annotator_id') IS DISTINCT FROM 'string'
       OR (p_record->>'annotator_id') COLLATE "C" IS DISTINCT FROM p_annotator_id COLLATE "C" THEN
        RETURN 'record annotator_id does not match the requested annotator';
    END IF;
    IF p_annotator_id IS NULL OR p_annotator_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN
        RETURN 'annotator_id has an invalid format';
    END IF;
    IF pg_catalog.jsonb_typeof(p_record->'revision') IS DISTINCT FROM 'number' THEN
        RETURN 'record revision must be a non-negative safe integer';
    END IF;
    v_revision_text := p_record->>'revision';
    IF v_revision_text !~ '^(0|[1-9][0-9]*)$'
       OR pg_catalog.length(v_revision_text) > 16
       OR (pg_catalog.length(v_revision_text) = 16 AND v_revision_text COLLATE "C" > '9007199254740991' COLLATE "C") THEN
        RETURN 'record revision must be a non-negative safe integer';
    END IF;
    IF NOT xacl_private.quality_valid_iso_timestamp(p_record->'created_at')
       OR NOT xacl_private.quality_valid_iso_timestamp(p_record->'updated_at') THEN
        RETURN 'record timestamps must be valid ISO 8601 values with an explicit timezone';
    END IF;

    v_annotations := p_record->'annotations';
    IF pg_catalog.jsonb_typeof(v_annotations) IS DISTINCT FROM 'object' THEN
        RETURN 'record annotations must be an object keyed by sample_id';
    END IF;
    FOR v_sample_id, v_annotation IN
        SELECT e.key, e.value
        FROM pg_catalog.jsonb_each(v_annotations) AS e(key, value)
    LOOP
        IF v_sample_id !~ '^RL(0[1-9]|[12][0-9]|30)$' THEN
            RETURN pg_catalog.format('record contains an unknown sample_id: %s', v_sample_id);
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation) IS DISTINCT FROM 'object'
           OR xacl_private.quality_object_key_count(v_annotation) <> 8
           OR NOT (v_annotation ?& ARRAY[
               'scores', 'auxiliary_checks', 'version_differences', 'version_notes',
               'reference_exposed', 'reviewed_full_scope', 'status', 'updated_at'
           ]::text[]) THEN
            RETURN pg_catalog.format('annotation %s must contain exactly the supported writing fields', v_sample_id);
        END IF;

        v_scores := v_annotation->'scores';
        IF pg_catalog.jsonb_typeof(v_scores) IS DISTINCT FROM 'object'
           OR xacl_private.quality_object_key_count(v_scores) <> 5
           OR NOT (v_scores ?& ARRAY[
               'language_clarity', 'coherence_flow', 'structural_completeness',
               'technical_expression', 'overall_writing_quality'
           ]::text[]) THEN
            RETURN pg_catalog.format('annotation %s must contain exactly all five writing scores', v_sample_id);
        END IF;
        FOREACH v_score_key IN ARRAY ARRAY[
            'language_clarity', 'coherence_flow', 'structural_completeness',
            'technical_expression', 'overall_writing_quality'
        ]::text[] LOOP
            v_score := v_scores->v_score_key;
            IF pg_catalog.jsonb_typeof(v_score) = 'null' THEN
                CONTINUE;
            ELSIF pg_catalog.jsonb_typeof(v_score) = 'number' THEN
                IF (v_score #>> '{}')::numeric NOT IN (1, 2, 3, 4, 5) THEN
                    RETURN pg_catalog.format('score %s must be null, an integer from 1 to 5, or uncertain', v_score_key);
                END IF;
            ELSIF pg_catalog.jsonb_typeof(v_score) = 'string' THEN
                IF v_score #>> '{}' = 'uncertain' THEN
                    CONTINUE;
                END IF;
                RETURN pg_catalog.format('score %s must be null, an integer from 1 to 5, or uncertain', v_score_key);
            ELSE
                RETURN pg_catalog.format('score %s must be null, an integer from 1 to 5, or uncertain', v_score_key);
            END IF;
        END LOOP;

        v_auxiliary := v_annotation->'auxiliary_checks';
        IF pg_catalog.jsonb_typeof(v_auxiliary) IS DISTINCT FROM 'object'
           OR xacl_private.quality_object_key_count(v_auxiliary) <> 1
           OR NOT (v_auxiliary ? 'pdf_visual_integrity') THEN
            RETURN 'auxiliary_checks must contain exactly pdf_visual_integrity';
        END IF;
        v_visual := v_auxiliary->'pdf_visual_integrity';
        IF pg_catalog.jsonb_typeof(v_visual) IS DISTINCT FROM 'object'
           OR xacl_private.quality_object_key_count(v_visual) <> 3
           OR NOT (v_visual ?& ARRAY['status', 'score', 'issue_codes']::text[]) THEN
            RETURN 'pdf_visual_integrity must contain exactly status, score, and issue_codes';
        END IF;
        IF pg_catalog.jsonb_typeof(v_visual->'status') IS DISTINCT FROM 'string'
           OR v_visual->>'status' NOT IN ('not_assessed', 'assessed') THEN
            RETURN 'pdf_visual_integrity status must be not_assessed or assessed';
        END IF;
        v_issue_codes := v_visual->'issue_codes';
        IF pg_catalog.jsonb_typeof(v_issue_codes) IS DISTINCT FROM 'array' THEN
            RETURN 'pdf_visual_integrity issue_codes must be an array of unique supported codes';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(v_issue_codes) AS i(value)
            WHERE pg_catalog.jsonb_typeof(i.value) IS DISTINCT FROM 'string'
               OR i.value #>> '{}' NOT IN (
                   'missing_glyphs', 'overlap', 'clipping',
                   'unexpected_blank_regions', 'unreadable_objects'
               )
        ) THEN
            RETURN 'pdf_visual_integrity issue_codes must be an array of unique supported codes';
        END IF;
        IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_issue_codes))
           <> (SELECT pg_catalog.count(DISTINCT i.value) FROM pg_catalog.jsonb_array_elements(v_issue_codes) AS i(value)) THEN
            RETURN 'pdf_visual_integrity issue_codes must be unique';
        END IF;
        IF v_visual->>'status' = 'not_assessed' THEN
            IF pg_catalog.jsonb_typeof(v_visual->'score') IS DISTINCT FROM 'null'
               OR pg_catalog.jsonb_array_length(v_issue_codes) <> 0 THEN
                RETURN 'not_assessed pdf_visual_integrity requires a null score and no issue codes';
            END IF;
        ELSE
            v_score := v_visual->'score';
            IF pg_catalog.jsonb_typeof(v_score) = 'number' THEN
                IF (v_score #>> '{}')::numeric NOT IN (1, 2, 3, 4, 5) THEN
                    RETURN 'assessed pdf_visual_integrity score must be an integer from 1 to 5 or uncertain';
                END IF;
            ELSIF pg_catalog.jsonb_typeof(v_score) = 'string' THEN
                IF v_score #>> '{}' <> 'uncertain' THEN
                    RETURN 'assessed pdf_visual_integrity score must be an integer from 1 to 5 or uncertain';
                END IF;
            ELSE
                RETURN 'assessed pdf_visual_integrity score must be an integer from 1 to 5 or uncertain';
            END IF;
        END IF;

        v_differences := v_annotation->'version_differences';
        IF pg_catalog.jsonb_typeof(v_differences) IS DISTINCT FROM 'array' THEN
            RETURN 'version_differences must be an array of supported difference keys';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(v_differences) AS d(value)
            WHERE pg_catalog.jsonb_typeof(d.value) IS DISTINCT FROM 'string'
               OR d.value #>> '{}' NOT IN (
                   'text_revision', 'scientific_content_revision', 'technical_objects_revision',
                   'structure_revision', 'references_revision', 'appendix_revision', 'identity_uncertain'
               )
        ) THEN
            RETURN 'version_differences must be an array of supported difference keys';
        END IF;
        IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_differences))
           <> (SELECT pg_catalog.count(DISTINCT d.value) FROM pg_catalog.jsonb_array_elements(v_differences) AS d(value)) THEN
            RETURN 'version_differences may not contain duplicates';
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation->'version_notes') IS DISTINCT FROM 'string'
           OR pg_catalog.length(v_annotation->>'version_notes') > 12000 THEN
            RETURN 'version_notes must be a string of at most 12,000 characters';
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation->'reference_exposed') IS DISTINCT FROM 'boolean' THEN
            RETURN 'reference_exposed must be a boolean';
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation->'reviewed_full_scope') IS DISTINCT FROM 'boolean' THEN
            RETURN 'reviewed_full_scope must be a boolean';
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation->'status') IS DISTINCT FROM 'string'
           OR v_annotation->>'status' NOT IN ('draft', 'completed') THEN
            RETURN 'status must be draft or completed';
        END IF;
        v_status := v_annotation->>'status';
        IF NOT xacl_private.quality_valid_iso_timestamp(v_annotation->'updated_at') THEN
            RETURN 'annotation updated_at must be a valid ISO 8601 value with an explicit timezone';
        END IF;
        IF v_status = 'completed' THEN
            FOREACH v_score_key IN ARRAY ARRAY[
                'language_clarity', 'coherence_flow', 'structural_completeness',
                'technical_expression', 'overall_writing_quality'
            ]::text[] LOOP
                IF pg_catalog.jsonb_typeof(v_scores->v_score_key) = 'null' THEN
                    RETURN pg_catalog.format('completed annotation requires all five writing scores (%s is missing)', v_score_key);
                END IF;
            END LOOP;
            IF v_annotation->'reviewed_full_scope' IS DISTINCT FROM 'true'::jsonb THEN
                RETURN 'completed annotation requires reviewed_full_scope=true';
            END IF;
        END IF;
    END LOOP;
    RETURN NULL;
END
$validate_writing_annotation_record$;

CREATE OR REPLACE FUNCTION public.xacl_writing_annotation_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing_annotation_health$
DECLARE
    v_protocol xacl_private.quality_protocol_config%ROWTYPE;
    v_study xacl_private.study_config%ROWTYPE;
BEGIN
    SELECT q.* INTO v_protocol
    FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-v1';
    SELECT s.* INTO v_study
    FROM xacl_private.study_config AS s
    WHERE s.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND
       OR v_protocol.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_protocol.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_protocol.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_protocol.record_schema IS DISTINCT FROM 'xacl.latex-writing-annotations.v1'
       OR v_protocol.rubric_version IS DISTINCT FROM 'latex-writing-quality-rubric-v1'
       OR v_protocol.rubric_sha256 IS DISTINCT FROM 'a5a6696e57bc70720c8305b2a1e530de892e203d3c951e09c4cd20ec8b430dfa'
       OR v_protocol.guidance_version IS DISTINCT FROM 'latex-writing-quality-guidance-20261026-v1'
       OR v_protocol.guidance_sha256 IS DISTINCT FROM '7d7a76a2ba140306843b3d955c73f095b083a0938ecd4f5b20cc3494c46b6ce6'
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
$xacl_writing_annotation_health$;

CREATE OR REPLACE FUNCTION public.xacl_writing_register_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing_register_annotator$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_register_annotator(p_annotator_id, p_recovery_code);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_writing_register_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_writing_resume_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing_resume_annotator$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_resume_annotator(p_annotator_id, p_recovery_code);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_writing_resume_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_writing_current_annotations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing_current_annotations$
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
    WHERE q.protocol_id = 'latex-writing-quality-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, v_annotator_id
        )
    );
END
$xacl_writing_current_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_writing_load_annotations(p_annotator_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_writing_load_annotations$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_load_annotations(p_annotator_id);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-writing-quality-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_writing_load_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_writing_save_annotations(
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
AS $xacl_writing_save_annotations$
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
    WHERE q.protocol_id = 'latex-writing-quality-v1';
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
$xacl_writing_save_annotations$;

-- Cached alignment and document-quality frontends may still read their
-- archived answers, but neither can write after this protocol is installed.
REVOKE ALL ON FUNCTION public.xacl_save_annotations(text, jsonb, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_quality_save_annotations(text, jsonb, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing_annotation_health() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing_register_annotator(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing_resume_annotator(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing_current_annotations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing_load_annotations(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_writing_save_annotations(text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.xacl_writing_annotation_health() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing_register_annotator(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing_resume_annotator(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing_current_annotations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing_load_annotations(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_writing_save_annotations(text, jsonb, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
