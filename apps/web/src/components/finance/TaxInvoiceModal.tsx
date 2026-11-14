import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Printer } from "lucide-react";
import { getMyBillingProfile, type InvoiceDetails, type InvoiceLineItem } from "@/lib/api/finance";
import { amountToINRWords } from "@/lib/inr-words";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SIGNATURE_DATA_URL } from "./signature_base64";

export type { InvoiceLineItem };

export interface InvoiceLike {
  id: string;
  number: string;
  amount: number;
  tax?: number;
  status: string;
  issued_at?: string | null;
  due_at?: string | null;
  paid_at?: string | null;
  account?: any;
  contact?: any;
  details?: InvoiceDetails | null | any;
}

interface TaxInvoiceModalProps {
  invoice: InvoiceLike | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaxInvoiceModal({ invoice, open, onOpenChange }: TaxInvoiceModalProps) {
  if (!invoice) return null;

  // Active tenant's verified billing profile from Super Admin
  const profileQuery = useQuery({
    queryKey: ["my-billing-profile"],
    queryFn: getMyBillingProfile,
    staleTime: 60_000,
  });
  const profile = profileQuery.data;

  const rawDetails = invoice.details;
  const details: Record<string, any> = React.useMemo(() => {
    if (!rawDetails) return {};
    if (typeof rawDetails === "string") {
      try {
        return JSON.parse(rawDetails);
      } catch {
        return {};
      }
    }
    return rawDetails;
  }, [rawDetails]);

  const isPaid = invoice.status === "PAID";

  // Financial values
  const baseAmount = Number(invoice.amount) || 0;
  const taxAmount = Number(invoice.tax) || 0;
  const grandTotal = baseAmount + taxAmount;

  // Organization / Tenant billing details (Dynamic with BN Intelhub fallback)
  const companyLegalName = profile?.legal_name || "BN INTELHUB PVT. LTD.";
  const companyBrandName = profile?.brand_name || profile?.legal_name || "BN Intelhub";
  const companyLogo = profile?.logo_url || "/invoice-assets/bn_logo.png";
  const companyAddress = profile
    ? `${profile.address}, ${profile.city} - ${profile.pincode}`
    : "STR - Plot - 9 Part, Industrial Area, Namkum Ranchi - 834010";
  const companyPhone = profile?.phone || "+91 8936078905";
  const companyEmail = profile?.email || "bnintelhub@gmail.com";
  const companyWebsite = profile?.website || "https://bnintelhub.com";
  const companyGstin = profile?.gstin || "20AAXCB9795E1ZR";
  const companyCin = profile?.cin || "U62013JH2024PTC022651";

  // Bank & UPI Settlement
  const bankName = profile?.bank_name || "STATE BANK OF INDIA";
  const bankAcctName = profile?.account_name || "BN Intelhub private limited";
  const bankAcctNo = profile?.account_number || "44656194231";
  const bankIfsc = profile?.ifsc || "SBIN0000167";
  const upiId = profile?.upi_id || "";

  // Dynamic Scan-to-Pay QR: If UPI ID is configured, generate dynamic UPI payment QR with exact amount!
  const qrCodeUrl = upiId
    ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
        `upi://pay?pa=${upiId}&pn=${encodeURIComponent(bankAcctName)}&am=${grandTotal}&cu=INR`
      )}`
    : "/invoice-assets/bn_upi_qr.png";

  // Signatory & Legal
  const signatoryName = profile?.signatory_name || "Adarsh Singh";
  const signatoryDesignation = profile?.signatory_designation || "Director";
  const signatureImg = profile?.signature_url || SIGNATURE_DATA_URL;
  const jurisdictionCity = profile?.jurisdiction_city || profile?.city || "Ranchi";

  // Client info fallback
  const clientName =
    details.client_name ||
    (typeof invoice.account === "object" ? invoice.account?.name : invoice.account) ||
    "a2z indian pvt ltd";
  const clientAddress = details.client_address || "Pathalkudwa church lane";
  const clientPhone = details.client_phone || "+919812345678";
  const clientEmail = details.client_email || "rahul@example.org";
  const clientGstin = details.client_gstin || "2323454525677";

  // Project details fallback
  const projectType = details.project_type || "IT Services, Software Dev.";
  const projectName = details.project_name || "landing page with crud operation";
  const billingPeriod = details.billing_period || (invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "12 Nov 2026");
  const paymentTerms = details.payment_terms || "Payment due within 15 days of invoice date.";
  const reverseCharge = details.reverse_charge || "No";

  // State detection & Place of Supply
  const defaultSupply = profile ? `${profile.state} (${profile.state_code})` : "Jharkhand (20)";
  const placeOfSupply = details.place_of_supply || (clientAddress.toLowerCase().includes("bengal") ? "West Bengal (19)" : defaultSupply);
  const homeStateCode = profile?.state_code || "20";
  const isInterState = details.tax_type === "IGST" || (!clientAddress.toLowerCase().includes(homeStateCode) && !placeOfSupply.includes(`(${homeStateCode})`));

  const cgst = isInterState ? 0 : Math.round(taxAmount / 2);
  const sgst = isInterState ? 0 : taxAmount - cgst;
  const igst = isInterState ? taxAmount : 0;

  // Live editable items state
  const [items, setItems] = React.useState<InvoiceLineItem[]>([]);

  React.useEffect(() => {
    const raw = invoice?.details;
    const parsed: Record<string, any> =
      typeof raw === "string"
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return {};
            }
          })()
        : raw || {};

    const baseAmt = Number(invoice?.amount) || 0;
    const rawItems = parsed.items && parsed.items.length > 0 ? parsed.items : null;
    if (rawItems) {
      setItems(
        rawItems.map((it: any) => ({
          ...it,
          subtitle:
            it.subtitle === "PHP Development"
              ? "React Development"
              : it.subtitle || "React Development",
        }))
      );
    } else {
      setItems([
        {
          description: parsed.project_name || "Advance Payment (50%)",
          subtitle: "React Development",
          hsn_sac: "998314",
          qty: 1,
          unit: "NOS",
          rate: baseAmt,
          amount: baseAmt,
        },
      ]);
    }
  }, [invoice]);

  const words = details.amount_in_words || amountToINRWords(grandTotal);

  const handlePrint = () => {
    window.print();
  };

  const formatDateDisplay = (dateStr?: string | null) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const formatCurr = (num: number) =>
    num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[860px] w-[96vw] p-0 overflow-hidden bg-white max-h-[96vh] sm:max-h-[96vh] flex flex-col border border-slate-300 shadow-2xl rounded-lg gap-0">
        {/* Print Stylesheet */}
        <style>{`
          @media print {
            body {
              background: #fff !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            body * {
              visibility: hidden;
            }
            #printable-tax-invoice, #printable-tax-invoice * {
              visibility: visible;
            }
            #printable-tax-invoice {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              max-width: 100% !important;
              margin: 0 !important;
              padding: 12mm 15mm !important;
              border: none !important;
              box-shadow: none !important;
            }
            @page {
              size: A4 portrait;
              margin: 0;
            }
          }
        `}</style>

        {/* Modal Controls (Hidden in Print) */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-slate-50 border-b border-slate-200 shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[#1f2a5a]">Tax Invoice Preview</span>
            <span className="text-xs text-muted-foreground font-mono">({invoice.number})</span>
            {isPaid ? (
              <span className="rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5">
                ✓ PAID
              </span>
            ) : (
              <span className="rounded bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5">
                ⏳ PENDING
              </span>
            )}
            {profile && !profile.is_verified ? (
              <span className="flex items-center gap-1 rounded bg-amber-50 text-amber-800 border border-amber-300 text-[10px] font-medium px-2 py-0.5">
                <AlertCircle className="size-3 text-amber-600" />
                Unverified Organization Profile
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2.5 pr-8">
            {/* Quick Edit Tech Spec / Subtitle */}
            <div className="flex items-center gap-1.5 bg-white rounded px-2.5 py-1 border border-slate-300 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-700">Tech Spec:</span>
              <input
                type="text"
                value={items[0]?.subtitle ?? "React Development"}
                onChange={(e) => {
                  const val = e.target.value;
                  setItems((prev) =>
                    prev.map((it, i) => (i === 0 ? { ...it, subtitle: val } : it))
                  );
                }}
                placeholder="React Development"
                className="h-6 px-2 text-xs font-semibold text-[#1f2a5a] bg-slate-50 border border-slate-300 rounded shadow-xs w-36 focus:outline-brand"
              />
            </div>

            <Button size="sm" onClick={handlePrint} className="bg-[#1f2a5a] hover:bg-[#162044] text-white gap-1.5 text-xs font-medium h-7 px-3">
              <Printer className="size-3.5" />
              Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Scrollable Document Area - 100% Solid Pure White Background */}
        <div className="overflow-y-auto flex-1 p-6 sm:p-8 bg-white print:p-0 print:overflow-visible">
          {/* A4 Sheet Container */}
          <div
            id="printable-tax-invoice"
            className="w-full max-w-[780px] mx-auto bg-white text-slate-800 text-xs font-sans"
            style={{ boxSizing: "border-box" }}
          >
            {/* Top Company & TAX INVOICE Header */}
            <div className="flex justify-between items-start gap-4 pb-3.5 border-b border-slate-300">
              {/* Left: Company Logo & Details */}
              <div className="space-y-0.5 max-w-[62%]">
                <img
                  src={companyLogo}
                  alt={companyBrandName}
                  className="h-10 object-contain mb-1"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
                <p className="text-[10px] font-normal text-slate-600 leading-tight">
                  {companyAddress}
                </p>
                <p className="text-[10px] text-slate-600 leading-tight">
                  Ph: {companyPhone} | {companyEmail} | {companyWebsite}
                </p>
                <div className="border-t border-dashed border-slate-200 pt-0.5 mt-1">
                  <p className="text-[10px] font-bold text-slate-900 leading-tight">
                    GSTIN: <span className="font-mono font-bold">{companyGstin}</span>
                    {companyCin ? (
                      <> | CIN: <span className="font-mono font-bold">{companyCin}</span></>
                    ) : null}
                  </p>
                </div>
              </div>

              {/* Right: TAX INVOICE Title & Meta */}
              <div className="text-right flex flex-col items-end">
                <h1 className="text-2xl font-black tracking-tight text-[#1f2a5a] uppercase leading-none">
                  TAX INVOICE
                </h1>
                <p className="text-[11px] font-bold text-slate-800 font-mono tracking-wider mt-1 mb-1">
                  {invoice.number}
                </p>
                
                {/* Colon-aligned Meta Grid */}
                <div className="grid grid-cols-[auto_10px_auto] items-baseline text-[10.5px] gap-y-0.5 text-right">
                  <span className="text-slate-500 font-normal">Invoice Date</span>
                  <span className="text-slate-400 text-center">:</span>
                  <span className="font-bold text-slate-900 text-left pl-1">{formatDateDisplay(invoice.issued_at)}</span>

                  <span className="text-slate-500 font-normal">Due Date</span>
                  <span className="text-slate-400 text-center">:</span>
                  <span className="font-bold text-slate-900 text-left pl-1">{formatDateDisplay(invoice.due_at || invoice.issued_at)}</span>

                  <span className="text-slate-500 font-normal">Place of Supply</span>
                  <span className="text-slate-400 text-center">:</span>
                  <span className="font-bold text-slate-900 text-left pl-1">{placeOfSupply}</span>

                  <span className="text-slate-500 font-normal">Status</span>
                  <span className="text-slate-400 text-center">:</span>
                  <span className={`font-bold text-left pl-1 ${isPaid ? "text-[#16a34a]" : "text-[#d97706]"}`}>
                    {isPaid ? "Paid" : "Pending"}
                  </span>
                </div>
              </div>
            </div>

            {/* Bill To & Project Details Cards (Side by Side) */}
            <div className="grid grid-cols-2 gap-3.5 mt-3.5">
              {/* BILL TO */}
              <div className="border border-slate-300 rounded-sm overflow-hidden flex flex-col bg-white">
                <div className="bg-[#1f2a5a] text-white px-3 py-1 font-bold text-[10.5px] tracking-wider uppercase">
                  BILL TO
                </div>
                <div className="p-2.5 text-[10.5px] flex-1 flex flex-col justify-between">
                  <div>
                    <p className="font-bold text-slate-900 text-[11.5px]">{clientName}</p>
                    <p className="text-slate-600 text-[10px] leading-tight mt-0.5 mb-2">{clientAddress}</p>
                  </div>
                  
                  {/* Colon-aligned contact/tax details */}
                  <div className="grid grid-cols-[60px_8px_1fr] items-baseline text-[10.5px] gap-y-0.5">
                    <span className="text-slate-500">Phone</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-900 font-medium">{clientPhone || "-"}</span>

                    <span className="text-slate-500">Email</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-900 font-medium break-all">{clientEmail || "-"}</span>

                    <span className="text-slate-500">GST / CIN</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-[#1d4ed8] font-mono font-semibold">{clientGstin || "N/A"}</span>
                  </div>
                </div>
              </div>

              {/* PROJECT & BILLING DETAILS */}
              <div className="border border-slate-300 rounded-sm overflow-hidden flex flex-col bg-white">
                <div className="bg-[#1f2a5a] text-white px-3 py-1 font-bold text-[10.5px] tracking-wider uppercase">
                  PROJECT & BILLING DETAILS
                </div>
                <div className="p-2.5 text-[10.5px] flex-1">
                  <div className="grid grid-cols-[85px_8px_1fr] items-baseline text-[10.5px] gap-y-0.5">
                    <span className="text-slate-500">Project Type</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-900 font-normal">{projectType}</span>

                    <span className="text-slate-500">Project Name</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-900 font-bold leading-tight">{projectName}</span>

                    <span className="text-slate-500">Project Value</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-900 font-bold">
                      ₹ {formatCurr(Number(details.project_value || grandTotal))}
                    </span>

                    <span className="text-slate-500">Billing Period</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-900 font-normal">{billingPeriod}</span>

                    <span className="text-slate-500">Payment Terms</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-900 font-normal leading-tight">{paymentTerms}</span>

                    <span className="text-slate-500">Reverse Charge</span>
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-900 font-normal">{reverseCharge}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="mt-3.5 border border-slate-300 rounded-sm overflow-hidden bg-white">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#1f2a5a] text-white text-[10px] font-bold uppercase tracking-wider">
                    <th className="py-1.5 px-2.5 w-8 text-center">#</th>
                    <th className="py-1.5 px-3">SERVICE DESCRIPTION</th>
                    <th className="py-1.5 px-2 text-center w-20">SAC/HSN</th>
                    <th className="py-1.5 px-2 text-center w-12">QTY</th>
                    <th className="py-1.5 px-2 text-center w-14">UNIT</th>
                    <th className="py-1.5 px-3 text-right w-24">RATE (₹)</th>
                    <th className="py-1.5 px-3 text-right w-24">AMOUNT (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-[10.5px]">
                  {items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="py-2 px-2.5 text-center text-slate-500 font-medium">{idx + 1}</td>
                      <td className="py-2 px-3">
                        <p className="font-bold text-slate-900 text-[10.5px] leading-tight">{item.description}</p>
                        <p
                          contentEditable
                          suppressContentEditableWarning
                          onInput={(e) => {
                            const newText = e.currentTarget.textContent || "";
                            setItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, subtitle: newText } : it))
                            );
                          }}
                          className="text-[9.5px] text-slate-500 font-normal mt-0.5 cursor-text hover:bg-amber-100/60 focus:bg-amber-100/80 focus:outline-none rounded px-1 -mx-1 transition-colors print:hover:bg-transparent print:p-0 print:m-0"
                          title="Click to edit subtitle / tech spec"
                        >
                          {item.subtitle || "React Development"}
                        </p>
                      </td>
                      <td className="py-2 px-2 text-center font-mono text-slate-600 text-[10.5px]">{item.hsn_sac || "998314"}</td>
                      <td className="py-2 px-2 text-center font-medium text-[10.5px]">{item.qty || 1}</td>
                      <td className="py-2 px-2 text-center text-slate-600 text-[10.5px]">{item.unit || "NOS"}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-[10.5px]">{formatCurr(Number(item.rate || item.amount))}</td>
                      <td className="py-2 px-3 text-right font-bold font-mono tabular-nums text-[10.5px] text-slate-900">{formatCurr(Number(item.amount))}</td>
                    </tr>
                  ))}
                  <tr className="bg-white font-bold border-t border-slate-300">
                    <td colSpan={6} className="py-1.5 px-3 text-right uppercase tracking-wider text-[10.5px] text-slate-800">
                      SUB TOTAL
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold tabular-nums text-[10.5px] text-slate-900">
                      {formatCurr(baseAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Split Lower Details: Clean 2-Column Layout (Words & Bank vs Tax Summary & Grand Total) */}
            <div className="grid grid-cols-[1.35fr_1fr] gap-3.5 mt-3.5 items-start">
              {/* Left Column: Words & Bank Details */}
              <div className="space-y-2.5">
                {/* Total in Words */}
                <div className="border border-slate-300 rounded-sm overflow-hidden bg-white">
                  <div className="bg-slate-100 text-slate-700 px-3 py-1 font-bold text-[9.5px] uppercase tracking-wider border-b border-slate-300">
                    TOTAL AMOUNT IN WORDS (INR)
                  </div>
                  <div className="p-2.5 text-[10.5px] font-bold italic text-slate-900 leading-snug flex items-center min-h-[38px]">
                    {words}
                  </div>
                </div>

                {/* Bank & Payment Details */}
                <div className="border border-slate-300 rounded-sm overflow-hidden bg-white">
                  <div className="bg-[#1f2a5a] text-white px-3 py-1 font-bold text-[9.5px] uppercase tracking-wider">
                    BANK & PAYMENT DETAILS
                  </div>
                  <div className="p-2.5 flex items-center justify-between gap-2">
                    {/* Bank Info with aligned colons */}
                    <div className="grid grid-cols-[68px_8px_1fr] items-baseline text-[10.5px] gap-y-0.5">
                      <span className="text-slate-500">Bank Name</span>
                      <span className="text-slate-400">:</span>
                      <span className="font-bold text-slate-900">{bankName}</span>

                      <span className="text-slate-500">Acct. Name</span>
                      <span className="text-slate-400">:</span>
                      <span className="font-medium text-slate-900">{bankAcctName}</span>

                      <span className="text-slate-500">Acct. No.</span>
                      <span className="text-slate-400">:</span>
                      <span className="font-mono font-bold text-slate-900">{bankAcctNo}</span>

                      <span className="text-slate-500">IFSC</span>
                      <span className="text-slate-400">:</span>
                      <span className="font-mono font-bold text-[#1d4ed8]">{bankIfsc}</span>

                      <span className="text-slate-500">UPI ID</span>
                      <span className="text-slate-400">:</span>
                      <span className="text-slate-900 font-mono">{upiId || "-"}</span>
                    </div>

                    {/* QR Code Container */}
                    <div className="flex flex-col items-center shrink-0 pr-0.5">
                      <div className="size-[72px] border border-slate-200 rounded p-1 bg-white flex items-center justify-center shadow-xs">
                        <img
                          src={qrCodeUrl}
                          alt="Scan to Pay"
                          className="size-full object-contain"
                        />
                      </div>
                      <span className="text-[9px] text-slate-500 mt-0.5 font-medium">Scan to Pay</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Tax Summary & Grand Total */}
              <div className="space-y-2">
                {/* Tax Summary Box */}
                <div className="border border-slate-300 rounded-sm overflow-hidden bg-white">
                  <div className="bg-slate-100 text-slate-700 px-3 py-1 font-bold text-[9.5px] uppercase tracking-wider border-b border-slate-300">
                    TAX SUMMARY
                  </div>
                  <div className="p-2 space-y-1 text-[10.5px]">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600">Sub Total</span>
                      <span className="font-mono font-medium text-slate-900">₹ {formatCurr(baseAmount)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600">Taxable Amount</span>
                      <span className="font-mono font-medium text-slate-900">₹ {formatCurr(baseAmount)}</span>
                    </div>

                    {isInterState ? (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600">IGST (18%)</span>
                        <span className="font-mono font-medium text-slate-900">₹ {formatCurr(igst)}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-600">CGST (9%)</span>
                          <span className="font-mono font-medium text-slate-900">₹ {formatCurr(cgst)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-600">SGST (9%)</span>
                          <span className="font-mono font-medium text-slate-900">₹ {formatCurr(sgst)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Grand Total Strip (Vibrant Royal Blue) */}
                <div className="bg-[#2448b5] text-white px-3.5 py-2 rounded-sm flex items-center justify-between shadow-xs">
                  <span className="font-bold text-[11px] uppercase tracking-wider">GRAND TOTAL (INR)</span>
                  <span className="font-mono font-black text-sm tabular-nums">₹ {formatCurr(grandTotal)}</span>
                </div>

                {/* Payment Status Pill */}
                {isPaid ? (
                  <div className="bg-[#eefbf3] border border-[#a3e6b9] text-[#166534] rounded-sm px-3 py-1 flex items-center justify-between text-[11px] font-bold">
                    <span className="flex items-center gap-1">✓ FULLY PAID</span>
                    <span className="font-mono font-semibold">Balance: ₹ 0.00</span>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-sm px-3 py-1 flex items-center justify-between text-[11px] font-bold">
                    <span className="flex items-center gap-1">⏳ PENDING</span>
                    <span className="font-mono font-semibold">Balance: ₹ {formatCurr(grandTotal)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Declaration & Signature Box */}
            <div className="grid grid-cols-[1.35fr_1fr] gap-3.5 mt-4 pt-3 border-t border-slate-200 items-end">
              {/* Terms & Declaration */}
              <div className="space-y-2 text-[9.5px] text-slate-600 leading-tight">
                <div>
                  <p className="font-bold text-slate-800 uppercase text-[9.5px]">DECLARATION</p>
                  <p className="mt-0.5">
                    We declare that this invoice shows the actual price of the goods/services described and that all
                    particulars are true and correct.
                  </p>
                </div>
                <div>
                  <p className="font-bold text-slate-800 uppercase text-[9.5px]">TERMS & CONDITIONS</p>
                  <ol className="list-decimal pl-3 space-y-0.5 mt-0.5">
                    <li>Payment Terms: {paymentTerms}</li>
                    <li>All disputes are subject to {jurisdictionCity} Jurisdiction only.</li>
                    <li>This is a computer generated invoice & does not require a physical signature.</li>
                  </ol>
                </div>
              </div>

              {/* Signature Box */}
              <div className="text-right space-y-0.5">
                <p className="font-bold text-[10.5px] text-slate-900">For {companyBrandName}</p>
                <div className="h-16 flex justify-end items-center my-0.5">
                  <img
                    src={signatureImg}
                    alt="Authorized Signatory"
                    className="h-16 object-contain"
                  />
                </div>
                <p className="text-[10px] font-semibold text-slate-700 block pr-2">{signatoryDesignation}</p>
                <div className="border-t border-slate-400 w-44 ml-auto pt-0.5">
                  <p className="font-bold text-[10px] text-slate-900">
                    {signatoryName}
                  </p>
                  <p className="text-[9px] text-slate-500 uppercase tracking-wider block">
                    {companyLegalName}
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom Footer */}
            <div className="mt-4 pt-2.5 border-t border-slate-200 text-center">
              <p className="font-bold text-[#2448b5] italic text-[11px]">Thank You For Your Business!</p>
              <p className="text-[9px] text-slate-500 mt-0.5">This is a Computer Generated GST Tax Invoice. | {companyWebsite}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
