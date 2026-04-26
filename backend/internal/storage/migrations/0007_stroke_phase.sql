-- Phase per stroke. 'work' is the default so existing free-row sessions
-- and any pre-rollout strokes (DB is reset for this rollout, so this is
-- defensive only) behave as before — every stroke counts.
ALTER TABLE strokes ADD COLUMN phase TEXT NOT NULL DEFAULT 'work';
