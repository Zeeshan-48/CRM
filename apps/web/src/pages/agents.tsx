import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Banknote,
  BookOpen,
  Bot,
  Check,
  Dumbbell,
  GraduationCap,
  LifeBuoy,
  Megaphone,
  Play,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  listAgentRuns,
  listAgents,
  runAgent,
  type AgentRunParams,
  type AgentRunResult,
} from "@/lib/api/agents";
import { formatNumber, timeAgo } from "@/lib/format";
import type { AgentSummary } from "@/types";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const AGENT_ICONS: Record<string, LucideIcon> = {
  sales: TrendingUp,
  support: LifeBuoy,
  collections: Banknote,
  success: GraduationCap,
  marketing: Megaphone,
  knowledge: BookOpen,
  coach: Dumbbell,
};

// ---- Agent card ----

interface AgentCardProps {
  agent: AgentSummary;
  index: number;
  onRan: () => void;
}

function AgentCard({ agent, index, onRan }: AgentCardProps) {
  const Icon = AGENT_ICONS[agent.key] ?? Bot;
  const [limit, setLimit] = React.useState("5");
  const [audienceTag, setAudienceTag] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [result, setResult] = React.useState<AgentRunResult | null>(null);

  const runMutation = useMutation({
    mutationFn: (params: AgentRunParams) => runAgent(agent.key, params),
    onSuccess: (data) => {
      setResult(data);
      toast.success(data.summary || `${data.name} run completed`);
      onRan();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleRun = () => {
    const parsedLimit = parseInt(limit, 10);
    runMutation.mutate({
      limit: Number.isNaN(parsedLimit) ? undefined : parsedLimit,
      audienceTag:
        agent.key === "marketing" && audienceTag.trim() ? audienceTag.trim() : undefined,
      query: agent.key === "knowledge" && query.trim() ? query.trim() : undefined,
    });
  };

  return (
    <Card
      className="reveal flex flex-col transition-colors duration-120 hover:border-brand/40"
      style={{ animationDelay: `${60 + index * 45}ms` }}
    >
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center text-brand">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold tracking-tight">{agent.name}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {agent.description}
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs tabular-nums text-muted-foreground">
          {formatNumber(agent.runCount)} runs
          <span className="px-1.5">&middot;</span>
          last run {timeAgo(agent.lastRunAt)}
        </p>

        {/* The sales agent has its own dedicated page (drafts, review queue,
            automation, effectiveness), link there instead of running inline. */}
        {agent.key === "sales" ? (
          <div className="mt-4 flex justify-end">
            <Button asChild size="sm" className="h-8">
              <Link to="/sales-agent">
                Open Sales Agent
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        ) : (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="agents-limit" className="text-xs text-muted-foreground">Limit</Label>
            <Input id="agents-limit"
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="h-8 w-20"
            />
          </div>
          {agent.key === "marketing" ? (
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="agents-audience-tag" className="text-xs text-muted-foreground">Audience tag</Label>
              <Input id="agents-audience-tag"
                value={audienceTag}
                onChange={(e) => setAudienceTag(e.target.value)}
                placeholder="intake-may"
                className="h-8"
              />
            </div>
          ) : null}
          {agent.key === "knowledge" ? (
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="agents-question" className="text-xs text-muted-foreground">Question</Label>
              <Input id="agents-question"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="pricing"
                className="h-8"
              />
            </div>
          ) : null}
          <Button size="sm" className="h-8" onClick={handleRun} disabled={runMutation.isPending}>
            <Play className="size-3.5" />
            {runMutation.isPending ? "Running..." : "Run"}
          </Button>
        </div>
        )}

        {result ? (
          <div className="mt-4 rounded-md border border-brand/30 bg-brand/5 p-3">
            <p className="text-sm font-medium">{result.summary}</p>
            {result.actions.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {result.actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check className="mt-0.5 size-3 shrink-0 text-brand" />
                    <span className="min-w-0">{action}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">
                No actions were needed this run.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---- Page ----

export default function AgentsPage() {
  const queryClient = useQueryClient();

  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: listAgents });
  const runsQuery = useQuery({ queryKey: ["agent-runs"], queryFn: listAgentRuns });

  const agents = agentsQuery.data ?? [];
  const runs = runsQuery.data ?? [];

  const agentName = (key: string): string =>
    agents.find((a) => a.key === key)?.name ?? key.charAt(0).toUpperCase() + key.slice(1);

  const handleRan = () => {
    void queryClient.invalidateQueries({ queryKey: ["agents"] });
    void queryClient.invalidateQueries({ queryKey: ["agent-runs"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="AI Agents" description="Run and review your autonomous agents." />

      {/* Agent grid */}
      {agentsQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents available"
          description="Your workspace has no AI agents configured."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent, index) => (
            <AgentCard key={agent.key} agent={agent} index={index} onRan={handleRan} />
          ))}
        </div>
      )}

      {/* Run history */}
      <section className="reveal" style={{ animationDelay: "240ms" }}>
        <Card>
          <CardHeader>
            <CardTitle>Run history</CardTitle>
          </CardHeader>
          <CardContent>
            {runsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No agent runs yet. Hit Run on any agent above.
              </p>
            ) : (
              // Cap the history height so it scrolls in place; the header
              // stays pinned while the rows move.
              <div className="max-h-[22rem] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Summary</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                      <TableHead className="text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => {
                      const Icon = AGENT_ICONS[run.agent] ?? Bot;
                      return (
                        <TableRow key={run.id}>
                          <TableCell className="whitespace-nowrap">
                            <span className="inline-flex items-center gap-2">
                              <span className="flex size-6 items-center justify-center text-brand">
                                <Icon className="size-3.5" />
                              </span>
                              <span className="text-sm font-medium">{agentName(run.agent)}</span>
                            </span>
                          </TableCell>
                          <TableCell className="max-w-md">
                            <span className="line-clamp-1 text-sm text-muted-foreground">
                              {run.summary ?? ""}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="brand" className="tabular-nums">
                              {formatNumber(run.actions.length)}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                            {timeAgo(run.created_at)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
