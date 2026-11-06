-- Isolated low-score follow-up annotation protocol for 49 papers.
-- Requires migrations 001-005 in the same Supabase project.
-- Reuses participant identity/recovery while storing results under a separate
-- protocol and dataset. Existing records and history are not migrated or reset.

BEGIN;

DO $followup49_prerequisites$
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
    IF pg_catalog.to_regprocedure('xacl_private.quality_record_or_empty(text,text,text)') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'xacl_private.quality_record_or_empty(text,text,text)');
    END IF;
    IF pg_catalog.to_regprocedure('xacl_private.quality_object_key_count(jsonb)') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'xacl_private.quality_object_key_count(jsonb)');
    END IF;
    IF pg_catalog.to_regprocedure('xacl_private.quality_valid_iso_timestamp(jsonb)') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'xacl_private.quality_valid_iso_timestamp(jsonb)');
    END IF;
    IF pg_catalog.to_regprocedure('public.xacl_register_annotator(text,text)') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'public.xacl_register_annotator(text,text)');
    END IF;
    IF pg_catalog.to_regprocedure('public.xacl_resume_annotator(text,text)') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'public.xacl_resume_annotator(text,text)');
    END IF;
    IF pg_catalog.to_regprocedure('public.xacl_current_annotations()') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'public.xacl_current_annotations()');
    END IF;
    IF pg_catalog.to_regprocedure('public.xacl_load_annotations(text)') IS NULL THEN
        v_missing := pg_catalog.array_append(v_missing, 'public.xacl_load_annotations(text)');
    END IF;
    IF pg_catalog.cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'latex-data-usability-followup49-v1 requires migrations 001-005 and their shared helpers; missing: '
                || pg_catalog.array_to_string(v_missing, ', '),
            HINT = 'Verify the active project has migrations 001-005 installed. This migration does not repair or replace earlier setup migrations.';
    END IF;
END
$followup49_prerequisites$;

REVOKE ALL ON SCHEMA xacl_private FROM PUBLIC, anon, authenticated, service_role;

DO $followup49_base_assert$
DECLARE
    v_study xacl_private.study_config%ROWTYPE;
    v_base xacl_private.quality_protocol_config%ROWTYPE;
    v_existing xacl_private.quality_protocol_config%ROWTYPE;
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
        RAISE EXCEPTION 'The frozen xACL-Era participant study differs from the follow-up protocol prerequisites';
    END IF;

    SELECT q.* INTO v_base
    FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-data-usability-v1';
    IF NOT FOUND
       OR v_base.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_base.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_base.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_base.record_schema IS DISTINCT FROM 'xacl.latex-data-usability-annotations.v1'
       OR v_base.rubric_version IS DISTINCT FROM 'latex-data-usability-rubric-v1'
       OR v_base.rubric_sha256 IS DISTINCT FROM '25936187e5e55acdc4783b6cf597b7792fba7efe3ea4a093e03c40caaf0e86c0'
       OR v_base.guidance_version IS DISTINCT FROM 'latex-data-usability-guidance-20261104-v1'
       OR v_base.guidance_sha256 IS DISTINCT FROM '37ea7993b18649afdc5491be3a54cc9914c9bc0d1901cbff58ce5803deee7468' THEN
        RAISE EXCEPTION 'The existing data-usability protocol differs from the pinned shared rubric and participant configuration';
    END IF;

    SELECT q.* INTO v_existing
    FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-data-usability-followup49-v1';
    IF FOUND AND (
        v_existing.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
        OR v_existing.dataset_id IS DISTINCT FROM 'revisionlens-low-score49-v1'
        OR v_existing.manifest_sha256 IS DISTINCT FROM '52cc838fe1e2ad4dc1f5b40beb972913492902cacdc8edae206fc2c1606d652f'
        OR v_existing.record_schema IS DISTINCT FROM 'xacl.low-score-followup-annotations.v1'
        OR v_existing.rubric_version IS DISTINCT FROM 'latex-data-usability-rubric-v1'
        OR v_existing.rubric_sha256 IS DISTINCT FROM '25936187e5e55acdc4783b6cf597b7792fba7efe3ea4a093e03c40caaf0e86c0'
        OR v_existing.guidance_version IS DISTINCT FROM 'low-score-followup-guidance-v1'
        OR v_existing.guidance_sha256 IS DISTINCT FROM 'e5d3da508ae113a86114ba365c8fca3878d2fbe5f7f0efa26a1a6efa56ef218d'
    ) THEN
        RAISE EXCEPTION 'The installed follow-up protocol configuration conflicts with the pinned manifest or rubric';
    END IF;
END
$followup49_base_assert$;

-- Permit exactly this second dataset under the original participant study.
-- All other protocol rows must continue to use dataset_id = study_id.
ALTER TABLE xacl_private.quality_protocol_config
    DROP CONSTRAINT IF EXISTS quality_protocol_config_dataset_matches_study;
ALTER TABLE xacl_private.quality_protocol_config
    ADD CONSTRAINT quality_protocol_config_dataset_matches_study CHECK (
        dataset_id = study_id
        OR (
            protocol_id = 'latex-data-usability-followup49-v1'
            AND study_id = 'revisionlens-alignment30-v1'
            AND dataset_id = 'revisionlens-low-score49-v1'
        )
    );

INSERT INTO xacl_private.quality_protocol_config (
    protocol_id, study_id, dataset_id, manifest_sha256, record_schema,
    rubric_version, rubric_sha256, guidance_version, guidance_sha256
) VALUES (
    'latex-data-usability-followup49-v1',
    'revisionlens-alignment30-v1',
    'revisionlens-low-score49-v1',
    '52cc838fe1e2ad4dc1f5b40beb972913492902cacdc8edae206fc2c1606d652f',
    'xacl.low-score-followup-annotations.v1',
    'latex-data-usability-rubric-v1',
    '25936187e5e55acdc4783b6cf597b7792fba7efe3ea4a093e03c40caaf0e86c0',
    'low-score-followup-guidance-v1',
    'e5d3da508ae113a86114ba365c8fca3878d2fbe5f7f0efa26a1a6efa56ef218d'
)
ON CONFLICT (protocol_id) DO NOTHING;

DO $followup49_config_assert$
DECLARE
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT q.* INTO v_config
    FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-data-usability-followup49-v1'
    FOR UPDATE;
    IF NOT FOUND
       OR v_config.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_config.dataset_id IS DISTINCT FROM 'revisionlens-low-score49-v1'
       OR v_config.manifest_sha256 IS DISTINCT FROM '52cc838fe1e2ad4dc1f5b40beb972913492902cacdc8edae206fc2c1606d652f'
       OR v_config.record_schema IS DISTINCT FROM 'xacl.low-score-followup-annotations.v1'
       OR v_config.rubric_version IS DISTINCT FROM 'latex-data-usability-rubric-v1'
       OR v_config.rubric_sha256 IS DISTINCT FROM '25936187e5e55acdc4783b6cf597b7792fba7efe3ea4a093e03c40caaf0e86c0'
       OR v_config.guidance_version IS DISTINCT FROM 'low-score-followup-guidance-v1'
       OR v_config.guidance_sha256 IS DISTINCT FROM 'e5d3da508ae113a86114ba365c8fca3878d2fbe5f7f0efa26a1a6efa56ef218d' THEN
        RAISE EXCEPTION 'Follow-up protocol configuration differs from its frozen manifest and rubric';
    END IF;
END
$followup49_config_assert$;

CREATE TABLE IF NOT EXISTS xacl_private.followup49_issue_allowlist (
    protocol_id text COLLATE "C" NOT NULL DEFAULT 'latex-data-usability-followup49-v1'
        CHECK (protocol_id = 'latex-data-usability-followup49-v1'),
    study_id text COLLATE "C" NOT NULL DEFAULT 'revisionlens-alignment30-v1'
        CHECK (study_id = 'revisionlens-alignment30-v1'),
    sample_id text COLLATE "C" NOT NULL CHECK (sample_id ~ '^J[0-9]{3}$'),
    issue_id text COLLATE "C" NOT NULL CHECK (issue_id IN (
        'text_integrity_readability', 'document_structural_integrity',
        'nontext_asset_integrity', 'overall_data_usability',
        'pdf_visual_integrity', 'page_9_coverage'
    )),
    PRIMARY KEY (protocol_id, sample_id, issue_id),
    FOREIGN KEY (protocol_id, study_id)
        REFERENCES xacl_private.quality_protocol_config (protocol_id, study_id) ON DELETE RESTRICT
);

ALTER TABLE xacl_private.followup49_issue_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE xacl_private.followup49_issue_allowlist FROM PUBLIC, anon, authenticated, service_role;

CREATE TEMPORARY TABLE _followup49_expected_issues (
    sample_id text COLLATE "C" NOT NULL,
    issue_id text COLLATE "C" NOT NULL,
    PRIMARY KEY (sample_id, issue_id)
) ON COMMIT DROP;

INSERT INTO _followup49_expected_issues (sample_id, issue_id) VALUES
    ('J007', 'pdf_visual_integrity'),
    ('J007', 'page_9_coverage'),
    ('J015', 'pdf_visual_integrity'),
    ('J026', 'pdf_visual_integrity'),
    ('J028', 'pdf_visual_integrity'),
    ('J054', 'pdf_visual_integrity'),
    ('J054', 'page_9_coverage'),
    ('J056', 'document_structural_integrity'),
    ('J056', 'pdf_visual_integrity'),
    ('J056', 'page_9_coverage'),
    ('J081', 'pdf_visual_integrity'),
    ('J081', 'page_9_coverage'),
    ('J087', 'pdf_visual_integrity'),
    ('J087', 'page_9_coverage'),
    ('J106', 'pdf_visual_integrity'),
    ('J125', 'pdf_visual_integrity'),
    ('J125', 'page_9_coverage'),
    ('J157', 'pdf_visual_integrity'),
    ('J157', 'page_9_coverage'),
    ('J185', 'pdf_visual_integrity'),
    ('J185', 'page_9_coverage'),
    ('J194', 'pdf_visual_integrity'),
    ('J203', 'pdf_visual_integrity'),
    ('J203', 'page_9_coverage'),
    ('J205', 'nontext_asset_integrity'),
    ('J205', 'pdf_visual_integrity'),
    ('J229', 'pdf_visual_integrity'),
    ('J246', 'pdf_visual_integrity'),
    ('J246', 'page_9_coverage'),
    ('J262', 'nontext_asset_integrity'),
    ('J311', 'pdf_visual_integrity'),
    ('J323', 'pdf_visual_integrity'),
    ('J338', 'pdf_visual_integrity'),
    ('J338', 'page_9_coverage'),
    ('J363', 'nontext_asset_integrity'),
    ('J363', 'pdf_visual_integrity'),
    ('J427', 'pdf_visual_integrity'),
    ('J429', 'nontext_asset_integrity'),
    ('J472', 'pdf_visual_integrity'),
    ('J480', 'pdf_visual_integrity'),
    ('J556', 'pdf_visual_integrity'),
    ('J561', 'nontext_asset_integrity'),
    ('J591', 'nontext_asset_integrity'),
    ('J042', 'pdf_visual_integrity'),
    ('J045', 'pdf_visual_integrity'),
    ('J047', 'pdf_visual_integrity'),
    ('J063', 'pdf_visual_integrity'),
    ('J075', 'pdf_visual_integrity'),
    ('J086', 'pdf_visual_integrity'),
    ('J099', 'pdf_visual_integrity'),
    ('J114', 'pdf_visual_integrity'),
    ('J132', 'pdf_visual_integrity'),
    ('J152', 'pdf_visual_integrity'),
    ('J156', 'pdf_visual_integrity'),
    ('J191', 'pdf_visual_integrity'),
    ('J192', 'pdf_visual_integrity'),
    ('J243', 'pdf_visual_integrity'),
    ('J248', 'pdf_visual_integrity'),
    ('J252', 'pdf_visual_integrity'),
    ('J282', 'pdf_visual_integrity'),
    ('J330', 'pdf_visual_integrity'),
    ('J468', 'pdf_visual_integrity'),
    ('J549', 'pdf_visual_integrity');

INSERT INTO xacl_private.followup49_issue_allowlist (sample_id, issue_id)
SELECT sample_id, issue_id FROM _followup49_expected_issues
ON CONFLICT (protocol_id, sample_id, issue_id) DO NOTHING;

DO $followup49_allowlist_assert$
BEGIN
    IF (SELECT pg_catalog.count(DISTINCT sample_id) FROM _followup49_expected_issues) <> 49
       OR (SELECT pg_catalog.count(*) FROM _followup49_expected_issues) <> 63 THEN
        RAISE EXCEPTION 'Embedded follow-up issue allowlist must contain exactly 49 papers and 63 findings';
    END IF;
    IF EXISTS (
        SELECT sample_id, issue_id FROM _followup49_expected_issues
        EXCEPT
        SELECT sample_id, issue_id FROM xacl_private.followup49_issue_allowlist
        WHERE protocol_id = 'latex-data-usability-followup49-v1'
    ) OR EXISTS (
        SELECT sample_id, issue_id FROM xacl_private.followup49_issue_allowlist
        WHERE protocol_id = 'latex-data-usability-followup49-v1'
        EXCEPT
        SELECT sample_id, issue_id FROM _followup49_expected_issues
    ) THEN
        RAISE EXCEPTION 'Stored follow-up issue allowlist differs from the manifest-pinned issue keys';
    END IF;
END
$followup49_allowlist_assert$;

CREATE OR REPLACE FUNCTION xacl_private.validate_followup49_annotation_record(
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
STABLE
SET search_path = ''
AS $validate_followup49_annotation_record$
DECLARE
    v_annotations jsonb;
    v_annotation jsonb;
    v_findings jsonb;
    v_finding jsonb;
    v_sample_id text;
    v_issue_id text;
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
        RETURN 'record dataset, manifest, or rubric does not match this frozen follow-up';
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
        RETURN 'record annotations must be an object keyed by follow-up paper ID';
    END IF;
    FOR v_sample_id, v_annotation IN
        SELECT e.key, e.value FROM pg_catalog.jsonb_each(v_annotations) AS e(key, value)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM xacl_private.followup49_issue_allowlist AS a
            WHERE a.protocol_id = 'latex-data-usability-followup49-v1'
              AND a.sample_id COLLATE "C" = v_sample_id COLLATE "C"
        ) THEN
            RETURN pg_catalog.format('record contains an unknown follow-up paper ID: %s', v_sample_id);
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation) IS DISTINCT FROM 'object'
           OR xacl_private.quality_object_key_count(v_annotation) <> 3
           OR NOT (v_annotation ?& ARRAY['status', 'updated_at', 'findings']::text[]) THEN
            RETURN pg_catalog.format('annotation %s must contain exactly status, updated_at, and findings', v_sample_id);
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation->'updated_at') IS DISTINCT FROM 'string'
           OR NOT xacl_private.quality_valid_iso_timestamp(v_annotation->'updated_at') THEN
            RETURN pg_catalog.format('annotation %s updated_at must be a valid ISO 8601 value with an explicit timezone', v_sample_id);
        END IF;
        IF pg_catalog.jsonb_typeof(v_annotation->'status') IS DISTINCT FROM 'string'
           OR v_annotation->>'status' NOT IN ('draft', 'completed') THEN
            RETURN pg_catalog.format('annotation %s status must be draft or completed', v_sample_id);
        END IF;
        v_status := v_annotation->>'status';
        v_findings := v_annotation->'findings';
        IF pg_catalog.jsonb_typeof(v_findings) IS DISTINCT FROM 'object' THEN
            RETURN pg_catalog.format('annotation %s findings must be an object keyed by assigned issue ID', v_sample_id);
        END IF;
        FOR v_issue_id, v_finding IN
            SELECT e.key, e.value FROM pg_catalog.jsonb_each(v_findings) AS e(key, value)
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM xacl_private.followup49_issue_allowlist AS a
                WHERE a.protocol_id = 'latex-data-usability-followup49-v1'
                  AND a.sample_id COLLATE "C" = v_sample_id COLLATE "C"
                  AND a.issue_id COLLATE "C" = v_issue_id COLLATE "C"
            ) THEN
                RETURN pg_catalog.format('annotation %s contains an unknown issue ID: %s', v_sample_id, v_issue_id);
            END IF;
            IF pg_catalog.jsonb_typeof(v_finding) IS DISTINCT FROM 'object'
               OR xacl_private.quality_object_key_count(v_finding) <> 3
               OR NOT (v_finding ?& ARRAY['verdict', 'category', 'note']::text[]) THEN
                RETURN pg_catalog.format('finding %s/%s must contain exactly verdict, category, and note', v_sample_id, v_issue_id);
            END IF;
            IF pg_catalog.jsonb_typeof(v_finding->'verdict') IS DISTINCT FROM 'string'
               OR v_finding->>'verdict' NOT IN ('confirmed', 'not_found', 'insufficient_evidence') THEN
                RETURN pg_catalog.format('finding %s/%s has an unsupported verdict', v_sample_id, v_issue_id);
            END IF;
            IF pg_catalog.jsonb_typeof(v_finding->'category') = 'null' THEN
                NULL;
            ELSIF pg_catalog.jsonb_typeof(v_finding->'category') = 'string'
               AND v_finding->>'category' IN (
                   'source_content', 'pdf_rendering', 'outside_window',
                   'coverage_uncertain', 'other'
               ) THEN
                NULL;
            ELSE
                RETURN pg_catalog.format('finding %s/%s has an unsupported category', v_sample_id, v_issue_id);
            END IF;
            IF pg_catalog.jsonb_typeof(v_finding->'note') IS DISTINCT FROM 'string'
               OR pg_catalog.length(v_finding->>'note') > 2000 THEN
                RETURN pg_catalog.format('finding %s/%s note must be a string of at most 2,000 characters', v_sample_id, v_issue_id);
            END IF;
        END LOOP;
        IF v_status = 'completed' AND EXISTS (
            SELECT 1
            FROM xacl_private.followup49_issue_allowlist AS a
            WHERE a.protocol_id = 'latex-data-usability-followup49-v1'
              AND a.sample_id COLLATE "C" = v_sample_id COLLATE "C"
              AND NOT (v_findings ? a.issue_id)
        ) THEN
            RETURN pg_catalog.format('completed annotation %s requires a finding for every assigned issue', v_sample_id);
        END IF;
    END LOOP;
    RETURN NULL;
END
$validate_followup49_annotation_record$;

CREATE OR REPLACE FUNCTION public.xacl_followup49_annotation_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_followup49_annotation_health$
DECLARE
    v_protocol xacl_private.quality_protocol_config%ROWTYPE;
    v_study xacl_private.study_config%ROWTYPE;
    v_allowlist_sha256 text;
BEGIN
    SELECT q.* INTO v_protocol
    FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-data-usability-followup49-v1';
    SELECT s.* INTO v_study
    FROM xacl_private.study_config AS s
    WHERE s.study_id = 'revisionlens-alignment30-v1';
    SELECT pg_catalog.encode(
        extensions.digest(
            COALESCE(
                pg_catalog.string_agg(
                    a.sample_id || E'\t' || a.issue_id,
                    E'\n' ORDER BY a.sample_id COLLATE "C", a.issue_id COLLATE "C"
                ),
                ''
            ),
            'sha256'
        ),
        'hex'
    ) INTO v_allowlist_sha256
    FROM xacl_private.followup49_issue_allowlist AS a
    WHERE a.protocol_id = 'latex-data-usability-followup49-v1';
    IF NOT FOUND
       OR v_protocol.study_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_protocol.dataset_id IS DISTINCT FROM 'revisionlens-low-score49-v1'
       OR v_protocol.manifest_sha256 IS DISTINCT FROM '52cc838fe1e2ad4dc1f5b40beb972913492902cacdc8edae206fc2c1606d652f'
       OR v_protocol.record_schema IS DISTINCT FROM 'xacl.low-score-followup-annotations.v1'
       OR v_protocol.rubric_version IS DISTINCT FROM 'latex-data-usability-rubric-v1'
       OR v_protocol.rubric_sha256 IS DISTINCT FROM '25936187e5e55acdc4783b6cf597b7792fba7efe3ea4a093e03c40caaf0e86c0'
       OR v_protocol.guidance_version IS DISTINCT FROM 'low-score-followup-guidance-v1'
       OR v_protocol.guidance_sha256 IS DISTINCT FROM 'e5d3da508ae113a86114ba365c8fca3878d2fbe5f7f0efa26a1a6efa56ef218d'
       OR v_study.dataset_id IS DISTINCT FROM 'revisionlens-alignment30-v1'
       OR v_study.manifest_sha256 IS DISTINCT FROM 'd60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071'
       OR v_study.rubric_version IS DISTINCT FROM 'alignment-rubric-v1'
       OR v_study.guidance_version IS DISTINCT FROM 'alignment-guidance-20261024-v4'
       OR v_study.guidance_sha256 IS DISTINCT FROM 'a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c'
       OR v_allowlist_sha256 IS DISTINCT FROM '9049828e0c921203c367d37fa1fa61fc3b6ed3ec5d0b54e7d4de4b8a25e9f30d'
       OR (SELECT pg_catalog.count(DISTINCT sample_id) FROM xacl_private.followup49_issue_allowlist
           WHERE protocol_id = 'latex-data-usability-followup49-v1') <> 49
       OR (SELECT pg_catalog.count(*) FROM xacl_private.followup49_issue_allowlist
           WHERE protocol_id = 'latex-data-usability-followup49-v1') <> 63 THEN
        RETURN pg_catalog.jsonb_build_object('ready', false);
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'ready', true,
        'auth_mode', 'anonymous_recovery_v1',
        'study_id', v_protocol.study_id,
        'dataset_id', v_protocol.dataset_id,
        'manifest_sha256', v_protocol.manifest_sha256,
        'rubric_version', v_protocol.rubric_version,
        'rubric_sha256', v_protocol.rubric_sha256,
        'guidance_version', v_protocol.guidance_version,
        'guidance_sha256', v_protocol.guidance_sha256,
        'protocol_id', v_protocol.protocol_id,
        'record_schema', v_protocol.record_schema
    );
END
$xacl_followup49_annotation_health$;

CREATE OR REPLACE FUNCTION public.xacl_followup49_register_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_followup49_register_annotator$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-data-usability-followup49-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    v_legacy := public.xacl_register_annotator(p_annotator_id, p_recovery_code);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_followup49_register_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_followup49_resume_annotator(
    p_annotator_id text,
    p_recovery_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_followup49_resume_annotator$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-data-usability-followup49-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    v_legacy := public.xacl_resume_annotator(p_annotator_id, p_recovery_code);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_followup49_resume_annotator$;

CREATE OR REPLACE FUNCTION public.xacl_followup49_current_annotations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_followup49_current_annotations$
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
    WHERE q.protocol_id = 'latex-data-usability-followup49-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, v_annotator_id
        )
    );
END
$xacl_followup49_current_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_followup49_load_annotations(p_annotator_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $xacl_followup49_load_annotations$
DECLARE
    v_legacy jsonb;
    v_config xacl_private.quality_protocol_config%ROWTYPE;
BEGIN
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-data-usability-followup49-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;
    v_legacy := public.xacl_load_annotations(p_annotator_id);
    IF v_legacy ? 'error' OR NOT (v_legacy ? 'record') THEN
        RETURN v_legacy;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'record', xacl_private.quality_record_or_empty(
            v_config.protocol_id, v_config.study_id, p_annotator_id
        )
    );
END
$xacl_followup49_load_annotations$;

CREATE OR REPLACE FUNCTION public.xacl_followup49_save_annotations(
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
AS $xacl_followup49_save_annotations$
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
    SELECT q.* INTO v_config FROM xacl_private.quality_protocol_config AS q
    WHERE q.protocol_id = 'latex-data-usability-followup49-v1';
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('error', 'study_not_ready');
    END IF;

    v_authorization := public.xacl_load_annotations(p_annotator_id);
    IF v_authorization ? 'error' OR NOT (v_authorization ? 'record') THEN
        RETURN v_authorization;
    END IF;
    IF p_guidance_version IS DISTINCT FROM v_config.guidance_version
       OR p_guidance_sha256 IS DISTINCT FROM v_config.guidance_sha256 THEN
        RETURN pg_catalog.jsonb_build_object(
            'error', 'study_mismatch', 'message', 'The follow-up guidance does not match this frozen protocol.'
        );
    END IF;
    IF p_operation IS NULL OR p_operation NOT IN ('save', 'import') THEN
        RETURN pg_catalog.jsonb_build_object('error', 'invalid_operation');
    END IF;
    v_validation_error := xacl_private.validate_followup49_annotation_record(
        p_record, p_annotator_id, v_config.protocol_id, v_config.dataset_id,
        v_config.manifest_sha256, v_config.record_schema, v_config.rubric_version
    );
    IF v_validation_error IS NOT NULL THEN
        IF v_validation_error LIKE 'record schema or protocol%'
           OR v_validation_error LIKE 'record dataset, manifest, or rubric%' THEN
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
$xacl_followup49_save_annotations$;

REVOKE ALL ON FUNCTION xacl_private.validate_followup49_annotation_record(jsonb,text,text,text,text,text,text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_followup49_annotation_health()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_followup49_register_annotator(text,text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_followup49_resume_annotator(text,text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_followup49_current_annotations()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_followup49_load_annotations(text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.xacl_followup49_save_annotations(text,jsonb,text,text,text)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.xacl_followup49_annotation_health() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_followup49_register_annotator(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_followup49_resume_annotator(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_followup49_current_annotations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_followup49_load_annotations(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.xacl_followup49_save_annotations(text,jsonb,text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
