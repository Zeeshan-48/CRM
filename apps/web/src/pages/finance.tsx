import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  FileText,
  IndianRupee,
  Link as LinkIcon,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Trash2,
  Wallet,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  createInvoice,
  createPaymentLink,
  deleteInvoice,
  getFinanceSummary,
  listAccountOptions,
  listInvoices,
  listPayments,
  payInvoice,
  refundInvoice,
  updateInvoice,
  type Invoice,
  type InvoiceStatus,
  type PaymentStatus,
} from "@/lib/api/finance";
import { PaymentGatewaysSection } from "@/components/finance/PaymentGatewaysSection";
import { useConfirm } from "@/components/confirm-provider";
import { listContacts } from "@/lib/api/contacts";
import { formatDate, formatDateTime, formatINR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const GST_RATE = 0.18;

const INVOICE_BADGE: Record<InvoiceStatus, string> = {
  DRAFT: "text-neutral",
  SENT: "text-brand",
  PAID: "text-success",
  OVERDUE: "text-danger",
  REFUNDED: "text-neutral",
};

const PAYMENT_BADGE: Record<PaymentStatus, string> = {
  SUCCESS: "text-success",
  PENDING: "text-warning",
  FAILED: "text-danger",
  REFUNDED: "text-neutral",
};

const STICKY_HEAD = "sticky top-0 z-10 bg-card";
const INVOICE_STATUSES: InvoiceStatus[] = [
  "DRAFT",
  "SENT",
  "PAID",
  "OVERDUE",
  "REFUNDED",
];
const PAYMENT_STATUSES: PaymentStatus[] = [
  "SUCCESS",
  "PENDING",
  "FAILED",
  "REFUNDED",
];

const NO_ACCOUNT = "__none__";
const NO_CONTACT = "__none__";

// ---- New invoice dialog ----

interface NewInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function NewInvoiceDialog({ open, onOpenChange }: NewInvoiceDialogProps) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = React.useState("");
  const [tax, setTax] = React.useState("");
  const [accountId, setAccountId] = React.useState(NO_ACCOUNT);
  const [contactId, setContactId] = React.useState(NO_CONTACT);
  const [dueAt, setDueAt] = React.useState("");

  const accountsQuery = useQuery({
    queryKey: ["account-options"],
    queryFn: listAccountOptions,
    enabled: open,
  });
  const contactsQuery = useQuery({
    queryKey: ["contact-options"],
    queryFn: () => listContacts(),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: createInvoice,
    onSuccess: (invoice) => {
      toast.success(`Invoice ${invoice.number} created for ${formatINR(invoice.total)}`);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["finance-invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const parsedAmount = parseInt(amount, 10);
  const autoTax =
    !Number.isNaN(parsedAmount) && parsedAmount > 0 ? Math.round(parsedAmount * GST_RATE) : null;

  const handleSubmit = () => {
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Enter a positive amount in rupees");
      return;
    }
    const parsedTax = tax.trim() === "" ? undefined : parseInt(tax, 10);
    if (parsedTax !== undefined && (Number.isNaN(parsedTax) || parsedTax < 0)) {
      toast.error("Tax must be a non-negative amount in rupees");
      return;
    }
    createMutation.mutate({
      amount: parsedAmount,
      tax: parsedTax,
      accountId: accountId === NO_ACCOUNT ? undefined : accountId,
      contactId: contactId === NO_CONTACT ? undefined : contactId,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Amounts are whole rupees. Tax defaults to 18% GST.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inv-amount">Amount (INR)</Label>
            <Input
              id="inv-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25000"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inv-tax">Tax (INR)</Label>
            <Input
              id="inv-tax"
              type="number"
              min={0}
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              placeholder={autoTax != null ? String(autoTax) : "Auto: 18% GST"}
            />
            <p className="text-xs text-muted-foreground">
              {autoTax != null && tax.trim() === ""
                ? `Leave blank to apply 18% GST: ${formatINR(autoTax)}`
                : "Leave blank to apply 18% GST automatically."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="finance-account-2">Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="finance-account-2">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>No account</SelectItem>
                {(accountsQuery.data ?? []).map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="finance-contact-2">Contact</Label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger id="finance-contact-2">
                <SelectValue placeholder="Select contact" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONTACT}>No contact</SelectItem>
                {(contactsQuery.data ?? []).map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.name}
                    {contact.company ? ` · ${contact.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Links the invoice to a customer, used to prefill the payment link and send it to
              them. Convert a lead to a contact first to invoice it.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inv-due">Due date</Label>
            <Input
              id="inv-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={createMutation.isPending}>
            Create invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Edit invoice dialog (unpaid invoices only) ----

interface EditInvoiceDialogProps {
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
}

function EditInvoiceDialog({ invoice, onOpenChange }: EditInvoiceDialogProps) {
  const queryClient = useQueryClient();
  const open = !!invoice;
  const [amount, setAmount] = React.useState("");
  const [tax, setTax] = React.useState("");
  const [accountId, setAccountId] = React.useState(NO_ACCOUNT);
  const [contactId, setContactId] = React.useState(NO_CONTACT);
  const [dueAt, setDueAt] = React.useState("");

  // Prefill from the invoice whenever the dialog opens for a new row.
  React.useEffect(() => {
    if (invoice) {
      setAmount(String(invoice.amount));
      setTax(String(invoice.tax));
      setAccountId(invoice.account_id ?? NO_ACCOUNT);
      setContactId(invoice.contact_id ?? NO_CONTACT);
      setDueAt(invoice.due_at ? invoice.due_at.slice(0, 10) : "");
    }
  }, [invoice]);

  const accountsQuery = useQuery({
    queryKey: ["account-options"],
    queryFn: listAccountOptions,
    enabled: open,
  });
  const contactsQuery = useQuery({
    queryKey: ["contact-options"],
    queryFn: () => listContacts(),
    enabled: open,
  });

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateInvoice>[1]) =>
      updateInvoice(invoice!.id, input),
    onSuccess: (updated) => {
      toast.success(`Invoice ${updated.number} updated`);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["finance-invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleSubmit = () => {
    const parsedAmount = parseInt(amount, 10);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Enter a positive amount in rupees");
      return;
    }
    const parsedTax = tax.trim() === "" ? undefined : parseInt(tax, 10);
    if (parsedTax !== undefined && (Number.isNaN(parsedTax) || parsedTax < 0)) {
      toast.error("Tax must be a non-negative amount in rupees");
      return;
    }
    updateMutation.mutate({
      amount: parsedAmount,
      tax: parsedTax,
      accountId: accountId === NO_ACCOUNT ? null : accountId,
      contactId: contactId === NO_CONTACT ? null : contactId,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit invoice {invoice?.number}</DialogTitle>
          <DialogDescription>Only unpaid invoices can be edited. Amounts are whole rupees.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-amount">Amount (INR)</Label>
            <Input
              id="edit-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-tax">Tax (INR)</Label>
            <Input
              id="edit-tax"
              type="number"
              min={0}
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="finance-account">Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="finance-account">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>No account</SelectItem>
                {(accountsQuery.data ?? []).map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="finance-contact">Contact</Label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger id="finance-contact">
                <SelectValue placeholder="Select contact" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONTACT}>No contact</SelectItem>
                {(contactsQuery.data ?? []).map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.name}
                    {contact.company ? ` · ${contact.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-due">Due date</Label>
            <Input
              id="edit-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={updateMutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={updateMutation.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Page ----

export default function FinancePage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editInvoice, setEditInvoice] = React.useState<Invoice | null>(null);
  const [invoiceSearch, setInvoiceSearch] = React.useState("");
  const [invoiceStatus, setInvoiceStatus] = React.useState<string>("all");
  const [paymentStatus, setPaymentStatus] = React.useState<string>("all");

  const summaryQuery = useQuery({ queryKey: ["finance-summary"], queryFn: getFinanceSummary });
  const invoicesQuery = useQuery({ queryKey: ["finance-invoices"], queryFn: listInvoices });
  const paymentsQuery = useQuery({ queryKey: ["finance-payments"], queryFn: listPayments });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["finance-invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-payments"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
  };

  const payMutation = useMutation({
    mutationFn: (id: string) => payInvoice(id),
    onSuccess: (result) => {
      toast.success(
        `Invoice ${result.invoice.number} marked paid (${formatINR(result.payment.amount)})`
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refundMutation = useMutation({
    mutationFn: ({ id, manual }: { id: string; manual: boolean }) => refundInvoice(id, manual),
    onSuccess: (result, variables) => {
      toast.success(
        variables.manual
          ? `Invoice ${result.invoice.number} marked refunded (record only)`
          : `Invoice ${result.invoice.number} refunded`
      );
      invalidate();
    },
    onError: (error: Error, variables) => {
      // When the gateway rejects the refund, offer to record it manually so the
      // CRM isn't stuck (the actual money is then refunded in the Razorpay dashboard).
      if (!variables.manual && /razorpay refund failed/i.test(error.message)) {
        if (
          window.confirm(
            `${error.message}\n\nRecord it as a manual refund instead? You'll need to process the actual refund in your Razorpay dashboard.`
          )
        ) {
          refundMutation.mutate({ id: variables.id, manual: true });
          return;
        }
      }
      toast.error(error.message);
    },
  });

  const paymentLinkMutation = useMutation({
    mutationFn: (id: string) => createPaymentLink(id),
    onSuccess: (result) => {
      // Copy the link so it's ready to paste to the customer.
      void navigator.clipboard?.writeText(result.pay_url).catch(() => undefined);
      toast.success(result.simulated ? "Payment link created (simulated)." : "Payment link created.", {
        description: result.simulated
          ? "Simulation mode, this link isn't real. Connect Razorpay to collect."
          : "Link copied to clipboard, send it to the customer. The invoice flips to PAID once they pay.",
      });
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInvoice(id),
    onSuccess: () => {
      toast.success("Invoice deleted");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleDelete = async (invoice: Invoice) => {
    const ok = await confirm({
      title: `Delete ${invoice.number}?`,
      description: `This unpaid invoice (${formatINR(invoice.total)}) and any pending payment links will be permanently removed. This can't be undone.`,
      destructive: true,
      confirmText: "Delete",
    });
    if (ok) deleteMutation.mutate(invoice.id);
  };

  const handlePay = (invoice: Invoice) => {
    if (window.confirm(`Mark ${invoice.number} (${formatINR(invoice.total)}) as paid (offline)?`)) {
      payMutation.mutate(invoice.id);
    }
  };

  const handleRefund = (invoice: Invoice) => {
    if (window.confirm(`Refund ${invoice.number} (${formatINR(invoice.total)})?`)) {
      refundMutation.mutate({ id: invoice.id, manual: false });
    }
  };

  const summary = summaryQuery.data;
  const allInvoices = invoicesQuery.data ?? [];
  const allPayments = paymentsQuery.data ?? [];

  const invoiceSearchTrimmed = invoiceSearch.trim().toLowerCase();
  const invoices = allInvoices.filter((inv) => {
    if (invoiceStatus !== "all" && inv.status !== invoiceStatus) return false;
    if (!invoiceSearchTrimmed) return true;
    return (
      inv.number.toLowerCase().includes(invoiceSearchTrimmed) ||
      (inv.contact ?? "").toLowerCase().includes(invoiceSearchTrimmed) ||
      (inv.account ?? "").toLowerCase().includes(invoiceSearchTrimmed)
    );
  });
  const payments =
    paymentStatus === "all"
      ? allPayments
      : allPayments.filter((p) => p.status === paymentStatus);

  const invoicesFiltered = invoiceStatus !== "all" || invoiceSearchTrimmed !== "";

  const summaryCards = [
    { label: "Revenue", value: formatINR(summary?.revenue), icon: IndianRupee },
    { label: "Invoiced", value: formatNumber(summary?.invoiced), icon: FileText },
    { label: "Paid", value: formatNumber(summary?.paid), icon: CheckCircle2 },
    { label: "Pending", value: formatNumber(summary?.pending), icon: Clock },
    { label: "Tax collected", value: formatINR(summary?.tax), icon: Receipt },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Invoices, payments and collections."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            New Invoice
          </Button>
        }
      />

      {/* Summary strip */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {summaryCards.map((card, index) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            loading={summaryQuery.isLoading}
            className="reveal"
            style={{ animationDelay: `${60 + index * 40}ms` }}
          />
        ))}
      </section>

      {/* Payment gateways (default + Razorpay/Stripe connections) */}
      <section className="reveal" style={{ animationDelay: "210ms" }}>
        <PaymentGatewaysSection />
      </section>

      {/* Invoices */}
      <section className="reveal" style={{ animationDelay: "240ms" }}>
        <Card>
          <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                Invoices
                {!invoicesQuery.isLoading ? (
                  <span className="text-xs font-medium text-muted-foreground">
                    {invoices.length}
                  </span>
                ) : null}
              </CardTitle>
              <CardDescription>Raise, collect and refund invoices.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="Search number or customer"
                  className="h-8 w-56 pl-8 text-xs"
                />
              </div>
              <Select value={invoiceStatus} onValueChange={setInvoiceStatus}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {INVOICE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {invoicesQuery.isLoading ? (
              <div className="space-y-2 p-5 pt-0">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : invoices.length === 0 ? (
              <div className="p-5 pt-0">
                {invoicesFiltered ? (
                  <EmptyState
                    icon={Search}
                    title="No matching invoices"
                    description="Try a different search term or status filter."
                    className="border-0 py-8"
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setInvoiceSearch("");
                          setInvoiceStatus("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={Wallet}
                    title="No invoices yet"
                    description="Raise your first invoice to start tracking revenue."
                    action={
                      <Button onClick={() => setDialogOpen(true)}>
                        <Plus className="size-4" />
                        New Invoice
                      </Button>
                    }
                    className="border-0 py-10"
                  />
                )}
              </div>
            ) : (
              <div className="max-h-[30rem] overflow-auto">
                <table className="w-full caption-bottom text-sm tabular-nums">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={STICKY_HEAD}>Number</TableHead>
                      <TableHead className={STICKY_HEAD}>Customer</TableHead>
                      <TableHead className={cn(STICKY_HEAD, "text-right")}>
                        Amount
                      </TableHead>
                      <TableHead className={cn(STICKY_HEAD, "text-right")}>
                        Tax
                      </TableHead>
                      <TableHead className={cn(STICKY_HEAD, "text-right")}>
                        Total
                      </TableHead>
                      <TableHead className={STICKY_HEAD}>Status</TableHead>
                      <TableHead className={STICKY_HEAD}>Issued</TableHead>
                      <TableHead className={cn(STICKY_HEAD, "text-right")}>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {invoice.number}
                      </TableCell>
                      <TableCell>
                        {invoice.contact || invoice.account ? (
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {invoice.contact ?? invoice.account}
                            </p>
                            {invoice.contact && invoice.account ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {invoice.account}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{formatINR(invoice.amount)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatINR(invoice.tax)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatINR(invoice.total)}
                      </TableCell>
                      <TableCell>
                        <Badge className={INVOICE_BADGE[invoice.status]}>{invoice.status}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(invoice.issued_at) || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {invoice.status === "SENT" || invoice.status === "OVERDUE" ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              loading={
                                paymentLinkMutation.isPending &&
                                paymentLinkMutation.variables === invoice.id
                              }
                              onClick={() => paymentLinkMutation.mutate(invoice.id)}
                            >
                              {paymentLinkMutation.isPending &&
                              paymentLinkMutation.variables === invoice.id ? null : (
                                <LinkIcon className="size-3.5" />
                              )}
                              Payment link
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePay(invoice)}
                              loading={payMutation.isPending && payMutation.variables === invoice.id}
                            >
                              {payMutation.isPending && payMutation.variables === invoice.id ? null : (
                                <CheckCircle2 className="size-3.5" />
                              )}
                              Mark paid
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground"
                              aria-label="Edit invoice"
                              onClick={() => setEditInvoice(invoice)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-danger"
                              aria-label="Delete invoice"
                              onClick={() => handleDelete(invoice)}
                              loading={deleteMutation.isPending && deleteMutation.variables === invoice.id}
                            >
                              {deleteMutation.isPending && deleteMutation.variables === invoice.id ? null : (
                                <Trash2 className="size-3.5" />
                              )}
                            </Button>
                          </div>
                        ) : invoice.status === "PAID" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            onClick={() => handleRefund(invoice)}
                            loading={
                              refundMutation.isPending &&
                              refundMutation.variables?.id === invoice.id
                            }
                          >
                            {refundMutation.isPending &&
                            refundMutation.variables?.id === invoice.id ? null : (
                              <RotateCcw className="size-3.5" />
                            )}
                            Refund
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  </TableBody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Payments */}
      <section className="reveal" style={{ animationDelay: "300ms" }}>
        <Card>
          <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                Payments
                {!paymentsQuery.isLoading ? (
                  <span className="text-xs font-medium text-muted-foreground">
                    {payments.length}
                  </span>
                ) : null}
              </CardTitle>
              <CardDescription>
                Collections and refunds across every gateway.
              </CardDescription>
            </div>
            <Select value={paymentStatus} onValueChange={setPaymentStatus}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {PAYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            {paymentsQuery.isLoading ? (
              <div className="space-y-2 p-5 pt-0">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : payments.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                {paymentStatus === "all"
                  ? "No payments recorded yet."
                  : `No ${paymentStatus.toLowerCase()} payments.`}
              </p>
            ) : (
              <div className="max-h-[30rem] overflow-auto">
                <table className="w-full caption-bottom text-sm tabular-nums">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={STICKY_HEAD}>Reference</TableHead>
                      <TableHead className={cn(STICKY_HEAD, "text-right")}>
                        Amount
                      </TableHead>
                      <TableHead className={STICKY_HEAD}>Status</TableHead>
                      <TableHead className={STICKY_HEAD}>Gateway</TableHead>
                      <TableHead className={cn(STICKY_HEAD, "text-right")}>
                        At
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-xs">
                          {payment.reference ?? "-"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium",
                            payment.amount < 0 && "text-danger",
                          )}
                        >
                          {formatINR(payment.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge className={PAYMENT_BADGE[payment.status]}>
                            {payment.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {payment.gateway ? (
                            <span className="inline-flex items-center text-xs font-medium text-muted-foreground">
                              {payment.gateway}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                          {formatDateTime(payment.at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <NewInvoiceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <EditInvoiceDialog
        invoice={editInvoice}
        onOpenChange={(o) => !o && setEditInvoice(null)}
      />
    </div>
  );
}
