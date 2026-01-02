# YouTube Authority Radar

MVP local para investigar YouTube en español sobre IA aplicada al desarrollo de software y generar insights de autoridad.

## Requisitos
- Docker + Docker Compose
- API key de YouTube Data API v3
- API key de Gemini

Nota: la base de datos expone el puerto 5433 en tu host (5432 interno del contenedor).

## Quickstart
1. Copia `.env.example` a `.env` y rellena las keys.
2. Copia tu `client_secrets.json` de Google a `apps/backend/client_secrets.json` (o configura `GOOGLE_OAUTH_CLIENT_SECRET_PATH`).
3. Levanta servicios:
   ```bash
   docker compose up --build
   ```

Nota: el valor `GOOGLE_OAUTH_CLIENT_SECRET_PATH` en `.env` apunta a `/app/client_secrets.json` (ruta dentro del contenedor). Si ejecutas el backend fuera de Docker, usa una ruta local como `./client_secrets.json`.

OAuth: asegúrate de que en Google Cloud el **Redirect URI** incluya `http://localhost:8080/api/oauth/google/callback`.
3. Abre el dashboard: `http://localhost:5173`

## CLI
Desde `apps/cli`:
```bash
go run . --query "IA aplicada al desarrollo de software" --max 25
```

## Endpoints
- POST `/api/ingest/youtube`
- GET `/api/runs`
- GET `/api/runs/:id`
- GET `/api/insights/overview?runId=ID`
- GET `/api/insights/topics?runId=ID`
- GET `/api/insights/next-actions?runId=ID`
- GET `/api/plan/month?runId=ID`
- GET `/api/plan/month/video?runId=ID&index=0&planUpdatedAt=ISO`
- POST `/api/plan/month/video/notes`
- POST `/api/plan/month/video/chat`
- GET `/api/decision/next?runId=ID`
- GET `/api/ideas/suggest?runId=ID`
- GET `/api/ideas?runId=ID`
- POST `/api/ideas`
- DELETE `/api/ideas/:id`
- POST `/api/ideas/validate`
- GET `/api/inspiration/global?runId=ID`
- GET `/api/analysis/authority?runId=ID`
- GET `/api/oauth/google/start`
- GET `/api/oauth/google/callback`
- GET `/api/analytics/summary`
- GET `/api/analytics/top-videos`
