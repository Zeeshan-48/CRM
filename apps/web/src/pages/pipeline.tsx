import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  IndianRupee,
  Kanban,
  Lightbulb,
  Plus,
  Sparkles,
  Target,
  ThumbsDown,
  TrendingUp,
  Trophy,
  Trash2,
  ChevronDown,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  createDeal,
  createPipeline,
  deleteDeal,
  getBoard,
  getDeal,
  getDealCoach,
  getDealInsight,
  getForecast,
  listPipelines,
  loseDeal,
  moveDeal,
  winDeal,
  type BoardResponse,
  type Deal,
} from "@/lib/api/deals";
import { listAccounts } from "@/lib/api/accounts";
import { listContacts } from "@/lib/api/contacts";
import { listUsers } from "@/lib/api/users";
import { listLeadOptions } from "@/lib/api/lead-options";
import {
  formatDate,
  formatINR,
  formatNumber,
  initials,
  timeAgo,
} from "@/lib/format";
import { useConfirm } from "@/components/confirm-provider";
import { cn } from "@/lib/utils";
import { LogActivityCard } from "@/components/activities/LogActivityCard";
import { TimelineTypeFilter } from "@/components/activities/TimelineTypeFilter";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { DealProductsTab } from "@/components/products/DealProductsTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const winBadgeStyle = (probability: number): string => {
  if (probability >= 70) return "text-success";
  if (probability >= 40) return "text-warning";
  return "text-danger";
};

const healthDotStyle = (label: string | null): string => {
  if (label === "Healthy") return "bg-success";
  if (label === "At risk") return "bg-warning";
  if (label === "Critical") return "bg-danger";
  return "bg-muted-foreground/40";
};

// Text colour for the deal-health label on a card.
const healthChipStyle = (label: string | null): string => {
  if (label === "Healthy") return "text-success";
  if (label === "At risk") return "text-warning";
  if (label === "Critical") return "text-danger";
  return "text-muted-foreground";
};

// Solid fill for the win-probability bar, tiered like the badge.
const winBarFill = (probability: number): string => {
  if (probability >= 70) return "bg-success";
  if (probability >= 40) return "bg-warning";
  return "bg-danger";
};

const DEAL_STATUS_STYLES: Record<string, string> = {
  OPEN: "text-brand",
  WON: "text-success",
  LOST: "text-danger",
};

export default function PipelinePage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [pipelineId, setPipelineId] = React.useState<string>("");
  const [activeDealId, setActiveDealId] = React.useState<string | null>(null);
  // Deal activity feed type filter ("ALL" or a specific activity type).
  const [dealActivityFilter, setDealActivityFilter] = React.useState<string>("ALL");
  const [dragOverStage, setDragOverStage] = React.useState<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [newPipelineOpen, setNewPipelineOpen] = React.useState(false);
  const [newDealOpen, setNewDealOpen] = React.useState(false);
  const [lostOpen, setLostOpen] = React.useState(false);
  const [lostReason, setLostReason] = React.useState("");
  const [pipelineForm, setPipelineForm] = React.useState({
    name: "",
  });
  const [dealForm, setDealForm] = React.useState({
    title: "",
    value: "100000",
  });
  const [dealLink, setDealLink] = React.useState({
    type: "" as "" | "lead" | "contact",
    id: "",
  });
  const [dealAccountId, setDealAccountId] = React.useState("");
  const [openObjection, setOpenObjection] = React.useState<number | null>(null);

  const boardKey = React.useMemo(
    () => ["deals-board", pipelineId || "default"] as const,
    [pipelineId],
  );

  // ---- Queries ----
  const forecastQuery = useQuery({
    queryKey: ["deals-forecast"],
    queryFn: getForecast,
  });
  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: listPipelines,
  });
  const boardQuery = useQuery({
    queryKey: boardKey,
    queryFn: () => getBoard(pipelineId || undefined),
  });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const dealQuery = useQuery({
    queryKey: ["deal", activeDealId],
    queryFn: () => getDeal(activeDealId as string),
    enabled: !!activeDealId,
  });
  const coachQuery = useQuery({
    queryKey: ["deal-coach", activeDealId],
    queryFn: () => getDealCoach(activeDealId as string),
    enabled: !!activeDealId,
  });
  const insightQuery = useQuery({
    queryKey: ["deal-insight", activeDealId],
    queryFn: () => getDealInsight(activeDealId as string),
    enabled: !!activeDealId,
  });

  const users = usersQuery.data ?? [];
  const ownerOf = (ownerId: string | null) =>
    ownerId ? users.find((u) => u.id === ownerId) : undefined;

  const board = boardQuery.data;
  const forecast = forecastQuery.data;

  const invalidateBoard = () => {
    queryClient.invalidateQueries({ queryKey: ["deals-board"] });
    queryClient.invalidateQueries({ queryKey: ["deals-forecast"] });
    if (activeDealId)
      queryClient.invalidateQueries({ queryKey: ["deal", activeDealId] });
  };

  // ---- Mutations ----
  const moveMutation = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      moveDeal(dealId, stageId),
    onMutate: async ({ dealId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<BoardResponse>(boardKey);
      if (previous) {
        const moving = previous.board
          .flatMap((column) => column.deals)
          .find((deal) => deal.id === dealId);
        if (moving) {
          const next: BoardResponse = {
            ...previous,
            board: previous.board.map((column) => {
              const deals = column.deals.filter((deal) => deal.id !== dealId);
              if (column.stage.id === stageId) {
                deals.unshift({ ...moving, stage_id: stageId });
              }
              return {
                ...column,
                deals,
                total: deals.reduce((acc, deal) => acc + Number(deal.value), 0),
              };
            }),
          };
          queryClient.setQueryData(boardKey, next);
        }
      }
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(boardKey, context.previous);
      toast.error(error.message);
    },
    onSuccess: (deal) => toast.success(`"${deal.title}" moved`),
    onSettled: invalidateBoard,
  });

  const winMutation = useMutation({
    mutationFn: (dealId: string) => winDeal(dealId),
    onSuccess: (deal) => {
      toast.success(`Deal won: ${formatINR(deal.value)}`);
      invalidateBoard();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (dealId: string) => deleteDeal(dealId),
    onSuccess: () => {
      toast.success("Deal deleted");
      setActiveDealId(null);
      invalidateBoard();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const lostMutation = useMutation({
    mutationFn: ({ dealId, reason }: { dealId: string; reason?: string }) =>
      loseDeal(dealId, reason),
    onSuccess: () => {
      toast.success("Deal marked lost");
      setLostOpen(false);
      setLostReason("");
      invalidateBoard();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pipelineMutation = useMutation({
    mutationFn: () =>
      createPipeline({
        name: pipelineForm.name.trim(),
      }),
    onSuccess: (pipeline) => {
      toast.success(`Pipeline "${pipeline.name}" created`);
      setNewPipelineOpen(false);
      setPipelineForm({ name: "" });
      setPipelineId(pipeline.id);
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["deals-board"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Optional lead/contact link for a new deal. Loads lazily once a type is chosen.
  const dealLeadOptsQuery = useQuery({
    queryKey: ["lead-options"],
    queryFn: listLeadOptions,
    enabled: newDealOpen && dealLink.type === "lead",
  });
  const dealContactOptsQuery = useQuery({
    queryKey: ["contact-options"],
    queryFn: () => listContacts(),
    enabled: newDealOpen && dealLink.type === "contact",
  });
  const dealAccountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
    enabled: newDealOpen,
  });
  const dealLinkOptions: Array<{ id: string; label: string }> =
    dealLink.type === "lead"
      ? (dealLeadOptsQuery.data ?? []).map((l) => ({ id: l.id, label: l.name }))
      : dealLink.type === "contact"
        ? (dealContactOptsQuery.data ?? []).map((c) => ({
            id: c.id,
            label: c.name,
          }))
        : [];
  const dealLinkLoading =
    (dealLink.type === "lead" && dealLeadOptsQuery.isLoading) ||
    (dealLink.type === "contact" && dealContactOptsQuery.isLoading);

  const dealMutation = useMutation({
    mutationFn: () =>
      createDeal({
        title: dealForm.title.trim(),
        value: Number(dealForm.value) || 0,
        pipeline_id: board?.pipeline.id,
        lead_id:
          dealLink.type === "lead" ? dealLink.id || undefined : undefined,
        contact_id:
          dealLink.type === "contact" ? dealLink.id || undefined : undefined,
        account_id: dealAccountId || undefined,
      }),
    onSuccess: (deal) => {
      toast.success(`Deal "${deal.title}" created`);
      setNewDealOpen(false);
      setDealForm({ title: "", value: "100000" });
      setDealLink({ type: "", id: "" });
      setDealAccountId("");
      invalidateBoard();
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // ---- Drag and drop ----
  const handleDrop = (event: React.DragEvent, stageId: string) => {
    event.preventDefault();
    setDragOverStage(null);
    const dealId = event.dataTransfer.getData("text/plain");
    if (!dealId) return;
    const current = board?.board.find((column) =>
      column.deals.some((deal) => deal.id === dealId),
    );
    if (current?.stage.id === stageId) return;
    moveMutation.mutate({ dealId, stageId });
  };

  const activeDeal = dealQuery.data;

  // Type-filter chips for the deal's activity feed, built from the types present.
  const dealActivities = activeDeal?.activities ?? [];
  const dealActivityCounts = dealActivities.reduce<Record<string, number>>(
    (acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const dealActivityTypes = Array.from(new Set(dealActivities.map((a) => a.type)));
  const filteredDealActivities =
    dealActivityFilter === "ALL"
      ? dealActivities
      : dealActivities.filter((a) => a.type === dealActivityFilter);
  const coach = coachQuery.data;
  const insight = insightQuery.data?.insight;

  const forecastCards = [
    {
      label: "Open deals",
      value: formatNumber(forecast?.openDeals),
      icon: Kanban,
    },
    {
      label: "Pipeline value",
      value: formatINR(forecast?.pipelineValue),
      icon: IndianRupee,
    },
    {
      label: "Weighted",
      value: formatINR(forecast?.weighted),
      icon: TrendingUp,
    },
    { label: "Committed", value: formatINR(forecast?.committed), icon: Target },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipeline"
        description="Deals by stage with weighted forecasts."
        actions={
          <>
            {/* Pipeline switcher, only meaningful when more than one exists. */}
            {(pipelinesQuery.data?.length ?? 0) > 1 ? (
              <Select
                value={pipelineId || board?.pipeline.id || ""}
                onValueChange={(v) => setPipelineId(v)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {(pipelinesQuery.data ?? []).map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              size="sm"
              onClick={() => setNewDealOpen(true)}
              disabled={!board}
            >
              <Plus className="size-4" />
              New Deal
            </Button>
          </>
        }
      />

      {/* Forecast strip */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {forecastCards.map((card, index) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            loading={forecastQuery.isLoading}
            className="reveal"
            style={{ animationDelay: `${40 + index * 40}ms` }}
          />
        ))}
      </section>

      {/* Board */}
      {boardQuery.isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-[320px] shrink-0" />
          ))}
        </div>
      ) : boardQuery.isError || !board ? (
        <EmptyState
          icon={Kanban}
          title="No pipeline yet"
          description="Create a pipeline to start tracking deals through stages."
          action={
            <Button onClick={() => setNewPipelineOpen(true)}>
              <Plus className="size-4" />
              New Pipeline
            </Button>
          }
        />
      ) : (
        <div
          className="reveal flex items-start gap-3 overflow-x-auto pb-2"
          style={{ animationDelay: "180ms" }}
        >
          {board.board.map((column) => (
            <div
              key={column.stage.id}
              className={cn(
                "flex h-[calc(100vh-18rem)] min-h-[24rem] w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/25 transition-all duration-200",
                dragOverStage === column.stage.id
                  ? "border-brand/50 bg-brand/[0.04] ring-1 ring-brand/20"
                  : "border-border",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverStage !== column.stage.id)
                  setDragOverStage(column.stage.id);
              }}
              onDragLeave={() =>
                setDragOverStage((current) =>
                  current === column.stage.id ? null : current,
                )
              }
              onDrop={(e) => handleDrop(e, column.stage.id)}
            >
              <div
                className={cn(
                  "flex items-center justify-between gap-2 border-b px-3 py-2.5",
                  column.stage.won
                    ? "bg-success/[0.07]"
                    : column.stage.lost
                      ? "bg-destructive/[0.07]"
                      : "bg-muted/50",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      column.stage.won
                        ? "bg-success"
                        : column.stage.lost
                          ? "bg-destructive"
                          : "bg-brand/60",
                    )}
                  />
                  <p className="truncate text-sm font-semibold">
                    {column.stage.name}
                  </p>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {column.deals.length}
                  </span>
                </div>
                <p className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                  {formatINR(column.total)}
                </p>
              </div>
              <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
                {column.deals.map((deal: Deal) => {
                  const owner = ownerOf(deal.owner_id);
                  const overdue =
                    !!deal.expected_close_at &&
                    deal.status === "OPEN" &&
                    new Date(deal.expected_close_at).getTime() < Date.now();
                  return (
                    <button
                      key={deal.id}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", deal.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingId(deal.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverStage(null);
                      }}
                      onClick={() => {
                        setActiveDealId(deal.id);
                        setOpenObjection(null);
                      }}
                      className={cn(
                        "kanban-card-in block w-full cursor-grab rounded-xl border bg-card p-3.5 text-left transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:border-brand/40 active:cursor-grabbing",
                        draggingId === deal.id && "scale-[0.97] opacity-40",
                      )}
                    >
                      {/* Title */}
                      <p className="line-clamp-2 pr-1 text-sm font-semibold leading-snug text-foreground">
                        {deal.title}
                      </p>

                      {/* Value */}
                      <p className="mt-1.5 text-lg font-bold tabular-nums tracking-tight">
                        {formatINR(deal.value)}
                      </p>

                      {/* Win probability bar */}
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">
                            Win probability
                          </span>
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              winBadgeStyle(deal.win_probability),
                            )}
                          >
                            {deal.win_probability}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              winBarFill(deal.win_probability),
                            )}
                            style={{
                              width: `${Math.max(3, Math.min(100, deal.win_probability))}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Detail chips: health + expected close */}
                      {deal.health_label || deal.expected_close_at ? (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {deal.health_label ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 text-[11px] font-medium",
                                healthChipStyle(deal.health_label),
                              )}
                            >
                              <span
                                className={cn(
                                  "size-1.5 rounded-full",
                                  healthDotStyle(deal.health_label),
                                )}
                              />
                              {deal.health_label}
                            </span>
                          ) : null}
                          {deal.expected_close_at ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 text-[11px] font-medium",
                                overdue ? "text-danger" : "text-muted-foreground",
                              )}
                              title={`Expected close ${formatDate(deal.expected_close_at)}`}
                            >
                              <CalendarClock className="size-3" />
                              {overdue
                                ? "Overdue"
                                : formatDate(deal.expected_close_at, {
                                    day: "numeric",
                                    month: "short",
                                  })}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {/* Footer: owner + age */}
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                              !owner?.avatar_color && "bg-brand",
                            )}
                            style={
                              owner?.avatar_color
                                ? { backgroundColor: owner.avatar_color }
                                : undefined
                            }
                          >
                            {owner ? initials(owner.name) : "?"}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {owner?.name ?? "Unassigned"}
                          </span>
                        </div>
                        <span
                          className="shrink-0 text-[11px] text-muted-foreground"
                          title={`Created ${formatDate(deal.created_at)}`}
                        >
                          {timeAgo(deal.created_at)}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {column.deals.length === 0 ? (
                  <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                    Drop deals here
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Deal detail sheet */}
      <Sheet
        open={!!activeDealId}
        onOpenChange={(open) => {
          if (!open) setActiveDealId(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-lg">
          {dealQuery.isLoading || !activeDeal ? (
            <div className="space-y-4 pt-6">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8 text-lg">
                  {activeDeal.title}
                </SheetTitle>
                <SheetDescription asChild>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground">
                    {formatINR(activeDeal.value)}
                  </span>
                  <Badge
                    className={cn(
                      "",
                      DEAL_STATUS_STYLES[activeDeal.status],
                    )}
                  >
                    {activeDeal.status}
                  </Badge>
                  <span className="text-xs">
                    created {timeAgo(activeDeal.created_at)}
                  </span>
                  </div>
                </SheetDescription>
              </SheetHeader>

              {/* Assigned rep */}
              {(() => {
                const owner = ownerOf(activeDeal.owner_id);
                return (
                  <div className="mt-4 flex items-center gap-2.5 border-y py-2.5">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
                        !owner?.avatar_color && "bg-brand",
                      )}
                      style={
                        owner?.avatar_color
                          ? { backgroundColor: owner.avatar_color }
                          : undefined
                      }
                    >
                      {owner ? initials(owner.name) : "?"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Assigned to
                      </p>
                      <p className="truncate text-sm font-medium">
                        {owner?.name ?? "Unassigned"}
                      </p>
                    </div>
                    {owner?.email ? (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {owner.email}
                      </span>
                    ) : null}
                  </div>
                );
              })()}

              <div className="mt-4 flex items-center gap-2">
                {activeDeal.status === "OPEN" ? (
                  <>
                    <Button
                      size="sm"
                      className="bg-success text-white hover:bg-success/90"
                      disabled={winMutation.isPending}
                      onClick={() => winMutation.mutate(activeDeal.id)}
                    >
                      <Trophy className="size-4" />
                      Mark Won
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setLostOpen(true)}
                    >
                      <ThumbsDown className="size-4" />
                      Mark Lost
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground hover:text-danger"
                  disabled={deleteMutation.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Delete deal?",
                      description: `"${activeDeal.title}" will be permanently removed. This can't be undone.`,
                      destructive: true,
                      confirmText: "Delete",
                    });
                    if (ok) deleteMutation.mutate(activeDeal.id);
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </div>

              <Tabs defaultValue="insights" className="mt-5">
                <TabsList>
                  <TabsTrigger value="insights">Insights</TabsTrigger>
                  <TabsTrigger value="activity">
                    Activity
                    <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                      {activeDeal.activities.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="products">Products</TabsTrigger>
                  <TabsTrigger value="coach">AI Coach</TabsTrigger>
                </TabsList>

                <TabsContent value="products" className="space-y-4">
                  <DealProductsTab dealId={activeDeal.id} />
                </TabsContent>

                <TabsContent value="insights" className="space-y-4">
                  {/* Win probability */}
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Win probability</p>
                      <span
                        className={cn(
                          "text-xs font-semibold tabular-nums",
                          winBadgeStyle(activeDeal.winProbability),
                        )}
                      >
                        {activeDeal.winProbability}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${activeDeal.winProbability}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Health: {activeDeal.health}
                      <span className="px-1">&middot;</span>
                      score {activeDeal.healthScore}/100
                    </p>
                  </div>

                  {/* AI assessment + next best action */}
                  <div className="border-l-2 border-brand pl-3 py-1">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="size-4 text-brand" />
                      <p className="text-sm font-medium">Next best action</p>
                      {insightQuery.isFetching ? (
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                          analyzing…
                        </span>
                      ) : null}
                    </div>
                    {insight?.assessment ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">{insight.assessment}</p>
                    ) : null}
                    <p className="mt-1.5 text-sm">
                      {insight?.nextBestAction ?? activeDeal.nextBestAction}
                    </p>
                    {insight?.risks?.length ? (
                      <ul className="mt-2.5 space-y-1 border-t border-brand/20 pt-2.5">
                        {insight.risks.map((risk, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-xs text-muted-foreground"
                          >
                            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-700" />
                            <span className="min-w-0">{risk}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  {/* Best time to call */}
                  <div className="flex items-center gap-3 border-t pt-4">
                    <Clock className="size-4 text-brand" />
                    <div>
                      <p className="text-sm font-medium">Best time to call</p>
                      <p className="text-sm text-muted-foreground">
                        {activeDeal.bestTimeToCall}
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="space-y-4">
                  <LogActivityCard
                    dealId={activeDeal.id}
                    onLogged={() =>
                      queryClient.invalidateQueries({
                        queryKey: ["deal", activeDealId],
                      })
                    }
                  />
                  {activeDeal.activities.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No activity on this deal yet.
                    </p>
                  ) : (
                    <>
                      <TimelineTypeFilter
                        total={dealActivities.length}
                        value={dealActivityFilter}
                        onChange={setDealActivityFilter}
                        options={dealActivityTypes.map((type) => ({
                          value: type,
                          label:
                            type.charAt(0) + type.slice(1).toLowerCase(),
                          count: dealActivityCounts[type],
                        }))}
                      />
                    <ul className="divide-y">
                      {filteredDealActivities.map((activity) => (
                        <li key={activity.id} className="py-3">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="secondary" className="font-normal">
                              {activity.type}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {timeAgo(activity.created_at)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-medium">
                            {activity.subject || activity.type}
                          </p>
                          {activity.notes ? (
                            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                              {activity.notes}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="coach" className="space-y-4">
                  {coachQuery.isLoading || !coach ? (
                    <div className="space-y-3">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-32 w-full" />
                    </div>
                  ) : (
                    <>
                      <div className="border-l-2 border-brand pl-3 py-1">
                        <div className="flex items-center gap-2">
                          <Sparkles className="size-4 text-brand" />
                          <p className="text-sm font-medium">Strategy</p>
                        </div>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {coach.strategy}
                        </p>
                      </div>

                      <div className="border-t pt-4">
                        <p className="text-sm font-medium">Talking points</p>
                        <ul className="mt-2 space-y-1.5">
                          {coach.talkingPoints.map((point, index) => (
                            <li
                              key={index}
                              className="flex gap-2 text-sm text-muted-foreground"
                            >
                              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-lg border">
                        <p className="border-b px-4 py-3 text-sm font-medium">
                          Objection handling
                        </p>
                        <div className="divide-y">
                          {coach.objectionHandling.map((item, index) => (
                            <div key={index}>
                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium transition-colors duration-120 hover:bg-muted"
                                onClick={() =>
                                  setOpenObjection(
                                    openObjection === index ? null : index,
                                  )
                                }
                              >
                                {item.objection}
                                <ChevronDown
                                  className={cn(
                                    "size-4 shrink-0 text-muted-foreground transition-transform",
                                    openObjection === index && "rotate-180",
                                  )}
                                />
                              </button>
                              {openObjection === index ? (
                                <p className="px-4 pb-3 text-sm text-muted-foreground">
                                  {item.response}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <p className="text-sm font-medium">Suggested script</p>
                        <p className="mt-1.5 rounded-md bg-muted p-3 text-sm italic text-muted-foreground">
                          {coach.script}
                        </p>
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Lost reason dialog */}
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark deal as lost</DialogTitle>
            <DialogDescription>
              Optionally capture why; it feeds win/loss analytics.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder="Lost to competitor on price..."
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={lostMutation.isPending || !activeDealId}
              onClick={() =>
                lostMutation.mutate({
                  dealId: activeDealId as string,
                  reason: lostReason.trim() || undefined,
                })
              }
            >
              {lostMutation.isPending ? "Saving..." : "Mark lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New pipeline dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Pipeline</DialogTitle>
            <DialogDescription>
              Every pipeline uses the same seven-stage flow: Qualified → Demo
              Scheduled → Demo Completed → Proposal Sent → Negotiation → Won /
              Lost.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={pipelineForm.name}
                onChange={(e) =>
                  setPipelineForm({ ...pipelineForm, name: e.target.value })
                }
                placeholder="Enterprise sales"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPipelineOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pipelineMutation.isPending || !pipelineForm.name.trim()}
              onClick={() => pipelineMutation.mutate()}
            >
              {pipelineMutation.isPending ? "Creating..." : "Create pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New deal dialog */}
      <Dialog open={newDealOpen} onOpenChange={setNewDealOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Deal</DialogTitle>
            <DialogDescription>
              Lands in the first stage of{" "}
              {board?.pipeline.name ?? "the pipeline"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="d-title">Title</Label>
              <Input
                id="d-title"
                value={dealForm.title}
                onChange={(e) =>
                  setDealForm({ ...dealForm, title: e.target.value })
                }
                placeholder="Acme - Annual licence"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d-value">Value (INR)</Label>
              <Input
                id="d-value"
                type="number"
                min="0"
                value={dealForm.value}
                onChange={(e) =>
                  setDealForm({ ...dealForm, value: e.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Link to (optional)</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Select
                  value={dealLink.type || "__none__"}
                  onValueChange={(v) =>
                    setDealLink({
                      type: v === "__none__" ? "" : (v as "lead" | "contact"),
                      id: "",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No link" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No link</SelectItem>
                    <SelectItem value="lead">Lead</SelectItem>
                    <SelectItem value="contact">Contact</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={dealLink.id}
                  onValueChange={(v) => setDealLink({ ...dealLink, id: v })}
                  disabled={!dealLink.type}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !dealLink.type
                          ? "Select type first"
                          : dealLinkLoading
                            ? "Loading..."
                            : `Select a ${dealLink.type}...`
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {dealLinkOptions.length === 0 && !dealLinkLoading ? (
                      <SelectItem value="__empty__" disabled>
                        {dealLink.type
                          ? `No ${dealLink.type}s found`
                          : "Select type first"}
                      </SelectItem>
                    ) : (
                      dealLinkOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pipeline-account-optional">Account (optional)</Label>
              <Select
                value={dealAccountId || "__none__"}
                onValueChange={(v) =>
                  setDealAccountId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger id="pipeline-account-optional">
                  <SelectValue
                    placeholder={
                      dealAccountsQuery.isLoading ? "Loading..." : "No account"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No account</SelectItem>
                  {(dealAccountsQuery.data ?? []).map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNewDealOpen(false);
                setDealLink({ type: "", id: "" });
                setDealAccountId("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={dealMutation.isPending || !dealForm.title.trim()}
              onClick={() => dealMutation.mutate()}
            >
              {dealMutation.isPending ? "Creating..." : "Create deal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
