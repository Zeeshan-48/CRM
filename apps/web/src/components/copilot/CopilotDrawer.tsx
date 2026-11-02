import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, Loader2, Plus, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  askCopilot,
  DEFAULT_COPILOT_SUGGESTIONS,
  getCopilotSuggestions,
} from "@/lib/api/copilot";
import { BRAND } from "@/lib/brand";
import type { CopilotAnswer } from "@/types";

interface CopilotDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Gradient sparkle avatar, mirrors the Copilot button's violet→brand→sky ring. */
function AiAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims =
    size === "lg" ? "size-14 rounded-2xl" : size === "sm" ? "size-7 rounded-lg" : "size-8 rounded-lg";
  const icon = size === "lg" ? "size-7" : size === "sm" ? "size-3.5" : "size-4";
  return (
    <span
      className={`flex ${dims} shrink-0 items-center justify-center bg-brand text-brand-foreground`}
    >
      <Sparkles className={icon} />
    </span>
  );
}

export function CopilotDrawer({ open, onOpenChange }: CopilotDrawerProps) {
  const [query, setQuery] = React.useState("");
  const [history, setHistory] = React.useState<CopilotAnswer[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { data: fetchedSuggestions } = useQuery({
    queryKey: ["copilot-suggestions"],
    queryFn: getCopilotSuggestions,
    enabled: open,
    staleTime: Infinity,
    placeholderData: DEFAULT_COPILOT_SUGGESTIONS,
  });
  // Always show prompts: use the server list when it has items, otherwise the
  // built-in fallback (covers loading, an error, or an empty response).
  const suggestions =
    fetchedSuggestions && fetchedSuggestions.length > 0
      ? fetchedSuggestions
      : DEFAULT_COPILOT_SUGGESTIONS;

  const ask = useMutation({
    // Replay the turns already in view so the copilot has conversational memory.
    mutationFn: (question: string) =>
      askCopilot(
        question,
        history.map((h) => ({ question: h.question, answer: h.answer })),
      ),
    onSuccess: (answer) => {
      setHistory((prev) => [...prev, answer]);
      setQuery("");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Copilot could not answer that.");
    },
  });

  React.useEffect(() => {
    // Keep the latest answer in view.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, ask.isPending]);

  const submit = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || ask.isPending) return;
    ask.mutate(trimmed);
  };

  const resetChat = () => {
    setHistory([]);
    setQuery("");
  };

  const empty = history.length === 0 && !ask.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[460px]"
      >
        <SheetHeader className="shrink-0 space-y-0 border-b px-5 py-3.5">
          <div className="flex items-center justify-between gap-3 pr-9">
            <SheetTitle className="flex items-center gap-2.5">
              <AiAvatar />
              <span className="flex flex-col leading-tight">
                <span className="text-[15px] font-semibold tracking-tight">
                  Copilot
                </span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {BRAND.name} · your data assistant
                </span>
              </span>
            </SheetTitle>
            <SheetDescription className="sr-only">
              Ask anything about your leads, deals, customers and tickets.
            </SheetDescription>
            {history.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-muted-foreground"
                onClick={resetChat}
              >
                <Plus className="size-4" />
                New chat
              </Button>
            ) : null}
          </div>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
        >
          {empty ? (
            <div className="flex min-h-full flex-col items-center justify-center text-center">
              <AiAvatar size="lg" />
              <h3 className="mt-4 font-display text-lg font-semibold tracking-tight">
                How can I help?
              </h3>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Ask about leads, deals, customers and tickets, I&apos;ll pull
                the numbers straight from your workspace.
              </p>
              <div className="mt-7 w-full space-y-2.5">
                <p className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Try asking
                </p>
                <div className="flex flex-col gap-2">
                  {suggestions.map((suggestion, i) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => submit(suggestion)}
                      style={{ animationDelay: `${i * 40}ms` }}
                      className="group flex items-center justify-between gap-2 rounded-xl border bg-card px-3.5 py-2.5 text-left text-sm text-foreground transition-all duration-200 animate-in fade-in slide-in-from-bottom-1 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-brand/5"
                    >
                      <span className="text-muted-foreground transition-colors group-hover:text-foreground">
                        {suggestion}
                      </span>
                      <ArrowUp className="size-4 shrink-0 rotate-45 text-muted-foreground transition-all group-hover:rotate-90 group-hover:text-brand" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {history.map((entry, index) => (
                <div
                  key={`${entry.question}-${index}`}
                  className="space-y-3 duration-300 animate-in fade-in slide-in-from-bottom-2"
                >
                  {/* User turn */}
                  <div className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand px-3.5 py-2 text-sm leading-relaxed text-brand-foreground">
                      {entry.question}
                    </p>
                  </div>
                  {/* Assistant turn */}
                  <div className="flex gap-2.5">
                    <AiAvatar size="sm" />
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <div className="rounded-2xl rounded-tl-sm border bg-muted/40 px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                        {entry.answer}
                      </div>
                      {entry.columns?.length > 0 && entry.rows?.length > 0 ? (
                        <div className="overflow-x-auto rounded-xl border">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-b bg-muted/50 hover:bg-muted/50">
                                {entry.columns.map((column) => (
                                  <TableHead
                                    key={column}
                                    className="h-9 text-xs font-semibold"
                                  >
                                    {column}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {entry.rows.map((row, rowIndex) => (
                                <TableRow key={rowIndex}>
                                  {row.map((cell, cellIndex) => (
                                    <TableCell
                                      key={cellIndex}
                                      className="text-sm"
                                    >
                                      {cell}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              {ask.isPending ? (
                <div className="flex gap-2.5 duration-300 animate-in fade-in slide-in-from-bottom-2">
                  <AiAvatar size="sm" />
                  <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border bg-muted/40 px-3.5 py-3">
                    <span className="flex gap-1">
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Thinking…
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <form
          className="shrink-0 border-t bg-card px-4 pb-4 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit(query);
          }}
        >
          <div className="flex items-center gap-2 rounded-2xl border bg-background py-1.5 pl-4 pr-1.5 transition-all duration-200 focus-within:border-brand/50 focus-within:ring-4 focus-within:ring-brand/10">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask Copilot anything…"
              disabled={ask.isPending}
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={ask.isPending || !query.trim()}
              aria-label="Send"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {ask.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Copilot can make mistakes, double-check important numbers.
          </p>
        </form>
      </SheetContent>
    </Sheet>
  );
}