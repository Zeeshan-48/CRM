import { expect, test } from "@playwright/test";
import { apiLogin, DEMO, signIn, useSession, tenantApi, uniq, WEB } from "../helpers";

test.describe("workspace app", () => {
  test("an admin signs in and lands on the dashboard with seeded data", async ({ page }) => {
    await signIn(page, DEMO.northwindAdmin());
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Northwind Academy").first()).toBeVisible();
    await expect(page.getByText("Weighted pipeline")).toBeVisible();
  });

  test("a lead created through the API shows up in the list and opens", async ({ page, request }) => {
    const token = await apiLogin(request);
    const name = `Lead ${uniq()}`;
    const lead = await tenantApi<{ id: string }>(request, token, "POST", "/leads", {
      name,
      email: `${uniq()}@example.com`,
      source: "Website Form",
    });

    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/leads`);
    await page.getByPlaceholder(/Search name, email, phone/).fill(name);
    await expect(page.getByText(name)).toBeVisible();

    await page.goto(`${WEB}/leads/${lead.id}`);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await tenantApi(request, token, "DELETE", `/leads/${lead.id}`);
  });

  test("the pipeline shows the fixed deal stages", async ({ page, request }) => {
    await useSession(page, request, DEMO.northwindAdmin());
    await page.goto(`${WEB}/pipeline`);
    await expect(page.getByText("Qualified").first()).toBeVisible();
    await expect(page.getByText("Proposal Sent").first()).toBeVisible();
  });

  test("a Growth workspace does not see Enterprise-only modules", async ({ page, request }) => {
    await useSession(page, request, DEMO.acmeAdmin());
    await page.goto(`${WEB}/dashboard`);
    await expect(page.getByText("Acme Robotics").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "AI Agents" })).toHaveCount(0);
  });

  test("a wrong password is refused", async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await page.locator("#email").fill(DEMO.northwindAdmin().email);
    await page.locator("#password").fill("not-the-password");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/);
  });
});
