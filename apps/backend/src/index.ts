import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool, migrate } from "./db.js";
import { searchVideos, fetchVideoDetails, fetchChannelDetails } from "./youtube.js";
import { generateInsights } from "./gemini.js";
import { DEFAULT_SCOPES, exchangeCodeForTokens, getAuthUrl, getAuthorizedClient } from "./oauth.js";
import { google } from "googleapis";
import { computeAuthority } from "./analysis.js";

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/proxy/image", async (req, res) => {
  try {
    const rawUrl = req.query.url;
    if (!rawUrl || typeof rawUrl !== "string") {
      return res.status(400).json({ error: "url is required" });
    }
    if (!isAllowedImageUrl(rawUrl)) {
      return res.status(400).json({ error: "url not allowed" });
    }

    const response = await fetch(rawUrl);
    if (!response.ok) {
      return res.status(502).json({ error: "image fetch failed" });
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/oauth/google/start", (req, res) => {
  try {
    const scopesParam = req.query.scopes as string | undefined;
    const scopes = scopesParam ? scopesParam.split(",") : DEFAULT_SCOPES;
    const url = getAuthUrl(scopes);
    if (req.query.redirect === "1") {
      return res.redirect(url);
    }
    res.json({ url });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/oauth/google/callback", async (req, res) => {
  try {
    const code = req.query.code as string | undefined;
    if (!code) return res.status(400).json({ error: "code is required" });
    await exchangeCodeForTokens(code);
    const redirect = process.env.OAUTH_SUCCESS_REDIRECT || "http://localhost:5173?oauth=success";
    res.redirect(redirect);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.post("/api/ingest/youtube", async (req, res) => {
  try {
    const { query, maxResults, regionCode, language } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }
    const max = Number(maxResults || 25);
    const cappedMax = Math.min(Math.max(max, 5), 50);

    const searchResults = await searchVideos({
      query,
      maxResults: cappedMax,
      regionCode: regionCode || "ES",
      relevanceLanguage: language || "es",
    });

    const videoIds = searchResults.map((item) => item.videoId);
    const videoDetails = await fetchVideoDetails(videoIds);
    const channelIds = Array.from(new Set(videoDetails.map((video) => video.channelId)));
    const channelDetails = await fetchChannelDetails(channelIds);

    const runId = await saveRun({
      query,
      maxResults: cappedMax,
      regionCode: regionCode || "ES",
      language: language || "es",
      videos: videoDetails,
      channels: channelDetails,
    });

    res.json({
      runId,
      videos: videoDetails.length,
      channels: channelDetails.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/analytics/summary", async (_req, res) => {
  try {
    const auth = await getAuthorizedClient();
    const analytics = google.youtubeAnalytics({ version: "v2", auth });

    const { startDate, endDate } = getLastDaysRange(28);
    const response = await analytics.reports.query({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost",
    });

    const rows = response.data.rows?.[0] || [];
    res.json({
      range: { startDate, endDate },
      metrics: {
        views: rows[0] ?? 0,
        estimatedMinutesWatched: rows[1] ?? 0,
        averageViewDuration: rows[2] ?? 0,
        subscribersGained: rows[3] ?? 0,
        subscribersLost: rows[4] ?? 0,
      },
    });
  } catch (error: any) {
    const message = error.message || "Unexpected error";
    if (message.includes("OAuth not connected")) {
      return res.status(401).json({ error: "oauth_required" });
    }
    res.status(500).json({ error: message });
  }
});

app.get("/api/analytics/top-videos", async (_req, res) => {
  try {
    const auth = await getAuthorizedClient();
    const analytics = google.youtubeAnalytics({ version: "v2", auth });
    const { startDate, endDate } = getLastDaysRange(90);
    const response = await analytics.reports.query({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched,averageViewDuration",
      dimensions: "video",
      sort: "-views",
      maxResults: 12,
    });

    const rows = response.data.rows || [];
    const videoIds = rows.map((row) => row[0]);
    const details = await fetchVideoDetails(videoIds);

    const detailMap = new Map(details.map((item) => [item.id, item]));
    const items = rows.map((row) => {
      const [videoId, views, minutes, avgDuration] = row;
      const detail = detailMap.get(videoId);
      return {
        videoId,
        title: detail?.title || "Video",
        thumbnailUrl: detail?.thumbnailUrl || null,
        views,
        minutesWatched: minutes,
        averageViewDuration: avgDuration,
      };
    });

    res.json({ range: { startDate, endDate }, items });
  } catch (error: any) {
    const message = error.message || "Unexpected error";
    if (message.includes("OAuth not connected")) {
      return res.status(401).json({ error: "oauth_required" });
    }
    res.status(500).json({ error: message });
  }
});

app.get("/api/runs", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT sr.*, COUNT(srv.video_id) AS video_count
       FROM search_runs sr
       LEFT JOIN search_run_videos srv ON sr.id = srv.run_id
       GROUP BY sr.id
       ORDER BY sr.created_at DESC
       LIMIT 20`
    );
    res.json({ runs: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/runs/:id", async (req, res) => {
  try {
    const runId = Number(req.params.id);
    if (!runId) return res.status(400).json({ error: "invalid run id" });

    const runResult = await pool.query("SELECT * FROM search_runs WHERE id = $1", [runId]);
    if (runResult.rows.length === 0) return res.status(404).json({ error: "run not found" });

    const videosResult = await pool.query(
      `SELECT v.*, c.title AS channel_title, c.thumbnail_url AS channel_thumbnail, c.subscriber_count
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 30`,
      [runId]
    );

    const channelsResult = await pool.query(
      `SELECT v.channel_id, c.title, c.thumbnail_url, c.subscriber_count,
              COUNT(*) AS videos_count,
              SUM(v.view_count)::float8 AS total_views,
              c.subscriber_count::float8 AS subscriber_count
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
       GROUP BY v.channel_id, c.title, c.thumbnail_url, c.subscriber_count
       ORDER BY total_views DESC NULLS LAST
       LIMIT 12`,
      [runId]
    );

    const statsResult = await pool.query(
      `SELECT COUNT(*)::int AS videos, AVG(view_count)::float8 AS avg_views, AVG(duration_seconds)::float8 AS avg_duration
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       WHERE srv.run_id = $1`,
      [runId]
    );

    res.json({
      run: runResult.rows[0],
      stats: statsResult.rows[0],
      videos: videosResult.rows,
      channels: channelsResult.rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/insights/overview", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    if (!runId) return res.status(400).json({ error: "runId is required" });

    const videosResult = await pool.query(
      `SELECT v.title, v.view_count, v.published_at, v.duration_seconds, c.title AS channel_title
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 18`,
      [runId]
    );

    const prompt = buildInsightsPrompt(videosResult.rows);
    const insights = await generateInsights(prompt);

    res.json({ insights });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/insights/topics", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    if (!runId) return res.status(400).json({ error: "runId is required" });

    const videosResult = await pool.query(
      `SELECT v.title, v.description, v.view_count, c.title AS channel_title
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 40`,
      [runId]
    );

    const prompt = buildTopicsPrompt(videosResult.rows);
    const insights = await generateInsights(prompt);
    res.json({ insights });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/analysis/authority", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    if (!runId) return res.status(400).json({ error: "runId is required" });

    const videosResult = await pool.query(
      `SELECT v.id, v.title, v.description, v.published_at, v.duration_seconds, v.view_count, v.like_count, v.comment_count,
              v.channel_id, c.title AS channel_title, c.subscriber_count, v.thumbnail_url
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1`,
      [runId]
    );

    const authority = computeAuthority(videosResult.rows);
    res.json(authority);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

function buildInsightsPrompt(videos: any[]) {
  const list = videos
    .map(
      (video) =>
        `- ${video.title} | ${video.channel_title} | ${video.view_count ?? "n/a"} views | ${
          video.duration_seconds ?? "n/a"
        }s | ${video.published_at ?? "n/a"}`
    )
    .join("\n");

  return `Eres estratega de contenido para YouTube en español. Tema: IA aplicada al desarrollo de software.\n
Contexto de marca: autoridad técnica, enfoque en productividad real, método, pensamiento crítico. Evitar tono influencer.\n
Analiza esta muestra de videos top y devuelve SOLO JSON válido con esta estructura exacta:\n{
  "posicionamiento": ["...", "..."],
  "gaps": ["...", "..."],
  "series_ideas": ["...", "..."],
  "formatos": ["...", "..."],
  "optimizacion": ["...", "..."]
}\n
Muestra de videos:\n${list}\n
Consejos: prioriza ideas accionables, metodologías, experimentos, casos reales, y framing de autoridad.`;
}

function isAllowedImageUrl(url: string) {
  return (
    url.startsWith("https://i.ytimg.com/") ||
    url.startsWith("https://yt3.ggpht.com/") ||
    url.startsWith("https://yt3.googleusercontent.com/")
  );
}

function buildTopicsPrompt(videos: any[]) {
  const list = videos
    .map((video) => {
      const title = (video.title || "").slice(0, 120);
      const description = (video.description || "").slice(0, 120);
      return `- ${title} | ${video.channel_title} | ${video.view_count ?? "n/a"} views | ${description}`;
    })
    .join("\n");

  return `Eres estratega de contenido para YouTube en español. Tema: IA aplicada al desarrollo de software.

Analiza la muestra y devuelve SOLO JSON válido con esta estructura exacta:
{
  "clusters": [
    {"nombre": "...", "descripcion": "...", "ejemplos": ["...","..."]},
    {"nombre": "...", "descripcion": "...", "ejemplos": ["...","..."]}
  ],
  "gaps": ["...","..."],
  "series_ideas": ["...","..."],
  "enfoque_autoridad": ["...","..."]
}

Muestra:
${list}

Reglas: prioriza metodología, casos reales, criterios de decisión y arquitectura. Evita tono influencer.`;
}

async function saveRun(params: {
  query: string;
  maxResults: number;
  regionCode?: string;
  language?: string;
  videos: any[];
  channels: any[];
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const runResult = await client.query(
      `INSERT INTO search_runs (query, max_results, region_code, language)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [params.query, params.maxResults, params.regionCode, params.language]
    );
    const runId = runResult.rows[0].id as number;

    for (const channel of params.channels) {
      await client.query(
        `INSERT INTO channels (id, title, handle, description, country, published_at, subscriber_count, view_count, video_count, thumbnail_url, last_fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           handle = EXCLUDED.handle,
           description = EXCLUDED.description,
           country = EXCLUDED.country,
           published_at = EXCLUDED.published_at,
           subscriber_count = EXCLUDED.subscriber_count,
           view_count = EXCLUDED.view_count,
           video_count = EXCLUDED.video_count,
           thumbnail_url = EXCLUDED.thumbnail_url,
           last_fetched_at = NOW()`,
        [
          channel.id,
          channel.title,
          channel.handle,
          channel.description,
          channel.country,
          channel.publishedAt,
          channel.subscriberCount,
          channel.viewCount,
          channel.videoCount,
          channel.thumbnailUrl,
        ]
      );
    }

    for (const video of params.videos) {
      await client.query(
        `INSERT INTO videos (id, channel_id, title, description, published_at, duration_seconds, view_count, like_count, comment_count, thumbnail_url, language, tags, last_fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
         ON CONFLICT (id) DO UPDATE SET
           channel_id = EXCLUDED.channel_id,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           published_at = EXCLUDED.published_at,
           duration_seconds = EXCLUDED.duration_seconds,
           view_count = EXCLUDED.view_count,
           like_count = EXCLUDED.like_count,
           comment_count = EXCLUDED.comment_count,
           thumbnail_url = EXCLUDED.thumbnail_url,
           language = EXCLUDED.language,
           tags = EXCLUDED.tags,
           last_fetched_at = NOW()`,
        [
          video.id,
          video.channelId,
          video.title,
          video.description,
          video.publishedAt,
          video.durationSeconds,
          video.viewCount,
          video.likeCount,
          video.commentCount,
          video.thumbnailUrl,
          video.defaultLanguage,
          video.tags,
        ]
      );
      await client.query(
        `INSERT INTO search_run_videos (run_id, video_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [runId, video.id]
      );
    }

    await client.query("COMMIT");
    return runId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function start() {
  await migrate();
  app.listen(port, () => {
    console.log(`Backend listening on :${port}`);
  });
}

function getLastDaysRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
