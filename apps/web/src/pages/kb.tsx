import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Eye, Plus, Search, Sparkles, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createKbArticle,
  getKbArticle,
  KB_STATUSES,
  listKbArticles,
  searchKb,
  type KbStatus,
} from "@/lib/api/kb";
import { formatDate, formatNumber } from "@/lib/format";

const STATUS_BADGE: Record<KbStatus, string> = {
  PUBLISHED: "text-success",
  DRAFT: "text-warning",
  ARCHIVED: "border-transparent bg-muted text-muted-foreground",
};

interface ArticleFormState {
  title: string;
  body: string;
  tags: string;
  status: KbStatus;
}

const EMPTY_FORM: ArticleFormState = {
  title: "",
  body: "",
  tags: "",
  status: "PUBLISHED",
};

export default function KnowledgeBasePage() {
  const queryClient = useQueryClient();

  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [form, setForm] = React.useState<ArticleFormState>(EMPTY_FORM);
  const [activeArticleId, setActiveArticleId] = React.useState<string | null>(null);

  const articlesQuery = useQuery({ queryKey: ["kb-articles"], queryFn: listKbArticles });

  const detailQuery = useQuery({
    queryKey: ["kb-article", activeArticleId],
    queryFn: () => getKbArticle(activeArticleId as string),
    enabled: activeArticleId !== null,
  });

  const searchMutation = useMutation({
    mutationFn: searchKb,
    onError: (error: Error) => toast.error(error.message || "Search failed"),
  });

  const createMutation = useMutation({
    mutationFn: createKbArticle,
    onSuccess: (article) => {
      toast.success(`Article "${article.title}" created`);
      queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (error: Error) => toast.error(error.message || "Could not create article"),
  });

  const articles = articlesQuery.data ?? [];
  const searchResults = searchMutation.data?.results;

  const openArticle = (id: string) => setActiveArticleId(id);

  const closeArticle = () => {
    setActiveArticleId(null);
    // Reading an article increments its view counter server-side, so refresh
    // the grid counts once the sheet closes.
    queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) {
      toast.error("Type something to search for.");
      return;
    }
    searchMutation.mutate(query.trim());
  };

  const submitCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error("Give the article a title.");
      return;
    }
    if (!form.body.trim()) {
      toast.error("Write the article body.");
      return;
    }
    createMutation.mutate({
      title: form.title.trim(),
      body: form.body.trim(),
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      status: form.status,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Base"
        description="Articles that power support and the Knowledge Agent."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New Article
          </Button>
        }
      />

      {/* RAG search */}
      <section className="reveal space-y-3" style={{ animationDelay: "60ms" }}>
        <form onSubmit={submitSearch} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Ask the knowledge base anything..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={searchMutation.isPending}>
            <Sparkles />
            {searchMutation.isPending ? "Searching..." : "Search"}
          </Button>
          {searchResults ? (
            <Button aria-label="Clear results"
              type="button"
              variant="ghost"
              size="icon"
              title="Clear results"
              onClick={() => {
                searchMutation.reset();
                setQuery("");
              }}
            >
              <X />
            </Button>
          ) : null}
        </form>

        {searchMutation.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : searchResults ? (
          searchResults.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
              No articles matched "{searchMutation.data?.query}". Try different words or
              create a new article.
            </div>
          ) : (
            <div className="space-y-2">
              {searchResults.map((hit) => (
                <button
                  key={hit.article.id}
                  type="button"
                  onClick={() => openArticle(hit.article.id)}
                  className="block w-full rounded-lg border bg-card p-3.5 text-left transition-colors duration-120 hover:border-brand/40 hover:bg-muted"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-display text-sm font-semibold tracking-tight">
                      {hit.article.title}
                    </p>
                    <Badge variant="brand" className="shrink-0 tabular-nums">
                      score {hit.score}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {hit.snippet}
                  </p>
                </button>
              ))}
            </div>
          )
        ) : null}
      </section>

      {/* Article grid */}
      <section className="reveal" style={{ animationDelay: "160ms" }}>
        {articlesQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No articles yet"
            description="Write your first article so support agents and the AI can answer from it."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                Write your first article
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {articles.map((article, index) => (
              <button
                key={article.id}
                type="button"
                onClick={() => openArticle(article.id)}
                className="reveal flex flex-col rounded-lg border bg-card p-4 text-left transition-colors duration-120 hover:border-brand/40 hover:bg-muted"
                style={{ animationDelay: `${60 + (index % 9) * 35}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 font-display text-sm font-semibold tracking-tight">
                    {article.title}
                  </p>
                  <Badge variant="outline" className={STATUS_BADGE[article.status]}>
                    {article.status}
                  </Badge>
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {article.body}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {article.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                    {article.tags.length > 3 ? (
                      <span className="text-[10px] text-muted-foreground">
                        +{article.tags.length - 3}
                      </span>
                    ) : null}
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    <Eye className="size-3.5" />
                    {formatNumber(article.views)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Article detail sheet */}
      <Sheet
        open={activeArticleId !== null}
        onOpenChange={(open) => {
          if (!open) closeArticle();
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          {detailQuery.isLoading || !detailQuery.data ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-48" />
            </div>
          ) : (
            <>
              <SheetHeader className="border-b p-6 pb-4">
                <SheetTitle className="pr-8">{detailQuery.data.title}</SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="flex items-center gap-1 tabular-nums">
                    <Eye className="size-3.5" />
                    {formatNumber(detailQuery.data.views)} views
                  </span>
                  <span>&middot;</span>
                  <span>Updated {formatDate(detailQuery.data.updated_at)}</span>
                </SheetDescription>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge
                    variant="outline"
                    className={STATUS_BADGE[detailQuery.data.status]}
                  >
                    {detailQuery.data.status}
                  </Badge>
                  {detailQuery.data.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </SheetHeader>
              <div className="p-6">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {detailQuery.data.body}
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* New article dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New article</DialogTitle>
            <DialogDescription>
              Published articles are searchable and used by AI Resolve on tickets.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="kb-title">Title</Label>
              <Input
                id="kb-title"
                placeholder="How to reset your password"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-body">Body</Label>
              <Textarea
                id="kb-body"
                rows={6}
                placeholder="Write the answer the way you would explain it to a customer..."
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="kb-tags">Tags</Label>
                <Input
                  id="kb-tags"
                  placeholder="billing, refunds, access"
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Comma separated.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kb-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(status) =>
                    setForm((f) => ({ ...f, status: status as KbStatus }))
                  }
                >
                  <SelectTrigger id="kb-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KB_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create article"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
