import { describe, expect, it } from "vitest";
import { assertSafeUrl } from "../../src/utils/http-guard";

describe("assertSafeUrl (SSRF guard)", () => {
  it("allows a public IP over https (no DNS needed)", async () => {
    await expect(assertSafeUrl("https://8.8.8.8/call")).resolves.toBeInstanceOf(URL);
  });

  it("rejects non-https", async () => {
    await expect(assertSafeUrl("http://8.8.8.8/call")).rejects.toThrow();
  });

  it("rejects localhost and loopback", async () => {
    await expect(assertSafeUrl("https://localhost/call")).rejects.toThrow();
    await expect(assertSafeUrl("https://127.0.0.1/call")).rejects.toThrow();
  });

  it("rejects private ranges and cloud metadata", async () => {
    await expect(assertSafeUrl("https://10.0.0.5/call")).rejects.toThrow();
    await expect(assertSafeUrl("https://192.168.1.1/call")).rejects.toThrow();
    await expect(assertSafeUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow();
  });

  it("rejects embedded credentials and .internal hosts", async () => {
    await expect(assertSafeUrl("https://user:pass@8.8.8.8/call")).rejects.toThrow();
    await expect(assertSafeUrl("https://svc.internal/call")).rejects.toThrow();
  });
});
