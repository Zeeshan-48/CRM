import { expect, test } from "@playwright/test";
import { CONSOLE, DEMO, signIn, useSession } from "../helpers";

test.describe("operator console", () => {
  test("the operator sees every tenant and its plan", async ({ page }) => {
    await signIn(page, DEMO.operator(), { app: "console" });
    await page.goto(`${CONSOLE}/tenants`);
    await expect(page.getByText("Northwind Academy")).toBeVisible();
    await expect(page.getByText("Acme Robotics")).toBeVisible();
  });

  test("a tenant's entitlements come from its plan snapshot", async ({ page, request }) => {
    await useSession(page, request, DEMO.operator(), { app: "console" });
    await page.goto(`${CONSOLE}/tenants`);
    await page.getByText("Northwind Academy").click();
    await expect(page.getByText("Entitlements")).toBeVisible();
    await expect(page.getByText("module.leads").first()).toBeVisible();
  });

  test("a workspace user cannot sign in to the console", async ({ page }) => {
    await page.goto(`${CONSOLE}/login`);
    await page.locator("#email").fill(DEMO.northwindAdmin().email);
    await page.locator("#password").fill(DEMO.northwindAdmin().password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/);
  });
});
