type VideoRow = {
  id: string;
  title: string;
  description?: string | null;
  published_at?: string | null;
  duration_seconds?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  channel_id: string;
  channel_title?: string | null;
  subscriber_count?: number | null;
  thumbnail_url?: string | null;
};

const AUTHORITY_KEYWORDS = [
  "metodología",
  "framework",
  "arquitectura",
  "sistema",
  "pipeline",
  "benchmark",
  "benchmarking",
  "caso real",
  "casos reales",
  "patrón",
  "patrones",
  "diseño",
  "integration",
  "integración",
  "productividad",
  "workflow",
  "trazabilidad",
  "observabilidad",
  "calidad",
  "seguridad",
  "refactor",
  "refactorización",
  "escala",
  "escalable",
  "latencia",
  "performance",
  "métricas",
  "testing",
  "eval",
  "evaluación",
  "coste",
  "costos",
];

const CLICKBAIT_KEYWORDS = [
  "no creerás",
  "increíble",
  "secreto",
  "truco",
  "hack",
  "viral",
  "bomba",
  "explota",
  "impactante",
  "100x",
  "x10",
  "x100",
  "te va a volar la cabeza",
  "locura",
  "brutal",
];

export function computeAuthority(rows: VideoRow[]) {
  const videoScores = rows.map((row) => {
    const text = `${row.title ?? ""} ${row.description ?? ""}`.toLowerCase();
    const depthScore = scoreDepth(row.duration_seconds ?? null);
    const keywordScore = scoreKeywordDensity(text, AUTHORITY_KEYWORDS);
    const clickbaitPenalty = scoreKeywordDensity(text, CLICKBAIT_KEYWORDS) * 0.6;
    const engagementScore = scoreEngagement(row.view_count ?? null, row.subscriber_count ?? null);
    const recencyScore = scoreRecency(row.published_at ?? null);

    const raw =
      0.35 * depthScore +
      0.25 * keywordScore +
      0.2 * engagementScore +
      0.2 * recencyScore -
      0.15 * clickbaitPenalty;
    const score = clamp(raw, 0, 1) * 100;

    return {
      id: row.id,
      title: row.title,
      channelId: row.channel_id,
      channelTitle: row.channel_title,
      thumbnailUrl: row.thumbnail_url,
      publishedAt: row.published_at,
      durationSeconds: row.duration_seconds,
      viewCount: row.view_count,
      score: Math.round(score),
      signals: {
        depth: round(depthScore),
        methodology: round(keywordScore),
        engagement: round(engagementScore),
        recency: round(recencyScore),
        clickbaitPenalty: round(clickbaitPenalty),
      },
    };
  });

  const channelMap = new Map<string, VideoRow[]>();
  for (const row of rows) {
    const list = channelMap.get(row.channel_id) ?? [];
    list.push(row);
    channelMap.set(row.channel_id, list);
  }

  const channelScores = Array.from(channelMap.entries()).map(([channelId, items]) => {
    const scores = videoScores.filter((video) => video.channelId === channelId);
    const avgVideoScore = average(scores.map((s) => s.score));
    const subs = items[0]?.subscriber_count ?? null;
    const subsScore = scoreSubscribers(subs);
    const latest = latestDate(items.map((item) => item.published_at));
    const recencyScore = scoreRecency(latest);
    const channelScore = clamp(0.7 * (avgVideoScore / 100) + 0.15 * subsScore + 0.15 * recencyScore, 0, 1) * 100;

    return {
      channelId,
      title: items[0]?.channel_title,
      thumbnailUrl: items[0]?.thumbnail_url,
      subscriberCount: subs,
      avgVideoScore: Math.round(avgVideoScore),
      score: Math.round(channelScore),
      signals: {
        consistency: round(avgVideoScore / 100),
        scale: round(subsScore),
        recency: round(recencyScore),
      },
    };
  });

  return {
    benchmarks: {
      avgVideoScore: Math.round(average(videoScores.map((v) => v.score))),
      avgChannelScore: Math.round(average(channelScores.map((c) => c.score))),
      topVideoScore: Math.max(0, ...videoScores.map((v) => v.score)),
      topChannelScore: Math.max(0, ...channelScores.map((c) => c.score)),
    },
    videos: videoScores.sort((a, b) => b.score - a.score).slice(0, 20),
    channels: channelScores.sort((a, b) => b.score - a.score).slice(0, 12),
  };
}

function scoreDepth(duration: number | null) {
  if (!duration) return 0.2;
  if (duration < 300) return 0.2;
  if (duration < 720) return 0.45;
  if (duration < 1200) return 0.7;
  if (duration < 2100) return 0.9;
  return 1;
}

function scoreRecency(dateValue: string | null) {
  if (!dateValue) return 0.4;
  const published = new Date(dateValue);
  const diffDays = (Date.now() - published.getTime()) / (1000 * 3600 * 24);
  const halfLife = 240;
  return Math.exp(-diffDays / halfLife);
}

function scoreEngagement(views: number | null, subs: number | null) {
  if (!views) return 0.2;
  const denominator = subs && subs > 0 ? subs : 5000;
  const ratio = views / denominator;
  const scaled = Math.log10(1 + ratio * 10);
  return clamp(scaled / 2, 0, 1);
}

function scoreSubscribers(subs: number | null) {
  if (!subs) return 0.2;
  const scaled = Math.log10(subs + 1) / 6;
  return clamp(scaled, 0, 1);
}

function scoreKeywordDensity(text: string, keywords: string[]) {
  if (!text) return 0;
  let hits = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) hits += 1;
  }
  return clamp(hits / 4, 0, 1);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latestDate(values: Array<string | null | undefined>) {
  let latest: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!latest) latest = value;
    else if (new Date(value) > new Date(latest)) latest = value;
  }
  return latest;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
