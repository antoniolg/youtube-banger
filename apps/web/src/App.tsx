import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";
const PLACEHOLDER_VIDEO = "https://placehold.co/120x70";
const PLACEHOLDER_AVATAR = "https://placehold.co/80x80";

function proxyImage(url?: string | null, fallback = PLACEHOLDER_VIDEO) {
  if (!url) return fallback;
  return `${API_BASE}/api/proxy/image?url=${encodeURIComponent(url)}`;
}

function asList(value: any) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (typeof value === "object") {
    const entries = Object.values(value).flatMap((item) => (typeof item === "string" ? [item] : []));
    return entries.length ? entries : [JSON.stringify(value)];
  }
  return [String(value)];
}

function classifyVideo(title: string) {
  const text = title.toLowerCase();
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
  for (const keyword of aiKeywords) {
    if (text.includes(keyword)) return "IA aplicada";
  }
  return "Dev general";
}

function formatAge(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "hace un momento";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "hace 1m";
  const totalHours = Math.floor(diffMs / 3_600_000);
  if (totalHours < 1) {
    const minutes = Math.max(1, Math.floor(diffMs / 60_000));
    return `hace ${minutes}m`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `hace ${days}d ${hours}h`;
  return `hace ${hours}h`;
}

function formatElapsed(start: number | null) {
  if (!start) return "0s";
  const diffMs = Math.max(0, Date.now() - start);
  const totalSeconds = Math.floor(diffMs / 1000);
  if (totalSeconds < 60) return `${Math.max(1, totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatScore(value: any) {
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return Math.round(num);
}

type Run = {
  id: number;
  query: string;
  max_results: number;
  region_code: string;
  language: string;
  created_at: string;
  video_count?: number;
};

type RunDetails = {
  run: Run;
  stats: { videos: number; avg_views: number; avg_duration: number };
  videos: any[];
  channels: any[];
};

export default function App() {
  const [query, setQuery] = useState("IA aplicada al desarrollo de software");
  const [maxResults, setMaxResults] = useState(25);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRun, setActiveRun] = useState<RunDetails | null>(null);
  const [insights, setInsights] = useState<any>(null);
  const [topics, setTopics] = useState<any>(null);
  const [authority, setAuthority] = useState<any>(null);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [authorityLoading, setAuthorityLoading] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [authorityError, setAuthorityError] = useState<string | null>(null);
  const [topicsStartedAt, setTopicsStartedAt] = useState<number | null>(null);
  const [authorityStartedAt, setAuthorityStartedAt] = useState<number | null>(null);
  const [, setLoadingTick] = useState(0);
  const [showAuthority, setShowAuthority] = useState(false);
  const [overviewUpdatedAt, setOverviewUpdatedAt] = useState<string | null>(null);
  const [topicsUpdatedAt, setTopicsUpdatedAt] = useState<string | null>(null);
  const [monthPlan, setMonthPlan] = useState<any>(null);
  const [monthPlanLoading, setMonthPlanLoading] = useState(false);
  const [monthPlanError, setMonthPlanError] = useState<string | null>(null);
  const [monthPlanUpdatedAt, setMonthPlanUpdatedAt] = useState<string | null>(null);
  const [globalInspiration, setGlobalInspiration] = useState<any>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalUpdatedAt, setGlobalUpdatedAt] = useState<string | null>(null);
  const [ideaSuggestions, setIdeaSuggestions] = useState<any[]>([]);
  const [ideaSuggestionsLoading, setIdeaSuggestionsLoading] = useState(false);
  const [ideaSuggestionsError, setIdeaSuggestionsError] = useState<string | null>(null);
  const [ideaSuggestionsUpdatedAt, setIdeaSuggestionsUpdatedAt] = useState<string | null>(null);
  const [savedIdeas, setSavedIdeas] = useState<any[]>([]);
  const [savedIdeasLoading, setSavedIdeasLoading] = useState(false);
  const [savedIdeasError, setSavedIdeasError] = useState<string | null>(null);
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaAngle, setIdeaAngle] = useState("");
  const [ideaNotes, setIdeaNotes] = useState("");
  const [ideaValidation, setIdeaValidation] = useState<any>(null);
  const [ideaValidationLoading, setIdeaValidationLoading] = useState(false);
  const [ideaValidationError, setIdeaValidationError] = useState<string | null>(null);
  const [ideaSavingIndex, setIdeaSavingIndex] = useState<number | null>(null);
  const [ideaDeletingId, setIdeaDeletingId] = useState<number | null>(null);
  const [ideaSavingValidation, setIdeaSavingValidation] = useState(false);
  const [videoDetailOpen, setVideoDetailOpen] = useState(false);
  const [videoDetailIndex, setVideoDetailIndex] = useState<number | null>(null);
  const [videoDetailLoading, setVideoDetailLoading] = useState(false);
  const [videoDetailError, setVideoDetailError] = useState<string | null>(null);
  const [videoDetail, setVideoDetail] = useState<any>(null);
  const [videoNotes, setVideoNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [insightsRefreshing, setInsightsRefreshing] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [topVideos, setTopVideos] = useState<any>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [topVideosError, setTopVideosError] = useState<string | null>(null);
  const [topFilter, setTopFilter] = useState<"all" | "ai" | "dev">("all");
  const [oauthRequired, setOauthRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuns();
    fetchAnalytics();
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") === "success") {
      params.delete("oauth");
      const next = params.toString();
      window.history.replaceState({}, "", next ? `${window.location.pathname}?${next}` : window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!topicsLoading && !authorityLoading) return;
    const id = window.setInterval(() => {
      setLoadingTick((tick) => tick + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [topicsLoading, authorityLoading]);

  async function fetchRuns() {
    const res = await fetch(`${API_BASE}/api/runs`);
    const data = await res.json();
    setRuns(data.runs || []);
    if (data.runs?.length) {
      loadRun(data.runs[0].id);
    }
  }

  async function loadRun(runId: number) {
    setError(null);
    const res = await fetch(`${API_BASE}/api/runs/${runId}`);
    if (!res.ok) {
      setError("No se pudo cargar el análisis.");
      return;
    }
    const data = await res.json();
    setActiveRun(data);
    setIdeaValidation(null);
    setIdeaTitle("");
    setIdeaAngle("");
    setIdeaNotes("");
    await fetchInsights(runId);
    fetchMonthPlan(runId);
    fetchGlobalInspiration(runId);
    fetchIdeaSuggestions(runId);
    fetchSavedIdeas(runId);
  }

  async function fetchAnalytics() {
    const res = await fetch(`${API_BASE}/api/analytics/summary`);
    if (res.status === 401) {
      setOauthRequired(true);
      setAnalyticsError(null);
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setAnalytics(null);
      setAnalyticsError(data.error || "No se pudieron cargar las métricas.");
      return;
    }
    setAnalytics(data);
    setAnalyticsError(null);
    setOauthRequired(false);

    const topRes = await fetch(`${API_BASE}/api/analytics/top-videos`);
    if (topRes.status === 401) {
      setTopVideos(null);
      setTopVideosError(null);
      return;
    }
    const topData = await topRes.json();
    if (!topRes.ok) {
      setTopVideos(null);
      setTopVideosError(topData.error || "No se pudieron cargar los top videos.");
      return;
    }
    setTopVideos(topData);
    setTopVideosError(null);
  }

  async function fetchMonthPlan(runId: number, refresh = false) {
    setMonthPlanLoading(true);
    setMonthPlanError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/plan/month?runId=${runId}${refresh ? "&refresh=1" : ""}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo generar el plan del mes.");
      }
      setMonthPlan(data.plan || null);
      setMonthPlanUpdatedAt(data.updatedAt || null);
    } catch (err: any) {
      setMonthPlanError(err.message);
      setMonthPlan(null);
    } finally {
      setMonthPlanLoading(false);
    }
  }

  async function fetchGlobalInspiration(runId: number, refresh = false) {
    setGlobalLoading(true);
    setGlobalError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/inspiration/global?runId=${runId}${refresh ? "&refresh=1" : ""}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo cargar la inspiración global.");
      }
      setGlobalInspiration(data.data || null);
      setGlobalUpdatedAt(data.updatedAt || null);
    } catch (err: any) {
      setGlobalError(err.message);
      setGlobalInspiration(null);
    } finally {
      setGlobalLoading(false);
    }
  }

  async function fetchIdeaSuggestions(runId: number, refresh = false) {
    setIdeaSuggestionsLoading(true);
    setIdeaSuggestionsError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/ideas/suggest?runId=${runId}${refresh ? "&refresh=1" : ""}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudieron generar ideas.");
      }
      setIdeaSuggestions(Array.isArray(data.ideas) ? data.ideas : []);
      setIdeaSuggestionsUpdatedAt(data.updatedAt || null);
    } catch (err: any) {
      setIdeaSuggestionsError(err.message);
      setIdeaSuggestions([]);
    } finally {
      setIdeaSuggestionsLoading(false);
    }
  }

  async function fetchSavedIdeas(runId: number) {
    setSavedIdeasLoading(true);
    setSavedIdeasError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ideas?runId=${runId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudieron cargar las ideas guardadas.");
      }
      setSavedIdeas(Array.isArray(data.ideas) ? data.ideas : []);
    } catch (err: any) {
      setSavedIdeasError(err.message);
      setSavedIdeas([]);
    } finally {
      setSavedIdeasLoading(false);
    }
  }

  async function saveSuggestedIdea(idea: any, index: number) {
    if (!activeRun?.run?.id) return;
    setIdeaSavingIndex(index);
    setSavedIdeasError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ideas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: activeRun.run.id,
          title: idea.titulo || idea.title,
          angle: idea.angulo || idea.angle,
          reason: idea.razon || idea.reason,
          effort: idea.esfuerzo || idea.effort,
          cta: idea.cta,
          score: Number.isFinite(Number(idea.score)) ? Math.round(Number(idea.score)) : null,
          source: "suggested",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo guardar la idea.");
      }
      setSavedIdeas((prev) => [data.idea, ...prev]);
      setIdeaSuggestions((prev) => prev.filter((_, i) => i !== index));
    } catch (err: any) {
      setSavedIdeasError(err.message);
    } finally {
      setIdeaSavingIndex(null);
    }
  }

  function discardSuggestedIdea(index: number) {
    setIdeaSuggestions((prev) => prev.filter((_, i) => i !== index));
  }

  async function deleteSavedIdea(id: number) {
    setIdeaDeletingId(id);
    setSavedIdeasError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ideas/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo eliminar la idea.");
      }
      setSavedIdeas((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      setSavedIdeasError(err.message);
    } finally {
      setIdeaDeletingId(null);
    }
  }

  async function validateIdea() {
    if (!activeRun?.run?.id) return;
    if (!ideaTitle.trim()) {
      setIdeaValidationError("Añade un título para validar la idea.");
      return;
    }
    setIdeaValidationLoading(true);
    setIdeaValidationError(null);
    setIdeaValidation(null);
    try {
      const res = await fetch(`${API_BASE}/api/ideas/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: activeRun.run.id,
          title: ideaTitle.trim(),
          angle: ideaAngle.trim(),
          notes: ideaNotes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo validar la idea.");
      }
      setIdeaValidation(data.validation || null);
    } catch (err: any) {
      setIdeaValidationError(err.message);
      setIdeaValidation(null);
    } finally {
      setIdeaValidationLoading(false);
    }
  }

  function applyValidation() {
    if (!ideaValidation) return;
    if (ideaValidation.titulo_refinado) {
      setIdeaTitle(ideaValidation.titulo_refinado);
    }
    if (ideaValidation.angulo_refinado) {
      setIdeaAngle(ideaValidation.angulo_refinado);
    }
  }

  async function saveValidatedIdea() {
    if (!activeRun?.run?.id || !ideaValidation) return;
    setIdeaSavingValidation(true);
    setSavedIdeasError(null);
    const title = (ideaValidation.titulo_refinado || ideaTitle).trim();
    if (!title) {
      setSavedIdeasError("La idea validada no tiene título.");
      setIdeaSavingValidation(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/ideas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: activeRun.run.id,
          title,
          angle: ideaValidation.angulo_refinado || ideaAngle.trim(),
          reason: ideaValidation.razon,
          effort: ideaValidation.esfuerzo,
          cta: ideaValidation.cta,
          score: Number.isFinite(Number(ideaValidation.score))
            ? Math.round(Number(ideaValidation.score))
            : null,
          source: "validated",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo guardar la idea.");
      }
      setSavedIdeas((prev) => [data.idea, ...prev]);
    } catch (err: any) {
      setSavedIdeasError(err.message);
    } finally {
      setIdeaSavingValidation(false);
    }
  }

  async function openVideoDetail(index: number) {
    if (!activeRun?.run?.id || !monthPlanUpdatedAt) {
      setVideoDetailError("Regenera el plan para abrir el detalle.");
      setVideoDetailOpen(true);
      return;
    }
    setVideoDetailOpen(true);
    setVideoDetailIndex(index);
    setVideoDetailLoading(true);
    setVideoDetailError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/plan/month/video?runId=${activeRun.run.id}&index=${index}&planUpdatedAt=${encodeURIComponent(
          monthPlanUpdatedAt
        )}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo cargar el detalle.");
      }
      setVideoDetail(data);
      setVideoNotes(data.notes || "");
    } catch (err: any) {
      setVideoDetailError(err.message);
      setVideoDetail(null);
    } finally {
      setVideoDetailLoading(false);
    }
  }

  function closeVideoDetail() {
    setVideoDetailOpen(false);
    setVideoDetailIndex(null);
    setVideoDetail(null);
    setVideoDetailError(null);
    setChatInput("");
  }

  async function saveVideoNotes() {
    if (!activeRun?.run?.id || videoDetailIndex === null || !monthPlanUpdatedAt) return;
    setNotesSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/plan/month/video/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: activeRun.run.id,
          index: videoDetailIndex,
          planUpdatedAt: monthPlanUpdatedAt,
          notes: videoNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron guardar las notas.");
    } catch (err: any) {
      setVideoDetailError(err.message);
    } finally {
      setNotesSaving(false);
    }
  }

  async function sendChatMessage() {
    if (!activeRun?.run?.id || videoDetailIndex === null || !monthPlanUpdatedAt || !chatInput.trim()) return;
    const message = chatInput.trim();
    setChatSending(true);
    setChatInput("");
    const nextMessages = [
      ...(Array.isArray(videoDetail?.messages) ? videoDetail.messages : []),
      { role: "user", content: message },
    ];
    setVideoDetail((prev: any) => ({ ...prev, messages: nextMessages }));
    try {
      const res = await fetch(`${API_BASE}/api/plan/month/video/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: activeRun.run.id,
          index: videoDetailIndex,
          planUpdatedAt: monthPlanUpdatedAt,
          message,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo generar respuesta.");
      setVideoDetail((prev: any) => ({
        ...prev,
        messages: [...nextMessages, { role: "assistant", content: data.reply }],
      }));
    } catch (err: any) {
      setVideoDetailError(err.message);
    } finally {
      setChatSending(false);
    }
  }

  async function handleIngest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ingest/youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, maxResults, regionCode: "ES", language: "es" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al investigar");
      }
      await fetchRuns();
      await loadRun(data.runId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    if (!activeRun?.stats) return null;
    const avgViews = Number(activeRun.stats.avg_views || 0).toFixed(0);
    const avgDuration = Number(activeRun.stats.avg_duration || 0).toFixed(0);
    return { avgViews, avgDuration };
  }, [activeRun]);

  const authorityElapsed = formatElapsed(authorityStartedAt);
  const topicsElapsed = formatElapsed(topicsStartedAt);

  const topVideosEnriched = useMemo(() => {
    if (!topVideos?.items) return [];
    return topVideos.items.map((item: any) => ({
      ...item,
      category: classifyVideo(item.title || ""),
    }));
  }, [topVideos]);

  const topVideosFiltered = useMemo(() => {
    if (topFilter === "all") return topVideosEnriched;
    return topVideosEnriched.filter((item: any) =>
      topFilter === "ai" ? item.category === "IA aplicada" : item.category === "Dev general"
    );
  }, [topVideosEnriched, topFilter]);

  const focusRatio = useMemo(() => {
    if (!topVideosEnriched.length) return null;
    const aiCount = topVideosEnriched.filter((item: any) => item.category === "IA aplicada").length;
    const ratio = aiCount / topVideosEnriched.length;
    return { aiCount, total: topVideosEnriched.length, ratio };
  }, [topVideosEnriched]);

  const summary = useMemo(() => {
    const items: string[] = [];
    if (analytics?.metrics) {
      const views = Number(analytics.metrics.views || 0).toLocaleString("es-ES");
      const minutes = Number(analytics.metrics.estimatedMinutesWatched || 0).toLocaleString("es-ES");
      const netSubs =
        Number(analytics.metrics.subscribersGained || 0) - Number(analytics.metrics.subscribersLost || 0);
      const suffix = analytics.includesShorts ? " (incluye shorts)" : "";
      items.push(`Tracción reciente${suffix}: ${views} vistas · ${minutes} min vistos · ${netSubs} subs netos`);
    }
    if (focusRatio) {
      const percent = Math.round(focusRatio.ratio * 100);
      items.push(`Enfoque IA aplicada: ${focusRatio.aiCount}/${focusRatio.total} top videos (${percent}%)`);
    }
    if (activeRun?.stats) {
      const avgViews = Number(activeRun.stats.avg_views || 0).toFixed(0);
      const avgMinutes = Math.round(Number(activeRun.stats.avg_duration || 0) / 60);
      items.push(
        `Mercado: ${activeRun.stats.videos} videos · ${avgMinutes} min promedio · ${avgViews} vistas promedio`
      );
    }
    return items;
  }, [analytics, focusRatio, activeRun]);

  const alert = useMemo(() => {
    if (!focusRatio) return null;
    if (focusRatio.ratio < 0.5) {
      return "Alerta: el contenido con más tracción no está centrado en IA aplicada al software.";
    }
    return null;
  }, [focusRatio]);

  const insightEntries = useMemo(() => {
    if (!insights) return [];
    return Object.entries(insights).filter(([key]) => !key.startsWith("_"));
  }, [insights]);

  const lastInsightUpdate = useMemo(() => {
    const dates = [overviewUpdatedAt, topicsUpdatedAt, monthPlanUpdatedAt]
      .filter(Boolean)
      .map((value) => new Date(value as string).getTime())
      .filter((value) => Number.isFinite(value));
    if (!dates.length) return null;
    return new Date(Math.max(...dates)).toISOString();
  }, [overviewUpdatedAt, topicsUpdatedAt, monthPlanUpdatedAt]);

  const validationScore = formatScore(ideaValidation?.score);

  return (
    <div className="app">
      <header className="hero">
        <div className="hero__texture" />
        <div className="hero__grid" />
        <div className="hero__content">
          <p className="hero__eyebrow">Radar de autoridad</p>
          <h1>IA aplicada al software, con criterio y profundidad.</h1>
          <p className="hero__lede">
            Analiza el ecosistema de YouTube en español, detecta vacíos reales de conocimiento y
            diseña una estrategia de contenido que te posicione como referente, no como influencer.
          </p>
          <div className="hero__actions">
            <div className="input-group">
              <label>Consulta principal</label>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ej: IA aplicada al desarrollo de software"
              />
            </div>
            <div className="input-group compact">
              <label>Muestra</label>
              <input
                type="number"
                min={5}
                max={50}
                value={maxResults}
                onChange={(event) => setMaxResults(Number(event.target.value))}
              />
            </div>
            <button onClick={handleIngest} disabled={loading}>
              {loading ? "Investigando..." : "Lanzar investigación"}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      </header>

      <main className="layout">
        <section className="panel summary">
          <div className="panel__header">
            <h2>Resumen ejecutivo</h2>
            <div className="actions-meta">
              <span className="muted">
                {lastInsightUpdate ? `Actualizado ${formatAge(lastInsightUpdate)}` : "Sin datos"}
              </span>
              <button
                className={`action-button ${insightsRefreshing ? "is-loading" : ""}`}
                onClick={refreshAllInsights}
                disabled={insightsRefreshing}
                aria-busy={insightsRefreshing}
              >
                {insightsRefreshing ? "Refrescando todo..." : "Refrescar todo"}
              </button>
            </div>
          </div>
          {summary.length ? (
            <div className="summary-grid">
              {summary.map((item, index) => (
                <div key={index} className="summary-card">
                  <p>{item}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Conecta Analytics y ejecuta una investigación para ver el resumen.</p>
          )}
          {alert ? <div className="alert-card">{alert}</div> : null}
        </section>

        <section className="panel ideas">
          <div className="panel__header">
            <h2>Ideas accionables</h2>
            <div className="actions-meta">
              <span className="muted">
                {ideaSuggestionsUpdatedAt ? `Actualizado ${formatAge(ideaSuggestionsUpdatedAt)}` : "Sin datos"}
              </span>
              <button
                className={`action-button ${ideaSuggestionsLoading ? "is-loading" : ""}`}
                onClick={() => activeRun?.run?.id && fetchIdeaSuggestions(activeRun.run.id, true)}
                disabled={ideaSuggestionsLoading || !activeRun?.run?.id}
                aria-busy={ideaSuggestionsLoading}
              >
                {ideaSuggestionsLoading ? "Generando..." : "Generar ideas"}
              </button>
            </div>
          </div>
          <p className="muted">
            Propón o guarda ideas listas para ejecutar. Valida cada propuesta con un score de 0 a 100.
          </p>
          <div className="ideas-layout">
            <div className="ideas-column">
              <div className="ideas-block">
                <div className="ideas-block__header">
                  <h3>Ideas sugeridas</h3>
                  <span className="muted">
                    {ideaSuggestions.length ? `${ideaSuggestions.length} ideas` : "Sin ideas"}
                  </span>
                </div>
                {ideaSuggestionsError ? <div className="error">{ideaSuggestionsError}</div> : null}
                {ideaSuggestionsLoading && !ideaSuggestions.length ? (
                  <p className="muted">Generando ideas...</p>
                ) : null}
                {ideaSuggestions.length ? (
                  <div className="idea-grid">
                    {ideaSuggestions.map((idea, index) => {
                      const score = formatScore(idea.score);
                      return (
                        <article key={`${idea.titulo}-${index}`} className="idea-card">
                          <div className="idea-card__header">
                            <span className="score-pill">{score !== null ? `${score} pts` : "—"}</span>
                            <div className="idea-card__actions">
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={() => saveSuggestedIdea(idea, index)}
                                disabled={ideaSavingIndex === index}
                              >
                                {ideaSavingIndex === index ? "Guardando..." : "Guardar"}
                              </button>
                              <button
                                className="ghost-button subtle"
                                type="button"
                                onClick={() => discardSuggestedIdea(index)}
                                disabled={ideaSavingIndex === index}
                              >
                                Descartar
                              </button>
                            </div>
                          </div>
                          <h4>{idea.titulo}</h4>
                          <p className="muted">{idea.angulo || "Ángulo pendiente de definir."}</p>
                          <p className="muted">Razón: {idea.razon || "—"}</p>
                          <div className="idea-meta">
                            <span>Esfuerzo: {idea.esfuerzo || "medio"}</span>
                            <span>CTA: {idea.cta || "n/a"}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : !ideaSuggestionsLoading && activeRun?.run?.id ? (
                  <p className="muted">Pulsa “Generar ideas” para obtener propuestas nuevas.</p>
                ) : !activeRun?.run?.id ? (
                  <p className="muted">Lanza una investigación para generar ideas.</p>
                ) : null}
              </div>

              <div className="ideas-block">
                <h3>Validar idea</h3>
                <div className="idea-form">
                  <label>Título</label>
                  <input
                    value={ideaTitle}
                    onChange={(event) => setIdeaTitle(event.target.value)}
                    placeholder="Ej: Arquitectura AI-first para equipos pequeños"
                  />
                  <label>Ángulo</label>
                  <textarea
                    rows={3}
                    value={ideaAngle}
                    onChange={(event) => setIdeaAngle(event.target.value)}
                    placeholder="Explica el enfoque, el experimento o el caso real..."
                  />
                  <label>Notas (opcional)</label>
                  <textarea
                    rows={3}
                    value={ideaNotes}
                    onChange={(event) => setIdeaNotes(event.target.value)}
                    placeholder="Contexto, ejemplos, recursos internos..."
                  />
                  <button
                    className={`action-button ${ideaValidationLoading ? "is-loading" : ""}`}
                    type="button"
                    onClick={validateIdea}
                    disabled={ideaValidationLoading || !activeRun?.run?.id}
                  >
                    {ideaValidationLoading ? "Validando..." : "Validar idea"}
                  </button>
                </div>
                {ideaValidationError ? <div className="error">{ideaValidationError}</div> : null}
                {ideaValidation ? (
                  <div className="validation-card">
                    <div className="validation-header">
                      <span className="score-pill">
                        {validationScore !== null ? `${validationScore} pts` : "—"}
                      </span>
                      <span className="pill">{ideaValidation.veredicto}</span>
                    </div>
                    <p className="muted">{ideaValidation.razon || "Sin explicación."}</p>
                    <div className="validation-grid">
                      <div>
                        <h4>Título refinado</h4>
                        <p>{ideaValidation.titulo_refinado || "—"}</p>
                      </div>
                      <div>
                        <h4>Ángulo refinado</h4>
                        <p className="muted">{ideaValidation.angulo_refinado || "—"}</p>
                      </div>
                      <div className="idea-meta">
                        <span>Esfuerzo: {ideaValidation.esfuerzo || "medio"}</span>
                        <span>CTA: {ideaValidation.cta || "n/a"}</span>
                      </div>
                    </div>
                    <div>
                      <h4>Mejoras sugeridas</h4>
                      <ul>
                        {asList(ideaValidation.mejoras).map((item: string, i: number) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="idea-card__actions">
                      <button className="ghost-button" type="button" onClick={applyValidation}>
                        Aplicar refinamiento
                      </button>
                      <button
                        className={`action-button ${ideaSavingValidation ? "is-loading" : ""}`}
                        type="button"
                        onClick={saveValidatedIdea}
                        disabled={ideaSavingValidation}
                      >
                        {ideaSavingValidation ? "Guardando..." : "Guardar idea"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="ideas-column">
              <div className="ideas-block">
                <div className="ideas-block__header">
                  <h3>Mis ideas guardadas</h3>
                  <span className="muted">
                    {savedIdeas.length ? `${savedIdeas.length} ideas` : "Sin ideas guardadas"}
                  </span>
                </div>
                {savedIdeasError ? <div className="error">{savedIdeasError}</div> : null}
                {savedIdeasLoading ? <p className="muted">Cargando ideas guardadas...</p> : null}
                {savedIdeas.length ? (
                  <div className="idea-grid">
                    {savedIdeas.map((idea: any) => {
                      const score = formatScore(idea.score);
                      return (
                        <article key={idea.id} className="idea-card saved">
                          <div className="idea-card__header">
                            <span className="score-pill">{score !== null ? `${score} pts` : "—"}</span>
                            <button
                              className="ghost-button subtle"
                              type="button"
                              onClick={() => deleteSavedIdea(idea.id)}
                              disabled={ideaDeletingId === idea.id}
                            >
                              {ideaDeletingId === idea.id ? "Eliminando..." : "Eliminar"}
                            </button>
                          </div>
                          <h4>{idea.title}</h4>
                          <p className="muted">{idea.angle || "Ángulo pendiente de definir."}</p>
                          <p className="muted">Razón: {idea.reason || "—"}</p>
                          <div className="idea-meta">
                            <span>Esfuerzo: {idea.effort || "medio"}</span>
                            <span>CTA: {idea.cta || "n/a"}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : !savedIdeasLoading ? (
                  <p className="muted">Guarda ideas sugeridas o validadas para verlas aquí.</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="panel plan">
          <div className="panel__header">
            <h2>Plan del mes</h2>
            <div className="actions-meta">
              <span className="muted">
                {monthPlanUpdatedAt ? `Actualizado ${formatAge(monthPlanUpdatedAt)}` : "Sin datos"}
              </span>
              <button
                className={`action-button ${monthPlanLoading ? "is-loading" : ""}`}
                onClick={() => activeRun?.run?.id && fetchMonthPlan(activeRun.run.id, true)}
                disabled={monthPlanLoading}
                aria-busy={monthPlanLoading}
              >
                {monthPlanLoading ? "Generando..." : "Regenerar plan"}
              </button>
            </div>
          </div>
          {monthPlanError ? <div className="error">{monthPlanError}</div> : null}
          {monthPlan ? (
            <div className="plan-grid month-plan-grid">
              <article className="month-plan-card month-plan-summary">
                <h3>{monthPlan.objetivo_mes || "Objetivo del mes"}</h3>
                <p className="muted">{monthPlan.motivo_cadencia}</p>
                <div className="plan-meta">
                  <span className="pill">{monthPlan.cadencia_recomendada}</span>
                  <span className="pill">{monthPlan.duracion_recomendada}</span>
                </div>
                {Array.isArray(monthPlan.metricas_clave) ? (
                  <ul>
                    {monthPlan.metricas_clave.map((metric: string, i: number) => (
                      <li key={i}>{metric}</li>
                    ))}
                  </ul>
                ) : null}
              </article>

              {(Array.isArray(monthPlan.videos) ? monthPlan.videos : []).map((video: any, index: number) => (
                <article key={index} className="month-plan-card">
                  <div className="plan-card__header">
                    <span className="action-pill">{video.semana || `Semana ${index + 1}`}</span>
                    <span className="pill">{video.esfuerzo || "medio"}</span>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => openVideoDetail(index)}
                    >
                      Detalle
                    </button>
                  </div>
                  <h3>{video.titulo}</h3>
                  <p className="muted">{video.angulo}</p>
                  <ul>
                    {asList(video.estructura).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                  <div className="action-meta">
                    <span>Duración: {video.duracion || "n/a"}</span>
                    <span>Horas: {video.horas_estimadas ?? "n/a"}h</span>
                  </div>
                  <p className="muted">CTA: {video.cta}</p>
                  <p className="muted">Razón: {video.razon}</p>
                </article>
              ))}
            </div>
          ) : monthPlanLoading ? (
            <p className="muted">Generando plan mensual...</p>
          ) : (
            <p className="muted">Pulsa “Regenerar plan” para obtener el plan del mes.</p>
          )}
        </section>

        <section className="panel focus">
          <div className="panel__header">
            <h2>Implicaciones del mercado</h2>
            <span>Última corrida</span>
          </div>
          <p className="muted">Señales que alimentan el plan del mes.</p>
          <div className="stats">
            <div className="stat">
              <p>Promedio de vistas</p>
              <h3>{stats ? stats.avgViews : "–"}</h3>
            </div>
            <div className="stat">
              <p>Duración media (s)</p>
              <h3>{stats ? stats.avgDuration : "–"}</h3>
            </div>
            <div className="stat">
              <p>Videos analizados</p>
              <h3>{activeRun?.stats?.videos ?? "–"}</h3>
            </div>
          </div>

          <div className="insights">
            <h3>Señales clave</h3>
            {insights ? (
              <div className="insights__grid">
                {insightEntries.map(([key, values]) => (
                  <div key={key} className="insight">
                    <h4>{key.replace(/_/g, " ")}</h4>
                    <ul>
                      {asList(values).map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Ejecuta una investigación para generar insights.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Score de autoridad</h2>
            <div className="actions-meta">
              <button
                className="action-button"
                onClick={() => setShowAuthority((value) => !value)}
                aria-expanded={showAuthority}
              >
                {showAuthority ? "Ocultar benchmark" : "Ver benchmark"}
              </button>
            </div>
          </div>
          <p className="muted">
            Score basado en profundidad, metodología, engagement relativo y recencia (con penalización de clickbait).
            Úsalo como benchmark del estándar de autoridad en tu nicho.
          </p>
          {!showAuthority ? (
            <p className="muted">
              Benchmark oculto. Úsalo cuando quieras comparar tu estándar con el mercado.
            </p>
          ) : authorityLoading ? (
            <div className="loading-card">
              <div className="loading-row">
                <span className="loading-spinner" aria-hidden="true" />
                <div>
                  <p className="loading-title">Calculando score de autoridad</p>
                  <p className="muted">Tiempo transcurrido: {authorityElapsed}</p>
                </div>
              </div>
              <div className="loading-bar" />
              <div className="loading-steps">
                <span className="loading-pill">Extrayendo señales</span>
                <span className="loading-pill">Normalizando scores</span>
                <span className="loading-pill">Ordenando top</span>
              </div>
              <p className="loading-hint">
                Esto puede tardar 30-90s. Si pasa de 2 minutos, usa “Refrescar todo”.
              </p>
            </div>
          ) : authorityError ? (
            <div className="error">
              <p>{authorityError}</p>
            </div>
          ) : authority ? (
            <div className="authority-grid">
              <div className="authority-card">
                <h3>Benchmarks</h3>
                <div className="authority-metrics">
                  <div>
                    <p>Score medio videos</p>
                    <strong>{authority.benchmarks?.avgVideoScore ?? 0}</strong>
                  </div>
                  <div>
                    <p>Score medio canales</p>
                    <strong>{authority.benchmarks?.avgChannelScore ?? 0}</strong>
                  </div>
                  <div>
                    <p>Top video</p>
                    <strong>{authority.benchmarks?.topVideoScore ?? 0}</strong>
                  </div>
                  <div>
                    <p>Top canal</p>
                    <strong>{authority.benchmarks?.topChannelScore ?? 0}</strong>
                  </div>
                </div>
              </div>

              <div className="authority-card">
                <h3>Canales con autoridad</h3>
                <div className="authority-list">
                {authority.channels?.map((channel: any) => (
                  <div key={channel.channelId} className="authority-row">
                    <div>
                      <a
                          className="link-reset bold"
                          href={`https://www.youtube.com/channel/${channel.channelId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {channel.title}
                        </a>
                        <span>{Number(channel.subscriberCount || 0).toLocaleString("es-ES")} subs</span>
                      </div>
                      <span className="score-pill">{channel.score}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="authority-card">
                <h3>Videos con autoridad</h3>
                <div className="authority-list">
                  {authority.videos?.slice(0, 8).map((video: any) => (
                    <div key={video.id} className="authority-row">
                      <div>
                        <a
                          className="link-reset bold"
                          href={`https://www.youtube.com/watch?v=${video.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {video.title}
                        </a>
                        <span>{video.channelTitle}</span>
                      </div>
                      <span className="score-pill">{video.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="muted">Ejecuta una investigación para calcular el score.</p>
          )}
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Mapa de temas</h2>
            <span>Clusters y gaps</span>
          </div>
          {topicsLoading ? (
            <div className="loading-card">
              <div className="loading-row">
                <span className="loading-spinner" aria-hidden="true" />
                <div>
                  <p className="loading-title">Generando clusters de temas</p>
                  <p className="muted">Tiempo transcurrido: {topicsElapsed}</p>
                </div>
              </div>
              <div className="loading-bar" />
              <div className="loading-steps">
                <span className="loading-pill">Agrupando tópicos</span>
                <span className="loading-pill">Detectando gaps</span>
                <span className="loading-pill">Sintetizando enfoque</span>
              </div>
              <p className="loading-hint">
                Esto puede tardar 30-90s. Si pasa de 2 minutos, usa “Refrescar todo”.
              </p>
            </div>
          ) : topicsError ? (
            <div className="error">
              <p>{topicsError}</p>
            </div>
          ) : topics ? (
            <div className="topics-layout">
              <div className="topics-column">
                <h3>Pilares (clusters)</h3>
                <div className="cluster-grid compact">
                  {(Array.isArray(topics.clusters) ? topics.clusters : []).map((cluster: any, index: number) => (
                    <article key={index} className="cluster-card">
                      <h4>{cluster.nombre}</h4>
                      <p>{cluster.descripcion}</p>
                      <ul>
                        {(Array.isArray(cluster.ejemplos) ? cluster.ejemplos : [])
                          .slice(0, 2)
                          .map((item: string, i: number) => (
                            <li key={i}>{item}</li>
                          ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>
              <div className="topics-column">
                <div className="topics-block">
                  <h3>Series recomendadas</h3>
                  <ul className="series-list">
                    {asList(topics.series_ideas).map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="topics-block">
                  <h3>Gaps y oportunidades</h3>
                  <div className="gap-list">
                    {asList(topics.gaps).map((gap: string, i: number) => (
                      <span key={i} className="gap-pill">
                        {gap}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="topics-block">
                  <h3>Enfoque de autoridad</h3>
                  <ul className="series-list">
                    {asList(topics.enfoque_autoridad).map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <p className="muted">Ejecuta una investigación para generar el mapa de temas.</p>
          )}
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Tu canal (Analytics)</h2>
            <span>Últimos 28 días</span>
          </div>
          {oauthRequired ? (
            <div className="oauth">
              <p className="muted">
                Conecta tu cuenta para comparar tu rendimiento real con el mercado.
              </p>
              <a className="oauth__link" href={`${API_BASE}/api/oauth/google/start?redirect=1`}>
                Conectar YouTube Analytics
              </a>
            </div>
          ) : analyticsError ? (
            <div className="error">
              <p>{analyticsError}</p>
            </div>
          ) : analytics ? (
            <>
              {analytics.includesShorts ? (
                <p className="muted">
                  Nota: estas métricas incluyen shorts porque la API no permite filtrarlos aquí.
                </p>
              ) : null}
              <div className="analytics-grid">
                <div className="stat">
                  <p>Vistas</p>
                  <h3>{Number(analytics.metrics?.views || 0).toLocaleString("es-ES")}</h3>
                </div>
                <div className="stat">
                  <p>Minutos vistos</p>
                  <h3>{Number(analytics.metrics?.estimatedMinutesWatched || 0).toLocaleString("es-ES")}</h3>
                </div>
                <div className="stat">
                  <p>Duración media (s)</p>
                  <h3>{Number(analytics.metrics?.averageViewDuration || 0).toFixed(0)}</h3>
                </div>
                <div className="stat">
                  <p>Subs ganados</p>
                  <h3>{Number(analytics.metrics?.subscribersGained || 0).toLocaleString("es-ES")}</h3>
                </div>
                <div className="stat">
                  <p>Subs perdidos</p>
                  <h3>{Number(analytics.metrics?.subscribersLost || 0).toLocaleString("es-ES")}</h3>
                </div>
              </div>
            </>
          ) : (
            <p className="muted">Cargando métricas...</p>
          )}
          {topVideosError ? <p className="muted">{topVideosError}</p> : null}
          {topVideos?.items?.length ? (
            <div className="top-videos">
              <div className="top-videos__header">
                <h3>Tus videos con más tracción</h3>
                <div className="filter-bar">
                  <span>Filtrar</span>
                  <div className="filters">
                    <button
                      className={`filter ${topFilter === "all" ? "active" : ""}`}
                      onClick={() => setTopFilter("all")}
                    >
                      Todos
                    </button>
                    <button
                      className={`filter ${topFilter === "ai" ? "active" : ""}`}
                      onClick={() => setTopFilter("ai")}
                    >
                      IA aplicada
                    </button>
                    <button
                      className={`filter ${topFilter === "dev" ? "active" : ""}`}
                      onClick={() => setTopFilter("dev")}
                    >
                      Dev general
                    </button>
                  </div>
                </div>
              </div>
              <div className="videos">
                {topVideosFiltered.map((item: any) => (
                  <article key={item.videoId} className="video-row">
                    <a
                      className="link-reset"
                      href={`https://www.youtube.com/watch?v=${item.videoId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={proxyImage(item.thumbnailUrl)}
                        onError={(event) => {
                          event.currentTarget.src = PLACEHOLDER_VIDEO;
                        }}
                        alt=""
                        loading="lazy"
                      />
                    </a>
                    <div>
                      <a
                        className="link-reset"
                        href={`https://www.youtube.com/watch?v=${item.videoId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <h4>{item.title}</h4>
                      </a>
                      <p>
                        {Number(item.views || 0).toLocaleString("es-ES")} vistas (90 días) ·{" "}
                        <span className={`tag ${item.category === "IA aplicada" ? "tag-ai" : "tag-dev"}`}>
                          {item.category}
                        </span>
                      </p>
                    </div>
                    <span className="pill">{Math.round((item.averageViewDuration || 0) / 60)} min</span>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Canales relevantes</h2>
            <span>Top 12</span>
          </div>
          <div className="channels">
            {activeRun?.channels?.map((channel) => (
              <article key={channel.channel_id} className="channel-card">
                <a
                  className="link-reset"
                  href={`https://www.youtube.com/channel/${channel.channel_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={proxyImage(channel.thumbnail_url, PLACEHOLDER_AVATAR)}
                    onError={(event) => {
                      event.currentTarget.src = PLACEHOLDER_AVATAR;
                    }}
                    alt=""
                    loading="lazy"
                  />
                </a>
                <div>
                  <a
                    className="link-reset"
                    href={`https://www.youtube.com/channel/${channel.channel_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <h4>{channel.title}</h4>
                  </a>
                  <p>{Number(channel.subscriber_count || 0).toLocaleString("es-ES")} subs</p>
                </div>
                <div className="channel-card__meta">
                  <span>{channel.videos_count} videos</span>
                  <span>{Number(channel.total_views || 0).toLocaleString("es-ES")} vistas</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Videos con tracción</h2>
            <span>Top 30</span>
          </div>
          <div className="videos">
            {activeRun?.videos?.map((video) => (
              <article key={video.id} className="video-row">
                <a
                  className="link-reset"
                  href={`https://www.youtube.com/watch?v=${video.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={proxyImage(video.thumbnail_url)}
                    onError={(event) => {
                      event.currentTarget.src = PLACEHOLDER_VIDEO;
                    }}
                    alt=""
                    loading="lazy"
                  />
                </a>
                <div>
                  <a
                    className="link-reset"
                    href={`https://www.youtube.com/watch?v=${video.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <h4>{video.title}</h4>
                  </a>
                  <p>
                    {video.channel_title} · {Number(video.view_count || 0).toLocaleString("es-ES")} vistas
                  </p>
                </div>
                <span className="pill">{Math.round((video.duration_seconds || 0) / 60)} min</span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Inspiración global</h2>
            <div className="actions-meta">
              <span className="muted">
                {globalUpdatedAt ? `Actualizado ${formatAge(globalUpdatedAt)}` : "Sin datos"}
              </span>
              <button
                className={`action-button ${globalLoading ? "is-loading" : ""}`}
                onClick={() => activeRun?.run?.id && fetchGlobalInspiration(activeRun.run.id, true)}
                disabled={globalLoading}
                aria-busy={globalLoading}
              >
                {globalLoading ? "Actualizando..." : "Actualizar"}
              </button>
            </div>
          </div>
          {globalError ? <div className="error">{globalError}</div> : null}
          {globalInspiration ? (
            <div className="global-grid">
              <div>
                <p className="muted">Query: {globalInspiration.query}</p>
                <div className="global-section">
                  <h3>Formatos importables</h3>
                  <ul className="series-list">
                    {asList(globalInspiration.insights?.formatos).map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="global-section">
                  <h3>Series que funcionan fuera</h3>
                  <ul className="series-list">
                    {asList(globalInspiration.insights?.series_ideas).map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="global-section">
                  <h3>Tendencias</h3>
                  <ul className="series-list">
                    {asList(globalInspiration.insights?.tendencias).map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="global-section">
                  <h3>Ángulos clave</h3>
                  <ul className="series-list">
                    {asList(globalInspiration.insights?.angulos_clave).map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div>
                <h3>Videos globales con tracción</h3>
                <div className="videos">
                  {(Array.isArray(globalInspiration.videos) ? globalInspiration.videos : []).map((video: any) => (
                    <article key={video.id} className="video-row">
                      <a
                        className="link-reset"
                        href={`https://www.youtube.com/watch?v=${video.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={proxyImage(video.thumbnailUrl)}
                          onError={(event) => {
                            event.currentTarget.src = PLACEHOLDER_VIDEO;
                          }}
                          alt=""
                          loading="lazy"
                        />
                      </a>
                      <div>
                        <a
                          className="link-reset"
                          href={`https://www.youtube.com/watch?v=${video.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <h4>{video.title}</h4>
                        </a>
                        <p>
                          {video.channelTitle} · {Number(video.viewCount || 0).toLocaleString("es-ES")} vistas
                        </p>
                      </div>
                      <span className="pill">{Math.round((video.durationSeconds || 0) / 60)} min</span>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          ) : globalLoading ? (
            <p className="muted">Cargando inspiración global...</p>
          ) : (
            <p className="muted">Pulsa “Actualizar” para cargar inspiración global.</p>
          )}
        </section>
      </main>
      {videoDetailOpen ? (
        <div className="detail-overlay" onClick={closeVideoDetail}>
          <div className="detail-panel" onClick={(event) => event.stopPropagation()}>
            <div className="detail-header">
              <div>
                <p className="detail-label">Detalle de vídeo</p>
                <h3>{videoDetail?.video?.titulo || "Video del mes"}</h3>
              </div>
              <button className="ghost-button" onClick={closeVideoDetail}>
                Cerrar
              </button>
            </div>
            {videoDetailError ? <div className="error">{videoDetailError}</div> : null}
            {videoDetailLoading ? (
              <p className="muted">Cargando detalle...</p>
            ) : videoDetail ? (
              <div className="detail-body">
                <div className="detail-block">
                  <h4>Contexto</h4>
                  <p className="muted">{videoDetail.video?.angulo}</p>
                  <div className="detail-meta">
                    <span>Duración: {videoDetail.video?.duracion || "n/a"}</span>
                    <span>Esfuerzo: {videoDetail.video?.esfuerzo || "n/a"}</span>
                    <span>Horas: {videoDetail.video?.horas_estimadas ?? "n/a"}h</span>
                  </div>
                  <p className="muted">CTA: {videoDetail.video?.cta}</p>
                  <p className="muted">Razón: {videoDetail.video?.razon}</p>
                  <h4>Estructura base</h4>
                  <ul>
                    {asList(videoDetail.video?.estructura).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="detail-block">
                  <div className="detail-header-row">
                    <h4>Notas</h4>
                    <button
                      className={`action-button ${notesSaving ? "is-loading" : ""}`}
                      onClick={saveVideoNotes}
                      disabled={notesSaving}
                    >
                      {notesSaving ? "Guardando..." : "Guardar notas"}
                    </button>
                  </div>
                  <textarea
                    className="notes-area"
                    rows={6}
                    value={videoNotes}
                    onChange={(event) => setVideoNotes(event.target.value)}
                    placeholder="Apunta ideas, ejemplos, recursos o puntos clave..."
                  />
                </div>

                <div className="detail-block">
                  <h4>Chat de guion</h4>
                  <div className="chat">
                    {(videoDetail.messages || []).map((msg: any, index: number) => (
                      <div key={index} className={`chat-message ${msg.role === "user" ? "user" : "assistant"}`}>
                        <p>{msg.content}</p>
                      </div>
                    ))}
                  </div>
                  <div className="chat-input">
                    <textarea
                      rows={3}
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="Pide el guion, mejora el hook, estructura, etc."
                    />
                    <button
                      className={`action-button ${chatSending ? "is-loading" : ""}`}
                      onClick={sendChatMessage}
                      disabled={chatSending}
                    >
                      {chatSending ? "Enviando..." : "Enviar"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="muted">Selecciona un vídeo del plan para abrir el detalle.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
  async function fetchInsights(runId: number, refresh = false) {
    setTopicsLoading(true);
    setAuthorityLoading(true);
    setTopicsError(null);
    setAuthorityError(null);
    setTopicsStartedAt(Date.now());
    setAuthorityStartedAt(Date.now());
    try {
      const [insightsRes, topicsRes, authorityRes] = await Promise.all([
        fetch(
          `${API_BASE}/api/insights/overview?runId=${runId}${refresh ? "&refresh=1" : ""}`
        ),
        fetch(`${API_BASE}/api/insights/topics?runId=${runId}${refresh ? "&refresh=1" : ""}`),
        fetch(`${API_BASE}/api/analysis/authority?runId=${runId}`),
      ]);

      const insightsData = await insightsRes.json().catch(() => null);
      if (insightsRes.ok) {
        setInsights(insightsData?.insights || null);
        setOverviewUpdatedAt(insightsData?.updatedAt || null);
      } else {
        setInsights(null);
      }

      const topicsData = await topicsRes.json().catch(() => null);
      if (topicsRes.ok) {
        setTopics(topicsData?.insights || null);
        setTopicsUpdatedAt(topicsData?.updatedAt || null);
        setTopicsError(null);
      } else {
        setTopics(null);
        setTopicsError(topicsData?.error || "No se pudieron generar los temas.");
      }

      const authorityData = await authorityRes.json().catch(() => null);
      if (authorityRes.ok) {
        setAuthority(authorityData || null);
        setAuthorityError(null);
      } else {
        setAuthority(null);
        setAuthorityError(authorityData?.error || "No se pudo calcular el score de autoridad.");
      }
    } catch (err: any) {
      setTopics(null);
      setAuthority(null);
      setTopicsError(err?.message || "No se pudieron generar los temas.");
      setAuthorityError(err?.message || "No se pudo calcular el score de autoridad.");
    } finally {
      setTopicsLoading(false);
      setAuthorityLoading(false);
    }
  }

  async function refreshAllInsights() {
    if (!activeRun?.run?.id) return;
    setInsightsRefreshing(true);
    await Promise.all([
      fetchInsights(activeRun.run.id, true),
      fetchMonthPlan(activeRun.run.id, true),
    ]);
    setInsightsRefreshing(false);
  }
}
