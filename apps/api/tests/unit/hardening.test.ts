import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../src/app";
import config, { assertProductionConfig } from "../../src/config";
import { planSnapshotSpecs } from "../../src/services/operator/plan-snapshot";
import storageService from "../../src/services/storage.service";
import type { PlanRow } from "../../src/repositories/operator/plans.repository";
import { isSealed, openSecret, sealSecret } from "../../src/utils/crypto";

const random = (n: number) => "x".repeat(n);

describe("production config guard", () => {
  const prod = { ...config, isProduction: true };

  it("refuses the development JWT secret and credentials key", () => {
    expect(() => assertProductionConfig(prod)).toThrow(/JWT_SECRET/);
    expect(() => assertProductionConfig({ ...prod, JWT_SECRET: random(40) })).toThrow(
      /CREDENTIALS_ENCRYPTION_KEY/
    );
  });

  it("refuses short secrets and an empty origin list", () => {
    const strong = { ...prod, JWT_SECRET: random(40), CREDENTIALS_ENCRYPTION_KEY: random(40) };
    expect(() => assertProductionConfig({ ...strong, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
    expect(() => assertProductionConfig({ ...strong, CORS_ORIGINS: [] })).toThrow(/CORS_ORIGINS/);
    expect(() => assertProductionConfig(strong)).not.toThrow();
  });

  it("does nothing outside production", () => {
    expect(() => assertProductionConfig({ ...config, isProduction: false })).not.toThrow();
  });
});

describe("CORS", () => {
  it("echoes an allowed origin", async () => {
    const origin = config.CORS_ORIGINS[0];
    const res = await request(app).options("/api/v1/leads").set("Origin", origin);
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("gives an unknown origin no CORS headers", async () => {
    const res = await request(app).options("/api/v1/leads").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("local file links", () => {
  it("serves a file only through an unexpired signed link", async () => {
    const key = `test/hardening-${Date.now()}.txt`;
    await storageService.upload({ key, body: Buffer.from("hello"), contentType: "text/plain" });
    const url = new URL(await storageService.getDownloadUrl(key, 60));
    const path = `${url.pathname}${url.search}`;

    const ok = await request(app).get(path);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("hello");

    expect((await request(app).get(url.pathname)).status).toBe(403);
    const tampered = path.replace(/sig=[^&]+/, "sig=AAAA");
    expect((await request(app).get(tampered)).status).toBe(403);
    const expired = path.replace(/expires=\d+/, "expires=1");
    expect((await request(app).get(expired)).status).toBe(403);

    await storageService.delete(key);
  });

  it("refuses keys that escape the storage root", async () => {
    await expect(
      storageService.upload({ key: "../escape.txt", body: Buffer.from("x") })
    ).rejects.toThrow(/invalid storage key/);
  });
});

describe("sealed secrets", () => {
  it("seals, opens and passes legacy plaintext through", () => {
    const sealed = sealSecret("whsec_abc");
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("whsec_abc");
    expect(openSecret(sealed)).toBe("whsec_abc");
    expect(openSecret("legacy-plaintext")).toBe("legacy-plaintext");
  });
});

describe("plan snapshot", () => {
  const plan = (modules: string[], limits: Record<string, number>) =>
    ({ modules, limits }) as unknown as PlanRow;

  it("writes the connected-apps limit when the plan includes products", () => {
    const specs = planSnapshotSpecs(plan(["leads", "products"], { seats: 5, connected_apps: 3 }));
    expect(specs.find((s) => s.code === "limit.connected_apps")?.limit_value).toBe(3);
  });

  it("grants connected apps uncapped when the plan sets no limit", () => {
    const specs = planSnapshotSpecs(plan(["products"], {}));
    expect(specs.find((s) => s.code === "limit.connected_apps")?.limit_value).toBeNull();
  });

  it("writes no connected-apps row without the products module", () => {
    const specs = planSnapshotSpecs(plan(["leads"], { connected_apps: 3 }));
    expect(specs.some((s) => s.code === "limit.connected_apps")).toBe(false);
  });
});
