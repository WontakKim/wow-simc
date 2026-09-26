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
  REPLAY_COMPONENT_INSTANCE_LIMITS,
  arrangeCombatants,
  frameModels,
  getReplayEffectAnchors,
  getReplayEffectSourceAnchor,
  isReplayClipMissing,
  resolveLoggedEffectOccurrences,
  resolveLoggedMotionBlend,
  resolveLoggedAnimation,
  getLoggedPlaybackEndTime,
} from "./GenuineModelScene";
import { parseReplayReport, type ReplayEvent } from "./replay";
import type { CombatTimeline } from "./combatLog";
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

describe("logged native replay scheduling", () => {
  const timeline = parseReplayReport(officialFixture).combatTimeline!;
  it("holds precast until the logged finish and leaves overloads out of the foreground pose", () => {
    expect(resolveLoggedAnimation(timeline, 3).kind).toBe("motion");
    expect(resolveLoggedAnimation(timeline, 3).eventLabel).toBe("Lava Burst");
    expect(resolveLoggedAnimation(timeline, 0.5).eventLabel).not.toMatch(/overload/);
    expect(resolveLoggedAnimation(timeline, 3.66).eventLabel).not.toBe("Lava Burst");
  });
  it("releases at finish, flies until hit, then shows impact only after hit", () => {
    const before = resolveLoggedEffectOccurrences(timeline, 3.649).filter((effect) => effect.spellId === 51505 && effect.eventTime === 3.65);
    expect(before.some((effect) => effect.components.some((component) => component.anchor === "projectile"))).toBe(false);
    const flight = resolveLoggedEffectOccurrences(timeline, 3.95).find((effect) => effect.spellId === 51505 && effect.eventTime === 3.65)!;
    expect(flight.components.some((component) => component.anchor === "projectile")).toBe(true);
    expect(flight.components.some((component) => component.anchor === "target")).toBe(false);
    expect(flight.componentTimeSeconds).toBeCloseTo(0.3);
    const impact = resolveLoggedEffectOccurrences(timeline, 4.25).find((effect) => effect.spellId === 51505 && effect.eventTime === 3.65)!;
    expect(impact.components.some((component) => component.anchor === "target")).toBe(true);
    expect(impact.components.some((component) => component.anchor === "projectile")).toBe(false);
  });
  it("preserves aura visibility until loss and uses the final logged hit for playback bounds", () => {
    expect(resolveLoggedEffectOccurrences(timeline, 3.6).some((effect) => effect.spellId === 191634)).toBe(true);
    expect(resolveLoggedEffectOccurrences(timeline, 3.655).some((effect) => effect.spellId === 191634)).toBe(false);
    expect(getLoggedPlaybackEndTime(timeline)).toBeGreaterThan(45);
  });
  it("keeps unmatched events seekable without inventing an execution", () => {
    expect(getLoggedPlaybackEndTime({ ...timeline, unmatched: [
      ...timeline.unmatched, { ordinal: 9999, time: 50, actor: "Enemy", kind: "impact" },
    ] })).toBe(50);
    expect(resolveLoggedAnimation(timeline, 3.5)).toEqual(resolveLoggedAnimation(timeline, 3.5));
    expect(resolveLoggedEffectOccurrences(timeline, 3.95)).toEqual(resolveLoggedEffectOccurrences(timeline, 3.95));
  });

  it("reproduces cast poses and original effects across reset, backward seek and repeated casts", () => {
    const firstPose = resolveLoggedMotionBlend(timeline, 2.649);
    const flight = resolveLoggedEffectOccurrences(timeline, 3.95);
    const repeatedPose = resolveLoggedMotionBlend(timeline, 33.42);
    resolveLoggedMotionBlend(timeline, 33.7);
    resolveLoggedEffectOccurrences(timeline, 0);
    resolveLoggedMotionBlend(timeline, 0);
    expect(resolveLoggedMotionBlend(timeline, 2.649)).toEqual(firstPose);
    expect(resolveLoggedEffectOccurrences(timeline, 3.95)).toEqual(flight);
    expect(resolveLoggedMotionBlend(timeline, 33.42)).toEqual(repeatedPose);
  });

  it("reports missing mapped native clips rather than substituting stand or another cast", () => {
    const active = resolveLoggedAnimation(timeline, 3.2);
    expect(active).toMatchObject({ kind: "motion", animationId: 1148 });
    expect(isReplayClipMissing(active, ["Stand (ID 0 variation 0)"])).toBe(true);
    expect(isReplayClipMissing(active, [active.clipName])).toBe(false);
    const isolated = { ...timeline, occurrences: timeline.occurrences.filter((occurrence) => occurrence.actionName === "lava_burst" && occurrence.castStart === 2.574) };
    expect(isReplayClipMissing(resolveLoggedAnimation(isolated, 3.9), ["Stand (ID 0 variation 0)"])).toBe(false);
  });

  it("blends stand into the logged Lava Burst precast and release into stand without shifting either boundary", () => {
    const isolated = { ...timeline, occurrences: timeline.occurrences.filter((occurrence) =>
      occurrence.actionName === "lava_burst" && occurrence.castStart === 2.574) };
    const before = resolveLoggedMotionBlend(isolated, 2.573);
    const boundary = resolveLoggedMotionBlend(isolated, 2.574);
    const middle = resolveLoggedMotionBlend(isolated, 2.649);
    const release = resolveLoggedMotionBlend(isolated, 3.65);
    const settle = resolveLoggedMotionBlend(isolated, 3.725);
    const completed = resolveLoggedMotionBlend(isolated, 3.8);
    expect(before.incoming.kind).toBe("settled");
    expect(boundary).toMatchObject({ incoming: { kind: "motion", animationId: 1148, clipTime: 0 },
      outgoing: { kind: "settled", animationId: 0 }, incomingWeight: 0 });
    expect(middle.incomingWeight).toBeCloseTo(0.5);
    expect(release.incoming.kind).toBe("motion");
    expect(release.incoming.clipTime).toBeCloseTo(1.076);
    expect(settle).toMatchObject({ incoming: { kind: "settled" }, outgoing: { kind: "motion", animationId: 1148 }, incomingWeight: expect.closeTo(0.5) });
    expect(completed.outgoing).toBeNull();
  });

  it("blends successive logged casts across the five-millisecond real gap using independent clip times", () => {
    const preceding = resolveLoggedMotionBlend(timeline, 33.34);
    const boundary = resolveLoggedMotionBlend(timeline, 33.345);
    const middle = resolveLoggedMotionBlend(timeline, 33.42);
    const complete = resolveLoggedMotionBlend(timeline, 33.495);
    expect(preceding.incoming).toMatchObject({ kind: "motion", animationId: 830, clipTime: expect.closeTo(0.988) });
    expect(boundary.incomingWeight).toBe(0);
    expect(middle.incoming).toMatchObject({ kind: "motion", clipTime: expect.closeTo(0.075) });
    expect(middle.outgoing).toMatchObject({ kind: "motion", clipTime: expect.closeTo(0.988) });
    expect(middle.incomingWeight).toBeCloseTo(0.5);
    expect(complete.outgoing).toBeNull();
  });

  it("introduces an instant pose only after its logged release and then returns to stand", () => {
    const isolated = { ...timeline, occurrences: timeline.occurrences.filter((occurrence) =>
      occurrence.actionName === "lightning_bolt" && occurrence.castFinish === 31.598) };
    const before = resolveLoggedMotionBlend(isolated, 31.597);
    const boundary = resolveLoggedMotionBlend(isolated, 31.598);
    const entering = resolveLoggedMotionBlend(isolated, 31.673);
    const leaving = resolveLoggedMotionBlend(isolated, 31.823);
    const complete = resolveLoggedMotionBlend(isolated, 31.898);
    expect(before.incoming.kind).toBe("settled");
    expect(boundary).toMatchObject({ incoming: { kind: "motion", clipTime: 0 },
      outgoing: { kind: "settled" }, incomingWeight: 0 });
    expect(entering.incomingWeight).toBeCloseTo(0.5);
    expect(leaving).toMatchObject({ incoming: { kind: "settled" },
      outgoing: { kind: "motion" }, incomingWeight: expect.closeTo(0.5) });
    expect(complete.outgoing).toBeNull();
  });

  it("keeps failed queues, waits, unsupported actions and future selections explicitly idle", () => {
    const sample = parseReplayReport(officialFixture).actors[0].events[0];
    const empty: CombatTimeline = { occurrences: [], auras: [], unmatched: [] };
    const wait: ReplayEvent = { ...sample, kind: "wait", name: "Wait", id: null, queueFailed: null, wait: 0.5, time: 4 };
    const failed: ReplayEvent = { ...sample, queueFailed: true, time: 4 };
    const unsupported: ReplayEvent = { ...sample, id: 1236616, name: "potion", time: 4 };
    expect(resolveLoggedAnimation(empty, 3.99, wait)).toMatchObject({ kind: "before", animationId: 0, status: expect.stringMatching(/before.*idle/) });
    expect(resolveLoggedAnimation(empty, 4, wait)).toMatchObject({ kind: "wait", animationId: 0, status: expect.stringMatching(/wait.*idle/) });
    expect(resolveLoggedAnimation(empty, 4, failed)).toMatchObject({ kind: "failed", animationId: 0, status: expect.stringMatching(/failure.*idle/) });
    expect(resolveLoggedAnimation(empty, 4, unsupported)).toMatchObject({ kind: "unmapped", animationId: 0, status: expect.stringMatching(/mapping.*idle/) });
    const noMappedCast = { ...empty, occurrences: [{ ...timeline.occurrences[0], spellId: 1236616, actionName: "potion", castStart: 4, castFinish: 4, isBackground: false }] };
    expect(resolveLoggedAnimation(noMappedCast, 4).kind).toBe("settled");
    expect(resolveLoggedEffectOccurrences(noMappedCast, 4)).toEqual([]);
  });

  it("bounds simultaneous original components using the new trace, including overloads", () => {
    const moments = timeline.occurrences.flatMap((occurrence) => [
      occurrence.castStart, occurrence.castFinish, occurrence.travelStart,
      ...occurrence.impacts.flatMap((impact) => [impact.time, impact.time + 0.1]),
    ]).filter((time): time is number => time !== null).concat(timeline.auras.map((aura) => aura.time));
    const peaks = new Map<number, number>();
    for (const time of moments) {
      const counts = new Map<number, number>();
      for (const effect of resolveLoggedEffectOccurrences(timeline, time)) {
        for (const component of effect.components) counts.set(component.fileDataId, (counts.get(component.fileDataId) ?? 0) + 1);
      }
      for (const [fileDataId, count] of counts) peaks.set(fileDataId, Math.max(peaks.get(fileDataId) ?? 0, count));
    }
    expect(moments.find((time) => resolveLoggedEffectOccurrences(timeline, time)
      .flatMap((effect) => effect.components).filter((component) => component.fileDataId === 794788).length === 4)).toBe(8.651);
    expect(peaks.get(4329984)).toBe(7);
    expect(peaks.get(6211617)).toBe(4);
    expect(peaks.get(794788)).toBe(4);
    expect([...peaks].sort(([left], [right]) => left - right))
      .toEqual([...REPLAY_COMPONENT_INSTANCE_LIMITS].sort(([left], [right]) => left - right));
  });

  it("shares the original missile across Lava Burst, Elemental Blast and overloads without blocked body 3980281", () => {
    const lava = resolveLoggedEffectOccurrences(timeline, 3.95).filter((effect) => effect.spellId === 51505);
    const blast = timeline.occurrences.find((occurrence) => occurrence.actionName === "elemental_blast" && occurrence.travelStart !== null)!;
    const blastFlight = resolveLoggedEffectOccurrences(timeline, blast.travelStart! + 0.1)
      .find((effect) => effect.eventKey === blast.key && effect.components.some((component) => component.anchor === "projectile"))!;
    const overload = resolveLoggedEffectOccurrences(timeline, 0.65).filter((effect) => effect.spellId === 285466);
    expect(lava.flatMap((effect) => effect.components.map((component) => component.fileDataId))).toContain(4329984);
    expect(blastFlight.components.map((component) => component.fileDataId)).toEqual([4329984, 794788, 613807]);
    expect(overload.length).toBeGreaterThan(0);
    expect(overload.flatMap((effect) => effect.components.map((component) => component.fileDataId))).toContain(4329984);
    expect([...lava, blastFlight, ...overload].flatMap((effect) => effect.components.map((component) => component.fileDataId))).not.toContain(3980281);
  });

  it("does not invent an Ancestral Swiftness component or an ancestor-source missile", () => {
    expect(timeline.occurrences.some((occurrence) => occurrence.spellId === 443454)).toBe(true);
    expect(resolveLoggedEffectOccurrences(timeline, 31.598).some((effect) => effect.spellId === 443454)).toBe(false);
    expect(timeline.occurrences.some((occurrence) => occurrence.actor.includes("_ancestor") && occurrence.travelStart !== null)).toBe(true);
    expect(resolveLoggedEffectOccurrences(timeline, 4.55).some((effect) => effect.sourceActor?.includes("_ancestor"))).toBe(false);
  });

  it("uses all equal-time precombat source lines without letting a selected prefix fabricate later effects", () => {
    const events = parseReplayReport(officialFixture).actors[0].events;
    expect(events.slice(0, 8).map((event) => [event.phase, event.time, event.name])).toEqual([
      ["precombat", 0, "snapshot_stats"], ["precombat", 0, "flametongue_weapon"],
      ["precombat", 0, "lightning_shield"], ["precombat", 0, "trinket_1_buffs"],
      ["precombat", 0, "trinket_2_buffs"], ["precombat", 0, "trinket_1_special"],
      ["precombat", 0, "trinket_2_special"], ["precombat", 0, "stormkeeper"],
    ]);
    const atZero = resolveLoggedEffectOccurrences(timeline, 0);
    expect(atZero.some((effect) => effect.spellId === 192106)).toBe(true);
    expect(atZero.some((effect) => effect.spellId === 191634)).toBe(true);
    expect(atZero.some((effect) => effect.spellId === 318038)).toBe(false);
    expect(atZero.filter((effect) => effect.spellId === 51505)).not.toHaveLength(0);
    expect(atZero.filter((effect) => effect.spellId === 51505).every((effect) =>
      effect.eventKey === timeline.occurrences.find((occurrence) => occurrence.actionName === "lava_burst_asc"
        && occurrence.travelStart === 0)?.key)).toBe(true);
    expect(atZero.some((effect) => effect.eventTime === 1.777)).toBe(false);
    expect(resolveLoggedEffectOccurrences(timeline, 0)).toEqual(atZero);
  });
});

describe("native replay anchor placement", () => {
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

describe("native pose blending", () => {
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

describe("native missile assets", () => {
  it("pins authored scales for the renderable missiles without loading rejected body 3980281", () => {
    expect([4329984, 794788, 613807].map((fileDataId) =>
      [fileDataId, NATIVE_EFFECT_ASSETS.find((asset) => asset.fileDataId === fileDataId)?.effectNameScale]))
      .toEqual([[4329984, 1.4], [794788, 2], [613807, 1]]);
    expect(NATIVE_EFFECT_ASSETS.some((asset) => asset.fileDataId === 3980281)).toBe(false);
  });
});
