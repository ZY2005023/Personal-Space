CREATE TABLE interest_topics (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  intro TEXT NOT NULL CHECK (length(intro) <= 2000),
  is_public BOOLEAN NOT NULL DEFAULT false,
  first_published_at TIMESTAMPTZ(3),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (NOT is_public OR first_published_at IS NOT NULL)
);
CREATE TABLE interest_topic_items (
  topic_id UUID NOT NULL REFERENCES interest_topics(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  content_id UUID NOT NULL REFERENCES contents(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 49),
  PRIMARY KEY (topic_id, content_id),
  UNIQUE (topic_id, position)
);
CREATE INDEX interest_topic_items_content_idx ON interest_topic_items(content_id);
CREATE TABLE ai_summary_usage (
  usage_day DATE PRIMARY KEY,
  requests INTEGER NOT NULL CHECK (requests > 0)
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ps_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON interest_topics, interest_topic_items, ai_summary_usage TO ps_app;
  END IF;
END $$;
