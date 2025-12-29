const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

export type SearchResult = {
  videoId: string;
  channelId: string;
};

export type VideoDetails = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  channelTitle: string;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  tags: string[] | null;
  thumbnailUrl: string | null;
  defaultLanguage: string | null;
};

export type ChannelDetails = {
  id: string;
  title: string;
  description: string | null;
  handle: string | null;
  country: string | null;
  publishedAt: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  thumbnailUrl: string | null;
};

function getApiKey() {
  const key = process.env.YT_API_KEY;
  if (!key) throw new Error("YT_API_KEY is required");
  return key;
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function searchVideos(params: {
  query: string;
  maxResults: number;
  regionCode?: string;
  relevanceLanguage?: string;
}) {
  const searchParams = new URLSearchParams({
    key: getApiKey(),
    part: "snippet",
    type: "video",
    q: params.query,
    maxResults: String(params.maxResults),
  });
  if (params.regionCode) searchParams.set("regionCode", params.regionCode);
  if (params.relevanceLanguage) searchParams.set("relevanceLanguage", params.relevanceLanguage);

  const data = await fetchJson(`${YT_API_BASE}/search?${searchParams.toString()}`);
  const items = data.items || [];
  return items
    .map((item: any) => ({
      videoId: item.id?.videoId,
      channelId: item.snippet?.channelId,
    }))
    .filter((item: SearchResult) => item.videoId && item.channelId);
}

export async function fetchVideoDetails(videoIds: string[]) {
  if (videoIds.length === 0) return [] as VideoDetails[];
  const searchParams = new URLSearchParams({
    key: getApiKey(),
    part: "snippet,contentDetails,statistics",
    id: videoIds.join(","),
    maxResults: String(videoIds.length),
  });
  const data = await fetchJson(`${YT_API_BASE}/videos?${searchParams.toString()}`);
  const items = data.items || [];
  return items.map((item: any) => {
    const snippet = item.snippet || {};
    const stats = item.statistics || {};
    const content = item.contentDetails || {};
    return {
      id: item.id,
      title: snippet.title,
      description: snippet.description,
      publishedAt: snippet.publishedAt,
      channelId: snippet.channelId,
      channelTitle: snippet.channelTitle,
      durationSeconds: parseISODuration(content.duration),
      viewCount: toNumber(stats.viewCount),
      likeCount: toNumber(stats.likeCount),
      commentCount: toNumber(stats.commentCount),
      tags: snippet.tags || null,
      thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || null,
      defaultLanguage: snippet.defaultLanguage || null,
    } as VideoDetails;
  });
}

export async function fetchChannelDetails(channelIds: string[]) {
  if (channelIds.length === 0) return [] as ChannelDetails[];
  const searchParams = new URLSearchParams({
    key: getApiKey(),
    part: "snippet,statistics",
    id: channelIds.join(","),
    maxResults: String(channelIds.length),
  });
  const data = await fetchJson(`${YT_API_BASE}/channels?${searchParams.toString()}`);
  const items = data.items || [];
  return items.map((item: any) => {
    const snippet = item.snippet || {};
    const stats = item.statistics || {};
    return {
      id: item.id,
      title: snippet.title,
      description: snippet.description || null,
      handle: snippet.customUrl || null,
      country: snippet.country || null,
      publishedAt: snippet.publishedAt || null,
      subscriberCount: toNumber(stats.subscriberCount),
      viewCount: toNumber(stats.viewCount),
      videoCount: toNumber(stats.videoCount),
      thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || null,
    } as ChannelDetails;
  });
}

function parseISODuration(duration?: string | null) {
  if (!duration) return null;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function toNumber(value: any) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
