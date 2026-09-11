-- Run manually in Supabase SQL Editor. This file is never executed by the site/build.
BEGIN;

ALTER TABLE public.education_videos ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.agent_testimonials ADD COLUMN IF NOT EXISTS slug text;
LOCK TABLE public.education_videos, public.agent_testimonials IN SHARE ROW EXCLUSIVE MODE;

-- Only empty slug values are normalized. Existing nonempty slugs/content stay intact.
UPDATE public.education_videos SET slug = NULL WHERE btrim(slug) = '';
UPDATE public.agent_testimonials SET slug = NULL WHERE btrim(slug) = '';
CREATE UNIQUE INDEX IF NOT EXISTS education_videos_slug_unique ON public.education_videos (slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agent_testimonials_slug_unique ON public.agent_testimonials (slug) WHERE slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pinnacle_slugify(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $function$
  SELECT coalesce(nullif(trim(both '-' from regexp_replace(
    regexp_replace(
      regexp_replace(
        replace(replace(replace(replace(lower(regexp_replace(normalize(value, NFKD), U&'[\0300-\036f]', '', 'g')), 'ß', 'ss'), 'œ', 'oe'), 'æ', 'ae'), 'ł', 'l'),
        '["''‘’“”]', '', 'g'),
      '[^a-z0-9\s-]', '', 'g'),
    '[\s-]+', '-', 'g')), ''), 'post');
$function$;

CREATE OR REPLACE FUNCTION public.pinnacle_assign_slug()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  base text;
  candidate text;
  suffix integer := 1;
  occupied boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND nullif(OLD.slug, '') IS NOT NULL THEN
    NEW.slug := OLD.slug;
    RETURN NEW;
  END IF;
  base := coalesce(nullif(NEW.slug, ''), public.pinnacle_slugify(coalesce(NEW.title, '')));
  IF base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid slug: %', base;
  END IF;
  -- Serialize allocation per table; the unique index remains the final safeguard.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, 0));
  LOOP
    candidate := base || CASE WHEN suffix = 1 THEN '' ELSE '-' || suffix::text END;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE slug = $1 AND id::text IS DISTINCT FROM $2)', TG_TABLE_SCHEMA, TG_TABLE_NAME)
      INTO occupied USING candidate, NEW.id::text;
    EXIT WHEN NOT occupied;
    suffix := suffix + 1;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pinnacle_content_slug ON public.education_videos;
CREATE TRIGGER pinnacle_content_slug BEFORE INSERT OR UPDATE ON public.education_videos
  FOR EACH ROW EXECUTE FUNCTION public.pinnacle_assign_slug();
DROP TRIGGER IF EXISTS pinnacle_content_slug ON public.agent_testimonials;
CREATE TRIGGER pinnacle_content_slug BEFORE INSERT OR UPDATE ON public.agent_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.pinnacle_assign_slug();

-- Deterministic backfill: oldest rows receive the unsuffixed name first.
DO $backfill$
DECLARE
  table_name text;
  post record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['education_videos', 'agent_testimonials'] LOOP
    FOR post IN EXECUTE format('SELECT id FROM public.%I WHERE slug IS NULL ORDER BY created_at NULLS LAST, id::text', table_name) LOOP
      EXECUTE format('UPDATE public.%I SET slug = NULL WHERE id = $1', table_name) USING post.id;
    END LOOP;
  END LOOP;
END;
$backfill$;

COMMIT;
-- Existing duplicate nonempty slugs make the unique-index step fail and roll back
-- this transaction; investigate those values instead of overwriting old URLs.
