import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  FileText,
  ImageIcon,
  Landmark,
  Palette,
  Save,
  Sliders,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getTenantBillingProfile, saveTenantBillingProfile } from "@/lib/api/tenants";
import type { InvoiceSettings, Tenant, TenantBillingProfile } from "@/types";

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

const COLOR_PRESETS = [
  { label: "Navy", hex: "#1f2a5a" },
  { label: "Royal Blue", hex: "#2448b5" },
  { label: "Emerald", hex: "#0f766e" },
  { label: "Indigo", hex: "#4f46e5" },
  { label: "Charcoal", hex: "#18181b" },
  { label: "Crimson", hex: "#991b1b" },
];

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

/**
 * Optimizes an image file (auto-downscales high-res files via Canvas so uploads never fail)
 */
function processImageFile(
  file: File,
  onSuccess: (dataUrl: string) => void,
  onError: (msg: string) => void
) {
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) onSuccess(e.target.result as string);
    };
    reader.onerror = () => onError("Failed to read SVG file");
    reader.readAsDataURL(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const rawDataUrl = e.target?.result as string;
    if (!rawDataUrl) {
      onError("Empty file read");
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        const MAX_DIM = 800;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
          const optimized = canvas.toDataURL(mime, 0.9);
          onSuccess(optimized);
        } else {
          onSuccess(rawDataUrl);
        }
      } catch {
        onSuccess(rawDataUrl);
      }
    };
    img.onerror = () => onSuccess(rawDataUrl);
    img.src = rawDataUrl;
  };
  reader.onerror = () => onError("Failed to read image file");
  reader.readAsDataURL(file);
}

interface TenantBillingProfileCardProps {
  tenant: Tenant;
  canWrite: boolean;
}

export function TenantBillingProfileCard({ tenant, canWrite }: TenantBillingProfileCardProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState<"profile" | "customize" | "preview">("profile");

  // File input refs for reliable click trigger
  const logoInputRef = React.useRef<HTMLInputElement>(null);
  const sigInputRef = React.useRef<HTMLInputElement>(null);

  const profileQuery = useQuery({
    queryKey: ["tenant-billing-profile", tenant.id],
    queryFn: () => getTenantBillingProfile(tenant.id),
  });

  const profile = profileQuery.data;

  // Form states - Legal & GST
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

  // Bill Customization Settings
  const [theme, setTheme] = React.useState<"modern" | "classic" | "minimal">("modern");
  const [primaryColor, setPrimaryColor] = React.useState(tenant.brand_color || "#1f2a5a");
  const [secondaryColor, setSecondaryColor] = React.useState("#2448b5");
  const [currencySymbol, setCurrencySymbol] = React.useState("₹");
  const [taxLabel, setTaxLabel] = React.useState("GST");

  // Essential Display Toggles
  const [showQrCode, setShowQrCode] = React.useState(true);
  const [showBankDetails, setShowBankDetails] = React.useState(true);
  const [showSignature, setShowSignature] = React.useState(true);
  const [showPanCin, setShowPanCin] = React.useState(true);
  const [showProjectDetails, setShowProjectDetails] = React.useState(true);
  const [showHsnSac, setShowHsnSac] = React.useState(true);
  const [showAmountInWords, setShowAmountInWords] = React.useState(true);

  // Policy & Notes
  const [paymentTerms, setPaymentTerms] = React.useState("Payment due within 15 days of invoice date.");
  const [declaration, setDeclaration] = React.useState(
    "We declare that this invoice shows the actual price of the goods/services described and that all particulars are true and correct."
  );
  const [footerNote, setFooterNote] = React.useState("Thank You For Your Business!");

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

      // Parse invoice customization settings
      const rawSettings = profile.invoice_settings;
      const settings: InvoiceSettings =
        typeof rawSettings === "string"
          ? (() => {
              try {
                return JSON.parse(rawSettings);
              } catch {
                return {};
              }
            })()
          : (rawSettings as InvoiceSettings) || {};

      if (settings.theme) setTheme(settings.theme);
      if (settings.primary_color) setPrimaryColor(settings.primary_color);
      else if (tenant.brand_color) setPrimaryColor(tenant.brand_color);

      if (settings.secondary_color) setSecondaryColor(settings.secondary_color);
      if (settings.currency_symbol) setCurrencySymbol(settings.currency_symbol);
      if (settings.tax_label) setTaxLabel(settings.tax_label);

      if (settings.toggles) {
        if (settings.toggles.show_qr_code !== undefined) setShowQrCode(settings.toggles.show_qr_code);
        if (settings.toggles.show_bank_details !== undefined) setShowBankDetails(settings.toggles.show_bank_details);
        if (settings.toggles.show_signature !== undefined) setShowSignature(settings.toggles.show_signature);
        if (settings.toggles.show_pan_cin !== undefined) setShowPanCin(settings.toggles.show_pan_cin);
        if (settings.toggles.show_project_details !== undefined) setShowProjectDetails(settings.toggles.show_project_details);
        if (settings.toggles.show_hsn_sac !== undefined) setShowHsnSac(settings.toggles.show_hsn_sac);
        if (settings.toggles.show_amount_in_words !== undefined) setShowAmountInWords(settings.toggles.show_amount_in_words);
      }

      if (settings.policies) {
        if (settings.policies.payment_terms) setPaymentTerms(settings.policies.payment_terms);
        if (settings.policies.declaration) setDeclaration(settings.policies.declaration);
        if (settings.policies.footer_note) setFooterNote(settings.policies.footer_note);
      }
    } else {
      // Pre-fill smart defaults from tenant
      setLegalName(tenant.name || "");
      setBrandName(tenant.name || "");
      setWebsite(tenant.domain ? `https://${tenant.domain}` : "");
      setInvoicePrefix(derivePrefix(tenant.name));
      setAccountName(tenant.name || "");
      if (tenant.brand_color) setPrimaryColor(tenant.brand_color);
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

  // Robust file input change handler with auto-optimization
  const handleFileInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void,
    label: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    processImageFile(
      file,
      (dataUrl) => {
        setter(dataUrl);
        toast.success(`${label} uploaded and ready!`);
        // Safely reset input value after processing so selecting the same file works
        if (e.target) e.target.value = "";
      },
      (err) => {
        toast.error(err);
        if (e.target) e.target.value = "";
      }
    );
  };

  // Drag and drop helper
  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    setter: (val: string) => void,
    label: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      toast.error("Please drop a valid image file");
      return;
    }
    processImageFile(
      file,
      (dataUrl) => {
        setter(dataUrl);
        toast.success(`${label} dropped and uploaded!`);
      },
      (err) => toast.error(err)
    );
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (payload: Partial<TenantBillingProfile>) =>
      saveTenantBillingProfile(tenant.id, payload),
    onSuccess: (data) => {
      toast.success(
        data.is_verified
          ? "Tax Invoice profile verified & bill customization saved!"
          : "Tax Invoice profile & bill settings updated"
      );
      void queryClient.invalidateQueries({ queryKey: ["tenant-billing-profile", tenant.id] });
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to save billing profile");
    },
  });

  const handleSave = () => {
    const name = legalName.trim() || tenant.name || "Business Entity";

    const invoiceSettingsPayload: InvoiceSettings = {
      theme,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      currency_symbol: currencySymbol,
      tax_label: taxLabel,
      toggles: {
        show_qr_code: showQrCode,
        show_bank_details: showBankDetails,
        show_signature: showSignature,
        show_pan_cin: showPanCin,
        show_project_details: showProjectDetails,
        show_hsn_sac: showHsnSac,
        show_amount_in_words: showAmountInWords,
      },
      policies: {
        payment_terms: paymentTerms.trim(),
        declaration: declaration.trim(),
        footer_note: footerNote.trim(),
      },
    };

    saveMutation.mutate({
      legal_name: name,
      brand_name: brandName.trim() || name,
      gstin: gstin.trim() || null,
      cin: cin.trim() || null,
      pan: pan.trim() || null,
      is_gst_registered: isGstRegistered,
      address: address.trim() || "Headquarters",
      city: city.trim() || "Mumbai",
      state: state.trim() || "Maharashtra",
      state_code: stateCode.trim() || "27",
      pincode: pincode.trim() || "400001",
      phone: phone.trim() || null,
      email: email.trim() || null,
      website: website.trim() || (tenant.domain ? `https://${tenant.domain}` : null),
      bank_name: bankName.trim() || "HDFC BANK",
      account_name: accountName.trim() || name,
      account_number: accountNumber.trim() || "50100000000000",
      ifsc: (ifsc.trim() || "HDFC0000001").toUpperCase(),
      upi_id: upiId.trim() || null,
      invoice_prefix: invoicePrefix.trim().toUpperCase() || "INV-",
      next_sequence: Number(nextSequence) || 1001,
      signatory_name: signatoryName.trim() || "Authorized Signatory",
      signatory_designation: signatoryDesignation.trim() || "Director",
      signature_url: signatureUrl || null,
      logo_url: logoUrl || null,
      jurisdiction_city: jurisdictionCity.trim() || city.trim() || "Mumbai",
      is_verified: isVerified,
      invoice_settings: invoiceSettingsPayload,
    });
  };

  const handleAutofillWorkspace = () => {
    setLegalName(tenant.name || "");
    setBrandName(tenant.name || "");
    setWebsite(tenant.domain ? `https://${tenant.domain}` : "");
    setInvoicePrefix(derivePrefix(tenant.name));
    setAccountName(tenant.name || "");
    if (!address) setAddress("101, Business Park");
    if (!city) setCity("Mumbai");
    if (!state) setState("Maharashtra");
    if (!stateCode) setStateCode("27");
    if (!pincode) setPincode("400001");
    if (!bankName) setBankName("HDFC BANK");
    if (!accountNumber) setAccountNumber("50100432109876");
    if (!ifsc) setIfsc("HDFC0000123");
    if (!signatoryName) setSignatoryName("Authorized Signatory");
    if (tenant.brand_color) setPrimaryColor(tenant.brand_color);
    toast.info("Auto-mapped all required fields & defaults from workspace!");
  };

  // Sample dynamic preview values
  const previewGross = 150000;
  const previewTax = isGstRegistered ? 27000 : 0;
  const previewTotal = previewGross + previewTax;
  const previewQrUrl = upiId
    ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
        `upi://pay?pa=${upiId}&pn=${encodeURIComponent(accountName || legalName)}&am=${previewTotal}&cu=INR`
      )}`
    : `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
        `upi://pay?pa=billing@orbit&pn=${encodeURIComponent(accountName || legalName)}&am=${previewTotal}&cu=INR`
      )}`;

  return (
    <Card className="border-border shadow-xs">
      {/* Hidden file inputs directly mounted in the component */}
      <input
        ref={logoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        style={{ display: "none" }}
        onChange={(e) => handleFileInputChange(e, setLogoUrl, "Company Logo")}
      />
      <input
        ref={sigInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        style={{ display: "none" }}
        onChange={(e) => handleFileInputChange(e, setSignatureUrl, "Signature Stamp")}
      />

      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-brand/10 text-brand">
              <FileText className="size-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight">
                Tax Invoice & Bill Customizer
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Official billing credentials, live branding, display toggles, and payment settlement for {tenant.name}.
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
              Auto-fill Defaults
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="pt-5 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-lg max-w-md border border-border/60">
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${
              activeTab === "profile"
                ? "bg-white text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Building className="size-3.5" />
            Legal & Banking
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("customize")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${
              activeTab === "customize"
                ? "bg-white text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Palette className="size-3.5" />
            Bill Customizer
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("preview")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${
              activeTab === "preview"
                ? "bg-white text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="size-3.5" />
            Live Preview
          </button>
        </div>

        {/* TAB 1: LEGAL & BANKING PROFILE */}
        {activeTab === "profile" && (
          <div className="space-y-6">
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
                    Displayed prominently in invoice header
                  </span>
                </div>

                {/* Company Logo Upload & Drop Zone */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium">Official Company Logo</Label>
                    {logoUrl ? (
                      <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                        Uploaded ✓
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => canWrite && logoInputRef.current?.click()}
                      onKeyDown={(e) => e.key === "Enter" && canWrite && logoInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => canWrite && handleDrop(e, setLogoUrl, "Company Logo")}
                      title="Click or drag image to upload logo"
                      className="h-14 w-36 border-2 border-dashed rounded-lg bg-white hover:bg-slate-50 flex items-center justify-center overflow-hidden shrink-0 shadow-xs cursor-pointer transition-colors group relative"
                    >
                      {logoUrl ? (
                        <img src={logoUrl} alt="Logo" className="h-full max-h-12 max-w-[130px] object-contain p-1" />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-muted-foreground group-hover:text-brand">
                          <ImageIcon className="size-5" />
                          <span className="text-[9px] mt-0.5 font-medium">Click / Drop Logo</span>
                        </div>
                      )}
                    </div>
                    {canWrite ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        className="h-9 text-xs gap-1.5"
                        onClick={() => logoInputRef.current?.click()}
                      >
                        <UploadCloud className="size-3.5 text-brand" />
                        {logoUrl ? "Change Logo" : "Upload Logo"}
                      </Button>
                    ) : null}
                    {logoUrl && canWrite ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        className="h-9 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setLogoUrl("")}
                        title="Remove uploaded logo"
                      >
                        <X className="size-3.5 mr-0.5" />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Click to pick file or drag & drop (PNG, JPEG, WebP, SVG)
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
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Auto-maps state, code, and derives PAN
                  </span>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Company PAN (10 Digits)</Label>
                  <Input
                    placeholder="e.g. AAACA1234A"
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase())}
                    disabled={!canWrite}
                    className="h-9 text-xs font-mono uppercase"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">CIN (21 Digits, Optional)</Label>
                  <Input
                    placeholder="e.g. U72900MH2023PTC123456"
                    value={cin}
                    onChange={(e) => setCin(e.target.value.toUpperCase())}
                    disabled={!canWrite}
                    className="h-9 text-xs font-mono uppercase"
                  />
                </div>

                <div className="flex items-center gap-3 pt-4">
                  <Switch
                    id="gst_registered"
                    checked={isGstRegistered}
                    onCheckedChange={setIsGstRegistered}
                    disabled={!canWrite}
                  />
                  <Label htmlFor="gst_registered" className="text-xs cursor-pointer">
                    <span className="font-medium block">GST Registered Entity</span>
                    <span className="text-[11px] text-muted-foreground block">
                      Enables CGST/SGST/IGST tax calculation on invoices
                    </span>
                  </Label>
                </div>
              </div>
            </div>

            {/* Section 2: Registered Business Address */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/60">
                <Landmark className="size-4 text-muted-foreground" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  2. Registered Office Address & Communication
                </h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-medium">Office / Street Address</Label>
                  <Input
                    placeholder="e.g. 101, Business Hub, Tech Zone, Andheri East"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">City</Label>
                  <Input
                    placeholder="e.g. Mumbai"
                    value={city}
                    onChange={(e) => handleCityChange(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">State</Label>
                  <Input
                    placeholder="e.g. Maharashtra"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">State Code (2 Digits)</Label>
                  <Input
                    placeholder="e.g. 27"
                    value={stateCode}
                    onChange={(e) => setStateCode(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Pincode</Label>
                  <Input
                    placeholder="e.g. 400001"
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Billing Support Phone</Label>
                  <Input
                    placeholder="e.g. +91 9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Official Billing Email</Label>
                  <Input
                    placeholder="e.g. billing@acme.example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Company Website</Label>
                  <Input
                    placeholder="e.g. https://acme.com"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Section 3: Bank Account & Payment Settlement */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/60">
                <CreditCard className="size-4 text-muted-foreground" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  3. Bank Account & Settlement Details
                </h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Bank Name</Label>
                  <Input
                    placeholder="e.g. HDFC BANK"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value.toUpperCase())}
                    disabled={!canWrite}
                    className="h-9 text-xs uppercase"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Beneficiary / Account Name</Label>
                  <Input
                    placeholder="e.g. Acme Technologies Private Limited"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Bank Account Number</Label>
                  <Input
                    placeholder="e.g. 50100432109876"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">IFSC Code</Label>
                  <Input
                    placeholder="e.g. HDFC0000123"
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    disabled={!canWrite}
                    className="h-9 text-xs font-mono uppercase"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">UPI VPA / ID (For Instant QR Pay)</Label>
                  <Input
                    placeholder="e.g. billing@okhdfcbank"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Generates dynamic scan-to-pay QR code on the invoice
                  </span>
                </div>
              </div>
            </div>

            {/* Section 4: Invoicing Sequence & Signatory */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/60">
                <FileText className="size-4 text-muted-foreground" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  4. Invoice Sequencing & Authorized Signatory
                </h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Invoice Number Prefix</Label>
                  <Input
                    placeholder="e.g. INV- or ACME-"
                    value={invoicePrefix}
                    onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                    disabled={!canWrite}
                    className="h-9 text-xs font-mono uppercase"
                  />
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
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Authorized Signatory Name</Label>
                  <Input
                    placeholder="e.g. Rajesh Sharma"
                    value={signatoryName}
                    onChange={(e) => setSignatoryName(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
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

                {/* Digital Signature Stamp Upload & Drop Zone */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium">Digital Signature Stamp</Label>
                    {signatureUrl ? (
                      <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                        Uploaded ✓
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => canWrite && sigInputRef.current?.click()}
                      onKeyDown={(e) => e.key === "Enter" && canWrite && sigInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => canWrite && handleDrop(e, setSignatureUrl, "Signature Stamp")}
                      title="Click or drag image to upload signature"
                      className="h-14 w-36 border-2 border-dashed rounded-lg bg-white hover:bg-slate-50 flex items-center justify-center overflow-hidden shrink-0 shadow-xs cursor-pointer transition-colors group relative"
                    >
                      {signatureUrl ? (
                        <img src={signatureUrl} alt="Signature" className="h-full max-h-12 max-w-[130px] object-contain p-1" />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-muted-foreground group-hover:text-brand">
                          <ImageIcon className="size-5" />
                          <span className="text-[9px] mt-0.5 font-medium">Click / Drop Stamp</span>
                        </div>
                      )}
                    </div>
                    {canWrite ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        className="h-9 text-xs gap-1.5"
                        onClick={() => sigInputRef.current?.click()}
                      >
                        <UploadCloud className="size-3.5 text-brand" />
                        {signatureUrl ? "Change Stamp" : "Upload Stamp"}
                      </Button>
                    ) : null}
                    {signatureUrl && canWrite ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        className="h-9 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setSignatureUrl("")}
                        title="Remove uploaded signature"
                      >
                        <X className="size-3.5 mr-0.5" />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Click to pick file or drag & drop (PNG with transparent bg)
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: BILL CUSTOMIZER & RULES */}
        {activeTab === "customize" && (
          <div className="space-y-6">
            {/* Visual Styling & Accent Colors */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/60">
                <Palette className="size-4 text-muted-foreground" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  1. Visual Branding & Accent Color
                </h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Primary Header Color */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Invoice Header & Accent Color</Label>
                  <div className="flex items-center gap-2">
                    <div
                      className="size-9 rounded-md border border-border shadow-xs shrink-0"
                      style={{ backgroundColor: primaryColor }}
                    />
                    <Input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      disabled={!canWrite}
                      className="h-9 text-xs font-mono w-28 uppercase"
                    />
                    <input
                      type="color"
                      value={primaryColor.startsWith("#") ? primaryColor : "#1f2a5a"}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      disabled={!canWrite}
                      className="size-8 rounded cursor-pointer border border-border p-0 bg-transparent"
                      title="Pick custom color"
                    />
                  </div>
                  {/* Preset swatches */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-muted-foreground mr-1">Presets:</span>
                    {COLOR_PRESETS.map((p) => (
                      <button
                        key={p.hex}
                        type="button"
                        onClick={() => setPrimaryColor(p.hex)}
                        disabled={!canWrite}
                        className={`size-5 rounded-full border transition-transform hover:scale-110 ${
                          primaryColor.toLowerCase() === p.hex.toLowerCase()
                            ? "ring-2 ring-brand ring-offset-1"
                            : "border-border"
                        }`}
                        style={{ backgroundColor: p.hex }}
                        title={p.label}
                      />
                    ))}
                    {tenant.brand_color && (
                      <button
                        type="button"
                        onClick={() => setPrimaryColor(tenant.brand_color!)}
                        disabled={!canWrite}
                        className="text-[10px] ml-2 font-medium text-brand hover:underline"
                      >
                        Use Workspace Brand Color
                      </button>
                    )}
                  </div>
                </div>

                {/* Secondary Accent (Grand Total Strip) */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Grand Total Highlight Color</Label>
                  <div className="flex items-center gap-2">
                    <div
                      className="size-9 rounded-md border border-border shadow-xs shrink-0"
                      style={{ backgroundColor: secondaryColor }}
                    />
                    <Input
                      type="text"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      disabled={!canWrite}
                      className="h-9 text-xs font-mono w-28 uppercase"
                    />
                    <input
                      type="color"
                      value={secondaryColor.startsWith("#") ? secondaryColor : "#2448b5"}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      disabled={!canWrite}
                      className="size-8 rounded cursor-pointer border border-border p-0 bg-transparent"
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground block">
                    Vibrant strip color used for Grand Total banner
                  </span>
                </div>

                {/* Theme Style */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Invoice Layout Theme</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: "modern", title: "Modern", desc: "Carded & Clean" },
                      { id: "classic", title: "Classic", desc: "Traditional GST" },
                      { id: "minimal", title: "Minimal", desc: "Compact & Sleek" },
                    ].map((th) => (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => setTheme(th.id as any)}
                        disabled={!canWrite}
                        className={`p-2.5 rounded-md border text-left transition-all ${
                          theme === th.id
                            ? "border-brand bg-brand/5 text-foreground ring-1 ring-brand"
                            : "border-border hover:bg-muted/40 text-muted-foreground"
                        }`}
                      >
                        <p className="text-xs font-bold">{th.title}</p>
                        <p className="text-[10px] text-muted-foreground">{th.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Currency & Tax Symbols */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Currency Symbol & Tax Label</Label>
                  <div className="flex items-center gap-3">
                    <div className="space-y-1 flex-1">
                      <span className="text-[10px] text-muted-foreground">Currency</span>
                      <Input
                        value={currencySymbol}
                        onChange={(e) => setCurrencySymbol(e.target.value)}
                        disabled={!canWrite}
                        className="h-8 text-xs font-bold"
                        placeholder="₹, $, €"
                      />
                    </div>
                    <div className="space-y-1 flex-1">
                      <span className="text-[10px] text-muted-foreground">Tax Heading</span>
                      <Input
                        value={taxLabel}
                        onChange={(e) => setTaxLabel(e.target.value)}
                        disabled={!canWrite}
                        className="h-8 text-xs font-bold"
                        placeholder="GST, VAT, Tax"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Display Toggles */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/60">
                <Sliders className="size-4 text-muted-foreground" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  2. Essential Display Toggles (Show / Hide Elements)
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-card">
                  <div className="space-y-0.5 pr-2">
                    <Label htmlFor="toggle-qr" className="text-xs font-medium cursor-pointer">
                      UPI QR Code
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Dynamic scan-to-pay box
                    </p>
                  </div>
                  <Switch
                    id="toggle-qr"
                    checked={showQrCode}
                    onCheckedChange={setShowQrCode}
                    disabled={!canWrite}
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-card">
                  <div className="space-y-0.5 pr-2">
                    <Label htmlFor="toggle-bank" className="text-xs font-medium cursor-pointer">
                      Bank Settlement Box
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Account number, IFSC & UPI ID
                    </p>
                  </div>
                  <Switch
                    id="toggle-bank"
                    checked={showBankDetails}
                    onCheckedChange={setShowBankDetails}
                    disabled={!canWrite}
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-card">
                  <div className="space-y-0.5 pr-2">
                    <Label htmlFor="toggle-sig" className="text-xs font-medium cursor-pointer">
                      Signatory Stamp
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Official digital seal & signature
                    </p>
                  </div>
                  <Switch
                    id="toggle-sig"
                    checked={showSignature}
                    onCheckedChange={setShowSignature}
                    disabled={!canWrite}
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-card">
                  <div className="space-y-0.5 pr-2">
                    <Label htmlFor="toggle-pancin" className="text-xs font-medium cursor-pointer">
                      PAN & CIN in Header
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Company registration badges
                    </p>
                  </div>
                  <Switch
                    id="toggle-pancin"
                    checked={showPanCin}
                    onCheckedChange={setShowPanCin}
                    disabled={!canWrite}
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-card">
                  <div className="space-y-0.5 pr-2">
                    <Label htmlFor="toggle-project" className="text-xs font-medium cursor-pointer">
                      Project Details Card
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Scope, type & billing period
                    </p>
                  </div>
                  <Switch
                    id="toggle-project"
                    checked={showProjectDetails}
                    onCheckedChange={setShowProjectDetails}
                    disabled={!canWrite}
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-card">
                  <div className="space-y-0.5 pr-2">
                    <Label htmlFor="toggle-hsn" className="text-xs font-medium cursor-pointer">
                      SAC / HSN Column
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Classification column in items
                    </p>
                  </div>
                  <Switch
                    id="toggle-hsn"
                    checked={showHsnSac}
                    onCheckedChange={setShowHsnSac}
                    disabled={!canWrite}
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-card">
                  <div className="space-y-0.5 pr-2">
                    <Label htmlFor="toggle-words" className="text-xs font-medium cursor-pointer">
                      Amount in Words
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Legal verbal currency amount
                    </p>
                  </div>
                  <Switch
                    id="toggle-words"
                    checked={showAmountInWords}
                    onCheckedChange={setShowAmountInWords}
                    disabled={!canWrite}
                  />
                </div>
              </div>
            </div>

            {/* Policies, Terms & Declarations */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/60">
                <FileText className="size-4 text-muted-foreground" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  3. Policy, Legal Declarations & Tagline
                </h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-medium">Default Payment Terms</Label>
                  <Input
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                    placeholder="e.g. Payment due within 15 days of invoice date."
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Appears in Terms & Conditions list on every invoice
                  </span>
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-medium">Statutory Declaration Note</Label>
                  <Textarea
                    value={declaration}
                    onChange={(e) => setDeclaration(e.target.value)}
                    disabled={!canWrite}
                    rows={2}
                    className="text-xs"
                    placeholder="Statutory declaration statement..."
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Footer Tagline</Label>
                  <Input
                    value={footerNote}
                    onChange={(e) => setFooterNote(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                    placeholder="Thank You For Your Business!"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Legal Jurisdiction City</Label>
                  <Input
                    value={jurisdictionCity}
                    onChange={(e) => setJurisdictionCity(e.target.value)}
                    disabled={!canWrite}
                    className="h-9 text-xs"
                    placeholder="e.g. Mumbai"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Auto-populates: All disputes are subject to [City] Jurisdiction
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LIVE TAX INVOICE PREVIEW */}
        {activeTab === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-1 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Eye className="size-4 text-muted-foreground" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Live Dynamic Tax Invoice Preview
                </h4>
              </div>
              <Badge variant="outline" className="text-[10px] font-mono">
                Theme: {theme.toUpperCase()}
              </Badge>
            </div>

            {/* A4 Sheet Mock Container */}
            <div className="p-4 sm:p-6 bg-slate-100/70 border rounded-xl overflow-x-auto flex justify-center">
              <div className="w-full max-w-[680px] bg-white p-5 rounded-md shadow-md text-slate-800 text-[11px] font-sans border border-slate-200">
                {/* Header */}
                <div className="flex justify-between items-start gap-4 pb-3 border-b border-slate-200">
                  <div className="space-y-0.5 max-w-[60%]">
                    {logoUrl ? (
                      <div className="mb-1.5">
                        <img src={logoUrl} alt="Logo" className="h-12 max-h-14 max-w-[200px] object-contain object-left" />
                      </div>
                    ) : (
                      <h2 className="text-sm font-black tracking-tight text-slate-900 uppercase">
                        {brandName || legalName || tenant.name}
                      </h2>
                    )}
                    <p className="text-[9.5px] text-slate-600 leading-tight">
                      {address || "101, Business Park, Tech Zone"}, {city || "Mumbai"} - {pincode || "400001"}
                    </p>
                    <p className="text-[9.5px] text-slate-600">
                      Ph: {phone || "+91 9876543210"} | {email || "billing@example.com"}
                    </p>
                    {showPanCin && (
                      <p className="text-[9.5px] font-bold text-slate-800">
                        GSTIN: <span className="font-mono">{gstin || "27AAACA1234A1Z5"}</span>
                        {cin ? <> | CIN: <span className="font-mono">{cin}</span></> : null}
                      </p>
                    )}
                  </div>

                  <div className="text-right flex flex-col items-end">
                    <h1
                      className="text-lg font-black tracking-tight uppercase leading-none"
                      style={{ color: primaryColor }}
                    >
                      TAX INVOICE
                    </h1>
                    <p className="text-[10px] font-bold text-slate-800 font-mono tracking-wider mt-1 mb-1">
                      {invoicePrefix}1001
                    </p>
                    <div className="text-[9.5px] space-y-0.5 text-slate-600">
                      <p>Date: <span className="font-bold text-slate-900">18 Nov 2026</span></p>
                      <p>Place of Supply: <span className="font-bold text-slate-900">{state || "Maharashtra"} ({stateCode || "27"})</span></p>
                      <p>Status: <span className="font-bold text-emerald-600">Paid ✓</span></p>
                    </div>
                  </div>
                </div>

                {/* Cards row: Bill to & Project Details */}
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="border border-slate-200 rounded overflow-hidden">
                    <div
                      className="text-white px-2.5 py-0.5 font-bold text-[9.5px] tracking-wider uppercase"
                      style={{ backgroundColor: primaryColor }}
                    >
                      BILL TO
                    </div>
                    <div className="p-2 space-y-0.5 text-[9.5px]">
                      <p className="font-bold text-slate-900">Acme Client Technologies Ltd.</p>
                      <p className="text-slate-600 leading-tight">Floor 5, Apex Towers, MG Road, Bangalore</p>
                      <p className="text-slate-600">GSTIN: <span className="font-mono font-medium">29AABCA1234A1Z9</span></p>
                    </div>
                  </div>

                  {showProjectDetails && (
                    <div className="border border-slate-200 rounded overflow-hidden">
                      <div
                        className="text-white px-2.5 py-0.5 font-bold text-[9.5px] tracking-wider uppercase"
                        style={{ backgroundColor: primaryColor }}
                      >
                        PROJECT & BILLING
                      </div>
                      <div className="p-2 space-y-0.5 text-[9.5px]">
                        <p><span className="text-slate-500">Project:</span> <span className="font-bold text-slate-900">Enterprise CRM Implementation</span></p>
                        <p><span className="text-slate-500">Terms:</span> <span className="text-slate-800">{paymentTerms}</span></p>
                        <p><span className="text-slate-500">Reverse Charge:</span> <span className="text-slate-800">No</span></p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Items Table */}
                <div className="mt-3 border border-slate-200 rounded overflow-hidden">
                  <table className="w-full text-left border-collapse text-[9.5px]">
                    <thead>
                      <tr className="text-white uppercase tracking-wider" style={{ backgroundColor: primaryColor }}>
                        <th className="py-1 px-2 w-6 text-center">#</th>
                        <th className="py-1 px-2">Description</th>
                        {showHsnSac && <th className="py-1 px-2 text-center w-16">SAC</th>}
                        <th className="py-1 px-2 text-center w-10">Qty</th>
                        <th className="py-1 px-2 text-right w-20">Rate ({currencySymbol})</th>
                        <th className="py-1 px-2 text-right w-20">Amount ({currencySymbol})</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="py-1.5 px-2 text-center text-slate-500">1</td>
                        <td className="py-1.5 px-2">
                          <p className="font-bold text-slate-900">Software Architecture & API Implementation</p>
                          <p className="text-[8.5px] text-slate-500">Sprint 1 Deliverables</p>
                        </td>
                        {showHsnSac && <td className="py-1.5 px-2 text-center font-mono text-slate-600">998314</td>}
                        <td className="py-1.5 px-2 text-center">1</td>
                        <td className="py-1.5 px-2 text-right font-mono">1,50,000.00</td>
                        <td className="py-1.5 px-2 text-right font-bold font-mono text-slate-900">1,50,000.00</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Split lower row: Bank & Totals */}
                <div className="grid grid-cols-[1.3fr_1fr] gap-3 mt-3 items-start">
                  <div className="space-y-2">
                    {showAmountInWords && (
                      <div className="border border-slate-200 rounded p-1.5 text-[9px] bg-slate-50">
                        <span className="font-bold text-slate-600 uppercase text-[8px] block">Total In Words:</span>
                        <span className="italic font-semibold text-slate-900">
                          INR One Lakh Seventy Seven Thousand Only
                        </span>
                      </div>
                    )}

                    {showBankDetails && (
                      <div className="border border-slate-200 rounded overflow-hidden">
                        <div
                          className="text-white px-2 py-0.5 font-bold text-[8.5px] uppercase tracking-wider"
                          style={{ backgroundColor: primaryColor }}
                        >
                          BANK DETAILS
                        </div>
                        <div className="p-2 flex items-center justify-between gap-2 text-[9px]">
                          <div className="space-y-0.5">
                            <p><span className="text-slate-500">Bank:</span> <span className="font-bold text-slate-900">{bankName || "HDFC BANK"}</span></p>
                            <p><span className="text-slate-500">A/C:</span> <span className="font-mono font-bold text-slate-900">{accountNumber || "50100432109876"}</span></p>
                            <p><span className="text-slate-500">IFSC:</span> <span className="font-mono font-bold text-blue-700">{ifsc || "HDFC0000123"}</span></p>
                            {upiId && <p><span className="text-slate-500">UPI:</span> <span className="font-mono text-slate-900">{upiId}</span></p>}
                          </div>
                          {showQrCode && (
                            <div className="flex flex-col items-center shrink-0">
                              <img src={previewQrUrl} alt="QR" className="size-12 border p-0.5 bg-white rounded" />
                              <span className="text-[8px] text-slate-500 mt-0.5">Scan to Pay</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="border border-slate-200 rounded p-2 space-y-1 text-[9.5px]">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Sub Total</span>
                        <span className="font-mono">{currencySymbol} 1,50,000.00</span>
                      </div>
                      {isGstRegistered ? (
                        <>
                          <div className="flex justify-between text-slate-600">
                            <span>CGST (9%)</span>
                            <span className="font-mono">{currencySymbol} 13,500.00</span>
                          </div>
                          <div className="flex justify-between text-slate-600">
                            <span>SGST (9%)</span>
                            <span className="font-mono">{currencySymbol} 13,500.00</span>
                          </div>
                        </>
                      ) : null}
                    </div>

                    <div
                      className="text-white px-2.5 py-1.5 rounded flex items-center justify-between font-bold"
                      style={{ backgroundColor: secondaryColor }}
                    >
                      <span className="text-[10px] uppercase">GRAND TOTAL</span>
                      <span className="font-mono text-xs">{currencySymbol} {previewTotal.toLocaleString("en-IN")}.00</span>
                    </div>
                  </div>
                </div>

                {/* Declarations & Signature */}
                <div className="grid grid-cols-[1.3fr_1fr] gap-3 mt-3 pt-2 border-t border-slate-200 items-end text-[8.5px]">
                  <div className="space-y-1 text-slate-600">
                    <p className="font-bold uppercase text-slate-800">DECLARATION</p>
                    <p>{declaration}</p>
                    <p className="font-bold uppercase text-slate-800 pt-0.5">TERMS & CONDITIONS</p>
                    <p>• {paymentTerms}</p>
                    <p>• Disputes subject to {jurisdictionCity || city || "Local"} Jurisdiction only.</p>
                  </div>

                  {showSignature && (
                    <div className="text-right">
                      <p className="font-bold text-[9px] text-slate-900">For {brandName || legalName || tenant.name}</p>
                      <div className="min-h-[56px] h-14 max-w-[160px] ml-auto flex justify-end items-center my-0.5">
                        {signatureUrl ? (
                          <img src={signatureUrl} alt="Signature" className="max-h-14 max-w-[160px] object-contain object-right" />
                        ) : (
                          <span className="text-[8px] italic text-slate-400 border border-dashed rounded px-2 py-1">
                            Digital Seal
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-[8.5px] text-slate-700">{signatoryDesignation}</p>
                      <div className="border-t border-slate-400 w-36 ml-auto pt-0.5 mt-0.5">
                        <p className="font-bold text-slate-900">{signatoryName || "Authorized Signatory"}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Tagline */}
                <div className="mt-3 pt-1.5 border-t border-slate-100 text-center text-[9px] text-slate-500">
                  <p className="font-bold italic" style={{ color: secondaryColor }}>{footerNote}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Verification Checkbox & Bottom Action Bar */}
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
              className="gap-1.5 h-9 px-5 text-xs font-medium"
            >
              <Save className="size-3.5" />
              {saveMutation.isPending ? "Saving..." : "Save All Profile & Bill Settings"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
