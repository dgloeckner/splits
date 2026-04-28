-- Adds previous-value snapshot columns to PB tables. Populated by
-- recompute when a key's active value genuinely improves; carried
-- through unchanged on idempotent recomputes. Enables the Rekorde
-- hero-card delta ("-3s vs. vorher") without a history join.

ALTER TABLE pb_distance ADD COLUMN previous_time_sec REAL;
ALTER TABLE pb_window   ADD COLUMN previous_value    REAL;
ALTER TABLE pb_workout  ADD COLUMN previous_value    REAL;
