import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "../../api/agents";
import { queryKeys } from "../../lib/queryKeys";
import { formatDate } from "../../lib/utils";
import { AgentConfigForm } from "../AgentConfigForm";
import { KeysTab } from "./KeysTab";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { Agent } from "@paperclipai/shared";

function ConfigurationTab({
  agent,
  companyId,
  onDirtyChange,
  onSaveActionChange,
  onCancelActionChange,
  onSavingChange,
  updatePermissions,
}: {
  agent: Agent;
  companyId?: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaveActionChange: (save: (() => void) | null) => void;
  onCancelActionChange: (cancel: (() => void) | null) => void;
  onSavingChange: (saving: boolean) => void;
  updatePermissions: { mutate: (canCreate: boolean) => void; isPending: boolean };
}) {
  const queryClient = useQueryClient();

  const { data: adapterModels } = useQuery({
    queryKey: ["adapter-models", agent.adapterType],
    queryFn: () => agentsApi.adapterModels(agent.adapterType),
  });

  const updateAgent = useMutation({
    mutationFn: (data: Record<string, unknown>) => agentsApi.update(agent.id, data, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.urlKey) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.configRevisions(agent.id) });
    },
  });

  useEffect(() => {
    onSavingChange(updateAgent.isPending);
  }, [onSavingChange, updateAgent.isPending]);

  return (
    <div className="space-y-6">
      <AgentConfigForm
        mode="edit"
        agent={agent}
        onSave={(patch) => updateAgent.mutate(patch)}
        isSaving={updateAgent.isPending}
        adapterModels={adapterModels}
        onDirtyChange={onDirtyChange}
        onSaveActionChange={onSaveActionChange}
        onCancelActionChange={onCancelActionChange}
        hideInlineSave
        sectionLayout="cards"
      />

      <div>
        <h3 className="text-sm font-medium mb-3">Permissions</h3>
        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center justify-between text-sm">
            <span>Can create new agents</span>
            <Button
              variant={agent.permissions?.canCreateAgents ? "default" : "outline"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() =>
                updatePermissions.mutate(!Boolean(agent.permissions?.canCreateAgents))
              }
              disabled={updatePermissions.isPending}
            >
              {agent.permissions?.canCreateAgents ? "Enabled" : "Disabled"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentConfigurePage({
  agent,
  agentId,
  companyId,
  onDirtyChange,
  onSaveActionChange,
  onCancelActionChange,
  onSavingChange,
  updatePermissions,
}: {
  agent: Agent;
  agentId: string;
  companyId?: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaveActionChange: (save: (() => void) | null) => void;
  onCancelActionChange: (cancel: (() => void) | null) => void;
  onSavingChange: (saving: boolean) => void;
  updatePermissions: { mutate: (canCreate: boolean) => void; isPending: boolean };
}) {
  const queryClient = useQueryClient();
  const [revisionsOpen, setRevisionsOpen] = useState(false);

  const { data: configRevisions } = useQuery({
    queryKey: queryKeys.agents.configRevisions(agent.id),
    queryFn: () => agentsApi.listConfigRevisions(agent.id, companyId),
  });

  const rollbackConfig = useMutation({
    mutationFn: (revisionId: string) => agentsApi.rollbackConfigRevision(agent.id, revisionId, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.urlKey) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.configRevisions(agent.id) });
    },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <ConfigurationTab
        agent={agent}
        onDirtyChange={onDirtyChange}
        onSaveActionChange={onSaveActionChange}
        onCancelActionChange={onCancelActionChange}
        onSavingChange={onSavingChange}
        updatePermissions={updatePermissions}
        companyId={companyId}
      />
      <div>
        <h3 className="text-sm font-medium mb-3">API Keys</h3>
        <KeysTab agentId={agentId} companyId={companyId} />
      </div>

      {/* Configuration Revisions — collapsible at the bottom */}
      <div>
        <button
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors"
          onClick={() => setRevisionsOpen((v) => !v)}
        >
          {revisionsOpen
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          }
          Configuration Revisions
          <span className="text-xs font-normal text-muted-foreground">{configRevisions?.length ?? 0}</span>
        </button>
        {revisionsOpen && (
          <div className="mt-3">
            {(configRevisions ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No configuration revisions yet.</p>
            ) : (
              <div className="space-y-2">
                {(configRevisions ?? []).slice(0, 10).map((revision) => (
                  <div key={revision.id} className="border border-border/70 rounded-md p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{revision.id.slice(0, 8)}</span>
                        <span className="mx-1">·</span>
                        <span>{formatDate(revision.createdAt)}</span>
                        <span className="mx-1">·</span>
                        <span>{revision.source}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => rollbackConfig.mutate(revision.id)}
                        disabled={rollbackConfig.isPending}
                      >
                        Restore
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Changed:{" "}
                      {revision.changedKeys.length > 0 ? revision.changedKeys.join(", ") : "no tracked changes"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
