import { describe, expect, it } from "vitest";
import { findEventAtOrBefore, parseReplayReport, ReplayValidationError } from "./replay";
import officialFixture from "../public/fixture/elemental-shaman-replay.json";

const fullStateReport = {
  report_version: "2.0.0",
  version: "1210-01",
  git_revision: "abc123",
  timestamp: "2026-09-25T12:00:00Z",
  logs: [{ level: "warning", message: "Recorded diagnostic" }],
  sim: {
    options: {
      iterations: 1,
      dbc: {
        version_used: "Live",
        Live: { wow_version: "12.1.0.69933" },
      },
    },
    players: [
      {
        name: "Trace Actor",
        specialization: "Elemental Shaman",
        role: "spell",
        collected_data: {
          dps: { mean: 12345.67, count: 1 },
          fight_length: { mean: 10 },
          action_sequence_precombat: [
            {
              time: 0,
              id: 100,
              name: "first_setup",
              spell_name: "First Setup",
              target: "none",
              queue_failed: false,
              resources: { mana: 100 },
              resources_max: { mana: 100 },
            },
            {
              time: 0,
              id: 101,
              name: "second_setup",
              spell_name: "Second Setup",
              target: "none",
              queue_failed: false,
              resources: { mana: 100 },
              resources_max: { mana: 100 },
            },
          ],
          action_sequence: [
            {
              time: 0,
              id: 200,
              name: "lightning_bolt",
              spell_name: "Lightning Bolt",
              target: "target_dummy",
              queue_failed: false,
              resources: { mana: 90, maelstrom: 10 },
              resources_max: { mana: 100, maelstrom: 100 },
              buffs: [{ id: 300, name: "surge", stacks: 2, remains: 4.5 }],
              cooldowns: [{ id: 400, name: "stormkeeper", stacks: 1, remains: 20 }],
              targets: [
                {
                  name: "target_dummy",
                  debuffs: [{ id: 500, name: "flame_shock", stack: 1, remains: 12 }],
                },
              ],
            },
            {
              time: 0,
              wait: 0.25,
              resources: { mana: 90, maelstrom: 10 },
              resources_max: { mana: 100, maelstrom: 100 },
              cooldowns: [],
              targets: [],
            },
            {
              time: 2.5,
              id: 201,
              name: "lava_burst",
              spell_name: "Lava Burst",
              target: "target_dummy",
              queue_failed: true,
              resources: { mana: 85, maelstrom: 20 },
              resources_max: { mana: 100, maelstrom: 100 },
              cooldowns: [],
              targets: [],
            },
          ],
        },
      },
    ],
  },
};

describe("parseReplayReport", () => {
  it("preserves phases, source order, wait records, and full recorded state", () => {
    const report = parseReplayReport(fullStateReport);
    const actor = report.actors[0];

    expect(report).toMatchObject({
      reportVersion: "2.0.0",
      engineVersion: "1210-01",
      environment: "Live",
      gameVersion: "12.1.0.69933",
      simulationIterations: 1,
    });
    expect(report.diagnostics).toEqual([{ level: "warning", message: "Recorded diagnostic" }]);
    expect(actor.events.map(({ phase, time, kind, name }) => ({ phase, time, kind, name }))).toEqual([
      { phase: "precombat", time: 0, kind: "action", name: "first_setup" },
      { phase: "precombat", time: 0, kind: "action", name: "second_setup" },
      { phase: "combat", time: 0, kind: "action", name: "lightning_bolt" },
      { phase: "combat", time: 0, kind: "wait", name: "Wait" },
      { phase: "combat", time: 2.5, kind: "action", name: "lava_burst" },
    ]);
    expect(actor.events[2]).toMatchObject({
      spellName: "Lightning Bolt",
      resources: [
        { name: "maelstrom", value: 10, max: 100 },
        { name: "mana", value: 90, max: 100 },
      ],
      buffs: [{ id: 300, name: "surge", stacks: 2, remains: 4.5 }],
      cooldowns: [{ id: 400, name: "stormkeeper", maxCharges: 1, remains: 20 }],
      targets: [{
        name: "target_dummy",
        debuffs: [{ id: 500, name: "flame_shock", stacks: 1, remains: 12 }],
      }],
    });
    expect(actor.events[3]).toMatchObject({ wait: 0.25, id: null, queueFailed: null });
    expect(actor.events[4].queueFailed).toBe(true);
    expect(actor.hasFullState).toBe(true);
  });


  it("keeps simulation iterations separate from aggregate DPS sample count", () => {
    const oneSampleManyIterations = structuredClone(fullStateReport);
    oneSampleManyIterations.sim.options.iterations = 5;
    oneSampleManyIterations.sim.players[0].collected_data.dps.count = 1;

    expect(parseReplayReport(oneSampleManyIterations)).toMatchObject({
      simulationIterations: 5,
      actors: [{ aggregateDpsSamples: 1 }],
    });

    const unknownIterations = structuredClone(oneSampleManyIterations);
    delete (unknownIterations.sim.options as { iterations?: number }).iterations;
    expect(parseReplayReport(unknownIterations).simulationIterations).toBeNull();
  });

  it("parses the real trimmed full-state engine fixture", () => {
    const report = parseReplayReport(officialFixture);
    const actor = report.actors[0];

    expect(actor.name).toBe("MID2_Shaman_Elemental_Farseer");
    expect(actor.events).toHaveLength(59);
    expect(actor.hasFullState).toBe(true);
    expect(actor.events.some((event) => event.cooldowns?.length)).toBe(true);
    expect(actor.events.some((event) => event.targets?.length)).toBe(true);
    expect(actor.events.some((event) => event.buffs?.some((buff) => buff.remains === "indefinite"))).toBe(true);
    expect(report.diagnostics.some((diagnostic) => diagnostic.level === "implementation_not_yet_verified")).toBe(true);
  });

  it("keeps absent legacy full-state fields unknown instead of inventing empty snapshots", () => {
    const partial = structuredClone(fullStateReport);
    const event = partial.sim.players[0].collected_data.action_sequence[0] as Record<string, unknown>;
    delete event.cooldowns;
    delete event.targets;
    delete event.buffs;

    const parsed = parseReplayReport(partial).actors[0].events[2];
    expect(parsed.buffs).toBeNull();
    expect(parsed.cooldowns).toBeNull();
    expect(parsed.targets).toBeNull();
  });

  it.each([
    [{ ...fullStateReport, report_version: "3.0.0" }, "report_version 2.0.0"],
    [{ ...fullStateReport, sim: { players: [] } }, "action trace"],
    [
      {
        ...fullStateReport,
        sim: {
          ...fullStateReport.sim,
          players: [{
            ...fullStateReport.sim.players[0],
            collected_data: {
              ...fullStateReport.sim.players[0].collected_data,
              action_sequence: [{ time: -1, wait: 1, resources: {}, resources_max: {} }],
            },
          }],
        },
      },
      "time",
    ],
    [
      {
        ...fullStateReport,
        sim: {
          ...fullStateReport.sim,
          players: [{
            ...fullStateReport.sim.players[0],
            collected_data: {
              ...fullStateReport.sim.players[0].collected_data,
              action_sequence: [{ time: 0, wait: 1, resources: { mana: "full" }, resources_max: {} }],
            },
          }],
        },
      },
      "resources.mana",
    ],
  ])("rejects malformed input with an actionable error", (input, message) => {
    expect(() => parseReplayReport(input)).toThrowError(ReplayValidationError);
    expect(() => parseReplayReport(input)).toThrow(message);
  });
});

describe("findEventAtOrBefore", () => {
  it("selects the last combat record at or before a cursor and preserves same-time order", () => {
    const events = parseReplayReport(fullStateReport).actors[0].events;
    expect(findEventAtOrBefore(events, 0)).toBe(3);
    expect(findEventAtOrBefore(events, 1)).toBe(3);
    expect(findEventAtOrBefore(events, 2.5)).toBe(4);
  });
});
