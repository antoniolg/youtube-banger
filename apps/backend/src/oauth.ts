import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { pool } from "./db.js";

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

type ClientSecrets = {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
};

type TokenRow = {
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  token_type: string | null;
  expiry_date: number | null;
};

function loadClientSecrets(): ClientSecrets {
  const envId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const envRedirect = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (envId && envSecret && envRedirect) {
    return { client_id: envId, client_secret: envSecret, redirect_uris: [envRedirect] };
  }

  const secretPath =
    process.env.GOOGLE_OAUTH_CLIENT_SECRET_PATH ||
    path.join(process.cwd(), "client_secrets.json");
  if (!fs.existsSync(secretPath)) {
    throw new Error("OAuth client secrets not found. Set GOOGLE_OAUTH_CLIENT_SECRET_PATH or env vars.");
  }
  const raw = fs.readFileSync(secretPath, "utf8");
  const parsed = JSON.parse(raw);
  const payload = parsed.installed || parsed.web;
  if (!payload?.client_id || !payload?.client_secret) {
    throw new Error("Invalid client secrets file");
  }
  return {
    client_id: payload.client_id,
    client_secret: payload.client_secret,
    redirect_uris: payload.redirect_uris || [],
  };
}

function getOAuthClient() {
  const secrets = loadClientSecrets();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || secrets.redirect_uris?.[0];
  if (!redirectUri) {
    throw new Error("GOOGLE_OAUTH_REDIRECT_URI is required");
  }
  const client = new google.auth.OAuth2(secrets.client_id, secrets.client_secret, redirectUri);
  return client;
}

export function getAuthUrl(scopes = DEFAULT_SCOPES) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  await saveTokens(tokens);
  return tokens;
}

export async function getAuthorizedClient() {
  const client = getOAuthClient();
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error("OAuth not connected");
  }
  client.setCredentials(tokens);
  const refreshed = await client.getAccessToken();
  if (refreshed?.token) {
    await saveTokens(client.credentials);
  }
  return client;
}

async function loadTokens(): Promise<TokenRow | null> {
  const result = await pool.query("SELECT * FROM oauth_tokens WHERE provider = 'google'");
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    scope: row.scope,
    token_type: row.token_type,
    expiry_date: row.expiry_date,
  };
}

async function saveTokens(tokens: any) {
  await pool.query(
    `INSERT INTO oauth_tokens (provider, access_token, refresh_token, scope, token_type, expiry_date, updated_at)
     VALUES ('google', $1, $2, $3, $4, $5, NOW())
     ON CONFLICT (provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
       scope = COALESCE(EXCLUDED.scope, oauth_tokens.scope),
       token_type = COALESCE(EXCLUDED.token_type, oauth_tokens.token_type),
       expiry_date = COALESCE(EXCLUDED.expiry_date, oauth_tokens.expiry_date),
       updated_at = NOW()`,
    [
      tokens.access_token || null,
      tokens.refresh_token || null,
      tokens.scope || null,
      tokens.token_type || null,
      tokens.expiry_date || null,
    ]
  );
}

export { DEFAULT_SCOPES };
