import { describe, expect, it } from "vitest";
import { renderBrandedEmail } from "../src/utils/email-html";

const render = (bodyText: string): string =>
  renderBrandedEmail({ brandName: "Acme Robotics", brandColor: "#0a66c2", bodyText });

describe("renderBrandedEmail: link handling", () => {
  it("turns a bare URL into an anchor so SES can rewrite it for click tracking", () => {
    const html = render("Join here: https://meet.jit.si/crm-abc123");
    expect(html).toContain(
      '<a href="https://meet.jit.si/crm-abc123"'
    );
    expect(html).toContain(">https://meet.jit.si/crm-abc123</a>");
  });

  it("keeps sentence punctuation out of the href", () => {
    const html = render("See https://example.com/pricing.");
    expect(html).toContain('href="https://example.com/pricing"');
    // The full stop survives as text, immediately after the closing tag.
    expect(html).toContain("</a>.");
  });

  it("does not corrupt an escaped ampersand in a query string", () => {
    const html = render("Open https://example.com/p?a=1&b=2 now");
    expect(html).toContain('href="https://example.com/p?a=1&amp;b=2"');
    // `;` must never be stripped as punctuation, it terminates the entity.
    expect(html).not.toContain("&amp&");
    expect(html).not.toContain('href="https://example.com/p?a=1&amp"');
  });

  it("escapes markup and never linkifies non-http schemes", () => {
    const html = render('<script>alert(1)</script> javascript:alert(2)');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
  });

  it("cannot be tricked into injecting an attribute via quotes in the URL", () => {
    const html = render('https://example.com/"onmouseover="alert(1)');
    // The quote is escaped before linkify runs, so it can't close the href.
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("leaves plain prose untouched", () => {
    const html = render("Hello Asha,\n\nThanks for your time.");
    expect(html).not.toContain("<a href");
    expect(html).toContain("Hello Asha,");
    expect(html).toContain("Thanks for your time.");
  });
});
