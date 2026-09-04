-- TradeDeck product gaps migration
-- Run in Supabase SQL Editor against project jlaajejpqjldpbinktln.
-- Idempotent: safe to re-run.

-- 1) Hire / assign flow
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS assigned_contractor_id uuid REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS jobs_assigned_contractor_id_idx
  ON jobs (assigned_contractor_id);

-- 2) Binary close-out reviews (product plan: on time? clean? would hire again?)
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS on_time boolean,
  ADD COLUMN IF NOT EXISTS clean boolean,
  ADD COLUMN IF NOT EXISTS would_hire_again boolean;

-- 3) Tier scoring inputs on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS timeline_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_variance_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanliness_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unverified';

-- 4) Recompute tier from objective on-platform data
-- Tier map: 1 Verified, 2 Active, 3 Proven, 4 Trusted, 5 TradeDeck Pro
CREATE OR REPLACE FUNCTION recompute_profile_tier(p_profile_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobs int;
  v_hire_again numeric;
  v_clean numeric;
  v_on_time numeric;
  v_tier int := 1;
BEGIN
  SELECT COALESCE(jobs_completed, 0) INTO v_jobs
  FROM profiles WHERE id = p_profile_id;

  SELECT
    AVG(CASE WHEN would_hire_again THEN 1.0 ELSE 0.0 END),
    AVG(CASE WHEN clean THEN 1.0 ELSE 0.0 END),
    AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END)
  INTO v_hire_again, v_clean, v_on_time
  FROM reviews
  WHERE reviewee_id = p_profile_id
    AND would_hire_again IS NOT NULL;

  UPDATE profiles SET
    repeat_hire_rate = COALESCE(ROUND(v_hire_again * 100), repeat_hire_rate),
    cleanliness_score = COALESCE(ROUND(v_clean * 100), cleanliness_score),
    timeline_score = COALESCE(ROUND(v_on_time * 100), timeline_score),
    rating = COALESCE(
      ROUND(((COALESCE(v_on_time,0) + COALESCE(v_clean,0) + COALESCE(v_hire_again,0)) / 3.0) * 5, 1),
      rating
    )
  WHERE id = p_profile_id;

  IF v_jobs >= 25 AND COALESCE(v_hire_again, 0) >= 0.9 THEN
    v_tier := 5;
  ELSIF v_jobs >= 10 AND COALESCE(v_hire_again, 0) >= 0.8 THEN
    v_tier := 4;
  ELSIF v_jobs >= 3 THEN
    v_tier := 3;
  ELSIF v_jobs >= 1 THEN
    v_tier := 2;
  ELSE
    v_tier := 1;
  END IF;

  UPDATE profiles SET tier = v_tier WHERE id = p_profile_id;
  RETURN v_tier;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_profile_tier(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION recompute_profile_tier(uuid) TO anon;
