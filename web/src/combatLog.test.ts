import { describe, expect, it } from "vitest";
import { buildCombatTimeline, parseCombatLog } from "./combatLog";
import { parseReplayReport } from "./replay";
import fixture from "../public/fixture/elemental-shaman-replay.json";

const player = "Player 'MID2_Shaman_Elemental_Farseer'";
const ancestor = "Player 'MID2_Shaman_Elemental_Farseer_ancestor'";
const excerpt = [
  `0.000 ${ancestor} arises. Spawn Index=3`,
  `0.000 ${ancestor} arises. Spawn Index=4`,
  `0.000 ${player} gains Buff 'stormkeeper' (191634) (stacks=2) (value=1.5)`,
  ...Array.from({ length: 3 }, () => `0.400 ${player} schedules execute for Action 'lava_burst_overload_asc' (285466)`),
  ...Array.from({ length: 3 }, () => [
    `0.400 ${player} performs Action 'lava_burst_overload_asc' (285466) (275000)`,
    `0.400 ${player} schedules travel (0.600) for Action 'lava_burst_overload_asc' (285466)`,
  ]).flat(),
  ...Array.from({ length: 3 }, () => `1.000 ${player} Action 'lava_burst_overload_asc' (285466) hits Enemy 'Fluffy_Pillow' for 27656 fire damage (crit)`),
  `1.777 ${player} decrements Buff 'stormkeeper' (191634) by 1 to 1 stacks`,
  `2.574 ${player} schedules execute for Action 'lava_burst' (51505)`,
  `3.650 ${player} performs Action 'lava_burst' (51505) (275000)`,
  `3.650 ${player} schedules travel (0.600) for Action 'lava_burst' (51505)`,
  `3.655 ${player} loses Buff 'stormkeeper' (191634) (stacks=0)`,
  `4.250 ${player} Action 'lava_burst' (51505) hits Enemy 'Fluffy_Pillow' for 128572 fire damage (crit)`,
  `4.250 ${ancestor} performs Action 'lava_burst' (447419) (0)`,
  `4.250 ${ancestor} schedules travel (0.600) for Action 'lava_burst' (447419)`,
  `4.250 ${ancestor} performs Action 'lava_burst' (447419) (0)`,
  `4.250 ${ancestor} schedules travel (0.600) for Action 'lava_burst' (447419)`,
  `4.850 ${ancestor} Action 'lava_burst' (447419) hits Enemy 'Fluffy_Pillow' for 30000 fire damage (crit)`,
  `4.850 ${ancestor} Action 'lava_burst' (447419) hits Enemy 'Fluffy_Pillow' for 40000 fire damage (crit)`,
  `5.402 Player 'MID2_Shaman_Elemental_Farseer_primal_storm_elemental' schedules execute for Action 'stormfury_aoe' (269005)`,
  `5.402 Player 'MID2_Shaman_Elemental_Farseer_primal_storm_elemental' Action 'stormfury_aoe' (269005) hits Enemy 'Fluffy_Pillow' for 24000 nature damage (hit)`,
];

describe("combat log timing", () => {
  it("reads actual pinned-run timing from the bundled fixture", () => {
    const timeline = parseReplayReport(fixture).combatTimeline!;
    expect(timeline.occurrences.find((occurrence) => occurrence.actor === "MID2_Shaman_Elemental_Farseer"
      && occurrence.actionName === "lava_burst" && occurrence.castStart === 2.574))
      .toMatchObject({ castFinish: 3.65, travelDuration: 0.6, impacts: [{ time: 4.25 }] });
    expect(timeline.occurrences.filter((occurrence) => occurrence.actionName === "lava_burst_overload_asc"
      && occurrence.travelStart === 0.4)).toHaveLength(3);
    expect(timeline.occurrences.some((occurrence) => occurrence.actionName === "lightning_bolt"
      && occurrence.travelDuration === 0.5)).toBe(true);
    expect(timeline.occurrences.some((occurrence) => occurrence.actionName === "lightning_bolt_overload"
      && occurrence.travelDuration === 0.6)).toBe(true);
    expect(timeline.occurrences.some((occurrence) => occurrence.actionName === "stormfury_aoe"
      && occurrence.castFinish === null && occurrence.impacts.length > 0)).toBe(true);
    expect(timeline.occurrences.find((occurrence) => occurrence.actionName === "flame_shock"
      && occurrence.castFinish === 22.592)?.impacts[0]?.time).toBe(22.592);
    expect(timeline.unmatched.some((event) => event.actionName === "flame_shock" && event.time === 23.242)).toBe(true);
  });
  it("preserves source order, cast interval, travel and logged impact rather than treating mana as duration", () => {
    const events = parseCombatLog(excerpt);
    expect(events.map((event) => event.ordinal)).toEqual(excerpt.map((_, index) => index));
    const timeline = buildCombatTimeline(events);
    expect(timeline.occurrences.find((occurrence) => occurrence.actionName === "lava_burst" && occurrence.spellId === 51505))
      .toMatchObject({ castStart: 2.574, castFinish: 3.65, travelStart: 3.65, travelDuration: 0.6, impacts: [{ time: 4.25 }] });
    expect(timeline.occurrences.filter((occurrence) => occurrence.actionName === "lava_burst_overload_asc"))
      .toHaveLength(3);
    expect(timeline.occurrences.filter((occurrence) => occurrence.actionName === "lava_burst_overload_asc").every((occurrence) =>
      occurrence.isBackground && occurrence.castStart === null && occurrence.impacts[0]?.time === 1)).toBe(true);
  });

  it("retains separate targets on one uniquely timed cast without borrowing a different cast", () => {
    const timeline = buildCombatTimeline(parseCombatLog([
      `1.000 ${player} performs Action 'lightning_bolt' (188196) (275000)`,
      `1.000 ${player} schedules travel (0.500) for Action 'lightning_bolt' (188196)`,
      `1.500 ${player} Action 'lightning_bolt' (188196) hits Enemy 'First' for 100 nature damage (hit)`,
      `1.500 ${player} Action 'lightning_bolt' (188196) hits Enemy 'Second' for 100 nature damage (crit)`,
      `1.750 ${player} Action 'lightning_bolt' (188196) hits Enemy 'Late' for 100 nature damage (hit)`,
    ]));
    expect(timeline.occurrences).toHaveLength(1);
    expect(timeline.occurrences[0].impacts.map((impact) => [impact.ordinal, impact.target]))
      .toEqual([[2, "First"], [3, "Second"]]);
    expect(timeline.unmatched.map((event) => [event.time, event.target])).toEqual([[1.75, "Late"]]);
  });

  it("leaves surplus simultaneous impacts unmatched when multiple casts remain compatible", () => {
    const timeline = buildCombatTimeline(parseCombatLog([
      `1.000 ${player} performs Action 'lightning_bolt_overload' (45284) (275000)`,
      `1.000 ${player} schedules travel (0.500) for Action 'lightning_bolt_overload' (45284)`,
      `1.000 ${player} performs Action 'lightning_bolt_overload' (45284) (275000)`,
      `1.000 ${player} schedules travel (0.500) for Action 'lightning_bolt_overload' (45284)`,
      `1.500 ${player} Action 'lightning_bolt_overload' (45284) hits Enemy 'First' for 100 nature damage (hit)`,
      `1.500 ${player} Action 'lightning_bolt_overload' (45284) hits Enemy 'Second' for 100 nature damage (hit)`,
      `1.500 ${player} Action 'lightning_bolt_overload' (45284) hits Enemy 'Third' for 100 nature damage (hit)`,
    ]));
    expect(timeline.occurrences.map((occurrence) => occurrence.impacts.map((impact) => impact.target)))
      .toEqual([["First"], ["Second"]]);
    expect(timeline.unmatched.map((event) => event.target)).toEqual(["Third"]);
  });

  it("does not assign a later travel to an earlier non-projectile perform", () => {
    const timeline = buildCombatTimeline(parseCombatLog([
      `1.000 ${player} performs Action 'flame_shock' (188389) (275000)`,
      `1.500 ${player} performs Action 'flame_shock' (188389) (275000)`,
      `1.500 ${player} schedules travel (0.500) for Action 'flame_shock' (188389)`,
      `2.000 ${player} Action 'flame_shock' (188389) hits Enemy 'Fluffy_Pillow' for 100 fire damage (hit)`,
    ]));
    expect(timeline.occurrences[0].travelStart).toBeNull();
    expect(timeline.occurrences[1]).toMatchObject({ travelStart: 1.5, impacts: [{ time: 2 }] });
  });

  it("keeps duplicated ancestor names separate by stable round-robin presentation slots and unmatched hits visible", () => {
    const timeline = buildCombatTimeline(parseCombatLog(excerpt));
    expect(timeline.occurrences.filter((occurrence) => occurrence.spellId === 447419).map((occurrence) => occurrence.actorInstance))
      .toEqual(["MID2_Shaman_Elemental_Farseer_ancestor#3", "MID2_Shaman_Elemental_Farseer_ancestor#4"]);
    expect(timeline.occurrences.find((occurrence) => occurrence.actionName === "stormfury_aoe"))
      .toMatchObject({ castFinish: null, impacts: [{ time: 5.402 }] });
    expect(timeline.auras.filter((aura) => aura.name === "stormkeeper").map((aura) => [aura.time, aura.stacks]))
      .toEqual([[0, 2], [1.777, 1], [3.655, 0]]);
  });
});
