import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asString,
  asNumber,
  asStringArray,
  parseObject,
  buildPaperclipEnv,
  redactEnvForLogs,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  renderTemplate,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { parseOpenCodeJsonl, isOpenCodeUnknownSessionError } from "./parse.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PAPERCLIP_SKILLS_CANDIDATES = [
  path.resolve(__moduleDir, "../../skills"),         // published: <pkg>/dist/server/ -> <pkg>/skills/
  path.resolve(__moduleDir, "../../../../../skills"), // dev: src/server/ -> repo root/skills/
];

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

async function resolvePaperclipSkillsDir(): Promise<string | null> {
  for (const candidate of PAPERCLIP_SKILLS_CANDIDATES) {
    const isDir = await fs.stat(candidate).then((s) => s.isDirectory()).catch(() => false);
    if (isDir) return candidate;
  }
  return null;
}

/**
 * Collect Paperclip skills content from the skills directory.
 * Returns the concatenated SKILL.md contents, or null if none found.
 */
async function collectSkillsContent(
  onLog: AdapterExecutionContext["onLog"],
): Promise<string | null> {
  const skillsDir = await resolvePaperclipSkillsDir();
  if (!skillsDir) return null;

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const skillContents: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
    try {
      const content = await fs.readFile(skillMd, "utf-8");
      skillContents.push(content);
      await onLog(
        "stderr",
        `[paperclip] Loaded OpenCode skill "${entry.name}" from ${skillMd}\n`,
      );
    } catch {
      // skill directory without SKILL.md, skip
    }
  }

  if (skillContents.length === 0) return null;
  return skillContents.join("\n\n---\n\n");
}

/**
 * Build a temporary directory containing context files that will be
 * attached to the OpenCode run via `--file` flags.
 * Returns the tmpdir path and an array of file paths to attach.
 */
async function buildContextFiles(input: {
  skillsContent: string | null;
  instructionsFilePath: string;
  onLog: AdapterExecutionContext["onLog"];
}): Promise<{ tmpDir: string; files: string[] }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-"));
  const files: string[] = [];

  // Write skills content to a temp file
  if (input.skillsContent) {
    const skillsFile = path.join(tmpDir, "paperclip-skills.md");
    await fs.writeFile(skillsFile, input.skillsContent, "utf-8");
    files.push(skillsFile);
  }

  // Write instructions file content + path directive to a temp file
  if (input.instructionsFilePath) {
    const instructionsDir = `${path.dirname(input.instructionsFilePath)}/`;
    try {
      const instructionsContents = await fs.readFile(input.instructionsFilePath, "utf-8");
      const combined =
        `${instructionsContents}\n\n` +
        `The above agent instructions were loaded from ${input.instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsDir}.`;
      const instructionsFile = path.join(tmpDir, "agent-instructions.md");
      await fs.writeFile(instructionsFile, combined, "utf-8");
      files.push(instructionsFile);
      await input.onLog(
        "stderr",
        `[paperclip] Loaded agent instructions file: ${input.instructionsFilePath}\n`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await input.onLog(
        "stderr",
        `[paperclip] Warning: could not read agent instructions file "${input.instructionsFilePath}": ${reason}\n`,
      );
    }
  }

  return { tmpDir, files };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, authToken } = ctx;

  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const command = asString(config.command, "opencode");
  const model = asString(config.model, "");
  const variant = asString(config.variant, asString(config.reasoningEffort, ""));
  const agentName = asString(config.agent, "");

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  // Collect skills and instructions for injection via --file
  const skillsContent = await collectSkillsContent(onLog);
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const { tmpDir, files: contextFiles } = await buildContextFiles({
    skillsContent,
    instructionsFilePath,
    onLog,
  });

  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (effectiveWorkspaceCwd) env.PAPERCLIP_WORKSPACE_CWD = effectiveWorkspaceCwd;
  if (workspaceSource) env.PAPERCLIP_WORKSPACE_SOURCE = workspaceSource;
  if (workspaceId) env.PAPERCLIP_WORKSPACE_ID = workspaceId;
  if (workspaceRepoUrl) env.PAPERCLIP_WORKSPACE_REPO_URL = workspaceRepoUrl;
  if (workspaceRepoRef) env.PAPERCLIP_WORKSPACE_REPO_REF = workspaceRepoRef;
  if (workspaceHints.length > 0) env.PAPERCLIP_WORKSPACES_JSON = JSON.stringify(workspaceHints);

  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string") env[k] = v;
  }
  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  await ensureCommandResolvable(command, cwd, runtimeEnv);

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 20);
  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const canResumeSession =
    runtimeSessionId.length > 0 &&
    (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(cwd));
  const sessionId = canResumeSession ? runtimeSessionId : null;
  if (runtimeSessionId && !canResumeSession) {
    await onLog(
      "stderr",
      `[paperclip] OpenCode session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${cwd}".\n`,
    );
  }

  const commandNotes = (() => {
    const notes: string[] = [];
    if (instructionsFilePath) {
      notes.push(`Loaded agent instructions from ${instructionsFilePath}`);
    }
    if (skillsContent) {
      notes.push("Injected Paperclip skills as attached file.");
    }
    notes.push("Prompt piped via stdin.");
    return notes;
  })();

  const renderedPrompt = renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  });

  const buildArgs = (resumeSessionId: string | null) => {
    const args = ["run", "--format", "json"];
    if (model) args.push("--model", model);
    if (variant) args.push("--variant", variant);
    if (agentName) args.push("--agent", agentName);
    if (resumeSessionId) args.push("--session", resumeSessionId, "--continue");
    // Attach context files (skills + instructions) via --file flags
    for (const file of contextFiles) {
      args.push("--file", file);
    }
    if (extraArgs.length > 0) args.push(...extraArgs);
    // No positional prompt — it is piped via stdin
    return args;
  };

  const runAttempt = async (resumeSessionId: string | null) => {
    const args = buildArgs(resumeSessionId);
    if (onMeta) {
      await onMeta({
        adapterType: "opencode_local",
        command,
        cwd,
        commandNotes,
        commandArgs: args,
        env: redactEnvForLogs(env),
        prompt: renderedPrompt,
        context,
      });
    }

    const proc = await runChildProcess(runId, command, args, {
      cwd,
      env,
      stdin: renderedPrompt,
      timeoutSec,
      graceSec,
      onLog,
    });

    return {
      proc,
      parsed: parseOpenCodeJsonl(proc.stdout),
    };
  };

  const toResult = (
    attempt: {
      proc: { exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string };
      parsed: ReturnType<typeof parseOpenCodeJsonl>;
    },
    clearSessionOnMissingSession = false,
  ): AdapterExecutionResult => {
    if (attempt.proc.timedOut) {
      return {
        exitCode: attempt.proc.exitCode,
        signal: attempt.proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        clearSession: clearSessionOnMissingSession,
      };
    }

    const resolvedSessionId = attempt.parsed.sessionId ?? runtimeSessionId ?? runtime.sessionId ?? null;
    const resolvedSessionParams = resolvedSessionId
      ? ({
        sessionId: resolvedSessionId,
        cwd,
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
        ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
      } as Record<string, unknown>)
      : null;
    const parsedError = typeof attempt.parsed.errorMessage === "string" ? attempt.parsed.errorMessage.trim() : "";
    const stderrLine = firstNonEmptyLine(attempt.proc.stderr);
    const fallbackErrorMessage =
      parsedError ||
      stderrLine ||
      `OpenCode exited with code ${attempt.proc.exitCode ?? -1}`;

    // Determine provider from model string (provider/model format)
    const provider = model.includes("/") ? model.split("/")[0] ?? null : null;

    return {
      exitCode: attempt.proc.exitCode,
      signal: attempt.proc.signal,
      timedOut: false,
      errorMessage:
        (attempt.proc.exitCode ?? 0) === 0
          ? null
          : fallbackErrorMessage,
      usage: attempt.parsed.usage,
      sessionId: resolvedSessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: resolvedSessionId,
      provider,
      model,
      billingType: "api",
      costUsd: attempt.parsed.costUsd || null,
      resultJson: {
        stdout: attempt.proc.stdout,
        stderr: attempt.proc.stderr,
      },
      summary: attempt.parsed.summary,
      clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
    };
  };

  try {
    const initial = await runAttempt(sessionId);
    if (
      sessionId &&
      !initial.proc.timedOut &&
      (initial.proc.exitCode ?? 0) !== 0 &&
      isOpenCodeUnknownSessionError(initial.proc.stdout, initial.proc.stderr)
    ) {
      await onLog(
        "stderr",
        `[paperclip] OpenCode resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
      );
      const retry = await runAttempt(null);
      return toResult(retry, true);
    }

    return toResult(initial);
  } finally {
    // Clean up temporary context files
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
