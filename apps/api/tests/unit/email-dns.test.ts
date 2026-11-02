import { describe, expect, it } from "vitest";
import {
  computeDnsRecords,
  isApexDomain,
  mailFromFor,
  mapDomainStatus,
  normalizeSubdomain,
} from "../../src/utils/email-dns";

describe("normalizeSubdomain", () => {
  it("lowercases and accepts a valid subdomain", () => {
    expect(normalizeSubdomain("  Mail.Example.COM ")).toBe("mail.example.com");
  });

  it("rejects empty and malformed values", () => {
    expect(() => normalizeSubdomain("")).toThrow();
    expect(() => normalizeSubdomain("not a domain")).toThrow();
    expect(() => normalizeSubdomain("foo")).toThrow();
  });

  it("flags apex vs subdomain", () => {
    expect(isApexDomain("example.com")).toBe(true);
    expect(isApexDomain("mail.example.com")).toBe(false);
  });
});

describe("computeDnsRecords", () => {
  it("emits one CNAME per DKIM token plus MX, two SPF and DMARC", () => {
    const records = computeDnsRecords("mail.example.com", ["t1", "t2", "t3"], "us-east-1");
    expect(records.filter((r) => r.purpose === "DKIM")).toHaveLength(3);
    const purposes = records.map((r) => r.purpose);
    expect(purposes).toContain("MAIL_FROM_MX");
    expect(purposes).toContain("MAIL_FROM_SPF");
    expect(purposes).toContain("SENDING_SPF");
    expect(purposes).toContain("DMARC");

    const mx = records.find((r) => r.purpose === "MAIL_FROM_MX");
    expect(mx?.name).toBe(mailFromFor("mail.example.com"));
    expect(mx?.value).toBe("feedback-smtp.us-east-1.amazonses.com");
    expect(mx?.priority).toBe(10);
  });
});

describe("mapDomainStatus", () => {
  it("verifies when both DKIM and MAIL FROM succeed", () => {
    expect(mapDomainStatus("SUCCESS", "SUCCESS", 0)).toBe("VERIFIED");
  });

  it("stays pending while in progress, and within the 24h grace even if failed", () => {
    expect(mapDomainStatus("PENDING", "PENDING", 0)).toBe("PENDING");
    expect(mapDomainStatus("FAILED", "PENDING", 60_000)).toBe("PENDING");
  });

  it("fails only after the 24h grace", () => {
    const past = 25 * 60 * 60 * 1000;
    expect(mapDomainStatus("FAILED", "PENDING", past)).toBe("FAILED");
  });
});
