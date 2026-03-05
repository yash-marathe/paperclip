import { asString, asNumber, parseObject, parseJson } from "@paperclipai/adapter-utils/server-utils";

/**
 * OpenCode JSON event types (from `opencode run --format json`):
 *
 * - step_start:  { type: "step_start",  sessionID, part: { type: "step-start", snapshot, ... } }
 * - text:        { type: "text",        sessionID, part: { type: "text", text, ... } }
 * - tool_use:    { type: "tool_use",    sessionID, part: { type: "tool", callID, tool, state: { status, input, output, error, ... }, ... } }
 * - step_finish: { type: "step_finish", sessionID, part: { type: "step-finish", reason, cost, tokens: { total, input, output, reasoning, cache: { read, write } }, ... } }
 * - error:       { type: "error",       sessionID, error: { name, data: { message } } }
 */

export function parseOpenCodeJsonl(stdout: string) {
  let sessionId: string | null = null;
  const messages: string[] = [];
  let errorMessage: string | null = null;
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
  let costUsd = 0;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const event = parseJson(line);
    if (!event) continue;

    const type = asString(event.type, "");
    const eventSessionId = asString(event.sessionID, "");
    if (eventSessionId && !sessionId) {
      sessionId = eventSessionId;
    }

    if (type === "text") {
      const part = parseObject(event.part);
      const text = asString(part.text, "");
      if (text) messages.push(text);
      continue;
    }

    if (type === "step_finish") {
      const part = parseObject(event.part);
      const tokens = parseObject(part.tokens);
      const cache = parseObject(tokens.cache);
      usage.inputTokens += asNumber(tokens.input, 0);
      usage.outputTokens += asNumber(tokens.output, 0);
      usage.cachedInputTokens += asNumber(cache.read, 0);
      costUsd += asNumber(part.cost, 0);
      continue;
    }

    if (type === "error") {
      const errorObj = parseObject(event.error);
      const data = parseObject(errorObj.data);
      const msg = asString(data.message, "").trim() || asString(errorObj.name, "").trim();
      if (msg) errorMessage = msg;
      continue;
    }
  }

  return {
    sessionId,
    summary: messages.join("\n\n").trim(),
    usage,
    costUsd,
    errorMessage,
  };
}

export function isOpenCodeUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return /unknown session|session .* not found|session not found|invalid session/i.test(haystack);
}
