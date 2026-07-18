CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL DEFAULT 'youtube',
  raw_url TEXT,
  canonical_url TEXT,
  session_key TEXT UNIQUE,
  title TEXT,
  title_fetch_status TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  exported_at TEXT,
  expires_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_used ON sessions(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_sessions_title ON sessions(title);

CREATE TABLE IF NOT EXISTS saved_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('sentence_box','kanji_box')),
  source_text TEXT NOT NULL,
  ui_translation TEXT,
  target_word TEXT,
  target_surface TEXT,
  target_word_lemma TEXT,
  target_word_reading TEXT,
  target_start_index INTEGER,
  target_end_index INTEGER,
  screenshot_media_id TEXT,
  source_image_id TEXT,
  source_image_url TEXT,
  page_url TEXT,
  anki_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  created_tz_offset_min INTEGER,
  exported_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_saved_items_session ON saved_items(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_items_type ON saved_items(item_type);
CREATE INDEX IF NOT EXISTS idx_saved_items_anki ON saved_items(anki_status);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  saved_item_id TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER,
  downscaled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(saved_item_id) REFERENCES saved_items(id)
);

CREATE INDEX IF NOT EXISTS idx_media_saved_item ON media(saved_item_id);

CREATE TABLE IF NOT EXISTS translation_cache (
  id TEXT PRIMARY KEY,
  saved_item_id TEXT NOT NULL,
  ai_model TEXT,
  prompt_version TEXT,
  source_translation TEXT,
  word_translation TEXT,
  word_explanation TEXT,
  kanji_json TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  FOREIGN KEY(saved_item_id) REFERENCES saved_items(id)
);

CREATE INDEX IF NOT EXISTS idx_translation_cache_item ON translation_cache(saved_item_id);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  export_type TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  r2_key TEXT,
  notes TEXT
);
