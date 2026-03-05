import pc from "picocolors";

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

export function printOpenCodeStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    console.log(line);
    return;
  }

  const type = asString(parsed.type);
  const part = asRecord(parsed.part);

  if (type === "step_start") {
    const sessionId = asString(parsed.sessionID);
    console.log(pc.blue(`OpenCode session started${sessionId ? ` (session: ${sessionId})` : ""}`));
    return;
  }

  if (type === "text" && part) {
    const text = asString(part.text);
    if (text) console.log(pc.green(`assistant: ${text}`));
    return;
  }

  if (type === "tool_use" && part) {
    const toolName = asString(part.tool, "unknown");
    const state = asRecord(part.state);
    const status = asString(state?.status, "");

    if (status === "pending" || status === "running") {
      console.log(pc.yellow(`tool_call: ${toolName}`));
      if (state?.input !== undefined) {
        try {
          console.log(pc.gray(JSON.stringify(state.input, null, 2)));
        } catch {
          console.log(pc.gray(String(state.input)));
        }
      }
      return;
    }

    // Completed tool use
    const isError = status === "error";
    const output = state?.output;
    const error = state?.error;

    let content = "";
    if (typeof error === "string" && error) {
      content = error;
    } else if (typeof output === "string") {
      content = output;
    }

    console.log((isError ? pc.red : pc.cyan)(`tool_result: ${toolName}${isError ? " (error)" : ""}`));
    if (content) {
      const maxLen = 500;
      const truncated = content.length > maxLen ? `${content.slice(0, maxLen)}…` : content;
      console.log((isError ? pc.red : pc.gray)(truncated));
    }
    return;
  }

  if (type === "step_finish" && part) {
    const tokens = asRecord(part.tokens);
    const cache = asRecord(tokens?.cache);
    const input = asNumber(tokens?.input);
    const output = asNumber(tokens?.output);
    const cached = asNumber(cache?.read);
    const cost = asNumber(part.cost);
    const reason = asString(part.reason);

    console.log(
      pc.blue(`tokens: in=${input} out=${output} cached=${cached} cost=$${cost.toFixed(6)}`),
    );
    if (reason === "error" || reason === "failed") {
      console.log(pc.red(`step finished: reason=${reason}`));
    }
    return;
  }

  if (type === "error") {
    const errorObj = asRecord(parsed.error);
    const data = asRecord(errorObj?.data);
    const message = asString(data?.message, "") || asString(errorObj?.name, "") || errorText(parsed.error);
    if (message) console.log(pc.red(`error: ${message}`));
    return;
  }

  console.log(line);
}
