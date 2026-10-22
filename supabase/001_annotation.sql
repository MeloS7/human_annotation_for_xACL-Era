-- Private persistence for the frozen xACL-Era PDF-alignment study.
-- Apply as the Supabase project database owner (normally `postgres`).
-- Participants self-register with a pseudonymous ID and a client-generated,
-- private recovery code. This migration never creates identities or codes.

BEGIN;

-- The earlier participant-capability draft was never deployed. Remove its
-- request signatures so the website cannot keep calling the old API.
DROP FUNCTION IF EXISTS public.xacl_load_annotations(text, text);
DROP FUNCTION IF EXISTS public.xacl_save_annotations(text, text, jsonb, text, text, text);

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS xacl_private;

REVOKE ALL ON SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS xacl_private.study_config (
    study_id text COLLATE "C" PRIMARY KEY,
    dataset_id text COLLATE "C" NOT NULL UNIQUE,
    manifest_sha256 text COLLATE "C" NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    rubric_version text COLLATE "C" NOT NULL,
    guidance_version text COLLATE "C" NOT NULL,
    guidance_sha256 text COLLATE "C" NOT NULL CHECK (guidance_sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT study_config_dataset_matches_study CHECK (dataset_id = study_id)
);

CREATE TABLE IF NOT EXISTS xacl_private.participants (
    study_id text COLLATE "C" NOT NULL
        REFERENCES xacl_private.study_config (study_id) ON DELETE RESTRICT,
    annotator_id text COLLATE "C" NOT NULL
        CHECK (annotator_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
    recovery_code_sha256 bytea NOT NULL
        CHECK (pg_catalog.octet_length(recovery_code_sha256) = 32),
    revoked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    PRIMARY KEY (study_id, annotator_id)
);

-- Upgrade the unpublished prototype column if this migration is reapplied to a
-- local QA database built with its earlier draft.
DO $participant_recovery_column$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = 'xacl_private.participants'::pg_catalog.regclass
          AND a.attname = 'access_code_sha256'
          AND NOT a.attisdropped
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = 'xacl_private.participants'::pg_catalog.regclass
          AND a.attname = 'recovery_code_sha256'
          AND NOT a.attisdropped
    ) THEN
        ALTER TABLE xacl_private.participants
            RENAME COLUMN access_code_sha256 TO recovery_code_sha256;
    END IF;
END
$participant_recovery_column$;

CREATE TABLE IF NOT EXISTS xacl_private.participant_sessions (
    study_id text COLLATE "C" NOT NULL,
    user_id uuid NOT NULL,
    annotator_id text COLLATE "C" NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    PRIMARY KEY (study_id, user_id),
    CONSTRAINT participant_sessions_participant_fk
        FOREIGN KEY (study_id, annotator_id)
        REFERENCES xacl_private.participants (study_id, annotator_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS xacl_private.annotation_records (
    study_id text COLLATE "C" NOT NULL,
    annotator_id text COLLATE "C" NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    current_record jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(current_record) = 'object'),
    guidance_version text COLLATE "C" NOT NULL,
    guidance_sha256 text COLLATE "C" NOT NULL CHECK (guidance_sha256 ~ '^[0-9a-f]{64}$'),
    saved_at timestamp with time zone NOT NULL,
    PRIMARY KEY (study_id, annotator_id),
    CONSTRAINT annotation_records_participant_fk
        FOREIGN KEY (study_id, annotator_id)
        REFERENCES xacl_private.participants (study_id, annotator_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS xacl_private.annotation_history (
    history_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    study_id text COLLATE "C" NOT NULL,
    annotator_id text COLLATE "C" NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    full_record jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(full_record) = 'object'),
    guidance_version text COLLATE "C" NOT NULL,
    guidance_sha256 text COLLATE "C" NOT NULL CHECK (guidance_sha256 ~ '^[0-9a-f]{64}$'),
    operation text COLLATE "C" NOT NULL CHECK (operation IN ('save', 'import')),
    saved_at timestamp with time zone NOT NULL,
    UNIQUE (study_id, annotator_id, revision),
    CONSTRAINT annotation_history_participant_fk
        FOREIGN KEY (study_id, annotator_id)
        REFERENCES xacl_private.participants (study_id, annotator_id) ON DELETE RESTRICT
);

ALTER TABLE xacl_private.study_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE xacl_private.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE xacl_private.participant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE xacl_private.annotation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE xacl_private.annotation_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO xacl_private.study_config (
    study_id,
    dataset_id,
    manifest_sha256,
    rubric_version,
    guidance_version,
    guidance_sha256
)
VALUES (
    'revisionlens-alignment30-v1',
    'revisionlens-alignment30-v1',
    'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071',
    'alignment-rubric-v1',
    'alignment-guidance-20261022-v2',
    '7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3'
)
ON CONFLICT (study_id) DO NOTHING;

DO $study_config_assert$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM xacl_private.study_config AS c
        WHERE c.study_id = 'revisionlens-alignment30-v1'
          AND c.dataset_id = 'revisionlens-alignment30-v1'
          AND c.manifest_sha256 = 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
          AND c.rubric_version = 'alignment-rubric-v1'
          AND c.guidance_version = 'alignment-guidance-20261022-v2'
          AND c.guidance_sha256 = '7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3'
    ) THEN
        RAISE EXCEPTION 'xACL-Era study configuration differs from the frozen site config';
    END IF;
END
$study_config_assert$;

CREATE OR REPLACE FUNCTION xacl_private.valid_iso_timestamp(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $valid_iso_timestamp$
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
$valid_iso_timestamp$;

CREATE OR REPLACE FUNCTION xacl_private.object_key_count(p_value jsonb)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $object_key_count$
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
$object_key_count$;

CREATE OR REPLACE FUNCTION xacl_private.validate_annotation_record(
    p_record jsonb,
    p_annotator_id text,
    p_dataset_id text,
    p_manifest_sha256 text,
    p_rubric_version text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $validate_annotation_record$
DECLARE
    v_annotations jsonb;
    v_annotation jsonb;
    v_scores jsonb;
    v_objects jsonb;
    v_pair jsonb;
    v_flags jsonb;
    v_status text;
    v_sample_id text;
    v_score_key text;
    v_object_type text;
    v_score jsonb;
    v_compiled text;
    v_official text;
    v_needs_evidence boolean;
    v_revision_text text;
BEGIN
    IF p_record IS NULL OR pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object' THEN
        RETURN 'record must be a JSON object';
    END IF;
    IF pg_catalog.octet_length(p_record::text) > 8388608 THEN
        RETURN 'record exceeds the 8 MiB limit';
    END IF;
    IF xacl_private.object_key_count(p_record) <> 9
       OR NOT (p_record ?& ARRAY[
           'schema', 'dataset_id', 'manifest_sha256', 'rubric_version',
           'annotator_id', 'revision', 'created_at', 'updated_at', 'annotations'
       ]::text[]) THEN
        RETURN 'record must contain exactly the supported identity, revision, timestamps, and annotations fields';
    END IF;

    IF p_record->>'schema' IS DISTINCT FROM 'revisionlens.alignment-annotations.v1' THEN
        RETURN 'record schema does not match this annotation tool';
    END IF;
    IF p_record->>'dataset_id' IS DISTINCT FROM p_dataset_id
       OR p_record->>'manifest_sha256' IS DISTINCT FROM p_manifest_sha256
       OR p_record->>'rubric_version' IS DISTINCT FROM p_rubric_version THEN
        RETURN 'record study, manifest, or rubric does not match this frozen study';
    END IF;
    IF (p_record->>'annotator_id') COLLATE "C" IS DISTINCT FROM p_annotator_id COLLATE "C" THEN
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
       OR pg_catalog.length(v_revision_text) > 19
       OR (pg_catalog.length(v_revision_text) = 19 AND v_revision_text COLLATE "C" > '9223372036854775807' COLLATE "C") THEN
        RETURN 'record revision must be a non-negative 64-bit integer';
    END IF;
    IF NOT xacl_private.valid_iso_timestamp(p_record->'created_at')
       OR NOT xacl_private.valid_iso_timestamp(p_record->'updated_at') THEN
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
           OR xacl_private.object_key_count(v_annotation) <> 8
           OR NOT (v_annotation ?& ARRAY[
               'scores', 'objects', 'evidence', 'notes', 'flags',
               'reviewed_full_scope', 'status', 'updated_at'
           ]::text[]) THEN
            RETURN pg_catalog.format('annotation %s must contain exactly the supported annotation fields', v_sample_id);
        END IF;

        v_scores := v_annotation->'scores';
        IF pg_catalog.jsonb_typeof(v_scores) IS DISTINCT FROM 'object'
           OR xacl_private.object_key_count(v_scores) <> 8
           OR NOT (v_scores ?& ARRAY[
               'text_alignment', 'figure_alignment', 'table_alignment', 'equation_alignment',
               'structure_alignment', 'content_coverage', 'overall_alignment', 'visual_integrity'
           ]::text[]) THEN
            RETURN pg_catalog.format('annotation %s must contain all eight score fields', v_sample_id);
        END IF;

        FOR v_score_key IN
            SELECT pg_catalog.unnest(ARRAY[
                'text_alignment', 'figure_alignment', 'table_alignment', 'equation_alignment',
                'structure_alignment', 'content_coverage', 'overall_alignment', 'visual_integrity'
            ]::text[])
        LOOP
            v_score := v_scores->v_score_key;
            IF pg_catalog.jsonb_typeof(v_score) = 'null' THEN
                CONTINUE;
            ELSIF pg_catalog.jsonb_typeof(v_score) = 'number' THEN
                IF (v_score #>> '{}') !~ '^[1-5]$' THEN
                    RETURN pg_catalog.format('score %s must be an integer from 1 to 5', v_score_key);
                END IF;
            ELSIF pg_catalog.jsonb_typeof(v_score) = 'string' THEN
                IF v_score #>> '{}' = 'uncertain' THEN
                    CONTINUE;
                ELSIF v_score #>> '{}' = 'na' THEN
                    IF v_score_key NOT IN ('figure_alignment', 'table_alignment', 'equation_alignment') THEN
                        RETURN pg_catalog.format('N/A is not allowed for score %s', v_score_key);
                    END IF;
                ELSE
                    RETURN pg_catalog.format('score %s must be null, an integer from 1 to 5, na, or uncertain', v_score_key);
                END IF;
            ELSE
                RETURN pg_catalog.format('score %s must be null, an integer from 1 to 5, na, or uncertain', v_score_key);
            END IF;
        END LOOP;

        v_objects := v_annotation->'objects';
        IF pg_catalog.jsonb_typeof(v_objects) IS DISTINCT FROM 'object'
           OR xacl_private.object_key_count(v_objects) <> 3
           OR NOT (v_objects ?& ARRAY['figure', 'table', 'equation']::text[]) THEN
            RETURN pg_catalog.format('annotation %s must contain figure, table, and equation presence', v_sample_id);
        END IF;
        FOR v_object_type IN SELECT pg_catalog.unnest(ARRAY['figure', 'table', 'equation']::text[])
        LOOP
            v_pair := v_objects->v_object_type;
            IF pg_catalog.jsonb_typeof(v_pair) IS DISTINCT FROM 'object'
               OR xacl_private.object_key_count(v_pair) <> 2
               OR NOT (v_pair ?& ARRAY['compiled', 'official']::text[]) THEN
                RETURN pg_catalog.format('presence for %s must contain compiled and official', v_object_type);
            END IF;
            IF (pg_catalog.jsonb_typeof(v_pair->'compiled') IS DISTINCT FROM 'null'
                AND (pg_catalog.jsonb_typeof(v_pair->'compiled') IS DISTINCT FROM 'string'
                     OR v_pair->>'compiled' NOT IN ('present', 'absent', 'uncertain')))
               OR (pg_catalog.jsonb_typeof(v_pair->'official') IS DISTINCT FROM 'null'
                   AND (pg_catalog.jsonb_typeof(v_pair->'official') IS DISTINCT FROM 'string'
                        OR v_pair->>'official' NOT IN ('present', 'absent', 'uncertain'))) THEN
                RETURN pg_catalog.format('presence for %s must be null, present, absent, or uncertain', v_object_type);
            END IF;

            v_score := v_scores->(v_object_type || '_alignment');
            IF v_score = '"na"'::jsonb
               AND (v_pair->>'compiled' IS DISTINCT FROM 'absent'
                    OR v_pair->>'official' IS DISTINCT FROM 'absent') THEN
                RETURN pg_catalog.format('N/A for %s is valid only when both PDFs lack that object type', v_object_type);
            END IF;
        END LOOP;

        IF pg_catalog.jsonb_typeof(v_annotation->'evidence') IS DISTINCT FROM 'string'
           OR pg_catalog.length(v_annotation->>'evidence') > 12000 THEN
            RETURN 'evidence must be a string of at most 12,000 characters';
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation->'notes') IS DISTINCT FROM 'string'
           OR pg_catalog.length(v_annotation->>'notes') > 12000 THEN
            RETURN 'notes must be a string of at most 12,000 characters';
        END IF;
        v_flags := v_annotation->'flags';
        IF pg_catalog.jsonb_typeof(v_flags) IS DISTINCT FROM 'array' THEN
            RETURN 'flags must be an array of supported difference flags';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(v_flags) AS f(value)
            WHERE pg_catalog.jsonb_typeof(f.value) IS DISTINCT FROM 'string'
               OR f.value #>> '{}' NOT IN (
                   'critical_difference', 'appendix_difference', 'references_difference', 'rendering_problem'
               )
        ) THEN
            RETURN 'flags must be an array of supported difference flags';
        END IF;
        IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_flags))
           <> (SELECT pg_catalog.count(DISTINCT f.value) FROM pg_catalog.jsonb_array_elements(v_flags) AS f(value)) THEN
            RETURN 'flags may not contain duplicates';
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation->'reviewed_full_scope') IS DISTINCT FROM 'boolean' THEN
            RETURN 'reviewed_full_scope must be a boolean';
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation->'status') IS DISTINCT FROM 'string'
           OR v_annotation->>'status' NOT IN ('draft', 'completed') THEN
            RETURN 'status must be draft or completed';
        END IF;
        v_status := v_annotation->>'status';
        IF NOT xacl_private.valid_iso_timestamp(v_annotation->'updated_at') THEN
            RETURN 'annotation updated_at must be a valid ISO 8601 value with an explicit timezone';
        END IF;

        IF v_status = 'completed' THEN
            FOR v_score_key IN
                SELECT pg_catalog.unnest(ARRAY[
                    'text_alignment', 'figure_alignment', 'table_alignment', 'equation_alignment',
                    'structure_alignment', 'content_coverage', 'overall_alignment', 'visual_integrity'
                ]::text[])
            LOOP
                IF pg_catalog.jsonb_typeof(v_scores->v_score_key) = 'null' THEN
                    RETURN pg_catalog.format('completed annotation requires all eight scores (%s is missing)', v_score_key);
                END IF;
            END LOOP;
            IF v_annotation->>'reviewed_full_scope' <> 'true' THEN
                RETURN 'completed annotation requires reviewed_full_scope=true';
            END IF;

            FOR v_object_type IN SELECT pg_catalog.unnest(ARRAY['figure', 'table', 'equation']::text[])
            LOOP
                v_pair := v_objects->v_object_type;
                v_compiled := v_pair->>'compiled';
                v_official := v_pair->>'official';
                v_score := v_scores->(v_object_type || '_alignment');
                IF v_compiled IS NULL OR v_official IS NULL THEN
                    RETURN pg_catalog.format('completed annotation requires presence values for both PDFs (%s is missing)', v_object_type);
                END IF;
                IF v_compiled = 'absent' AND v_official = 'absent' AND v_score IS DISTINCT FROM '"na"'::jsonb THEN
                    RETURN pg_catalog.format('completed annotation must use N/A when both PDFs lack %s', v_object_type);
                END IF;
                IF ((v_compiled = 'present' AND v_official = 'absent')
                    OR (v_compiled = 'absent' AND v_official = 'present'))
                   AND v_score = '5'::jsonb THEN
                    RETURN pg_catalog.format('completed %s score cannot be 5 when only one PDF contains that content', v_object_type);
                END IF;
            END LOOP;

            v_needs_evidence := pg_catalog.jsonb_array_length(v_flags) > 0;
            FOR v_score_key IN
                SELECT pg_catalog.unnest(ARRAY[
                    'text_alignment', 'figure_alignment', 'table_alignment', 'equation_alignment',
                    'structure_alignment', 'content_coverage', 'overall_alignment', 'visual_integrity'
                ]::text[])
            LOOP
                v_score := v_scores->v_score_key;
                IF v_score = '"uncertain"'::jsonb
                   OR (pg_catalog.jsonb_typeof(v_score) = 'number' AND (v_score #>> '{}')::integer < 5) THEN
                    v_needs_evidence := true;
                END IF;
            END LOOP;
            FOR v_object_type IN SELECT pg_catalog.unnest(ARRAY['figure', 'table', 'equation']::text[])
            LOOP
                v_pair := v_objects->v_object_type;
                IF v_pair->>'compiled' = 'uncertain' OR v_pair->>'official' = 'uncertain' THEN
                    v_needs_evidence := true;
                END IF;
            END LOOP;
            IF v_needs_evidence AND pg_catalog.btrim(v_annotation->>'evidence') = '' THEN
                RETURN 'completed annotation requires evidence for scores below 5, uncertain scores or presence, or flags';
            END IF;
            IF v_flags ? 'critical_difference'
               AND v_scores->>'overall_alignment' NOT IN ('1', '2', 'uncertain') THEN
                RETURN 'critical_difference requires Overall 1–2 or uncertain';
            END IF;
        END IF;
    END LOOP;
    RETURN NULL;
END
$validate_annotation_record$;

CREATE OR REPLACE FUNCTION xacl_private.prevent_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $prevent_history_mutation$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'annotation history is append-only';
END
$prevent_history_mutation$;

CREATE OR REPLACE FUNCTION xacl_private.record_or_empty(
    p_study_id text,
    p_annotator_id text,
    p_dataset_id text,
    p_manifest_sha256 text,
    p_rubric_version text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $record_or_empty$
DECLARE
    v_record jsonb;
    v_timestamp text;
BEGIN
    SELECT r.current_record INTO v_record
    FROM xacl_private.annotation_records AS r
    WHERE r.study_id = p_study_id
      AND r.annotator_id COLLATE "C" = p_annotator_id COLLATE "C";
    IF FOUND THEN
        RETURN v_record;
    END IF;

    SELECT pg_catalog.to_char(
        p.created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) INTO v_timestamp
    FROM xacl_private.participants AS p
    WHERE p.study_id = p_study_id
      AND p.annotator_id COLLATE "C" = p_annotator_id COLLATE "C";
    IF NOT FOUND THEN
        RAISE EXCEPTION 'participant is missing while constructing its initial annotation record';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'schema', 'revisionlens.alignment-annotations.v1',
        'dataset_id', p_dataset_id,
        'manifest_sha256', p_manifest_sha256,
        'rubric_version', p_rubric_version,
        'annotator_id', p_annotator_id,
        'revision', 0,
        'created_at', v_timestamp,
        'updated_at', v_timestamp,
        'annotations', pg_catalog.jsonb_build_object()
    );
END
$record_or_empty$;

DROP TRIGGER IF EXISTS annotation_history_no_update_delete ON xacl_private.annotation_history;
CREATE TRIGGER annotation_history_no_update_delete
BEFORE UPDATE OR DELETE ON xacl_private.annotation_history
FOR EACH ROW EXECUTE FUNCTION xacl_private.prevent_history_mutation();

DROP TRIGGER IF EXISTS annotation_history_no_truncate ON xacl_private.annotation_history;
CREATE TRIGGER annotation_history_no_truncate
BEFORE TRUNCATE ON xacl_private.annotation_history
FOR EACH STATEMENT EXECUTE FUNCTION xacl_private.prevent_history_mutation();

CREATE OR REPLACE FUNCTION public.xacl_annotation_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_annotation_health$
DECLARE
    v_config xacl_private.study_config%ROWTYPE;
BEGIN
    SELECT c.* INTO v_config
    FROM xacl_private.study_config AS c
    WHERE c.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND
       OR v_config.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_config.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_config.rubric_version IS DISTINCT FROM 'alignment-rubric-v1'
       OR v_config.guidance_version IS DISTINCT FROM 'alignment-guidance-20261022-v2'
       OR v_config.guidance_sha256 IS DISTINCT FROM '7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3' THEN
        RETURN pg_catalog.jsonb_build_object('ready', false);
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'ready', true,
        'auth_mode', 'anonymous_recovery_v1',
        'dataset_id', v_config.dataset_id,
        'manifest_sha256', v_config.manifest_sha256,
        'rubric_version', v_config.rubric_version,
        'guidance_version', v_config.guidance_version,
        'guidance_sha256', v_config.guidance_sha256
    );
END
$xacl_annotation_health$;

CREATE OR REPLACE FUNCTION public.xacl_register_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_register_annotator$
DECLARE
    v_user_id uuid := auth.uid();
    v_digest bytea;
    v_stored_digest bytea;
    v_revoked_at timestamp with time zone;
    v_existing_id text;
    v_inserted_id text;
    v_config xacl_private.study_config%ROWTYPE;
    v_record jsonb;
BEGIN
    IF v_user_id IS NULL
       OR p_annotator_id IS NULL
       OR p_annotator_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
       OR p_recovery_code IS NULL
       OR p_recovery_code !~ '^[0-9a-f]{64}$' THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'invalid_access', 'message', 'A valid login, annotator ID, and recovery code are required.'
        );
    END IF;
    v_digest := extensions.digest(pg_catalog.convert_to(p_recovery_code, 'UTF8'), 'sha256');

    -- A per-user transaction lock makes concurrent first registrations for the
    -- same anonymous JWT deterministic; the primary key remains the final guard.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('revisionlens-alignment30-v1:' || v_user_id::text, 0)
    );

    SELECT c.* INTO v_config
    FROM xacl_private.study_config AS c
    WHERE c.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;

    SELECT s.annotator_id, p.recovery_code_sha256, p.revoked_at
    INTO v_existing_id, v_stored_digest, v_revoked_at
    FROM xacl_private.participant_sessions AS s
    JOIN xacl_private.participants AS p
      ON p.study_id = s.study_id AND p.annotator_id = s.annotator_id
    WHERE s.study_id = v_config.study_id AND s.user_id = v_user_id
    FOR UPDATE OF p;
    IF FOUND THEN
        IF v_existing_id COLLATE "C" <> p_annotator_id COLLATE "C" THEN
            RETURN pg_catalog.jsonb_build_object(
                'error', 'profile_exists', 'message', 'This login is already linked to an annotator profile.'
            );
        END IF;
        IF v_revoked_at IS NOT NULL THEN
            RETURN pg_catalog.jsonb_build_object(
                'error', 'invalid_access', 'message', 'Invalid annotator ID or recovery code.'
            );
        END IF;
        IF v_stored_digest IS DISTINCT FROM v_digest THEN
            RETURN pg_catalog.jsonb_build_object(
                'error', 'profile_exists', 'message', 'This login is already linked to an annotator profile.'
            );
        END IF;
        v_record := xacl_private.record_or_empty(
            v_config.study_id, v_existing_id, v_config.dataset_id,
            v_config.manifest_sha256, v_config.rubric_version
        );
        RETURN pg_catalog.jsonb_build_object('record', v_record);
    END IF;

    INSERT INTO xacl_private.participants (
        study_id, annotator_id, recovery_code_sha256
    ) VALUES (
        v_config.study_id, p_annotator_id, v_digest
    )
    ON CONFLICT (study_id, annotator_id) DO NOTHING
    RETURNING annotator_id INTO v_inserted_id;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'name_taken', 'message', 'That annotator ID is already in use.'
        );
    END IF;

    INSERT INTO xacl_private.participant_sessions (study_id, user_id, annotator_id)
    VALUES (v_config.study_id, v_user_id, p_annotator_id);

    v_record := xacl_private.record_or_empty(
        v_config.study_id, p_annotator_id, v_config.dataset_id,
        v_config.manifest_sha256, v_config.rubric_version
    );
    RETURN pg_catalog.jsonb_build_object('record', v_record);
END
$xacl_register_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_resume_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_resume_annotator$
DECLARE
    v_user_id uuid := auth.uid();
    v_digest bytea;
    v_stored_digest bytea;
    v_revoked_at timestamp with time zone;
    v_existing_id text;
    v_config xacl_private.study_config%ROWTYPE;
    v_record jsonb;
BEGIN
    IF v_user_id IS NULL
       OR p_annotator_id IS NULL
       OR p_annotator_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
       OR p_recovery_code IS NULL
       OR p_recovery_code !~ '^[0-9a-f]{64}$' THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'invalid_access', 'message', 'Invalid annotator ID or recovery code.'
        );
    END IF;
    v_digest := extensions.digest(pg_catalog.convert_to(p_recovery_code, 'UTF8'), 'sha256');
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('revisionlens-alignment30-v1:' || v_user_id::text, 0)
    );

    SELECT c.* INTO v_config
    FROM xacl_private.study_config AS c
    WHERE c.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;

    SELECT p.recovery_code_sha256, p.revoked_at
    INTO v_stored_digest, v_revoked_at
    FROM xacl_private.participants AS p
    WHERE p.study_id = 'revisionlens-alignment30-v1'
      AND p.annotator_id COLLATE "C" = p_annotator_id COLLATE "C"
    FOR UPDATE;
    IF NOT FOUND OR v_revoked_at IS NOT NULL OR v_stored_digest IS DISTINCT FROM v_digest THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'invalid_access', 'message', 'Invalid annotator ID or recovery code.'
        );
    END IF;

    SELECT s.annotator_id INTO v_existing_id
    FROM xacl_private.participant_sessions AS s
    WHERE s.study_id = 'revisionlens-alignment30-v1' AND s.user_id = v_user_id;
    IF FOUND AND v_existing_id COLLATE "C" <> p_annotator_id COLLATE "C" THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'profile_exists', 'message', 'This login is already linked to an annotator profile.'
        );
    END IF;
    IF NOT FOUND THEN
        INSERT INTO xacl_private.participant_sessions (study_id, user_id, annotator_id)
        VALUES ('revisionlens-alignment30-v1', v_user_id, p_annotator_id);
    END IF;

    v_record := xacl_private.record_or_empty(
        v_config.study_id, p_annotator_id, v_config.dataset_id,
        v_config.manifest_sha256, v_config.rubric_version
    );
    RETURN pg_catalog.jsonb_build_object('record', v_record);
END
$xacl_resume_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_current_annotations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_current_annotations$
DECLARE
    v_user_id uuid := auth.uid();
    v_annotator_id text;
    v_revoked_at timestamp with time zone;
    v_config xacl_private.study_config%ROWTYPE;
    v_record jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'invalid_access', 'message', 'A valid authenticated login is required.'
        );
    END IF;
    SELECT s.annotator_id, p.revoked_at
    INTO v_annotator_id, v_revoked_at
    FROM xacl_private.participant_sessions AS s
    JOIN xacl_private.participants AS p
      ON p.study_id = s.study_id AND p.annotator_id = s.annotator_id
    WHERE s.study_id = 'revisionlens-alignment30-v1' AND s.user_id = v_user_id
    FOR UPDATE OF p;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('record', NULL);
    END IF;
    IF v_revoked_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'invalid_access', 'message', 'This annotator profile is no longer active.'
        );
    END IF;

    SELECT c.* INTO v_config
    FROM xacl_private.study_config AS c
    WHERE c.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    v_record := xacl_private.record_or_empty(
        v_config.study_id, v_annotator_id, v_config.dataset_id,
        v_config.manifest_sha256, v_config.rubric_version
    );
    RETURN pg_catalog.jsonb_build_object('record', v_record);
END
$xacl_current_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_load_annotations(p_annotator_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_load_annotations$
DECLARE
    v_user_id uuid := auth.uid();
    v_revoked_at timestamp with time zone;
    v_config xacl_private.study_config%ROWTYPE;
    v_record jsonb;
BEGIN
    IF v_user_id IS NULL OR p_annotator_id IS NULL
       OR p_annotator_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'invalid_access', 'message', 'This login is not linked to that annotator profile.'
        );
    END IF;
    SELECT p.revoked_at INTO v_revoked_at
    FROM xacl_private.participant_sessions AS s
    JOIN xacl_private.participants AS p
      ON p.study_id = s.study_id AND p.annotator_id = s.annotator_id
    WHERE s.study_id = 'revisionlens-alignment30-v1'
      AND s.user_id = v_user_id
      AND s.annotator_id COLLATE "C" = p_annotator_id COLLATE "C"
    FOR UPDATE OF p;
    IF NOT FOUND OR v_revoked_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'invalid_access', 'message', 'This login is not linked to that annotator profile.'
        );
    END IF;

    SELECT c.* INTO v_config
    FROM xacl_private.study_config AS c
    WHERE c.study_id = 'revisionlens-alignment30-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    v_record := xacl_private.record_or_empty(
        v_config.study_id, p_annotator_id, v_config.dataset_id,
        v_config.manifest_sha256, v_config.rubric_version
    );
    RETURN pg_catalog.jsonb_build_object('record', v_record);
END
$xacl_load_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_save_annotations(
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
AS $xacl_save_annotations$
DECLARE
    v_user_id uuid := auth.uid();
    v_revoked_at timestamp with time zone;
    v_config xacl_private.study_config%ROWTYPE;
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
    IF v_user_id IS NULL OR p_annotator_id IS NULL
       OR p_annotator_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'invalid_access', 'message', 'This login is not linked to that annotator profile.'
        );
    END IF;

    -- Locking the participant row serializes writes from every device linked by
    -- the same recovery code, including the initial revision-0 save.
    SELECT p.revoked_at INTO v_revoked_at
    FROM xacl_private.participant_sessions AS s
    JOIN xacl_private.participants AS p
      ON p.study_id = s.study_id AND p.annotator_id = s.annotator_id
    WHERE s.study_id = 'revisionlens-alignment30-v1'
      AND s.user_id = v_user_id
      AND s.annotator_id COLLATE "C" = p_annotator_id COLLATE "C"
    FOR UPDATE OF p;
    IF NOT FOUND OR v_revoked_at IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'invalid_access', 'message', 'This login is not linked to that annotator profile.'
        );
    END IF;

    SELECT c.* INTO v_config
    FROM xacl_private.study_config AS c
    WHERE c.study_id = 'revisionlens-alignment30-v1';
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

    v_validation_error := xacl_private.validate_annotation_record(
        p_record,
        p_annotator_id,
        v_config.dataset_id,
        v_config.manifest_sha256,
        v_config.rubric_version
    );
    IF v_validation_error IS NOT NULL THEN
        IF v_validation_error LIKE 'record study, manifest, or rubric%' THEN
            RETURN pg_catalog.jsonb_build_object('error', 'study_mismatch', 'message', v_validation_error);
        END IF;
        RETURN pg_catalog.jsonb_build_object('error', 'invalid_record', 'message', v_validation_error);
    END IF;

    SELECT a.revision, a.current_record
    INTO v_current_revision, v_current_record
    FROM xacl_private.annotation_records AS a
    WHERE a.study_id = v_config.study_id
      AND a.annotator_id COLLATE "C" = p_annotator_id COLLATE "C"
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
    IF v_current_revision = 9223372036854775807 THEN
        RETURN pg_catalog.jsonb_build_object('error', 'revision_exhausted');
    END IF;

    v_saved_at := pg_catalog.clock_timestamp();
    v_saved_at_text := pg_catalog.to_char(
        v_saved_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    IF v_has_current THEN
        v_created_at := v_current_record->>'created_at';
    ELSE
        SELECT pg_catalog.to_char(
            p.created_at AT TIME ZONE 'UTC',
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

    INSERT INTO xacl_private.annotation_records (
        study_id, annotator_id, revision, current_record,
        guidance_version, guidance_sha256, saved_at
    ) VALUES (
        v_config.study_id, p_annotator_id, v_new_revision, v_saved_record,
        v_config.guidance_version, v_config.guidance_sha256, v_saved_at
    )
    ON CONFLICT (study_id, annotator_id) DO UPDATE
       SET revision = EXCLUDED.revision,
           current_record = EXCLUDED.current_record,
           guidance_version = EXCLUDED.guidance_version,
           guidance_sha256 = EXCLUDED.guidance_sha256,
           saved_at = EXCLUDED.saved_at;

    INSERT INTO xacl_private.annotation_history (
        study_id, annotator_id, revision, full_record,
        guidance_version, guidance_sha256, operation, saved_at
    ) VALUES (
        v_config.study_id, p_annotator_id, v_new_revision, v_saved_record,
        v_config.guidance_version, v_config.guidance_sha256, p_operation, v_saved_at
    );

    RETURN pg_catalog.jsonb_build_object(
        'record', v_saved_record,
        'saved_at', v_saved_at_text
    );
END
$xacl_save_annotations$;

-- No table or helper access is granted to web roles. Only the health endpoint
-- is public; all profile and annotation RPCs require an authenticated anon JWT.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_annotation_health() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_register_annotator(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_resume_annotator(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_current_annotations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_load_annotations(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_save_annotations(text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.xacl_annotation_health() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_register_annotator(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_resume_annotator(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_current_annotations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_load_annotations(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_save_annotations(text, jsonb, text, text, text) TO authenticated;

-- Refresh PostgREST's function catalog after this transaction commits.
NOTIFY pgrst, 'reload schema';

COMMIT;
