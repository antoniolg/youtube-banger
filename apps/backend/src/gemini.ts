const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is required");
  return key;
}

export async function generateInsights(prompt: string, schema?: Record<string, any>) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${getApiKey()}`;
  const generationConfig: Record<string, any> = { temperature: 0.4 };
  if (schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = schema;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API returned empty content");
  }
  return parseGeminiJson(text) ?? { raw: text };
}

export async function generateText(prompt: string) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${getApiKey()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API returned empty content");
  }
  return text;
}

export function normalizeGeminiInsight(value: any) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return parseGeminiJson(value) ?? { raw: value };
  }
  if (typeof value === "object" && typeof value.raw === "string") {
    return parseGeminiJson(value.raw) ?? value;
  }
  return value;
}

function parseGeminiJson(text: string) {
  const trimmed = text.trim();
  const candidates: string[] = [];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  candidates.push(trimmed);

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    const cleaned = candidate.replace(/^json\s*/i, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      continue;
    }
  }
  return null;
}
