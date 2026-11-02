import config from "../../config";

export interface TeamInviteEmailParams {
  memberName: string;
  memberEmail: string;
  tempPassword: string;
  workspaceName: string;
  roleLabel: string;
  // Optional: the admin who sent the invite (rendered in the intro line).
  inviterName?: string | null;
  loginUrl: string;
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

// Team-member invitation email. Table-based, inline-styled layout for broad
// email-client compatibility; monochrome palette to match the workspace shell.
// Mirrors the operator onboarding template so the two feel like one product.
export const renderTeamInviteEmail = (params: TeamInviteEmailParams): RenderedEmail => {
  const brand = config.BRAND_NAME;
  // Single platform contact address = the default SES sender.
  const supportEmail = config.AWS_SES_FROM_EMAIL;
  const loginUrl = params.loginUrl;
  const year = new Date().getUTCFullYear();

  const firstName = params.memberName.trim().split(/\s+/)[0] || params.memberName;
  const invitedBy = params.inviterName?.trim()
    ? `${esc(params.inviterName.trim())} added you to`
    : "You have been added to";
  const invitedByText = params.inviterName?.trim()
    ? `${params.inviterName.trim()} added you to`
    : "You have been added to";

  const subject = `You've been added to ${params.workspaceName} on ${brand}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your account on ${esc(params.workspaceName)} is ready. Sign-in details inside.</div>
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
              <h1 style="margin:0 0 8px 0;color:#18181b;font-size:22px;font-weight:700;letter-spacing:-0.3px;">You're on the team</h1>
              <p style="margin:0 0 20px 0;color:#52525b;font-size:15px;line-height:1.6;">
                Hi ${esc(firstName)}, ${invitedBy}
                <strong style="color:#18181b;">${esc(params.workspaceName)}</strong> as
                <strong style="color:#18181b;">${esc(params.roleLabel)}</strong>. Use the credentials
                below to sign in.
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
                        <td style="padding:6px 0;color:#18181b;font-size:13px;font-weight:600;font-family:'Courier New',monospace;">${esc(params.memberEmail)}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#6b7178;font-size:13px;">Temp password</td>
                        <td style="padding:6px 0;color:#18181b;font-size:13px;font-weight:600;font-family:'Courier New',monospace;">${esc(params.tempPassword)}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#6b7178;font-size:13px;">Role</td>
                        <td style="padding:6px 0;color:#18181b;font-size:13px;font-weight:600;font-family:'Courier New',monospace;">${esc(params.roleLabel)}</td>
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
                Not expecting this invitation? You can safely ignore this email, or reach us at
                <a href="mailto:${esc(supportEmail)}" style="color:#52525b;">${esc(supportEmail)}</a>.
              </p>
              <p style="margin:0;color:#b4b4ba;font-size:11px;line-height:1.6;">
                This message was sent to ${esc(params.memberEmail)} because an account was created for you on ${esc(params.workspaceName)}.<br />
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
    `${brand}: you've been added to ${params.workspaceName}`,
    ``,
    `Hi ${firstName},`,
    ``,
    `${invitedByText} ${params.workspaceName} as ${params.roleLabel}.`,
    ``,
    `YOUR SIGN-IN DETAILS`,
    `  Email:         ${params.memberEmail}`,
    `  Temp password: ${params.tempPassword}`,
    `  Role:          ${params.roleLabel}`,
    ``,
    `For your security, please change this password right after your first sign-in.`,
    ``,
    `Sign in: ${loginUrl}`,
    ``,
    `Not expecting this? You can ignore this email, or contact ${supportEmail}.`,
    `(c) ${year} ${config.BRAND_NAME}`,
  ].join("\n");

  return { subject, html, text };
};
