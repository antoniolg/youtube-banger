import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool, migrate } from "./db.js";
import { searchVideos, fetchVideoDetails, fetchChannelDetails } from "./youtube.js";
import { generateInsights, generateText, normalizeGeminiInsight } from "./gemini.js";
import { DEFAULT_SCOPES, exchangeCodeForTokens, getAuthUrl, getAuthorizedClient } from "./oauth.js";
import { google } from "googleapis";
import { computeAuthority } from "./analysis.js";

const app = express();
const port = Number(process.env.PORT || 8080);
const MIN_LONG_SECONDS = 150;
const MAX_WEEKLY_HOURS = 8;

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
      `SELECT sr.*, COUNT(v.id) AS video_count
       FROM search_runs sr
       LEFT JOIN search_run_videos srv ON sr.id = srv.run_id
       LEFT JOIN videos v ON v.id = srv.video_id AND v.duration_seconds >= $1
       GROUP BY sr.id
       ORDER BY sr.created_at DESC
       LIMIT 20`,
      [MIN_LONG_SECONDS]
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
         AND v.duration_seconds >= $2
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 30`,
      [runId, MIN_LONG_SECONDS]
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
         AND v.duration_seconds >= $2
       GROUP BY v.channel_id, c.title, c.thumbnail_url, c.subscriber_count
       ORDER BY total_views DESC NULLS LAST
       LIMIT 12`,
      [runId, MIN_LONG_SECONDS]
    );

    const statsResult = await pool.query(
      `SELECT COUNT(*)::int AS videos, AVG(view_count)::float8 AS avg_views, AVG(duration_seconds)::float8 AS avg_duration
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2`,
      [runId, MIN_LONG_SECONDS]
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
    const refresh = req.query.refresh === "1";

    if (!refresh) {
      const cached = await getCachedInsight(runId, "overview");
      if (cached) {
        const normalized = normalizeGeminiInsight(cached.content);
        if (typeof cached.content === "string" || (cached.content && cached.content.raw)) {
          await saveCachedInsight(runId, "overview", normalized);
        }
        return res.json({ insights: normalized, cached: true, updatedAt: cached.updatedAt });
      }
    }

    const videosResult = await pool.query(
      `SELECT v.title, v.view_count, v.published_at, v.duration_seconds, c.title AS channel_title
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 18`,
      [runId, MIN_LONG_SECONDS]
    );

    const prompt = buildInsightsPrompt(videosResult.rows);
    const rawInsights = await generateInsights(prompt, OVERVIEW_SCHEMA);
    const insights = normalizeGeminiInsight(rawInsights);
    const updatedAt = await saveCachedInsight(runId, "overview", insights);
    res.json({ insights, cached: false, updatedAt });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/insights/topics", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    if (!runId) return res.status(400).json({ error: "runId is required" });
    const refresh = req.query.refresh === "1";

    if (!refresh) {
      const cached = await getCachedInsight(runId, "topics");
      if (cached) {
        const normalized = normalizeGeminiInsight(cached.content);
        if (typeof cached.content === "string" || (cached.content && cached.content.raw)) {
          await saveCachedInsight(runId, "topics", normalized);
        }
        return res.json({ insights: normalized, cached: true, updatedAt: cached.updatedAt });
      }
    }

    const videosResult = await pool.query(
      `SELECT v.title, v.description, v.view_count, c.title AS channel_title
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 40`,
      [runId, MIN_LONG_SECONDS]
    );

    const prompt = buildTopicsPrompt(videosResult.rows);
    const rawInsights = await generateInsights(prompt, TOPICS_SCHEMA);
    const insights = normalizeGeminiInsight(rawInsights);
    const updatedAt = await saveCachedInsight(runId, "topics", insights);
    res.json({ insights, cached: false, updatedAt });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/insights/next-actions", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    if (!runId) return res.status(400).json({ error: "runId is required" });
    const refresh = req.query.refresh === "1";

    if (!refresh) {
      const cached = await getCachedInsight(runId, "next-actions");
      if (cached) {
        const normalized = normalizeGeminiInsight(cached.content);
        if (typeof cached.content === "string" || (cached.content && cached.content.raw)) {
          await saveCachedInsight(runId, "next-actions", normalized);
        }
        return res.json({ insights: normalized, cached: true, updatedAt: cached.updatedAt });
      }
    }

    const runResult = await pool.query("SELECT * FROM search_runs WHERE id = $1", [runId]);
    if (runResult.rows.length === 0) return res.status(404).json({ error: "run not found" });

    const videosResult = await pool.query(
      `SELECT v.id, v.title, v.description, v.published_at, v.duration_seconds, v.view_count, v.like_count, v.comment_count,
              v.channel_id, c.title AS channel_title, c.subscriber_count, v.thumbnail_url
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 30`,
      [runId, MIN_LONG_SECONDS]
    );

    const channelsResult = await pool.query(
      `SELECT v.channel_id, c.title, c.subscriber_count
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2
       GROUP BY v.channel_id, c.title, c.subscriber_count
       ORDER BY c.subscriber_count DESC NULLS LAST
       LIMIT 8`,
      [runId, MIN_LONG_SECONDS]
    );

    const statsResult = await pool.query(
      `SELECT COUNT(*)::int AS videos, AVG(view_count)::float8 AS avg_views, AVG(duration_seconds)::float8 AS avg_duration
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2`,
      [runId, MIN_LONG_SECONDS]
    );

    const authority = computeAuthority(videosResult.rows);

    const analytics = await safeAnalyticsSummary();
    const topVideos = await safeAnalyticsTopVideos();
    const focusRatio = computeFocusRatio(topVideos?.items || []);

    const prompt = buildNextActionsPrompt({
      run: runResult.rows[0],
      stats: statsResult.rows[0],
      videos: videosResult.rows,
      channels: channelsResult.rows,
      authority,
      analytics,
      topVideos,
      focusRatio,
    });

    const rawInsights = await generateInsights(prompt, NEXT_ACTIONS_SCHEMA);
    const insights = normalizeGeminiInsight(rawInsights);
    const updatedAt = await saveCachedInsight(runId, "next-actions", insights);
    res.json({ insights, cached: false, updatedAt });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/plan/month", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    if (!runId) return res.status(400).json({ error: "runId is required" });
    const refresh = req.query.refresh === "1";

    if (!refresh) {
      const cached = await getCachedInsight(runId, "month-plan");
      if (cached) {
        const normalized = normalizeGeminiInsight(cached.content);
        if (typeof cached.content === "string" || (cached.content && cached.content.raw)) {
          await saveCachedInsight(runId, "month-plan", normalized);
        }
        return res.json({ plan: normalized, cached: true, updatedAt: cached.updatedAt });
      }
    }

    const runResult = await pool.query("SELECT * FROM search_runs WHERE id = $1", [runId]);
    if (runResult.rows.length === 0) return res.status(404).json({ error: "run not found" });

    const videosResult = await pool.query(
      `SELECT v.id, v.title, v.description, v.published_at, v.duration_seconds, v.view_count,
              v.channel_id, c.title AS channel_title
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 45`,
      [runId, MIN_LONG_SECONDS]
    );

    const channelsResult = await pool.query(
      `SELECT v.channel_id, c.title, c.subscriber_count
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2
       GROUP BY v.channel_id, c.title, c.subscriber_count
       ORDER BY c.subscriber_count DESC NULLS LAST
       LIMIT 10`,
      [runId, MIN_LONG_SECONDS]
    );

    const statsResult = await pool.query(
      `SELECT COUNT(*)::int AS videos, AVG(view_count)::float8 AS avg_views, AVG(duration_seconds)::float8 AS avg_duration
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2`,
      [runId, MIN_LONG_SECONDS]
    );

    const authority = computeAuthority(videosResult.rows);
    const analytics = await safeAnalyticsSummary();
    const topVideos = await safeAnalyticsTopVideos();
    const focusRatio = computeFocusRatio(topVideos?.items || []);

    const durations = videosResult.rows
      .map((row: any) => row.duration_seconds)
      .filter((value: number | null) => Number.isFinite(value) && (value ?? 0) > 0) as number[];
    const durationStats = buildDurationStats(durations);

    const cachedTopics = await getCachedInsight(runId, "topics");
    const topicsSummary = cachedTopics ? normalizeGeminiInsight(cachedTopics.content) : null;

    const prompt = buildMonthPlanPrompt({
      run: runResult.rows[0],
      stats: statsResult.rows[0],
      videos: videosResult.rows,
      channels: channelsResult.rows,
      authority,
      analytics,
      topVideos,
      focusRatio,
      durationStats,
      topicsSummary,
      maxWeeklyHours: MAX_WEEKLY_HOURS,
    });

    const rawPlan = await generateInsights(prompt, MONTH_PLAN_SCHEMA);
    const plan = normalizeGeminiInsight(rawPlan);
    const updatedAt = await saveCachedInsight(runId, "month-plan", plan);
    res.json({ plan, cached: false, updatedAt });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/inspiration/global", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    if (!runId) return res.status(400).json({ error: "runId is required" });
    const refresh = req.query.refresh === "1";

    if (!refresh) {
      const cached = await getCachedInsight(runId, "global-inspiration");
      if (cached) {
        const normalized = normalizeGeminiInsight(cached.content);
        if (typeof cached.content === "string" || (cached.content && cached.content.raw)) {
          await saveCachedInsight(runId, "global-inspiration", normalized);
        }
        return res.json({ data: normalized, cached: true, updatedAt: cached.updatedAt });
      }
    }

    const runResult = await pool.query("SELECT * FROM search_runs WHERE id = $1", [runId]);
    if (runResult.rows.length === 0) return res.status(404).json({ error: "run not found" });

    const globalQuery = buildGlobalQuery(runResult.rows[0].query);
    const searchResults = await searchVideos({
      query: globalQuery,
      maxResults: 30,
      regionCode: "US",
      relevanceLanguage: "en",
    });
    const videoIds = Array.from(new Set(searchResults.map((item) => item.videoId)));
    const details = await fetchVideoDetails(videoIds);
    const videos = details
      .filter((item) => (item.durationSeconds ?? 0) >= MIN_LONG_SECONDS)
      .map((item) => ({
        id: item.id,
        title: item.title,
        channelTitle: item.channelTitle,
        viewCount: item.viewCount,
        durationSeconds: item.durationSeconds,
        thumbnailUrl: item.thumbnailUrl,
      }))
      .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
      .slice(0, 20);

    const prompt = buildGlobalInspirationPrompt(videos, globalQuery);
    const rawInsights = await generateInsights(prompt, GLOBAL_INSPIRATION_SCHEMA);
    const insights = normalizeGeminiInsight(rawInsights);

    const payload = { query: globalQuery, insights, videos };
    const updatedAt = await saveCachedInsight(runId, "global-inspiration", payload);
    res.json({ data: payload, cached: false, updatedAt });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/ideas/suggest", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    if (!runId) return res.status(400).json({ error: "runId is required" });
    const refresh = req.query.refresh === "1";

    if (!refresh) {
      const cached = await getCachedInsight(runId, "idea-suggestions");
      if (cached) {
        const normalized = normalizeGeminiInsight(cached.content);
        if (typeof cached.content === "string" || (cached.content && cached.content.raw)) {
          await saveCachedInsight(runId, "idea-suggestions", normalized);
        }
        return res.json({ ideas: normalized.ideas || [], cached: true, updatedAt: cached.updatedAt });
      }
    }

    const runResult = await pool.query("SELECT * FROM search_runs WHERE id = $1", [runId]);
    if (runResult.rows.length === 0) return res.status(404).json({ error: "run not found" });

    const videosResult = await pool.query(
      `SELECT v.title, v.description, v.view_count, v.duration_seconds, c.title AS channel_title
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 40`,
      [runId, MIN_LONG_SECONDS]
    );

    const topicsCached = await getCachedInsight(runId, "topics");
    const topicsSummary = topicsCached ? normalizeGeminiInsight(topicsCached.content) : null;

    const prompt = buildIdeaSuggestionsPrompt({
      query: runResult.rows[0].query,
      videos: videosResult.rows,
      topicsSummary,
    });

    const rawIdeas = await generateInsights(prompt, IDEA_SUGGESTIONS_SCHEMA);
    const suggestions = normalizeGeminiInsight(rawIdeas);
    const updatedAt = await saveCachedInsight(runId, "idea-suggestions", suggestions);
    res.json({ ideas: suggestions.ideas || [], cached: false, updatedAt });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/ideas", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    if (!runId) return res.status(400).json({ error: "runId is required" });
    const result = await pool.query(
      `SELECT id, title, angle, reason, effort, cta, score, source, created_at
       FROM video_ideas
       WHERE run_id = $1
       ORDER BY created_at DESC`,
      [runId]
    );
    res.json({ ideas: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.post("/api/ideas", async (req, res) => {
  try {
    const runId = Number(req.body.runId);
    const title = String(req.body.title || "").trim();
    const angle = req.body.angle ? String(req.body.angle) : null;
    const reason = req.body.reason ? String(req.body.reason) : null;
    const effort = req.body.effort ? String(req.body.effort) : null;
    const cta = req.body.cta ? String(req.body.cta) : null;
    const score = req.body.score !== undefined ? Number(req.body.score) : null;
    const source = req.body.source ? String(req.body.source) : "user";
    if (!runId || !title) return res.status(400).json({ error: "runId and title are required" });

    const result = await pool.query(
      `INSERT INTO video_ideas (run_id, title, angle, reason, effort, cta, score, source, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, title, angle, reason, effort, cta, score, source, created_at`,
      [runId, title, angle, reason, effort, cta, score, source]
    );
    res.status(201).json({ idea: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.delete("/api/ideas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id is required" });
    await pool.query("DELETE FROM video_ideas WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.post("/api/ideas/validate", async (req, res) => {
  try {
    const runId = Number(req.body.runId);
    const title = String(req.body.title || "").trim();
    const angle = String(req.body.angle || "").trim();
    const notes = String(req.body.notes || "").trim();
    if (!runId || !title) {
      return res.status(400).json({ error: "runId and title are required" });
    }

    const runResult = await pool.query("SELECT * FROM search_runs WHERE id = $1", [runId]);
    if (runResult.rows.length === 0) return res.status(404).json({ error: "run not found" });

    const videosResult = await pool.query(
      `SELECT v.title, v.view_count, v.duration_seconds, c.title AS channel_title
       FROM search_run_videos srv
       JOIN videos v ON v.id = srv.video_id
       JOIN channels c ON c.id = v.channel_id
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2
       ORDER BY v.view_count DESC NULLS LAST
       LIMIT 25`,
      [runId, MIN_LONG_SECONDS]
    );

    const topicsCached = await getCachedInsight(runId, "topics");
    const topicsSummary = topicsCached ? normalizeGeminiInsight(topicsCached.content) : null;

    const prompt = buildIdeaValidationPrompt({
      query: runResult.rows[0].query,
      title,
      angle,
      notes,
      videos: videosResult.rows,
      topicsSummary,
    });

    const rawValidation = await generateInsights(prompt, IDEA_VALIDATION_SCHEMA);
    const validation = normalizeGeminiInsight(rawValidation);
    res.json({ validation });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.get("/api/plan/month/video", async (req, res) => {
  try {
    const runId = Number(req.query.runId);
    const videoIndex = Number(req.query.index);
    const planUpdatedAt = String(req.query.planUpdatedAt || "");
    if (!runId || Number.isNaN(videoIndex)) {
      return res.status(400).json({ error: "runId and index are required" });
    }

    const planData = await loadMonthPlanVideo(runId, videoIndex, planUpdatedAt);
    const notesResult = await pool.query(
      `SELECT notes FROM video_ideation_notes
       WHERE run_id = $1 AND plan_updated_at = $2 AND video_index = $3`,
      [runId, planData.planUpdatedAt, videoIndex]
    );
    const messagesResult = await pool.query(
      `SELECT role, content, created_at
       FROM video_ideation_messages
       WHERE run_id = $1 AND plan_updated_at = $2 AND video_index = $3
       ORDER BY id ASC`,
      [runId, planData.planUpdatedAt, videoIndex]
    );

    res.json({
      planUpdatedAt: planData.planUpdatedAt,
      video: planData.video,
      notes: notesResult.rows[0]?.notes || "",
      messages: messagesResult.rows || [],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.post("/api/plan/month/video/notes", async (req, res) => {
  try {
    const runId = Number(req.body.runId);
    const videoIndex = Number(req.body.index);
    const planUpdatedAt = String(req.body.planUpdatedAt || "");
    const notes = String(req.body.notes || "");
    if (!runId || Number.isNaN(videoIndex) || !planUpdatedAt) {
      return res.status(400).json({ error: "runId, index and planUpdatedAt are required" });
    }

    const planData = await loadMonthPlanVideo(runId, videoIndex, planUpdatedAt);
    const result = await pool.query(
      `INSERT INTO video_ideation_notes (run_id, plan_updated_at, video_index, notes, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (run_id, plan_updated_at, video_index)
       DO UPDATE SET notes = EXCLUDED.notes, updated_at = NOW()
       RETURNING notes, updated_at`,
      [runId, planData.planUpdatedAt, videoIndex, notes]
    );
    res.json({ notes: result.rows[0]?.notes || notes, updatedAt: result.rows[0]?.updated_at });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.post("/api/plan/month/video/chat", async (req, res) => {
  try {
    const runId = Number(req.body.runId);
    const videoIndex = Number(req.body.index);
    const planUpdatedAt = String(req.body.planUpdatedAt || "");
    const message = String(req.body.message || "").trim();
    if (!runId || Number.isNaN(videoIndex) || !planUpdatedAt || !message) {
      return res.status(400).json({ error: "runId, index, planUpdatedAt and message are required" });
    }

    const planData = await loadMonthPlanVideo(runId, videoIndex, planUpdatedAt);
    await pool.query(
      `INSERT INTO video_ideation_messages (run_id, plan_updated_at, video_index, role, content)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, planData.planUpdatedAt, videoIndex, "user", message]
    );

    const notesResult = await pool.query(
      `SELECT notes FROM video_ideation_notes
       WHERE run_id = $1 AND plan_updated_at = $2 AND video_index = $3`,
      [runId, planData.planUpdatedAt, videoIndex]
    );
    const notes = notesResult.rows[0]?.notes || "";

    const messagesResult = await pool.query(
      `SELECT role, content
       FROM video_ideation_messages
       WHERE run_id = $1 AND plan_updated_at = $2 AND video_index = $3
       ORDER BY id DESC
       LIMIT 10`,
      [runId, planData.planUpdatedAt, videoIndex]
    );
    const history = messagesResult.rows.reverse();

    const prompt = buildVideoChatPrompt(planData.video, notes, history);
    const reply = await generateText(prompt);

    await pool.query(
      `INSERT INTO video_ideation_messages (run_id, plan_updated_at, video_index, role, content)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, planData.planUpdatedAt, videoIndex, "assistant", reply]
    );

    res.json({ reply });
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
       WHERE srv.run_id = $1
         AND v.duration_seconds >= $2`,
      [runId, MIN_LONG_SECONDS]
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

const OVERVIEW_SCHEMA = {
  type: "object",
  properties: {
    posicionamiento: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    series_ideas: { type: "array", items: { type: "string" } },
    formatos: { type: "array", items: { type: "string" } },
    optimizacion: { type: "array", items: { type: "string" } },
  },
  required: ["posicionamiento", "gaps", "series_ideas", "formatos", "optimizacion"],
  additionalProperties: false,
};

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

  return `Eres estratega de contenido para YouTube en espanol. Tema: IA aplicada al desarrollo de software.

Analiza la muestra y devuelve SOLO JSON valido con esta estructura exacta:
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

Reglas: prioriza metodologia, casos reales, criterios de decision y arquitectura. Evita tono influencer.`;
}

const TOPICS_SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          descripcion: { type: "string" },
          ejemplos: { type: "array", items: { type: "string" } },
        },
        required: ["nombre", "descripcion", "ejemplos"],
        additionalProperties: false,
      },
    },
    gaps: { type: "array", items: { type: "string" } },
    series_ideas: { type: "array", items: { type: "string" } },
    enfoque_autoridad: { type: "array", items: { type: "string" } },
  },
  required: ["clusters", "gaps", "series_ideas", "enfoque_autoridad"],
  additionalProperties: false,
};

function buildNextActionsPrompt(payload: any) {
  const { run, stats, videos, channels, authority, analytics, topVideos, focusRatio } = payload;
  const marketSample = videos
    .slice(0, 15)
    .map(
      (video: any) =>
        `- ${video.title} | ${video.channel_title} | ${video.view_count ?? "n/a"} views | ${Math.round(
          (video.duration_seconds ?? 0) / 60
        )} min`
    )
    .join("\n");

  const channelList = channels
    .map((channel: any) => `- ${channel.title} | ${channel.subscriber_count ?? "n/a"} subs`)
    .join("\n");

  const topVideoList = (topVideos?.items || [])
    .slice(0, 10)
    .map((item: any) => `- ${item.title} | ${item.views ?? "n/a"} views | ${item.averageViewDuration ?? "n/a"}s`)
    .join("\n");

  return `Eres estratega de crecimiento en YouTube en espanol para un canal de IA aplicada al desarrollo de software.
Objetivo: autoridad tecnica (no influencer), con foco en metodologia, casos reales y productividad en equipos.

Datos del mercado:
- Query: ${run.query}
- Videos analizados: ${stats?.videos ?? "n/a"}
- Vistas promedio: ${stats?.avg_views ?? "n/a"}
- Duracion promedio (min): ${Math.round((stats?.avg_duration ?? 0) / 60)}
- Canales relevantes:
${channelList}

Muestra de videos top del mercado:
${marketSample}

Score de autoridad (benchmarks):
- Avg video score: ${authority?.benchmarks?.avgVideoScore ?? "n/a"}
- Top video score: ${authority?.benchmarks?.topVideoScore ?? "n/a"}

Analytics del canal (ultimos 28 dias):
${analytics ? JSON.stringify(analytics.metrics) : "No disponible"}

Top videos del canal (90 dias):
${topVideoList || "No disponible"}

Enfoque IA aplicada (sobre top videos del canal):
${focusRatio ? `${focusRatio.aiCount}/${focusRatio.total} (${Math.round(focusRatio.ratio * 100)}%)` : "No disponible"}

Devuelve SOLO JSON valido con esta estructura exacta:
{
  "acciones": [
    {
      "titulo": "...",
      "por_que": "...",
      "pasos": ["...","..."],
      "tiempo_estimado": "...",
      "kpi": ["...","..."],
      "prioridad": 1
    }
  ],
  "plan_30_dias": [
    {"semana": "Semana 1", "objetivo": "...", "entregables": ["...","..."]},
    {"semana": "Semana 2", "objetivo": "...", "entregables": ["...","..."]},
    {"semana": "Semana 3", "objetivo": "...", "entregables": ["...","..."]},
    {"semana": "Semana 4", "objetivo": "...", "entregables": ["...","..."]}
  ],
  "metricas_clave": ["...","..."],
  "alertas": ["..."]
}

Reglas: propon exactamente 3 acciones, concretas, con alto impacto y orientadas a autoridad. Evita recomendaciones vagas o de influencer.`;
}

const NEXT_ACTIONS_SCHEMA = {
  type: "object",
  properties: {
    acciones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          prioridad: { type: "integer" },
          titulo: { type: "string" },
          por_que: { type: "string" },
          pasos: { type: "array", items: { type: "string" } },
          tiempo_estimado: { type: "string" },
          kpi: { type: "array", items: { type: "string" } },
        },
        required: ["prioridad", "titulo", "por_que", "pasos", "tiempo_estimado", "kpi"],
        additionalProperties: false,
      },
    },
    plan_30_dias: {
      type: "array",
      items: {
        type: "object",
        properties: {
          semana: { type: "string" },
          objetivo: { type: "string" },
          entregables: { type: "array", items: { type: "string" } },
        },
        required: ["semana", "objetivo", "entregables"],
        additionalProperties: false,
      },
    },
    metricas_clave: { type: "array", items: { type: "string" } },
    alertas: { type: "array", items: { type: "string" } },
  },
  required: ["acciones", "plan_30_dias", "metricas_clave", "alertas"],
  additionalProperties: false,
};

const MONTH_PLAN_SCHEMA = {
  type: "object",
  properties: {
    objetivo_mes: { type: "string" },
    cadencia_recomendada: { type: "string" },
    motivo_cadencia: { type: "string" },
    duracion_recomendada: { type: "string" },
    videos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          semana: { type: "string" },
          titulo: { type: "string" },
          angulo: { type: "string" },
          estructura: { type: "array", items: { type: "string" } },
          duracion: { type: "string" },
          esfuerzo: { type: "string" },
          horas_estimadas: { type: "number" },
          cta: { type: "string" },
          razon: { type: "string" },
        },
        required: [
          "semana",
          "titulo",
          "angulo",
          "estructura",
          "duracion",
          "esfuerzo",
          "horas_estimadas",
          "cta",
          "razon",
        ],
        additionalProperties: false,
      },
    },
    metricas_clave: { type: "array", items: { type: "string" } },
  },
  required: [
    "objetivo_mes",
    "cadencia_recomendada",
    "motivo_cadencia",
    "duracion_recomendada",
    "videos",
    "metricas_clave",
  ],
  additionalProperties: false,
};

function buildMonthPlanPrompt(payload: any) {
  const { run, stats, videos, channels, authority, analytics, topVideos, focusRatio, durationStats, topicsSummary } =
    payload;
  const marketSample = videos
    .slice(0, 18)
    .map(
      (video: any) =>
        `- ${video.title} | ${video.channel_title} | ${video.view_count ?? "n/a"} views | ${Math.round(
          (video.duration_seconds ?? 0) / 60
        )} min`
    )
    .join("\n");

  const channelList = channels
    .map((channel: any) => `- ${channel.title} | ${channel.subscriber_count ?? "n/a"} subs`)
    .join("\n");

  const topVideoList = (topVideos?.items || [])
    .slice(0, 8)
    .map((item: any) => `- ${item.title} | ${item.views ?? "n/a"} views`)
    .join("\n");

  const topicText = topicsSummary
    ? JSON.stringify(topicsSummary)
    : "No hay mapa de temas aún. Deduce pilares a partir de los títulos de mercado.";

  return `Eres estratega de crecimiento en YouTube en español para un canal de IA aplicada al desarrollo de software.
Objetivo: autoridad técnica (no influencer), con foco en metodología, casos reales y productividad en equipos.

Condiciones del canal:
- Tiempo disponible: ${payload.maxWeeklyHours} horas por semana
- Cadencia deseada: 1 video/semana, pero puedes recomendar 2/mes si la complejidad lo exige.
- Duración objetivo: videos largos (15-30 min) basados en tendencia del mercado.
- CTA: 2 videos con lead magnet (escribir "Lead magnet (elige cuál)"), 1 video con CTA suave (newsletter/lista espera), 1 video con CTA directo a la formación.

Datos del mercado:
- Query: ${run.query}
- Videos analizados: ${stats?.videos ?? "n/a"}
- Vistas promedio: ${stats?.avg_views ?? "n/a"}
- Duración promedio (min): ${Math.round((stats?.avg_duration ?? 0) / 60)}
- Duración p50/p75 (min): ${durationStats?.p50 ?? "n/a"} / ${durationStats?.p75 ?? "n/a"}
- Canales relevantes:
${channelList}

Muestra de videos top del mercado:
${marketSample}

Score de autoridad (benchmarks):
- Avg video score: ${authority?.benchmarks?.avgVideoScore ?? "n/a"}
- Top video score: ${authority?.benchmarks?.topVideoScore ?? "n/a"}

Analytics del canal (ultimos 28 dias):
${analytics ? JSON.stringify(analytics.metrics) : "No disponible"}

Top videos del canal (90 dias):
${topVideoList || "No disponible"}

Enfoque IA aplicada (sobre top videos del canal):
${focusRatio ? `${focusRatio.aiCount}/${focusRatio.total} (${Math.round(focusRatio.ratio * 100)}%)` : "No disponible"}

Mapa de temas (si existe):
${topicText}

Devuelve SOLO JSON valido con esta estructura exacta:
{
  "objetivo_mes": "...",
  "cadencia_recomendada": "4 videos/mes" o "2 videos/mes",
  "motivo_cadencia": "...",
  "duracion_recomendada": "...",
  "videos": [
    {
      "semana": "Semana 1",
      "titulo": "...",
      "angulo": "...",
      "estructura": ["...","...","..."],
      "duracion": "...",
      "esfuerzo": "bajo|medio|alto",
      "horas_estimadas": 6,
      "cta": "...",
      "razon": "..."
    }
  ],
  "metricas_clave": ["...","..."]
}

Reglas:
- No excedas ${payload.maxWeeklyHours} horas por semana.
- Si recomiendas 2 videos/mes, asigna Semana 1 y Semana 3 y usa 1 CTA lead magnet + 1 CTA directo.
- Duración recomendada basada en p50/p75 del mercado.
- Cada video debe ser accionable y viable de preparar en el tiempo indicado.
- Evita repetir títulos o ángulos entre sí.
- Prioriza autoridad técnica sobre viralidad.`;
}

function buildGlobalQuery(query: string) {
  const normalized = query.toLowerCase();
  if (normalized.includes("desarrollo de software") || normalized.includes("software")) {
    return "AI software engineering";
  }
  if (normalized.includes("ia") || normalized.includes("inteligencia artificial")) {
    return "AI applied to software development";
  }
  return `AI ${query}`;
}

const GLOBAL_INSPIRATION_SCHEMA = {
  type: "object",
  properties: {
    formatos: { type: "array", items: { type: "string" } },
    series_ideas: { type: "array", items: { type: "string" } },
    tendencias: { type: "array", items: { type: "string" } },
    angulos_clave: { type: "array", items: { type: "string" } },
  },
  required: ["formatos", "series_ideas", "tendencias", "angulos_clave"],
  additionalProperties: false,
};

function buildGlobalInspirationPrompt(videos: any[], query: string) {
  const list = videos
    .slice(0, 18)
    .map(
      (video: any) =>
        `- ${video.title} | ${video.channelTitle} | ${video.viewCount ?? "n/a"} views | ${Math.round(
          (video.durationSeconds ?? 0) / 60
        )} min`
    )
    .join("\n");

  return `Eres estratega de contenido para YouTube en español.
Analiza esta muestra de videos globales en inglés sobre "${query}" y devuelve SOLO JSON válido en español con esta estructura:
{
  "formatos": ["...","..."],
  "series_ideas": ["...","..."],
  "tendencias": ["...","..."],
  "angulos_clave": ["...","..."]
}

Muestra:
${list}

Reglas: ideas importables al mercado hispano, tono autoridad técnica, evita clickbait.`;
}

const IDEA_SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          angulo: { type: "string" },
          razon: { type: "string" },
          esfuerzo: { type: "string" },
          cta: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["titulo", "angulo", "razon", "esfuerzo", "cta", "score"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
};

const IDEA_VALIDATION_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    veredicto: { type: "string" },
    razon: { type: "string" },
    mejoras: { type: "array", items: { type: "string" } },
    titulo_refinado: { type: "string" },
    angulo_refinado: { type: "string" },
    cta: { type: "string" },
    esfuerzo: { type: "string" },
  },
  required: ["score", "veredicto", "razon", "mejoras", "titulo_refinado", "angulo_refinado", "cta", "esfuerzo"],
  additionalProperties: false,
};

function buildIdeaSuggestionsPrompt(payload: {
  query: string;
  videos: Array<{ title: string; channel_title: string; view_count: number; duration_seconds: number }>;
  topicsSummary?: any;
}) {
  const list = payload.videos
    .map(
      (video) =>
        `- ${video.title} | ${video.channel_title} | ${video.view_count ?? "n/a"} views | ${Math.round(
          (video.duration_seconds ?? 0) / 60
        )} min`
    )
    .join("\n");

  const topicText = payload.topicsSummary
    ? JSON.stringify(payload.topicsSummary)
    : "No hay mapa de temas aún. Deduce pilares a partir de los títulos de mercado.";

  return `Eres estratega de contenido para YouTube en español.
Tema: IA aplicada al desarrollo de software. Objetivo: autoridad técnica (no influencer), metodología y criterio.
Tiempo disponible: ${MAX_WEEKLY_HOURS} horas por semana.

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "ideas": [
    {
      "titulo": "...",
      "angulo": "...",
      "razon": "...",
      "esfuerzo": "bajo|medio|alto",
      "cta": "...",
      "score": 0
    }
  ]
}

Reglas:
- EXACTAMENTE 10 ideas.
- Duración objetivo: videos largos 15-30 min.
- Score 0-100: 50% autoridad, 30% crecimiento, 20% diferenciación.
- Evita clickbait, incluye casos reales, metodología, criterio técnico y comparativas con datos.
- CTA variada: lead magnet, newsletter, checklist, demo/plantilla, formación.
- Evita repetir temas o ángulos entre sí.

Contexto del mercado:
- Query base: ${payload.query}
- Mapa de temas: ${topicText}

Muestra de videos con tracción:
${list}`;
}

function buildIdeaValidationPrompt(payload: {
  query: string;
  title: string;
  angle: string;
  notes: string;
  videos: Array<{ title: string; channel_title: string; view_count: number; duration_seconds: number }>;
  topicsSummary?: any;
}) {
  const list = payload.videos
    .map(
      (video) =>
        `- ${video.title} | ${video.channel_title} | ${video.view_count ?? "n/a"} views | ${Math.round(
          (video.duration_seconds ?? 0) / 60
        )} min`
    )
    .join("\n");

  const topicText = payload.topicsSummary
    ? JSON.stringify(payload.topicsSummary)
    : "No hay mapa de temas aún. Deduce pilares a partir de los títulos de mercado.";

  return `Eres estratega de crecimiento para YouTube en español.
Canal: IA aplicada al desarrollo de software. Objetivo: autoridad técnica, evitar tono influencer.

Evalúa si esta idea encaja y propón mejoras para maximizar autoridad y crecimiento.
Devuelve SOLO JSON válido con esta estructura exacta:
{
  "score": 0,
  "veredicto": "apta|ajustable|no encaja",
  "razon": "...",
  "mejoras": ["...","..."],
  "titulo_refinado": "...",
  "angulo_refinado": "...",
  "cta": "...",
  "esfuerzo": "bajo|medio|alto"
}

Reglas:
- Score 0-100 basado en autoridad (50%), crecimiento (30%) y diferenciación (20%).
- Si no encaja, adapta el ángulo para que sí encaje.
- Mantén duración 15-30 min y enfoque en casos reales/metodología.

Idea propuesta:
- Título: ${payload.title}
- Ángulo: ${payload.angle || "No especificado"}
- Notas: ${payload.notes || "Sin notas"}

Contexto del mercado:
- Query base: ${payload.query}
- Mapa de temas: ${topicText}

Muestra de videos con tracción:
${list}`;
}

async function loadMonthPlanVideo(runId: number, videoIndex: number, planUpdatedAt: string) {
  const cached = await getCachedInsight(runId, "month-plan");
  if (!cached) {
    throw new Error("Plan del mes no encontrado. Regenera el plan.");
  }
  if (planUpdatedAt) {
    const cachedTime = new Date(cached.updatedAt).getTime();
    const requestedTime = new Date(planUpdatedAt).getTime();
    if (!Number.isNaN(requestedTime) && Math.abs(cachedTime - requestedTime) > 1000) {
      throw new Error("El plan del mes cambió. Regenera el plan para continuar.");
    }
  }
  const plan = normalizeGeminiInsight(cached.content);
  const videos = Array.isArray(plan?.videos) ? plan.videos : [];
  const video = videos[videoIndex];
  if (!video) {
    throw new Error("Video no encontrado en el plan.");
  }
  return { plan, video, planUpdatedAt: cached.updatedAt };
}

function buildVideoChatPrompt(video: any, notes: string, messages: Array<{ role: string; content: string }>) {
  const history = messages
    .map((item) => `${item.role === "user" ? "Usuario" : "Asistente"}: ${item.content}`)
    .join("\n");

  return `Eres productor y guionista de YouTube en español.
Canal: IA aplicada al desarrollo de software. Objetivo: autoridad técnica (no influencer).

Detalles del video:
- Título: ${video.titulo}
- Ángulo: ${video.angulo}
- Duración: ${video.duracion}
- Esfuerzo: ${video.esfuerzo} (${video.horas_estimadas ?? "n/a"}h)
- CTA: ${video.cta}
- Razón estratégica: ${video.razon}
- Estructura base: ${Array.isArray(video.estructura) ? video.estructura.join(" | ") : video.estructura}

Notas del creador:
${notes || "Sin notas aún."}

Conversación reciente:
${history || "Sin historial."}

Instrucciones:
- Responde en español, conciso y accionable.
- Si piden guion, entrega estructura por secciones con bullets.
- Si detectas huecos, pregunta una sola cosa clave para avanzar.
- Evita tono hype o influencer.`;
}

async function safeAnalyticsSummary() {
  try {
    return await fetchAnalyticsSummary(true);
  } catch {
    try {
      const fallback = await fetchAnalyticsSummary(false);
      return { ...fallback, includesShorts: true };
    } catch {
      return null;
    }
  }
}

async function safeAnalyticsTopVideos() {
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
    const items = rows
      .map((row) => {
        const [videoId, views, _minutes, avgDuration] = row;
        const detail = detailMap.get(videoId);
        return {
          videoId,
          title: detail?.title || "Video",
          views,
          averageViewDuration: avgDuration,
          durationSeconds: detail?.durationSeconds ?? null,
        };
      })
      .filter((item) => (item.durationSeconds ?? 0) >= MIN_LONG_SECONDS)
      .map(({ durationSeconds, ...rest }) => rest);
    return { range: { startDate, endDate }, items };
  } catch {
    return null;
  }
}

async function fetchAnalyticsSummary(filterLong: boolean) {
  const auth = await getAuthorizedClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });
  const { startDate, endDate } = getLastDaysRange(28);
  const response = await analytics.reports.query({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost",
    ...(filterLong ? { filters: "videoDurationType==LONG" } : {}),
  });
  const rows = response.data.rows?.[0] || [];
  return {
    range: { startDate, endDate },
    metrics: {
      views: rows[0] ?? 0,
      estimatedMinutesWatched: rows[1] ?? 0,
      averageViewDuration: rows[2] ?? 0,
      subscribersGained: rows[3] ?? 0,
      subscribersLost: rows[4] ?? 0,
    },
    includesShorts: false,
  };
}

function computeFocusRatio(items: any[]) {
  if (!items.length) return null;
  const aiKeywords = [
    "ia",
    "ai",
    "inteligencia artificial",
    "gpt",
    "chatgpt",
    "claude",
    "gemini",
    "codex",
    "cursor",
    "agente",
    "agent",
    "multi-agente",
    "prompt",
    "llm",
    "copilot",
    "replit",
    "vibe coding",
  ];
  const aiCount = items.filter((item: any) => {
    const text = String(item.title || "").toLowerCase();
    return aiKeywords.some((keyword) => text.includes(keyword));
  }).length;
  return {
    aiCount,
    total: items.length,
    ratio: aiCount / items.length,
  };
}

function buildDurationStats(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const p50 = pick(0.5);
  const p75 = pick(0.75);
  return {
    avg: Math.round(average / 60),
    p50: Math.round(p50 / 60),
    p75: Math.round(p75 / 60),
  };
}

async function getCachedInsight(runId: number, type: string) {
  const result = await pool.query(
    "SELECT content, updated_at FROM insights_cache WHERE run_id = $1 AND type = $2",
    [runId, type]
  );
  if (result.rows.length === 0) return null;
  return {
    content: result.rows[0].content,
    updatedAt: result.rows[0].updated_at,
  };
}

async function saveCachedInsight(runId: number, type: string, content: any) {
  const result = await pool.query(
    `INSERT INTO insights_cache (run_id, type, content, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (run_id, type) DO UPDATE SET
       content = EXCLUDED.content,
       updated_at = NOW()
     RETURNING updated_at`,
    [runId, type, content]
  );
  return result.rows[0]?.updated_at ?? new Date().toISOString();
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
