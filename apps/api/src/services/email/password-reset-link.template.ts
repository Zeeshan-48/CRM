import config from "../../config";
import type { RenderedEmail } from "./team-invite.template";

export interface PasswordResetLinkEmailParams {
  memberName: string;
  memberEmail: string;
  workspaceName: string;
  // The one-time reset URL ({CRM_APP_URL}/reset-password?token=...).
  resetUrl: string;
  // How long the link stays valid, rendered in the body (e.g. "1 hour").
  expiresIn: string;
}

// Minimal HTML escaping for user-supplied values rendered into the template.
const esc = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Self-service "forgot password" email, carries a one-time reset LINK (not a
// temporary password). Mirrors the other transactional templates so the suite
// feels like one product; table-based, inline-styled for broad client support.
export const renderPasswordResetLinkEmail = (
  params: PasswordResetLinkEmailParams
): RenderedEmail => {
  const brand = config.BRAND_NAME;
  const supportEmail = config.AWS_SES_FROM_EMAIL;
  const resetUrl = params.resetUrl;
  const year = new Date().getUTCFullYear();
  const firstName = params.memberName.trim().split(/\s+/)[0] || params.memberName;

  const subject = `Reset your ${params.workspaceName} password`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Reset your ${esc(params.workspaceName)} password. This link expires in ${esc(params.expiresIn)}.</div>
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
              <h1 style="margin:0 0 8px 0;color:#18181b;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Reset your password</h1>
              <p style="margin:0 0 20px 0;color:#52525b;font-size:15px;line-height:1.6;">
                Hi ${esc(firstName)}, we received a request to reset the password for your
                <strong style="color:#18181b;">${esc(params.workspaceName)}</strong> account. Click the
                button below to choose a new password.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:8px 32px 4px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background-color:#1d4ed8;">
                    <a href="${esc(resetUrl)}" target="_blank" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Reset password</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0 0;color:#92929a;font-size:12px;line-height:1.6;">
                This link expires in ${esc(params.expiresIn)} and can be used once. Or paste this URL into your browser:<br />
                <a href="${esc(resetUrl)}" target="_blank" style="color:#52525b;word-break:break-all;">${esc(resetUrl)}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 32px;border-top:1px solid #ececef;">
              <p style="margin:0 0 6px 0;color:#92929a;font-size:12px;line-height:1.6;">
                Didn't request this? You can safely ignore this email, your password won't change. If you're
                concerned, reach us at
                <a href="mailto:${esc(supportEmail)}" style="color:#52525b;">${esc(supportEmail)}</a>.
              </p>
              <p style="margin:0;color:#b4b4ba;font-size:11px;line-height:1.6;">
                This message was sent to ${esc(params.memberEmail)} because a password reset was requested for ${esc(params.workspaceName)}.<br />
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
    `${brand}: reset your ${params.workspaceName} password`,
    ``,
    `Hi ${firstName},`,
    ``,
    `We received a request to reset the password for your ${params.workspaceName} account.`,
    `Open the link below to choose a new password. It expires in ${params.expiresIn} and can be used once.`,
    ``,
    `Reset password: ${resetUrl}`,
    ``,
    `Didn't request this? You can safely ignore this email, your password won't change.`,
    `Questions? Contact ${supportEmail}.`,
    `(c) ${year} ${config.BRAND_NAME}`,
  ].join("\n");

  return { subject, html, text };
};
