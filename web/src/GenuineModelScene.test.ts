import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";
import officialFixture from "../public/fixture/elemental-shaman-replay.json";
import {
  REPLAY_SOURCE_ATTACHMENTS,
  arrangeCombatants,
  frameModels,
  getReplayEffectAnchors,
  getReplayEffectSourceAnchor,
  getReplayPlaybackEndTime,
  isReplayClipMissing,
  resolveReplayAnimation,
  resolveReplayEffectOccurrences,
  resolveReplayMotionBlend,
} from "./GenuineModelScene";
import { parseReplayReport, type ReplayEvent } from "./replay";
import { NATIVE_EFFECT_ASSETS } from "./nativeEffectAssets";
import { blendBoneMatrices } from "./m2/sampler";

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
    expect(trainingDummy.scale.toArray()).toEqual([1, 1, 1]);
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
      components: [{ fileDataId: 4329984, anchor: "projectile" }, { fileDataId: 794788, anchor: "projectile" }, { fileDataId: 613807, anchor: "projectile" }],
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

describe("published replay attachment placement", () => {
  it("maps published source components to native attachment ids", () => {
    expect(REPLAY_SOURCE_ATTACHMENTS[191634]).toEqual({ 1355634: 22, 1284864: 22 });
    expect(REPLAY_SOURCE_ATTACHMENTS[51505]).toEqual({ 4329984: 34 });
    expect(REPLAY_SOURCE_ATTACHMENTS[117014]).toEqual({ 4329984: 21, 794788: 22, 613807: 34 });
  });

  it("samples distinct authored hand and chest attachment origins at the requested time", () => {
    const boundsAnchor = new Vector3(1, 2, 3);
    const positions = new Map<number, Vector3>([
      [21, new Vector3(-0.5, 1.0, 0)],
      [22, new Vector3(0.6, 1.1, 0)],
      [34, new Vector3(0.1, 1.5, 0)],
    ]);
    const sampleAttachment = (attachmentId: number) => positions.get(attachmentId) ?? null;

    expect(getReplayEffectSourceAnchor(117014, 4329984, sampleAttachment, boundsAnchor))
      .toBe(positions.get(21));
    expect(getReplayEffectSourceAnchor(117014, 794788, sampleAttachment, boundsAnchor))
      .toBe(positions.get(22));
    expect(getReplayEffectSourceAnchor(117014, 613807, sampleAttachment, boundsAnchor))
      .toBe(positions.get(34));
    expect(getReplayEffectSourceAnchor(51505, 4329984, sampleAttachment, boundsAnchor))
      .toBe(positions.get(34));
    expect(getReplayEffectSourceAnchor(191634, 1355634, sampleAttachment, boundsAnchor))
      .toBe(positions.get(22));
  });

  it("keeps unmapped components at the bounds anchor and fails on missing mapped attachments", () => {
    const boundsAnchor = new Vector3(1, 2, 3);
    const noAttachments = () => null;
    expect(getReplayEffectSourceAnchor(188196, 6211617, noAttachments, boundsAnchor)).toBe(boundsAnchor);
    expect(getReplayEffectSourceAnchor(188196, 6211618, noAttachments, boundsAnchor)).toBe(boundsAnchor);
    expect(() => getReplayEffectSourceAnchor(117014, 4329984, noAttachments, boundsAnchor))
      .toThrow(/FileDataID 4329984.*attachment 21/);
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

  it("flies the original Lava Burst missile while keeping its cast and impact components", () => {
    const cast = makeAction({ time: 4, id: 51505, name: "lava_burst" });
    const lightning = makeAction({ key: "combat-1", time: 4.2, id: 188196, name: "lightning_bolt" });
    const flame = makeAction({ key: "combat-2", time: 4.4, id: 188389, name: "flame_shock" });
    const occurrences = resolveReplayEffectOccurrences([cast, lightning, flame], 2, 4.5);
    expect(occurrences).toEqual([
      expect.objectContaining({ spellId: 51505, componentTimeSeconds: 0.5, components: [
        { fileDataId: 4006621, anchor: "caster" },
        { fileDataId: 4329984, anchor: "projectile" },
        { fileDataId: 4006618, anchor: "target" },
        { fileDataId: 3980244, anchor: "target" },
      ] }),
      expect.objectContaining({ spellId: 188196, componentTimeSeconds: 0.3, components: [
        { fileDataId: 6211618, anchor: "caster" }, { fileDataId: 6211617, anchor: "projectile" },
        { fileDataId: 1571475, anchor: "target" },
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

  it("keeps four overlapping Lightning Bolt cast, missile, and impact components through 2.50 seconds", () => {
    const bolts = [0, 0.4, 0.9, 1.4].map((time, index) => makeAction({
      key: `bolt-${index}`, time, id: 188196, name: "lightning_bolt",
    }));
    expect(resolveReplayEffectOccurrences(bolts, 3, 2.45)).toHaveLength(4);
    expect(resolveReplayEffectOccurrences(bolts, 3, 2.55)).toHaveLength(3);
  });

  it("measures four overlapping Lightning Bolt occurrences from the bundled trace", () => {
    const events = parseReplayReport(officialFixture).actors[0].events;
    const boltEvents = events.filter((event) => event.id === 188196 && event.queueFailed === false);
    const concurrentCounts = boltEvents.map((event) => resolveReplayEffectOccurrences(
      events, events.indexOf(event), event.time,
    ).filter((occurrence) => occurrence.spellId === 188196).length);
    expect(boltEvents).toHaveLength(24);
    expect(Math.max(...concurrentCounts)).toBe(4);
  });

  it("keeps Ancestral Swiftness without a replay component when its mesh shader is unsupported", () => {
    const absent = makeAction({ id: 443454, name: "ancestral_swiftness", time: 4 });
    const failed = makeAction({ id: 188196, name: "lightning_bolt", queueFailed: true });
    const wait = makeAction({ kind: "wait", id: null, name: "wait", queueFailed: null });
    const mismatched = makeAction({ id: 51505, name: "lightning_bolt" });
    expect(resolveReplayEffectOccurrences([absent, failed, wait, mismatched], 3, 4.5)).toEqual([]);
    expect(getReplayPlaybackEndTime([absent])).toBe(5.2);
    expect(getReplayPlaybackEndTime([makeAction({ phase: "precombat", id: 318038, name: "flametongue_weapon", time: 0 })])).toBe(1.7);
    expect(getReplayPlaybackEndTime([makeAction({ id: 191634, name: "stormkeeper", time: 4 })])).toBe(5.7);
    expect(getReplayPlaybackEndTime([makeAction({ id: 188196, name: "lightning_bolt", time: 4 })])).toBe(6.5);
  });
});

describe("resolveReplayAnimation", () => {
  it.each([
    [318038, "flametongue_weapon", 54, "SpellCastOmni (ID 54 variation 0)"],
    [192106, "lightning_shield", 862, "ShaSpellPrecastBothChannel (ID 862 variation 0)"],
    [191634, "stormkeeper", 828, "ShaSpellPrecastBoth (ID 828 variation 0)"],
    [443454, "ancestral_swiftness", 54, "SpellCastOmni (ID 54 variation 0)"],
    [1219480, "ascendance", 1448, "ChannelCastOmniUp (ID 1448 variation 0)"],
    [51505, "lava_burst", 1148, "CastStrongUpRight (ID 1148 variation 0)"],
    [188196, "lightning_bolt", 830, "ShaSpellCastBothFront (ID 830 variation 0)"],
    [117014, "elemental_blast", 1122, "CastOutStrong (ID 1122 variation 0)"],
    [188389, "flame_shock", 53, "SpellCastDirected (ID 53 variation 0)"],
  ])("maps fixture spell %i to native animation %i", (id, name, animationId, clipName) => {
    const event = makeAction({ id, name, spellName: name.replaceAll("_", " "), time: 2 });

    const resolution = resolveReplayAnimation([event], 0, 2.4);
    expect(resolution).toMatchObject({ kind: "motion", clipName, animationId });
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

describe("replay motion transitions", () => {
  it("blends cast to cast at the shortest fixture gap without stealing most of either motion", () => {
    const first = makeAction({ time: 31.598, id: 443454, name: "ancestral_swiftness" });
    const second = makeAction({ key: "combat-1", phaseIndex: 1, time: 32.352, id: 188196, name: "lightning_bolt" });
    const events = [first, second];
    const boundary = resolveReplayMotionBlend(events, 1, 32.352);
    const middle = resolveReplayMotionBlend(events, 1, 32.427);
    const completed = resolveReplayMotionBlend(events, 1, 32.502);

    expect(boundary.incoming.kind).toBe("motion");
    expect(boundary.incomingWeight).toBe(0);
    expect(middle.incomingWeight).toBeCloseTo(0.5);
    expect(middle.outgoing).toMatchObject({ kind: "motion", clipTime: expect.closeTo(0.829, 3) });
    expect(middle.incoming.clipTime).toBeCloseTo(0.075);
    expect(completed.outgoing).toBeNull();
    expect(completed.incomingWeight).toBe(1);
    expect(resolveReplayMotionBlend(events, 1, 32.427)).toEqual(middle);
    const repeated = [makeAction({ time: 31.598 }), makeAction({ key: "combat-1", time: 32.352 })];
    const repeatedBlend = resolveReplayMotionBlend(repeated, 1, 32.427);
    expect(repeatedBlend.outgoing).toMatchObject({ kind: "motion", clipTime: expect.closeTo(0.829, 3) });
    expect(repeatedBlend.incoming).toMatchObject({ kind: "motion", clipTime: expect.closeTo(0.075, 3) });
    expect(repeatedBlend.outgoing?.clipName).toBe(repeatedBlend.incoming.clipName);
    resolveReplayMotionBlend(events, 1, 34);
    expect(resolveReplayMotionBlend(events, 1, 32.427)).toEqual(middle);
  });

  it("blends stand into a cast and casts into settled stand, but keeps idle resolution semantics", () => {
    const event = makeAction();
    const start = resolveReplayMotionBlend([event], 0, 4.075);
    expect(start.incoming.kind).toBe("motion");
    expect(start.outgoing).toMatchObject({ kind: "before", clipName: "Stand (ID 0 variation 0)" });
    expect(start.incomingWeight).toBeCloseTo(0.5);
    const settle = resolveReplayMotionBlend([event], 0, 5.275);
    expect(settle.incoming.kind).toBe("settled");
    expect(settle.outgoing).toMatchObject({ kind: "motion", clipTime: expect.closeTo(1.275, 3) });
    expect(settle.incomingWeight).toBeCloseTo(0.5);
    expect(resolveReplayMotionBlend([event], 0, 5.35).incoming.kind).toBe("settled");
    expect(resolveReplayMotionBlend([event], 0, 3.99).incoming.kind).toBe("before");
    for (const changed of [
      makeAction({ kind: "wait", name: "Wait", id: null, queueFailed: null }),
      makeAction({ queueFailed: true }),
      makeAction({ id: 1236616, name: "potion" }),
    ]) {
      expect(resolveReplayMotionBlend([changed], 0, 4.5).incoming.clipName).toBe("Stand (ID 0 variation 0)");
    }
  });

  it("blends two native poses deterministically from the resolved pair alone", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const raised = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1];
    const blend = (weight: number) => blendBoneMatrices([identity], [raised], weight)[0];

    expect(blend(0)).toEqual(identity);
    expect(blend(1)).toEqual(raised);
    expect(blend(0.5)[13]).toBeCloseTo(1);
    expect(blend(0.5)[5]).toBeCloseTo(1);
    const halfway = blend(0.5);
    blend(0.9);
    expect(blend(0.5)).toEqual(halfway);
  });
});

describe("original missile fallback", () => {
  it("maps the coherent shared missile into both spells without substituting the blocked body", () => {
    const lava = makeAction({ id: 51505, name: "lava_burst" });
    const blast = makeAction({ id: 117014, name: "elemental_blast" });
    expect(resolveReplayEffectOccurrences([lava], 0, 4.5)[0].components
      .filter((component) => component.anchor === "projectile").map((component) => component.fileDataId))
      .toEqual([4329984]);
    expect(resolveReplayEffectOccurrences([blast], 0, 4.5)[0].components.map((component) => component.fileDataId))
      .toEqual([4329984, 794788, 613807]);
    expect(resolveReplayEffectOccurrences([{ ...blast, phase: "precombat" }], 0, 4.5)).toEqual([]);
  });

  it("measures the shared three-slot and unique two-slot bounds from the public trace", () => {
    const events = parseReplayReport(officialFixture).actors[0].events;
    const missiles = events.filter((event) => (event.id === 51505 || event.id === 117014) && event.queueFailed === false);
    expect(missiles.filter((event) => event.id === 51505)).toHaveLength(12);
    expect(missiles.filter((event) => event.id === 117014)).toHaveLength(8);
    const samples = missiles.flatMap((event) => [event.time + 0.2, event.time + 2.5]);
    const counts = samples.map((time) => {
      const active = resolveReplayEffectOccurrences(events, events.length - 1, time);
      return [51505, 117014].map((spellId) => active.filter((effect) => effect.spellId === spellId).length);
    });
    expect(Math.max(...counts.map(([lava, blast]) => lava))).toBe(2);
    expect(Math.max(...counts.map(([lava, blast]) => blast))).toBe(2);
    expect(Math.max(...counts.map(([lava, blast]) => lava + blast))).toBe(3);
  });

  it("pins authored scales for the renderable missiles without loading rejected body 3980281", () => {
    expect([4329984, 794788, 613807].map((fileDataId) =>
      [fileDataId, NATIVE_EFFECT_ASSETS.find((asset) => asset.fileDataId === fileDataId)?.effectNameScale]))
      .toEqual([[4329984, 1.4], [794788, 2], [613807, 1]]);
    expect(NATIVE_EFFECT_ASSETS.some((asset) => asset.fileDataId === 3980281)).toBe(false);
  });
});
