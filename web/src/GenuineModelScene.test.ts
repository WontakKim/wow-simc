import { BufferGeometry, Mesh, MeshStandardMaterial, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { configureVulperaMaterials } from "./GenuineModelScene";

describe("configureVulperaMaterials", () => {
  it("uses the exported alpha channel only for the Vulpera eye reflection", () => {
    const root = new Object3D();
    const eyeReflection = new MeshStandardMaterial({ name: "vulperamale_eyereflect" });
    const body = new MeshStandardMaterial({ name: "data-1" });
    root.add(new Mesh(new BufferGeometry(), [eyeReflection, body]));

    configureVulperaMaterials(root);

    expect(eyeReflection.transparent).toBe(true);
    expect(eyeReflection.depthWrite).toBe(false);
    expect(body.transparent).toBe(false);
    expect(body.depthWrite).toBe(true);
  });
});

import type { ReplayEvent } from "./replay";
import { isReplayClipMissing, resolveReplayAnimation } from "./GenuineModelScene";

function makeAction(overrides: Partial<ReplayEvent> = {}): ReplayEvent {
  return {
    key: "combat-0",
    phase: "combat",
    phaseIndex: 0,
    time: 4,
    kind: "action",
    name: "lightning_bolt",
    spellName: "Lightning Bolt",
    id: 188196,
    target: "Fluffy_Pillow",
    queueFailed: false,
    wait: null,
    resources: null,
    buffs: null,
    cooldowns: null,
    targets: null,
    ...overrides,
  };
}

describe("resolveReplayAnimation", () => {
  it.each([
    [318038, "flametongue_weapon", "SpellCastOmni (ID 54 variation 0)"],
    [192106, "lightning_shield", "ShaSpellPrecastBothChannel (ID 862 variation 0)"],
    [191634, "stormkeeper", "ShaSpellPrecastBoth (ID 828 variation 0)"],
    [443454, "ancestral_swiftness", "SpellCastOmni (ID 54 variation 0)"],
    [1219480, "ascendance", "ChannelCastOmniUp (ID 1448 variation 0)"],
    [51505, "lava_burst", "CastStrongUpRight (ID 1148 variation 0)"],
    [188196, "lightning_bolt", "ShaSpellCastBothFront (ID 830 variation 0)"],
    [117014, "elemental_blast", "CastOutStrong (ID 1122 variation 0)"],
    [188389, "flame_shock", "SpellCastDirected (ID 53 variation 0)"],
  ])("maps fixture spell %i to exported clip %s", (id, name, clipName) => {
    const event = makeAction({ id, name, spellName: name.replaceAll("_", " "), time: 2 });

    const resolution = resolveReplayAnimation([event], 0, 2.4);
    expect(resolution).toMatchObject({ kind: "motion", clipName });
    expect(resolution.clipTime).toBeCloseTo(0.4);
  });

  it("keeps waits, failed queues, unsupported actions, future records, and settled gaps idle", () => {
    const wait = makeAction({ kind: "wait", name: "Wait", spellName: null, id: null, queueFailed: null, wait: 0.5 });
    const failed = makeAction({ queueFailed: true });
    const unsupported = makeAction({ id: 1236616, name: "potion", spellName: "Light's Potential" });
    const mapped = makeAction();

    expect(resolveReplayAnimation([wait], 0, 4)).toMatchObject({ kind: "wait", clipTime: 0 });
    expect(resolveReplayAnimation([failed], 0, 4)).toMatchObject({ kind: "failed", clipTime: 0 });
    expect(resolveReplayAnimation([unsupported], 0, 4)).toMatchObject({ kind: "unmapped", clipTime: 0 });
    expect(resolveReplayAnimation([mapped], 0, 3.99)).toMatchObject({ kind: "before", clipTime: 0 });
    expect(resolveReplayAnimation([mapped], 0, 5.2)).toMatchObject({ kind: "settled", clipTime: 0 });
  });

  it("settles at the rounded final viewer-tail boundary", () => {
    const finalEvent = makeAction({ time: 44.213 });

    expect(resolveReplayAnimation([finalEvent], 0, 45.413).kind).toBe("settled");
  });

  it("returns the same pose sample after backward seeks and resets repeats at their own timestamps", () => {
    const first = makeAction({ key: "combat-0", phaseIndex: 0, time: 1 });
    const repeated = makeAction({ key: "combat-1", phaseIndex: 1, time: 3 });
    const firstPose = resolveReplayAnimation([first, repeated], 0, 1.45);

    const repeatedPose = resolveReplayAnimation([first, repeated], 1, 3.2);
    expect(repeatedPose.kind).toBe("motion");
    expect(repeatedPose.clipTime).toBeCloseTo(0.2);
    expect(resolveReplayAnimation([first, repeated], 0, 1.45)).toEqual(firstPose);
  });

  it("reports a missing mapped clip instead of silently substituting a cast", () => {
    const resolution = resolveReplayAnimation([makeAction()], 0, 4.2);

    expect(isReplayClipMissing(resolution, ["Stand (ID 0 variation 0)"])).toBe(true);
    expect(isReplayClipMissing(resolution, [resolution.clipName])).toBe(false);
  });
});
