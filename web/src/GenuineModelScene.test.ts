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
  isReplayClipMissing,
  resolveReplayAnimation,
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
