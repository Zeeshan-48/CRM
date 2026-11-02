import { email_domain_status } from "../db/enums";

export interface DnsRecord {
  type: "CNAME" | "MX" | "TXT";
  name: string;
  value: string;
  purpose: string;
  priority?: number;
}

const SUBDOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// Lowercase + structural validation. Returns the normalized value or throws a
// message the caller turns into a BadRequestError.
export const normalizeSubdomain = (raw: string): string => {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) throw new Error("Domain is required");
  if (value.length > 253) throw new Error("Domain is too long");
  if (!SUBDOMAIN_RE.test(value)) throw new Error("Enter a valid domain (e.g. mail.example.com)");
  return value;
};

// True when the domain has no subdomain label (apex, e.g. example.com). We
// allow it but the UI warns, since a dedicated subdomain is recommended.
export const isApexDomain = (subdomain: string): boolean => subdomain.split(".").length === 2;

export const mailFromFor = (subdomain: string): string => `bounce.${subdomain}`;

// The DNS records the tenant must publish: DKIM CNAMEs, custom MAIL FROM
// MX + SPF, sending SPF, and a starter DMARC policy.
export const computeDnsRecords = (
  subdomain: string,
  dkimTokens: string[],
  region: string
): DnsRecord[] => {
  const mailFrom = mailFromFor(subdomain);
  return [
    ...dkimTokens.map((t) => ({
      type: "CNAME" as const,
      name: `${t}._domainkey.${subdomain}`,
      value: `${t}.dkim.amazonses.com`,
      purpose: "DKIM",
    })),
    {
      type: "MX" as const,
      name: mailFrom,
      value: `feedback-smtp.${region}.amazonses.com`,
      priority: 10,
      purpose: "MAIL_FROM_MX",
    },
    {
      type: "TXT" as const,
      name: mailFrom,
      value: '"v=spf1 include:amazonses.com ~all"',
      purpose: "MAIL_FROM_SPF",
    },
    {
      type: "TXT" as const,
      name: subdomain,
      value: '"v=spf1 include:amazonses.com ~all"',
      purpose: "SENDING_SPF",
    },
    {
      type: "TXT" as const,
      name: `_dmarc.${subdomain}`,
      value: `"v=DMARC1; p=none; rua=mailto:dmarc-reports@${subdomain}"`,
      purpose: "DMARC",
    },
  ];
};

const VERIFY_GRACE_MS = 24 * 60 * 60 * 1000;

// Map SES DKIM + MAIL FROM statuses to our domain status. FAILED only after a
// 24h grace so a slow DNS propagation does not prematurely fail the domain.
export const mapDomainStatus = (
  dkimStatus: string | null,
  mailFromStatus: string | null,
  ageMs: number
): email_domain_status => {
  if (dkimStatus === "SUCCESS" && mailFromStatus === "SUCCESS") return "VERIFIED";
  if ((dkimStatus === "FAILED" || mailFromStatus === "FAILED") && ageMs > VERIFY_GRACE_MS) {
    return "FAILED";
  }
  return "PENDING";
};
