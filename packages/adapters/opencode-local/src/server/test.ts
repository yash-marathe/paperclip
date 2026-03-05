import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  asStringArray,
  parseObject,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import path from "node:path";
import { parseOpenCodeJsonl } from "./parse.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function commandLooksLike(command: string, expected: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === expected || base === `${expected}.cmd` || base === `${expected}.exe`;
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const OPENCODE_AUTH_REQUIRED_RE =
  /(?:not\s+logged\s+in|login\s+required|authentication\s+required|unauthorized|invalid(?:\s+or\s+missing)?\s+api(?:[_\s-]?key)?|api[_\s-]?key.*required|no\s+providers?\s+configured)/i;

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "opencode");
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "opencode_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "opencode_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  try {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    checks.push({
      code: "opencode_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "opencode_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  // OpenCode supports many providers; check for common API key env vars
  const hasAnyApiKey = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENCODE_API_KEY",
  ].some((key) => {
    const configVal = env[key];
    const hostVal = process.env[key];
    return (typeof configVal === "string" && configVal.trim().length > 0) ||
      (typeof hostVal === "string" && hostVal.trim().length > 0);
  });

  if (hasAnyApiKey) {
    checks.push({
      code: "opencode_api_key_present",
      level: "info",
      message: "An LLM provider API key is available for OpenCode.",
    });
  } else {
    checks.push({
      code: "opencode_api_key_missing",
      level: "warn",
      message: "No LLM provider API key detected. OpenCode runs may fail without configured auth.",
      hint: "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or another provider key in adapter env or shell environment, or run `opencode auth login`.",
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "opencode_cwd_invalid" && check.code !== "opencode_command_unresolvable");
  if (canRunProbe) {
    if (!commandLooksLike(command, "opencode")) {
      checks.push({
        code: "opencode_hello_probe_skipped_custom_command",
        level: "info",
        message: "Skipped hello probe because command is not `opencode`.",
        detail: command,
        hint: "Use the `opencode` CLI command to run the automatic probe.",
      });
    } else {
      const model = asString(config.model, "").trim();
      const variant = asString(config.variant, asString(config.reasoningEffort, "")).trim();
      const agentNameConfig = asString(config.agent, "").trim();
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();

      const args = ["run", "--format", "json"];
      if (model) args.push("--model", model);
      if (variant) args.push("--variant", variant);
      if (agentNameConfig) args.push("--agent", agentNameConfig);
      if (extraArgs.length > 0) args.push(...extraArgs);
      args.push("Respond with hello.");

      const probe = await runChildProcess(
        `opencode-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command,
        args,
        {
          cwd,
          env,
          timeoutSec: 60,
          graceSec: 5,
          onLog: async () => {},
        },
      );
      const parsed = parseOpenCodeJsonl(probe.stdout);
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
      const authEvidence = `${parsed.errorMessage ?? ""}\n${probe.stdout}\n${probe.stderr}`.trim();

      if (probe.timedOut) {
        checks.push({
          code: "opencode_hello_probe_timed_out",
          level: "warn",
          message: "OpenCode hello probe timed out.",
          hint: "Retry the probe. If this persists, verify OpenCode can run `Respond with hello` from this directory manually.",
        });
      } else if ((probe.exitCode ?? 1) === 0) {
        const summary = parsed.summary.trim();
        const hasHello = /\bhello\b/i.test(summary);
        checks.push({
          code: hasHello ? "opencode_hello_probe_passed" : "opencode_hello_probe_unexpected_output",
          level: hasHello ? "info" : "warn",
          message: hasHello
            ? "OpenCode hello probe succeeded."
            : "OpenCode probe ran but did not return `hello` as expected.",
          ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
          ...(hasHello
            ? {}
            : {
                hint: "Try the probe manually (`opencode run --format json \"Respond with hello.\"`) to inspect full output.",
              }),
        });
      } else if (OPENCODE_AUTH_REQUIRED_RE.test(authEvidence)) {
        checks.push({
          code: "opencode_hello_probe_auth_required",
          level: "warn",
          message: "OpenCode CLI is installed, but authentication is not ready.",
          ...(detail ? { detail } : {}),
          hint: "Configure a provider API key in adapter env/shell or run `opencode auth login`, then retry the probe.",
        });
      } else {
        checks.push({
          code: "opencode_hello_probe_failed",
          level: "error",
          message: "OpenCode hello probe failed.",
          ...(detail ? { detail } : {}),
          hint: "Run `opencode run --format json \"Respond with hello.\"` manually in this working directory to debug.",
        });
      }
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
