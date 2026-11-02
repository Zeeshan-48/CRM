import config from "../../config";
import type { RenderedEmail } from "./team-invite.template";

export interface PasswordResetEmailParams {
  memberName: string;
  memberEmail: string;
  tempPassword: string;
  workspaceName: string;
  // Optional: the admin who performed the reset (rendered in the intro line).
  resetByName?: string | null;
  loginUrl: string;
}

// Minimal HTML escaping for user-supplied values rendered into the template.
const esc = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Admin-initiated password-reset email. Mirrors the team-invite template so the
// two feel like one product; table-based, inline-styled layout for broad
// email-client compatibility.
export const renderPasswordResetEmail = (params: PasswordResetEmailParams): RenderedEmail => {
  const brand = config.BRAND_NAME;
  // Single platform contact address = the default SES sender.
  const supportEmail = config.AWS_SES_FROM_EMAIL;
  const loginUrl = params.loginUrl;
  const year = new Date().getUTCFullYear();

  const firstName = params.memberName.trim().split(/\s+/)[0] || params.memberName;
  const resetBy = params.resetByName?.trim()
    ? `${esc(params.resetByName.trim())} reset your password for`
    : "Your password has been reset for";
  const resetByText = params.resetByName?.trim()
    ? `${params.resetByName.trim()} reset your password for`
    : "Your password has been reset for";

  const subject = `Your ${params.workspaceName} password was reset`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your password on ${esc(params.workspaceName)} was reset. New sign-in details inside.</div>
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
              <h1 style="margin:0 0 8px 0;color:#18181b;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Your password was reset</h1>
              <p style="margin:0 0 20px 0;color:#52525b;font-size:15px;line-height:1.6;">
                Hi ${esc(firstName)}, ${resetBy}
                <strong style="color:#18181b;">${esc(params.workspaceName)}</strong>. Use the new
                temporary password below to sign in.
              </p>
            </td>
          </tr>

          <!-- Credentials -->
          <tr>
            <td style="padding:0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafa;border:1px solid #e4e4e7;border-radius:10px;">
                <tr><td style="padding:18px 20px 4px 20px;color:#6b7178;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Your new sign-in details</td></tr>
                <tr>
                  <td style="padding:8px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;color:#6b7178;font-size:13px;width:120px;">Email</td>
                        <td style="padding:6px 0;color:#18181b;font-size:13px;font-weight:600;font-family:'Courier New',monospace;">${esc(params.memberEmail)}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#6b7178;font-size:13px;">New password</td>
                        <td style="padding:6px 0;color:#18181b;font-size:13px;font-weight:600;font-family:'Courier New',monospace;">${esc(params.tempPassword)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:4px 20px 18px 20px;color:#92929a;font-size:12px;line-height:1.5;">For your security, please change this password right after you sign in.</td></tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background-color:#18181b;">
                    <a href="${esc(loginUrl)}" target="_blank" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Sign in</a>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0 0;color:#92929a;font-size:12px;">Or paste this link into your browser: <a href="${esc(loginUrl)}" target="_blank" style="color:#52525b;">${esc(loginUrl)}</a></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 32px;border-top:1px solid #ececef;">
              <p style="margin:0 0 6px 0;color:#92929a;font-size:12px;line-height:1.6;">
                Didn't expect this? If you did not request a reset, contact your workspace admin or reach us at
                <a href="mailto:${esc(supportEmail)}" style="color:#52525b;">${esc(supportEmail)}</a>.
              </p>
              <p style="margin:0;color:#b4b4ba;font-size:11px;line-height:1.6;">
                This message was sent to ${esc(params.memberEmail)} because your password on ${esc(params.workspaceName)} was reset.<br />
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
    `${brand}: your ${params.workspaceName} password was reset`,
    ``,
    `Hi ${firstName},`,
    ``,
    `${resetByText} ${params.workspaceName}.`,
    ``,
    `YOUR NEW SIGN-IN DETAILS`,
    `  Email:        ${params.memberEmail}`,
    `  New password: ${params.tempPassword}`,
    ``,
    `For your security, please change this password right after you sign in.`,
    ``,
    `Sign in: ${loginUrl}`,
    ``,
    `Didn't expect this? Contact your workspace admin or ${supportEmail}.`,
    `(c) ${year} ${config.BRAND_NAME}`,
  ].join("\n");

  return { subject, html, text };
};
