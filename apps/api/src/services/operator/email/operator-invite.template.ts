import config from "../../../config";
import type { RenderedEmail } from "./onboarding.template";

export interface OperatorInviteParams {
  operatorName: string;
  operatorEmail: string;
  role: string;
  tempPassword: string;
}

// Minimal HTML escaping for user-supplied values rendered into the template.
const esc = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Invite email for a newly created platform operator, carrying the one-time
// temporary password. Mirrors the tenant team-invite template but is badged
// "Operator" to match the console. Table-based, inline-styled for email clients.
export const renderOperatorInviteEmail = (params: OperatorInviteParams): RenderedEmail => {
  const brand = config.BRAND_NAME;
  const supportEmail = config.AWS_SES_FROM_EMAIL;
  const signInUrl = `${config.OPERATOR_APP_URL}/login`;
  const year = new Date().getUTCFullYear();
  const firstName = params.operatorName.trim().split(/\s+/)[0] || params.operatorName;

  const subject = `Your ${brand} operator console account`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your operator console account is ready. Sign in with the temporary password inside.</div>
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
                    <span style="display:inline-block;margin-left:8px;padding:2px 8px;border:1px solid rgba(255,255,255,0.25);border-radius:5px;color:#d4d4d8;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Operator</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 8px 0;color:#18181b;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Your console account is ready</h1>
              <p style="margin:0 0 20px 0;color:#52525b;font-size:15px;line-height:1.6;">
                Hi ${esc(firstName)}, an account was created for you on the
                <strong style="color:#18181b;">${esc(brand)} operator console</strong> with the
                <strong style="color:#18181b;">${esc(params.role)}</strong> role. Sign in with the
                temporary password below, then change it from your profile.
              </p>
            </td>
          </tr>

          <!-- Credentials -->
          <tr>
            <td style="padding:0 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafa;border:1px solid #e4e4e7;border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px 0;color:#92929a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">Email</p>
                    <p style="margin:0 0 14px 0;color:#18181b;font-size:14px;font-family:'SF Mono',Consolas,monospace;">${esc(params.operatorEmail)}</p>
                    <p style="margin:0 0 4px 0;color:#92929a;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">Temporary password</p>
                    <p style="margin:0;color:#18181b;font-size:14px;font-family:'SF Mono',Consolas,monospace;letter-spacing:0.5px;">${esc(params.tempPassword)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:16px 32px 4px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background-color:#1d4ed8;">
                    <a href="${esc(signInUrl)}" target="_blank" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Sign in to the console</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0 0;color:#92929a;font-size:12px;line-height:1.6;">
                Change this password as soon as you sign in. Or paste this URL into your browser:<br />
                <a href="${esc(signInUrl)}" target="_blank" style="color:#52525b;word-break:break-all;">${esc(signInUrl)}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 32px;border-top:1px solid #ececef;">
              <p style="margin:0 0 6px 0;color:#92929a;font-size:12px;line-height:1.6;">
                Weren't expecting this? Let us know at
                <a href="mailto:${esc(supportEmail)}" style="color:#52525b;">${esc(supportEmail)}</a>.
              </p>
              <p style="margin:0;color:#b4b4ba;font-size:11px;line-height:1.6;">
                This message was sent to ${esc(params.operatorEmail)} because an operator console account was created for this address.<br />
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
    `${brand} operator console: your account is ready`,
    ``,
    `Hi ${firstName},`,
    ``,
    `An account was created for you on the ${brand} operator console with the ${params.role} role.`,
    ``,
    `Email: ${params.operatorEmail}`,
    `Temporary password: ${params.tempPassword}`,
    ``,
    `Sign in: ${signInUrl}`,
    ``,
    `Change this password as soon as you sign in.`,
    `Questions? Contact ${supportEmail}.`,
    `(c) ${year} ${config.BRAND_NAME}`,
  ].join("\n");

  return { subject, html, text };
};
