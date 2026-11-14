import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Landmark,
  QrCode,
  Save,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getTenantBillingProfile, saveTenantBillingProfile } from "@/lib/api/tenants";
import type { Tenant, TenantBillingProfile } from "@/types";

const GST_STATE_MAP: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh (New)",
  "38": "Ladakh",
};

function derivePrefix(companyName: string): string {
  const clean = companyName.trim();
  if (!clean) return "INV-";
  const words = clean
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => !["pvt", "ltd", "private", "limited", "llp", "inc", "co", "associates"].includes(w.toLowerCase()));
  if (words.length >= 2) {
    return (words[0][0] + words[1][0] + (words[2] ? words[2][0] : "I")).toUpperCase() + "-";
  }
  if (words.length === 1 && words[0].length >= 3) {
    return words[0].slice(0, 3).toUpperCase() + "-";
  }
  return "INV-";
}

interface TenantBillingProfileCardProps {
  tenant: Tenant;
  canWrite: boolean;
}

export function TenantBillingProfileCard({ tenant, canWrite }: TenantBillingProfileCardProps) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["tenant-billing-profile", tenant.id],
    queryFn: () => getTenantBillingProfile(tenant.id),
  });

  const profile = profileQuery.data;

  // Form states
  const [legalName, setLegalName] = React.useState("");
  const [brandName, setBrandName] = React.useState("");
  const [gstin, setGstin] = React.useState("");
  const [cin, setCin] = React.useState("");
  const [pan, setPan] = React.useState("");
  const [isGstRegistered, setIsGstRegistered] = React.useState(true);
  const [address, setAddress] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [stateCode, setStateCode] = React.useState("20");
  const [pincode, setPincode] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [website, setWebsite] = React.useState("");

  // Bank & Settlement
  const [bankName, setBankName] = React.useState("");
  const [accountName, setAccountName] = React.useState("");
  const [accountNumber, setAccountNumber] = React.useState("");
  const [ifsc, setIfsc] = React.useState("");
  const [upiId, setUpiId] = React.useState("");

  // Invoicing & Signatory
  const [invoicePrefix, setInvoicePrefix] = React.useState("INV-");
  const [nextSequence, setNextSequence] = React.useState<number>(1001);
  const [signatoryName, setSignatoryName] = React.useState("");
  const [signatoryDesignation, setSignatoryDesignation] = React.useState("Authorized Signatory");
  const [jurisdictionCity, setJurisdictionCity] = React.useState("");
  const [logoUrl, setLogoUrl] = React.useState("");
  const [signatureUrl, setSignatureUrl] = React.useState("");
  const [isVerified, setIsVerified] = React.useState(false);

  // Sync state on load
  React.useEffect(() => {
    if (profile) {
      setLegalName(profile.legal_name || "");
      setBrandName(profile.brand_name || "");
      setGstin(profile.gstin || "");
      setCin(profile.cin || "");
      setPan(profile.pan || "");
      setIsGstRegistered(profile.is_gst_registered ?? true);
      setAddress(profile.address || "");
      setCity(profile.city || "");
      setState(profile.state || "");
      setStateCode(profile.state_code || "20");
      setPincode(profile.pincode || "");
      setPhone(profile.phone || "");
      setEmail(profile.email || "");
      setWebsite(profile.website || "");
      setBankName(profile.bank_name || "");
      setAccountName(profile.account_name || "");
      setAccountNumber(profile.account_number || "");
      setIfsc(profile.ifsc || "");
      setUpiId(profile.upi_id || "");
      setInvoicePrefix(profile.invoice_prefix || "INV-");
      setNextSequence(profile.next_sequence || 1001);
      setSignatoryName(profile.signatory_name || "");
      setSignatoryDesignation(profile.signatory_designation || "Authorized Signatory");
      setJurisdictionCity(profile.jurisdiction_city || "");
      setLogoUrl(profile.logo_url || "");
      setSignatureUrl(profile.signature_url || "");
      setIsVerified(profile.is_verified ?? false);
    } else {
      // Pre-fill smart defaults from tenant
      setLegalName(tenant.name || "");
      setBrandName(tenant.name || "");
      setWebsite(tenant.domain ? `https://${tenant.domain}` : "");
      setInvoicePrefix(derivePrefix(tenant.name));
      setAccountName(tenant.name || "");
    }
  }, [profile, tenant]);

  // Smart Auto-Mapping Handlers
  const handleGstinChange = (value: string) => {
    const raw = value.toUpperCase().trim();
    setGstin(raw);
    if (raw.length >= 2) {
      const code = raw.slice(0, 2);
      const detectedState = GST_STATE_MAP[code];
      if (detectedState) {
        setStateCode(code);
        setState(detectedState);
        setIsGstRegistered(true);
      }
    }
    // Auto-extract PAN from GSTIN (chars 3 to 12)
    if (raw.length >= 12) {
      const extractedPan = raw.slice(2, 12);
      if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(extractedPan)) {
        setPan(extractedPan);
      }
    }
  };

  const handleLegalNameChange = (val: string) => {
    setLegalName(val);
    if (!accountName || accountName === legalName) {
      setAccountName(val);
    }
    if (!profile && (!invoicePrefix || invoicePrefix === "INV-")) {
      setInvoicePrefix(derivePrefix(val));
    }
  };

  const handleCityChange = (val: string) => {
    setCity(val);
    if (!jurisdictionCity || jurisdictionCity === city) {
      setJurisdictionCity(val);
    }
  };

  // Image upload helpers (converts to base64 data url for reliability)
  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("File size must be under 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setter(event.target.result as string);
        toast.success("Image uploaded successfully");
      }
    };
    reader.readAsDataURL(file);
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (payload: Partial<TenantBillingProfile>) =>
      saveTenantBillingProfile(tenant.id, payload),
    onSuccess: (data) => {
      toast.success(
        data.is_verified
          ? "Tax Invoice profile verified and saved!"
          : "Tax Invoice profile updated"
      );
      void queryClient.invalidateQueries({ queryKey: ["tenant-billing-profile", tenant.id] });
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to save billing profile");
    },
  });

  const handleSave = () => {
    if (!legalName.trim()) {
      toast.error("Business / Legal Name is required");
      return;
    }
    if (!address.trim() || !city.trim() || !pincode.trim()) {
      toast.error("Complete address (Street, City, Pincode) is required");
      return;
    }
    if (!bankName.trim() || !accountNumber.trim() || !ifsc.trim()) {
      toast.error("Bank details (Bank Name, Account No, IFSC) are required");
      return;
    }
    if (!signatoryName.trim()) {
      toast.error("Authorized Signatory Name is required");
      return;
    }

    saveMutation.mutate({
      legal_name: legalName.trim(),
      brand_name: brandName.trim() || null,
      gstin: gstin.trim() || null,
      cin: cin.trim() || null,
      pan: pan.trim() || null,
      is_gst_registered: isGstRegistered,
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      state_code: stateCode.trim() || "07",
      pincode: pincode.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      website: website.trim() || null,
      bank_name: bankName.trim(),
      account_name: accountName.trim() || legalName.trim(),
      account_number: accountNumber.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      upi_id: upiId.trim() || null,
      invoice_prefix: invoicePrefix.trim().toUpperCase(),
      next_sequence: Number(nextSequence) || 1001,
      signatory_name: signatoryName.trim(),
      signatory_designation: signatoryDesignation.trim() || "Authorized Signatory",
      signature_url: signatureUrl || null,
      logo_url: logoUrl || null,
      jurisdiction_city: jurisdictionCity.trim() || city.trim(),
      is_verified: isVerified,
    });
  };

  const handleAutofillWorkspace = () => {
    setLegalName(tenant.name || "");
    setBrandName(tenant.name || "");
    setWebsite(tenant.domain ? `https://${tenant.domain}` : "");
    setInvoicePrefix(derivePrefix(tenant.name));
    setAccountName(tenant.name || "");
    toast.info("Auto-mapped info from workspace!");
  };

  return (
    <Card className="border-border">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-brand/10 text-brand">
              <FileText className="size-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight">
                Tax Invoice & Legal Profile
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Official billing details used to generate GST tax invoices, QR codes, and PDF receipts for this workspace.
              </CardDescription>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {profileQuery.isLoading ? (
            <Badge variant="secondary" className="text-xs">Loading profile...</Badge>
          ) : isVerified ? (
            <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs py-1 px-2.5">
              <CheckCircle2 className="size-3.5" />
              Verified & Live
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 gap-1 text-xs py-1 px-2.5">
              <Clock className="size-3.5" />
              Pending Verification
            </Badge>
          )}

          {canWrite ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutofillWorkspace}
              className="gap-1.5 text-xs h-8"
              title="Pre-fill defaults from tenant name and domain"
            >
              <Sparkles className="size-3.5 text-brand" />
              Auto-fill
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {/* Section 1: Company Legal Identity & GST */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-1 border-b border-border/60">
            <Building className="size-4 text-muted-foreground" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              1. Legal Entity & GST Information
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Business / Legal Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Acme Technologies Pvt. Ltd."
                value={legalName}
                onChange={(e) => handleLegalNameChange(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">
                As per Certificate of Incorporation / GST
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Brand / Trade Name</Label>
              <Input
                placeholder="e.g. Acme Tech"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">
                Displayed prominently in header & logo
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">GSTIN (15 Digits)</Label>
                {state ? (
                  <span className="text-[10px] font-semibold text-brand bg-brand/10 px-1.5 py-0.5 rounded">
                    {state} ({stateCode})
                  </span>
                ) : null}
              </div>
              <Input
                placeholder="e.g. 27AAACA1234A1Z5"
                value={gstin}
                onChange={(e) => handleGstinChange(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs font-mono uppercase"
                maxLength={15}
              />
              <span className="text-[11px] text-muted-foreground">
                First 2 digits auto-map state & place of supply
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">CIN (Corporate Identity No.)</Label>
              <Input
                placeholder="e.g. U72900MH2023PTC123456"
                value={cin}
                onChange={(e) => setCin(e.target.value.toUpperCase())}
                disabled={!canWrite}
                className="h-9 text-xs font-mono uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">PAN Number</Label>
              <Input
                placeholder="e.g. AAACA1234A"
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                disabled={!canWrite}
                className="h-9 text-xs font-mono uppercase"
                maxLength={10}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Official Contact Phone</Label>
              <Input
                placeholder="e.g. +91 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Billing Support Email</Label>
              <Input
                placeholder="e.g. billing@company.example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Official Website</Label>
              <Input
                placeholder="https://company.example.com"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Registered Address <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. 101, Business Park, Tech Zone"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                City <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Mumbai"
                value={city}
                onChange={(e) => handleCityChange(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">State & Code</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Maharashtra"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  disabled={!canWrite}
                  className="h-9 text-xs flex-1"
                />
                <Input
                  placeholder="Code"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                  disabled={!canWrite}
                  className="h-9 text-xs w-16 font-mono text-center"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Pincode <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. 400001"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs font-mono"
                maxLength={6}
              />
            </div>
          </div>
        </div>

        {/* Section 2: Banking & Dynamic UPI Settlement */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 pb-1 border-b border-border/60">
            <Landmark className="size-4 text-muted-foreground" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              2. Banking & Payment Settlement (Bank Transfer + UPI QR)
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Bank Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. HDFC BANK"
                value={bankName}
                onChange={(e) => setBankName(e.target.value.toUpperCase())}
                disabled={!canWrite}
                className="h-9 text-xs uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Account Holder Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Acme Technologies Private Limited"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">
                Matches the payee name registered at bank
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Account Number <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. 50100432109876"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\s+/g, ""))}
                disabled={!canWrite}
                className="h-9 text-xs font-mono font-bold"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                IFSC Code <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. HDFC0000123"
                value={ifsc}
                onChange={(e) => setIfsc(e.target.value.toUpperCase().trim())}
                disabled={!canWrite}
                className="h-9 text-xs font-mono uppercase font-semibold text-brand"
                maxLength={11}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">UPI VPA / ID</Label>
                {upiId ? (
                  <span className="text-[10px] text-emerald-600 font-medium">Dynamic QR Active</span>
                ) : null}
              </div>
              <Input
                placeholder="e.g. billing@okhdfcbank"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value.trim())}
                disabled={!canWrite}
                className="h-9 text-xs font-mono"
              />
              <span className="text-[11px] text-muted-foreground">
                UPI QR is dynamically generated on invoices
              </span>
            </div>

            {/* Live QR Preview Box */}
            <div className="flex items-center gap-3 p-2.5 rounded-md border border-slate-200 bg-slate-50 dark:bg-slate-900/50">
              <div className="size-14 bg-white border rounded p-1 flex items-center justify-center shrink-0">
                {upiId ? (
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(
                      `upi://pay?pa=${upiId}&pn=${encodeURIComponent(accountName || legalName)}&cu=INR`
                    )}`}
                    alt="UPI QR"
                    className="size-full object-contain"
                  />
                ) : (
                  <QrCode className="size-8 text-muted-foreground/40" />
                )}
              </div>
              <div className="text-[11px] space-y-0.5">
                <p className="font-semibold text-slate-800 dark:text-slate-200">Dynamic Scan-to-Pay</p>
                <p className="text-muted-foreground text-[10.5px]">
                  {upiId ? `Linked: ${upiId}` : "Enter UPI ID to preview QR"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Invoicing Numbering, Assets & Verification */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 pb-1 border-b border-border/60">
            <CreditCard className="size-4 text-muted-foreground" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              3. Invoice Prefix, Signatory & Official Verification
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Invoice Number Prefix <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. ACM-"
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                disabled={!canWrite}
                className="h-9 text-xs font-mono font-bold"
              />
              <span className="text-[11px] text-muted-foreground">
                Prefix for new invoices (e.g. {invoicePrefix}1001)
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Next Invoice Sequence</Label>
              <Input
                type="number"
                placeholder="1001"
                value={nextSequence}
                onChange={(e) => setNextSequence(Number(e.target.value))}
                disabled={!canWrite}
                className="h-9 text-xs font-mono"
              />
              <span className="text-[11px] text-muted-foreground">
                Counter increments automatically on each invoice
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Jurisdiction City</Label>
              <Input
                placeholder="e.g. Mumbai"
                value={jurisdictionCity}
                onChange={(e) => setJurisdictionCity(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">
                Subject to {jurisdictionCity || city || "Tenant"} Jurisdiction
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Authorized Signatory Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Rajesh Sharma"
                value={signatoryName}
                onChange={(e) => setSignatoryName(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Signatory Designation</Label>
              <Input
                placeholder="e.g. Director / Authorized Signatory"
                value={signatoryDesignation}
                onChange={(e) => setSignatoryDesignation(e.target.value)}
                disabled={!canWrite}
                className="h-9 text-xs"
              />
            </div>

            {/* Signature Upload / Preview */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Digital Signature Stamp</Label>
              <div className="flex items-center gap-2">
                <div className="h-9 w-20 border rounded bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {signatureUrl ? (
                    <img src={signatureUrl} alt="Signature" className="h-full object-contain p-0.5" />
                  ) : (
                    <span className="text-[9px] text-muted-foreground">Default Asset</span>
                  )}
                </div>
                {canWrite ? (
                  <label className="cursor-pointer">
                    <Button variant="outline" size="sm" type="button" className="h-8 text-xs gap-1 pointer-events-none">
                      <UploadCloud className="size-3" />
                      Upload
                    </Button>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => handleFileUpload(e, setSignatureUrl)}
                    />
                  </label>
                ) : null}
                {signatureUrl && canWrite ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => setSignatureUrl("")}
                  >
                    Reset
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Verification Checkbox & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Switch
              id="is_verified"
              checked={isVerified}
              onCheckedChange={setIsVerified}
              disabled={!canWrite}
            />
            <Label htmlFor="is_verified" className="cursor-pointer flex flex-col">
              <span className="text-xs font-semibold">
                Mark Profile as Verified & Enable Live Tax Invoicing
              </span>
              <span className="text-[11px] text-muted-foreground">
                When enabled, tenant users can generate and send legal tax invoices with these credentials.
              </span>
            </Label>
          </div>

          {canWrite ? (
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="gap-1.5 h-9 px-4 text-xs font-medium"
            >
              <Save className="size-3.5" />
              {saveMutation.isPending ? "Saving..." : "Save Profile"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

