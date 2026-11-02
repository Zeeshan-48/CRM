import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE, DEMO, useSession, WEB } from "../helpers";

// Serious and critical axe violations fail the run; moderate ones are reported only.
async function audit(page: Page, label: string) {
  // Measure the settled page, not a frame of an entrance animation.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.flatMap((v) =>
      v.nodes.map((n) => `${label}: ${v.id} ${n.target.join(" ")} ${n.any[0]?.message ?? ""}`),
    ),
  ).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  test(`workspace pages pass axe in ${theme} mode`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("crm-theme", t), theme);
    await page.goto(`${WEB}/login`);
    await audit(page, "login");
    await useSession(page, request, DEMO.northwindAdmin());
    for (const path of ["/dashboard", "/leads", "/pipeline"]) {
      await page.goto(`${WEB}${path}`);
      await page.waitForLoadState("networkidle");
      await audit(page, path);
    }
  });
}

test("console pages pass axe", async ({ page, request }) => {
  await page.goto(`${CONSOLE}/login`);
  await audit(page, "console login");
  await useSession(page, request, DEMO.operator(), { app: "console" });
  for (const path of ["/", "/tenants", "/plans"]) {
    await page.goto(`${CONSOLE}${path}`);
    await page.waitForLoadState("networkidle");
    await audit(page, `console ${path}`);
  }
});
