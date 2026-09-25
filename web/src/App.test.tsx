import * as matchers from "@testing-library/jest-dom/matchers";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./GenuineModelScene", () => ({
  GenuineModelScene: () => (
    <section aria-label="Genuine WoW model scene">
      <span>Default Vulpera</span>
      <span>Training Dummy</span>
      <p>Manual exported animation preview — not synchronized to the sampled SimC trace.</p>
      <select aria-label="Exported character animation"><option>Stand</option></select>
      <button type="button" aria-label="Play animation">Play</button>
      <button type="button">Reset camera</button>
    </section>
  ),
}));

expect.extend(matchers);
import { App } from "./App";


afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface StatefulReportOptions {
  simulationIterations?: number;
  dpsSamples?: number;
  precombatTime?: number;
}

function statefulReportFile(
  actorName = "State Actor",
  name = "stateful.json",
  options: StatefulReportOptions = {},
) {
  const simulationOptions = {
    ...(options.simulationIterations === undefined ? {} : { iterations: options.simulationIterations }),
    dbc: { version_used: "Live", Live: { wow_version: "12.1.0.69933" } },
  };
  const precombatTime = options.precombatTime ?? 0;

  return new File([
    JSON.stringify({
      report_version: "2.0.0",
      version: "1210-01",
      sim: {
        options: simulationOptions,
        players: [{
          name: actorName,
          specialization: "Elemental Shaman",
          collected_data: {
            dps: { mean: 2000, count: options.dpsSamples ?? 1 },
            fight_length: { mean: 2 },
            action_sequence_precombat: [
              { time: precombatTime, id: 10, name: "first_setup", spell_name: "First Setup", target: "none", queue_failed: false, resources: { mana: 100 }, resources_max: { mana: 100 }, buffs: [{ id: 30, name: "setup_buff", stacks: 1 }] },
              { time: precombatTime, id: 11, name: "second_setup", spell_name: "Second Setup", target: "none", queue_failed: false, resources: { mana: 100 }, resources_max: { mana: 100 } },
            ],
            action_sequence: [
              { time: 0, id: 12, name: "first_combat", spell_name: "First Combat", target: "Target", queue_failed: false, resources: { mana: 95 }, resources_max: { mana: 100 }, cooldowns: [], targets: [] },
              { time: 2, id: 13, name: "last_combat", spell_name: "Last Combat", target: "Target", queue_failed: false, resources: { mana: 90 }, resources_max: { mana: 100 }, cooldowns: [{ id: 40, name: "major_cooldown", stacks: 2, remains: 4 }], targets: [] },
            ],
          },
        }],
      },
    }),
  ], name, { type: "application/json" });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function reportFile(name = "replay.json") {
  return new File([
    JSON.stringify({
      report_version: "2.0.0",
      version: "1210-01",
      ptr_enabled: false,
      logs: [{
        level: "implementation_not_yet_verified",
        message: "Example implementation warning",
      }],
      sim: {
        options: {
          iterations: 1,
          dbc: { version_used: "Live", Live: { wow_version: "12.1.0.69933" } },
        },
        players: [
          {
            name: "First Actor",
            specialization: "Frost Mage",
            collected_data: {
              dps: { mean: 1000, count: 1 },
              fight_length: { mean: 4 },
              action_sequence: [
                { time: 0, id: 1, name: "frostbolt", spell_name: "Frostbolt", target: "Target", queue_failed: false, resources: { mana: 100 }, resources_max: { mana: 100 } },
                { time: 2, id: 2, name: "ice_lance", spell_name: "Ice Lance", target: "Target", queue_failed: true, resources: { mana: 95 }, resources_max: { mana: 100 } },
              ],
            },
          },
          {
            name: "Second Actor",
            specialization: "Elemental Shaman",
            collected_data: {
              dps: { mean: 2000, count: 1 },
              fight_length: { mean: 6 },
              action_sequence: [
                { time: 1, wait: 0.5, resources: { mana: 90 }, resources_max: { mana: 100 } },
              ],
            },
          },
        ],
      },
    }),
  ], name, { type: "application/json" });
}

describe("App", () => {
  it("imports locally, requires actor selection, and exposes truthful navigation and state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText(/choose simc json/i), reportFile());

    expect(screen.getByRole("status")).toHaveTextContent("Loaded replay.json");
    expect(screen.getByRole("combobox", { name: /trace actor/i })).toHaveValue("");
    expect(screen.getByText(/choose one of 2 actors/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: /trace actor/i }), "actor-0");

    expect(screen.getByRole("heading", { name: "First Actor" })).toBeInTheDocument();
    expect(screen.getByText(/sampled action trace/i)).toBeInTheDocument();
    expect(screen.getByText(/sampled iteration 0/i)).toBeInTheDocument();
    expect(screen.getByText(/aggregate across 1 sample/i)).toBeInTheDocument();
    expect(screen.getByText("Example implementation warning")).toBeInTheDocument();
    expect(screen.getByText(/cooldown snapshot was not recorded at this event/i)).toBeInTheDocument();

    const details = screen.getByTestId("selected-event");
    expect(within(details).getByText("Frostbolt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next event/i }));
    expect(within(details).getByText("Ice Lance")).toBeInTheDocument();
    expect(within(details).getByText(/queue failed/i)).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(within(details).getByText("Frostbolt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /event 2.*ice lance/i }));
    expect(within(details).getByText("Ice Lance")).toBeInTheDocument();
  });

  it("reports malformed files without losing the current replay", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText(/choose simc json/i);

    await user.upload(input, reportFile());
    await user.selectOptions(screen.getByRole("combobox", { name: /trace actor/i }), "actor-0");
    expect(screen.getByRole("heading", { name: "First Actor" })).toBeInTheDocument();

    await user.upload(input, new File(["not json"], "broken.json", { type: "application/json" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/broken.json is not valid json/i);
    expect(screen.getByRole("heading", { name: "First Actor" })).toBeInTheDocument();
  });

  it("navigates same-time precombat entries and renders missing remains without inventing values", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText(/choose simc json/i), statefulReportFile());
    const details = screen.getByTestId("selected-event");
    expect(within(details).getByText("First Setup")).toBeInTheDocument();
    expect(screen.getByText("Duration not recorded")).toBeInTheDocument();
    expect(screen.getByText("Cooldown snapshot was not recorded at this event.")).toBeInTheDocument();
    expect(screen.getByText("Target debuff snapshot was not recorded at this event.")).toBeInTheDocument();
    expect(screen.queryByText("No cooldowns were down at this snapshot.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next event/i }));
    expect(within(details).getByText("Second Setup")).toBeInTheDocument();
    expect(within(details).getByText(/recorded snapshot at 0.00s/i)).toBeInTheDocument();
    expect(screen.getByText("Buff snapshot was not recorded at this event.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next event/i }));
    expect(within(details).getByText("First Combat")).toBeInTheDocument();
    expect(screen.getByText("No cooldowns were down at this snapshot.")).toBeInTheDocument();
    expect(screen.getByText("No active target debuffs were recorded at this snapshot.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next event/i }));
    expect(within(details).getByText("Last Combat")).toBeInTheDocument();
    expect(screen.getByText("Configured max charges: 2")).toBeInTheDocument();
    expect(screen.queryByText(/^2 charges$/i)).not.toBeInTheDocument();
  });

  it("pauses playback, reaches the final record, and resets on valid file replacement", async () => {
    let nextFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText(/choose simc json/i);
    await user.upload(input, statefulReportFile());

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    await act(async () => { nextFrame?.(1000); });
    await act(async () => { nextFrame?.(1500); });
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByText(/playback cursor 0.50s/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play" }));
    await act(async () => { nextFrame?.(2000); });
    await act(async () => { nextFrame?.(4000); });
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(within(screen.getByTestId("selected-event")).getByText("Last Combat")).toBeInTheDocument();

    await user.upload(input, statefulReportFile("Replacement Actor", "replacement.json"));
    expect(screen.getByRole("heading", { name: "Replacement Actor" })).toBeInTheDocument();
    expect(within(screen.getByTestId("selected-event")).getByText("First Setup")).toBeInTheDocument();
    expect(screen.getByText(/Loaded replacement.json locally/)).toBeInTheDocument();
  });

  it("uses simulation metadata for the sampled iteration and DPS count for samples", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText(/choose simc json/i);

    await user.upload(input, statefulReportFile("Known Iterations", "known.json", {
      simulationIterations: 5,
      dpsSamples: 1,
      precombatTime: 1.25,
    }));
    expect(screen.getByText(/sampled iteration 1/i)).toBeInTheDocument();
    expect(screen.getByText(/aggregate across 1 sample$/i)).toBeInTheDocument();
    expect(screen.getByText("Source order · 1.25s")).toBeInTheDocument();

    await user.upload(input, statefulReportFile("Unknown Iterations", "unknown.json", {
      dpsSamples: 5,
    }));
    expect(screen.getByText(/sampled iteration not recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/aggregate across 5 samples/i)).toBeInTheDocument();
    expect(screen.queryByText(/sampled iteration 0/i)).not.toBeInTheDocument();
  });

  it("keeps the latest import when an earlier demo succeeds or fails later", async () => {
    const staleDemoText = createDeferred<string>();
    const staleDemoFailure = createDeferred<Response>();
    const latestDemoPayload = await statefulReportFile("Latest Demo", "latest-demo.json").text();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => staleDemoText.promise })
      .mockReturnValueOnce(staleDemoFailure.promise)
      .mockResolvedValueOnce({ ok: true, text: async () => latestDemoPayload });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText(/choose simc json/i);
    const demoButton = screen.getByRole("button", { name: /load bundled demo/i });

    await user.click(demoButton);
    await user.upload(input, statefulReportFile("Latest File", "latest.json"));
    expect(screen.getByRole("heading", { name: "Latest File" })).toBeInTheDocument();

    const stalePayload = await statefulReportFile("Stale Demo", "stale.json").text();
    await act(async () => {
      staleDemoText.resolve(stalePayload);
      await staleDemoText.promise;
    });
    expect(screen.getByRole("heading", { name: "Latest File" })).toBeInTheDocument();

    await user.click(demoButton);
    await user.upload(input, statefulReportFile("Newest File", "newest.json"));
    await act(async () => {
      staleDemoFailure.reject(new Error("stale demo failure"));
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Newest File" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const staleFileText = createDeferred<string>();
    const staleFile = statefulReportFile("Stale File", "stale-file.json");
    Object.defineProperty(staleFile, "text", { value: () => staleFileText.promise });
    await user.upload(input, staleFile);
    await user.click(demoButton);
    expect(screen.getByRole("heading", { name: "Latest Demo" })).toBeInTheDocument();

    staleFileText.resolve(await statefulReportFile("Stale File", "stale-file.json").text());
    await act(async () => { await staleFileText.promise; });
    expect(screen.getByRole("heading", { name: "Latest Demo" })).toBeInTheDocument();
  });


  it("makes the genuine-model scene primary and labels animation as a manual preview", () => {
    render(<App />);

    const scene = screen.getByRole("region", { name: /genuine wow model scene/i });
    expect(within(scene).getByText(/default vulpera/i)).toBeInTheDocument();
    expect(within(scene).getByText(/training dummy/i)).toBeInTheDocument();
    expect(within(scene).getByText(/not synchronized to the sampled simc trace/i)).toBeInTheDocument();
    expect(within(scene).getByRole("combobox", { name: /exported character animation/i })).toBeInTheDocument();
    expect(within(scene).getByRole("button", { name: /play animation/i })).toBeInTheDocument();
    expect(within(scene).getByRole("button", { name: /reset camera/i })).toBeInTheDocument();
  });

});
