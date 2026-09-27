import * as matchers from "@testing-library/jest-dom/matchers";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./GenuineModelScene", () => ({
  getLoggedPlaybackEndTime: (timeline: { occurrences: Array<{ castFinish: number | null; impacts: Array<{ time: number }> }> }) =>
    Math.max(0, ...timeline.occurrences.flatMap((occurrence) => occurrence.impacts.map((impact) => impact.time + 1.5))),
  GenuineModelScene: ({ replay }: {
    replay?: {
      selectedIndex: number;
      cursor: number;
      isPlaying: boolean;
      speed: number;
      maxTime: number;
      events: Array<{ spellName: string | null; name: string }>;
      onSelectEvent: (index: number) => void;
      onSeek: (time: number) => void;
      onTogglePlayback: () => void;
      onReset: () => void;
      onSpeedChange: (speed: number) => void;
    } | null;
  }) => (
    <section aria-label="Genuine WoW model scene">
      <span>Default Vulpera</span>
      <span>Training Dummy</span>
      <button type="button" aria-pressed="true">Replay sync</button>
      <button type="button" aria-pressed="false">Manual preview</button>
      <button type="button" aria-pressed="false">Native M2 component preview</button>
      {replay ? (
        <>
          <p data-testid="scene-replay-state">
            {replay.events[replay.selectedIndex]?.spellName ?? replay.events[replay.selectedIndex]?.name}
            {` · ${replay.cursor.toFixed(2)}s · ${replay.speed}×`}
          </p>
          <button type="button" aria-label="Previous event" onClick={() => replay.onSelectEvent(replay.selectedIndex - 1)}>Previous</button>
          <button type="button" onClick={replay.onTogglePlayback}>{replay.isPlaying ? "Pause" : "Play"}</button>
          <button type="button" aria-label="Next event" onClick={() => replay.onSelectEvent(replay.selectedIndex + 1)}>Next</button>
          <button type="button" onClick={replay.onReset}>Reset</button>
          <label>Speed<select value={replay.speed} onChange={(event) => replay.onSpeedChange(Number(event.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label>
          <label>Seek<input aria-label="Seek playback" type="range" value={replay.cursor} min="0" max={replay.maxTime} onChange={(event) => replay.onSeek(Number(event.target.value))} /></label>
        </>
      ) : <p>Replay sync unavailable.</p>}
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

function statefulReportFixture(
  actorName = "State Actor",
  options: StatefulReportOptions = {},
) {
  const simulationOptions = {
    ...(options.simulationIterations === undefined ? {} : { iterations: options.simulationIterations }),
    dbc: { version_used: "Live", Live: { wow_version: "12.1.0.69933" } },
  };
  const precombatTime = options.precombatTime ?? 0;

  return JSON.stringify({
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
  });
}

function reportFixture() {
  return JSON.stringify({
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
  });
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

function successfulResponse(body: string) {
  return { ok: true, status: 200, text: async () => body } as Response;
}

function stubFixture(body: string) {
  const fetchMock = vi.fn().mockResolvedValue(successfulResponse(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("App", () => {
  it("loads the bundled reference automatically without file input and exposes truthful navigation and state", async () => {
    const fixtureRequest = createDeferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(fixtureRequest.promise);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    expect(fetchMock).toHaveBeenCalledWith("/fixture/elemental-shaman-replay.json");
    expect(screen.getByRole("status")).toHaveTextContent(/loading bundled reference/i);
    expect(screen.queryByLabelText(/choose simc json/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load bundled demo/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /genuine wow model scene/i })).toBeInTheDocument();

    fixtureRequest.resolve(successfulResponse(reportFixture()));

    expect(await screen.findByRole("status")).toHaveTextContent(/loaded bundled elemental shaman reference/i);
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

  it("keeps the model scene usable when reference validation fails and retries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(successfulResponse("{}"))
      .mockResolvedValueOnce(successfulResponse(statefulReportFixture("Retried Actor")));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load reference/i);
    expect(alert).toHaveTextContent(/report_version/i);
    expect(screen.getByRole("region", { name: /genuine wow model scene/i })).toBeInTheDocument();
    expect(screen.queryByTestId("selected-event")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry loading reference/i }));

    expect(await screen.findByRole("heading", { name: "Retried Actor" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("navigates same-time precombat entries and renders missing remains without inventing values", async () => {
    stubFixture(statefulReportFixture());
    const user = userEvent.setup();
    render(<App />);

    const details = await screen.findByTestId("selected-event");
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

  it("pauses playback and reaches the final record", async () => {
    let nextFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    stubFixture(statefulReportFixture());

    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("selected-event");

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
  });



  it("accumulates every animation-frame interval before React commits", async () => {
    let nextFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    stubFixture(statefulReportFixture());
    const user = userEvent.setup();
    render(<App />);

    const scene = screen.getByRole("region", { name: /genuine wow model scene/i });
    await within(scene).findByTestId("scene-replay-state");
    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    act(() => {
      nextFrame?.(1000);
      nextFrame?.(1250);
      nextFrame?.(1500);
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("First Combat · 0.50s · 1×");

    act(() => {
      nextFrame?.(2000);
      nextFrame?.(3000);
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("Last Combat · 2.00s · 1×");
    expect(within(scene).getByRole("button", { name: /^Play$/ })).toBeInTheDocument();
  });

  it("keeps paused time out of playback and resumes from the latest seek at half speed", async () => {
    let nextFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    stubFixture(statefulReportFixture());
    const user = userEvent.setup();
    render(<App />);

    const scene = screen.getByRole("region", { name: /genuine wow model scene/i });
    await within(scene).findByTestId("scene-replay-state");
    await user.selectOptions(within(scene).getByRole("combobox", { name: /speed/i }), "0.5");
    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    act(() => {
      nextFrame?.(1000);
      nextFrame?.(1500);
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("First Combat · 0.25s · 0.5×");

    await user.click(within(scene).getByRole("button", { name: /^Pause$/ }));
    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    act(() => {
      nextFrame?.(5000);
      nextFrame?.(5500);
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("First Combat · 0.50s · 0.5×");

    fireEvent.change(within(scene).getByRole("slider", { name: /seek playback/i }), { target: { value: "0" } });
    expect(within(scene).getByRole("button", { name: /^Play$/ })).toBeInTheDocument();
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("0.00s · 0.5×");
    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    act(() => {
      nextFrame?.(8000);
      nextFrame?.(8500);
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("First Combat · 0.25s · 0.5×");
  });

  it("resets the running clock when changing trace actors", async () => {
    let nextFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    stubFixture(reportFixture());
    const user = userEvent.setup();
    render(<App />);

    const actorPicker = await screen.findByRole("combobox", { name: /trace actor/i });
    await user.selectOptions(actorPicker, "actor-0");
    const scene = screen.getByRole("region", { name: /genuine wow model scene/i });
    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    act(() => {
      nextFrame?.(1000);
      nextFrame?.(1500);
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("Frostbolt · 0.50s · 1×");

    await user.selectOptions(actorPicker, "actor-1");
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("1.00s · 1×");
    expect(within(scene).getByRole("button", { name: /^Play$/ })).toBeInTheDocument();
    await user.selectOptions(actorPicker, "actor-0");
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("Frostbolt · 0.00s · 1×");
    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    act(() => {
      nextFrame?.(5000);
      nextFrame?.(5500);
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("Frostbolt · 0.50s · 1×");
  });

  it("honors Pause clicked after an endpoint frame but before React commits", async () => {
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const frameId = ++nextFrameId;
      queuedFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) => queuedFrames.delete(frameId));
    const runFrame = (now: number) => {
      const frame = queuedFrames.entries().next().value;
      if (!frame) throw new Error("No replay frame is queued.");
      const [frameId, callback] = frame;
      queuedFrames.delete(frameId);
      callback(now);
    };
    stubFixture(statefulReportFixture());
    const user = userEvent.setup();
    render(<App />);

    const scene = screen.getByRole("region", { name: /genuine wow model scene/i });
    await within(scene).findByTestId("scene-replay-state");
    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    act(() => {
      runFrame(1000);
      runFrame(1500);
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("0.50s · 1×");

    act(() => {
      runFrame(4000);
      fireEvent.click(within(scene).getByRole("button", { name: /^Pause$/ }));
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("Last Combat · 2.00s · 1×");
    expect(within(scene).getByRole("button", { name: /^Play$/ })).toBeInTheDocument();
    expect(queuedFrames.size).toBe(0);

    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("First Combat · 0.00s · 1×");
    act(() => {
      runFrame(5000);
      runFrame(5500);
    });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("First Combat · 0.50s · 1×");
  });

  it("applies speed to the replay clock and handles endpoint restart and reset", async () => {
    let nextFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    stubFixture(statefulReportFixture());
    const user = userEvent.setup();
    render(<App />);

    const scene = screen.getByRole("region", { name: /genuine wow model scene/i });
    await within(scene).findByTestId("scene-replay-state");
    await user.selectOptions(within(scene).getByRole("combobox", { name: /speed/i }), "2");
    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    await act(async () => { nextFrame?.(1000); });
    await act(async () => { nextFrame?.(1500); });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("First Combat · 1.00s · 2×");

    await act(async () => { nextFrame?.(2600); });
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("Last Combat · 2.00s · 2×");
    expect(within(scene).getByRole("button", { name: /^Play$/ })).toBeInTheDocument();

    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("First Combat · 0.00s · 2×");
    expect(within(scene).getByRole("button", { name: /^Pause$/ })).toBeInTheDocument();

    await user.click(within(scene).getByRole("button", { name: "Reset" }));
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("First Setup · 0.00s · 2×");
    expect(within(scene).getByRole("button", { name: /^Play$/ })).toBeInTheDocument();
  });

  it("does not invent a motion tail for a report without combat-log timing", async () => {
    stubFixture(statefulReportFixture());
    render(<App />);

    const scene = screen.getByRole("region", { name: /genuine wow model scene/i });
    const seek = await within(scene).findByRole("slider", { name: /seek playback/i });
    expect(seek).toHaveAttribute("max", "2");
  });

  it.each([
    {
      caseName: "known simulation iterations",
      actorName: "Known Iterations",
      options: { simulationIterations: 5, dpsSamples: 1, precombatTime: 1.25 },
      expectedIteration: /sampled iteration 1/i,
      expectedSamples: /aggregate across 1 sample$/i,
      unexpectedIteration: /sampled iteration not recorded/i,
    },
    {
      caseName: "unknown simulation iterations",
      actorName: "Unknown Iterations",
      options: { dpsSamples: 5, precombatTime: 1.25 },
      expectedIteration: /sampled iteration not recorded/i,
      expectedSamples: /aggregate across 5 samples/i,
      unexpectedIteration: /sampled iteration [01]/i,
    },
  ])("uses $caseName for the sampled iteration and DPS count", async ({
    actorName,
    options,
    expectedIteration,
    expectedSamples,
    unexpectedIteration,
  }) => {
    stubFixture(statefulReportFixture(actorName, options));
    render(<App />);

    expect(await screen.findByText(expectedIteration)).toBeInTheDocument();
    expect(screen.getByText(expectedSamples)).toBeInTheDocument();
    expect(screen.getByText("Source order · 1.25s")).toBeInTheDocument();
    expect(screen.queryByText(unexpectedIteration)).not.toBeInTheDocument();
  });

  it("makes replay sync the primary scene mode and keeps manual preview separate", async () => {
    stubFixture(statefulReportFixture());
    render(<App />);

    const scene = screen.getByRole("region", { name: /genuine wow model scene/i });
    expect(within(scene).getByText(/default vulpera/i)).toBeInTheDocument();
    expect(within(scene).getByText(/training dummy/i)).toBeInTheDocument();
    expect(within(scene).getByRole("button", { name: "Replay sync" })).toHaveAttribute("aria-pressed", "true");
    expect(within(scene).getByRole("button", { name: "Manual preview" })).toHaveAttribute("aria-pressed", "false");
    expect(within(scene).getByRole("button", { name: "Native M2 component preview" })).toHaveAttribute("aria-pressed", "false");
    expect(within(scene).getByRole("combobox", { name: /exported character animation/i })).toBeInTheDocument();
    expect(within(scene).getByRole("button", { name: /play animation/i })).toBeInTheDocument();
    expect(within(scene).getByRole("button", { name: /reset camera/i })).toBeInTheDocument();
    expect(await screen.findByTestId("selected-event")).toBeInTheDocument();
  });

  it("drives the primary scene from the authoritative replay controls", async () => {
    stubFixture(statefulReportFixture());
    const user = userEvent.setup();
    render(<App />);

    const scene = screen.getByRole("region", { name: /genuine wow model scene/i });
    expect(await within(scene).findByTestId("scene-replay-state")).toHaveTextContent("First Setup · 0.00s · 1×");

    await user.click(within(scene).getByRole("button", { name: /next event/i }));
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("Second Setup · 0.00s · 1×");

    await user.selectOptions(within(scene).getByRole("combobox", { name: /speed/i }), "2");
    expect(within(scene).getByTestId("scene-replay-state")).toHaveTextContent("2×");

    await user.click(within(scene).getByRole("button", { name: /^Play$/ }));
    expect(within(scene).getByRole("button", { name: /^Pause$/ })).toBeInTheDocument();
  });
});
