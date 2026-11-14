import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  FileSignature,
  Globe,
  Pencil,
  Plus,
  Printer,
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
  type BillingType,
  type ContractMilestone,
  type ContractStatus,
  type RecurringInterval,
} from "@/lib/api/accounts";
import { listContacts, updateContact } from "@/lib/api/contacts";
import { createInvoice, deleteInvoice, payInvoice } from "@/lib/api/finance";
import { TaxInvoiceModal, type InvoiceLike } from "@/components/finance/TaxInvoiceModal";
import { amountToINRWords } from "@/lib/inr-words";
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
  const [selectedInvoice, setSelectedInvoice] = React.useState<InvoiceLike | null>(null);
  const [taxInvoiceOpen, setTaxInvoiceOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignContactId, setAssignContactId] = React.useState("");
  const [accountForm, setAccountForm] = React.useState({
    name: "",
    project_name: "",
    industry: "",
    size: "",
    website: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    gstin: "",
  });
  const [editForm, setEditForm] = React.useState({
    name: "",
    project_name: "",
    industry: "",
    size: "",
    website: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    gstin: "",
  });
  const [invoiceForm, setInvoiceForm] = React.useState({
    contractId: "",
    milestoneId: "",
    isPaid: false,
    serviceDescription: "",
    subtitle: "React Development",
    hsnSac: "998314",
    amount: "",
    tax: "",
    applyGst: true,
    dueAt: "",
    placeOfSupply: "Jharkhand (20)",
    clientAddress: "",
    clientGstin: "",
    clientPhone: "",
    clientEmail: "",
    projectType: "IT Services, Software Dev.",
    projectName: "",
    projectValue: "",
    reverseCharge: "No",
    paymentTerms: "Payment due within 15 days of invoice date.",
  });
  const [contractForm, setContractForm] = React.useState({
    title: "",
    value: "",
    status: "ACTIVE" as ContractStatus,
    billing_type: "ONE_TIME" as BillingType,
    recurring_interval: "ANNUAL" as RecurringInterval,
    recurring_value: "",
    apply_gst: true,
    start_at: "",
    end_at: "",
    payment_plan: "50_50" as
      | "100_UPFRONT"
      | "50_50"
      | "40_30_30"
      | "3_EQUAL"
      | "4_EQUAL"
      | "CUSTOM",
    upfront_due_at: "",
    upfront_status: "PENDING" as "PENDING" | "PAID",
    advance_due_at: "",
    advance_status: "PENDING" as "PENDING" | "PAID",
    delivery_due_at: "",
    delivery_status: "PENDING" as "PENDING" | "PAID",
    amc_due_at: "",
    amc_status: "PENDING" as "PENDING" | "PAID",
    custom_milestones: [] as ContractMilestone[],
    recurring_milestones: [] as ContractMilestone[],
  });

  const baseProjectVal = Number(contractForm.value) || 0;
  const projectGst = contractForm.apply_gst ? Math.round(baseProjectVal * 0.18) : 0;
  const totalProjectVal = baseProjectVal + projectGst;

  const baseAmcVal = Number(contractForm.recurring_value) || 0;
  const amcGst = contractForm.apply_gst && baseAmcVal > 0 ? Math.round(baseAmcVal * 0.18) : 0;
  const totalAmcVal = baseAmcVal + amcGst;

  const totalContractGst = projectGst + amcGst;
  const grandContractTotal = totalProjectVal + totalAmcVal;

  const customAllocated = contractForm.custom_milestones.reduce(
    (s, m) => s + (Number(m.amount) || 0),
    0,
  );
  const customRemaining = totalProjectVal - customAllocated;
  const isCustomBalanced = totalProjectVal > 0 && customRemaining === 0;
  const isCustomOverAllocated = customRemaining < 0;

  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
  });
  const detailQuery = useQuery({
    queryKey: ["account", activeId],
    queryFn: () => {
      if (!activeId) throw new Error("No active account selected");
      return getAccount(activeId);
    },
    enabled: Boolean(activeId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createAccount({
        name: accountForm.name.trim(),
        project_name: accountForm.project_name.trim() || undefined,
        industry: accountForm.industry.trim() || undefined,
        size: accountForm.size.trim() || undefined,
        website: accountForm.website.trim() || undefined,
        phone: accountForm.phone.trim() || undefined,
        email: accountForm.email.trim() || undefined,
        address: accountForm.address.trim() || undefined,
        city: accountForm.city.trim() || undefined,
        state: accountForm.state.trim() || undefined,
        pincode: accountForm.pincode.trim() || undefined,
        gstin: accountForm.gstin.trim() || undefined,
      }),
    onSuccess: (account) => {
      toast.success(`Account "${account.name}" created`);
      setCreateOpen(false);
      setAccountForm({
        name: "",
        project_name: "",
        industry: "",
        size: "",
        website: "",
        phone: "",
        email: "",
        address: "",
        city: "",
        state: "",
        pincode: "",
        gstin: "",
      });
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
    mutationFn: () => {
      if (!activeId) throw new Error("No active account selected");
      return updateContact(assignContactId, { account_id: activeId });
    },
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
    mutationFn: () => {
      if (!activeId) throw new Error("No active account selected");
      return updateAccount(activeId, {
        name: editForm.name.trim(),
        project_name: editForm.project_name.trim() || undefined,
        industry: editForm.industry.trim() || undefined,
        size: editForm.size.trim() || undefined,
        website: editForm.website.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        email: editForm.email.trim() || undefined,
        address: editForm.address.trim() || undefined,
        city: editForm.city.trim() || undefined,
        state: editForm.state.trim() || undefined,
        pincode: editForm.pincode.trim() || undefined,
        gstin: editForm.gstin.trim() || undefined,
      });
    },
    onSuccess: (account) => {
      toast.success(`Account "${account.name}" updated`);
      setEditOpen(false);
      invalidateAccount();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: () => {
      if (!activeId) throw new Error("No active account selected");
      return deleteAccount(activeId);
    },
    onSuccess: () => {
      toast.success("Account deleted");
      setActiveId(null);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const generateMilestoneId = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const buildMilestonesFromForm = (): ContractMilestone[] => {
    const milestones: ContractMilestone[] = [];

    if (contractForm.billing_type === "ONE_TIME") {
      milestones.push({
        id: generateMilestoneId(),
        name: "Project Payment (One-Time)",
        amount: totalProjectVal,
        base_amount: baseProjectVal,
        tax_amount: projectGst,
        tax_rate: contractForm.apply_gst ? 18 : 0,
        due_at: contractForm.upfront_due_at || contractForm.start_at || null,
        status: contractForm.upfront_status,
        paid_at:
          contractForm.upfront_status === "PAID"
            ? new Date().toISOString()
            : null,
      });
    } else {
      // RECURRING / INSTALLMENTS
      const list =
        contractForm.custom_milestones.length > 0
          ? contractForm.custom_milestones
          : generatePresetMilestones(
              "50_50",
              totalProjectVal,
              contractForm.start_at,
              contractForm.end_at,
            );

      list.forEach((m) => {
        const ratio = totalProjectVal > 0 ? m.amount / totalProjectVal : 0;
        const mBase = Math.round(baseProjectVal * ratio);
        const mGst = m.amount - mBase;
        milestones.push({
          ...m,
          base_amount: mBase,
          tax_amount: contractForm.apply_gst ? mGst : 0,
          tax_rate: contractForm.apply_gst ? 18 : 0,
          paid_at:
            m.status === "PAID" ? m.paid_at || new Date().toISOString() : null,
        });
      });
    }

    // AMC is available and tracked for both One-Time and Recurring
    if (baseAmcVal > 0) {
      if (contractForm.recurring_milestones && contractForm.recurring_milestones.length > 0) {
        // Preserve all historical recurring milestones
        contractForm.recurring_milestones.forEach((rec, idx) => {
          if (idx === contractForm.recurring_milestones.length - 1) {
            // Update the latest active one with form settings
            milestones.push({
              ...rec,
              amount: totalAmcVal,
              base_amount: baseAmcVal,
              tax_amount: amcGst,
              tax_rate: contractForm.apply_gst ? 18 : 0,
              due_at:
                contractForm.amc_due_at ||
                rec.due_at ||
                contractForm.end_at ||
                contractForm.start_at ||
                null,
              status: contractForm.amc_status,
              paid_at:
                contractForm.amc_status === "PAID"
                  ? rec.paid_at || new Date().toISOString()
                  : null,
            });
          } else {
            milestones.push(rec);
          }
        });
      } else {
        const periodLabel =
          contractForm.recurring_interval === "MONTHLY" ? "Month 1" : "Year 1";
        milestones.push({
          id: generateMilestoneId(),
          name: `${contractForm.recurring_interval === "MONTHLY" ? "Monthly" : "Annual"} Support & Maintenance (${periodLabel})`,
          amount: totalAmcVal,
          base_amount: baseAmcVal,
          tax_amount: amcGst,
          tax_rate: contractForm.apply_gst ? 18 : 0,
          due_at:
            contractForm.amc_due_at ||
            contractForm.end_at ||
            contractForm.start_at ||
            null,
          status: contractForm.amc_status,
          paid_at:
            contractForm.amc_status === "PAID" ? new Date().toISOString() : null,
          is_recurring: true,
        });
      }
    }

    return milestones;
  };

  const contractMutation = useMutation({
    mutationFn: () => {
      if (!activeId) throw new Error("No active account selected");
      const milestones = buildMilestonesFromForm();
      const body = {
        title: contractForm.title.trim(),
        value: totalProjectVal,
        status: contractForm.status,
        billing_type: contractForm.billing_type,
        recurring_interval:
          baseAmcVal > 0
            ? contractForm.recurring_interval
            : undefined,
        recurring_value: totalAmcVal,
        milestones,
        start_at: contractForm.start_at || undefined,
        end_at: contractForm.end_at || undefined,
      };
      return editingContractId
        ? updateContract(activeId, editingContractId, body)
        : addContract(activeId, body);
    },
    onSuccess: (contract) => {
      toast.success(
        `Contract "${contract.title}" ${editingContractId ? "updated" : "added"}`,
      );
      setContractOpen(false);
      setEditingContractId(null);
      invalidateAccount();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMilestoneMutation = useMutation({
    mutationFn: async ({
      contract,
      milestoneId,
      newStatus,
    }: {
      contract: AccountContract;
      milestoneId: string;
      newStatus: "PAID" | "PENDING";
    }) => {
      if (!activeId) throw new Error("No active account selected");
      let updatedMilestones = (contract.milestones || []).map((m) => {
        if (m.id === milestoneId) {
          return {
            ...m,
            status: newStatus,
            paid_at: newStatus === "PAID" ? new Date().toISOString() : null,
          };
        }
        return m;
      });

      // If marking an AMC milestone as PAID, automatically schedule next cycle renewal!
      if (newStatus === "PAID") {
        const target = (contract.milestones || []).find((m) => m.id === milestoneId);
        if (target && target.is_recurring) {
          const currentDueDate = target.due_at ? new Date(target.due_at) : new Date();
          const nextDueDate = new Date(currentDueDate);
          if (contract.recurring_interval === "MONTHLY") {
            nextDueDate.setMonth(nextDueDate.getMonth() + 1);
          } else {
            nextDueDate.setFullYear(nextDueDate.getFullYear() + 1);
          }

          const hasPendingRenewal = updatedMilestones.some(
            (m) => m.is_recurring && m.status === "PENDING"
          );

          if (!hasPendingRenewal) {
            const recurringMilestones = updatedMilestones.filter((m) => m.is_recurring);
            const nextPeriod = recurringMilestones.length + 1;
            const periodLabel = contract.recurring_interval === "MONTHLY" ? "Month" : "Year";

            updatedMilestones.push({
              id: generateMilestoneId(),
              name: `${contract.recurring_interval === "MONTHLY" ? "Monthly" : "Annual"} Support & Maintenance (${periodLabel} ${nextPeriod})`,
              amount: target.amount || contract.recurring_value || 0,
              base_amount: target.base_amount,
              tax_amount: target.tax_amount,
              tax_rate: target.tax_rate,
              due_at: nextDueDate.toISOString().slice(0, 10),
              status: "PENDING",
              is_recurring: true,
            });
          }
        }
      }

      return updateContract(activeId, contract.id, {
        milestones: updatedMilestones,
      });
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.newStatus === "PAID"
          ? "Payment recorded! Next renewal scheduled. 🎉"
          : "Status reset to Pending",
      );
      invalidateAccount();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addNextAmcCycleMutation = useMutation({
    mutationFn: async (contract: AccountContract) => {
      if (!activeId) throw new Error("No active account selected");
      const milestones = contract.milestones || [];
      const recurringMilestones = milestones.filter((m) => m.is_recurring);
      const latestRec = recurringMilestones[recurringMilestones.length - 1];
      const baseDueDate = latestRec?.due_at
        ? new Date(latestRec.due_at)
        : contract.end_at
          ? new Date(contract.end_at)
          : new Date();
      const nextDueDate = new Date(baseDueDate);
      if (contract.recurring_interval === "MONTHLY") {
        nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      } else {
        nextDueDate.setFullYear(nextDueDate.getFullYear() + 1);
      }
      const nextIndex = recurringMilestones.length + 1;
      const periodLabel =
        contract.recurring_interval === "MONTHLY"
          ? `Month ${nextIndex}`
          : `Year ${nextIndex}`;

      const newMilestone: ContractMilestone = {
        id: generateMilestoneId(),
        name: `${contract.recurring_interval === "MONTHLY" ? "Monthly" : "Annual"} Support & Maintenance (${periodLabel})`,
        amount: contract.recurring_value || latestRec?.amount || 0,
        base_amount: latestRec?.base_amount,
        tax_amount: latestRec?.tax_amount,
        tax_rate: latestRec?.tax_rate,
        due_at: nextDueDate.toISOString().slice(0, 10),
        status: "PENDING",
        is_recurring: true,
      };

      return updateContract(activeId, contract.id, {
        milestones: [...milestones, newMilestone],
      });
    },
    onSuccess: () => {
      toast.success("Next AMC cycle scheduled successfully! 🔄");
      invalidateAccount();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteContractMutation = useMutation({
    mutationFn: (contractId: string) => {
      if (!activeId) throw new Error("No active account selected");
      return deleteContract(activeId, contractId);
    },
    onSuccess: () => {
      toast.success("Contract deleted");
      invalidateAccount();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const invoiceMutation = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("No active account selected");
      const baseAmt = Math.round(Number(invoiceForm.amount)) || 0;
      const taxAmt = invoiceForm.applyGst
        ? invoiceForm.tax.trim()
          ? Math.round(Number(invoiceForm.tax))
          : Math.round(baseAmt * 0.18)
        : 0;
      const grandTot = baseAmt + taxAmt;

      const isInterState =
        invoiceForm.placeOfSupply &&
        !invoiceForm.placeOfSupply.includes("(20)") &&
        !invoiceForm.placeOfSupply.toLowerCase().includes("jharkhand");

      const primaryContact = detail?.contacts?.[0];
      const clientPhone = invoiceForm.clientPhone || primaryContact?.phone || "";
      const clientEmail = invoiceForm.clientEmail || primaryContact?.email || "";

      const detailsPayload = {
        client_name: detail?.name,
        client_address: invoiceForm.clientAddress || detail?.address || "",
        client_phone: clientPhone,
        client_email: clientEmail,
        client_gstin: invoiceForm.clientGstin || detail?.gstin || "",
        place_of_supply: invoiceForm.placeOfSupply,
        project_type: invoiceForm.projectType,
        project_name: invoiceForm.projectName || "IT Services & Software Development",
        project_value: Number(invoiceForm.projectValue) || grandTot,
        billing_period: invoiceForm.dueAt
          ? new Date(invoiceForm.dueAt).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : new Date().toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }),
        payment_terms: invoiceForm.paymentTerms,
        reverse_charge: invoiceForm.reverseCharge,
        items: [
          {
            description:
              invoiceForm.serviceDescription ||
              invoiceForm.projectName ||
              "Software Development & IT Services",
            subtitle: invoiceForm.subtitle?.trim() || "React Development",
            hsn_sac: invoiceForm.hsnSac || "998314",
            qty: 1,
            unit: "NOS",
            rate: baseAmt,
            amount: baseAmt,
          },
        ],
        tax_type: isInterState ? ("IGST" as const) : ("CGST_SGST" as const),
        tax_rate: invoiceForm.applyGst ? 18 : 0,
        cgst_amount: isInterState ? 0 : Math.round(taxAmt / 2),
        sgst_amount: isInterState ? 0 : taxAmt - Math.round(taxAmt / 2),
        igst_amount: isInterState ? taxAmt : 0,
        amount_in_words: amountToINRWords(grandTot),
      };

      const created = await createInvoice({
        amount: baseAmt,
        tax: taxAmt,
        accountId: activeId,
        contactId: primaryContact?.id,
        dueAt: invoiceForm.dueAt || undefined,
        details: detailsPayload,
      });

      if (invoiceForm.isPaid) {
        try {
          const payRes = await payInvoice(created.id);
          if (payRes?.invoice) {
            return {
              ...created,
              ...payRes.invoice,
              status: "PAID",
              paid_at: (payRes.invoice as any).paid_at || new Date().toISOString(),
            };
          }
        } catch (err) {
          console.warn("Auto-mark paid failed:", err);
        }
      }

      return created;
    },
    onSuccess: (invoice) => {
      toast.success(
        invoice.status === "PAID"
          ? `Receipt ${invoice.number} created (PAID)! 🧾`
          : `Invoice ${invoice.number} created successfully! 🧾`,
      );
      setInvoiceOpen(false);
      invalidateAccount();
      // Automatically pop up the Tax Invoice preview so user can print / PDF immediately!
      setSelectedInvoice(invoice);
      setTaxInvoiceOpen(true);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: (invoiceId: string) => deleteInvoice(invoiceId),
    onSuccess: () => {
      toast.success("Invoice deleted");
      invalidateAccount();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openNewInvoiceModal = () => {
    const primaryContact = detail?.contacts?.[0];
    const fullClientAddress = [
      detail?.address,
      detail?.city,
      detail?.state ? (detail?.pincode ? `${detail.state} — ${detail.pincode}` : detail.state) : detail?.pincode,
    ].filter(Boolean).join(", ");

    const place = detail?.state
      ? (detail.state.toLowerCase().includes("bengal") ? "West Bengal (19)" : detail.state.toLowerCase().includes("jharkhand") ? "Jharkhand (20)" : `${detail.state}`)
      : fullClientAddress.toLowerCase().includes("bengal")
        ? "West Bengal (19)"
        : "Jharkhand (20)";

    const firstContract = detail?.contracts?.[0];

    setInvoiceForm({
      contractId: firstContract?.id || "",
      milestoneId: "",
      isPaid: false,
      serviceDescription: firstContract ? `${firstContract.title} - Service Payment` : "IT Services & Software Development",
      subtitle: "React Development",
      hsnSac: "998314",
      amount: firstContract ? String(Math.round((firstContract.value || 10000) / 1.18)) : "",
      tax: "",
      applyGst: true,
      dueAt: new Date().toISOString().slice(0, 10),
      placeOfSupply: place,
      clientAddress: fullClientAddress || "Pathalkudwa church lane",
      clientGstin: detail?.gstin || "",
      clientPhone: detail?.phone || primaryContact?.phone || "",
      clientEmail: detail?.email || primaryContact?.email || "",
      projectType: "IT Services, Software Dev.",
      projectName: detail?.project_name || firstContract?.title || "Ngo Website Dynamic -Impact Inclusive",
      projectValue: firstContract ? String(firstContract.value) : "",
      reverseCharge: "No",
      paymentTerms: "Payment due within 15 days of invoice date.",
    });
    setInvoiceOpen(true);
  };

  const openInvoiceForMilestone = (
    contract: AccountContract,
    milestone: ContractMilestone,
  ) => {
    const primaryContact = detail?.contacts?.[0];
    const baseAmt =
      milestone.base_amount ||
      Math.round(milestone.amount / (milestone.tax_rate ? 1.18 : 1));
    const taxAmt =
      milestone.tax_amount ||
      (milestone.tax_rate ? milestone.amount - baseAmt : 0);

    const fullClientAddress = [
      detail?.address,
      detail?.city,
      detail?.state ? (detail?.pincode ? `${detail.state} — ${detail.pincode}` : detail.state) : detail?.pincode,
    ].filter(Boolean).join(", ");

    const place = detail?.state
      ? (detail.state.toLowerCase().includes("bengal") ? "West Bengal (19)" : detail.state.toLowerCase().includes("jharkhand") ? "Jharkhand (20)" : `${detail.state}`)
      : fullClientAddress.toLowerCase().includes("bengal")
        ? "West Bengal (19)"
        : "Jharkhand (20)";

    setInvoiceForm((prev) => ({
      ...prev,
      contractId: contract.id,
      milestoneId: milestone.id,
      isPaid: milestone.status === "PAID",
      serviceDescription: milestone.name,
      subtitle: prev.subtitle?.trim() || "React Development",
      hsnSac: prev.hsnSac || "998314",
      amount: String(baseAmt),
      tax: String(taxAmt),
      applyGst: milestone.tax_rate === 18 || taxAmt > 0,
      dueAt: milestone.due_at
        ? milestone.due_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      placeOfSupply: place,
      clientAddress: fullClientAddress || "Pathalkudwa church lane",
      clientGstin: detail?.gstin || "",
      clientPhone: detail?.phone || primaryContact?.phone || "",
      clientEmail: detail?.email || primaryContact?.email || "",
      projectType: "IT Services, Software Dev.",
      projectName: detail?.project_name || contract.title || "Ngo Website Dynamic -Impact Inclusive",
      projectValue: String(contract.value || milestone.amount),
      reverseCharge: "No",
      paymentTerms: "Payment due within 15 days of invoice date.",
    }));
    setInvoiceOpen(true);
  };

  const openEditAccount = () => {
    if (!detail) return;
    setEditForm({
      name: detail.name,
      project_name: detail.project_name ?? "",
      industry: detail.industry ?? "",
      size: detail.size ?? "",
      website: detail.website ?? "",
      phone: detail.phone ?? "",
      email: detail.email ?? "",
      address: detail.address ?? "",
      city: detail.city ?? "",
      state: detail.state ?? "",
      pincode: detail.pincode ?? "",
      gstin: detail.gstin ?? "",
    });
    setEditOpen(true);
  };

  const isMilestoneOverdue = (m: ContractMilestone) => {
    if (m.status === "PAID") return false;
    if (!m.due_at) return false;
    const dueDate = new Date(m.due_at);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate < today;
  };

  const generatePresetMilestones = (
    preset: "50_50" | "40_30_30" | "3_EQUAL" | "4_EQUAL",
    totalVal: number,
    startDateStr?: string,
    endDateStr?: string,
  ): ContractMilestone[] => {
    const baseDate = startDateStr ? new Date(startDateStr) : new Date();
    const addDays = (d: Date, days: number) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() + days);
      return nd.toISOString().slice(0, 10);
    };

    if (preset === "50_50") {
      const half = Math.round(totalVal / 2);
      return [
        {
          id: generateMilestoneId(),
          name: "Advance Payment (50%)",
          amount: half,
          due_at: startDateStr || addDays(baseDate, 0),
          status: "PENDING",
        },
        {
          id: generateMilestoneId(),
          name: "Final Delivery (50%)",
          amount: totalVal - half,
          due_at: endDateStr || addDays(baseDate, 30),
          status: "PENDING",
        },
      ];
    }

    if (preset === "40_30_30") {
      const m1 = Math.round(totalVal * 0.4);
      const m2 = Math.round(totalVal * 0.3);
      const m3 = totalVal - m1 - m2;
      return [
        {
          id: generateMilestoneId(),
          name: "Advance Payment (40%)",
          amount: m1,
          due_at: startDateStr || addDays(baseDate, 0),
          status: "PENDING",
        },
        {
          id: generateMilestoneId(),
          name: "Interim Milestone (30%)",
          amount: m2,
          due_at: addDays(baseDate, 30),
          status: "PENDING",
        },
        {
          id: generateMilestoneId(),
          name: "Final Delivery (30%)",
          amount: m3,
          due_at: endDateStr || addDays(baseDate, 60),
          status: "PENDING",
        },
      ];
    }

    if (preset === "3_EQUAL") {
      const each = Math.floor(totalVal / 3);
      const rem = totalVal - each * 2;
      return [
        {
          id: generateMilestoneId(),
          name: "1st Installment",
          amount: each,
          due_at: startDateStr || addDays(baseDate, 0),
          status: "PENDING",
        },
        {
          id: generateMilestoneId(),
          name: "2nd Installment",
          amount: each,
          due_at: addDays(baseDate, 30),
          status: "PENDING",
        },
        {
          id: generateMilestoneId(),
          name: "3rd Installment",
          amount: rem,
          due_at: endDateStr || addDays(baseDate, 60),
          status: "PENDING",
        },
      ];
    }

    if (preset === "4_EQUAL") {
      const each = Math.floor(totalVal / 4);
      const rem = totalVal - each * 3;
      return [
        {
          id: generateMilestoneId(),
          name: "1st Quarter Installment",
          amount: each,
          due_at: startDateStr || addDays(baseDate, 0),
          status: "PENDING",
        },
        {
          id: generateMilestoneId(),
          name: "2nd Quarter Installment",
          amount: each,
          due_at: addDays(baseDate, 30),
          status: "PENDING",
        },
        {
          id: generateMilestoneId(),
          name: "3rd Quarter Installment",
          amount: each,
          due_at: addDays(baseDate, 60),
          status: "PENDING",
        },
        {
          id: generateMilestoneId(),
          name: "4th Quarter Installment",
          amount: rem,
          due_at: endDateStr || addDays(baseDate, 90),
          status: "PENDING",
        },
      ];
    }

    return [];
  };

  const autoFillRemaining = () => {
    const currentTotal = contractForm.custom_milestones.reduce(
      (s, m) => s + (Number(m.amount) || 0),
      0,
    );
    const remaining = totalProjectVal - currentTotal;
    if (remaining === 0) return;

    setContractForm((prev) => {
      const list = [...prev.custom_milestones];
      if (list.length === 0) {
        return {
          ...prev,
          payment_plan: "CUSTOM",
          custom_milestones: [
            {
              id: generateMilestoneId(),
              name: "Full Payment",
              amount: Math.max(0, remaining),
              due_at: prev.start_at || "",
              status: "PENDING",
            },
          ],
        };
      }
      const lastIdx = list.length - 1;
      const last = list[lastIdx];
      if (last.amount === 0) {
        list[lastIdx] = { ...last, amount: Math.max(0, remaining) };
      } else if (remaining > 0) {
        list.push({
          id: generateMilestoneId(),
          name: `Balance Payment (${totalProjectVal > 0 ? Math.round((remaining / totalProjectVal) * 100) : 0}%)`,
          amount: remaining,
          due_at: prev.end_at || "",
          status: "PENDING",
        });
      } else {
        list[lastIdx] = { ...last, amount: Math.max(0, last.amount + remaining) };
      }
      return {
        ...prev,
        payment_plan: "CUSTOM",
        custom_milestones: list,
      };
    });
  };

  const distributeEqually = () => {
    setContractForm((prev) => {
      const count = prev.custom_milestones.length;
      if (count === 0) return prev;
      const each = Math.floor(totalProjectVal / count);
      const rem = totalProjectVal - each * (count - 1);
      const updated = prev.custom_milestones.map((m, idx) => ({
        ...m,
        amount: idx === count - 1 ? rem : each,
      }));
      return {
        ...prev,
        payment_plan: "CUSTOM",
        custom_milestones: updated,
      };
    });
  };

  const selectPreset = (
    preset: "50_50" | "40_30_30" | "3_EQUAL" | "4_EQUAL" | "CUSTOM",
  ) => {
    if (preset === "CUSTOM") {
      setContractForm((prev) => ({ ...prev, payment_plan: "CUSTOM" }));
      return;
    }
    const newMilestones = generatePresetMilestones(
      preset,
      totalProjectVal,
      contractForm.start_at,
      contractForm.end_at,
    );
    setContractForm((prev) => ({
      ...prev,
      payment_plan: preset,
      custom_milestones: newMilestones,
    }));
  };

  const addCustomMilestone = () => {
    const currentTotal = contractForm.custom_milestones.reduce(
      (s, m) => s + (Number(m.amount) || 0),
      0,
    );
    const suggestedAmount = Math.max(0, totalProjectVal - currentTotal);

    setContractForm((prev) => ({
      ...prev,
      payment_plan: "CUSTOM",
      custom_milestones: [
        ...prev.custom_milestones,
        {
          id: generateMilestoneId(),
          name: `Installment ${prev.custom_milestones.length + 1}`,
          amount: suggestedAmount,
          due_at: prev.end_at || "",
          status: "PENDING",
        },
      ],
    }));
  };

  const updateCustomMilestone = (
    index: number,
    patch: Partial<ContractMilestone>,
  ) => {
    setContractForm((prev) => {
      const updated = [...prev.custom_milestones];
      updated[index] = { ...updated[index], ...patch };
      return { ...prev, custom_milestones: updated };
    });
  };

  const removeCustomMilestone = (index: number) => {
    setContractForm((prev) => ({
      ...prev,
      payment_plan: "CUSTOM",
      custom_milestones: prev.custom_milestones.filter((_, i) => i !== index),
    }));
  };

  const openAddContract = () => {
    setEditingContractId(null);
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const nextYearStr = nextYear.toISOString().slice(0, 10);

    const initialMilestones = generatePresetMilestones("50_50", 0, today, nextYearStr);

    setContractForm({
      title: "",
      value: "",
      status: "ACTIVE",
      billing_type: "ONE_TIME",
      recurring_interval: "ANNUAL",
      recurring_value: "",
      apply_gst: true,
      start_at: today,
      end_at: nextYearStr,
      payment_plan: "50_50",
      upfront_due_at: today,
      upfront_status: "PENDING",
      advance_due_at: today,
      advance_status: "PENDING",
      delivery_due_at: "",
      delivery_status: "PENDING",
      amc_due_at: nextYearStr,
      amc_status: "PENDING",
      custom_milestones: initialMilestones,
      recurring_milestones: [],
    });
    setContractOpen(true);
  };

  const openEditContract = (contract: AccountContract) => {
    setEditingContractId(contract.id);

    const milestones = contract.milestones || [];
    const recurringMilestones = milestones.filter((m) => m.is_recurring);
    const nonRecurringMilestones = milestones.filter((m) => !m.is_recurring);

    let paymentPlan:
      | "100_UPFRONT"
      | "50_50"
      | "40_30_30"
      | "3_EQUAL"
      | "4_EQUAL"
      | "CUSTOM" = "50_50";
    let upfrontDue = contract.start_at ? contract.start_at.slice(0, 10) : "";
    let upfrontStatus: "PENDING" | "PAID" = "PENDING";
    let advanceDue = "";
    let advanceStatus: "PENDING" | "PAID" = "PENDING";
    let deliveryDue = "";
    let deliveryStatus: "PENDING" | "PAID" = "PENDING";

    if (nonRecurringMilestones.length === 1) {
      paymentPlan = "100_UPFRONT";
      upfrontDue = nonRecurringMilestones[0].due_at
        ? nonRecurringMilestones[0].due_at.slice(0, 10)
        : "";
      upfrontStatus =
        nonRecurringMilestones[0].status === "PAID" ? "PAID" : "PENDING";
    } else if (
      nonRecurringMilestones.length === 2 &&
      nonRecurringMilestones[0].amount === nonRecurringMilestones[1].amount
    ) {
      paymentPlan = "50_50";
      advanceDue = nonRecurringMilestones[0].due_at
        ? nonRecurringMilestones[0].due_at.slice(0, 10)
        : "";
      advanceStatus =
        nonRecurringMilestones[0].status === "PAID" ? "PAID" : "PENDING";
      deliveryDue = nonRecurringMilestones[1].due_at
        ? nonRecurringMilestones[1].due_at.slice(0, 10)
        : "";
      deliveryStatus =
        nonRecurringMilestones[1].status === "PAID" ? "PAID" : "PENDING";
    } else if (nonRecurringMilestones.length === 3) {
      const tot = contract.value || 0;
      if (tot > 0 && Math.abs(nonRecurringMilestones[0].amount / tot - 0.4) < 0.05) {
        paymentPlan = "40_30_30";
      } else {
        paymentPlan = "3_EQUAL";
      }
    } else if (nonRecurringMilestones.length === 4) {
      paymentPlan = "4_EQUAL";
    } else {
      paymentPlan = "CUSTOM";
    }

    const latestAmc = recurringMilestones[recurringMilestones.length - 1];
    const amcDue = latestAmc?.due_at
      ? latestAmc.due_at.slice(0, 10)
      : contract.end_at
        ? contract.end_at.slice(0, 10)
        : "";
    const amcStatus: "PENDING" | "PAID" =
      latestAmc?.status === "PAID" ? "PAID" : "PENDING";

    const billingType: BillingType =
      contract.billing_type === "RECURRING" ||
      (nonRecurringMilestones.length > 1 && contract.billing_type === "HYBRID")
        ? "RECURRING"
        : "ONE_TIME";

    const hasGst = milestones.some(
      (m) => m.tax_rate === 18 || Number(m.tax_amount) > 0,
    );

    let projValueStr = String(contract.value || 0);
    if (hasGst) {
      const sumBase = nonRecurringMilestones.reduce(
        (acc, m) => acc + (Number(m.base_amount) || 0),
        0,
      );
      if (sumBase > 0) {
        projValueStr = String(sumBase);
      } else if (contract.value > 0) {
        projValueStr = String(Math.round(contract.value / 1.18));
      }
    }

    let amcValueStr = contract.recurring_value
      ? String(contract.recurring_value)
      : "";
    if (hasGst && contract.recurring_value > 0) {
      const amcMilestone = recurringMilestones[0];
      if (amcMilestone?.base_amount) {
        amcValueStr = String(amcMilestone.base_amount);
      } else {
        amcValueStr = String(Math.round(contract.recurring_value / 1.18));
      }
    }

    setContractForm({
      title: contract.title,
      value: projValueStr,
      status: contract.status,
      billing_type: billingType,
      recurring_interval: contract.recurring_interval || "ANNUAL",
      recurring_value: amcValueStr,
      apply_gst: hasGst || true,
      start_at: contract.start_at ? contract.start_at.slice(0, 10) : "",
      end_at: contract.end_at ? contract.end_at.slice(0, 10) : "",
      payment_plan: paymentPlan,
      upfront_due_at: upfrontDue,
      upfront_status: upfrontStatus,
      advance_due_at: advanceDue,
      advance_status: advanceStatus,
      delivery_due_at: deliveryDue,
      delivery_status: deliveryStatus,
      amc_due_at: amcDue,
      amc_status: amcStatus,
      recurring_milestones: recurringMilestones,
      custom_milestones:
        nonRecurringMilestones.length > 0
          ? nonRecurringMilestones
          : generatePresetMilestones(
              "50_50",
              Number(projValueStr) || 0,
              contract.start_at ? contract.start_at.slice(0, 10) : "",
              contract.end_at ? contract.end_at.slice(0, 10) : "",
            ),
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
  const showEmpty =
    !accountsQuery.isLoading && !accountsQuery.isError && accounts.length === 0;

  // Contacts not already linked to the open account.
  const linkedContactIds = new Set(detail?.contacts.map((c) => c.id) ?? []);
  const assignableContacts = (allContactsQuery.data ?? []).filter(
    (c) => !linkedContactIds.has(c.id),
  );

  const invBaseAmt = Math.round(Number(invoiceForm.amount)) || 0;
  const invTaxAmt = invoiceForm.applyGst
    ? invoiceForm.tax.trim()
      ? Math.round(Number(invoiceForm.tax))
      : Math.round(invBaseAmt * 0.18)
    : 0;
  const invTotal = invBaseAmt + invTaxAmt;

  const availableMilestones = (detail?.contracts ?? []).flatMap((c) =>
    (c.milestones ?? [])
      .filter((m) => m.status === "PAID")
      .map((m) => ({
        contract: c,
        milestone: m,
        id: `${c.id}:${m.id}`,
        label: `${c.title} • ${m.name} (${formatINR(m.amount)}) [PAID]`,
      })),
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
      {accountsQuery.isError ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-6 text-center text-sm text-destructive">
          {accountsQuery.error instanceof Error
            ? accountsQuery.error.message
            : "Failed to load accounts. Please try refreshing."}
        </div>
      ) : showEmpty ? (
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
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-display text-sm font-semibold tracking-tight">
                            {account.name}
                          </p>
                          {account.hasAmcDue ? (
                            <span
                              className="relative flex size-2 shrink-0"
                              title="Annual Support / AMC Renewal Due!"
                            >
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                              <span className="relative inline-flex size-2 rounded-full bg-rose-500"></span>
                            </span>
                          ) : account.hasOverdue ? (
                            <span
                              className="relative flex size-2 shrink-0"
                              title="Payment Overdue"
                            >
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                              <span className="relative inline-flex size-2 rounded-full bg-rose-500"></span>
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {account.industry || "Industry unknown"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {account.hasAmcDue ? (
                        <Badge
                          variant="outline"
                          className="border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium text-[11px] gap-1 px-1.5 py-0.5"
                        >
                          <span className="size-1.5 rounded-full bg-rose-500"></span>
                          AMC Due
                        </Badge>
                      ) : account.hasOverdue ? (
                        <Badge
                          variant="outline"
                          className="border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium text-[11px] gap-1 px-1.5 py-0.5"
                        >
                          <span className="size-1.5 rounded-full bg-rose-500"></span>
                          Overdue
                        </Badge>
                      ) : account.size ? (
                        <Badge
                          variant="secondary"
                          className="shrink-0 font-normal"
                        >
                          {account.size}
                        </Badge>
                      ) : null}
                    </div>
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
          {detailQuery.isLoading ? (
            <div className="space-y-4 pt-6">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : detailQuery.isError || !detail ? (
            <div className="p-6 text-center text-sm text-destructive">
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Failed to load account details."}
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
                    <div className="divide-y">
                      {detail.contracts.map((contract) => {
                        const milestones = contract.milestones || [];
                        const totalMilestones = milestones.length;
                        const paidMilestones = milestones.filter(
                          (m) => m.status === "PAID",
                        );
                        const paidAmount = paidMilestones.reduce(
                          (sum, m) => sum + (Number(m.amount) || 0),
                          0,
                        );
                        const totalMilestoneAmount = milestones.reduce(
                          (sum, m) => sum + (Number(m.amount) || 0),
                          0,
                        );
                        const overdueMilestones = milestones.filter((m) =>
                          isMilestoneOverdue(m),
                        );
                        const billingType =
                          contract.billing_type || "ONE_TIME";
                        const targetTotal =
                          totalMilestoneAmount > 0
                            ? totalMilestoneAmount
                            : contract.value;
                        const progressPercent =
                          targetTotal > 0
                            ? Math.min(
                                100,
                                Math.round((paidAmount / targetTotal) * 100),
                              )
                            : 0;

                        return (
                          <div
                            key={contract.id}
                            className="p-4 transition-colors hover:bg-muted/10"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold text-sm">
                                    {contract.title}
                                  </p>
                                  {contract.deal_id ? (
                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      From deal
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "font-normal text-[11px]",
                                      billingType === "RECURRING"
                                        ? "border-purple-500/30 text-purple-600 bg-purple-50/50 dark:bg-purple-950/20"
                                        : "border-blue-500/30 text-blue-600 bg-blue-50/50 dark:bg-blue-950/20",
                                    )}
                                  >
                                    {billingType === "RECURRING"
                                      ? "🔄 Installments / Recurring"
                                      : "🪙 One-Time"}
                                  </Badge>

                                  <Badge
                                    className={cn(
                                      "text-[11px]",
                                      CONTRACT_STATUS_STYLES[contract.status] ??
                                        "text-muted-foreground",
                                    )}
                                  >
                                    {contract.status}
                                  </Badge>

                                  <span className="flex items-center gap-1">
                                    <Calendar className="size-3" />
                                    {contract.start_at
                                      ? formatDate(contract.start_at)
                                      : "Open"}
                                    {" → "}
                                    {contract.end_at
                                      ? formatDate(contract.end_at)
                                      : "Ongoing"}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  <p className="font-semibold text-sm tabular-nums">
                                    {formatINR(contract.value)}
                                  </p>
                                  {(contract.milestones || []).some(
                                    (m) =>
                                      (m as any).tax_rate === 18 ||
                                      Number((m as any).tax_amount) > 0,
                                  ) && (
                                    <span className="text-[10px] text-muted-foreground block -mt-0.5 font-normal">
                                      incl. 18% GST
                                    </span>
                                  )}
                                  {contract.recurring_value > 0 ? (
                                    <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                                      + {formatINR(contract.recurring_value)} /{" "}
                                      {contract.recurring_interval === "MONTHLY"
                                        ? "mo AMC"
                                        : "yr AMC"}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-muted-foreground hover:text-brand"
                                    onClick={() => openEditContract(contract)}
                                  >
                                    <Pencil className="size-3.5" />
                                    <span className="sr-only">
                                      Edit contract
                                    </span>
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
                              </div>
                            </div>

                            {/* Milestones & Payment Tracking */}
                            <div className="mt-3 rounded-lg border bg-muted/20 p-3">
                              {totalMilestones > 0 ? (
                                <div className="space-y-3">
                                  {/* Progress bar */}
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="font-medium text-muted-foreground">
                                        Payment Progress ({paidMilestones.length}
                                        /{totalMilestones} received)
                                      </span>
                                      <div className="flex items-center gap-2">
                                        {contract.recurring_value > 0 ? (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-1.5 text-[11px] text-brand hover:text-brand/80"
                                            disabled={addNextAmcCycleMutation.isPending}
                                            onClick={() => addNextAmcCycleMutation.mutate(contract)}
                                            title="Schedule next renewal cycle in advance"
                                          >
                                            + Next AMC Cycle
                                          </Button>
                                        ) : null}
                                        <span className="font-semibold tabular-nums">
                                          {formatINR(paidAmount)}{" "}
                                          <span className="font-normal text-muted-foreground">
                                            of
                                          </span>{" "}
                                          {formatINR(targetTotal)} (
                                          {progressPercent}%)
                                        </span>
                                      </div>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                                      <div
                                        className={cn(
                                          "h-full transition-all duration-300",
                                          progressPercent >= 100
                                            ? "bg-emerald-500"
                                            : "bg-brand",
                                        )}
                                        style={{
                                          width: `${progressPercent}%`,
                                        }}
                                      />
                                    </div>
                                  </div>

                                  {/* Multi-cycle AMC unpaid alert */}
                                  {(() => {
                                    const pendingAmcs = milestones.filter(
                                      (m) => m.is_recurring && m.status !== "PAID",
                                    );
                                    if (pendingAmcs.length > 1) {
                                      const totPendingAmc = pendingAmcs.reduce(
                                        (s, m) => s + (Number(m.amount) || 0),
                                        0,
                                      );
                                      return (
                                        <div className="flex items-center justify-between rounded-md border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-xs text-purple-700 dark:text-purple-300">
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-semibold">⚠️ {pendingAmcs.length} AMC cycles unpaid:</span>
                                            <span>Previous year overdue + current cycle ({formatINR(totPendingAmc)} accumulated)</span>
                                          </div>
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}

                                  {/* Overdue alert if applicable */}
                                  {overdueMilestones.length > 0 ? (
                                    <div className="flex items-center gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs text-destructive">
                                      <AlertCircle className="size-3.5 shrink-0" />
                                      <span>
                                        Action needed:{" "}
                                        {overdueMilestones.length} milestone(s)
                                        overdue!
                                      </span>
                                    </div>
                                  ) : null}

                                  {/* Milestones list */}
                                  <div className="space-y-1.5">
                                    {milestones.map((m) => {
                                      const overdue = isMilestoneOverdue(m);
                                      return (
                                        <div
                                          key={m.id}
                                          className={cn(
                                            "flex items-center justify-between gap-2 rounded-md border p-2 text-xs transition-colors",
                                            m.status === "PAID"
                                              ? "border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20"
                                              : overdue
                                                ? "border-destructive/40 bg-destructive/5"
                                                : "bg-card",
                                          )}
                                        >
                                          <div className="flex min-w-0 items-center gap-2">
                                            {m.status === "PAID" ? (
                                              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                            ) : overdue ? (
                                              <AlertCircle className="size-4 shrink-0 text-destructive" />
                                            ) : (
                                              <Clock className="size-4 shrink-0 text-amber-500" />
                                            )}
                                            <div className="min-w-0">
                                              <p className="truncate font-medium">
                                                {m.name}
                                              </p>
                                              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                                {m.status === "PAID" ? (
                                                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                                    Paid{" "}
                                                    {m.paid_at
                                                      ? formatDate(m.paid_at)
                                                      : ""}
                                                  </span>
                                                ) : overdue ? (
                                                  <span className="font-medium text-destructive">
                                                    Overdue (due{" "}
                                                    {m.due_at
                                                      ? formatDate(m.due_at)
                                                      : "unspecified"}
                                                    )
                                                  </span>
                                                ) : (
                                                  <span>
                                                    Due{" "}
                                                    {m.due_at
                                                      ? formatDate(m.due_at)
                                                      : "unspecified"}
                                                  </span>
                                                )}
                                                {m.is_recurring ? (
                                                  <span className="rounded bg-purple-500/10 px-1 py-0.2 text-[10px] text-purple-600 font-medium">
                                                    AMC
                                                  </span>
                                                ) : null}
                                              </p>
                                            </div>
                                          </div>

                                          <div className="flex shrink-0 items-center gap-2">
                                            <div className="text-right">
                                              <span className="font-semibold tabular-nums block">
                                                {formatINR(m.amount)}
                                              </span>
                                              {m.tax_amount && m.tax_amount > 0 ? (
                                                <span className="text-[10px] text-muted-foreground font-mono block">
                                                  (incl. {formatINR(m.tax_amount)} GST)
                                                </span>
                                              ) : null}
                                            </div>
                                            {m.status === "PAID" ? (
                                              <>
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  className="h-6 px-2 text-[11px] text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800 shadow-none font-medium"
                                                  onClick={() =>
                                                    openInvoiceForMilestone(contract, m)
                                                  }
                                                  title="Generate / View Paid Receipt for this milestone"
                                                >
                                                  🧾 Receipt
                                                </Button>
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-6 px-2 text-[11px] text-muted-foreground hover:text-amber-600"
                                                  disabled={
                                                    toggleMilestoneMutation.isPending
                                                  }
                                                  onClick={() =>
                                                    toggleMilestoneMutation.mutate(
                                                      {
                                                        contract,
                                                        milestoneId: m.id,
                                                        newStatus: "PENDING",
                                                      },
                                                    )
                                                  }
                                                  title="Revert to Pending"
                                                >
                                                  Undo
                                                </Button>
                                              </>
                                            ) : (
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className={cn(
                                                  "h-6 px-2 text-[11px] font-medium shadow-none",
                                                  overdue
                                                    ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                                                    : "border-emerald-600/30 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
                                                )}
                                                disabled={
                                                  toggleMilestoneMutation.isPending
                                                }
                                                onClick={() =>
                                                  toggleMilestoneMutation.mutate(
                                                    {
                                                      contract,
                                                      milestoneId: m.id,
                                                      newStatus: "PAID",
                                                    },
                                                  )
                                                }
                                              >
                                                <Check className="mr-1 size-3" />
                                                Mark Paid
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <span>No payment milestones added yet.</span>
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0 text-xs text-brand"
                                    onClick={() => openEditContract(contract)}
                                  >
                                    + Add payment milestones
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
                                DEAL_STATUS_STYLES[deal.status] ??
                                  "text-muted-foreground",
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
                      onClick={openNewInvoiceModal}
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
                              {formatINR((invoice.amount || 0) + (invoice.tax || 0))}
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
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-brand hover:text-brand hover:bg-brand/10 font-medium"
                              onClick={() => {
                                setSelectedInvoice(invoice);
                                setTaxInvoiceOpen(true);
                              }}
                            >
                              <Printer className="size-3.5 mr-1" />
                              View / Print
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={deleteInvoiceMutation.isPending}
                              onClick={async () => {
                                const ok = await confirm({
                                  title: "Delete Invoice?",
                                  description: `Invoice ${invoice.number} will be permanently deleted. This cannot be undone.`,
                                  confirmText: "Delete",
                                  destructive: true,
                                });
                                if (ok) deleteInvoiceMutation.mutate(invoice.id);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
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
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Account</DialogTitle>
            <DialogDescription>
              A company you sell to or service.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-1">
            <div className="grid gap-1.5">
              <Label htmlFor="a-name">Name</Label>
              <Input
                id="a-name"
                value={accountForm.name}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, name: e.target.value })
                }
                placeholder="Acme Industries"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="a-project-name">Project Name</Label>
              <Input
                id="a-project-name"
                value={accountForm.project_name}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, project_name: e.target.value })
                }
                placeholder="e.g. NGO Website Dynamic – Impact Inclusive"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="a-phone">Phone</Label>
                <Input
                  id="a-phone"
                  value={accountForm.phone}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, phone: e.target.value })
                  }
                  placeholder="+91 98765 43210"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="a-email">Email</Label>
                <Input
                  id="a-email"
                  type="email"
                  value={accountForm.email}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, email: e.target.value })
                  }
                  placeholder="accounts@client.com"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="a-address">Billing Address</Label>
              <Input
                id="a-address"
                value={accountForm.address}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, address: e.target.value })
                }
                placeholder="Street address, building, area"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="a-city">City</Label>
                <Input
                  id="a-city"
                  value={accountForm.city}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, city: e.target.value })
                  }
                  placeholder="Kolkata"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="a-state">State</Label>
                <Input
                  id="a-state"
                  value={accountForm.state}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, state: e.target.value })
                  }
                  placeholder="West Bengal"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="a-pincode">Pincode</Label>
                <Input
                  id="a-pincode"
                  value={accountForm.pincode}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, pincode: e.target.value })
                  }
                  placeholder="700001"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="a-gstin">GSTIN (Optional)</Label>
              <Input
                id="a-gstin"
                value={accountForm.gstin}
                onChange={(e) =>
                  setAccountForm({ ...accountForm, gstin: e.target.value })
                }
                placeholder="e.g. 19AAAAA0000A1Z5"
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingContractId ? "Edit contract" : "Add contract"}
            </DialogTitle>
            <DialogDescription>
              Attached to {detail?.name ?? "this account"}. Configure billing
              terms, payment milestones, and due dates.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Title */}
            <div className="grid gap-1.5">
              <Label htmlFor="ct-title">Contract Title</Label>
              <Input
                id="ct-title"
                value={contractForm.title}
                onChange={(e) =>
                  setContractForm({ ...contractForm, title: e.target.value })
                }
                placeholder="e.g. SaaS Portal Development & Annual AMC"
              />
            </div>

            {/* Status & Term */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ct-status">Status</Label>
                <Select
                  value={contractForm.status}
                  onValueChange={(v) =>
                    setContractForm({
                      ...contractForm,
                      status: v as ContractStatus,
                    })
                  }
                >
                  <SelectTrigger id="ct-status">
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

              <div className="grid gap-1.5">
                <Label htmlFor="ct-start">Start Date</Label>
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
                <Label htmlFor="ct-end">End Date / Renewal</Label>
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

            {/* GST 18% Tax Strip (Global across the contract) */}
            <div className="flex items-center justify-between rounded-lg border border-brand/20 bg-brand/5 p-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-md bg-brand/10 text-brand text-xs font-bold font-mono">
                  18%
                </span>
                <div>
                  <p className="text-xs font-semibold">18% GST (Tax-Inclusive Billing)</p>
                  <p className="text-[11px] text-muted-foreground">
                    Automatically calculates 18% GST on project fee and annual maintenance (AMC)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {contractForm.apply_gst ? "18% Applied" : "0% (Exempt)"}
                </span>
                <input
                  type="checkbox"
                  id="apply-gst-toggle"
                  checked={contractForm.apply_gst}
                  onChange={(e) =>
                    setContractForm((prev) => ({
                      ...prev,
                      apply_gst: e.target.checked,
                    }))
                  }
                  className="size-4 accent-brand cursor-pointer"
                />
              </div>
            </div>

            {/* Payment Structure Selector: One-Time vs Installments */}
            <div className="space-y-1.5">
              <Label>Payment Structure</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() =>
                    setContractForm((prev) => ({
                      ...prev,
                      billing_type: "ONE_TIME",
                      payment_plan: "100_UPFRONT",
                    }))
                  }
                  className={cn(
                    "flex flex-col items-start rounded-lg border p-3 text-left transition-all",
                    contractForm.billing_type === "ONE_TIME"
                      ? "border-brand bg-brand/5 ring-1 ring-brand"
                      : "hover:border-border hover:bg-muted/40",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    🪙 One-Time Payment
                  </span>
                  <span className="mt-1 text-[11px] text-muted-foreground">
                    Single lump-sum payment with a scheduled due date
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setContractForm((prev) => {
                      const list =
                        prev.custom_milestones.length > 0
                          ? prev.custom_milestones
                          : generatePresetMilestones(
                              "50_50",
                              totalProjectVal,
                              prev.start_at,
                              prev.end_at,
                            );
                      return {
                        ...prev,
                        billing_type: "RECURRING",
                        payment_plan:
                          prev.payment_plan === "100_UPFRONT"
                            ? "50_50"
                            : prev.payment_plan,
                        custom_milestones: list,
                      };
                    })
                  }
                  className={cn(
                    "flex flex-col items-start rounded-lg border p-3 text-left transition-all",
                    contractForm.billing_type === "RECURRING"
                      ? "border-brand bg-brand/5 ring-1 ring-brand"
                      : "hover:border-border hover:bg-muted/40",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    🔄 Installments / Milestone
                  </span>
                  <span className="mt-1 text-[11px] text-muted-foreground">
                    Divided into advance, delivery, or custom installments
                  </span>
                </button>
              </div>
            </div>

            {/* Section 1: Project Fee / Installment Schedule */}
            {contractForm.billing_type === "ONE_TIME" ? (
              <div className="rounded-lg border bg-card p-3.5 space-y-3 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold text-xs">
                      🪙
                    </span>
                    <div>
                      <h4 className="text-xs font-semibold">
                        One-Time Project Fee
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Total fixed cost for development or service delivery
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor="ct-proj-val"
                      className="text-xs text-muted-foreground shrink-0"
                    >
                      {contractForm.apply_gst ? "Base Amount:" : "Amount:"}
                    </Label>
                    <Input
                      id="ct-proj-val"
                      type="number"
                      min="0"
                      value={contractForm.value}
                      onChange={(e) =>
                        setContractForm({
                          ...contractForm,
                          value: e.target.value,
                        })
                      }
                      placeholder="e.g. 50000"
                      className="h-8 w-36 text-xs font-semibold text-right"
                    />
                  </div>
                </div>

                {contractForm.apply_gst && baseProjectVal > 0 && (
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 text-xs">
                    <span className="text-muted-foreground">
                      Base: <span className="font-mono font-medium text-foreground">{formatINR(baseProjectVal)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      + 18% GST: <span className="font-mono font-medium text-amber-600 dark:text-amber-400">+{formatINR(projectGst)}</span>
                    </span>
                    <span className="font-semibold text-foreground">
                      Total Payable: <span className="font-mono text-brand font-bold">{formatINR(totalProjectVal)}</span>
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      Payment Due Date
                    </Label>
                    <Input
                      type="date"
                      className="h-8 text-xs"
                      value={contractForm.upfront_due_at}
                      onChange={(e) =>
                        setContractForm({
                          ...contractForm,
                          upfront_due_at: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      Payment Status
                    </Label>
                    <Select
                      value={contractForm.upfront_status}
                      onValueChange={(val) =>
                        setContractForm({
                          ...contractForm,
                          upfront_status: val as "PAID" | "PENDING",
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PENDING">⏳ Pending</SelectItem>
                        <SelectItem value="PAID">✓ Paid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border bg-card p-3.5 space-y-3 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold text-xs">
                      🔄
                    </span>
                    <div>
                      <h4 className="text-xs font-semibold">
                        Installment Payments
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Schedule multiple milestone-based installments
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor="ct-proj-val"
                      className="text-xs text-muted-foreground shrink-0"
                    >
                      {contractForm.apply_gst ? "Base Value:" : "Total Value:"}
                    </Label>
                    <Input
                      id="ct-proj-val"
                      type="number"
                      min="0"
                      value={contractForm.value}
                      onChange={(e) => {
                        const valStr = e.target.value;
                        const numBase = Number(valStr) || 0;
                        const numGst = contractForm.apply_gst
                          ? Math.round(numBase * 0.18)
                          : 0;
                        const newTotal = numBase + numGst;
                        setContractForm((prev) => {
                          let updatedMilestones = prev.custom_milestones;
                          if (
                            prev.payment_plan &&
                            prev.payment_plan !== "CUSTOM" &&
                            prev.payment_plan !== "100_UPFRONT"
                          ) {
                            updatedMilestones = generatePresetMilestones(
                              prev.payment_plan as any,
                              newTotal,
                              prev.start_at,
                              prev.end_at,
                            );
                          }
                          return {
                            ...prev,
                            value: valStr,
                            custom_milestones: updatedMilestones,
                          };
                        });
                      }}
                      placeholder="e.g. 50000"
                      className="h-8 w-36 text-xs font-semibold text-right"
                    />
                  </div>
                </div>

                {contractForm.apply_gst && baseProjectVal > 0 && (
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 text-xs">
                    <span className="text-muted-foreground">
                      Base: <span className="font-mono font-medium text-foreground">{formatINR(baseProjectVal)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      + 18% GST: <span className="font-mono font-medium text-purple-600 dark:text-purple-400">+{formatINR(projectGst)}</span>
                    </span>
                    <span className="font-semibold text-foreground">
                      Project Total: <span className="font-mono text-brand font-bold">{formatINR(totalProjectVal)}</span>
                    </span>
                  </div>
                )}

                {/* Preset split buttons */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <span className="text-[11px] text-muted-foreground font-medium shrink-0">
                    Quick Split:
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => selectPreset("50_50")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                        contractForm.payment_plan === "50_50"
                          ? "bg-brand text-brand-foreground shadow-xs font-semibold"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      50 / 50
                    </button>
                    <button
                      type="button"
                      onClick={() => selectPreset("40_30_30")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                        contractForm.payment_plan === "40_30_30"
                          ? "bg-brand text-brand-foreground shadow-xs font-semibold"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      40 / 30 / 30
                    </button>
                    <button
                      type="button"
                      onClick={() => selectPreset("3_EQUAL")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                        contractForm.payment_plan === "3_EQUAL"
                          ? "bg-brand text-brand-foreground shadow-xs font-semibold"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      3 Equal
                    </button>
                    <button
                      type="button"
                      onClick={() => selectPreset("4_EQUAL")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                        contractForm.payment_plan === "4_EQUAL"
                          ? "bg-brand text-brand-foreground shadow-xs font-semibold"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      4 Equal
                    </button>
                    <button
                      type="button"
                      onClick={() => selectPreset("CUSTOM")}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                        contractForm.payment_plan === "CUSTOM"
                          ? "bg-brand text-brand-foreground shadow-xs font-semibold"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      Custom
                    </button>
                  </div>
                </div>

                {/* Live Balance Tracker Bar */}
                <div
                  className={cn(
                    "flex items-center justify-between rounded-md border p-2 text-xs transition-colors",
                    isCustomBalanced
                      ? "border-emerald-500/30 bg-emerald-50/50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
                      : isCustomOverAllocated
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-amber-500/30 bg-amber-50/50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300",
                  )}
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    {isCustomBalanced ? (
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="size-4 shrink-0" />
                    )}
                    <span>
                      {isCustomBalanced ? (
                        <>100% Balanced ({formatINR(totalProjectVal)})</>
                      ) : isCustomOverAllocated ? (
                        <>
                          Exceeds total by{" "}
                          <strong>{formatINR(Math.abs(customRemaining))}</strong>
                        </>
                      ) : (
                        <>
                          Allocated: <strong>{formatINR(customAllocated)}</strong> of{" "}
                          {formatINR(totalProjectVal)}{" "}
                          <span className="opacity-80">
                            ({Math.round((customAllocated / (totalProjectVal || 1)) * 100)}%)
                          </span>
                          {" • "}Remaining:{" "}
                          <strong className="underline">{formatINR(customRemaining)}</strong>
                        </>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!isCustomBalanced && customRemaining > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] px-2 bg-background hover:bg-muted font-medium text-brand"
                        onClick={autoFillRemaining}
                      >
                        ⚡ Auto-Fill Balance
                      </Button>
                    )}
                  </div>
                </div>

                {/* Milestones Header & Actions */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-muted-foreground">
                    Installment milestones ({contractForm.custom_milestones.length}):
                  </span>
                  <div className="flex items-center gap-1.5">
                    {contractForm.custom_milestones.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] px-2"
                        onClick={distributeEqually}
                        title="Divide total evenly among all installments"
                      >
                        ⚖️ Distribute Equally
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2"
                      onClick={addCustomMilestone}
                    >
                      <Plus className="mr-1 size-3" />
                      Add Installment
                    </Button>
                  </div>
                </div>

                {/* Milestones List */}
                {contractForm.custom_milestones.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic py-1">
                    No installments added yet. Click &quot;Add Installment&quot; or select a preset above.
                  </p>
                ) : (
                  <div className="space-y-1.5 pt-1">
                    {contractForm.custom_milestones.map((m, idx) => {
                      const pct =
                        totalProjectVal > 0
                          ? Math.round((m.amount / totalProjectVal) * 100)
                          : 0;
                      return (
                        <div
                          key={m.id}
                          className="grid grid-cols-12 items-center gap-2 rounded-md border bg-card p-2 text-xs"
                        >
                          <div className="col-span-4">
                            <Input
                              className="h-8 text-xs font-medium"
                              value={m.name}
                              onChange={(e) =>
                                updateCustomMilestone(idx, {
                                  name: e.target.value,
                                })
                              }
                              placeholder={`Installment #${idx + 1}`}
                            />
                          </div>
                          <div className="col-span-3 relative">
                            <Input
                              className="h-8 text-xs pr-11 font-mono font-medium"
                              type="number"
                              min="0"
                              value={m.amount || ""}
                              onChange={(e) => {
                                setContractForm((prev) => ({
                                  ...prev,
                                  payment_plan: "CUSTOM",
                                }));
                                updateCustomMilestone(idx, {
                                  amount: Number(e.target.value) || 0,
                                });
                              }}
                              placeholder="Amount"
                            />
                            <span className="absolute right-2 top-2 text-[10px] text-muted-foreground font-mono pointer-events-none">
                              {pct}%
                            </span>
                          </div>
                          <div className="col-span-3">
                            <Input
                              className="h-8 text-xs"
                              type="date"
                              value={m.due_at || ""}
                              onChange={(e) =>
                                updateCustomMilestone(idx, {
                                  due_at: e.target.value || null,
                                })
                              }
                            />
                          </div>
                          <div className="col-span-2 flex items-center justify-end gap-1">
                            <Select
                              value={m.status}
                              onValueChange={(val) =>
                                updateCustomMilestone(idx, {
                                  status: val as "PAID" | "PENDING",
                                })
                              }
                            >
                              <SelectTrigger className="h-8 w-16 text-[11px] px-1.5">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="PENDING">⏳</SelectItem>
                                <SelectItem value="PAID">✓</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-danger"
                              disabled={contractForm.custom_milestones.length <= 1}
                              onClick={() => removeCustomMilestone(idx)}
                              title="Remove installment"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Section 2: Annual Support & Maintenance (AMC) - ALWAYS CHARGED/CONFIGURABLE */}
            <div className="rounded-lg border bg-card p-3.5 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold text-xs">
                    🔄
                  </span>
                  <div>
                    <h4 className="text-xs font-semibold">
                      Annual Maintenance & Support (AMC)
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      Yearly server hosting, updates, and maintenance renewals
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {contractForm.apply_gst ? "AMC Base Amount (INR)" : "AMC Amount (INR)"}
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={contractForm.recurring_value}
                    onChange={(e) =>
                      setContractForm({
                        ...contractForm,
                        recurring_value: e.target.value,
                      })
                    }
                    placeholder="e.g. 5000"
                    className="h-8 text-xs font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Frequency
                  </Label>
                  <Select
                    value={contractForm.recurring_interval}
                    onValueChange={(v) =>
                      setContractForm({
                        ...contractForm,
                        recurring_interval: v as RecurringInterval,
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANNUAL">
                        Annual (Every Year)
                      </SelectItem>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Renewal / Due Date
                  </Label>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    value={contractForm.amc_due_at}
                    onChange={(e) =>
                      setContractForm({
                        ...contractForm,
                        amc_due_at: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              {contractForm.apply_gst && baseAmcVal > 0 && (
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 text-xs">
                  <span className="text-muted-foreground">
                    AMC Base: <span className="font-mono font-medium text-foreground">{formatINR(baseAmcVal)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    + 18% GST: <span className="font-mono font-medium text-blue-600 dark:text-blue-400">+{formatINR(amcGst)}</span>
                  </span>
                  <span className="font-semibold text-foreground">
                    Total AMC: <span className="font-mono text-brand font-bold">{formatINR(totalAmcVal)} / {contractForm.recurring_interval === "MONTHLY" ? "mo" : "yr"}</span>
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md bg-muted/30 p-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    Current Renewal Status:
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[11px] px-2 py-0.5",
                      contractForm.amc_status === "PAID"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
                    )}
                  >
                    {contractForm.amc_status === "PAID"
                      ? "✓ Paid / Active"
                      : "⏳ Pending Renewal"}
                  </Badge>
                </div>

                <Select
                  value={contractForm.amc_status}
                  onValueChange={(val) =>
                    setContractForm({
                      ...contractForm,
                      amc_status: val as "PAID" | "PENDING",
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">⏳ Pending</SelectItem>
                    <SelectItem value="PAID">✓ Mark Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-blue-500 shrink-0"></span>
                When 1 year has passed or the renewal date arrives, the status automatically switches to <strong>Pending</strong> with an alert badge on the Account card.
              </p>
            </div>

            {/* Summary & Tax Breakdown Footer Card */}
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Subtotal (Base Value):</span>
                <span className="font-mono font-medium text-foreground">
                  {formatINR(baseProjectVal + baseAmcVal)}
                </span>
              </div>
              {contractForm.apply_gst && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    18% GST (CGST 9% + SGST 9%):
                  </span>
                  <span className="font-mono font-medium text-brand">
                    +{formatINR(totalContractGst)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs font-semibold border-t pt-1.5 text-foreground">
                <span>Total Contract Payable:</span>
                <span className="font-mono text-sm font-bold text-brand">
                  {formatINR(grandContractTotal)}
                </span>
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
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit account</DialogTitle>
            <DialogDescription>
              Update {detail?.name ?? "this account"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-1">
            <div className="grid gap-1.5">
              <Label htmlFor="e-name">Name</Label>
              <Input
                id="e-name"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
                placeholder="Acme Industries"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="e-project-name">Project Name</Label>
              <Input
                id="e-project-name"
                value={editForm.project_name}
                onChange={(e) =>
                  setEditForm({ ...editForm, project_name: e.target.value })
                }
                placeholder="e.g. NGO Website Dynamic – Impact Inclusive"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="e-phone">Phone</Label>
                <Input
                  id="e-phone"
                  value={editForm.phone}
                  onChange={(e) =>
                    setEditForm({ ...editForm, phone: e.target.value })
                  }
                  placeholder="+91 98765 43210"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="e-email">Email</Label>
                <Input
                  id="e-email"
                  type="email"
                  value={editForm.email}
                  onChange={(e) =>
                    setEditForm({ ...editForm, email: e.target.value })
                  }
                  placeholder="accounts@client.com"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="e-address">Billing Address</Label>
              <Input
                id="e-address"
                value={editForm.address}
                onChange={(e) =>
                  setEditForm({ ...editForm, address: e.target.value })
                }
                placeholder="Street address, building, area"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="e-city">City</Label>
                <Input
                  id="e-city"
                  value={editForm.city}
                  onChange={(e) =>
                    setEditForm({ ...editForm, city: e.target.value })
                  }
                  placeholder="Kolkata"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="e-state">State</Label>
                <Input
                  id="e-state"
                  value={editForm.state}
                  onChange={(e) =>
                    setEditForm({ ...editForm, state: e.target.value })
                  }
                  placeholder="West Bengal"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="e-pincode">Pincode</Label>
                <Input
                  id="e-pincode"
                  value={editForm.pincode}
                  onChange={(e) =>
                    setEditForm({ ...editForm, pincode: e.target.value })
                  }
                  placeholder="700001"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="e-gstin">GSTIN (Optional)</Label>
              <Input
                id="e-gstin"
                value={editForm.gstin}
                onChange={(e) =>
                  setEditForm({ ...editForm, gstin: e.target.value })
                }
                placeholder="e.g. 19AAAAA0000A1Z5"
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

      {/* New GST Tax Invoice dialog */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-brand/10 text-brand text-sm">
                🧾
              </span>
              <span>
                {invoiceForm.isPaid
                  ? "Generate Paid Receipt / Tax Invoice"
                  : "Generate GST Tax Invoice"}
              </span>
              {invoiceForm.isPaid ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[11px] px-2 py-0.5 ml-auto">
                  ✓ Status: PAID
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-300 text-[11px] px-2 py-0.5 ml-auto">
                  ⏳ Status: PENDING
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {invoiceForm.isPaid
                ? "Generate official BN INTELHUB paid receipt with status Marked as PAID, UPI QR, and 18% GST breakdown."
                : "Generate an official BN INTELHUB tax invoice with UPI QR, HSN/SAC code, and 18% GST breakdown."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3.5 max-h-[72vh] overflow-y-auto px-1">
            {/* Payment Status Switch / Notice */}
            <div className="flex items-center justify-between p-2.5 rounded-lg border bg-slate-50 dark:bg-slate-900">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Receipt Status
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {invoiceForm.isPaid
                    ? "Receipt will be marked as PAID with Payment Received status."
                    : "Invoice will be issued with PENDING status."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "h-7 text-xs font-medium",
                  invoiceForm.isPaid
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300",
                )}
                onClick={() =>
                  setInvoiceForm((prev) => ({ ...prev, isPaid: !prev.isPaid }))
                }
              >
                {invoiceForm.isPaid ? "✓ PAID (Click to change)" : "⏳ PENDING (Click to mark Paid)"}
              </Button>
            </div>
            {/* Auto-fill from Contract Milestone if available */}
            {availableMilestones.length > 0 && (
              <div className="rounded-lg border border-brand/20 bg-brand/5 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-brand flex items-center gap-1.5">
                    ⚡ Auto-fill from Contract Milestone
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    Auto-maps service name & amount
                  </span>
                </div>
                <Select
                  value={
                    invoiceForm.contractId && invoiceForm.milestoneId
                      ? `${invoiceForm.contractId}:${invoiceForm.milestoneId}`
                      : ""
                  }
                  onValueChange={(val) => {
                    const found = availableMilestones.find((am) => am.id === val);
                    if (found) {
                      openInvoiceForMilestone(found.contract, found.milestone);
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue placeholder="Choose a milestone to auto-fill..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMilestones.map((am) => (
                      <SelectItem key={am.id} value={am.id} className="text-xs">
                        {am.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Service & Item Details */}
            <div className="rounded-lg border bg-card p-3 space-y-2.5">
              <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                💼 Service & Line Item
              </h4>
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="inv-desc" className="text-xs text-muted-foreground">
                    Service Description
                  </Label>
                  <Input
                    id="inv-desc"
                    value={invoiceForm.serviceDescription}
                    onChange={(e) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        serviceDescription: e.target.value,
                      })
                    }
                    placeholder="e.g. SaaS Charge & Advance Payment (50%)"
                    className="h-8 text-xs font-medium"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="inv-sub" className="text-xs text-muted-foreground">
                      Tech / Subtitle Spec
                    </Label>
                    <Input
                      id="inv-sub"
                      value={invoiceForm.subtitle}
                      onChange={(e) =>
                        setInvoiceForm((prev) => ({
                          ...prev,
                          subtitle: e.target.value,
                        }))
                      }
                      placeholder="e.g. React Development / Web Portal"
                      className="h-8 text-xs font-medium"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="inv-hsn" className="text-xs text-muted-foreground">
                      HSN / SAC Code
                    </Label>
                    <Input
                      id="inv-hsn"
                      value={invoiceForm.hsnSac}
                      onChange={(e) =>
                        setInvoiceForm({
                          ...invoiceForm,
                          hsnSac: e.target.value,
                        })
                      }
                      placeholder="998314"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Financials & 18% GST */}
            <div className="rounded-lg border bg-card p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  💰 Amount & Taxation
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    18% GST:
                  </span>
                  <input
                    type="checkbox"
                    id="inv-apply-gst"
                    checked={invoiceForm.applyGst}
                    onChange={(e) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        applyGst: e.target.checked,
                      })
                    }
                    className="size-4 accent-brand cursor-pointer"
                  />
                  <Label
                    htmlFor="inv-apply-gst"
                    className="text-xs cursor-pointer select-none font-medium"
                  >
                    {invoiceForm.applyGst ? "Enabled (18%)" : "Exempt (0%)"}
                  </Label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="inv-amount" className="text-xs text-muted-foreground">
                    {invoiceForm.applyGst ? "Base Amount (INR)" : "Amount (INR)"}
                  </Label>
                  <Input
                    id="inv-amount"
                    type="number"
                    min="1"
                    value={invoiceForm.amount}
                    onChange={(e) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        amount: e.target.value,
                      })
                    }
                    placeholder="e.g. 5000"
                    className="h-8 text-xs font-mono font-semibold"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="inv-tax" className="text-xs text-muted-foreground">
                    Tax Amount (INR)
                  </Label>
                  <Input
                    id="inv-tax"
                    type="number"
                    min="0"
                    value={
                      invoiceForm.applyGst
                        ? invoiceForm.tax || (invBaseAmt ? String(Math.round(invBaseAmt * 0.18)) : "")
                        : "0"
                    }
                    disabled={!invoiceForm.applyGst}
                    onChange={(e) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        tax: e.target.value,
                      })
                    }
                    placeholder="Auto 18%"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="inv-due" className="text-xs text-muted-foreground">
                    Payment Due Date
                  </Label>
                  <Input
                    id="inv-due"
                    type="date"
                    value={invoiceForm.dueAt}
                    onChange={(e) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        dueAt: e.target.value,
                      })
                    }
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Dynamic Live Tax Breakdown */}
              <div className="rounded-md border bg-muted/40 p-2.5 space-y-1 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="truncate max-w-[280px]">
                    Base Taxable (
                    <span className="text-brand font-medium">
                      {invoiceForm.subtitle?.trim() || "React Development"}
                    </span>
                    ):
                  </span>
                  <span className="font-mono font-medium text-foreground">
                    {formatINR(invBaseAmt)}
                  </span>
                </div>
                {invoiceForm.applyGst && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>
                      18% GST (
                      {invoiceForm.placeOfSupply &&
                      !invoiceForm.placeOfSupply.includes("(20)") &&
                      !invoiceForm.placeOfSupply.toLowerCase().includes("jharkhand")
                        ? "IGST 18%"
                        : "CGST 9% + SGST 9%"}
                      ):
                    </span>
                    <span className="font-mono font-medium text-brand">
                      +{formatINR(invTaxAmt)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between font-semibold border-t pt-1 text-foreground">
                  <span>Total Payable:</span>
                  <span className="font-mono text-sm font-bold text-brand">
                    {formatINR(invTotal)}
                  </span>
                </div>
                {invTotal > 0 && (
                  <p className="text-[11px] text-muted-foreground italic border-t pt-1">
                    In words: {amountToINRWords(invTotal)}
                  </p>
                )}
              </div>
            </div>

            {/* Client & Billing Details */}
            <div className="rounded-lg border bg-card p-3 space-y-2.5">
              <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                🏢 Client & Place of Supply
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="inv-pos" className="text-xs text-muted-foreground">
                    Place of Supply (State & Code)
                  </Label>
                  <Input
                    id="inv-pos"
                    value={invoiceForm.placeOfSupply}
                    onChange={(e) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        placeOfSupply: e.target.value,
                      })
                    }
                    placeholder="e.g. West Bengal (19) or Jharkhand (20)"
                    className="h-8 text-xs font-medium"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="inv-cgstin" className="text-xs text-muted-foreground">
                    Client GSTIN (Optional)
                  </Label>
                  <Input
                    id="inv-cgstin"
                    value={invoiceForm.clientGstin}
                    onChange={(e) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        clientGstin: e.target.value.toUpperCase(),
                      })
                    }
                    placeholder="e.g. 19ABCDE1234F1Z5"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="inv-caddr" className="text-xs text-muted-foreground">
                  Client Billing Address
                </Label>
                <Input
                  id="inv-caddr"
                  value={invoiceForm.clientAddress}
                  onChange={(e) =>
                    setInvoiceForm({
                      ...invoiceForm,
                      clientAddress: e.target.value,
                    })
                  }
                  placeholder="Client office address, City, Pincode"
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="inv-cphone" className="text-xs text-muted-foreground">
                    Client Phone
                  </Label>
                  <Input
                    id="inv-cphone"
                    value={invoiceForm.clientPhone}
                    onChange={(e) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        clientPhone: e.target.value,
                      })
                    }
                    placeholder="+91 98765 43210"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="inv-cemail" className="text-xs text-muted-foreground">
                    Client Email
                  </Label>
                  <Input
                    id="inv-cemail"
                    type="email"
                    value={invoiceForm.clientEmail}
                    onChange={(e) =>
                      setInvoiceForm({
                        ...invoiceForm,
                        clientEmail: e.target.value,
                      })
                    }
                    placeholder="billing@client.com"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
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
              {invoiceMutation.isPending
                ? "Generating..."
                : invoiceForm.isPaid
                  ? "🧾 Generate & View Paid Receipt"
                  : "🧾 Generate & View Tax Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tax Invoice Pixel-Perfect Printable Modal */}
      <TaxInvoiceModal
        invoice={selectedInvoice}
        open={taxInvoiceOpen}
        onOpenChange={setTaxInvoiceOpen}
      />
    </div>
  );
}
