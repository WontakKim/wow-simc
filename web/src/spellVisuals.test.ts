import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import type { CombatTimeline } from "./combatLog";
import { composeAttachmentTransform, getPreviewVisual, resolveVisualAnimation, scheduleVisualPhases, sampleKitStart } from "./spellVisuals";

const occurrence: CombatTimeline["occurrences"][number] = {
  key: "caster/1", actor: "caster", actorInstance: "caster", actionName: "lava_burst", family: "lava_burst",
  spellId: 51505, isBackground: false, castStart: 2, castFinish: 3, travelStart: 3,
  travelDuration: 0.7, impacts: [{ time: 3.7, ordinal: 4, target: "dummy", result: "hit" }], ordinal: 1,
};

const event = (id: number, start: number, end: number, target: number) => ({
  ID: id, StartEvent: start, EndEvent: end, TargetType: target,
  StartMinOffsetMs: 0, StartMaxOffsetMs: 0, EndMinOffsetMs: 0, EndMaxOffsetMs: 0,
  SpellVisualKitID: 10, SpellVisualID: 20,
});

describe("spell visual phases", () => {
  it("binds supported raw rows to logged times, leaving unknown rows visible but unscheduled", () => {
    const timeline: CombatTimeline = { occurrences: [occurrence], auras: [
      { time: 2.5, ordinal: 2, actor: "caster", name: "stormkeeper", spellId: 191634, stacks: 1, transition: "gain" },
      { time: 4, ordinal: 5, actor: "caster", name: "stormkeeper", spellId: 191634, stacks: 0, transition: "loss" },
    ], unmatched: [] };
    const scheduled = scheduleVisualPhases(timeline, [event(1, 1, 2, 1), event(2, 3, 13, 1), event(3, 6, 13, 4), event(4, 99, 13, 1)]);
    expect(scheduled.phases.filter((phase) => phase.occurrenceKey === occurrence.key).map((phase) => [phase.phase, phase.time]))
      .toEqual([["castStart", 2], ["castFinish", 3], ["missile", 3], ["impact", 3.7]]);
    expect(scheduled.kits.map((kit) => [kit.sourceRowId, kit.time])).toEqual([[1, 2], [2, 3], [3, 3.7]]);
    expect(scheduled.unbound.map((row) => row.ID)).toEqual([4]);
    expect(scheduled.phases.filter((phase) => phase.phase.startsWith("aura")).map((phase) => [phase.phase, phase.time]))
      .toEqual([["auraGain", 2.5], ["auraLoss", 4]]);
  });

  it("binds the pinned Stormkeeper precast only to a complete cast and the hand aura to its logged loss", () => {
    const rows = getPreviewVisual(191634)!.events.filter((row) => row.ID === 115368 || row.ID === 115369);
    const timeline: CombatTimeline = { occurrences: [
      { ...occurrence, key: "precombat", actionName: "stormkeeper", spellId: 191634, castStart: null, castFinish: 0 },
      { ...occurrence, key: "later", actionName: "stormkeeper", spellId: 191634, castStart: 8, castFinish: 9 },
    ], auras: [
      { time: 0, ordinal: 1, actor: "caster", name: "stormkeeper", spellId: 191634, stacks: 2, transition: "gain" },
      { time: 3.655, ordinal: 2, actor: "caster", name: "stormkeeper", spellId: 191634, stacks: 0, transition: "loss" },
    ], unmatched: [] };
    const kits = scheduleVisualPhases(timeline, rows, 191634).kits;
    expect(kits.filter((kit) => kit.sourceRowId === 115368)).toMatchObject([
      { occurrenceKey: "later", time: 8, endTime: 9 },
    ]);
    expect(kits.filter((kit) => kit.sourceRowId === 115369)).toMatchObject([
      { occurrenceKey: "aura-1", time: 0, endTime: 3.655 },
    ]);
  });

  it("keeps each impact's ordinal and target separate and applies signed end offsets only to verified ends", () => {
    const repeated = { ...occurrence, impacts: [
      { time: 3.7, ordinal: 4, target: "A", result: "hit" },
      { time: 3.7, ordinal: 5, target: "B", result: "hit" },
    ] };
    const bounded = { ...event(8, 1, 2, 1), EndMinOffsetMs: 50, EndMaxOffsetMs: 50 };
    const schedule = scheduleVisualPhases({ occurrences: [repeated], auras: [], unmatched: [] },
      [bounded, event(9, 6, 13, 4)]).kits;
    expect(schedule.find((kit) => kit.sourceRowId === 8)).toMatchObject({ time: 2, endTime: 3.05 });
    expect(schedule.filter((kit) => kit.sourceRowId === 9)).toMatchObject([
      { impactOrdinal: 4, impactTarget: "A", time: 3.7 },
      { impactOrdinal: 5, impactTarget: "B", time: 3.7 },
    ]);
  });

  it("samples delays deterministically and preserves signed event offsets", () => {
    expect(sampleKitStart("caster/1", event(1, 1, 2, 1), 2, 0.2)).toBe(2.2);
    const delayed = { ...event(5, 1, 2, 1), StartMinOffsetMs: -50, StartMaxOffsetMs: -50 };
    expect(sampleKitStart("caster/1", delayed, 2, 0)).toBe(1.95);
    expect(sampleKitStart("caster/1", { ...delayed, StartMaxOffsetMs: 50 }, 2, 0))
      .toBe(sampleKitStart("caster/1", { ...delayed, StartMaxOffsetMs: 50 }, 2, 0));
    const kitDelayed = { ...event(6, 6, 13, 4), kit: { DelayMin: 50, DelayMax: 50 } };
    expect(scheduleVisualPhases({ occurrences: [occurrence], auras: [], unmatched: [] }, [kitDelayed]).kits[0].time)
      .toBe(3.75);
  });
});

describe("visual animation and attachment frame", () => {
  it("chooses precast/loop and release from authored animation, with fallback provenance", () => {
    const authored = { InitialAnimID: 51, LoopAnimID: 52, AnimKitID: 0 };
    expect(resolveVisualAnimation(authored, "prepare", 1148)).toEqual({ animationId: 51, provenance: "SpellVisualAnim" });
    expect(resolveVisualAnimation(authored, "loop", 1148)).toEqual({ animationId: 52, provenance: "SpellVisualAnim" });
    expect(resolveVisualAnimation({ InitialAnimID: 53, LoopAnimID: 0, AnimKitID: 0 }, "release", 1148))
      .toEqual({ animationId: 53, provenance: "SpellVisualAnim" });
    expect(resolveVisualAnimation(null, "release", 1148)).toEqual({ animationId: 1148, provenance: "viewer fallback" });
  });

  it("rotates authored offset in the bone attachment frame before orientation and scale", () => {
    const frame = new Matrix4().makeRotationZ(Math.PI / 2).setPosition(2, 3, 4);
    const result = composeAttachmentTransform(frame.toArray(), [0, 0.15, 0], [0, Math.PI / 2, 0], 2);
    const matrix = new Matrix4().fromArray(result);
    expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([1.85, 3, 4]);
    expect(new Vector3(1, 0, 0).applyMatrix4(matrix).sub(new Vector3().setFromMatrixPosition(matrix)).length()).toBeCloseTo(2);
  });
});
