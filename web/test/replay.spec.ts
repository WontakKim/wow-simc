import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("../public/fixture/elemental-shaman-replay.json", import.meta.url));

const partialReport = JSON.stringify({
  report_version: "2.0.0",
  version: "1210-01",
  ptr_enabled: 1,
  logs: [],
  sim: {
    options: {
      dbc: {
        version_used: "Live",
        Live: { wow_version: "12.1.0.69933" },
      },
    },
    players: [{
      name: "Legacy Partial Actor",
      specialization: "Frost Mage",
      collected_data: {
        dps: { mean: 1200, count: 10 },
        fight_length: { mean: 3 },
        action_sequence: [
          {
            time: 0,
            id: 116,
            name: "frostbolt",
            spell_name: "Frostbolt",
            target: "Target",
            queue_failed: false,
            resources: { mana: 100 },
            resources_max: { mana: 100 },
          },
          {
            time: 2,
            wait: 0.5,
            resources: { mana: 95 },
            resources_max: { mana: 100 },
          },
        ],
      },
    }],
  },
});

test("drives bundled full-state replay controls", async ({ page }) => {
  await page.goto("/");
  const fileInput = page.getByLabel("Choose SimC JSON");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await fileInput.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(fileInput).toBeFocused();
  await expect(page.locator('label[for="report-file"]')).toHaveCSS("outline-style", "solid");
  await page.getByRole("button", { name: "Load bundled demo" }).click();

  await expect(page.getByRole("heading", { name: "MID2_Shaman_Elemental_Farseer" })).toBeVisible();
  await expect(page.getByText(/not the highest, optimal, or representative result/i)).toBeVisible();
  await expect(page.getByText(/Rune of Unleashed Fire/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(59);
  await expect(page.locator(".precombat-event")).toHaveCount(8);
  await expect(page.locator(".event-hit-target")).toHaveCount(51);

  const selectedEvent = page.getByTestId("selected-event");
  const firstHeading = await selectedEvent.getByRole("heading").textContent();
  await page.getByRole("button", { name: "Next event" }).click();
  await expect(selectedEvent.getByRole("heading")).not.toHaveText(firstHeading ?? "");
  await page.keyboard.press("ArrowLeft");
  await expect(selectedEvent.getByRole("heading")).toHaveText(firstHeading ?? "");

  const firstMark = page.locator(".event-hit-target").first();
  await firstMark.focus();
  await expect(firstMark.getByRole("tooltip")).toBeVisible();

  const seek = page.getByRole("slider", { name: "Seek playback" });
  await seek.fill("20");
  await expect(selectedEvent).toContainText(/Recorded snapshot at (1[0-9]|20)\./);

  await page.getByLabel("Speed").selectOption("2");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("imports and replaces local full and partial reports", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("Choose SimC JSON");

  await input.setInputFiles({
    name: "legacy-partial.json",
    mimeType: "application/json",
    buffer: Buffer.from(partialReport),
  });
  await expect(page.getByRole("heading", { name: "Legacy Partial Actor" })).toBeVisible();
  await expect(page.getByText("Cooldown snapshot was not recorded at this event.")).toBeVisible();
  await expect(page.getByText("Target debuff snapshot was not recorded at this event.")).toBeVisible();
  await expect(page.getByText(/Aggregate across 10 samples/)).toBeVisible();
  await expect(page.getByText(/Sampled iteration not recorded/)).toBeVisible();

  await page.getByRole("button", { name: "Next event" }).click();
  await expect(page.getByTestId("selected-event")).toContainText("Wait 0.50s");

  await input.setInputFiles(fixturePath);
  await expect(page.getByRole("heading", { name: "MID2_Shaman_Elemental_Farseer" })).toBeVisible();
  await expect(page.getByTestId("selected-event")).toContainText("precombat");
  await expect(page.locator("tbody tr")).toHaveCount(59);
});

test("keeps the replay usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Load bundled demo" }).click();

  await expect(page.getByRole("heading", { name: "MID2_Shaman_Elemental_Farseer" })).toBeVisible();
  await page.locator(".event-hit-target").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Configured max charges: 1").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Next event" }).click();
  await expect(page.getByTestId("selected-event")).toBeVisible();
});

test("loads both genuine local models and previews exported animation manually", async ({ page }) => {
  const runtimeRequests: string[] = [];
  page.on("request", (request) => runtimeRequests.push(request.url()));

  await page.goto("/");
  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  await expect(scene).toBeVisible();
  await expect(scene.getByText("Default Vulpera", { exact: true })).toBeVisible();
  await expect(scene.getByText("Training Dummy", { exact: true })).toBeVisible();
  await expect(scene.getByText(/not synchronized to the sampled SimC trace/i)).toBeVisible();
  await expect(scene.getByRole("status")).toContainText("Both genuine models ready", { timeout: 30_000 });
  await expect(scene.locator("canvas")).toBeVisible();

  const animationSelect = scene.getByRole("combobox", { name: "Exported character animation" });
  expect(await animationSelect.locator("option").count()).toBeGreaterThan(100);
  await animationSelect.selectOption({ label: "Run (ID 5 variation 0)" });
  await scene.getByRole("button", { name: "Play animation" }).click();
  await expect(scene.getByRole("button", { name: "Pause animation" })).toBeVisible();
  await scene.getByRole("button", { name: "Pause animation" }).click();

  expect(runtimeRequests.some((url) => url.endsWith("/model/vulpera.glb"))).toBe(true);
  expect(runtimeRequests.some((url) => url.endsWith("/model/training-dummy.glb"))).toBe(true);
  expect(runtimeRequests.every((url) => new URL(url).origin === "http://127.0.0.1:4173")).toBe(true);
});

test("orbits, zooms, and resets the genuine model camera", async ({ page }) => {
  await page.goto("/");
  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  await expect(scene.getByRole("status")).toContainText("Both genuine models ready", { timeout: 30_000 });
  const canvas = scene.locator("canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The WebGL canvas has no visible bounds.");

  const initial = await canvas.screenshot();
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.4, { steps: 8 });
  await page.mouse.up();
  const orbited = await canvas.screenshot();
  expect(orbited.equals(initial)).toBe(false);

  await canvas.hover();
  await page.mouse.wheel(0, -500);
  const zoomed = await canvas.screenshot();
  expect(zoomed.equals(orbited)).toBe(false);

  await scene.getByRole("button", { name: "Reset camera" }).click();
  const reset = await canvas.screenshot();
  expect(reset.equals(zoomed)).toBe(false);
});

test("shows actionable setup guidance when a genuine model asset is missing", async ({ page }) => {
  await page.route("**/model/training-dummy.glb", (route) => route.fulfill({ status: 404, body: "missing" }));
  await page.goto("/");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("training-dummy.glb", { timeout: 30_000 });
  await expect(alert).toContainText(/export the genuine model with wow\.export/i);
  await expect(alert).toContainText("web/public/model/");
  await expect(page.getByText(/no placeholder model was substituted/i)).toBeVisible();
});

test("shows actionable feedback when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, ...args: unknown[]) {
      if (contextId.startsWith("webgl")) return null;
      return originalGetContext.call(this, contextId as never, ...args as never);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText(/webgl is unavailable/i);
  await expect(alert).toContainText(/hardware acceleration/i);
  await expect(alert).toContainText(/no placeholder model was substituted/i);
});

test("keeps model camera arrows isolated from trace playback and navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Choose SimC JSON").setInputFiles({
    name: "keyboard-isolation.json",
    mimeType: "application/json",
    buffer: Buffer.from(partialReport),
  });

  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  await expect(scene.getByRole("status")).toContainText("Both genuine models ready", { timeout: 30_000 });
  const selectedEvent = page.getByTestId("selected-event");
  await expect(selectedEvent.getByRole("heading")).toHaveText("Frostbolt");

  await page.getByRole("button", { name: "Play", exact: true }).click();
  const canvas = scene.locator("canvas");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");

  await expect(selectedEvent.getByRole("heading")).toHaveText("Frostbolt");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: /^Event 1,/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(selectedEvent).toContainText("Wait 0.50s");
});

test("reframes genuine models after resizing the same page to mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  await expect(scene.getByRole("status")).toContainText("Both genuine models ready", { timeout: 30_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await scene.getByRole("button", { name: "Reset camera" }).click();
  const canvas = scene.locator("canvas");
  const screenshot = await canvas.screenshot();
  const trainingDummyPixelsAtRightEdge = await page.evaluate(async (imageUrl) => {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const sample = document.createElement("canvas");
    sample.width = image.width;
    sample.height = image.height;
    const context = sample.getContext("2d");
    if (!context) throw new Error("Could not inspect the resized WebGL screenshot.");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let count = 0;

    for (let x = sample.width - 10; x < sample.width; x += 1) {
      for (let y = 0; y < sample.height * 0.7; y += 1) {
        const offset = (y * sample.width + x) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        if (red > 50 && red > green * 1.12 && green > blue * 1.05) count += 1;
      }
    }
    return count;
  }, `data:image/png;base64,${screenshot.toString("base64")}`);

  expect(trainingDummyPixelsAtRightEdge).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
