import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  FileSignature,
  Globe,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  Users,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  addContract,
  createAccount,
  deleteAccount,
  deleteContract,
  getAccount,
  listAccounts,
  updateAccount,
  updateContract,
  type AccountContract,
  type AccountWithStats,
  type ContractStatus,
} from "@/lib/api/accounts";
import { listContacts, updateContact } from "@/lib/api/contacts";
import { createInvoice } from "@/lib/api/finance";
import { useConfirm } from "@/components/confirm-provider";
import { formatDate, formatINR, formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const CONTRACT_STATUSES: ContractStatus[] = ["ACTIVE", "INACTIVE", "EXPIRED"];

const CONTRACT_STATUS_STYLES: Record<string, string> = {
  ACTIVE: "text-success",
  INACTIVE: "text-neutral",
  EXPIRED: "text-danger",
};

const INVOICE_STATUS_STYLES: Record<string, string> = {
  PAID: "text-success",
  SENT: "text-brand",
  OVERDUE: "text-danger",
  DRAFT: "text-neutral",
  REFUNDED: "text-info",
};

const DEAL_STATUS_STYLES: Record<string, string> = {
  OPEN: "text-brand",
  WON: "text-success",
  LOST: "text-danger",
};

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [contractOpen, setContractOpen] = React.useState(false);
  const [editingContractId, setEditingContractId] = React.useState<
    string | null
  >(null);
  const [invoiceOpen, setInvoiceOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignContactId, setAssignContactId] = React.useState("");
  const [accountForm, setAccountForm] = React.useState({
    name: "",
    industry: "",
    size: "",
    website: "",
  });
  const [editForm, setEditForm] = React.useState({
    name: "",
    industry: "",
    size: "",
    website: "",
  });
  const [contractForm, setContractForm] = React.useState({
    title: "",
    value: "",
    status: "ACTIVE" as ContractStatus,
    start_at: "",
    end_at: "",
  });
  const [invoiceForm, setInvoiceForm] = React.useState({
    amount: "",
    tax: "",
    dueAt: "",
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
  });
  const detailQuery = useQuery({
    queryKey: ["account", activeId],
    queryFn: () => getAccount(activeId as string),
    enabled: !!activeId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createAccount({
        name: accountForm.name.trim(),
        industry: accountForm.industry || undefined,
        size: accountForm.size || undefined,
        website: accountForm.website || undefined,
      }),
    onSuccess: (account) => {
      toast.success(`Account "${account.name}" created`);
      setCreateOpen(false);
      setAccountForm({ name: "", industry: "", size: "", website: "" });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // All contacts, for the "assign contact" picker. Loads lazily when the dialog
  // opens; contacts already on this account are filtered out in the UI.
  const allContactsQuery = useQuery({
    queryKey: ["contacts-all"],
    queryFn: () => listContacts(),
    enabled: assignOpen,
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      updateContact(assignContactId, { account_id: activeId as string }),
    onSuccess: (contact) => {
      toast.success(`${contact.name} assigned to this account`);
      setAssignOpen(false);
      setAssignContactId("");
      queryClient.invalidateQueries({ queryKey: ["account", activeId] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["contacts-all"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const invalidateAccount = () => {
    queryClient.invalidateQueries({ queryKey: ["account", activeId] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  };

  const updateAccountMutation = useMutation({
    mutationFn: () =>
      updateAccount(activeId as string, {
        name: editForm.name.trim(),
        industry: editForm.industry,
        size: editForm.size,
        website: editForm.website,
      }),
    onSuccess: (account) => {
      toast.success(`Account "${account.name}" updated`);
      setEditOpen(false);
      invalidateAccount();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: () => deleteAccount(activeId as string),
    onSuccess: () => {
      toast.success("Account deleted");
      setActiveId(null);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const contractMutation = useMutation({
    mutationFn: () => {
      const body = {
        title: contractForm.title.trim(),
        value: Number(contractForm.value) || 0,
        status: contractForm.status,
        start_at: contractForm.start_at || undefined,
        end_at: contractForm.end_at || undefined,
      };
      return editingContractId
        ? updateContract(activeId as string, editingContractId, body)
        : addContract(activeId as string, body);
    },
    onSuccess: (contract) => {
      toast.success(
        `Contract "${contract.title}" ${editingContractId ? "updated" : "added"}`,
      );
      setContractOpen(false);
      setEditingContractId(null);
      setContractForm({
        title: "",
        value: "",
        status: "ACTIVE",
        start_at: "",
        end_at: "",
      });
      invalidateAccount();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteContractMutation = useMutation({
    mutationFn: (contractId: string) =>
      deleteContract(activeId as string, contractId),
    onSuccess: () => {
      toast.success("Contract deleted");
      invalidateAccount();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const invoiceMutation = useMutation({
    mutationFn: () =>
      createInvoice({
        amount: Number(invoiceForm.amount),
        tax: invoiceForm.tax.trim() ? Number(invoiceForm.tax) : undefined,
        accountId: activeId as string,
        dueAt: invoiceForm.dueAt || undefined,
      }),
    onSuccess: (invoice) => {
      toast.success(`Invoice ${invoice.number} created`);
      setInvoiceOpen(false);
      setInvoiceForm({ amount: "", tax: "", dueAt: "" });
      invalidateAccount();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openEditAccount = () => {
    if (!detail) return;
    setEditForm({
      name: detail.name,
      industry: detail.industry ?? "",
      size: detail.size ?? "",
      website: detail.website ?? "",
    });
    setEditOpen(true);
  };

  const openAddContract = () => {
    setEditingContractId(null);
    setContractForm({
      title: "",
      value: "",
      status: "ACTIVE",
      start_at: "",
      end_at: "",
    });
    setContractOpen(true);
  };

  const openEditContract = (contract: AccountContract) => {
    setEditingContractId(contract.id);
    setContractForm({
      title: contract.title,
      value: String(contract.value),
      status: contract.status,
      start_at: contract.start_at ? contract.start_at.slice(0, 10) : "",
      end_at: contract.end_at ? contract.end_at.slice(0, 10) : "",
    });
    setContractOpen(true);
  };

  const confirmDeleteAccount = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: "Delete account?",
      description: `"${detail.name}" will be permanently removed. Its contracts are deleted; linked contacts, deals and invoices are kept but unlinked. This can't be undone.`,
      destructive: true,
      confirmText: "Delete",
    });
    if (ok) deleteAccountMutation.mutate();
  };

  const confirmDeleteContract = async (contract: AccountContract) => {
    const ok = await confirm({
      title: "Delete contract?",
      description: `"${contract.title}" will be permanently removed.`,
      destructive: true,
      confirmText: "Delete",
    });
    if (ok) deleteContractMutation.mutate(contract.id);
  };

  const accounts = accountsQuery.data ?? [];
  const detail = detailQuery.data;
  const showEmpty = !accountsQuery.isLoading && accounts.length === 0;

  // Contacts not already linked to the open account.
  const linkedContactIds = new Set(detail?.contacts.map((c) => c.id) ?? []);
  const assignableContacts = (allContactsQuery.data ?? []).filter(
    (c) => !linkedContactIds.has(c.id),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accounts"
        description="Companies and organizations you sell to."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Account
          </Button>
        }
      />

      {/* Card grid */}
      {showEmpty ? (
        <EmptyState
          icon={Building2}
          title="No accounts yet"
          description="Create your first account to group contacts, deals and contracts."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New Account
            </Button>
          }
        />
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accountsQuery.isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36" />
              ))
            : accounts.map((account: AccountWithStats, index) => (
                <button
                  key={account.id}
                  type="button"
                  className="reveal rounded-lg border bg-card p-4 text-left transition-colors duration-120 hover:border-brand/40 hover:bg-brand/5"
                  style={{ animationDelay: `${40 + index * 30}ms` }}
                  onClick={() => setActiveId(account.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-9 shrink-0 items-center justify-center text-brand">
                        <Building2 className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-display text-sm font-semibold tracking-tight">
                          {account.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {account.industry || "Industry unknown"}
                        </p>
                      </div>
                    </div>
                    {account.size ? (
                      <Badge
                        variant="secondary"
                        className="shrink-0 font-normal"
                      >
                        {account.size}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t pt-3">
                    <p className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                      <Users className="size-3.5" />
                      {formatNumber(account.contactsCount)} contacts
                    </p>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatINR(account.openValue)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        open
                      </span>
                    </p>
                  </div>
                </button>
              ))}
        </section>
      )}

      {/* Detail sheet */}
      <Sheet
        open={!!activeId}
        onOpenChange={(open) => {
          if (!open) setActiveId(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-2xl">
          {detailQuery.isLoading || !detail ? (
            <div className="space-y-4 pt-6">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8 text-lg">{detail.name}</SheetTitle>
                <SheetDescription asChild>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {detail.industry ? <span>{detail.industry}</span> : null}
                  {detail.size ? (
                    <Badge variant="secondary" className="font-normal">
                      {detail.size}
                    </Badge>
                  ) : null}
                  {detail.website ? (
                    <a
                      href={
                        detail.website.startsWith("http")
                          ? detail.website
                          : `https://${detail.website}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand hover:underline"
                    >
                      <Globe className="size-3.5" />
                      {detail.website}
                    </a>
                  ) : null}
                    </div>
                  </SheetDescription>
              </SheetHeader>

              <div className="mt-3 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={openEditAccount}>
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-danger"
                  disabled={deleteAccountMutation.isPending}
                  onClick={confirmDeleteAccount}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </div>

              <div className="mt-5 space-y-5">
                {/* Contracts */}
                <section className="rounded-lg border">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <FileSignature className="size-4 text-brand" />
                      Contracts
                      <span className="text-xs font-normal tabular-nums text-muted-foreground">
                        {detail.contracts.length}
                      </span>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openAddContract}
                    >
                      <Plus className="size-3.5" />
                      Add contract
                    </Button>
                  </div>
                  {detail.contracts.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No contracts on file.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Title</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Term</TableHead>
                          <TableHead className="w-20 text-right">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.contracts.map((contract) => (
                          <TableRow key={contract.id}>
                            <TableCell className="font-medium">
                              <span className="inline-flex items-center gap-2">
                                {contract.title}
                                {contract.deal_id ? (
                                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    From deal
                                  </span>
                                ) : null}
                              </span>
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatINR(contract.value)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={cn(
                                  "",
                                  CONTRACT_STATUS_STYLES[contract.status] ??
                                    "text-muted-foreground",
                                )}
                              >
                                {contract.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {contract.start_at
                                ? formatDate(contract.start_at)
                                : "?"}
                              {" to "}
                              {contract.end_at
                                ? formatDate(contract.end_at)
                                : "open"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex items-center gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 text-muted-foreground hover:text-brand"
                                  onClick={() => openEditContract(contract)}
                                >
                                  <Pencil className="size-3.5" />
                                  <span className="sr-only">Edit contract</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 text-muted-foreground hover:text-danger"
                                  disabled={deleteContractMutation.isPending}
                                  onClick={() =>
                                    confirmDeleteContract(contract)
                                  }
                                >
                                  <Trash2 className="size-3.5" />
                                  <span className="sr-only">
                                    Delete contract
                                  </span>
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </section>

                {/* Contacts */}
                <section className="rounded-lg border">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Users className="size-4 text-brand" />
                      Contacts
                      <span className="text-xs font-normal tabular-nums text-muted-foreground">
                        {detail.contacts.length}
                      </span>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAssignContactId("");
                        setAssignOpen(true);
                      }}
                    >
                      <Plus className="size-3.5" />
                      Assign contact
                    </Button>
                  </div>
                  {detail.contacts.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No contacts linked to this account.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {detail.contacts.map((contact) => (
                        <li
                          key={contact.id}
                          className="flex items-center justify-between gap-3 px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {contact.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[contact.title, contact.email]
                                .filter(Boolean)
                                .join(" · ") || "No details"}
                            </p>
                          </div>
                          <Badge
                            variant="secondary"
                            className="shrink-0 font-normal"
                          >
                            {contact.lifecycle}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Deals */}
                <section className="rounded-lg border">
                  <p className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
                    <Receipt className="size-4 text-brand" />
                    Deals
                    <span className="text-xs font-normal tabular-nums text-muted-foreground">
                      {detail.deals.length}
                    </span>
                  </p>
                  {detail.deals.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No deals for this account.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {detail.deals.map((deal) => (
                        <li
                          key={deal.id}
                          className="flex items-center justify-between gap-3 px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {deal.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              created {timeAgo(deal.created_at)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-sm font-medium tabular-nums">
                              {formatINR(deal.value)}
                            </span>
                            <Badge
                              className={cn(
                                "",
                                DEAL_STATUS_STYLES[deal.status],
                              )}
                            >
                              {deal.status}
                            </Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Invoices */}
                <section className="rounded-lg border">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Receipt className="size-4 text-brand" />
                      Invoices
                      <span className="text-xs font-normal tabular-nums text-muted-foreground">
                        {detail.invoices.length}
                      </span>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setInvoiceForm({ amount: "", tax: "", dueAt: "" });
                        setInvoiceOpen(true);
                      }}
                    >
                      <Plus className="size-3.5" />
                      New invoice
                    </Button>
                  </div>
                  {detail.invoices.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No invoices for this account.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {detail.invoices.map((invoice) => (
                        <li
                          key={invoice.id}
                          className="flex items-center justify-between gap-3 px-4 py-2.5"
                        >
                          <div>
                            <p className="text-sm font-medium tabular-nums">
                              {invoice.number}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              issued {formatDate(invoice.issued_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium tabular-nums">
                              {formatINR(invoice.amount)}
                            </span>
                            <Badge
                              className={cn(
                                "",
                                INVOICE_STATUS_STYLES[invoice.status] ??
                                  "text-muted-foreground",
                              )}
                            >
                              {invoice.status}
                            </Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* New account dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Account</DialogTitle>
            <DialogDescription>
              A company you sell to or service.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="a-name">Name</Label>
              <Input
                id="a-name"
                value={accountForm.name}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, name: e.target.value })
                }
                placeholder="Acme Industries"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="a-industry">Industry</Label>
                <Input
                  id="a-industry"
                  value={accountForm.industry}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, industry: e.target.value })
                  }
                  placeholder="Manufacturing"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="a-size">Size</Label>
                <Input
                  id="a-size"
                  value={accountForm.size}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, size: e.target.value })
                  }
                  placeholder="51-200"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="a-website">Website</Label>
              <Input
                id="a-website"
                value={accountForm.website}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, website: e.target.value })
                }
                placeholder="acme.in"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={createMutation.isPending || !accountForm.name.trim()}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating..." : "Create account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / edit contract dialog */}
      <Dialog
        open={contractOpen}
        onOpenChange={(open) => {
          setContractOpen(open);
          if (!open) setEditingContractId(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingContractId ? "Edit contract" : "Add contract"}
            </DialogTitle>
            <DialogDescription>
              Attached to {detail?.name ?? "this account"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ct-title">Title</Label>
              <Input
                id="ct-title"
                value={contractForm.title}
                onChange={(e) =>
                  setContractForm({ ...contractForm, title: e.target.value })
                }
                placeholder="Annual support retainer"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ct-value">Value (INR)</Label>
                <Input
                  id="ct-value"
                  type="number"
                  min="0"
                  value={contractForm.value}
                  onChange={(e) =>
                    setContractForm({ ...contractForm, value: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select
                  value={contractForm.status}
                  onValueChange={(v) =>
                    setContractForm({
                      ...contractForm,
                      status: v as ContractStatus,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ct-start">Start date</Label>
                <Input
                  id="ct-start"
                  type="date"
                  value={contractForm.start_at}
                  onChange={(e) =>
                    setContractForm({
                      ...contractForm,
                      start_at: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ct-end">End date</Label>
                <Input
                  id="ct-end"
                  type="date"
                  value={contractForm.end_at}
                  onChange={(e) =>
                    setContractForm({ ...contractForm, end_at: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContractOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                contractMutation.isPending || !contractForm.title.trim()
              }
              onClick={() => contractMutation.mutate()}
            >
              {contractMutation.isPending
                ? editingContractId
                  ? "Saving..."
                  : "Adding..."
                : editingContractId
                  ? "Save changes"
                  : "Add contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign contact dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign a contact</DialogTitle>
            <DialogDescription>
              Link an existing contact to {detail?.name ?? "this account"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="accounts-contact">Contact</Label>
            <Select value={assignContactId} onValueChange={setAssignContactId}>
              <SelectTrigger id="accounts-contact">
                <SelectValue
                  placeholder={
                    allContactsQuery.isLoading
                      ? "Loading..."
                      : "Select a contact..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {assignableContacts.length === 0 &&
                !allContactsQuery.isLoading ? (
                  <SelectItem value="__empty__" disabled>
                    No other contacts available
                  </SelectItem>
                ) : (
                  assignableContacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name}
                      {contact.company ? ` · ${contact.company}` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={assignMutation.isPending || !assignContactId}
              onClick={() => assignMutation.mutate()}
            >
              {assignMutation.isPending ? "Assigning..." : "Assign contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit account dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit account</DialogTitle>
            <DialogDescription>
              Update {detail?.name ?? "this account"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="e-name">Name</Label>
              <Input
                id="e-name"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
                placeholder="Acme Industries"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="e-industry">Industry</Label>
                <Input
                  id="e-industry"
                  value={editForm.industry}
                  onChange={(e) =>
                    setEditForm({ ...editForm, industry: e.target.value })
                  }
                  placeholder="Manufacturing"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="e-size">Size</Label>
                <Input
                  id="e-size"
                  value={editForm.size}
                  onChange={(e) =>
                    setEditForm({ ...editForm, size: e.target.value })
                  }
                  placeholder="51-200"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="e-website">Website</Label>
              <Input
                id="e-website"
                value={editForm.website}
                onChange={(e) =>
                  setEditForm({ ...editForm, website: e.target.value })
                }
                placeholder="acme.in"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                updateAccountMutation.isPending || !editForm.name.trim()
              }
              onClick={() => updateAccountMutation.mutate()}
            >
              {updateAccountMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New invoice dialog */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New invoice</DialogTitle>
            <DialogDescription>
              Raise an invoice for {detail?.name ?? "this account"}. Manage
              payment in Finance.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="inv-amount">Amount (INR)</Label>
                <Input
                  id="inv-amount"
                  type="number"
                  min="1"
                  value={invoiceForm.amount}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, amount: e.target.value })
                  }
                  placeholder="50000"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="inv-tax">Tax (INR)</Label>
                <Input
                  id="inv-tax"
                  type="number"
                  min="0"
                  value={invoiceForm.tax}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, tax: e.target.value })
                  }
                  placeholder="auto (18%)"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inv-due">Due date</Label>
              <Input
                id="inv-due"
                type="date"
                value={invoiceForm.dueAt}
                onChange={(e) =>
                  setInvoiceForm({ ...invoiceForm, dueAt: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                invoiceMutation.isPending || Number(invoiceForm.amount) <= 0
              }
              onClick={() => invoiceMutation.mutate()}
            >
              {invoiceMutation.isPending ? "Creating..." : "Create invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
