import type { BulkLeadRow, Lead, SkippedImportRow } from "@/lib/api/leads";
import type { LeadImportType } from "@/types";

export interface ImportFieldDef {
  key: string;
  label: string;
  identifier?: boolean;
  aliases: string[];
}

export interface ImportPreset {
  key: LeadImportType;
  label: string;
  subtitle: string;
  fields: ImportFieldDef[];
  sampleFilename: string;
  sampleRows: Record<string, string>[];
  pastePlaceholder: string;
}

const UTILITY_FIELDS: ImportFieldDef[] = [
  { key: "source", label: "Source", aliases: ["source", "lead source", "channel", "campaign"] },
  { key: "tags", label: "Tags", aliases: ["tags", "tag", "labels"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "remarks", "comment", "comments"] },
];

export const LEAD_IMPORT_PRESETS: Record<LeadImportType, ImportPreset> = {
  sales: {
    key: "sales",
    label: "Sales Data",
    subtitle: "Company Name, CIN, Email, Director Name, Mobile Number, State & Activity",
    sampleFilename: "sales-data-template.xlsx",
    fields: [
      {
        key: "company_name",
        label: "Company Name",
        identifier: true,
        aliases: ["company name", "company", "firm name", "entity name", "organization name", "organization"],
      },
      {
        key: "cin",
        label: "CIN",
        aliases: ["cin", "cin number", "cin no", "corporate identification number"],
      },
      {
        key: "email",
        label: "Email",
        identifier: true,
        aliases: ["email", "e-mail", "email address", "mail", "official email", "company email"],
      },
      {
        key: "director_name",
        label: "Director Name",
        identifier: true,
        aliases: ["director name", "director", "name", "contact person", "contact name", "full name"],
      },
      {
        key: "mobile",
        label: "Mobile Number",
        identifier: true,
        aliases: [
          "mobile number",
          "mobile",
          "mobile no",
          "mob",
          "mob no",
          "phone",
          "phone number",
          "contact",
          "contact number",
          "cell",
        ],
      },
      {
        key: "state",
        label: "State",
        aliases: ["state", "satate", "region", "city", "location"],
      },
      {
        key: "activity",
        label: "Activity",
        aliases: ["activity", "business activity", "nic activity", "industry", "sector", "description"],
      },
    ],
    sampleRows: [
      {
        "Company Name": "Northwind Systems Pvt Ltd",
        CIN: "U72900MH2021PTC000101",
        Email: "director@northwind.example.com",
        "Director Name": "Aarav Mehta",
        "Mobile Number": "9800000101",
        State: "Maharashtra",
        Activity: "IT & Software Services",
      },
      {
        "Company Name": "Deccan Precision Ltd",
        CIN: "U29100KA2020PTC000202",
        Email: "contact@deccan.example.org",
        "Director Name": "Kavita Nair",
        "Mobile Number": "9800000102",
        State: "Karnataka",
        Activity: "Industrial Manufacturing",
      },
    ],
    pastePlaceholder:
      "Company Name,CIN,Email,Director Name,Mobile Number,State,Activity\nNorthwind Systems Pvt Ltd,U72900MH2021PTC000101,director@northwind.example.com,Aarav Mehta,9800000101,Maharashtra,IT Services",
  },
  student_admission: {
    key: "student_admission",
    label: "Student Admission",
    subtitle: "Name, Mobile, Email, State/City, Exam & Percentage",
    sampleFilename: "student-admission-template.xlsx",
    fields: [
      {
        key: "name",
        label: "Name",
        identifier: true,
        aliases: ["name", "student name", "full name", "candidate name", "student"],
      },
      {
        key: "mobile",
        label: "Mobile",
        identifier: true,
        aliases: [
          "mobile",
          "mobile number",
          "mobile no",
          "mob",
          "phone",
          "phone number",
          "parent mobile",
          "parent phone",
          "contact",
          "contact number",
        ],
      },
      {
        key: "email",
        label: "Email",
        identifier: true,
        aliases: ["email", "e-mail", "email address", "mail", "student email"],
      },
      {
        key: "state_city",
        label: "State/City",
        aliases: ["state/city", "state city", "city", "state", "location", "district", "place", "town"],
      },
      {
        key: "exam",
        label: "Exam",
        aliases: ["exam", "entrance exam", "course", "test", "stream", "program", "board"],
      },
      {
        key: "percentage",
        label: "Percentage",
        aliases: ["percentage", "%", "percent", "marks", "score", "cgpa", "grade"],
      },
    ],
    sampleRows: [
      {
        Name: "Riya Verma",
        Mobile: "9800000201",
        Email: "riya.student@example.com",
        "State/City": "Rajasthan / Jaipur",
        Exam: "NEET",
        Percentage: "92.5%",
      },
      {
        Name: "Aman Kulkarni",
        Mobile: "9800000202",
        Email: "aman.admission@example.org",
        "State/City": "Maharashtra / Pune",
        Exam: "JEE Main",
        Percentage: "88.0%",
      },
    ],
    pastePlaceholder:
      "Name,Mobile,Email,State/City,Exam,Percentage\nRiya Verma,9800000201,riya.student@example.com,Rajasthan / Jaipur,NEET,92.5%",
  },
  medical: {
    key: "medical",
    label: "Medical Data",
    subtitle: "Business / Organization Name, Owner / Person Name, Email, Address & Mobile",
    sampleFilename: "medical-data-template.xlsx",
    fields: [
      {
        key: "business_name",
        label: "Business / Organization Name",
        identifier: true,
        aliases: [
          "business / organization name",
          "business name",
          "organization name",
          "org name",
          "clinic name",
          "hospital name",
          "pharmacy name",
          "lab name",
          "company name",
          "organization",
          "business",
        ],
      },
      {
        key: "owner_name",
        label: "Owner / Person Name",
        identifier: true,
        aliases: [
          "owner / person name",
          "owner /person name",
          "owner name",
          "person name",
          "doctor name",
          "contact person",
          "name",
          "full name",
          "owner",
        ],
      },
      {
        key: "email",
        label: "Email",
        identifier: true,
        aliases: ["email", "e-mail", "email address", "mail"],
      },
      {
        key: "address",
        label: "Address",
        aliases: ["address", "full address", "clinic address", "location", "city", "area"],
      },
      {
        key: "mobile",
        label: "Mobile",
        identifier: true,
        aliases: ["mobile", "mobile number", "mobile no", "mob", "phone", "phone number", "contact", "contact number"],
      },
    ],
    sampleRows: [
      {
        "Business / Organization Name": "CarePlus Diagnostic Clinic",
        "Owner / Person Name": "Dr. Ananya Rao",
        Email: "careplus@example.com",
        Address: "14 MG Road, Indiranagar, Bengaluru",
        Mobile: "9800000301",
      },
      {
        "Business / Organization Name": "Lifeline Pharmacy & Labs",
        "Owner / Person Name": "Suresh Menon",
        Email: "lifeline@example.org",
        Address: "42 Park Street, Kolkata",
        Mobile: "9800000302",
      },
    ],
    pastePlaceholder:
      "Business / Organization Name,Owner / Person Name,Email,Address,Mobile\nCarePlus Diagnostic Clinic,Dr. Ananya Rao,careplus@example.com,MG Road Bengaluru,9800000301",
  },
  construction: {
    key: "construction",
    label: "Construction Data",
    subtitle: "Business / Organization Name, Owner / Person Name, Email, Address & Mobile",
    sampleFilename: "construction-data-template.xlsx",
    fields: [
      {
        key: "business_name",
        label: "Business / Organization Name",
        identifier: true,
        aliases: [
          "business / organization name",
          "business name",
          "organization name",
          "org name",
          "company name",
          "builder name",
          "firm name",
          "contractor name",
          "organization",
          "business",
        ],
      },
      {
        key: "owner_name",
        label: "Owner / Person Name",
        identifier: true,
        aliases: [
          "owner / person name",
          "owner /person name",
          "owner name",
          "person name",
          "contact person",
          "name",
          "full name",
          "owner",
        ],
      },
      {
        key: "email",
        label: "Email",
        identifier: true,
        aliases: ["email", "e-mail", "email address", "mail"],
      },
      {
        key: "address",
        label: "Address",
        aliases: ["address", "full address", "site address", "office address", "location", "city"],
      },
      {
        key: "mobile",
        label: "Mobile",
        identifier: true,
        aliases: ["mobile", "mobile number", "mobile no", "mob", "phone", "phone number", "contact", "contact number"],
      },
    ],
    sampleRows: [
      {
        "Business / Organization Name": "Apex Infra Builders",
        "Owner / Person Name": "Rajesh Tiwari",
        Email: "projects@apexinfra.example.com",
        Address: "Plot 18, Ring Road, Nagpur",
        Mobile: "9800000401",
      },
      {
        "Business / Organization Name": "Metro Civil Contractors",
        "Owner / Person Name": "Vikram Joshi",
        Email: "info@metrobuild.example.org",
        Address: "Sector 62, Noida",
        Mobile: "9800000402",
      },
    ],
    pastePlaceholder:
      "Business / Organization Name,Owner / Person Name,Email,Address,Mobile\nApex Infra Builders,Rajesh Tiwari,projects@apexinfra.example.com,Plot 18 Ring Road Nagpur,9800000401",
  },
};

export const IMPORT_TYPE_LABELS: Record<LeadImportType, string> = {
  sales: "Sales Data",
  student_admission: "Student Admission",
  medical: "Medical Data",
  construction: "Construction Data",
};

export interface ParsedSheet {
  name: string;
  grid: string[][];
}

export const getMappableFields = (preset: ImportPreset): ImportFieldDef[] => [
  ...preset.fields,
  ...UTILITY_FIELDS,
];

const normHeader = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

/** Normalizes numbers exported by Excel (e.g. scientific notation or trailing .0) safely. */
export const cleanSpreadsheetCell = (val: unknown): string => {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "";
    // Preserve integer precision without scientific notation when possible
    if (Math.abs(val) >= 1e7 && Number.isInteger(val)) {
      return val.toFixed(0);
    }
    return String(val).trim();
  }
  const str = String(val).trim();
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(str)) {
    const parsed = Number(str);
    if (Number.isFinite(parsed) && parsed > 0) return parsed.toFixed(0);
  }
  if (/^\d+\.0+$/.test(str)) {
    return str.replace(/\.0+$/, "");
  }
  return str;
};

/** RFC-4180 CSV/TSV parser handling BOM, quoted commas/newlines, and escaped quotes. */
export const parseDelimitedText = (input: string): string[][] => {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    firstLine.includes("\t") && firstLine.split("\t").length > firstLine.split(",").length
      ? "\t"
      : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(cleanSpreadsheetCell(field));
      field = "";
    } else if (c === "\n") {
      row.push(cleanSpreadsheetCell(field));
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  row.push(cleanSpreadsheetCell(field));
  rows.push(row);
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
};

export const parseSpreadsheetFile = async (file: File): Promise<ParsedSheet[]> => {
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", raw: true });
    const sheets: ParsedSheet[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        blankrows: false,
      });
      const grid = rawRows
        .map((row) => (Array.isArray(row) ? row.map(cleanSpreadsheetCell) : []))
        .filter((row) => row.some((cell) => cell !== ""));
      if (grid.length > 0) sheets.push({ name: sheetName, grid });
    }
    if (sheets.length === 0) {
      throw new Error("That Excel workbook appears to be empty.");
    }
    return sheets;
  }

  const text = await file.text();
  const grid = parseDelimitedText(text);
  if (grid.length === 0) {
    throw new Error("The file contains no readable rows.");
  }
  return [{ name: "Sheet1", grid }];
};

/** Finds which top row (0..4) looks most like the column header row. */
export const detectHeaderRowIndex = (grid: string[][], preset: ImportPreset): number => {
  const fields = getMappableFields(preset);
  let bestIdx = 0;
  let bestScore = -1;
  const maxCheck = Math.min(5, grid.length);
  for (let r = 0; r < maxCheck; r++) {
    const cells = grid[r].map(normHeader);
    let score = 0;
    for (const cell of cells) {
      if (!cell) continue;
      if (fields.some((f) => f.aliases.includes(cell) || normHeader(f.label) === cell)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }
  return bestScore > 0 ? bestIdx : 0;
};

const sniffFieldFromSamples = (
  samples: string[],
  availableKeys: Set<string>
): string | null => {
  const nonEmpty = samples.map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (nonEmpty.length === 0) return null;

  if (
    availableKeys.has("email") &&
    nonEmpty.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
  ) {
    return "email";
  }
  if (
    availableKeys.has("cin") &&
    nonEmpty.some((v) => /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/i.test(v))
  ) {
    return "cin";
  }
  if (
    availableKeys.has("mobile") &&
    nonEmpty.every((v) => {
      const digits = v.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 13;
    })
  ) {
    return "mobile";
  }
  return null;
};

/** Maps each spreadsheet column index -> target field key (or null = Skip). */
export const autoMapColumns = (
  headers: string[],
  sampleRows: string[][],
  preset: ImportPreset
): (string | null)[] => {
  const fields = getMappableFields(preset);
  const usedKeys = new Set<string>();
  const mapped: (string | null)[] = headers.map((raw) => {
    const normalized = normHeader(raw);
    if (!normalized) return null;
    for (const f of fields) {
      if (usedKeys.has(f.key)) continue;
      if (normHeader(f.label) === normalized || f.aliases.includes(normalized)) {
        usedKeys.add(f.key);
        return f.key;
      }
    }
    return null;
  });

  // Second pass: sniff unmapped columns from data patterns
  const available = new Set(fields.map((f) => f.key).filter((k) => !usedKeys.has(k)));
  headers.forEach((_, idx) => {
    if (mapped[idx]) return;
    const colSamples = sampleRows.map((row) => row[idx] ?? "");
    const guessed = sniffFieldFromSamples(colSamples, available);
    if (guessed) {
      mapped[idx] = guessed;
      available.delete(guessed);
      usedKeys.add(guessed);
    }
  });

  return mapped;
};

export interface CompiledImportPreview {
  readyRows: BulkLeadRow[];
  skippedRows: SkippedImportRow[];
  inFileDuplicates: number;
  invalidCount: number;
}

const normalizePhoneKey = (raw: string): string => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
};

export const compileMappedImportRows = (
  grid: string[][],
  headerRowIndex: number,
  columnMapping: (string | null)[],
  preset: ImportPreset,
  skipDuplicates: boolean
): CompiledImportPreview => {
  const dataRows = grid.slice(headerRowIndex + 1);
  const readyRows: BulkLeadRow[] = [];
  const skippedRows: SkippedImportRow[] = [];
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  let inFileDuplicates = 0;
  let invalidCount = 0;

  dataRows.forEach((rawCells, i) => {
    const rowNumber = headerRowIndex + 2 + i;
    const rowObj: BulkLeadRow = {};

    columnMapping.forEach((targetKey, colIdx) => {
      if (!targetKey) return;
      const cellVal = cleanSpreadsheetCell(rawCells[colIdx]);
      if (!cellVal) return;
      if (targetKey === "tags") {
        rowObj.tags = cellVal
          .split(/[;,|]/)
          .map((t) => t.trim())
          .filter(Boolean);
      } else {
        rowObj[targetKey] = targetKey === "cin" ? cellVal.toUpperCase() : cellVal;
      }
    });

    const email = typeof rowObj.email === "string" ? rowObj.email.trim() : "";
    const mobile =
      typeof rowObj.mobile === "string"
        ? rowObj.mobile.trim()
        : typeof rowObj.phone === "string"
          ? rowObj.phone.trim()
          : "";
    const primaryText =
      preset.key === "sales"
        ? String(rowObj.director_name || rowObj.company_name || rowObj.name || "").trim()
        : preset.key === "student_admission"
          ? String(rowObj.name || "").trim()
          : String(rowObj.owner_name || rowObj.business_name || rowObj.name || "").trim();

    if (!primaryText && !email && !mobile) {
      invalidCount++;
      skippedRows.push({
        rowNumber,
        name: "",
        email: "",
        phone: "",
        reason: "Missing required identifier (Name / Email / Mobile)",
      });
      return;
    }

    const emailKey = email.toLowerCase();
    const phoneKey = mobile ? normalizePhoneKey(mobile) : "";
    const isDup =
      (Boolean(emailKey) && seenEmails.has(emailKey)) ||
      (Boolean(phoneKey) && seenPhones.has(phoneKey));

    if (skipDuplicates && isDup) {
      inFileDuplicates++;
      skippedRows.push({
        rowNumber,
        name: primaryText,
        email,
        phone: mobile,
        reason: "Duplicate email or mobile inside spreadsheet",
      });
      return;
    }

    if (emailKey) seenEmails.add(emailKey);
    if (phoneKey) seenPhones.add(phoneKey);
    readyRows.push(rowObj);
  });

  return { readyRows, skippedRows, inFileDuplicates, invalidCount };
};

export const downloadSampleTemplate = async (preset: ImportPreset): Promise<void> => {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(preset.sampleRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, preset.label.slice(0, 31));
  XLSX.writeFile(wb, preset.sampleFilename);
};

export const downloadSkippedImportCsv = (rows: SkippedImportRow[], filename = "skipped-leads.csv"): void => {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Row Number", "Name", "Email", "Mobile/Phone", "Skip Reason"].map(esc).join(",")];
  for (const r of rows) {
    lines.push([r.rowNumber, r.name, r.email, r.phone, r.reason].map(esc).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/** Compact vertical summary shown underneath lead.name in the Leads table. */
export const getLeadVerticalSubtitle = (lead: Lead): string | null => {
  const extra = lead.extra_fields;
  if (!extra || typeof extra !== "object") return null;

  if (lead.import_type === "sales") {
    const parts = [extra.company_name, extra.cin, extra.state].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (lead.import_type === "student_admission") {
    const parts = [
      extra.exam,
      extra.percentage ? `${extra.percentage}${String(extra.percentage).endsWith("%") ? "" : "%"}` : "",
      extra.state_city,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (lead.import_type === "medical" || lead.import_type === "construction") {
    const parts = [extra.business_name, extra.address].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
};
