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
  const [overviewUpdatedAt, setOverviewUpdatedAt] = useState<string | null>(null);
  const [topicsUpdatedAt, setTopicsUpdatedAt] = useState<string | null>(null);
  const [nextActions, setNextActions] = useState<any>(null);
  const [nextActionsError, setNextActionsError] = useState<string | null>(null);
  const [nextActionsLoading, setNextActionsLoading] = useState(false);
  const [nextActionsUpdatedAt, setNextActionsUpdatedAt] = useState<string | null>(null);
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
    await fetchInsights(runId);
    fetchNextActions(runId);
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

  async function fetchNextActions(runId: number, refresh = false) {
    setNextActionsLoading(true);
    setNextActionsError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/insights/next-actions?runId=${runId}${refresh ? "&refresh=1" : ""}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudieron generar acciones.");
      }
      setNextActions(data.insights || null);
      setNextActionsUpdatedAt(data.updatedAt || null);
    } catch (err: any) {
      setNextActionsError(err.message);
      setNextActions(null);
    } finally {
      setNextActionsLoading(false);
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
    const dates = [overviewUpdatedAt, topicsUpdatedAt, nextActionsUpdatedAt]
      .filter(Boolean)
      .map((value) => new Date(value as string).getTime())
      .filter((value) => Number.isFinite(value));
    if (!dates.length) return null;
    return new Date(Math.max(...dates)).toISOString();
  }, [overviewUpdatedAt, topicsUpdatedAt, nextActionsUpdatedAt]);

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

        <section className="panel actions">
          <div className="panel__header">
            <h2>Próximas acciones</h2>
            <div className="actions-meta">
              <span className="muted">
                {nextActionsUpdatedAt ? `Actualizado ${formatAge(nextActionsUpdatedAt)}` : "Sin datos"}
              </span>
              <button
                className={`action-button ${nextActionsLoading ? "is-loading" : ""}`}
                onClick={() => activeRun?.run?.id && fetchNextActions(activeRun.run.id, true)}
                disabled={nextActionsLoading}
                aria-busy={nextActionsLoading}
              >
                {nextActionsLoading ? "Regenerando..." : "Regenerar"}
              </button>
            </div>
          </div>
          {nextActionsError ? <div className="error">{nextActionsError}</div> : null}
          {nextActions ? (
            <div className="actions-grid">
              {(Array.isArray(nextActions.acciones) ? nextActions.acciones : []).map(
                (action: any, index: number) => (
                  <article key={index} className="action-card">
                    <div className="action-card__header">
                      <span className="action-pill">Acción {action.prioridad ?? index + 1}</span>
                      <h3>{action.titulo}</h3>
                    </div>
                    <p className="muted">{action.por_que}</p>
                    <ul>
                      {asList(action.pasos).map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                    <div className="action-meta">
                      <span>Tiempo: {action.tiempo_estimado || "n/a"}</span>
                      <span>KPI: {asList(action.kpi).join(", ")}</span>
                    </div>
                  </article>
                )
              )}
              <article className="action-card plan-card">
                <h3>Plan 30 días</h3>
                <div className="plan-grid">
                  {(Array.isArray(nextActions.plan_30_dias) ? nextActions.plan_30_dias : []).map(
                    (week: any, index: number) => (
                      <div key={index} className="plan-week">
                        <h4>{week.semana || `Semana ${index + 1}`}</h4>
                        <p className="muted">{week.objetivo}</p>
                        <ul>
                          {asList(week.entregables).map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )
                  )}
                </div>
              </article>
              {Array.isArray(nextActions.metricas_clave) ? (
                <article className="action-card">
                  <h3>Métricas clave</h3>
                  <ul>
                    {nextActions.metricas_clave.map((metric: string, i: number) => (
                      <li key={i}>{metric}</li>
                    ))}
                  </ul>
                </article>
              ) : null}
              {Array.isArray(nextActions.alertas) && nextActions.alertas.length ? (
                <article className="action-card">
                  <h3>Alertas</h3>
                  <ul>
                    {nextActions.alertas.map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </article>
              ) : null}
            </div>
          ) : nextActionsLoading ? (
            <p className="muted">Generando acciones prácticas...</p>
          ) : (
            <p className="muted">Pulsa “Regenerar” para obtener acciones.</p>
          )}
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Historial de exploraciones</h2>
            <span>{runs.length} runs</span>
          </div>
          <div className="runs">
            {runs.map((run) => (
              <button
                key={run.id}
                className={`run-card ${activeRun?.run?.id === run.id ? "active" : ""}`}
                onClick={() => loadRun(run.id)}
              >
                <div>
                  <p className="run-card__query">{run.query}</p>
                  <p className="run-card__meta">
                    {new Date(run.created_at).toLocaleString("es-ES")}
                  </p>
                </div>
                <span>{run.video_count ?? 0} videos</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel focus">
          <div className="panel__header">
            <h2>Lectura rápida del mercado</h2>
            <span>Última corrida</span>
          </div>
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
            <h3>Señales de autoridad</h3>
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
            <span>Top señales</span>
          </div>
          {authorityLoading ? (
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
            <div className="topics-grid">
              <div className="topics-section">
                <h3>Clusters dominantes</h3>
                <div className="cluster-grid">
                  {(Array.isArray(topics.clusters) ? topics.clusters : []).map((cluster: any, index: number) => (
                    <article key={index} className="cluster-card">
                      <h4>{cluster.nombre}</h4>
                      <p>{cluster.descripcion}</p>
                      <ul>
                        {(Array.isArray(cluster.ejemplos) ? cluster.ejemplos : []).map((item: string, i: number) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>
              <div className="topics-section">
                <h3>Gaps y oportunidades</h3>
                <div className="gap-list">
                  {asList(topics.gaps).map((gap: string, i: number) => (
                    <span key={i} className="gap-pill">
                      {gap}
                    </span>
                  ))}
                </div>
                <h3>Series recomendadas</h3>
                <ul className="series-list">
                  {asList(topics.series_ideas).map((item: string, i: number) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="topics-section">
                <h3>Enfoque de autoridad</h3>
                <ul className="series-list">
                  {asList(topics.enfoque_autoridad).map((item: string, i: number) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
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
      </main>
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
      fetchNextActions(activeRun.run.id, true),
    ]);
    setInsightsRefreshing(false);
  }
}
