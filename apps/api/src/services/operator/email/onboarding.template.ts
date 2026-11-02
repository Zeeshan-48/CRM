import config from "../../../config";

export interface OnboardingEmailParams {
  adminName: string;
  adminEmail: string;
  tempPassword: string;
  workspaceName: string;
  workspaceSlug: string;
  planName: string;
  planKey: string;
  priceMonthly: number;
  currency: string;
  industry?: string | null;
  modules: string[];
  limits: { seats: number; leads: number; ai_credits_monthly: number };
  // When set, the email leads with a "complete your subscription" CTA to this
  // hosted checkout URL instead of the sign-in CTA (payment-upfront onboarding).
  checkoutUrl?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Minimal HTML escaping for user-supplied values rendered into the template.
const esc = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const MODULE_LABELS: Record<string, string> = {
  leads: "Leads",
  contacts: "Contacts",
  accounts: "Accounts",
  deals: "Deals",
  activities: "Activities",
  inbox: "Inbox",
  whatsapp: "WhatsApp",
  voice: "Voice",
  email: "Email",
  campaigns: "Campaigns",
  tickets: "Tickets",
  kb: "Knowledge Base",
  calendar: "Calendar",
  workflows: "Workflows",
  copilot: "Copilot",
  agents: "AI Agents",
  analytics: "Analytics",
  finance: "Finance",
  integrations: "Integrations",
  audit: "Audit",
};

const moduleLabel = (key: string): string =>
  MODULE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

const formatMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency || "INR"} ${amount.toLocaleString("en-IN")}`;
  }
};

const formatNumber = (value: number): string => value.toLocaleString("en-IN");

// Enterprise onboarding / welcome email. Table-based, inline-styled layout for
// broad email-client compatibility; monochrome palette to match the console.
export const renderOnboardingEmail = (params: OnboardingEmailParams): RenderedEmail => {
  const brand = config.BRAND_NAME;
  const loginUrl = config.CRM_APP_URL;
  // Single platform contact address = the default SES sender.
  const supportEmail = config.AWS_SES_FROM_EMAIL;
  const year = new Date().getUTCFullYear();

  const firstName = params.adminName.trim().split(/\s+/)[0] || params.adminName;
  const price = `${formatMoney(params.priceMonthly, params.currency)} / month`;
  const moduleNames = params.modules.map(moduleLabel);
  const moduleList = moduleNames.length ? moduleNames.join(", ") : "Core modules";

  // Payment-upfront onboarding: lead with the subscription CTA when a hosted
  // checkout URL is present; otherwise the plain sign-in CTA.
  const checkoutUrl = params.checkoutUrl ?? null;
  const ctaUrl = checkoutUrl ?? loginUrl;
  const ctaLabel = checkoutUrl ? "Complete your subscription" : "Sign in to your workspace";
  const introTail = checkoutUrl
    ? "To activate it, complete your subscription using the button below, your workspace opens as soon as the first payment is confirmed."
    : "You have been set up as the workspace administrator. Use the credentials below to sign in.";

  const subject = `Welcome to ${brand}: your ${params.workspaceName} workspace is ready`;

  const detailRow = (label: string, value: string): string => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #ececef;color:#6b7178;font-size:13px;">${esc(label)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #ececef;color:#18181b;font-size:13px;font-weight:600;text-align:right;">${value}</td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your ${esc(params.workspaceName)} workspace on ${esc(brand)} is ready. Sign-in details inside.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;font-family:Arial,Helvetica,'Segoe UI',sans-serif;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color:#0a0a0b;padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <span style="display:inline-block;width:34px;height:34px;background-color:#ffffff;color:#0a0a0b;border-radius:8px;text-align:center;line-height:34px;font-size:18px;font-weight:700;">E</span>
                  </td>
                  <td style="vertical-align:middle;padding-left:12px;">
                    <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:-0.2px;">${esc(brand)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 8px 0;color:#18181b;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Your workspace is ready</h1>
              <p style="margin:0 0 20px 0;color:#52525b;font-size:15px;line-height:1.6;">
                Hi ${esc(firstName)}, a new ${esc(brand)} workspace has been provisioned for
                <strong style="color:#18181b;">${esc(params.workspaceName)}</strong>. ${esc(introTail)}
              </p>
            </td>
          </tr>

          <!-- Credentials -->
          <tr>
            <td style="padding:0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafa;border:1px solid #e4e4e7;border-radius:10px;">
                <tr><td style="padding:18px 20px 4px 20px;color:#6b7178;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Your sign-in details</td></tr>
                <tr>
                  <td style="padding:8px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;color:#6b7178;font-size:13px;width:120px;">Email</td>
                        <td style="padding:6px 0;color:#18181b;font-size:13px;font-weight:600;font-family:'Courier New',monospace;">${esc(params.adminEmail)}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#6b7178;font-size:13px;">Temp password</td>
                        <td style="padding:6px 0;color:#18181b;font-size:13px;font-weight:600;font-family:'Courier New',monospace;">${esc(params.tempPassword)}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#6b7178;font-size:13px;">Workspace</td>
                        <td style="padding:6px 0;color:#18181b;font-size:13px;font-weight:600;font-family:'Courier New',monospace;">${esc(params.workspaceSlug)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:4px 20px 18px 20px;color:#92929a;font-size:12px;line-height:1.5;">For your security, please change this password right after your first sign-in.</td></tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background-color:#18181b;">
                    <a href="${esc(ctaUrl)}" target="_blank" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">${esc(ctaLabel)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0 0;color:#92929a;font-size:12px;">Or paste this link into your browser: <a href="${esc(ctaUrl)}" target="_blank" style="color:#52525b;">${esc(ctaUrl)}</a></p>
            </td>
          </tr>

          <!-- Plan details -->
          <tr>
            <td style="padding:0 32px 8px 32px;">
              <p style="margin:0 0 4px 0;color:#6b7178;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Your plan</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${detailRow("Plan", `${esc(params.planName)} (${esc(params.planKey)})`)}
                ${detailRow("Price", esc(price))}
                ${params.industry ? detailRow("Industry", esc(params.industry)) : ""}
                ${detailRow("Seats", formatNumber(params.limits.seats))}
                ${detailRow("Leads", formatNumber(params.limits.leads))}
                ${detailRow("AI credits", `${formatNumber(params.limits.ai_credits_monthly)} / month`)}
                ${detailRow("Modules", `${params.modules.length} enabled`)}
              </table>
              <p style="margin:12px 0 0 0;color:#52525b;font-size:12px;line-height:1.6;"><strong style="color:#18181b;">Included:</strong> ${esc(moduleList)}.</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 32px;border-top:1px solid #ececef;">
              <p style="margin:0 0 6px 0;color:#92929a;font-size:12px;line-height:1.6;">
                Need help getting started? Contact us at
                <a href="mailto:${esc(supportEmail)}" style="color:#52525b;">${esc(supportEmail)}</a>.
              </p>
              <p style="margin:0;color:#b4b4ba;font-size:11px;line-height:1.6;">
                This message was sent to ${esc(params.adminEmail)} because a workspace was created for you.<br />
                &copy; ${year} ${config.BRAND_NAME}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${brand}: your workspace is ready`,
    ``,
    `Hi ${firstName},`,
    ``,
    `A new ${brand} workspace has been provisioned for ${params.workspaceName}.`,
    `You have been set up as the workspace administrator.`,
    ``,
    `YOUR SIGN-IN DETAILS`,
    `  Email:         ${params.adminEmail}`,
    `  Temp password: ${params.tempPassword}`,
    `  Workspace:     ${params.workspaceSlug}`,
    ``,
    `For your security, please change this password right after your first sign-in.`,
    ``,
    checkoutUrl ? `Complete your subscription: ${checkoutUrl}` : `Sign in: ${loginUrl}`,
    ...(checkoutUrl
      ? [`(Your workspace activates once the first payment is confirmed.)`]
      : []),
    ``,
    `YOUR PLAN`,
    `  Plan:       ${params.planName} (${params.planKey})`,
    `  Price:      ${price}`,
    ...(params.industry ? [`  Industry:   ${params.industry}`] : []),
    `  Seats:      ${formatNumber(params.limits.seats)}`,
    `  Leads:      ${formatNumber(params.limits.leads)}`,
    `  AI credits: ${formatNumber(params.limits.ai_credits_monthly)} / month`,
    `  Modules:    ${params.modules.length} enabled (${moduleList})`,
    ``,
    `Need help? Contact ${supportEmail}.`,
    `(c) ${year} ${config.BRAND_NAME}`,
  ].join("\n");

  return { subject, html, text };
};
