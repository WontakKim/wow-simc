import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Vector3,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";
import {
  arrangeCombatants,
  configureVulperaMaterials,
  frameModels,
  getReplayEffectAnchors,
  getReplayPlaybackEndTime,
  isReplayClipMissing,
  resolveReplayAnimation,
  resolveReplayEffectOccurrences,
} from "./GenuineModelScene";
import type { ReplayEvent } from "./replay";

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

function createModel(width: number, height: number, depth: number) {
  const model = new Group();
  model.add(new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial()));
  return model;
}

function expectVectorsClose(actual: Vector3, expected: Vector3) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.z).toBeCloseTo(expected.z);
}

function expectBoundsInView(camera: PerspectiveCamera, bounds: Box3) {
  camera.updateMatrixWorld(true);
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new Vector3(x, y, z).project(camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
        expect(projected.z).toBeGreaterThanOrEqual(-1);
        expect(projected.z).toBeLessThanOrEqual(1);
      }
    }
  }
}

describe("ranged scene layout", () => {
  it("places the actual combatant roots 8 scene units apart with their original facing and scale", () => {
    const vulpera = createModel(2, 4, 2);
    const trainingDummy = createModel(2.4, 5, 2);

    arrangeCombatants(vulpera, trainingDummy);

    const vulperaCenter = new Box3().setFromObject(vulpera).getCenter(new Vector3());
    const trainingDummyCenter = new Box3().setFromObject(trainingDummy).getCenter(new Vector3());
    expect(vulperaCenter.x).toBeCloseTo(-4);
    expect(trainingDummyCenter.x).toBeCloseTo(4);
    expect(trainingDummyCenter.x - vulperaCenter.x).toBeCloseTo(8);
    expect(vulpera.rotation.y).toBeCloseTo(0);
    expect(trainingDummy.rotation.y).toBeCloseTo(Math.PI);
    expect(vulpera.scale.toArray()).toEqual([1, 1, 1]);
    expect(trainingDummy.scale.toArray()).toEqual([0.7, 0.7, 0.7]);
  });

  it("fits the ranged bounds at desktop and mobile aspects and restores the responsive default view", () => {
    const vulpera = createModel(2, 4, 2);
    const trainingDummy = createModel(2.4, 5, 2);
    arrangeCombatants(vulpera, trainingDummy);
    const bounds = new Box3()
      .setFromObject(vulpera)
      .union(new Box3().setFromObject(trainingDummy));
    const camera = new PerspectiveCamera(36, 1440 / 620, 0.01, 100);
    const controls = new OrbitControls(camera, document.createElement("canvas"));

    const desktopView = frameModels(camera, controls, bounds);
    expect(camera.fov).toBe(36);
    expectVectorsClose(camera.position, desktopView.position);
    expectVectorsClose(controls.target, desktopView.target);
    expectBoundsInView(camera, bounds);

    camera.aspect = 390 / 430;
    const mobileView = frameModels(camera, controls, bounds);
    expect(camera.fov).toBe(36);
    expectBoundsInView(camera, bounds);
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.far).toBeGreaterThan(camera.near);
    expect(controls.minDistance).toBeGreaterThan(0);
    expect(controls.maxDistance).toBeGreaterThan(controls.minDistance);

    camera.position.set(100, 100, 100);
    controls.target.set(30, 20, 10);
    const resetMobileView = frameModels(camera, controls, bounds);
    expectVectorsClose(resetMobileView.position, mobileView.position);
    expectVectorsClose(resetMobileView.target, mobileView.target);
    expect(resetMobileView.position.toArray()).not.toEqual(desktopView.position.toArray());
    controls.dispose();
  });
});

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

describe("Elemental Blast native replay", () => {
  it("uses the exact successful combat source prefix and keeps prior flights across later records", () => {
    const precombat = makeAction({ key: "precombat-0", phase: "precombat", time: 0, id: 117014, name: "elemental_blast" });
    const first = makeAction({ key: "combat-0", phaseIndex: 0, time: 1, id: 117014, name: "elemental_blast" });
    const wrongId = makeAction({ key: "combat-1", phaseIndex: 1, time: 1, id: 188196, name: "elemental_blast" });
    const wrongName = makeAction({ key: "combat-2", phaseIndex: 2, time: 1, id: 117014, name: "lightning_bolt" });
    const failed = makeAction({ key: "combat-3", phaseIndex: 3, time: 1, id: 117014, name: "elemental_blast", queueFailed: true });
    const wait = makeAction({ key: "combat-4", phaseIndex: 4, time: 1, kind: "wait", name: "Wait", spellName: null, id: null, queueFailed: null, wait: 0.1 });
    const repeated = makeAction({ key: "combat-5", phaseIndex: 5, time: 1, id: 117014, name: "elemental_blast" });
    const laterUnrelated = makeAction({ key: "combat-6", phaseIndex: 6, time: 1.1, id: 1236616, name: "potion" });
    const events = [precombat, first, wrongId, wrongName, failed, wait, repeated, laterUnrelated];
    expect(resolveReplayEffectOccurrences(events, 0, 1.3)).toEqual([]);
    expect(resolveReplayEffectOccurrences(events, 1, 0.99)).toEqual([]);
    expect(resolveReplayEffectOccurrences(events, 1, 1.3).map((effect) => effect.eventKey)).toEqual(["combat-0"]);
    expect(resolveReplayEffectOccurrences(events, 5, 1.3).map((effect) => effect.eventKey)).toEqual(["combat-0"]);
    expect(resolveReplayEffectOccurrences(events, 6, 1.3).map((effect) => effect.eventKey)).toEqual(["combat-0", "combat-5"]);
    expect(resolveReplayEffectOccurrences(events, 7, 1.3).map((effect) => effect.eventKey)).toEqual(["combat-0", "combat-5"]);
  });

  it("uses deterministic release, arrival, and authored-lifespan decay boundaries", () => {
    const event = makeAction({ key: "combat-0", phaseIndex: 0, time: 4, id: 117014, name: "elemental_blast" });
    expect(resolveReplayEffectOccurrences([event], 0, 4.1999)).toEqual([]);
    expect(resolveReplayEffectOccurrences([event], 0, 4.2)).toEqual([{
      eventKey: "combat-0",
      eventTime: 4,
      elapsedSeconds: 0.2,
      componentTimeSeconds: 0,
      spellId: 117014,
      components: [{ fileDataId: 794788, anchor: "projectile" }, { fileDataId: 613807, anchor: "projectile" }],
    }]);
    expect(resolveReplayEffectOccurrences([event], 0, 5)[0]).toMatchObject({ componentTimeSeconds: 0.8 });
    const finalDecaySample = resolveReplayEffectOccurrences([event], 0, 6.5);
    expect(finalDecaySample).toHaveLength(1);
    expect(resolveReplayEffectOccurrences([event], 0, 6.5001)).toEqual([]);
    expect(resolveReplayEffectOccurrences([event], 0, 5)).toEqual(resolveReplayEffectOccurrences([event], 0, 5));
  });

  it("extends only a supported final effect beyond the existing motion tail", () => {
    const earlierElementalBlast = makeAction({ key: "combat-0", phaseIndex: 0, time: 4, id: 117014, name: "elemental_blast" });
    const laterUnrelated = makeAction({ key: "combat-1", phaseIndex: 1, time: 10, id: 1236616, name: "potion" });
    const lateElementalBlast = makeAction({ key: "combat-0", phaseIndex: 0, time: 9, id: 117014, name: "elemental_blast" });

    expect(getReplayPlaybackEndTime([])).toBe(0);
    expect(getReplayPlaybackEndTime([earlierElementalBlast, laterUnrelated])).toBeCloseTo(11.2);
    expect(getReplayPlaybackEndTime([lateElementalBlast, laterUnrelated])).toBeCloseTo(11.5);
    expect(getReplayPlaybackEndTime([{ ...lateElementalBlast, queueFailed: true }, laterUnrelated])).toBeCloseTo(11.2);
  });

  it("derives neutral flight anchors from the arranged model bounds", () => {
    const vulpera = createModel(2, 4, 2);
    const trainingDummy = createModel(2.4, 5, 2);
    arrangeCombatants(vulpera, trainingDummy);
    const casterBounds = new Box3().setFromObject(vulpera);
    const targetBounds = new Box3().setFromObject(trainingDummy);

    const anchors = getReplayEffectAnchors(vulpera, trainingDummy);

    expect(anchors.caster.x).toBeCloseTo(casterBounds.getCenter(new Vector3()).x);
    expect(anchors.target.x).toBeCloseTo(targetBounds.getCenter(new Vector3()).x);
    expect(anchors.caster.y).toBeCloseTo(casterBounds.min.y + casterBounds.getSize(new Vector3()).y * 0.6);
    expect(anchors.target.y).toBeCloseTo(targetBounds.min.y + targetBounds.getSize(new Vector3()).y * 0.6);
    expect(anchors.target.x - anchors.caster.x).toBeCloseTo(8);
  });
});

describe("remaining original replay components", () => {
  it("shows self-applied precombat components at the caster without a release or travel window", () => {
    const self = makeAction({ key: "precombat-0", phase: "precombat", time: 0, id: 318038, name: "flametongue_weapon" });
    const later = makeAction({ key: "combat-0", time: 0.4, id: 188196, name: "lightning_bolt" });
    expect(resolveReplayEffectOccurrences([self, later], 0, 0.1)).toEqual([expect.objectContaining({
      eventKey: "precombat-0", spellId: 318038, componentTimeSeconds: 0.1,
      components: [{ fileDataId: 4006618, anchor: "caster" }],
    })]);
    expect(resolveReplayEffectOccurrences([self, later], 1, 1.71).some((occurrence) => occurrence.spellId === 318038)).toBe(false);
  });

  it("uses target-directed cast/impact kit components without a missile body or projectile travel", () => {
    const cast = makeAction({ time: 4, id: 51505, name: "lava_burst" });
    const lightning = makeAction({ key: "combat-1", time: 4.2, id: 188196, name: "lightning_bolt" });
    const flame = makeAction({ key: "combat-2", time: 4.4, id: 188389, name: "flame_shock" });
    const occurrences = resolveReplayEffectOccurrences([cast, lightning, flame], 2, 4.5);
    expect(occurrences).toEqual([
      expect.objectContaining({ spellId: 51505, componentTimeSeconds: 0.5, components: [
        { fileDataId: 4006621, anchor: "caster" },
        { fileDataId: 4006618, anchor: "target" },
        { fileDataId: 3980244, anchor: "target" },
      ] }),
      expect.objectContaining({ spellId: 188196, componentTimeSeconds: 0.3, components: [
        { fileDataId: 6211618, anchor: "caster" }, { fileDataId: 1571475, anchor: "target" },
      ] }),
      expect.objectContaining({ spellId: 188389, componentTimeSeconds: 0.1, components: [
        { fileDataId: 4006618, anchor: "target" }, { fileDataId: 3980244, anchor: "target" },
        { fileDataId: 4392095, anchor: "target" }, { fileDataId: 4050773, anchor: "target" },
      ] }),
    ]);
    expect(resolveReplayEffectOccurrences([cast], 0, 4.1)).toEqual(resolveReplayEffectOccurrences([cast, lightning, flame], 0, 4.1));
    expect(resolveReplayEffectOccurrences([cast, lightning, flame], 2, 4.5)).toEqual(occurrences);
    expect(resolveReplayEffectOccurrences([cast, lightning, flame], 2, 7)).toEqual([]);
    expect(resolveReplayEffectOccurrences([cast, lightning, flame], 2, 4.5)).toEqual(occurrences);
  });

  it("does not invent a component or tail for Ancestral Swiftness, failed queues, waits or mismatched names", () => {
    const absent = makeAction({ id: 443454, name: "ancestral_swiftness", time: 4 });
    const failed = makeAction({ id: 188196, name: "lightning_bolt", queueFailed: true });
    const wait = makeAction({ kind: "wait", id: null, name: "wait", queueFailed: null });
    const mismatched = makeAction({ id: 51505, name: "lightning_bolt" });
    expect(resolveReplayEffectOccurrences([absent, failed, wait, mismatched], 3, 4.5)).toEqual([]);
    expect(getReplayPlaybackEndTime([absent])).toBe(5.2);
    expect(getReplayPlaybackEndTime([makeAction({ phase: "precombat", id: 318038, name: "flametongue_weapon", time: 0 })])).toBe(1.7);
    expect(getReplayPlaybackEndTime([makeAction({ id: 191634, name: "stormkeeper", time: 4 })])).toBe(5.7);
    expect(getReplayPlaybackEndTime([makeAction({ id: 188196, name: "lightning_bolt", time: 4 })])).toBe(5.7);
  });
});

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
