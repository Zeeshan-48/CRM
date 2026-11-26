import { describe, expect, it } from "vitest";
import {
  extractAllowedImportTypes,
  getLeadAccountCandidate,
  normalizeExtraFieldsForType,
  resolveImportedLeadRow,
  withAllowedImportTypes,
} from "../../src/constants/lead-import.const";

describe("lead-import constants & row normalization", () => {
  it("extracts and updates allowed import types without clobbering existing config", () => {
    expect(extractAllowedImportTypes(null)).toEqual([]);
    expect(extractAllowedImportTypes({})).toEqual([]);

    const updated = withAllowedImportTypes(
      { currency: "INR", leadAssignment: { defaultStrategy: "ROUND_ROBIN" } },
      ["sales", "medical", "sales"]
    );
    expect(updated.currency).toBe("INR");
    expect(updated.leadAssignment).toEqual({ defaultStrategy: "ROUND_ROBIN" });
    expect(extractAllowedImportTypes(updated)).toEqual(["sales", "medical"]);
  });

  it("normalizes sales rows (MCA/company data)", () => {
    const row = resolveImportedLeadRow("sales", {
      company_name: "Northwind Systems Pvt Ltd",
      cin: "u72900mh2021ptc000101",
      email: "director@example.com",
      director_name: "Aarav Mehta",
      mobile: "9800000101",
      state: "Maharashtra",
      activity: "IT Services",
    });

    expect(row.name).toBe("Aarav Mehta");
    expect(row.hasIdentifier).toBe(true);
    expect(row.city).toBe("Maharashtra");
    expect(row.phone).toBe("+919800000101");
    expect(row.extraFields).toEqual({
      company_name: "Northwind Systems Pvt Ltd",
      cin: "U72900MH2021PTC000101",
      director_name: "Aarav Mehta",
      state: "Maharashtra",
      activity: "IT Services",
    });
  });

  it("normalizes student admission rows", () => {
    const row = resolveImportedLeadRow("student_admission", {
      name: "Riya Verma",
      mobile: "9800000201",
      email: "riya@example.com",
      state_city: "Rajasthan / Jaipur",
      exam: "NEET",
      percentage: "92.5%",
    });

    expect(row.name).toBe("Riya Verma");
    expect(row.city).toBe("Rajasthan / Jaipur");
    expect(row.extraFields).toEqual({
      state_city: "Rajasthan / Jaipur",
      exam: "NEET",
      percentage: "92.5%",
    });
  });

  it("normalizes medical and construction rows and extracts city & account candidate", () => {
    const med = resolveImportedLeadRow("medical", {
      business_name: "CarePlus Clinic",
      owner_name: "Dr. Ananya Rao",
      email: "clinic@example.com",
      address: "14 MG Road, Indiranagar, Bengaluru",
      mobile: "9800000301",
    });
    expect(med.name).toBe("Dr. Ananya Rao");
    expect(med.city).toBe("Bengaluru");
    expect(med.extraFields).toEqual({
      business_name: "CarePlus Clinic",
      owner_name: "Dr. Ananya Rao",
      address: "14 MG Road, Indiranagar, Bengaluru",
    });
    expect(getLeadAccountCandidate({ extra_fields: med.extraFields })).toBe("CarePlus Clinic");

    const con = resolveImportedLeadRow("construction", {
      business_name: "Apex Builders",
      mobile: "9800000401",
    });
    expect(con.name).toBe("Apex Builders");
    expect(getLeadAccountCandidate({ extra_fields: con.extraFields })).toBe("Apex Builders");
  });

  it("filters disallowed keys when normalizing extra fields per type", () => {
    expect(
      normalizeExtraFieldsForType("student_admission", {
        exam: "JEE",
        percentage: "91",
        cin: "SHOULD_BE_DROPPED",
      })
    ).toEqual({ exam: "JEE", percentage: "91" });
  });
});
