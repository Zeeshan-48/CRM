// Renders a plain-text email body into a polished, email-client-safe branded
// HTML document (table-based layout, inline styles, the only thing email
// clients reliably support). The plain text stays the fallback part; this HTML
// is the "preferred" alternative. All user content is HTML-escaped.

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Turns bare URLs in already-escaped text into anchors. Runs *after* escapeHtml
// so user content can never inject markup: `<`, `>`, `"` and `'` are gone by the
// time we match, and `&` is already `&amp;` (valid inside an href).
//
// SES click tracking only rewrites <a href> links, so without this a plain-text
// body carries no trackable links at all, click rate is structurally 0.
const URL_RE = /\bhttps?:\/\/[^\s<>()]+/g;

// A trailing `.`/`,`/`!`/`?` is sentence punctuation, not part of the URL. `;`
// is deliberately excluded: it terminates entities like `&amp;` in a query
// string, and trimming it would corrupt the href.
const trimTrailingPunctuation = (url: string): [string, string] => {
  const m = url.match(/^(.*?)([.,!?]+)$/);
  return m ? [m[1], m[2]] : [url, ""];
};

const linkify = (escaped: string): string =>
  escaped.replace(URL_RE, (raw) => {
    const [url, tail] = trimTrailingPunctuation(raw);
    return `<a href="${url}" style="color:#b6207f;text-decoration:underline;word-break:break-word;">${url}</a>${tail}`;
  });

const isHexColor = (v: string): boolean => /^#[0-9a-fA-F]{6}$/.test(v);

// Darken a #rrggbb hex by a factor (0..1) for a subtle header gradient stop.
const shade = (hex: string, factor: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((n & 0xff) * factor)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

export interface BrandedEmailInput {
  brandName: string;
  brandColor?: string | null;
  bodyText: string;
}

export function renderBrandedEmail(input: BrandedEmailInput): string {
  const brand = escapeHtml((input.brandName || "Open CRM").trim() || "Open CRM");
  const color =
    input.brandColor && isHexColor(input.brandColor) ? input.brandColor : "#b6207f";
  const colorDark = shade(color, 0.82);
  const monogram = (brand.match(/[A-Za-z0-9]/)?.[0] ?? "E").toUpperCase();
  const year = new Date().getFullYear();

  // Body text -> paragraphs (split on blank lines) with <br> for single newlines.
  // Bare URLs become anchors so SES can rewrite them for click tracking.
  const paragraphs = linkify(escapeHtml(input.bodyText.trim()))
    .split(/\n{2,}/)
    .filter((p) => p.length > 0)
    .map(
      (p) =>
        `<p style="margin:0 0 18px;line-height:1.7;font-size:15px;color:#3f3f46;">${p.replace(/\n/g, "<br>")}</p>`
    )
    .join("");

  // Hidden preview text (preheader), first ~90 chars shown in the inbox list.
  const preheader = escapeHtml(input.bodyText.trim().replace(/\s+/g, " ").slice(0, 90));

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${brand}</title>
</head>
<body style="margin:0;padding:0;width:100%;background:#eef0f4;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef0f4;font-size:1px;line-height:1px;">${preheader}&#8204;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f4;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,0.04),0 8px 24px rgba(16,24,40,0.08);">

        <!-- Brand header -->
        <tr><td style="padding:0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${color};background-image:linear-gradient(135deg,${color} 0%,${colorDark} 100%);">
            <tr><td style="padding:28px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr><td align="center" valign="middle" width="40" height="40" style="width:40px;height:40px;background:rgba(255,255,255,0.18);border-radius:10px;color:#ffffff;font-size:18px;font-weight:700;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${monogram}</td></tr>
                    </table>
                  </td>
                  <td style="vertical-align:middle;padding-left:14px;">
                    <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.2px;">${brand}</span>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 36px 28px;">
          ${paragraphs}
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:0 36px;">
          <div style="height:1px;background:#ececf1;line-height:1px;font-size:0;">&nbsp;</div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:22px 36px 30px;">
          <div style="margin:0 0 4px;font-size:13px;color:#71717a;line-height:1.5;">Sent by <span style="color:#52525b;font-weight:600;">${brand}</span></div>
          <div style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5;">Sent with Open CRM &middot; &copy; ${year} ${brand}</div>
        </td></tr>

      </table>

      <!-- Sub-footer -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr><td style="padding:18px 16px 0;text-align:center;">
          <div style="margin:0;font-size:11px;color:#b4b7c0;line-height:1.5;">You're receiving this email because you're connected with ${brand}.</div>
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}
