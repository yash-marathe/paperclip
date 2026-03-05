import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Timer,
  Slash,
} from "lucide-react";
import { asRecord } from "../../lib/utils";

export type RunLogChunk = { ts: string; stream: "stdout" | "stderr" | "system"; chunk: string };

export const runStatusIcons: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  succeeded: { icon: CheckCircle2, color: "text-green-600 dark:text-green-400" },
  failed: { icon: XCircle, color: "text-red-600 dark:text-red-400" },
  running: { icon: Loader2, color: "text-cyan-600 dark:text-cyan-400" },
  queued: { icon: Clock, color: "text-yellow-600 dark:text-yellow-400" },
  timed_out: { icon: Timer, color: "text-orange-600 dark:text-orange-400" },
  cancelled: { icon: Slash, color: "text-neutral-500 dark:text-neutral-400" },
};

export const sourceLabels: Record<string, string> = {
  timer: "Timer",
  assignment: "Assignment",
  on_demand: "On-demand",
  automation: "Automation",
};

export const REDACTED_ENV_VALUE = "***REDACTED***";
const SECRET_ENV_KEY_RE =
  /(api[-_]?key|access[-_]?token|auth(?:_?token)?|authorization|bearer|secret|passwd|password|credential|jwt|private[-_]?key|cookie|connectionstring)/i;
const JWT_VALUE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/;

export function shouldRedactSecretValue(key: string, value: unknown): boolean {
  if (SECRET_ENV_KEY_RE.test(key)) return true;
  if (typeof value !== "string") return false;
  return JWT_VALUE_RE.test(value);
}

export function redactEnvValue(key: string, value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "secret_ref"
  ) {
    return "***SECRET_REF***";
  }
  if (shouldRedactSecretValue(key, value)) return REDACTED_ENV_VALUE;
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatEnvForDisplay(envValue: unknown): string {
  const env = asRecord(envValue);
  if (!env) return "<unable-to-parse>";

  const keys = Object.keys(env);
  if (keys.length === 0) return "<empty>";

  return keys
    .sort()
    .map((key) => `${key}=${redactEnvValue(key, env[key])}`)
    .join("\n");
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const LIVE_SCROLL_BOTTOM_TOLERANCE_PX = 32;
type ScrollContainer = Window | HTMLElement;
export type { ScrollContainer };

export function isWindowContainer(container: ScrollContainer): container is Window {
  return container === window;
}

function isElementScrollContainer(element: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

export function findScrollContainer(anchor: HTMLElement | null): ScrollContainer {
  let parent = anchor?.parentElement ?? null;
  while (parent) {
    if (isElementScrollContainer(parent)) return parent;
    parent = parent.parentElement;
  }
  return window;
}

export function readScrollMetrics(container: ScrollContainer): { scrollHeight: number; distanceFromBottom: number } {
  if (isWindowContainer(container)) {
    const pageHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    const viewportBottom = window.scrollY + window.innerHeight;
    return {
      scrollHeight: pageHeight,
      distanceFromBottom: Math.max(0, pageHeight - viewportBottom),
    };
  }

  const viewportBottom = container.scrollTop + container.clientHeight;
  return {
    scrollHeight: container.scrollHeight,
    distanceFromBottom: Math.max(0, container.scrollHeight - viewportBottom),
  };
}

export function scrollToContainerBottom(container: ScrollContainer, behavior: ScrollBehavior = "auto") {
  if (isWindowContainer(container)) {
    const pageHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    window.scrollTo({ top: pageHeight, behavior });
    return;
  }

  container.scrollTo({ top: container.scrollHeight, behavior });
}

export type AgentDetailView = "overview" | "configure" | "runs";

export function parseAgentDetailView(value: string | null): AgentDetailView {
  if (value === "configure" || value === "configuration") return "configure";
  if (value === "runs") return value;
  return "overview";
}
