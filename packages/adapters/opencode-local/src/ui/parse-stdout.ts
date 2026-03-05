import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  const rec = asRecord(value);
  if (!rec) return "";
  const msg =
    (typeof rec.message === "string" && rec.message) ||
    (typeof rec.error === "string" && rec.error) ||
    (typeof rec.code === "string" && rec.code) ||
    "";
  if (msg) return msg;
  try {
    return JSON.stringify(rec);
  } catch {
    return "";
  }
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Parse a single line of OpenCode JSON output into transcript entries.
 *
 * OpenCode event types:
 * - step_start:  { type: "step_start",  sessionID, part: { type: "step-start", snapshot } }
 * - text:        { type: "text",        sessionID, part: { type: "text", text, time, metadata } }
 * - tool_use:    { type: "tool_use",    sessionID, part: { type: "tool", callID, tool, state: { status, input, output, error, time } } }
 * - step_finish: { type: "step_finish", sessionID, part: { type: "step-finish", reason, cost, tokens } }
 * - error:       { type: "error",       sessionID, error: { name, data: { message } } }
 */
export function parseOpenCodeStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) {
    return [{ kind: "stdout", ts, text: line }];
  }

  const type = asString(parsed.type);
  const part = asRecord(parsed.part);

  if (type === "step_start") {
    const sessionId = asString(parsed.sessionID);
    return [{
      kind: "init",
      ts,
      model: "opencode",
      sessionId,
    }];
  }

  if (type === "text" && part) {
    const text = asString(part.text);
    if (text) return [{ kind: "assistant", ts, text }];
    return [];
  }

  if (type === "tool_use" && part) {
    const toolName = asString(part.tool, "unknown");
    const callID = asString(part.callID);
    const state = asRecord(part.state);
    const status = asString(state?.status, "");

    if (status === "pending" || status === "running" || !state) {
      // Tool call started
      return [{
        kind: "tool_call",
        ts,
        name: toolName,
        input: state?.input ?? {},
      }];
    }

    // Tool call completed
    const output = state?.output;
    const error = state?.error;
    const isError = status === "error" || typeof error === "string";

    let content = "";
    if (typeof error === "string" && error) {
      content = error;
    } else if (typeof output === "string") {
      content = output;
    } else if (output !== null && output !== undefined) {
      content = stringifyUnknown(output);
    }

    // Emit both tool_call and tool_result for completed events
    const entries: TranscriptEntry[] = [];
    if (state?.input !== undefined) {
      entries.push({
        kind: "tool_call",
        ts,
        name: toolName,
        input: state.input,
      });
    }
    entries.push({
      kind: "tool_result",
      ts,
      toolUseId: callID || toolName,
      content: content || "completed",
      isError,
    });
    return entries;
  }

  if (type === "step_finish" && part) {
    const tokens = asRecord(part.tokens);
    const cache = asRecord(tokens?.cache);
    const inputTokens = asNumber(tokens?.input);
    const outputTokens = asNumber(tokens?.output);
    const cachedTokens = asNumber(cache?.read);
    const costUsd = asNumber(part.cost);
    const reason = asString(part.reason);
    const isError = reason === "error" || reason === "failed";

    return [{
      kind: "result",
      ts,
      text: "",
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd,
      subtype: reason,
      isError,
      errors: [],
    }];
  }

  if (type === "error") {
    const errorObj = asRecord(parsed.error);
    const data = asRecord(errorObj?.data);
    const message = asString(data?.message, "") || asString(errorObj?.name, "") || errorText(parsed.error);
    return [{ kind: "stderr", ts, text: message || line }];
  }

  return [{ kind: "stdout", ts, text: line }];
}
