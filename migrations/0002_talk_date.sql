-- When the talk is given (ms since 1970, UTC); the schedule is planned to it. Null until it is set.
ALTER TABLE talks ADD COLUMN talk_at INTEGER;
