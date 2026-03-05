import type { AdapterModel } from "./types.js";
import { models as opencodeFallbackModels } from "@paperclipai/adapter-opencode-local";
import { execFile } from "node:child_process";

const OPENCODE_MODELS_TIMEOUT_MS = 10_000;
const OPENCODE_MODELS_CACHE_TTL_MS = 60_000;

let cached: { expiresAt: number; models: AdapterModel[] } | null = null;

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function mergedWithFallback(models: AdapterModel[]): AdapterModel[] {
  return dedupeModels([
    ...models,
    ...opencodeFallbackModels,
  ]).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
}

/**
 * Format a provider/model ID into a human-readable label.
 * e.g. "anthropic/claude-sonnet-4-20250514" -> "anthropic / claude-sonnet-4-20250514"
 *      "opencode/gpt-5-nano" -> "opencode / gpt-5-nano"
 */
function modelIdToLabel(id: string): string {
  if (id.includes("/")) {
    const [provider, model] = id.split("/", 2);
    return `${provider} / ${model}`;
  }
  return id;
}

function fetchOpenCodeModels(): Promise<AdapterModel[]> {
  return new Promise((resolve) => {
    const proc = execFile(
      "opencode",
      ["models"],
      {
        timeout: OPENCODE_MODELS_TIMEOUT_MS,
        env: { ...process.env },
      },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        const models: AdapterModel[] = [];
        for (const line of stdout.split(/\r?\n/)) {
          const id = line.trim();
          if (!id) continue;
          // Each line is "provider/model" format
          models.push({ id, label: modelIdToLabel(id) });
        }
        resolve(dedupeModels(models));
      },
    );

    // Safety net: if the process somehow hangs beyond the timeout
    proc.on("error", () => resolve([]));
  });
}

export async function listOpenCodeModels(): Promise<AdapterModel[]> {
  const fallback = dedupeModels(opencodeFallbackModels);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.models;
  }

  const fetched = await fetchOpenCodeModels();
  if (fetched.length > 0) {
    const merged = mergedWithFallback(fetched);
    cached = {
      expiresAt: now + OPENCODE_MODELS_CACHE_TTL_MS,
      models: merged,
    };
    return merged;
  }

  if (cached && cached.models.length > 0) {
    return cached.models;
  }

  return fallback;
}

export function resetOpenCodeModelsCacheForTests() {
  cached = null;
}
