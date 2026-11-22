const localDevelopmentOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:4173",
];

function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

export function getMessageFunctionCors(origin, configuredOrigins = "") {
  const allowedOrigins = new Set(localDevelopmentOrigins);
  for (const configuredOrigin of configuredOrigins.split(",")) {
    const normalized = normalizeOrigin(configuredOrigin);
    if (normalized) allowedOrigins.add(normalized);
  }

  const normalizedRequestOrigin = normalizeOrigin(origin);
  const originAllowed = !origin || (
    normalizedRequestOrigin === origin && allowedOrigins.has(normalizedRequestOrigin)
  );
  const headers = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (originAllowed && normalizedRequestOrigin) {
    headers["Access-Control-Allow-Origin"] = normalizedRequestOrigin;
  }

  return { allowed: originAllowed, headers };
}
