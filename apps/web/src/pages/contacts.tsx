import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Users,
} from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { listAccounts } from "@/lib/api/accounts";
import {
  createContact,
  listContacts,
  type Contact,
  type ContactLifecycle,
} from "@/lib/api/contacts";
import { formatDateTime, initials, timeAgo } from "@/lib/format";
import { usePersistentState } from "@/hooks/usePersistentState";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const LIFECYCLES: ContactLifecycle[] = ["LEAD", "PROSPECT", "CUSTOMER"];
const PAGE_SIZE = 15;

/**
 * Compact page-number window for the pager: always shows the first and last
 * page, the current page ±1, and "…" gaps between. e.g. 1 … 4 5 6 … 20.
 */
const pageWindow = (current: number, totalPages: number): (number | "…")[] => {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  if (start > 2) pages.push("…");
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages - 1) pages.push("…");
  pages.push(totalPages);
  return pages;
};

export const LIFECYCLE_STYLES: Record<ContactLifecycle, string> = {
  LEAD: "text-neutral",
  PROSPECT: "text-warning",
  CUSTOMER: "text-success",
};

export default function ContactsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Persisted to sessionStorage so search/lifecycle survive a round-trip to a
  // contact's detail page and back.
  const [search, setSearch] = usePersistentState("contacts:search", "");
  // Seed the debounced value from the restored search so the first render is
  // already filtered (no unfiltered flash before the debounce fires).
  const [debouncedQ, setDebouncedQ] = React.useState(() => search.trim());
  const [lifecycle, setLifecycle] = usePersistentState<ContactLifecycle | "">(
    "contacts:lifecycle",
    "",
  );
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    title: "",
    city: "",
    accountId: "",
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
    enabled: createOpen,
  });

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const contactsQuery = useQuery({
    queryKey: ["contacts", { q: debouncedQ, lifecycle }],
    queryFn: () =>
      listContacts({
        q: debouncedQ || undefined,
        lifecycle: lifecycle || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: createContact,
    onSuccess: (contact) => {
      toast.success(`Contact "${contact.name}" created`);
      setCreateOpen(false);
      setForm({
        name: "",
        email: "",
        phone: "",
        company: "",
        title: "",
        city: "",
        accountId: "",
      });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const allContacts = contactsQuery.data ?? [];
  const total = allContacts.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, total);
  const contacts = allContacts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = !!debouncedQ || !!lifecycle;
  const showEmpty = !contactsQuery.isLoading && total === 0;

  // Reset to the first page whenever the filtered set changes.
  React.useEffect(() => {
    setPage(1);
  }, [debouncedQ, lifecycle]);

  // Snap back if the current page overshoots the result set (e.g. after a
  // filter narrows it).
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contacts"
        description="Every person you talk to, enriched and deduplicated."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Contact
          </Button>
        }
      />

      {/* Filters */}
      <div
        className="reveal flex flex-wrap items-center gap-2"
        style={{ animationDelay: "60ms" }}
      >
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email, company..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={cn(
              "inline-flex h-9 items-center rounded-md border px-3.5 text-xs font-semibold transition-colors duration-120",
              lifecycle === ""
                ? "border-brand/40 bg-brand/10 text-brand"
                : "bg-card text-muted-foreground hover:bg-muted",
            )}
            onClick={() => setLifecycle("")}
          >
            All
          </button>
          {LIFECYCLES.map((stage) => (
            <button
              key={stage}
              type="button"
              className={cn(
                "inline-flex h-9 items-center rounded-md border px-3.5 text-xs font-semibold transition-colors duration-120",
                lifecycle === stage
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "bg-card text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setLifecycle(lifecycle === stage ? "" : stage)}
            >
              {stage}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {showEmpty ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? "No contacts match" : "No contacts yet"}
          description={
            hasFilters
              ? "Try a different search or lifecycle filter."
              : "Create a contact or convert a lead to start your book of customers."
          }
          action={
            hasFilters ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setLifecycle("");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                New Contact
              </Button>
            )
          }
        />
      ) : (
        <div
          className="reveal rounded-lg border bg-card"
          style={{ animationDelay: "120ms" }}
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Email / Phone</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contactsQuery.isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : contacts.map((contact: Contact) => (
                    <TableRow
                      key={contact.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/contacts/${contact.id}`)}
                    >
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8 shrink-0">
                            <AvatarFallback className="bg-brand/10 text-brand">
                              {initials(contact.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{contact.name}</p>
                            {contact.title ? (
                              <p className="text-xs text-muted-foreground">
                                {contact.title}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {contact.company || "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <p className="text-sm">{contact.email || "-"}</p>
                        <p className="text-xs text-muted-foreground">
                          {contact.phone || ""}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {contact.city || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "",
                            LIFECYCLE_STYLES[contact.lifecycle],
                          )}
                        >
                          {contact.lifecycle}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {contact.last_activity_at ? (
                          // Exact date + time; hover shows the relative "x ago".
                          <span title={timeAgo(contact.last_activity_at)}>
                            {formatDateTime(contact.last_activity_at)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {/* Pagination */}
          <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs tabular-nums text-muted-foreground">
              {total === 0 ? (
                "No contacts"
              ) : (
                <>
                  Showing{" "}
                  <span className="font-medium text-foreground">
                    {rangeFrom}
                  </span>
                  -
                  <span className="font-medium text-foreground">{rangeTo}</span>{" "}
                  of{" "}
                  <span className="font-medium text-foreground">{total}</span>{" "}
                  contacts
                </>
              )}
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>

                <div className="hidden items-center gap-1 sm:flex">
                  {pageWindow(page, totalPages).map((p, i) =>
                    p === "…" ? (
                      <span
                        key={`gap-${i}`}
                        className="px-1 text-xs text-muted-foreground"
                      >
                        &hellip;
                      </span>
                    ) : (
                      <Button
                        key={p}
                        variant={p === page ? "default" : "outline"}
                        size="icon"
                        className={cn(
                          "size-8 text-xs tabular-nums",
                          p === page && "pointer-events-none",
                        )}
                        aria-current={p === page ? "page" : undefined}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </Button>
                    ),
                  )}
                </div>
                <span className="px-2 text-xs tabular-nums text-muted-foreground sm:hidden">
                  {page} / {totalPages}
                </span>

                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Contact</DialogTitle>
            <DialogDescription>
              Name is required; everything else helps.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="c-name">Name</Label>
              <Input
                id="c-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ananya Iyer"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="c-email">Email</Label>
                <Input
                  id="c-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-phone">Phone</Label>
                <Input
                  id="c-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="c-company">Company</Label>
                <Input
                  id="c-company"
                  value={form.company}
                  onChange={(e) =>
                    setForm({ ...form, company: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-title">Title</Label>
                <Input
                  id="c-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="c-city">City</Label>
                <Input
                  id="c-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="contacts-account-optional">Account (optional)</Label>
                <Select
                  value={form.accountId || "__none__"}
                  onValueChange={(v) =>
                    setForm({ ...form, accountId: v === "__none__" ? "" : v })
                  }
                >
                  <SelectTrigger id="contacts-account-optional">
                    <SelectValue
                      placeholder={
                        accountsQuery.isLoading ? "Loading..." : "No account"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No account</SelectItem>
                    {(accountsQuery.data ?? []).map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={createMutation.isPending || !form.name.trim()}
              onClick={() =>
                createMutation.mutate({
                  name: form.name.trim(),
                  email: form.email || undefined,
                  phone: form.phone || undefined,
                  company: form.company || undefined,
                  title: form.title || undefined,
                  city: form.city || undefined,
                  account_id: form.accountId || undefined,
                })
              }
            >
              {createMutation.isPending ? "Creating..." : "Create contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
