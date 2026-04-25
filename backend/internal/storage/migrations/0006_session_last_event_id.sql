-- Track the highest event id observed for each session so the
-- sessionizer can resume its monotonic counter across restarts even
-- after strokes are compacted away (FEAT-0009 Mode 0).
ALTER TABLE sessions ADD COLUMN last_event_id INTEGER;
