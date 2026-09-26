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
  resolveLoggedEffectOccurrences,
  resolveLoggedAnimation,
  getLoggedPlaybackEndTime,
} from "./GenuineModelScene";
import { parseReplayReport } from "./replay";
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
    expect(resolveLoggedAnimation(timeline, 3.66).kind).not.toBe("motion");
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
