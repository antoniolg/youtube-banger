import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString: databaseUrl,
});

const schemaSql = `
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  handle TEXT,
  description TEXT,
  country TEXT,
  published_at TIMESTAMPTZ,
  subscriber_count BIGINT,
  view_count BIGINT,
  video_count BIGINT,
  thumbnail_url TEXT,
  last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  published_at TIMESTAMPTZ,
  duration_seconds INT,
  view_count BIGINT,
  like_count BIGINT,
  comment_count BIGINT,
  thumbnail_url TEXT,
  language TEXT,
  tags TEXT[],
  last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_runs (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  max_results INT NOT NULL,
  region_code TEXT,
  language TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_run_videos (
  run_id INT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, video_id)
);

CREATE TABLE IF NOT EXISTS insights_cache (
  run_id INT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, type)
);

CREATE TABLE IF NOT EXISTS video_ideation_notes (
  run_id INT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  plan_updated_at TIMESTAMPTZ NOT NULL,
  video_index INT NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, plan_updated_at, video_index)
);

CREATE TABLE IF NOT EXISTS video_ideation_messages (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  plan_updated_at TIMESTAMPTZ NOT NULL,
  video_index INT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider TEXT PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT,
  token_type TEXT,
  expiry_date BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function migrate() {
  await pool.query(schemaSql);
}

export async function close() {
  await pool.end();
}
