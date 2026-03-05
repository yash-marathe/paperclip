import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate, Link, useBeforeUnload } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { usePanel } from "../context/PanelContext";
import { useSidebar } from "../context/SidebarContext";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { roleLabels } from "../components/agent-config-primitives";
import { StatusBadge } from "../components/StatusBadge";
import { PageSkeleton } from "../components/PageSkeleton";
import { cn, agentRouteRef } from "../lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  MoreHorizontal,
  Play,
  Pause,
  Copy,
  RotateCcw,
  Trash2,
  Plus,
  Settings,
} from "lucide-react";
import { AgentIcon, AgentIconPicker } from "../components/AgentIconPicker";
import { isUuidLike, type HeartbeatRun } from "@paperclipai/shared";

import { parseAgentDetailView, type AgentDetailView } from "../components/agent/utils";
import { AgentOverview } from "../components/agent/AgentOverview";
import { AgentConfigurePage } from "../components/agent/AgentConfigurePage";
import { RunsTab } from "../components/agent/RunsTab";

export function AgentDetail() {
  const { companyPrefix, agentId, tab: urlTab, runId: urlRunId } = useParams<{
    companyPrefix?: string;
    agentId: string;
    tab?: string;
    runId?: string;
  }>();
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { closePanel } = usePanel();
  const { openNewIssue } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const activeView = urlRunId ? "runs" as AgentDetailView : parseAgentDetailView(urlTab ?? null);
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const saveConfigActionRef = useRef<(() => void) | null>(null);
  const cancelConfigActionRef = useRef<(() => void) | null>(null);
  const { isMobile } = useSidebar();
  const routeAgentRef = agentId ?? "";
  const routeCompanyId = useMemo(() => {
    if (!companyPrefix) return null;
    const requestedPrefix = companyPrefix.toUpperCase();
    return companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix)?.id ?? null;
  }, [companies, companyPrefix]);
  const lookupCompanyId = routeCompanyId ?? selectedCompanyId ?? undefined;
  const canFetchAgent = routeAgentRef.length > 0 && (isUuidLike(routeAgentRef) || Boolean(lookupCompanyId));
  const setSaveConfigAction = useCallback((fn: (() => void) | null) => { saveConfigActionRef.current = fn; }, []);
  const setCancelConfigAction = useCallback((fn: (() => void) | null) => { cancelConfigActionRef.current = fn; }, []);

  const { data: agent, isLoading, error } = useQuery({
    queryKey: [...queryKeys.agents.detail(routeAgentRef), lookupCompanyId ?? null],
    queryFn: () => agentsApi.get(routeAgentRef, lookupCompanyId),
    enabled: canFetchAgent,
  });
  const resolvedCompanyId = agent?.companyId ?? selectedCompanyId;
  const canonicalAgentRef = agent ? agentRouteRef(agent) : routeAgentRef;
  const agentLookupRef = agent?.id ?? routeAgentRef;

  const { data: runtimeState } = useQuery({
    queryKey: queryKeys.agents.runtimeState(agentLookupRef),
    queryFn: () => agentsApi.runtimeState(agentLookupRef, resolvedCompanyId ?? undefined),
    enabled: Boolean(agentLookupRef),
  });

  const { data: heartbeats } = useQuery({
    queryKey: queryKeys.heartbeats(resolvedCompanyId!, agent?.id ?? undefined),
    queryFn: () => heartbeatsApi.list(resolvedCompanyId!, agent?.id ?? undefined),
    enabled: !!resolvedCompanyId && !!agent?.id,
  });

  const { data: allIssues } = useQuery({
    queryKey: queryKeys.issues.list(resolvedCompanyId!),
    queryFn: () => issuesApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId,
  });

  const { data: allAgents } = useQuery({
    queryKey: queryKeys.agents.list(resolvedCompanyId!),
    queryFn: () => agentsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId,
  });

  const assignedIssues = (allIssues ?? [])
    .filter((i) => i.assigneeAgentId === agent?.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const reportsToAgent = (allAgents ?? []).find((a) => a.id === agent?.reportsTo);
  const directReports = (allAgents ?? []).filter((a) => a.reportsTo === agent?.id && a.status !== "terminated");
  const mobileLiveRun = useMemo(
    () => (heartbeats ?? []).find((r) => r.status === "running" || r.status === "queued") ?? null,
    [heartbeats],
  );

  useEffect(() => {
    if (!agent) return;
    if (routeAgentRef === canonicalAgentRef) return;
    if (urlRunId) {
      navigate(`/agents/${canonicalAgentRef}/runs/${urlRunId}`, { replace: true });
      return;
    }
    if (urlTab) {
      navigate(`/agents/${canonicalAgentRef}/${urlTab}`, { replace: true });
      return;
    }
    navigate(`/agents/${canonicalAgentRef}`, { replace: true });
  }, [agent, routeAgentRef, canonicalAgentRef, urlRunId, urlTab, navigate]);

  useEffect(() => {
    if (!agent?.companyId || agent.companyId === selectedCompanyId) return;
    setSelectedCompanyId(agent.companyId, { source: "route_sync" });
  }, [agent?.companyId, selectedCompanyId, setSelectedCompanyId]);

  const agentAction = useMutation({
    mutationFn: async (action: "invoke" | "pause" | "resume" | "terminate") => {
      if (!agentLookupRef) return Promise.reject(new Error("No agent reference"));
      switch (action) {
        case "invoke": return agentsApi.invoke(agentLookupRef, resolvedCompanyId ?? undefined);
        case "pause": return agentsApi.pause(agentLookupRef, resolvedCompanyId ?? undefined);
        case "resume": return agentsApi.resume(agentLookupRef, resolvedCompanyId ?? undefined);
        case "terminate": return agentsApi.terminate(agentLookupRef, resolvedCompanyId ?? undefined);
      }
    },
    onSuccess: (data, action) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(routeAgentRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentLookupRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.runtimeState(agentLookupRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.taskSessions(agentLookupRef) });
      if (resolvedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(resolvedCompanyId) });
        if (agent?.id) {
          queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(resolvedCompanyId, agent.id) });
        }
      }
      if (action === "invoke" && data && typeof data === "object" && "id" in data) {
        navigate(`/agents/${canonicalAgentRef}/runs/${(data as HeartbeatRun).id}`);
      }
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Action failed");
    },
  });

  const updateIcon = useMutation({
    mutationFn: (icon: string) => agentsApi.update(agentLookupRef, { icon }, resolvedCompanyId ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(routeAgentRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentLookupRef) });
      if (resolvedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(resolvedCompanyId) });
      }
    },
  });

  const resetTaskSession = useMutation({
    mutationFn: (taskKey: string | null) =>
      agentsApi.resetSession(agentLookupRef, taskKey, resolvedCompanyId ?? undefined),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.runtimeState(agentLookupRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.taskSessions(agentLookupRef) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reset session");
    },
  });

  const updatePermissions = useMutation({
    mutationFn: (canCreateAgents: boolean) =>
      agentsApi.updatePermissions(agentLookupRef, { canCreateAgents }, resolvedCompanyId ?? undefined),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(routeAgentRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentLookupRef) });
      if (resolvedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(resolvedCompanyId) });
      }
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to update permissions");
    },
  });

  useEffect(() => {
    const crumbs: { label: string; href?: string }[] = [
      { label: "Agents", href: "/agents" },
    ];
    const agentName = agent?.name ?? routeAgentRef ?? "Agent";
    if (activeView === "overview" && !urlRunId) {
      crumbs.push({ label: agentName });
    } else {
      crumbs.push({ label: agentName, href: `/agents/${canonicalAgentRef}` });
      if (urlRunId) {
        crumbs.push({ label: "Runs", href: `/agents/${canonicalAgentRef}/runs` });
        crumbs.push({ label: `Run ${urlRunId.slice(0, 8)}` });
      } else if (activeView === "configure") {
        crumbs.push({ label: "Configure" });
      } else if (activeView === "runs") {
        crumbs.push({ label: "Runs" });
      }
    }
    setBreadcrumbs(crumbs);
  }, [setBreadcrumbs, agent, routeAgentRef, canonicalAgentRef, activeView, urlRunId]);

  useEffect(() => {
    closePanel();
    return () => closePanel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useBeforeUnload(
    useCallback((event) => {
      if (!configDirty) return;
      event.preventDefault();
      event.returnValue = "";
    }, [configDirty]),
  );

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!agent) return null;
  const isPendingApproval = agent.status === "pending_approval";
  const showConfigActionBar = activeView === "configure" && configDirty;

  return (
    <div className={cn("space-y-6", isMobile && showConfigActionBar && "pb-24")}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <AgentIconPicker
            value={agent.icon}
            onChange={(icon) => updateIcon.mutate(icon)}
          >
            <button className="shrink-0 flex items-center justify-center h-12 w-12 rounded-lg bg-accent hover:bg-accent/80 transition-colors">
              <AgentIcon icon={agent.icon} className="h-6 w-6" />
            </button>
          </AgentIconPicker>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold truncate">{agent.name}</h2>
            <p className="text-sm text-muted-foreground truncate">
              {roleLabels[agent.role] ?? agent.role}
              {agent.title ? ` - ${agent.title}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openNewIssue({ assigneeAgentId: agent.id })}
          >
            <Plus className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Assign Task</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => agentAction.mutate("invoke")}
            disabled={agentAction.isPending || isPendingApproval}
          >
            <Play className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Invoke</span>
          </Button>
          {agent.status === "paused" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => agentAction.mutate("resume")}
              disabled={agentAction.isPending || isPendingApproval}
            >
              <Play className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Resume</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => agentAction.mutate("pause")}
              disabled={agentAction.isPending || isPendingApproval}
            >
              <Pause className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Pause</span>
            </Button>
          )}
          <span className="hidden sm:inline"><StatusBadge status={agent.status} /></span>
          {mobileLiveRun && (
            <Link
              to={`/agents/${canonicalAgentRef}/runs/${mobileLiveRun.id}`}
              className="sm:hidden flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 hover:bg-blue-500/20 transition-colors no-underline"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">Live</span>
            </Link>
          )}

          {/* Overflow menu */}
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="end">
              <button
                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50"
                onClick={() => {
                  navigate(`/agents/${canonicalAgentRef}/configure`);
                  setMoreOpen(false);
                }}
              >
                <Settings className="h-3 w-3" />
                Configure Agent
              </button>
              <button
                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50"
                onClick={() => {
                  navigator.clipboard.writeText(agent.id);
                  setMoreOpen(false);
                }}
              >
                <Copy className="h-3 w-3" />
                Copy Agent ID
              </button>
              <button
                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50"
                onClick={() => {
                  resetTaskSession.mutate(null);
                  setMoreOpen(false);
                }}
              >
                <RotateCcw className="h-3 w-3" />
                Reset Sessions
              </button>
              <button
                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-destructive"
                onClick={() => {
                  agentAction.mutate("terminate");
                  setMoreOpen(false);
                }}
              >
                <Trash2 className="h-3 w-3" />
                Terminate
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}
      {isPendingApproval && (
        <p className="text-sm text-amber-500">
          This agent is pending board approval and cannot be invoked yet.
        </p>
      )}

      {/* Floating Save/Cancel (desktop) */}
      {!isMobile && (
        <div
          className={cn(
            "sticky top-6 z-10 float-right transition-opacity duration-150",
            showConfigActionBar
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          )}
        >
          <div className="flex items-center gap-2 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-1.5 shadow-lg">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cancelConfigActionRef.current?.()}
              disabled={configSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => saveConfigActionRef.current?.()}
              disabled={configSaving}
            >
              {configSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {/* Mobile bottom Save/Cancel bar */}
      {isMobile && showConfigActionBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-sm">
          <div
            className="flex items-center justify-end gap-2 px-3 py-2"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cancelConfigActionRef.current?.()}
              disabled={configSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => saveConfigActionRef.current?.()}
              disabled={configSaving}
            >
              {configSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {/* View content */}
      {activeView === "overview" && (
        <AgentOverview
          agent={agent}
          runs={heartbeats ?? []}
          assignedIssues={assignedIssues}
          runtimeState={runtimeState}
          reportsToAgent={reportsToAgent ?? null}
          directReports={directReports}
          agentId={agent.id}
          agentRouteId={canonicalAgentRef}
        />
      )}

      {activeView === "configure" && (
        <AgentConfigurePage
          agent={agent}
          agentId={agent.id}
          companyId={resolvedCompanyId ?? undefined}
          onDirtyChange={setConfigDirty}
          onSaveActionChange={setSaveConfigAction}
          onCancelActionChange={setCancelConfigAction}
          onSavingChange={setConfigSaving}
          updatePermissions={updatePermissions}
        />
      )}

      {activeView === "runs" && (
        <RunsTab
          runs={heartbeats ?? []}
          companyId={resolvedCompanyId!}
          agentId={agent.id}
          agentRouteId={canonicalAgentRef}
          selectedRunId={urlRunId ?? null}
          adapterType={agent.adapterType}
        />
      )}
    </div>
  );
}
