import { expect, test } from "@playwright/test";

test("workspace shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Floor" })).toBeVisible();
});

test("forge studio", async ({ page }) => {
  await page.goto("/forge");
  await expect(page.getByRole("heading", { name: "Forge studio" })).toBeVisible();
});
