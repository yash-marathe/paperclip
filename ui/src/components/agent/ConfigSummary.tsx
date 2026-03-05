import { Link } from "@/lib/router";
import { adapterLabels, roleLabels } from "../agent-config-primitives";
import { Identity } from "../Identity";
import { agentStatusDot, agentStatusDotDefault } from "../../lib/status-colors";
import { relativeTime, agentRouteRef } from "../../lib/utils";
import { Settings } from "lucide-react";
import type { Agent } from "@paperclipai/shared";

export function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

export function ConfigSummary({
  agent,
  agentRouteId,
  reportsToAgent,
  directReports,
}: {
  agent: Agent;
  agentRouteId: string;
  reportsToAgent: Agent | null;
  directReports: Agent[];
}) {
  const config = agent.adapterConfig as Record<string, unknown>;
  const promptText = typeof config?.promptTemplate === "string" ? config.promptTemplate : "";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Configuration</h3>
        <Link
          to={`/agents/${agentRouteId}/configure`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors no-underline"
        >
          <Settings className="h-3 w-3" />
          Manage &rarr;
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-4 space-y-3">
          <h4 className="text-xs text-muted-foreground font-medium">Agent Details</h4>
          <div className="space-y-2 text-sm">
            <SummaryRow label="Adapter">
              <span className="font-mono">{adapterLabels[agent.adapterType] ?? agent.adapterType}</span>
              {String(config?.model ?? "") !== "" && (
                <span className="text-muted-foreground ml-1">
                  ({String(config.model)})
                </span>
              )}
            </SummaryRow>
            <SummaryRow label="Heartbeat">
              {(agent.runtimeConfig as Record<string, unknown>)?.heartbeat
                ? (() => {
                    const hb = (agent.runtimeConfig as Record<string, unknown>).heartbeat as Record<string, unknown>;
                    if (!hb.enabled) return <span className="text-muted-foreground">Disabled</span>;
                    const sec = Number(hb.intervalSec) || 300;
                    const maxConcurrentRuns = Math.max(1, Math.floor(Number(hb.maxConcurrentRuns) || 1));
                    const intervalLabel = sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec}s`;
                    return (
                      <span>
                        Every {intervalLabel}
                        {maxConcurrentRuns > 1 ? ` (max ${maxConcurrentRuns} concurrent)` : ""}
                      </span>
                    );
                  })()
                : <span className="text-muted-foreground">Not configured</span>
              }
            </SummaryRow>
            <SummaryRow label="Last heartbeat">
              {agent.lastHeartbeatAt
                ? <span>{relativeTime(agent.lastHeartbeatAt)}</span>
                : <span className="text-muted-foreground">Never</span>
              }
            </SummaryRow>
            <SummaryRow label="Reports to">
              {reportsToAgent ? (
                <Link
                  to={`/agents/${agentRouteRef(reportsToAgent)}`}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  <Identity name={reportsToAgent.name} size="sm" />
                </Link>
              ) : (
                <span className="text-muted-foreground">Nobody (top-level)</span>
              )}
            </SummaryRow>
          </div>
          {directReports.length > 0 && (
            <div className="pt-1">
              <span className="text-xs text-muted-foreground">Direct reports</span>
              <div className="mt-1 space-y-1">
                {directReports.map((r) => (
                  <Link
                    key={r.id}
                    to={`/agents/${agentRouteRef(r)}`}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className={`absolute inline-flex h-full w-full rounded-full ${agentStatusDot[r.status] ?? agentStatusDotDefault}`} />
                    </span>
                    {r.name}
                    <span className="text-muted-foreground text-xs">({roleLabels[r.role] ?? r.role})</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {agent.capabilities && (
            <div className="pt-1">
              <span className="text-xs text-muted-foreground">Capabilities</span>
              <p className="text-sm mt-0.5">{agent.capabilities}</p>
            </div>
          )}
        </div>
        {promptText && (
          <div className="border border-border rounded-lg p-4 space-y-2">
            <h4 className="text-xs text-muted-foreground font-medium">Prompt Template</h4>
            <pre className="text-xs text-muted-foreground line-clamp-[12] font-mono whitespace-pre-wrap">{promptText}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
