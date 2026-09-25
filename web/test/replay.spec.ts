import { expect, test } from "@playwright/test";
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

test("automatically opens the bundled full-state replay and drives its controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Choose SimC JSON")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load bundled demo" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Loaded bundled Elemental Shaman reference" })).toBeVisible();
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

test("keeps the genuine scene usable through reference failure and retry", async ({ page }) => {
  let referenceRequests = 0;
  await page.route("**/fixture/elemental-shaman-replay.json", async (route) => {
    referenceRequests += 1;
    if (referenceRequests === 1) {
      await route.fulfill({ status: 503, body: "temporarily unavailable" });
      return;
    }
    await route.continue();
  });

  await page.goto("/");

  const alert = page.getByRole("alert").filter({ hasText: "Could not load reference" });
  await expect(alert).toContainText("status 503");
  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  await expect(scene.getByRole("status")).toContainText("Both genuine models ready", { timeout: 30_000 });
  await expect(scene.locator("canvas")).toBeVisible();
  await expect(scene.locator(".replay-unavailable")).toBeVisible();
  await scene.getByRole("button", { name: "Manual preview" }).click();
  await expect(scene.getByRole("combobox", { name: "Exported character animation" })).toBeEnabled();

  await alert.getByRole("button", { name: "Retry loading reference" }).click();

  await expect(page.getByRole("heading", { name: "MID2_Shaman_Elemental_Farseer" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Could not load reference" })).toHaveCount(0);
  expect(referenceRequests).toBe(2);
});

test("preserves missing-state semantics for a legacy partial reference", async ({ page }) => {
  await page.route("**/fixture/elemental-shaman-replay.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: partialReport,
  }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Legacy Partial Actor" })).toBeVisible();
  await expect(page.getByText("Cooldown snapshot was not recorded at this event.")).toBeVisible();
  await expect(page.getByText("Target debuff snapshot was not recorded at this event.")).toBeVisible();
  await expect(page.getByText(/Aggregate across 10 samples/)).toBeVisible();
  await expect(page.getByText(/Sampled iteration not recorded/)).toBeVisible();

  await page.getByRole("button", { name: "Next event" }).click();
  await expect(page.getByTestId("selected-event")).toContainText("Wait 0.50s");
  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  await expect(scene.locator(".replay-motion-status")).toContainText("Recorded wait — idle; no cast motion.");
});

test("keeps the replay usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "MID2_Shaman_Elemental_Farseer" })).toBeVisible();
  await page.locator(".event-hit-target").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Configured max charges: 1").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Next event" }).click();
  await expect(page.getByTestId("selected-event")).toBeVisible();
});

test("loads both genuine local models with separate replay and manual modes", async ({ page }) => {
  const runtimeRequests: string[] = [];
  page.on("request", (request) => runtimeRequests.push(request.url()));

  await page.goto("/");
  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  await expect(scene).toBeVisible();
  await expect(scene.getByText("Default Vulpera", { exact: true })).toBeVisible();
  await expect(scene.getByText("Training Dummy", { exact: true })).toBeVisible();
  await expect(scene.getByRole("button", { name: "Replay sync" })).toHaveAttribute("aria-pressed", "true");
  await expect(scene.getByText(/illustrative exported motion/i)).toBeVisible();
  await expect(scene.getByRole("status")).toContainText("Both genuine models ready", { timeout: 30_000 });
  await expect(scene.locator("canvas")).toBeVisible();

  await scene.getByRole("button", { name: "Play", exact: true }).click();
  await expect(scene.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await scene.getByRole("button", { name: "Manual preview" }).click();
  await expect(scene.getByRole("button", { name: "Manual preview" })).toHaveAttribute("aria-pressed", "true");
  const animationSelect = scene.getByRole("combobox", { name: "Exported character animation" });
  expect(await animationSelect.locator("option").count()).toBeGreaterThan(100);
  await animationSelect.selectOption({ label: "Run (ID 5 variation 0)" });
  await scene.getByRole("button", { name: "Play animation" }).click();
  await expect(scene.getByRole("button", { name: "Pause animation" })).toBeVisible();
  await animationSelect.selectOption({ label: "Walk (ID 4 variation 0)" });
  const manualPose = await scene.locator("canvas").screenshot();
  await page.waitForTimeout(180);
  expect((await scene.locator("canvas").screenshot()).equals(manualPose)).toBe(false);

  await scene.getByRole("button", { name: "Replay sync" }).click();
  await expect(scene.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  expect(runtimeRequests.some((url) => url.endsWith("/model/vulpera.glb"))).toBe(true);
  expect(runtimeRequests.some((url) => url.endsWith("/model/training-dummy.glb"))).toBe(true);
  expect(runtimeRequests.every((url) => new URL(url).origin === "http://127.0.0.1:4173")).toBe(true);
});

test("synchronizes real exported poses to replay controls deterministically", async ({ page }) => {
  await page.goto("/");
  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  await expect(scene.getByRole("status")).toContainText("Both genuine models ready", { timeout: 30_000 });
  const canvas = scene.locator("canvas");
  const seek = scene.getByRole("slider", { name: "Seek playback" });
  const motionStatus = scene.locator(".replay-motion-status");

  await seek.fill("20.44");
  await expect(motionStatus).toContainText("Lightning Bolt");
  await expect(motionStatus).toHaveAttribute("data-animation-kind", "motion");
  const startPose = await canvas.screenshot();

  await seek.fill("20.9");
  await expect(motionStatus).toContainText("Lightning Bolt");
  const laterPose = await canvas.screenshot();
  expect(laterPose.equals(startPose)).toBe(false);

  await seek.fill("20.7");
  const firstSample = await canvas.screenshot();
  await seek.fill("18.5");
  await expect(motionStatus).toContainText("Lava Burst");
  const lavaBurstPose = await canvas.screenshot();
  await seek.fill("19.6");
  await expect(motionStatus).toContainText("Elemental Blast");
  expect((await canvas.screenshot()).equals(lavaBurstPose)).toBe(false);
  await seek.fill("30.2");
  await expect(motionStatus).toContainText("Lightning Bolt");
  await seek.fill("20.7");
  await expect(motionStatus).toContainText("Lightning Bolt");
  const repeatedSample = await canvas.screenshot();
  expect(repeatedSample.equals(firstSample)).toBe(true);

  await scene.getByRole("button", { name: "Manual preview" }).click();
  await scene.getByRole("combobox", { name: "Exported character animation" }).selectOption({ label: "Run (ID 5 variation 0)" });
  await scene.getByRole("button", { name: "Replay sync" }).click();
  await expect(motionStatus).toContainText("Lightning Bolt");
  expect((await canvas.screenshot()).equals(firstSample)).toBe(true);

  await scene.getByLabel("Speed").selectOption("2");
  await scene.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(150);
  await scene.getByRole("button", { name: "Pause", exact: true }).click();
  const pausedCursor = await seek.inputValue();
  const pausedPose = await canvas.screenshot();
  await page.waitForTimeout(150);
  expect(await seek.inputValue()).toBe(pausedCursor);
  expect((await canvas.screenshot()).equals(pausedPose)).toBe(true);

  await seek.fill("44.213");
  await expect(motionStatus).toContainText("Stormkeeper");
  await scene.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(motionStatus).toContainText("snapshot_stats");
  await expect(motionStatus).toHaveAttribute("data-animation-kind", "unmapped");
});

test("applies the latest replay pose when the Vulpera finishes loading late", async ({ page }) => {
  await page.route("**/model/vulpera.glb", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });
  await page.goto("/");
  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  const seek = scene.getByRole("slider", { name: "Seek playback" });
  await seek.fill("20.7");
  await expect(scene.locator(".replay-motion-status")).toContainText("Lightning Bolt");
  await expect(scene.getByRole("status")).toContainText("Both genuine models ready", { timeout: 30_000 });
  const replayPose = await scene.locator("canvas").screenshot();

  await seek.fill("20.44");
  const earlierPose = await scene.locator("canvas").screenshot();
  expect(earlierPose.equals(replayPose)).toBe(false);
});

test("orbits, zooms, and resets the genuine model camera", async ({ page }) => {
  await page.goto("/");
  const scene = page.getByRole("region", { name: "Genuine WoW model scene" });
  await expect(scene.getByRole("status")).toContainText("Both genuine models ready", { timeout: 30_000 });
  const canvas = scene.locator("canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The WebGL canvas has no visible bounds.");

  await page.waitForTimeout(250);
  const initial = await canvas.screenshot();
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.35, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const orbited = await canvas.screenshot();
  expect(orbited.equals(initial)).toBe(false);

  await canvas.hover();
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(150);
  const zoomed = await canvas.screenshot();
  expect(zoomed.equals(orbited)).toBe(false);

  await scene.getByRole("button", { name: "Reset camera" }).click();
  await page.waitForTimeout(50);
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
  await page.route("**/fixture/elemental-shaman-replay.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: partialReport,
  }));
  await page.goto("/");

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
