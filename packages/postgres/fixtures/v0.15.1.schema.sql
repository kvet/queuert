-- Frozen schema of queuert v0.15.1 (migrations 20240101000000_initial_schema .. 20260617000000_blocker_composite_pk).
-- Generated from the migration definitions that shipped in v0.15.1; see fixtures/README.md.

CREATE TABLE IF NOT EXISTS public.queuert_migration (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20240101000000_initial_schema
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'queuert_job_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.queuert_job_status AS ENUM ('blocked','pending','running','completed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.queuert_job (
  id                            uuid PRIMARY KEY,
  type_name                     text NOT NULL,
  chain_id                      uuid NOT NULL REFERENCES public.queuert_job(id),
  chain_type_name               text NOT NULL,
  chain_index                   integer NOT NULL,

  input                         jsonb,
  output                        jsonb,

  -- state
  status                        public.queuert_job_status NOT NULL DEFAULT 'pending',
  created_at                    timestamptz NOT NULL DEFAULT now(),
  scheduled_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                  timestamptz,
  completed_by                  text,

  -- attempts
  attempt                       integer NOT NULL DEFAULT 0,
  last_attempt_at               timestamptz,
  last_attempt_error            jsonb,

  -- leasing
  leased_by                     text,
  leased_until                  timestamptz,

  -- deduplication
  deduplication_key             text,

  -- tracing
  chain_trace_context           text,
  trace_context                 text
);

CREATE TABLE IF NOT EXISTS public.queuert_job_blocker (
  job_id                        uuid NOT NULL REFERENCES public.queuert_job(id),
  blocked_by_chain_id           uuid NOT NULL REFERENCES public.queuert_job(id),
  index                         integer NOT NULL,
  trace_context                 text,
  PRIMARY KEY (job_id, blocked_by_chain_id)
);

CREATE INDEX IF NOT EXISTS queuert_job_acquisition_idx
ON public.queuert_job (type_name, scheduled_at)
WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS queuert_job_chain_index_idx
ON public.queuert_job (chain_id, chain_index);

CREATE INDEX IF NOT EXISTS queuert_job_deduplication_idx
ON public.queuert_job (deduplication_key, created_at DESC)
WHERE deduplication_key IS NOT NULL AND chain_index = 0;

CREATE INDEX IF NOT EXISTS queuert_job_expired_lease_idx
ON public.queuert_job (type_name, leased_until)
WHERE status = 'running' AND leased_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS queuert_job_blocker_chain_idx
ON public.queuert_job_blocker (blocked_by_chain_id);

CREATE INDEX IF NOT EXISTS queuert_job_chain_listing_idx
ON public.queuert_job (created_at DESC) WHERE chain_index = 0;

CREATE INDEX IF NOT EXISTS queuert_job_listing_idx
ON public.queuert_job (created_at DESC);

CREATE INDEX IF NOT EXISTS queuert_job_listing_status_idx
ON public.queuert_job (status, created_at DESC);

CREATE INDEX IF NOT EXISTS queuert_job_listing_type_name_idx
ON public.queuert_job (type_name, created_at DESC);

CREATE INDEX IF NOT EXISTS queuert_job_chain_listing_type_name_idx
ON public.queuert_job (type_name, created_at DESC) WHERE chain_index = 0;

-- 20240102000000_vacuum_tuning
ALTER TABLE public.queuert_job SET (
  fillfactor = 75,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay = 0
);

ALTER TABLE public.queuert_job_blocker SET (
  autovacuum_vacuum_cost_delay = 0
);

-- 20260430000000_rename_chain_indexes
ALTER INDEX IF EXISTS public.queuert_job_chain_index_idx
RENAME TO queuert_chain_index_idx;

ALTER INDEX IF EXISTS public.queuert_job_chain_listing_idx
RENAME TO queuert_chain_listing_idx;

ALTER INDEX IF EXISTS public.queuert_job_chain_listing_type_name_idx
RENAME TO queuert_chain_listing_type_name_idx;

-- 20260517000000_drop_job_id_default
ALTER TABLE public.queuert_job ALTER COLUMN id DROP DEFAULT;

-- 20260531000000_vacuum_threshold_pinning
ALTER TABLE public.queuert_job SET (
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
);

ALTER TABLE public.queuert_job_blocker SET (
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_analyze_scale_factor = 0
);

-- 20260617000000_blocker_composite_pk
ALTER TABLE public.queuert_job_blocker
  DROP CONSTRAINT queuert_job_blocker_pkey,
  ADD PRIMARY KEY (job_id, blocked_by_chain_id, "index");

INSERT INTO public.queuert_migration (name) VALUES
  ('20240101000000_initial_schema'),
  ('20240102000000_vacuum_tuning'),
  ('20260430000000_rename_chain_indexes'),
  ('20260517000000_drop_job_id_default'),
  ('20260531000000_vacuum_threshold_pinning'),
  ('20260617000000_blocker_composite_pk');
