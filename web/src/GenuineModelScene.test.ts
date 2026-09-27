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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import officialFixture from "../public/fixture/elemental-shaman-replay.json";
import {
  REPLAY_SOURCE_ATTACHMENTS,
  REPLAY_COMPONENT_INSTANCE_LIMITS,
  arrangeCombatants,
  frameModels,
  getPreparedComponentPlacements,
  getReplayEffectAnchors,
  getReplayComponentPeak,
  getReplayEffectSourceAnchor,
  isReplayClipMissing,
  resolveLoggedEffectOccurrences,
  resolveLoggedMotionBlend,
  resolveLoggedAnimation,
  getLoggedPlaybackEndTime,
} from "./GenuineModelScene";
import { parseReplayReport, type ReplayEvent } from "./replay";
import { buildCombatTimeline, parseCombatLog, type CombatTimeline } from "./combatLog";
import { NATIVE_EFFECT_ASSETS } from "./nativeEffectAssets";
import { decodeNativeBlp } from "./nativeBlp";
import { parseNativeM2, parseNativeSkin } from "./nativeM2";
import { sampleNativeEmitter } from "./nativeParticles";
import { getNativeEffectTailBound, NativeParticleEffect } from "./NativeParticleEffect";
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

  it("repositions both actors on resize without accumulating their prior world offsets", () => {
    const vulpera = createModel(2, 4, 2);
    const dummy = createModel(2.4, 5, 2);
    arrangeCombatants(vulpera, dummy);
    arrangeCombatants(vulpera, dummy, 5.6);
    arrangeCombatants(vulpera, dummy, 5.6);
    expect(new Box3().setFromObject(vulpera).getCenter(new Vector3()).x).toBeCloseTo(-2.8);
    expect(new Box3().setFromObject(dummy).getCenter(new Vector3()).x).toBeCloseTo(2.8);
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
  const tailBoundFor = (fileDataId: number) => {
    const source = readFileSync(resolve(process.cwd(), `public/model/native-effects/${fileDataId}.m2`));
    const model = parseNativeM2(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), fileDataId);
    return getNativeEffectTailBound(model);
  };
  const tailBounds = new Map([1355634, 1284864, 4006621, 4329984, 6211617, 6211618, 1571475]
    .map((fileDataId) => [fileDataId, tailBoundFor(fileDataId)]));
  const componentsAt = (time: number) => resolveLoggedEffectOccurrences(timeline, time, tailBounds)
    .flatMap((effect) => effect.components.map((component) => ({ effect, component })));

  it("retains a sampled particle when the selected lifespan sequence slot is absent", () => {
    const source = readFileSync(resolve(process.cwd(), "public/model/native-effects/6211617.m2"));
    const original = parseNativeM2(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), 6211617);
    const emitter = { ...original.emitters[0], lifespanVariation: 0,
      lifespan: { ...original.emitters[0].lifespan, globalSequence: -1, sequences: [
        { timestamps: [0], values: [0.01] }, { timestamps: [0], values: [0.01] },
      ] },
      emissionRate: { ...original.emitters[0].emissionRate, sequences: [{ timestamps: [0], values: [100] }] },
      enabled: { ...original.emitters[0].enabled, sequences: [{ timestamps: [0], values: [1] }] },
    };
    const originalColor = original.colors[0];
    const model = { ...original, emitters: [emitter], colors: [{ ...originalColor,
      alpha: { ...originalColor.alpha, sequences: [
        { timestamps: [0], values: [0] }, { timestamps: [0], values: [0] },
        { timestamps: [0], values: [1] },
      ] },
    }] };
    const skinBytes = readFileSync(resolve(process.cwd(), "public/model/native-effects/6212146.skin"));
    const skin = parseNativeSkin(skinBytes.buffer.slice(skinBytes.byteOffset, skinBytes.byteOffset + skinBytes.byteLength),
      6212146, model.vertices.length);
    const textures = model.textureFileDataIds.map((id) => {
      const bytes = readFileSync(resolve(process.cwd(), `public/model/native-effects/${id}.blp`));
      return decodeNativeBlp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), id);
    });
    const effect = new NativeParticleEffect(model, textures, 1, skin);
    expect(effect.animationSequenceIndex).toBe(2);
    const samples = sampleNativeEmitter(emitter, model.bones[emitter.boneIndex], model.sequenceDurationMs, 0.22,
      { sequenceIndex: effect.animationSequenceIndex, bones: model.bones,
        globalSequenceDurationsMs: model.globalSequenceDurationsMs, emissionEndSeconds: 0.2 });
    expect(samples.some((sample) => Math.abs(sample.age - 0.03) < 1e-9)).toBe(true);
    const bound = getNativeEffectTailBound(model);
    expect(bound).toBeCloseTo(0.05);
    const lightningBolt = timeline.occurrences.find((occurrence) => occurrence.spellId === 188196
      && occurrence.travelStart !== null)!;
    const isolated = { ...timeline, occurrences: [{ ...lightningBolt, castFinish: 0, travelStart: 0,
      travelDuration: 0.2, impacts: [{ ...lightningBolt.impacts[0], time: 0.2 }] }], auras: [], unmatched: [] };
    const scheduled = resolveLoggedEffectOccurrences(isolated, 0.22, new Map([[6211617, bound]]));
    expect(scheduled.filter((occurrence) => occurrence.components[0].fileDataId === 6211617)
      .map((occurrence) => [occurrence.emissionStopTime, occurrence.renderEndTime])).toEqual([[0.2, 0.25]]);
    effect.dispose();
  });

  it("does not fabricate an opening Stormkeeper precast but binds its aura hand component to gain and loss", () => {
    const atGain = componentsAt(0).filter(({ effect }) => effect.spellId === 191634);
    expect(atGain.map(({ component }) => component.fileDataId)).toEqual([1284864]);
    expect(atGain[0].effect).toMatchObject({ startTime: 0, emissionStopTime: 3.655,
      renderEndTime: expect.closeTo(3.655 + tailBounds.get(1284864)!) });
    expect(componentsAt(3.655).filter(({ effect }) => effect.spellId === 191634)
      .every(({ effect }) => effect.componentTimeSeconds >= effect.emissionDuration!)).toBe(true);
    expect(componentsAt(3.655 + tailBounds.get(1284864)! + 0.001)
      .some(({ effect }) => effect.spellId === 191634)).toBe(false);
  });

  it("omits a zero-length source-bound precast without failing the rest of the replay", () => {
    const cast = timeline.occurrences.find((occurrence) => occurrence.spellId === 51505 && occurrence.castStart === 2.574)!;
    const isolated: CombatTimeline = { occurrences: [{ ...cast, castFinish: 2.574, travelStart: null, impacts: [] }],
      auras: [], unmatched: [] };
    expect(resolveLoggedEffectOccurrences(isolated, 2.574, tailBounds)
      .flatMap((effect) => effect.components).filter((component) => component.fileDataId === 4006621)).toEqual([]);
  });

  it("keeps the real Lava precast through its finish and retains release and missile tails independently", () => {
    const precast = (time: number) => componentsAt(time).filter(({ effect, component }) =>
      effect.spellId === 51505 && component.fileDataId === 4006621);
    expect(precast(2.573)).toHaveLength(0);
    expect(precast(2.574)).toHaveLength(2);
    expect(precast(3.65)).toHaveLength(2);
    expect(precast(3.65).every(({ effect }) => effect.emissionStopTime === 3.65)).toBe(true);
    expect(precast(3.65 + tailBounds.get(4006621)! + 0.001)).toHaveLength(0);
    const missile = componentsAt(4.25).filter(({ component }) => component.fileDataId === 4329984);
    expect(missile.some(({ effect }) => effect.emissionStopTime === 4.25
      && effect.renderEndTime > effect.emissionStopTime)).toBe(true);
    expect(componentsAt(4.25 + tailBounds.get(4329984)! + 0.001)
      .some(({ effect, component }) => effect.spellId === 51505 && component.fileDataId === 4329984
        && effect.eventTime === 3.65)).toBe(false);
  });

  it("holds precast until the logged finish and leaves overloads out of the foreground pose", () => {
    expect(resolveLoggedAnimation(timeline, 3).kind).toBe("motion");
    expect(resolveLoggedAnimation(timeline, 3).eventLabel).toBe("Lava Burst");
    expect(resolveLoggedAnimation(timeline, 0.5).eventLabel).not.toMatch(/overload/);
    expect(resolveLoggedAnimation(timeline, 3.66).eventLabel).not.toBe("Lava Burst");
  });
  it("releases at finish, flies until hit, then shows impact only after hit", () => {
    const before = resolveLoggedEffectOccurrences(timeline, 3.649).filter((effect) => effect.spellId === 51505 && effect.eventTime === 3.65);
    expect(before.some((effect) => effect.components.some((component) => component.anchor === "projectile"))).toBe(false);
    const flight = resolveLoggedEffectOccurrences(timeline, 3.95).filter((effect) => effect.spellId === 51505 && effect.eventTime === 3.65);
    expect(flight.some((effect) => effect.components.some((component) => component.anchor === "projectile"))).toBe(true);
    expect(flight.some((effect) => effect.components.some((component) => component.anchor === "target"))).toBe(false);
    expect(flight.find((effect) => effect.components[0].anchor === "projectile")!.componentTimeSeconds).toBeCloseTo(0.3);
    const impact = resolveLoggedEffectOccurrences(timeline, 4.25).filter((effect) => effect.spellId === 51505 && effect.eventTime === 3.65);
    expect(impact.some((effect) => effect.components.some((component) => component.anchor === "projectile"))).toBe(true);
    expect(impact.every((effect) => effect.emissionStopTime <= 4.25)).toBe(true);
  });
  it("keeps source-linked hand rows, authored offset, and Base missile attachment distinct", () => {
    const precast = getPreparedComponentPlacements(51505, { fileDataId: 4006621, anchor: "caster" });
    expect(precast.map((placement) => placement.attachmentId)).toEqual([22, 21]);
    const atCast = resolveLoggedEffectOccurrences(timeline, 3.2).filter((effect) => effect.spellId === 51505);
    expect(atCast.flatMap((effect) => effect.components).filter((component) => component.fileDataId === 4006621)
      .map((component) => component.placement?.attachmentId)).toEqual([22, 21]);
    expect(getPreparedComponentPlacements(191634, { fileDataId: 1284864, anchor: "caster" })[0])
      .toMatchObject({ attachmentId: 22, offset: [0, expect.closeTo(0.15), 0], sourceRowId: 321824 });
    expect(getPreparedComponentPlacements(188196, { fileDataId: 6211617, anchor: "projectile" })[0])
      .toMatchObject({ attachmentId: 19, sourceRowId: 25628 });
    expect(getPreparedComponentPlacements(192106, { fileDataId: 1598036, anchor: "caster" })
      .map((placement) => placement.positionerId)).toEqual([24, 23]);
    expect(resolveLoggedEffectOccurrences(timeline, 1.7).flatMap((effect) => effect.components)
      .filter((component) => component.fileDataId === 1598036)).toHaveLength(1);
  });

  it("renders two independently keyed impacts parsed from one raw logged cast", () => {
    const actor = "Player 'MID2_Shaman_Elemental_Farseer'";
    const parsed = buildCombatTimeline(parseCombatLog([
      `1.000 ${actor} performs Action 'lightning_bolt' (188196) (275000)`,
      `1.000 ${actor} schedules travel (0.500) for Action 'lightning_bolt' (188196)`,
      `1.500 ${actor} Action 'lightning_bolt' (188196) hits Enemy 'First' for 100 nature damage (hit)`,
      `1.500 ${actor} Action 'lightning_bolt' (188196) hits Enemy 'Second' for 100 nature damage (crit)`,
    ]));
    const impactsAt = (time: number) => resolveLoggedEffectOccurrences(parsed, time, tailBounds)
      .filter((effect) => effect.components[0].fileDataId === 1571475);
    expect(parsed.unmatched).toEqual([]);
    expect(impactsAt(1.5).map((effect) => effect.eventKey)).toEqual([
      `${parsed.occurrences[0].key}/impact-2/First`, `${parsed.occurrences[0].key}/impact-3/Second`,
    ]);
    impactsAt(1.499);
    expect(impactsAt(1.5)).toHaveLength(2);
  });

  it("keeps impact identities independent even at identical timestamps and replays them after backwards seek", () => {
    const original = timeline.occurrences.find((occurrence) => occurrence.spellId === 188196 && occurrence.impacts.length)!;
    const impacts = [
      { ...original.impacts[0], ordinal: 9001, target: "A" },
      { ...original.impacts[0], ordinal: 9002, target: "B" },
    ];
    const isolated: CombatTimeline = { occurrences: [{ ...original, impacts }], auras: [], unmatched: [] };
    const hitTime = impacts[0].time;
    const active = () => resolveLoggedEffectOccurrences(isolated, hitTime, tailBounds)
      .filter((effect) => effect.components.some((component) => component.fileDataId === 1571475));
    expect(active().map((effect) => effect.eventKey)).toEqual([
      `${original.key}/impact-9001/A`, `${original.key}/impact-9002/B`,
    ]);
    resolveLoggedEffectOccurrences(isolated, hitTime + tailBounds.get(1571475)!, tailBounds);
    resolveLoggedEffectOccurrences(isolated, hitTime - 0.001, tailBounds);
    expect(active().map((effect) => effect.eventKey)).toEqual([
      `${original.key}/impact-9001/A`, `${original.key}/impact-9002/B`,
    ]);
  });

  it("starts the delayed Lightning Bolt cast effect after the release kit delay", () => {
    const isolated = { ...timeline, occurrences: timeline.occurrences.filter((occurrence) =>
      occurrence.actionName === "lightning_bolt" && occurrence.castFinish === 31.598) };
    const active = (time: number) => resolveLoggedEffectOccurrences(isolated, time)
      .flatMap((effect) => effect.components).filter((component) => component.fileDataId === 6211618);
    expect(active(31.797)).toHaveLength(0);
    expect(active(31.81)).toHaveLength(1);
  });

  it("waits for the authored Flame Shock impact kit delay", () => {
    const active = (time: number) => resolveLoggedEffectOccurrences(timeline, time)
      .flatMap((effect) => effect.components).some((component) => component.fileDataId === 4392095);
    expect(active(0.049)).toBe(false);
    expect(active(0.051)).toBe(true);
  });

  it("preserves aura visibility until loss and uses the final logged hit for playback bounds", () => {
    expect(resolveLoggedEffectOccurrences(timeline, 3.6).some((effect) => effect.spellId === 191634)).toBe(true);
    const residual = resolveLoggedEffectOccurrences(timeline, 3.655, tailBounds)
      .filter((effect) => effect.spellId === 191634);
    expect(residual).not.toHaveLength(0);
    expect(residual.every((effect) => effect.emissionStopTime === 3.655)).toBe(true);
    expect(resolveLoggedEffectOccurrences(timeline, 3.655 + tailBounds.get(1284864)! + 0.001, tailBounds)
      .some((effect) => effect.spellId === 191634)).toBe(false);
    expect(getLoggedPlaybackEndTime(timeline)).toBeGreaterThan(45);
  });
  it("keeps the seek range open for a final aura loss and its surviving native tail", () => {
    const gain = timeline.auras.find((aura) => aura.spellId === 191634 && aura.transition === "gain")!;
    const isolated: CombatTimeline = { occurrences: [], unmatched: [], auras: [
      { ...gain, ordinal: 9000, time: 0 },
      { ...gain, ordinal: 9001, time: 0.3, transition: "loss", stacks: 0 },
    ] };
    const tailEnd = 0.3 + tailBounds.get(1284864)!;
    expect(resolveLoggedEffectOccurrences(isolated, tailEnd - 0.001, tailBounds)
      .some((effect) => effect.components[0].fileDataId === 1284864)).toBe(true);
    expect(getLoggedPlaybackEndTime(isolated)).toBeGreaterThanOrEqual(tailEnd);
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
    expect(active).toMatchObject({ kind: "motion", animationId: 828, status: expect.stringContaining("AnimKit segment") });
    expect(isReplayClipMissing(active, ["Stand (ID 0 variation 0)"])).toBe(true);
    expect(isReplayClipMissing(active, [active.clipName])).toBe(false);
    const isolated = { ...timeline, occurrences: timeline.occurrences.filter((occurrence) => occurrence.actionName === "lava_burst" && occurrence.castStart === 2.574) };
    expect(isReplayClipMissing(resolveLoggedAnimation(isolated, 3.9), ["Stand (ID 0 variation 0)"])).toBe(false);
  });

  it("loops the authored ready clip until the logged cast finish", () => {
    const isolated = { ...timeline, occurrences: timeline.occurrences.filter((occurrence) =>
      occurrence.actionName === "lava_burst" && occurrence.castStart === 2.574) };
    const durations = new Map([[828, 200], [862, 300], [830, 150]]);
    expect(resolveLoggedAnimation(isolated, 3.3, undefined, durations)).toMatchObject({
      animationId: 862, clipTime: expect.closeTo(0.226), status: expect.stringContaining("AnimKit segment"),
    });
    expect(resolveLoggedAnimation(isolated, 3.65, undefined, durations)).toMatchObject({ animationId: 830, clipTime: 0 });
  });

  it("blends stand into the logged Lava Burst precast and release into stand without shifting either boundary", () => {
    const isolated = { ...timeline, occurrences: timeline.occurrences.filter((occurrence) =>
      occurrence.actionName === "lava_burst" && occurrence.castStart === 2.574) };
    const before = resolveLoggedMotionBlend(isolated, 2.573);
    const boundary = resolveLoggedMotionBlend(isolated, 2.574);
    const middle = resolveLoggedMotionBlend(isolated, 2.649);
    const release = resolveLoggedMotionBlend(isolated, 3.65);
    const settle = resolveLoggedMotionBlend(isolated, 3.725);
    const completed = resolveLoggedMotionBlend(isolated, 3.951);
    expect(before.incoming.kind).toBe("settled");
    expect(boundary).toMatchObject({ incoming: { kind: "motion", animationId: 828, clipTime: 0 },
      outgoing: { kind: "settled", animationId: 0 }, incomingWeight: 0 });
    expect(middle.incomingWeight).toBeCloseTo(0.5);
    expect(release).toMatchObject({ incoming: { kind: "motion", animationId: 830, clipTime: 0 },
      outgoing: { kind: "motion", animationId: 828 }, incomingWeight: 0 });
    expect(settle).toMatchObject({ incoming: { kind: "motion", animationId: 830, clipTime: expect.closeTo(0.075) },
      outgoing: { kind: "motion", animationId: 828 }, incomingWeight: expect.closeTo(0.5) });
    expect(completed.outgoing).toBeNull();
  });

  it("blends successive logged casts across the five-millisecond real gap using independent clip times", () => {
    const preceding = resolveLoggedMotionBlend(timeline, 33.34);
    const boundary = resolveLoggedMotionBlend(timeline, 33.345);
    const middle = resolveLoggedMotionBlend(timeline, 33.42);
    const complete = resolveLoggedMotionBlend(timeline, 33.5);
    expect(preceding.incoming).toMatchObject({ kind: "motion", animationId: 53, clipTime: 0 });
    expect(boundary.incomingWeight).toBe(0);
    expect(middle.incoming).toMatchObject({ kind: "motion", clipTime: expect.closeTo(0.075) });
    expect(middle.outgoing).toMatchObject({ kind: "motion", animationId: 53, clipTime: expect.closeTo(0.005) });
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

  it("counts aura refresh tails alongside newly emitting instances", () => {
    const gain = timeline.auras.find((aura) => aura.spellId === 191634 && aura.transition === "gain")!;
    const isolated: CombatTimeline = { occurrences: [], unmatched: [], auras: [
      { ...gain, ordinal: 9000, time: 0 },
      { ...gain, ordinal: 9001, time: 0.3, transition: "refresh" },
      { ...gain, ordinal: 9002, time: 0.6, transition: "loss", stacks: 0 },
    ] };
    const active = resolveLoggedEffectOccurrences(isolated, 0.3, tailBounds)
      .filter((effect) => effect.components[0].fileDataId === 1284864);
    expect(active.map((effect) => [effect.eventKey, effect.emissionStopTime])).toEqual([
      ["aura-9000", 0.3], ["aura-9001", 0.6],
    ]);
    expect(getReplayComponentPeak(isolated, 1284864, tailBounds.get(1284864)!)).toBe(2);
    expect(getReplayComponentPeak({ ...isolated, auras: [
      { ...gain, ordinal: 9000, time: 0 },
      { ...gain, ordinal: 9001, time: 0.1, transition: "refresh" },
      { ...gain, ordinal: 9002, time: 0.2, transition: "refresh" },
      { ...gain, ordinal: 9003, time: 0.3, transition: "loss", stacks: 0 },
    ] }, 1284864, tailBounds.get(1284864)!)).toBe(3);
    expect(resolveLoggedEffectOccurrences(isolated, 0.3 + tailBounds.get(1284864)! + 0.001, tailBounds)
      .filter((effect) => effect.components[0].fileDataId === 1284864)
      .map((effect) => effect.eventKey)).toEqual(["aura-9001"]);
  });

  it("bounds simultaneous original components using the new trace, including overloads", () => {
    const authoredBounds = new Map(NATIVE_EFFECT_ASSETS.map(({ fileDataId }) => [fileDataId, tailBoundFor(fileDataId)]));
    const peaks = new Map([...authoredBounds].map(([fileDataId, bound]) =>
      [fileDataId, getReplayComponentPeak(timeline, fileDataId, bound)]));
    expect([...authoredBounds.values()].every((bound) => bound <= 1.5)).toBe(true);
    expect(authoredBounds.get(1284864)).toBeCloseTo(0.45);
    expect(authoredBounds.get(4329984)).toBeCloseTo(1);
    expect(peaks.get(4329984)).toBe(11);
    expect(peaks.get(6211617)).toBe(7);
    expect(peaks.get(6211618)).toBe(7);
    expect([...peaks].every(([fileDataId, count]) => count <= (REPLAY_COMPONENT_INSTANCE_LIMITS.get(fileDataId) ?? 0))).toBe(true);
  });

  it("shares the original missile across Lava Burst, Elemental Blast and overloads without blocked body 3980281", () => {
    const lava = resolveLoggedEffectOccurrences(timeline, 3.95).filter((effect) => effect.spellId === 51505);
    const blast = timeline.occurrences.find((occurrence) => occurrence.actionName === "elemental_blast" && occurrence.travelStart !== null)!;
    const blastFlight = resolveLoggedEffectOccurrences(timeline, blast.travelStart! + 0.1)
      .find((effect) => effect.eventKey === blast.key && effect.components.some((component) => component.anchor === "projectile"))!;
    const overload = resolveLoggedEffectOccurrences(timeline, 0.65).filter((effect) => effect.spellId === 285466);
    expect(lava.flatMap((effect) => effect.components.map((component) => component.fileDataId))).toContain(4329984);
    expect(resolveLoggedEffectOccurrences(timeline, blast.travelStart! + 0.1)
      .filter((effect) => effect.eventKey === blast.key && effect.components[0].anchor === "projectile")
      .map((effect) => effect.components[0].fileDataId)).toEqual([4329984, 794788, 613807]);
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
    expect(atZero.some((effect) => effect.spellId === 192106)).toBe(false);
    expect(resolveLoggedEffectOccurrences(timeline, 0.25).some((effect) => effect.spellId === 192106)).toBe(true);
    expect(atZero.filter((effect) => effect.spellId === 191634)
      .flatMap((effect) => effect.components.map((component) => component.fileDataId))).toEqual([1284864]);
    expect(atZero.some((effect) => effect.spellId === 318038)).toBe(false);
    expect(resolveLoggedEffectOccurrences(timeline, 0.15).some((effect) => effect.spellId === 318038)).toBe(true);
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
    expect(() => getReplayEffectSourceAnchor(188196, 6211617, noAttachments, boundsAnchor))
      .toThrow(/FileDataID 6211617.*attachment 19/);
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
