-- Add the isolated document-quality v1 protocol after 001_annotation.sql.
-- Existing alignment records and their immutable history remain unchanged.
-- Participant identity and recovery continue to use the shared legacy profile.

BEGIN;

REVOKE ALL ON SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS xacl_private.quality_protocol_config (
    protocol_id text COLLATE "C" PRIMARY KEY,
    study_id text COLLATE "C" NOT NULL,
    dataset_id text COLLATE "C" NOT NULL,
    manifest_sha256 text COLLATE "C" NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    record_schema text COLLATE "C" NOT NULL,
    rubric_version text COLLATE "C" NOT NULL,
    rubric_sha256 text COLLATE "C" NOT NULL CHECK (rubric_sha256 ~ '^[0-9a-f]{64}$'),
    guidance_version text COLLATE "C" NOT NULL,
    guidance_sha256 text COLLATE "C" NOT NULL CHECK (guidance_sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT quality_protocol_config_study_fk
        FOREIGN KEY (study_id) REFERENCES xacl_private.study_config (study_id) ON DELETE RESTRICT,
    CONSTRAINT quality_protocol_config_dataset_matches_study
        CHECK (dataset_id = study_id),
    CONSTRAINT quality_protocol_config_protocol_study_unique UNIQUE (protocol_id, study_id)
);

DO $quality_study_assert$
DECLARE
    v_study xacl_private.study_config%ROWTYPE;
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
        RAISE EXCEPTION 'xACL-Era frozen cohort configuration differs from the document-quality protocol';
    END IF;
END
$quality_study_assert$;

INSERT INTO xacl_private.quality_protocol_config (
    protocol_id, study_id, dataset_id, manifest_sha256, record_schema,
    rubric_version, rubric_sha256, guidance_version, guidance_sha256
) VALUES (
    'document-quality-v1',
    'revisionlens-alignment30-v1',
    'revisionlens-alignment30-v1',
    'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
    'xacl.document-quality-annotations.v1',
    'document-quality-rubric-v1',
    '2ddf68ce14b945fa9f96098873cf8c01807ca68540b88332ad52d256e3c5465e',
    'document-quality-guidance-20261026-v1',
    '5355aeeabb9f44c3211a6fa6c606075fc4a06bcdd42464638d93c527301ecf2f'
)
ON CONFLICT (protocol_id) DO NOTHING;

DO $quality_protocol_config_assert$
DECLARE
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT c.* INTO v_config
    FROM xacl_private.quality_protocol_config AS c
    WHERE c.protocol_id = 'document-quality-v1'
    FOR UPDATE;

    IF NOT FOUND
       OR v_config.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_config.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_config.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_config.record_schema IS DISTINCT FROM 'xacl.document-quality-annotations.v1'
       OR v_config.rubric_version IS DISTINCT FROM 'document-quality-rubric-v1'
       OR v_config.rubric_sha256 IS DISTINCT FROM '2ddf68ce14b945fa9f96098873cf8c01807ca68540b88332ad52d256e3c5465e'
       OR v_config.guidance_version IS DISTINCT FROM 'document-quality-guidance-20261026-v1'
       OR v_config.guidance_sha256 IS DISTINCT FROM '5355aeeabb9f44c3211a6fa6c606075fc4a06bcdd42464638d93c527301ecf2f' THEN
        RAISE EXCEPTION 'document-quality protocol configuration differs from the frozen site protocol';
    END IF;
END
$quality_protocol_config_assert$;

CREATE TABLE IF NOT EXISTS xacl_private.quality_annotation_records (
    protocol_id text COLLATE "C" NOT NULL,
    study_id text COLLATE "C" NOT NULL,
    annotator_id text COLLATE "C" NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    current_record jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(current_record) = 'object'),
    rubric_version text COLLATE "C" NOT NULL,
    rubric_sha256 text COLLATE "C" NOT NULL CHECK (rubric_sha256 ~ '^[0-9a-f]{64}$'),
    guidance_version text COLLATE "C" NOT NULL,
    guidance_sha256 text COLLATE "C" NOT NULL CHECK (guidance_sha256 ~ '^[0-9a-f]{64}$'),
    saved_at timestamp with time zone NOT NULL,
    PRIMARY KEY (protocol_id, study_id, annotator_id),
    CONSTRAINT quality_annotation_records_protocol_fk
        FOREIGN KEY (protocol_id, study_id)
        REFERENCES xacl_private.quality_protocol_config (protocol_id, study_id) ON DELETE RESTRICT,
    CONSTRAINT quality_annotation_records_participant_fk
        FOREIGN KEY (study_id, annotator_id)
        REFERENCES xacl_private.participants (study_id, annotator_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS xacl_private.quality_annotation_history (
    history_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    protocol_id text COLLATE "C" NOT NULL,
    study_id text COLLATE "C" NOT NULL,
    annotator_id text COLLATE "C" NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    full_record jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(full_record) = 'object'),
    rubric_version text COLLATE "C" NOT NULL,
    rubric_sha256 text COLLATE "C" NOT NULL CHECK (rubric_sha256 ~ '^[0-9a-f]{64}$'),
    guidance_version text COLLATE "C" NOT NULL,
    guidance_sha256 text COLLATE "C" NOT NULL CHECK (guidance_sha256 ~ '^[0-9a-f]{64}$'),
    operation text COLLATE "C" NOT NULL CHECK (operation IN ('save', 'import')),
    saved_at timestamp with time zone NOT NULL,
    CONSTRAINT quality_annotation_history_protocol_revision_unique
        UNIQUE (protocol_id, study_id, annotator_id, revision),
    CONSTRAINT quality_annotation_history_protocol_fk
        FOREIGN KEY (protocol_id, study_id)
        REFERENCES xacl_private.quality_protocol_config (protocol_id, study_id) ON DELETE RESTRICT,
    CONSTRAINT quality_annotation_history_participant_fk
        FOREIGN KEY (study_id, annotator_id)
        REFERENCES xacl_private.participants (study_id, annotator_id) ON DELETE RESTRICT
);

ALTER TABLE xacl_private.quality_protocol_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE xacl_private.quality_annotation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE xacl_private.quality_annotation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION xacl_private.quality_valid_iso_timestamp(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $quality_valid_iso_timestamp$
DECLARE
    v_text text;
BEGIN
    IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN
        RETURN false;
    END IF;
    v_text := p_value #>> '{}';
    IF pg_catalog.length(v_text) > 64
       OR v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RETURN false;
    END IF;
    BEGIN
        PERFORM v_text::timestamp with time zone;
    EXCEPTION WHEN OTHERS THEN
        RETURN false;
    END;
    RETURN true;
END
$quality_valid_iso_timestamp$;

CREATE OR REPLACE FUNCTION xacl_private.quality_object_key_count(p_value jsonb)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $quality_object_key_count$
DECLARE
    v_count integer;
BEGIN
    IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN
        RETURN -1;
    END IF;
    SELECT pg_catalog.count(*)::integer INTO v_count
    FROM pg_catalog.jsonb_object_keys(p_value);
    RETURN v_count;
END
$quality_object_key_count$;

CREATE OR REPLACE FUNCTION xacl_private.validate_quality_annotation_record(
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
AS $validate_quality_annotation_record$
DECLARE
    v_annotations jsonb;
    v_annotation jsonb;
    v_scores jsonb;
    v_score jsonb;
    v_score_key text;
    v_sample_id text;
    v_revision_text text;
    v_status text;
    v_differences jsonb;
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
        RETURN 'record revision must be a non-negative integer';
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
               'scores', 'version_differences', 'version_notes', 'evidence', 'notes',
               'reviewed_full_scope', 'status', 'updated_at'
           ]::text[]) THEN
            RETURN pg_catalog.format('annotation %s must contain exactly the supported quality annotation fields', v_sample_id);
        END IF;

        v_scores := v_annotation->'scores';
        IF pg_catalog.jsonb_typeof(v_scores) IS DISTINCT FROM 'object'
           OR xacl_private.quality_object_key_count(v_scores) <> 6
           OR NOT (v_scores ?& ARRAY[
               'language_clarity', 'coherence_flow', 'structural_completeness',
               'technical_presentation', 'visual_integrity', 'overall_quality'
           ]::text[]) THEN
            RETURN pg_catalog.format('annotation %s must contain all six quality scores', v_sample_id);
        END IF;
        FOREACH v_score_key IN ARRAY ARRAY[
            'language_clarity', 'coherence_flow', 'structural_completeness',
            'technical_presentation', 'visual_integrity', 'overall_quality'
        ]::text[] LOOP
            v_score := v_scores->v_score_key;
            IF pg_catalog.jsonb_typeof(v_score) = 'null' THEN
                CONTINUE;
            ELSIF pg_catalog.jsonb_typeof(v_score) = 'number' THEN
                IF (v_score #>> '{}') !~ '^[1-5]$' THEN
                    RETURN pg_catalog.format('score %s must be null, an integer from 1 to 5, or uncertain', v_score_key);
                END IF;
            ELSIF pg_catalog.jsonb_typeof(v_score) = 'string' THEN
                IF v_score #>> '{}' = 'uncertain' THEN
                    CONTINUE;
                ELSIF v_score #>> '{}' = 'na' AND v_score_key = 'technical_presentation' THEN
                    CONTINUE;
                ELSE
                    RETURN pg_catalog.format('score %s must be null, an integer from 1 to 5, or uncertain%s',
                        v_score_key,
                        CASE WHEN v_score_key = 'technical_presentation' THEN ' or na' ELSE '' END);
                END IF;
            ELSE
                RETURN pg_catalog.format('score %s must be null, an integer from 1 to 5, or uncertain%s',
                    v_score_key,
                    CASE WHEN v_score_key = 'technical_presentation' THEN ' or na' ELSE '' END);
            END IF;
        END LOOP;

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
           OR pg_catalog.length(v_annotation->>'version_notes') > 12000
           OR pg_catalog.jsonb_typeof(v_annotation->'evidence') IS DISTINCT FROM 'string'
           OR pg_catalog.length(v_annotation->>'evidence') > 12000
           OR pg_catalog.jsonb_typeof(v_annotation->'notes') IS DISTINCT FROM 'string'
           OR pg_catalog.length(v_annotation->>'notes') > 12000 THEN
            RETURN 'version_notes, evidence, and notes must be strings of at most 12,000 characters';
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
                'technical_presentation', 'visual_integrity', 'overall_quality'
            ]::text[] LOOP
                IF pg_catalog.jsonb_typeof(v_scores->v_score_key) = 'null' THEN
                    RETURN pg_catalog.format('completed annotation requires all six scores (%s is missing)', v_score_key);
                END IF;
            END LOOP;
            IF v_annotation->'reviewed_full_scope' IS DISTINCT FROM 'true'::jsonb THEN
                RETURN 'completed annotation requires reviewed_full_scope=true';
            END IF;
        END IF;
    END LOOP;
    RETURN NULL;
END
$validate_quality_annotation_record$;

CREATE OR REPLACE FUNCTION xacl_private.quality_record_or_empty(
    p_protocol_id text,
    p_study_id text,
    p_annotator_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $quality_record_or_empty$
DECLARE
    v_record jsonb;
    v_timestamp text;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT r.current_record INTO v_record
    FROM xacl_private.quality_annotation_records AS r
    WHERE r.protocol_id = p_protocol_id
      AND r.study_id = p_study_id
      AND r.annotator_id COLLATE "C" = p_annotator_id COLLATE "C";
    IF FOUND THEN
        RETURN v_record;
    END IF;

    SELECT c.* INTO v_config
    FROM xacl_private.quality_protocol_config AS c
    WHERE c.protocol_id = p_protocol_id AND c.study_id = p_study_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'document-quality protocol configuration is missing';
    END IF;
    SELECT pg_catalog.to_char(
        GREATEST(p.created_at, v_config.created_at) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) INTO v_timestamp
    FROM xacl_private.participants AS p
    WHERE p.study_id = p_study_id
      AND p.annotator_id COLLATE "C" = p_annotator_id COLLATE "C";
    IF NOT FOUND THEN
        RAISE EXCEPTION 'participant is missing while constructing its initial quality record';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'schema', v_config.record_schema,
        'protocol_id', v_config.protocol_id,
        'dataset_id', v_config.dataset_id,
        'manifest_sha256', v_config.manifest_sha256,
        'rubric_version', v_config.rubric_version,
        'annotator_id', p_annotator_id,
        'revision', 0,
        'created_at', v_timestamp,
        'updated_at', v_timestamp,
        'annotations', pg_catalog.jsonb_build_object()
    );
END
$quality_record_or_empty$;

DROP TRIGGER IF EXISTS quality_annotation_history_no_update_delete ON xacl_private.quality_annotation_history;
CREATE TRIGGER quality_annotation_history_no_update_delete
BEFORE UPDATE OR DELETE ON xacl_private.quality_annotation_history
FOR EACH ROW EXECUTE FUNCTION xacl_private.prevent_history_mutation();

DROP TRIGGER IF EXISTS quality_annotation_history_no_truncate ON xacl_private.quality_annotation_history;
CREATE TRIGGER quality_annotation_history_no_truncate
BEFORE TRUNCATE ON xacl_private.quality_annotation_history
FOR EACH STATEMENT EXECUTE FUNCTION xacl_private.prevent_history_mutation();

CREATE OR REPLACE FUNCTION public.xacl_quality_annotation_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_quality_annotation_health$
DECLARE
    v_protocol xacl_private.quality_protocol_config%ROWTYPE;
    v_study xacl_private.study_config%ROWTYPE;
BEGIN
    SELECT q.* INTO v_protocol
    FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'document-quality-v1';
    SELECT s.* INTO v_study
    FROM xacl_private.study_config AS s
    WHERE s.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND
       OR v_protocol.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_protocol.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_protocol.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_protocol.record_schema IS DISTINCT FROM 'xacl.document-quality-annotations.v1'
       OR v_protocol.rubric_version IS DISTINCT FROM 'document-quality-rubric-v1'
       OR v_protocol.rubric_sha256 IS DISTINCT FROM '2ddf68ce14b945fa9f96098873cf8c01807ca68540b88332ad52d256e3c5465e'
       OR v_protocol.guidance_version IS DISTINCT FROM 'document-quality-guidance-20261026-v1'
       OR v_protocol.guidance_sha256 IS DISTINCT FROM '5355aeeabb9f44c3211a6fa6c606075fc4a06bcdd42464638d93c527301ecf2f'
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
$xacl_quality_annotation_health$;

CREATE OR REPLACE FUNCTION public.xacl_quality_register_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_quality_register_annotator$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_register_annotator(p_annotator_id, p_recovery_code);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'document-quality-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_quality_register_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_quality_resume_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_quality_resume_annotator$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_resume_annotator(p_annotator_id, p_recovery_code);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'document-quality-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_quality_resume_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_quality_current_annotations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_quality_current_annotations$
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
    WHERE q.protocol_id = 'document-quality-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, v_annotator_id
        )
    );
END
$xacl_quality_current_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_quality_load_annotations(p_annotator_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_quality_load_annotations$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    v_legacy := public.xacl_load_annotations(p_annotator_id);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'document-quality-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_quality_load_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_quality_save_annotations(
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
AS $xacl_quality_save_annotations$
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
BEGIN
    -- The legacy load endpoint performs the shared session binding and revoked
    -- profile check while locking the participant row. Its record stays local
    -- to this SECURITY DEFINER wrapper and is never returned to the caller.
    v_authorization := public.xacl_load_annotations(p_annotator_id);
    IF v_authorization ? 'error' OR NOT (v_authorization ? 'record') THEN
        RETURN v_authorization;
    END IF;

    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'document-quality-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    IF p_guidance_version IS DISTINCT FROM v_config.guidance_version
       OR p_guidance_sha256 IS DISTINCT FROM v_config.guidance_sha256 THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'study_mismatch', 'message', 'The scoring guidance does not match this frozen study.'
        );
    END IF;
    IF p_operation IS NULL OR p_operation NOT IN ('save', 'import') THEN
        RETURN pg_catalog.jsonb_build_object('error', 'invalid_operation');
    END IF;

    v_validation_error := xacl_private.validate_quality_annotation_record(
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
$xacl_quality_save_annotations$;

-- Quality writes replace the old endpoint only for new frontend code. The
-- alignment read/authentication endpoints remain available to preserved clients.
REVOKE ALL ON FUNCTION public.xacl_save_annotations(text, jsonb, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_quality_annotation_health() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_quality_register_annotator(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_quality_resume_annotator(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_quality_current_annotations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_quality_load_annotations(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_quality_save_annotations(text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.xacl_quality_annotation_health() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_quality_register_annotator(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_quality_resume_annotator(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_quality_current_annotations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_quality_load_annotations(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_quality_save_annotations(text, jsonb, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
