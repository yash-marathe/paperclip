import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { heartbeatsApi } from "../../api/heartbeats";
import { getUIAdapter, buildTranscript } from "../../adapters";
import { formatTokens, asRecord } from "../../lib/utils";
import { cn } from "../../lib/utils";
import {
  formatEnvForDisplay,
  findScrollContainer,
  readScrollMetrics,
  scrollToContainerBottom,
  LIVE_SCROLL_BOTTOM_TOLERANCE_PX,
  type ScrollContainer,
} from "./utils";
import { Button } from "@/components/ui/button";
import type { HeartbeatRun, HeartbeatRunEvent } from "@paperclipai/shared";

export function LogViewer({ run, adapterType }: { run: HeartbeatRun; adapterType: string }) {
  const [events, setEvents] = useState<HeartbeatRunEvent[]>([]);
  const [logLines, setLogLines] = useState<Array<{ ts: string; stream: "stdout" | "stderr" | "system"; chunk: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [logLoading, setLogLoading] = useState(!!run.logRef);
  const [logError, setLogError] = useState<string | null>(null);
  const [logOffset, setLogOffset] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pendingLogLineRef = useRef("");
  const scrollContainerRef = useRef<ScrollContainer | null>(null);
  const isFollowingRef = useRef(false);
  const lastMetricsRef = useRef<{ scrollHeight: number; distanceFromBottom: number }>({
    scrollHeight: 0,
    distanceFromBottom: Number.POSITIVE_INFINITY,
  });
  const isLive = run.status === "running" || run.status === "queued";

  function appendLogContent(content: string, finalize = false) {
    if (!content && !finalize) return;
    const combined = `${pendingLogLineRef.current}${content}`;
    const split = combined.split("\n");
    pendingLogLineRef.current = split.pop() ?? "";
    if (finalize && pendingLogLineRef.current) {
      split.push(pendingLogLineRef.current);
      pendingLogLineRef.current = "";
    }

    const parsed: Array<{ ts: string; stream: "stdout" | "stderr" | "system"; chunk: string }> = [];
    for (const line of split) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const raw = JSON.parse(trimmed) as { ts?: unknown; stream?: unknown; chunk?: unknown };
        const stream =
          raw.stream === "stderr" || raw.stream === "system" ? raw.stream : "stdout";
        const chunk = typeof raw.chunk === "string" ? raw.chunk : "";
        const ts = typeof raw.ts === "string" ? raw.ts : new Date().toISOString();
        if (!chunk) continue;
        parsed.push({ ts, stream, chunk });
      } catch {
        // ignore malformed lines
      }
    }

    if (parsed.length > 0) {
      setLogLines((prev) => [...prev, ...parsed]);
    }
  }

  // Fetch events
  const { data: initialEvents } = useQuery({
    queryKey: ["run-events", run.id],
    queryFn: () => heartbeatsApi.events(run.id, 0, 200),
  });

  useEffect(() => {
    if (initialEvents) {
      setEvents(initialEvents);
      setLoading(false);
    }
  }, [initialEvents]);

  const getScrollContainer = useCallback((): ScrollContainer => {
    if (scrollContainerRef.current) return scrollContainerRef.current;
    const container = findScrollContainer(logEndRef.current);
    scrollContainerRef.current = container;
    return container;
  }, []);

  const updateFollowingState = useCallback(() => {
    const container = getScrollContainer();
    const metrics = readScrollMetrics(container);
    lastMetricsRef.current = metrics;
    const nearBottom = metrics.distanceFromBottom <= LIVE_SCROLL_BOTTOM_TOLERANCE_PX;
    isFollowingRef.current = nearBottom;
    setIsFollowing((prev) => (prev === nearBottom ? prev : nearBottom));
  }, [getScrollContainer]);

  useEffect(() => {
    scrollContainerRef.current = null;
    lastMetricsRef.current = {
      scrollHeight: 0,
      distanceFromBottom: Number.POSITIVE_INFINITY,
    };

    if (!isLive) {
      isFollowingRef.current = false;
      setIsFollowing(false);
      return;
    }

    updateFollowingState();
  }, [isLive, run.id, updateFollowingState]);

  useEffect(() => {
    if (!isLive) return;
    const container = getScrollContainer();
    updateFollowingState();

    if (container === window) {
      window.addEventListener("scroll", updateFollowingState, { passive: true });
    } else {
      container.addEventListener("scroll", updateFollowingState, { passive: true });
    }
    window.addEventListener("resize", updateFollowingState);
    return () => {
      if (container === window) {
        window.removeEventListener("scroll", updateFollowingState);
      } else {
        container.removeEventListener("scroll", updateFollowingState);
      }
      window.removeEventListener("resize", updateFollowingState);
    };
  }, [isLive, run.id, getScrollContainer, updateFollowingState]);

  // Auto-scroll only for live runs when following
  useEffect(() => {
    if (!isLive || !isFollowingRef.current) return;

    const container = getScrollContainer();
    const previous = lastMetricsRef.current;
    const current = readScrollMetrics(container);
    const growth = Math.max(0, current.scrollHeight - previous.scrollHeight);
    const expectedDistance = previous.distanceFromBottom + growth;
    const movedAwayBy = current.distanceFromBottom - expectedDistance;

    // If user moved away from bottom between updates, release auto-follow immediately.
    if (movedAwayBy > LIVE_SCROLL_BOTTOM_TOLERANCE_PX) {
      isFollowingRef.current = false;
      setIsFollowing(false);
      lastMetricsRef.current = current;
      return;
    }

    scrollToContainerBottom(container, "auto");
    const after = readScrollMetrics(container);
    lastMetricsRef.current = after;
    if (!isFollowingRef.current) {
      isFollowingRef.current = true;
    }
    setIsFollowing((prev) => (prev ? prev : true));
  }, [events.length, logLines.length, isLive, getScrollContainer]);

  // Fetch persisted shell log
  useEffect(() => {
    let cancelled = false;
    pendingLogLineRef.current = "";
    setLogLines([]);
    setLogOffset(0);
    setLogError(null);

    if (!run.logRef) {
      setLogLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLogLoading(true);
    const firstLimit =
      typeof run.logBytes === "number" && run.logBytes > 0
        ? Math.min(Math.max(run.logBytes + 1024, 256_000), 2_000_000)
        : 256_000;

    const load = async () => {
      try {
        let offset = 0;
        let first = true;
        while (!cancelled) {
          const result = await heartbeatsApi.log(run.id, offset, first ? firstLimit : 256_000);
          if (cancelled) break;
          appendLogContent(result.content, result.nextOffset === undefined);
          const next = result.nextOffset ?? offset + result.content.length;
          setLogOffset(next);
          offset = next;
          first = false;
          if (result.nextOffset === undefined || isLive) break;
        }
      } catch (err) {
        if (!cancelled) {
          setLogError(err instanceof Error ? err.message : "Failed to load run log");
        }
      } finally {
        if (!cancelled) setLogLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [run.id, run.logRef, run.logBytes, isLive]);

  // Poll for live updates
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(async () => {
      const maxSeq = events.length > 0 ? Math.max(...events.map((e) => e.seq)) : 0;
      try {
        const newEvents = await heartbeatsApi.events(run.id, maxSeq, 100);
        if (newEvents.length > 0) {
          setEvents((prev) => [...prev, ...newEvents]);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [run.id, isLive, events]);

  // Poll shell log for running runs
  useEffect(() => {
    if (!isLive || !run.logRef) return;
    const interval = setInterval(async () => {
      try {
        const result = await heartbeatsApi.log(run.id, logOffset, 256_000);
        if (result.content) {
          appendLogContent(result.content, result.nextOffset === undefined);
        }
        if (result.nextOffset !== undefined) {
          setLogOffset(result.nextOffset);
        } else if (result.content.length > 0) {
          setLogOffset((prev) => prev + result.content.length);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [run.id, run.logRef, isLive, logOffset]);

  const adapterInvokePayload = useMemo(() => {
    const evt = events.find((e) => e.eventType === "adapter.invoke");
    return asRecord(evt?.payload ?? null);
  }, [events]);

  const adapter = useMemo(() => getUIAdapter(adapterType), [adapterType]);
  const transcript = useMemo(() => buildTranscript(logLines, adapter.parseStdoutLine), [logLines, adapter]);

  if (loading && logLoading) {
    return <p className="text-xs text-muted-foreground">Loading run logs...</p>;
  }

  if (events.length === 0 && logLines.length === 0 && !logError) {
    return <p className="text-xs text-muted-foreground">No log events.</p>;
  }

  const levelColors: Record<string, string> = {
    info: "text-foreground",
    warn: "text-yellow-600 dark:text-yellow-400",
    error: "text-red-600 dark:text-red-400",
  };

  const streamColors: Record<string, string> = {
    stdout: "text-foreground",
    stderr: "text-red-600 dark:text-red-300",
    system: "text-blue-600 dark:text-blue-300",
  };

  return (
    <div className="space-y-3">
      {adapterInvokePayload && (
        <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Invocation</div>
          {typeof adapterInvokePayload.adapterType === "string" && (
            <div className="text-xs"><span className="text-muted-foreground">Adapter: </span>{adapterInvokePayload.adapterType}</div>
          )}
          {typeof adapterInvokePayload.cwd === "string" && (
            <div className="text-xs break-all"><span className="text-muted-foreground">Working dir: </span><span className="font-mono">{adapterInvokePayload.cwd}</span></div>
          )}
          {typeof adapterInvokePayload.command === "string" && (
            <div className="text-xs break-all">
              <span className="text-muted-foreground">Command: </span>
              <span className="font-mono">
                {[
                  adapterInvokePayload.command,
                  ...(Array.isArray(adapterInvokePayload.commandArgs)
                    ? adapterInvokePayload.commandArgs.filter((v): v is string => typeof v === "string")
                    : []),
                ].join(" ")}
              </span>
            </div>
          )}
          {Array.isArray(adapterInvokePayload.commandNotes) && adapterInvokePayload.commandNotes.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Command notes</div>
              <ul className="list-disc pl-5 space-y-1">
                {adapterInvokePayload.commandNotes
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .map((note, idx) => (
                    <li key={`${idx}-${note}`} className="text-xs break-all font-mono">
                      {note}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {adapterInvokePayload.prompt !== undefined && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Prompt</div>
              <pre className="bg-neutral-100 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap">
                {typeof adapterInvokePayload.prompt === "string"
                  ? adapterInvokePayload.prompt
                  : JSON.stringify(adapterInvokePayload.prompt, null, 2)}
              </pre>
            </div>
          )}
          {adapterInvokePayload.context !== undefined && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Context</div>
              <pre className="bg-neutral-100 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(adapterInvokePayload.context, null, 2)}
              </pre>
            </div>
          )}
          {adapterInvokePayload.env !== undefined && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Environment</div>
              <pre className="bg-neutral-100 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                {formatEnvForDisplay(adapterInvokePayload.env)}
              </pre>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Transcript ({transcript.length})
        </span>
        <div className="flex items-center gap-2">
          {isLive && !isFollowing && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                const container = getScrollContainer();
                isFollowingRef.current = true;
                setIsFollowing(true);
                scrollToContainerBottom(container, "auto");
                lastMetricsRef.current = readScrollMetrics(container);
              }}
            >
              Jump to live
            </Button>
          )}
          {isLive && (
            <span className="flex items-center gap-1 text-xs text-cyan-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
              </span>
              Live
            </span>
          )}
        </div>
      </div>
      <div className="bg-neutral-100 dark:bg-neutral-950 rounded-lg p-3 font-mono text-xs space-y-0.5 overflow-x-hidden">
        {transcript.length === 0 && !run.logRef && (
          <div className="text-neutral-500">No persisted transcript for this run.</div>
        )}
        {transcript.map((entry, idx) => {
          const time = new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false });
          const grid = "grid grid-cols-[auto_auto_1fr] gap-x-2 sm:gap-x-3 items-baseline";
          const tsCell = "text-neutral-400 dark:text-neutral-600 select-none w-12 sm:w-16 text-[10px] sm:text-xs";
          const lblCell = "w-14 sm:w-20 text-[10px] sm:text-xs";
          const contentCell = "min-w-0 whitespace-pre-wrap break-words overflow-hidden";
          const expandCell = "col-span-full md:col-start-3 md:col-span-1";

          if (entry.kind === "assistant") {
            return (
              <div key={`${entry.ts}-assistant-${idx}`} className={cn(grid, "py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-green-700 dark:text-green-300")}>assistant</span>
                <span className={cn(contentCell, "text-green-900 dark:text-green-100")}>{entry.text}</span>
              </div>
            );
          }

          if (entry.kind === "thinking") {
            return (
              <div key={`${entry.ts}-thinking-${idx}`} className={cn(grid, "py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-green-600/60 dark:text-green-300/60")}>thinking</span>
                <span className={cn(contentCell, "text-green-800/60 dark:text-green-100/60 italic")}>{entry.text}</span>
              </div>
            );
          }

          if (entry.kind === "user") {
            return (
              <div key={`${entry.ts}-user-${idx}`} className={cn(grid, "py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-neutral-500 dark:text-neutral-400")}>user</span>
                <span className={cn(contentCell, "text-neutral-700 dark:text-neutral-300")}>{entry.text}</span>
              </div>
            );
          }

          if (entry.kind === "tool_call") {
            return (
              <div key={`${entry.ts}-tool-${idx}`} className={cn(grid, "gap-y-1 py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-yellow-700 dark:text-yellow-300")}>tool_call</span>
                <span className="text-yellow-900 dark:text-yellow-100 min-w-0">{entry.name}</span>
                <pre className={cn(expandCell, "bg-neutral-200 dark:bg-neutral-900 rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap text-neutral-800 dark:text-neutral-200")}>
                  {JSON.stringify(entry.input, null, 2)}
                </pre>
              </div>
            );
          }

          if (entry.kind === "tool_result") {
            return (
              <div key={`${entry.ts}-toolres-${idx}`} className={cn(grid, "gap-y-1 py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, entry.isError ? "text-red-600 dark:text-red-300" : "text-purple-600 dark:text-purple-300")}>tool_result</span>
                {entry.isError ? <span className="text-red-600 dark:text-red-400 min-w-0">error</span> : <span />}
                <pre className={cn(expandCell, "bg-neutral-100 dark:bg-neutral-900 rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap text-neutral-700 dark:text-neutral-300 max-h-60 overflow-y-auto")}>
                  {(() => { try { return JSON.stringify(JSON.parse(entry.content), null, 2); } catch { return entry.content; } })()}
                </pre>
              </div>
            );
          }

          if (entry.kind === "init") {
            return (
              <div key={`${entry.ts}-init-${idx}`} className={grid}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-blue-700 dark:text-blue-300")}>init</span>
                <span className={cn(contentCell, "text-blue-900 dark:text-blue-100")}>model: {entry.model}{entry.sessionId ? `, session: ${entry.sessionId}` : ""}</span>
              </div>
            );
          }

          if (entry.kind === "result") {
            return (
              <div key={`${entry.ts}-result-${idx}`} className={cn(grid, "gap-y-1 py-0.5")}>
                <span className={tsCell}>{time}</span>
                <span className={cn(lblCell, "text-cyan-700 dark:text-cyan-300")}>result</span>
                <span className={cn(contentCell, "text-cyan-900 dark:text-cyan-100")}>
                  tokens in={formatTokens(entry.inputTokens)} out={formatTokens(entry.outputTokens)} cached={formatTokens(entry.cachedTokens)} cost=${entry.costUsd.toFixed(6)}
                </span>
                {(entry.subtype || entry.isError || entry.errors.length > 0) && (
                  <div className={cn(expandCell, "text-red-600 dark:text-red-300 whitespace-pre-wrap break-words")}>
                    subtype={entry.subtype || "unknown"} is_error={entry.isError ? "true" : "false"}
                    {entry.errors.length > 0 ? ` errors=${entry.errors.join(" | ")}` : ""}
                  </div>
                )}
                {entry.text && (
                  <div className={cn(expandCell, "whitespace-pre-wrap break-words text-neutral-800 dark:text-neutral-100")}>{entry.text}</div>
                )}
              </div>
            );
          }

          const rawText = entry.text;
          const label =
            entry.kind === "stderr" ? "stderr" :
            entry.kind === "system" ? "system" :
            "stdout";
          const color =
            entry.kind === "stderr" ? "text-red-600 dark:text-red-300" :
            entry.kind === "system" ? "text-blue-600 dark:text-blue-300" :
            "text-neutral-500";
          return (
            <div key={`${entry.ts}-raw-${idx}`} className={grid}>
              <span className={tsCell}>{time}</span>
              <span className={cn(lblCell, color)}>{label}</span>
              <span className={cn(contentCell, color)}>{rawText}</span>
            </div>
          )
        })}
        {logError && <div className="text-red-600 dark:text-red-300">{logError}</div>}
        <div ref={logEndRef} />
      </div>

      {(run.status === "failed" || run.status === "timed_out") && (
        <div className="rounded-lg border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-950/20 p-3 space-y-2">
          <div className="text-xs font-medium text-red-700 dark:text-red-300">Failure details</div>
          {run.error && (
            <div className="text-xs text-red-600 dark:text-red-200">
              <span className="text-red-700 dark:text-red-300">Error: </span>
              {run.error}
            </div>
          )}
          {run.stderrExcerpt && run.stderrExcerpt.trim() && (
            <div>
              <div className="text-xs text-red-700 dark:text-red-300 mb-1">stderr excerpt</div>
              <pre className="bg-red-50 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap text-red-800 dark:text-red-100">
                {run.stderrExcerpt}
              </pre>
            </div>
          )}
          {run.resultJson && (
            <div>
              <div className="text-xs text-red-700 dark:text-red-300 mb-1">adapter result JSON</div>
              <pre className="bg-red-50 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap text-red-800 dark:text-red-100">
                {JSON.stringify(run.resultJson, null, 2)}
              </pre>
            </div>
          )}
          {run.stdoutExcerpt && run.stdoutExcerpt.trim() && !run.resultJson && (
            <div>
              <div className="text-xs text-red-700 dark:text-red-300 mb-1">stdout excerpt</div>
              <pre className="bg-red-50 dark:bg-neutral-950 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap text-red-800 dark:text-red-100">
                {run.stdoutExcerpt}
              </pre>
            </div>
          )}
        </div>
      )}

      {events.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Events ({events.length})</div>
          <div className="bg-neutral-100 dark:bg-neutral-950 rounded-lg p-3 font-mono text-xs space-y-0.5">
            {events.map((evt) => {
              const color = evt.color
                ?? (evt.level ? levelColors[evt.level] : null)
                ?? (evt.stream ? streamColors[evt.stream] : null)
                ?? "text-foreground";

              return (
                <div key={evt.id} className="flex gap-2">
                  <span className="text-neutral-400 dark:text-neutral-600 shrink-0 select-none w-16">
                    {new Date(evt.createdAt).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                  <span className={cn("shrink-0 w-14", evt.stream ? (streamColors[evt.stream] ?? "text-neutral-500") : "text-neutral-500")}>
                    {evt.stream ? `[${evt.stream}]` : ""}
                  </span>
                  <span className={cn("break-all", color)}>
                    {evt.message ?? (evt.payload ? JSON.stringify(evt.payload) : "")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
