import type { ChorusProvider, ProviderRole } from "./types";
import { OpenAIProvider } from "./openai";

export type { ChorusProvider, ChorusMessage, ProviderRole, TokenDelta } from "./types";

const cache = new Map<string, ChorusProvider>();

const ROLES: readonly ProviderRole[] = ["host", "role", "summary"];

// Hosts that must never be reachable as an OpenAI base URL — cloud metadata
// endpoints are the classic SSRF target (would leak the API key as Bearer).
const BLOCKED_BASE_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "100.100.100.200", // Alibaba Cloud metadata
]);

/** Returns an issue string if OPENAI_BASE_URL is malformed/unsafe, else null. */
function validateBaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "OPENAI_BASE_URL is not a valid URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "OPENAI_BASE_URL must be http(s)";
  }
  if (BLOCKED_BASE_HOSTS.has(url.hostname.toLowerCase())) {
    return "OPENAI_BASE_URL points at a blocked metadata host";
  }
  return null;
}

/** Returns a list of human-readable issues, empty if env is healthy. */
export function validateProviderEnv(): string[] {
  const issues: string[] = [];
  let needsOpenAI = false;
  for (const role of ROLES) {
    const provider = process.env[`CHORUS_PROVIDER_${role.toUpperCase()}`] || "openai";
    if (provider === "openai") needsOpenAI = true;
    else if (provider !== "openai") {
      issues.push(`unknown provider "${provider}" for ${role}`);
    }
  }
  if (needsOpenAI && !process.env.OPENAI_API_KEY?.trim()) {
    issues.push("OPENAI_API_KEY is required (set in .env.local)");
  }
  const baseUrlIssue = validateBaseUrl(process.env.OPENAI_BASE_URL?.trim());
  if (baseUrlIssue) issues.push(baseUrlIssue);
  return issues;
}

function envFor(role: ProviderRole) {
  const providerKey = `CHORUS_PROVIDER_${role.toUpperCase()}`;
  const provider = process.env[providerKey] || "openai";
  let model: string;
  switch (provider) {
    case "openai":
      model = process.env[`OPENAI_MODEL_${role.toUpperCase()}`] || "gpt-4o-mini";
      return { provider, model };
    default:
      throw new Error(`Unknown provider for ${role}: ${provider}`);
  }
}

export function getProvider(role: ProviderRole): ChorusProvider {
  const { provider, model } = envFor(role);
  const cacheKey = `${provider}:${model}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  let instance: ChorusProvider;
  switch (provider) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");
      const baseURL = process.env.OPENAI_BASE_URL || undefined;
      instance = new OpenAIProvider({ apiKey, model, baseURL });
      break;
    }
    default:
      throw new Error(`Provider not implemented: ${provider}`);
  }
  cache.set(cacheKey, instance);
  return instance;
}
