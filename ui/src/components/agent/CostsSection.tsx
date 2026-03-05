import { formatDate, formatTokens } from "../../lib/utils";
import type { HeartbeatRun, AgentRuntimeState } from "@paperclipai/shared";
import { formatCents } from "../../lib/utils";

export function CostsSection({
  runtimeState,
  runs,
}: {
  runtimeState?: AgentRuntimeState;
  runs: HeartbeatRun[];
}) {
  const runsWithCost = runs
    .filter((r) => {
      const u = r.usageJson as Record<string, unknown> | null;
      return u && (u.cost_usd || u.total_cost_usd || u.input_tokens);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-4">
      {runtimeState && (
        <div className="border border-border rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <span className="text-xs text-muted-foreground block">Input tokens</span>
              <span className="text-lg font-semibold">{formatTokens(runtimeState.totalInputTokens)}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Output tokens</span>
              <span className="text-lg font-semibold">{formatTokens(runtimeState.totalOutputTokens)}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Cached tokens</span>
              <span className="text-lg font-semibold">{formatTokens(runtimeState.totalCachedInputTokens)}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Total cost</span>
              <span className="text-lg font-semibold">{formatCents(runtimeState.totalCostCents)}</span>
            </div>
          </div>
        </div>
      )}
      {runsWithCost.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-accent/20">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Run</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Input</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Output</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runsWithCost.slice(0, 10).map((run) => {
                const u = run.usageJson as Record<string, unknown>;
                return (
                  <tr key={run.id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2">{formatDate(run.createdAt)}</td>
                    <td className="px-3 py-2 font-mono">{run.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-right">{formatTokens(Number(u.input_tokens ?? 0))}</td>
                    <td className="px-3 py-2 text-right">{formatTokens(Number(u.output_tokens ?? 0))}</td>
                    <td className="px-3 py-2 text-right">
                      {(u.cost_usd || u.total_cost_usd)
                        ? `$${Number(u.cost_usd ?? u.total_cost_usd ?? 0).toFixed(4)}`
                        : "-"
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
