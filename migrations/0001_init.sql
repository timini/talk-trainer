-- Talks, built in the background from an uploaded deck. status: queued, parsing, rendering, voicing, ready or failed.
CREATE TABLE talks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  deck_key TEXT NOT NULL,
  slides INTEGER NOT NULL DEFAULT 0,
  sentences INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  voiced INTEGER NOT NULL DEFAULT 0,
  glossary TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

-- The slides of a talk in order (n from 1), with the speaker notes that are the script.
CREATE TABLE slides (
  talk TEXT NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL,
  image_key TEXT,
  PRIMARY KEY (talk, n)
);

-- Each slide's sentences (i from 1). hash: the first 12 hex digits of the text's SHA-256, so a changed sentence is a
-- new card. clip_key: the R2 key of its voice clip, shared by every sentence with the same text, voice and model.
CREATE TABLE sentences (
  talk TEXT NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
  slide INTEGER NOT NULL,
  i INTEGER NOT NULL,
  text TEXT NOT NULL,
  hash TEXT NOT NULL,
  clip_key TEXT,
  must_say TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (talk, slide, i)
);

-- Training progress for each card of a talk, as the JSON the scheduler keeps.
CREATE TABLE progress (
  talk TEXT NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
  card TEXT NOT NULL,
  state TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (talk, card)
);

-- What the background build did, step by step.
CREATE TABLE build_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  talk TEXT NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  step TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX build_log_talk ON build_log (talk, id);
