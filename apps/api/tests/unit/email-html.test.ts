import { describe, expect, it } from "vitest";
import { renderBrandedEmail } from "../../src/utils/email-html";

describe("renderBrandedEmail", () => {
  it("produces an HTML document with the brand name and body", () => {
    const html = renderBrandedEmail({
      brandName: "Acme Corp",
      brandColor: "#123456",
      bodyText: "Hello Priya,\n\nThanks for your time.",
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Acme Corp");
    expect(html).toContain("#123456");
    expect(html).toContain("Hello Priya,");
    expect(html).toContain("Thanks for your time.");
  });

  it("splits blank lines into paragraphs and single newlines into <br>", () => {
    const html = renderBrandedEmail({ brandName: "X", bodyText: "Line one\nLine two\n\nNext para" });
    expect((html.match(/<p /g) || []).length).toBe(2);
    expect(html).toContain("Line one<br>Line two");
  });

  it("HTML-escapes user content to prevent injection", () => {
    const html = renderBrandedEmail({
      brandName: "<script>",
      bodyText: "Visit <b>here</b> & save \"now\"",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;here&lt;/b&gt;");
    expect(html).toContain("&amp;");
  });

  it("falls back to a default brand name and color when missing", () => {
    const html = renderBrandedEmail({ brandName: "", brandColor: "not-a-color", bodyText: "Hi" });
    expect(html).toContain("Open CRM");
    expect(html).toContain("#b6207f");
  });
});
