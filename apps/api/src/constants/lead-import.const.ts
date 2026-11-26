import { normalizePhone } from "../utils/phone";

export const CSV_IMPORT_TAG = "CSV Import";

export const LEAD_IMPORT_TYPES = [
  "sales",
  "student_admission",
  "medical",
  "construction",
] as const;

export type LeadImportType = (typeof LEAD_IMPORT_TYPES)[number];

export const LEAD_IMPORT_TYPE_LABELS: Record<LeadImportType, string> = {
  sales: "Sales Data",
  student_admission: "Student Admission",
  medical: "Medical Data",
  construction: "Construction Data",
};

export const LEAD_IMPORT_TYPE_TAGS: Record<LeadImportType, string> = {
  sales: "import:sales",
  student_admission: "import:student_admission",
  medical: "import:medical",
  construction: "import:construction",
};

export const LEAD_IMPORT_MODES = ["default", "unassigned", "single", "round_robin"] as const;
export type LeadImportAssignMode = (typeof LEAD_IMPORT_MODES)[number];

export interface LeadImportAssignmentSpec {
  mode: LeadImportAssignMode;
  ownerIds?: string[];
}

export const isLeadImportType = (value: unknown): value is LeadImportType =>
  typeof value === "string" && (LEAD_IMPORT_TYPES as readonly string[]).includes(value);

export const extractAllowedImportTypes = (config: unknown): LeadImportType[] => {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const cfg = config as Record<string, unknown>;
  const section =
    cfg.leadImport && typeof cfg.leadImport === "object" && !Array.isArray(cfg.leadImport)
      ? (cfg.leadImport as Record<string, unknown>)
      : null;
  const raw = section?.allowedTypes;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<LeadImportType>();
  for (const entry of raw) {
    if (isLeadImportType(entry)) seen.add(entry);
  }
  return Array.from(seen);
};

export const withAllowedImportTypes = (
  existingConfig: unknown,
  allowedTypes: LeadImportType[]
): Record<string, unknown> => {
  const base =
    existingConfig && typeof existingConfig === "object" && !Array.isArray(existingConfig)
      ? { ...(existingConfig as Record<string, unknown>) }
      : {};
  const existingLeadImport =
    base.leadImport && typeof base.leadImport === "object" && !Array.isArray(base.leadImport)
      ? { ...(base.leadImport as Record<string, unknown>) }
      : {};
  const deduped = Array.from(new Set(allowedTypes.filter(isLeadImportType)));
  return {
    ...base,
    leadImport: {
      ...existingLeadImport,
      allowedTypes: deduped,
    },
  };
};

const cleanStr = (val: unknown): string => (typeof val === "string" ? val.trim() : val == null ? "" : String(val).trim());

const pickFirst = (row: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const v = cleanStr(row[k]);
    if (v) return v;
  }
  return "";
};

const deriveCityFromAddress = (address: string): string => {
  if (!address) return "";
  const parts = address
    .split(/[\n,]/)
    .map((p) => p.replace(/\b\d{6}\b/g, "").trim())
    .filter((p) => p && !/^\d+$/.test(p));
  if (parts.length === 0) return "";
  // Prefer the last compact token when an address lists street, area, city.
  return parts[parts.length - 1].slice(0, 80);
};

export const normalizeExtraFieldsForType = (
  importType: LeadImportType | string | null | undefined,
  raw: unknown
): Record<string, string> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const allowKeys: Record<LeadImportType, string[]> = {
    sales: ["company_name", "cin", "director_name", "state", "activity"],
    student_admission: ["state_city", "exam", "percentage"],
    medical: ["business_name", "owner_name", "address"],
    construction: ["business_name", "owner_name", "address"],
  };

  const allowed = isLeadImportType(importType) ? allowKeys[importType] : null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (allowed && !allowed.includes(k)) continue;
    const text = cleanStr(v);
    if (text) out[k] = k === "cin" ? text.toUpperCase() : text;
  }
  return out;
};

export interface NormalizedImportedRow {
  name: string;
  hasIdentifier: boolean;
  email: string;
  phone: string;
  city: string;
  country: string;
  source: string;
  notes: string;
  tags: string[];
  extraFields: Record<string, string>;
}

const parseRowTags = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(cleanStr).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[;,|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

export const resolveImportedLeadRow = (
  importType: LeadImportType,
  raw: Record<string, unknown>
): NormalizedImportedRow => {
  const email = pickFirst(raw, ["email", "Email", "e-mail"]);
  const rawPhone = pickFirst(raw, [
    "phone",
    "mobile",
    "mobile_number",
    "mobileNumber",
    "Mobile",
    "Mobile Number",
    "Phone",
  ]);
  const phone = rawPhone ? normalizePhone(rawPhone) : "";
  const explicitCity = pickFirst(raw, ["city", "City"]);
  const country = pickFirst(raw, ["country", "Country"]) || "India";
  const source = pickFirst(raw, ["source", "Source"]) || "CSV Upload";
  const notes = pickFirst(raw, ["notes", "Notes", "remarks", "Remarks"]);
  const tags = parseRowTags(raw.tags ?? raw.Tags);

  if (importType === "sales") {
    const companyName = pickFirst(raw, ["company_name", "companyName", "Company Name", "company"]);
    const cin = pickFirst(raw, ["cin", "CIN"]).toUpperCase();
    const directorName = pickFirst(raw, [
      "director_name",
      "directorName",
      "Director Name",
      "director",
    ]);
    const state = pickFirst(raw, ["state", "State"]);
    const activity = pickFirst(raw, ["activity", "Activity"]);
    const rawName = pickFirst(raw, ["name", "Name"]);
    const primaryName = directorName || rawName || companyName;
    const extraFields: Record<string, string> = {};
    if (companyName) extraFields.company_name = companyName;
    if (cin) extraFields.cin = cin;
    if (directorName) extraFields.director_name = directorName;
    if (state) extraFields.state = state;
    if (activity) extraFields.activity = activity;

    return {
      name: primaryName || "Unknown",
      hasIdentifier: Boolean(primaryName || email || phone),
      email,
      phone,
      city: explicitCity || state,
      country,
      source,
      notes,
      tags,
      extraFields,
    };
  }

  if (importType === "student_admission") {
    const rawName = pickFirst(raw, ["name", "Name", "student_name", "studentName"]);
    const stateCity = pickFirst(raw, [
      "state_city",
      "stateCity",
      "State/City",
      "city",
      "City",
      "state",
    ]);
    const exam = pickFirst(raw, ["exam", "Exam"]);
    const percentage = pickFirst(raw, ["percentage", "Percentage", "marks"]);
    const extraFields: Record<string, string> = {};
    if (stateCity) extraFields.state_city = stateCity;
    if (exam) extraFields.exam = exam;
    if (percentage) extraFields.percentage = percentage;

    return {
      name: rawName || "Unknown",
      hasIdentifier: Boolean(rawName || email || phone),
      email,
      phone,
      city: stateCity || explicitCity,
      country,
      source,
      notes,
      tags,
      extraFields,
    };
  }

  // medical & construction share business_name, owner_name, email, address, mobile
  const businessName = pickFirst(raw, [
    "business_name",
    "businessName",
    "organization_name",
    "Business / Organization Name",
    "company_name",
    "company",
  ]);
  const ownerName = pickFirst(raw, [
    "owner_name",
    "ownerName",
    "person_name",
    "Owner / Person Name",
    "name",
    "Name",
  ]);
  const address = pickFirst(raw, ["address", "Address"]);
  const primaryName = ownerName || businessName;
  const extraFields: Record<string, string> = {};
  if (businessName) extraFields.business_name = businessName;
  if (ownerName) extraFields.owner_name = ownerName;
  if (address) extraFields.address = address;

  return {
    name: primaryName || "Unknown",
    hasIdentifier: Boolean(primaryName || email || phone),
    email,
    phone,
    city: explicitCity || deriveCityFromAddress(address),
    country,
    source,
    notes,
    tags,
    extraFields,
  };
};

export const getLeadAccountCandidate = (lead: {
  extra_fields?: unknown;
}): string | null => {
  if (!lead.extra_fields || typeof lead.extra_fields !== "object" || Array.isArray(lead.extra_fields)) {
    return null;
  }
  const fields = lead.extra_fields as Record<string, unknown>;
  const name = pickFirst(fields, ["company_name", "business_name"]);
  return name || null;
};
