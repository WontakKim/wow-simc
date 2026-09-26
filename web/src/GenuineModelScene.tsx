import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AnimationAction,
  AnimationMixer,
  Box3,
  CircleGeometry,
  Clock,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { ReplayEvent } from "./replay";
import {
  loadNativeParticleEffect,
  type NativeParticleEffect,
  type NativeParticleRenderInstance,
} from "./NativeParticleEffect";
import { NATIVE_EFFECT_ASSETS, NATIVE_PREVIEW_DURATION_SECONDS, type NativeEffectAsset } from "./nativeEffectAssets";

const MODEL_ASSETS = {
  vulpera: {
    label: "Default Vulpera",
    url: "/model/vulpera.glb",
    localPath: "web/public/model/vulpera.glb",
  },
  trainingDummy: {
    label: "Training Dummy",
    url: "/model/training-dummy.glb",
    localPath: "web/public/model/training-dummy.glb",
  },
} as const;

const WEBGL_ERROR =
  "WebGL is unavailable. Use a browser with WebGL 2 enabled and turn on hardware acceleration, then reload. No placeholder model was substituted.";
const STAND_CLIP_NAME = "Stand (ID 0 variation 0)";
const CAMERA_FOV = 36;
export const ILLUSTRATIVE_MOTION_WINDOW_SECONDS = 1.2;
export const REPLAY_MOTION_BLEND_SECONDS = 0.15;
export const REPLAY_EFFECT_RELEASE_SECONDS = 0.2;
export const REPLAY_EFFECT_TRAVEL_SECONDS = 0.8;
// SpellMisc 33331/89780 -> RangeIndex 5 -> SpellRange 5 RangeMax_0/_1 40;
// SpellVisualMissile 28854/28867 -> SpellVisualEffectName 47399 BaseMissileSpeed 50, build 12.1.0.69933.
const REPLAY_AUTHORED_MAX_RANGE_YARDS = 40;
const REPLAY_AUTHORED_MISSILE_SPEED = 50;
const REPLAY_DERIVED_TRAVEL_SECONDS = REPLAY_AUTHORED_MAX_RANGE_YARDS / REPLAY_AUTHORED_MISSILE_SPEED;

function getReplayEffectTravelSeconds(spellId: number) {
  return spellId === 51505 || spellId === 117014
    ? REPLAY_DERIVED_TRAVEL_SECONDS : REPLAY_EFFECT_TRAVEL_SECONDS;
}
export const REPLAY_EFFECT_DECAY_SECONDS = 1.5;

function getReplayEffectDurationSeconds(spellId: number) {
  return REPLAY_EFFECT_RELEASE_SECONDS + getReplayEffectTravelSeconds(spellId) + REPLAY_EFFECT_DECAY_SECONDS;
}
const NATIVE_REPLAY_INSTANCE_LIMIT = 16;
const OTHER_REPLAY_EFFECT_DURATION_SECONDS = 1.7;
const OTHER_REPLAY_EMISSION_SECONDS = 0.2;
type ReplayEffectAnchor = "caster" | "target" | "projectile";
type ReplayComponent = { fileDataId: number; anchor: ReplayEffectAnchor };
interface ReplaySpellEffect {
  actionName: string;
  components: ReplayComponent[];
}

// Bounds are from overlapping 1.7s and 2.5s fixture windows.
const REPLAY_SPELL_EFFECTS = new Map<number, ReplaySpellEffect>([
  [318038, { actionName: "flametongue_weapon", components: [{ fileDataId: 4006618, anchor: "caster" }] }],
  [192106, { actionName: "lightning_shield", components: [{ fileDataId: 1598036, anchor: "caster" }] }],
  [191634, { actionName: "stormkeeper", components: [{ fileDataId: 1355634, anchor: "caster" }, { fileDataId: 1284864, anchor: "caster" }] }],
  [1219480, { actionName: "ascendance", components: [{ fileDataId: 1109885, anchor: "caster" }] }],
  [51505, { actionName: "lava_burst", components: [{ fileDataId: 4006621, anchor: "caster" }, { fileDataId: 4329984, anchor: "projectile" }, { fileDataId: 4006618, anchor: "target" }, { fileDataId: 3980244, anchor: "target" }] }],
  [188196, { actionName: "lightning_bolt", components: [{ fileDataId: 6211618, anchor: "caster" }, { fileDataId: 6211617, anchor: "projectile" }, { fileDataId: 1571475, anchor: "target" }] }],
  [188389, { actionName: "flame_shock", components: [{ fileDataId: 4006618, anchor: "target" }, { fileDataId: 3980244, anchor: "target" }, { fileDataId: 4392095, anchor: "target" }, { fileDataId: 4050773, anchor: "target" }] }],
  [117014, { actionName: "elemental_blast", components: [{ fileDataId: 4329984, anchor: "projectile" }, { fileDataId: 794788, anchor: "projectile" }, { fileDataId: 613807, anchor: "projectile" }] }],
  [443454, { actionName: "ancestral_swiftness", components: [] }],
]);

// Shared component capacities include overlapping occurrences from more than one spell in the public fixture.
const REPLAY_COMPONENT_INSTANCE_LIMITS = new Map<number, number>([
  [794788, 2], [613807, 2], [4006618, 2], [1598036, 1],
  [1355634, 1], [1284864, 1], [1109885, 1], [4006621, 2],
  [3980244, 2], [4329984, 3], [6211617, 4], [6211618, 4], [1571475, 4], [4392095, 1], [4050773, 1],
]);
// SpellVisualMissile rows 28854 and 28867–28869 and SpellVisualKitModelAttach rows 321812/321824, build 12.1.0.69933.
const REPLAY_SOURCE_ATTACHMENTS: Record<number, Record<number, { id: number; boneName: string }>> = {
  191634: {
    1355634: { id: 22, boneName: "bone_SpellHandR" },
    1284864: { id: 22, boneName: "bone_SpellHandR" },
  },
  51505: { 4329984: { id: 34, boneName: "bone_Chest" } },
  117014: {
    4329984: { id: 21, boneName: "bone_SpellHandL" },
    794788: { id: 22, boneName: "bone_SpellHandR" },
    613807: { id: 34, boneName: "bone_Chest" },
  },
};
const NATIVE_REPLAY_BASE_SCALE = 0.38;

const ELEMENTAL_SHAMAN_CLIPS = new Map<number, { actionName: string; clipName: string }>([
  [318038, { actionName: "flametongue_weapon", clipName: "SpellCastOmni (ID 54 variation 0)" }],
  [192106, { actionName: "lightning_shield", clipName: "ShaSpellPrecastBothChannel (ID 862 variation 0)" }],
  [191634, { actionName: "stormkeeper", clipName: "ShaSpellPrecastBoth (ID 828 variation 0)" }],
  [443454, { actionName: "ancestral_swiftness", clipName: "SpellCastOmni (ID 54 variation 0)" }],
  [1219480, { actionName: "ascendance", clipName: "ChannelCastOmniUp (ID 1448 variation 0)" }],
  [51505, { actionName: "lava_burst", clipName: "CastStrongUpRight (ID 1148 variation 0)" }],
  [188196, { actionName: "lightning_bolt", clipName: "ShaSpellCastBothFront (ID 830 variation 0)" }],
  [117014, { actionName: "elemental_blast", clipName: "CastOutStrong (ID 1122 variation 0)" }],
  [188389, { actionName: "flame_shock", clipName: "SpellCastDirected (ID 53 variation 0)" }],
]);

type SceneStatus = "loading" | "ready" | "error";
type AnimationMode = "replay" | "manual" | "native";
export type ReplaySpeed = 0.5 | 1 | 2;
export type ReplayAnimationKind = "motion" | "settled" | "before" | "wait" | "failed" | "unmapped" | "unavailable";

export interface ReplayEffectOccurrence {
  eventKey: string;
  eventTime: number;
  elapsedSeconds: number;
  componentTimeSeconds: number;
  spellId: number;
  components: ReplayComponent[];
}

export interface ReplayAnimationResolution {
  kind: ReplayAnimationKind;
  eventLabel: string;
  clipName: string;
  clipTime: number;
  status: string;
}

export interface ReplayMotionBlend {
  incoming: ReplayAnimationResolution;
  outgoing: ReplayAnimationResolution | null;
  incomingWeight: number;
}

export interface SceneReplayState {
  events: ReplayEvent[];
  selectedIndex: number;
  cursor: number;
  isPlaying: boolean;
  speed: ReplaySpeed;
  maxTime: number;
  onSelectEvent: (index: number) => void;
  onSeek: (time: number) => void;
  onTogglePlayback: () => void;
  onReset: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
}

export interface GenuineModelSceneProps {
  replay: SceneReplayState | null;
}

interface CameraView {
  position: Vector3;
  target: Vector3;
}

interface AnimationController {
  applyReplayAnimation: (blend: ReplayMotionBlend) => void;
  playManualClip: (index: number, shouldPlay: boolean) => void;
  setManualPlaying: (shouldPlay: boolean) => void;
  loadNativeEffect: (asset: NativeEffectAsset) => Promise<NativeParticleEffect | null>;
  loadReplayEffects: () => Promise<boolean>;
  setNativeVisible: (isVisible: boolean) => void;
  setReplayVisible: (isVisible: boolean) => void;
  resetCamera: () => void;
}

function getEventLabel(event: ReplayEvent) {
  if (event.kind === "wait") return `Wait ${(event.wait ?? 0).toFixed(2)}s`;
  return event.spellName ?? event.name;
}

function getSupportedReplaySpell(event: ReplayEvent) {
  if (event.kind !== "action" || event.queueFailed !== false || event.id === null) return null;
  const spell = REPLAY_SPELL_EFFECTS.get(event.id);
  if (!spell || spell.actionName !== event.name || (event.id === 117014 && event.phase !== "combat")) return null;
  return spell;
}

function roundReplayTime(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function resolveReplayEffectOccurrences(
  events: ReplayEvent[],
  selectedIndex: number,
  cursor: number,
): ReplayEffectOccurrence[] {
  if (selectedIndex < 0 || selectedIndex >= events.length) return [];
  return events.slice(0, selectedIndex + 1).flatMap((event) => {
    const spell = getSupportedReplaySpell(event);
    if (!spell || spell.components.length === 0) return [];
    const isProjectile = event.id === 117014;
    const release = isProjectile ? REPLAY_EFFECT_RELEASE_SECONDS : 0;
    const duration = isProjectile || event.id === 51505 || event.id === 188196
      ? getReplayEffectDurationSeconds(event.id!) : OTHER_REPLAY_EFFECT_DURATION_SECONDS;
    const elapsedSeconds = roundReplayTime(cursor - event.time);
    if (elapsedSeconds < release || elapsedSeconds > duration) return [];
    return [{
      eventKey: event.key,
      eventTime: event.time,
      elapsedSeconds,
      componentTimeSeconds: roundReplayTime(elapsedSeconds - release),
      spellId: event.id!,
      components: spell.components,
    }];
  });
}

export function getReplayPlaybackEndTime(events: ReplayEvent[]) {
  const combatEvents = events.filter((event) => event.phase === "combat");
  const lastCombatTime = Math.max(0, ...combatEvents.map((event) => event.time));
  const lastEffectEnd = Math.max(
    0,
    ...events.map((event) => {
      const spell = getSupportedReplaySpell(event);
      if (!spell || spell.components.length === 0) return 0;
      return event.time + (event.id === 117014 || event.id === 51505 || event.id === 188196
        ? getReplayEffectDurationSeconds(event.id!) : OTHER_REPLAY_EFFECT_DURATION_SECONDS);
    }),
  );
  return roundReplayTime(Math.max(
    combatEvents.length > 0 ? lastCombatTime + ILLUSTRATIVE_MOTION_WINDOW_SECONDS : 0,
    lastEffectEnd,
  ));
}

export function getReplayEffectAnchors(caster: Group, target: Group) {
  const anchorFromBounds = (root: Group) => {
    const bounds = new Box3().setFromObject(root);
    const center = bounds.getCenter(new Vector3());
    const height = bounds.getSize(new Vector3()).y;
    return new Vector3(center.x, bounds.min.y + height * 0.6, center.z);
  };
  return { caster: anchorFromBounds(caster), target: anchorFromBounds(target) };
}

export function getReplayEffectSourceAnchor(spellId: number, fileDataId: number, caster: Group, boundsAnchor: Vector3) {
  const attachment = REPLAY_SOURCE_ATTACHMENTS[spellId]?.[fileDataId];
  if (!attachment) return boundsAnchor;
  const bone = caster.getObjectByName(attachment.boneName);
  if (!bone) throw new Error(`FileDataID ${fileDataId}: attachment ${attachment.id} requires missing ${attachment.boneName}.`);
  bone.updateWorldMatrix(true, false);
  return bone.getWorldPosition(new Vector3());
}

function describeReplayComponentAnchor(spellId: number, component: ReplayComponent) {
  const attachment = REPLAY_SOURCE_ATTACHMENTS[spellId]?.[component.fileDataId];
  if (attachment && component.anchor === "caster") return `authored ${attachment.boneName} origin (source attachment ${attachment.id})${component.fileDataId === 1284864 ? "; kit offset (0, 0.15, 0) unapplied (attachment-local frame unavailable)" : ""}`;
  if (attachment) return `authored ${attachment.boneName} origin (source attachment ${attachment.id}); target remains 60%-bounds anchored (destination 34 Chest has no matching dummy attachment/bone; M2 attachment record offset unavailable${spellId === 117014 ? "; impact positioner 712 unresolved" : ""})`;
  if (component.anchor === "projectile") return "60%-bounds anchored at both endpoints (source attachment 19 Base with cast offset (-7, 0, 5), or -1 with positioner 513 depending on unresolved Lightning Bolt branch; offset unapplied because its attachment frame is unavailable; destination 34 Chest has no matching dummy attachment/bone)";
  return `60%-bounds anchored at ${component.anchor} (single applicable attachment point not established from mapped source kit; -1/positioners or multiple authored rows may apply)`;
}

function sampleReplayEffectPath(caster: Vector3, target: Vector3, componentTimeSeconds: number, spellId: number) {
  const progress = Math.max(0, Math.min(1, componentTimeSeconds / getReplayEffectTravelSeconds(spellId)));
  return caster.clone().lerp(target, progress);
}

function threeToNative(value: Vector3): [number, number, number] {
  return [value.x, value.z, -value.y];
}

export function resolveReplayAnimation(
  events: ReplayEvent[],
  selectedIndex: number,
  cursor: number,
): ReplayAnimationResolution {
  const event = events[selectedIndex];
  if (!event) {
    return {
      kind: "unavailable",
      eventLabel: "No replay event",
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "Replay sync is unavailable — idle.",
    };
  }

  const eventLabel = getEventLabel(event);
  if (cursor < event.time) {
    return {
      kind: "before",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "The cursor is before this recorded action — idle.",
    };
  }
  if (event.kind === "wait") {
    return {
      kind: "wait",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "Recorded wait — idle; no cast motion.",
    };
  }
  if (event.queueFailed) {
    return {
      kind: "failed",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "Recorded queue failure — idle; no successful cast motion.",
    };
  }

  const mappedClip = event.id === null ? undefined : ELEMENTAL_SHAMAN_CLIPS.get(event.id);
  if (!mappedClip || mappedClip.actionName !== event.name) {
    return {
      kind: "unmapped",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "No supported exported motion mapping — idle.",
    };
  }

  const elapsed = cursor - event.time;
  if (elapsed >= ILLUSTRATIVE_MOTION_WINDOW_SECONDS - 0.000001) {
    return {
      kind: "settled",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "Illustrative motion window complete — idle.",
    };
  }

  return {
    kind: "motion",
    eventLabel,
    clipName: mappedClip.clipName,
    clipTime: elapsed,
    status: "Illustrative exported motion — not cast duration or hit timing.",
  };
}

export function resolveReplayMotionBlend(
  events: ReplayEvent[],
  selectedIndex: number,
  cursor: number,
): ReplayMotionBlend {
  const incoming = resolveReplayAnimation(events, selectedIndex, cursor);
  const event = events[selectedIndex];
  if (!event || incoming.kind === "before") return { incoming, outgoing: null, incomingWeight: 1 };

  const boundary = incoming.kind === "settled"
    ? event.time + ILLUSTRATIVE_MOTION_WINDOW_SECONDS
    : event.time;
  const elapsed = cursor - boundary;
  if (elapsed < 0 || elapsed >= REPLAY_MOTION_BLEND_SECONDS) {
    return { incoming, outgoing: null, incomingWeight: 1 };
  }

  const outgoingAtBoundary = incoming.kind === "settled"
    ? resolveReplayAnimation(events, selectedIndex, boundary - 0.000002)
    : resolveReplayAnimation(events, selectedIndex > 0 ? selectedIndex - 1 : selectedIndex, boundary - 0.000002);
  const outgoingEvent = incoming.kind === "settled" ? event : events[selectedIndex - 1];
  const outgoing = outgoingAtBoundary.kind === "motion" && outgoingEvent
    ? { ...outgoingAtBoundary, clipTime: cursor - outgoingEvent.time }
    : outgoingAtBoundary;
  if (outgoing.clipName === incoming.clipName
    && outgoing.clipTime === incoming.clipTime) {
    return { incoming, outgoing: null, incomingWeight: 1 };
  }
  return { incoming, outgoing, incomingWeight: elapsed / REPLAY_MOTION_BLEND_SECONDS };
}

export function isReplayClipMissing(
  resolution: ReplayAnimationResolution,
  animationNames: string[],
) {
  return resolution.kind === "motion" && !animationNames.includes(resolution.clipName);
}

export function configureVulperaMaterials(root: Object3D) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.name !== "vulperamale_eyereflect") continue;
      material.transparent = true;
      material.depthWrite = false;
      material.needsUpdate = true;
    }
  });
}

function disposeObject(root: Object3D) {
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

function placeModel(root: Group, x: number, rotationY: number, scale = 1) {
  root.rotation.y = rotationY;
  root.scale.setScalar(scale);
  root.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(root);
  const center = bounds.getCenter(new Vector3());
  root.position.set(x - center.x, -bounds.min.y, -center.z);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

export function arrangeCombatants(vulpera: Group, trainingDummy: Group) {
  placeModel(vulpera, -4, 0);
  placeModel(trainingDummy, 4, Math.PI, 0.7);
}

export function frameModels(camera: PerspectiveCamera, controls: OrbitControls, bounds: Box3): CameraView {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const target = center.clone().add(new Vector3(0, size.y * 0.02, 0));
  const direction = new Vector3(0.42, 0.28, 1).normalize();
  const viewDirection = direction.clone().negate();
  const viewRight = new Vector3().crossVectors(viewDirection, camera.up).normalize();
  const viewUp = new Vector3().crossVectors(viewRight, viewDirection).normalize();
  const verticalTangent = Math.tan((camera.fov * Math.PI) / 360);
  const horizontalTangent = verticalTangent * camera.aspect;
  let distance = 1;

  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const relative = new Vector3(x, y, z).sub(target);
        const depthOffset = relative.dot(direction);
        const horizontalDistance = Math.abs(relative.dot(viewRight)) / horizontalTangent;
        const verticalDistance = Math.abs(relative.dot(viewUp)) / verticalTangent;
        distance = Math.max(distance, depthOffset + Math.max(horizontalDistance, verticalDistance) * 1.08);
      }
    }
  }

  const position = target.clone().add(direction.multiplyScalar(distance));
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 20;
  camera.position.copy(position);
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.minDistance = radius * 0.7;
  controls.maxDistance = Math.max(radius * 5, distance * 1.5);
  controls.update();

  return { position, target };
}

function createAssetError(asset: (typeof MODEL_ASSETS)[keyof typeof MODEL_ASSETS]) {
  return new Error(
    `Could not load ${asset.url}. Export the genuine model with wow.export and copy it to ${asset.localPath}, then reload. No placeholder model was substituted.`,
  );
}

async function loadModel(loader: GLTFLoader, asset: (typeof MODEL_ASSETS)[keyof typeof MODEL_ASSETS]) {
  try {
    return await loader.loadAsync(asset.url);
  } catch {
    throw createAssetError(asset);
  }
}

function describeNativeEffectLimitations(effect: NativeParticleEffect) {
  const blendSevenEmitters = effect.model.emitters
    .filter((emitter) => emitter.blendingType === 7)
    .map((emitter) => emitter.index);
  return [
    ...effect.unsupportedEmitters,
    ...effect.unsupportedMeshBatches,
    ...(effect.model.fileDataId === 4329984 ? ["SpellMissileMotion 2967 (Elemental Blast) has authored transAngle/transMag/transFront/scale script but its runtime coordinate frame is unverified; not applied; Lava Burst motion ID 0 has no script"] : []),
    ...(effect.model.fileDataId === 794788 ? ["SpellMissileMotion 2969 script coordinate frame unverified; not applied; BaseMissileSpeed 0 inherits shared 4329984 flight duration"] : []),
    ...(effect.model.fileDataId === 613807 ? ["SpellMissileMotion 2968 script coordinate frame unverified; not applied; BaseMissileSpeed 0 inherits shared 4329984 flight duration"] : []),
    ...(effect.model.fileDataId === 6211617 ? ["Lightning Bolt branch has SpellMissileMotion 4856 parabola or motion ID 0; branch unresolved; no arc applied; BaseMissileSpeed 0"] : []),
    ...effect.ribbonLimitations,
    ...(effect.meshTriangleCount > 0
      ? [`authored animation sequence ${effect.animationSequenceIndex} (ID ${effect.model.sequenceIds[effect.animationSequenceIndex]}) sampled for the mesh and emitters; retail spell sequence scheduling not verified`]
      : []),
    ...(effect.model.dboc ? [`DBOC four authored values (${[...effect.model.dboc.floats, ...effect.model.dboc.integers].join(", ")}) parsed but unused; purpose undocumented`] : []),
    ...effect.model.emitters.flatMap((emitter) => (emitter.flags & 0x8000000) !== 0
      ? [`emitter ${emitter.index}: flag 0x8000000 not reconstructed (meaning unverified)`] : []),
    ...(effect.primaryOnlyEmitters.length > 0
      ? [`secondary original textures not combined for emitters ${effect.primaryOnlyEmitters.join(", ")}`]
      : []),
    ...effect.model.textureControlEntries.flatMap(([first, second], index) =>
      first || second ? [`TXAC ${index < effect.model.emitters.length ? `emitter ${index}` : `extra entry ${index}`} (${first},${second}) texture controls not implemented`] : []),
    ...effect.model.emitters.flatMap((emitter) =>
      (emitter.flags & 0x1) !== 0 ? [`emitter ${emitter.index} flag 0x1 particle shading not reconstructed (unlit billboard)`] : []),
    ...effect.model.emitters.flatMap((emitter) =>
      (emitter.flags & 0x20) !== 0 ? [`emitter ${emitter.index} flag 0x20 particle bone-scale size inheritance not reconstructed`] : []),
    ...effect.model.emitters.flatMap((emitter) =>
      (emitter.flags & 0x8000) !== 0 ? [`emitter ${emitter.index} flag 0x8000 squirt burst emission not reproduced; continuous-rate sampling only`] : []),
    ...effect.model.emitters.flatMap((emitter) =>
      (emitter.flags & 0x40) !== 0 ? [`emitter ${emitter.index} parent-particle velocity inheritance not modeled`] : []),
    ...effect.model.emitters.flatMap((emitter) => {
      const colorFlags = [
        (emitter.flags & 0x20000000) !== 0 ? "Modx4" : null,
        (emitter.flags & 0x40000000) !== 0 ? "three-color" : null,
      ].filter(Boolean);
      return colorFlags.length > 0
        ? [`emitter ${emitter.index}: ${colorFlags.join(" + ")} flags not reproduced (${(emitter.flags & 0x10000000) !== 0 ? "MultiTexture on" : "MultiTexture off; meaning unknown"})`]
        : [];
    }),
    ...(blendSevenEmitters.length > 0
      ? [`blend 7 uses unverified EGxBlend factors for emitters ${blendSevenEmitters.join(", ")}`]
      : []),
  ].join(" · ");
}

export function GenuineModelScene({ replay }: GenuineModelSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AnimationController | null>(null);
  const animationModeRef = useRef<AnimationMode>("replay");
  const replayAnimationRef = useRef(resolveReplayMotionBlend(
    replay?.events ?? [],
    replay?.selectedIndex ?? -1,
    replay?.cursor ?? 0,
  ));
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [loadedModelCount, setLoadedModelCount] = useState(0);
  const [animationNames, setAnimationNames] = useState<string[]>([]);
  const [selectedAnimationIndex, setSelectedAnimationIndex] = useState(0);
  const [animationMode, setAnimationMode] = useState<AnimationMode>("replay");
  const [isManualPlaying, setIsManualPlaying] = useState(false);
  const [selectedNativeFileDataId, setSelectedNativeFileDataId] = useState<NativeEffectAsset["fileDataId"]>(794788);
  const [nativePreviewTime, setNativePreviewTime] = useState(0);
  const [isNativePlaying, setIsNativePlaying] = useState(false);
  const [nativeStatus, setNativeStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [nativeEmitterCount, setNativeEmitterCount] = useState(0);
  const [nativeMeshTriangleCount, setNativeMeshTriangleCount] = useState(0);
  const [nativeTextureCount, setNativeTextureCount] = useState(0);
  const [nativeLimitations, setNativeLimitations] = useState("");
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [replayEffectStatus, setReplayEffectStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [replayEffectError, setReplayEffectError] = useState<string | null>(null);
  const [replayEffectLimitations, setReplayEffectLimitations] = useState<Record<number, { renderedEmitters: number; expectedEmitters: number; unsupportedEmitters: string[]; ribbonCount: number; details: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const nativePreviewTimeRef = useRef(0);
  const nativeLoadRequestRef = useRef(0);
  const replayEffectLoadRequestRef = useRef(0);
  const loadedReplayEventsRef = useRef<ReplayEvent[] | null>(null);
  const loadedNativeFileDataIdRef = useRef<number | null>(null);
  const replayStateRef = useRef(replay);

  const replayMotionBlend = resolveReplayMotionBlend(
    replay?.events ?? [],
    replay?.selectedIndex ?? -1,
    replay?.cursor ?? 0,
  );
  const replayAnimation = replayMotionBlend.incoming;
  replayAnimationRef.current = replayMotionBlend;
  replayStateRef.current = replay;
  nativePreviewTimeRef.current = nativePreviewTime;
  const selectedNativeAsset = NATIVE_EFFECT_ASSETS.find((asset) => asset.fileDataId === selectedNativeFileDataId) ?? NATIVE_EFFECT_ASSETS[0];
  const missingReplayClip = status === "ready"
    ? [replayAnimation, replayMotionBlend.outgoing].find((resolution) => resolution
      && isReplayClipMissing(resolution, animationNames))
    : null;
  const selectedReplayEvent = replay?.events[replay.selectedIndex];
  const selectedReplaySpell = selectedReplayEvent ? getSupportedReplaySpell(selectedReplayEvent) : null;
  const replayAssetIds = new Set((replay?.events ?? []).flatMap((event) =>
    getSupportedReplaySpell(event)?.components.map((component) => component.fileDataId) ?? []));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let context: WebGL2RenderingContext | null = null;
    try {
      context = canvas.getContext("webgl2", {
        alpha: false,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      // Some browsers throw instead of returning null when WebGL is disabled.
    }
    if (!context) {
      setStatus("error");
      setError(WEBGL_ERROR);
      return;
    }

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, context, antialias: true });
    } catch {
      setStatus("error");
      setError(WEBGL_ERROR);
      return;
    }

    let isUnmounted = false;
    let isStopped = false;
    let animationFrame = 0;
    let mixer: AnimationMixer | null = null;
    let activeAction: AnimationAction | null = null;
    let replayActions: AnimationAction[] = [];
    let nativeEffect: NativeParticleEffect | null = null;
    let nativeEffectGeneration = 0;
    let replayEffectGeneration = 0;
    let replayEffects: Array<{ asset: NativeEffectAsset; effect: NativeParticleEffect }> = [];
    let replayAnchors: ReturnType<typeof getReplayEffectAnchors> | null = null;
    let casterRoot: Group | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let modelBounds: Box3 | null = null;
    let defaultView: CameraView | null = null;
    const loadedRoots: Object3D[] = [];
    const scene = new Scene();
    canvas.dataset.replayNativeComponents = "0";
    canvas.dataset.replayNativeParticles = "0";
    canvas.dataset.replayNativeLatestSourceX = "";
    canvas.dataset.replayNativeMeshTriangles = "0";
    const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.01, 100);
    const controls = new OrbitControls(camera, canvas);
    const clock = new Clock();

    scene.background = new Color(0x111820);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.listenToKeyEvents(canvas);

    const hemisphereLight = new HemisphereLight(0xdcecff, 0x222016, 2.4);
    scene.add(hemisphereLight);
    const keyLight = new DirectionalLight(0xfff0d2, 4.2);
    keyLight.position.set(4, 7, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.camera.updateProjectionMatrix();
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0x8ab4ff, 2.2);
    fillLight.position.set(-5, 3, 2);
    scene.add(fillLight);

    const floor = new Mesh(
      new CircleGeometry(7, 72),
      new MeshStandardMaterial({ color: 0x202a32, roughness: 0.88, metalness: 0.03 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (modelBounds) defaultView = frameModels(camera, controls, modelBounds);
    };
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const clearReplayEffectEvidence = () => {
      canvas.dataset.replayNativeComponents = "0";
      canvas.dataset.replayNativeParticles = "0";
      canvas.dataset.replayNativeLatestSourceX = "";
      canvas.dataset.replayNativeMeshTriangles = "0";
      canvas.dataset.replayNativeFileDataIds = "";
    };

    const clearReplayEffects = () => {
      for (const { effect } of replayEffects) effect.clearInstances();
      clearReplayEffectEvidence();
    };

    const updateReplayEffects = () => {
      const replayState = replayStateRef.current;
      const requiredIds = new Set((replayState?.events ?? []).flatMap((event) =>
        getSupportedReplaySpell(event)?.components.map((component) => component.fileDataId) ?? []));
      if (animationModeRef.current !== "replay"
        || !replayState
        || !replayAnchors
        || replayEffects.length !== requiredIds.size
        || replayEffects.some(({ asset }) => !requiredIds.has(asset.fileDataId))) {
        clearReplayEffects();
        return true;
      }

      const anchors = replayAnchors;
      const caster = casterRoot;
      if (!caster) throw new Error("Replay caster model is unavailable.");
      const occurrences = resolveReplayEffectOccurrences(
        replayState.events,
        replayState.selectedIndex,
        replayState.cursor,
      );
      let particleCount = 0;
      let meshTriangles = 0;
      const activeFileDataIds: number[] = [];
      let componentCount = 0;
      try {
        for (const { asset, effect } of replayEffects) {
          const matching = occurrences.flatMap((occurrence) => occurrence.components
            .filter((component) => component.fileDataId === asset.fileDataId)
            .map((component) => ({ occurrence, component })));
          const instances: NativeParticleRenderInstance[] = matching.map(({ occurrence, component }) => {
            const source = getReplayEffectSourceAnchor(occurrence.spellId, component.fileDataId, caster, anchors.caster);
            return {
              timeSeconds: occurrence.componentTimeSeconds - (occurrence.spellId !== 117014 && (component.fileDataId === 4329984 || component.fileDataId === 6211617) ? REPLAY_EFFECT_RELEASE_SECONDS : 0),
              emissionEndSeconds: component.anchor === "projectile"
                ? getReplayEffectTravelSeconds(occurrence.spellId) : OTHER_REPLAY_EMISSION_SECONDS,
              modelScale: [4329984, 794788, 613807].includes(asset.fileDataId)
                ? asset.effectNameScale : NATIVE_REPLAY_BASE_SCALE * asset.effectNameScale,
              sourceTranslationAtTime: (timeSeconds) => threeToNative(component.anchor === "projectile"
                ? sampleReplayEffectPath(source, anchors.target, timeSeconds, occurrence.spellId)
                : component.anchor === "caster" ? source : anchors.target),
            };
          });
          particleCount += effect.setReplayInstances(instances, camera);
          meshTriangles += instances.filter((instance) => instance.timeSeconds >= 0).length * effect.meshTriangleCount;
          componentCount += matching.length;
        }
      } catch (caught) {
        const reason = caught instanceof Error ? caught.message : "Native replay rendering failed.";
        for (const { effect } of replayEffects) effect.dispose();
        replayEffects = [];
        clearReplayEffectEvidence();
        setReplayEffectStatus("error");
        setReplayEffectError(`${reason} No substitute effect was rendered.`);
        return false;
      }

      for (const occurrence of occurrences) {
        for (const component of occurrence.components) activeFileDataIds.push(component.fileDataId);
      }
      canvas.dataset.replayNativeComponents = String(componentCount);
      canvas.dataset.replayNativeParticles = String(particleCount);
      canvas.dataset.replayNativeMeshTriangles = String(meshTriangles);
      canvas.dataset.replayNativeFileDataIds = activeFileDataIds.join(",");
      const latestProjectile = occurrences.filter((occurrence) => occurrence.spellId === 117014).at(-1);
      canvas.dataset.replayNativeLatestSourceX = latestProjectile
        ? sampleReplayEffectPath(
            getReplayEffectSourceAnchor(latestProjectile.spellId, 4329984, caster, anchors.caster),
            anchors.target,
            latestProjectile.componentTimeSeconds,
            latestProjectile.spellId,
          ).x.toFixed(6)
        : "";
      return true;
    };

    const renderFrame = () => {
      if (isStopped) return;
      animationFrame = requestAnimationFrame(renderFrame);
      const delta = Math.min(clock.getDelta(), 0.1);
      if (animationModeRef.current === "manual") mixer?.update(delta);
      controls.update();
      if (animationModeRef.current === "replay") updateReplayEffects();
      if (animationModeRef.current === "native" && nativeEffect) {
        try {
          nativeEffect.setTime(nativePreviewTimeRef.current, camera);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Native particle rendering failed.";
          nativeEffect.dispose();
          nativeEffect = null;
          setNativeStatus("error");
          setNativeError(`${message} No substitute effect was rendered.`);
        }
      }
      renderer.render(scene, camera);
    };
    renderFrame();

    const stop = () => {
      if (isStopped) return;
      isStopped = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      controls.stopListenToKeyEvents();
      controls.dispose();
      mixer?.stopAllAction();
      nativeEffectGeneration += 1;
      replayEffectGeneration += 1;
      nativeEffect?.dispose();
      nativeEffect = null;
      for (const { effect } of replayEffects) effect.dispose();
      replayEffects = [];
      clearReplayEffectEvidence();
      for (const root of loadedRoots) disposeObject(root);
      floor.geometry.dispose();
      floor.material.dispose();
      renderer.dispose();
      controllerRef.current = null;
    };

    const prepare = async () => {
      const loader = new GLTFLoader();
      const loadTracked = async (asset: (typeof MODEL_ASSETS)[keyof typeof MODEL_ASSETS]) => {
        const gltf = await loadModel(loader, asset);
        loadedRoots.push(gltf.scene);
        if (isStopped) {
          disposeObject(gltf.scene);
          return gltf;
        }
        setLoadedModelCount((count) => count + 1);
        return gltf;
      };

      let vulpera: GLTF;
      let trainingDummy: GLTF;
      try {
        [vulpera, trainingDummy] = await Promise.all([
          loadTracked(MODEL_ASSETS.vulpera),
          loadTracked(MODEL_ASSETS.trainingDummy),
        ]);
      } catch (caught) {
        if (!isUnmounted) {
          stop();
          setStatus("error");
          setError(caught instanceof Error ? caught.message : "The genuine models could not be loaded.");
        }
        return;
      }
      if (isStopped) return;

      configureVulperaMaterials(vulpera.scene);
      // Facial bones extend along native +X, so these rotations face both exports toward each other.
      arrangeCombatants(vulpera.scene, trainingDummy.scene);
      casterRoot = vulpera.scene;
      replayAnchors = getReplayEffectAnchors(vulpera.scene, trainingDummy.scene);
      scene.add(vulpera.scene, trainingDummy.scene);

      modelBounds = new Box3()
        .setFromObject(vulpera.scene)
        .union(new Box3().setFromObject(trainingDummy.scene));
      defaultView = frameModels(camera, controls, modelBounds);
      const clips = vulpera.animations;
      const animationClipNames = clips.map((clip) => clip.name);
      const defaultClipIndex = Math.max(0, animationClipNames.indexOf(STAND_CLIP_NAME));
      mixer = new AnimationMixer(vulpera.scene);
      let activeClipIndex = -1;

      const duplicateActions = new Map<number, AnimationAction>();
      const activateClip = (index: number, shouldRestart: boolean) => {
        const clip = clips[index];
        if (!clip || !mixer) return null;
        for (const action of replayActions) action.stop();
        replayActions = [];
        if (activeClipIndex !== index) {
          activeAction?.stop();
          activeAction = mixer.clipAction(clip);
          activeClipIndex = index;
          shouldRestart = true;
        }
        const action = activeAction;
        if (!action) return null;
        if (shouldRestart) action.reset().play();
        action.setEffectiveWeight(1);
        return action;
      };
      const applyReplayAnimation = (blend: ReplayMotionBlend) => {
        if (!mixer) return;
        activeAction?.stop();
        activeAction = null;
        activeClipIndex = -1;
        const incomingIndex = blend.incoming.kind === "motion"
          ? animationClipNames.indexOf(blend.incoming.clipName) : defaultClipIndex;
        const canBlend = incomingIndex >= 0 && (!blend.outgoing
          || blend.outgoing.kind !== "motion"
          || animationClipNames.includes(blend.outgoing.clipName));
        const samples = canBlend && blend.outgoing
          ? [{ resolution: blend.outgoing, weight: 1 - blend.incomingWeight, isOutgoing: true },
            { resolution: blend.incoming, weight: blend.incomingWeight, isOutgoing: false }]
          : [{ resolution: blend.incoming, weight: 1, isOutgoing: false }];
        const nextActions: AnimationAction[] = [];
        for (const { resolution, weight, isOutgoing } of samples) {
          if (weight === 0) continue;
          const requestedIndex = resolution.kind === "motion"
            ? animationClipNames.indexOf(resolution.clipName) : defaultClipIndex;
          const index = requestedIndex >= 0 ? requestedIndex : defaultClipIndex;
          const clip = clips[index];
          if (!clip) return;
          const isRepeatedClip = isOutgoing && index === incomingIndex && blend.incoming.kind === "motion";
          const action = isRepeatedClip
            ? duplicateActions.get(index) ?? mixer.clipAction(clip.clone())
            : mixer.clipAction(clip);
          if (isRepeatedClip) duplicateActions.set(index, action);
          if (!replayActions.includes(action)) action.reset().play();
          action.paused = true;
          action.time = resolution.kind === "motion" && requestedIndex >= 0
            ? Math.min(resolution.clipTime, Math.max(0, clip.duration - 0.0001))
            : 0;
          action.setEffectiveWeight(weight);
          nextActions.push(action);
        }
        for (const action of replayActions) {
          if (!nextActions.includes(action)) action.stop();
        }
        replayActions = nextActions;
        mixer.update(0);
      };
      const playManualClip = (index: number, shouldPlay: boolean) => {
        const action = activateClip(index, true);
        if (!action || !mixer) return;
        action.paused = !shouldPlay;
        mixer.update(0);
      };
      const resetCamera = () => {
        if (!defaultView) return;
        camera.position.copy(defaultView.position);
        controls.target.copy(defaultView.target);
        controls.update();
      };

      controllerRef.current = {
        applyReplayAnimation,
        playManualClip,
        setManualPlaying: (shouldPlay) => {
          if (activeAction) activeAction.paused = !shouldPlay;
        },
        loadNativeEffect: async (asset) => {
          const generation = ++nativeEffectGeneration;
          nativeEffect?.dispose();
          nativeEffect = null;
          const loadedEffect = await loadNativeParticleEffect(asset);
          if (isStopped || generation !== nativeEffectGeneration) {
            loadedEffect.dispose();
            return null;
          }
          nativeEffect = loadedEffect;
          nativeEffect.group.visible = animationModeRef.current === "native";
          scene.add(nativeEffect.group);
          nativeEffect.setTime(nativePreviewTimeRef.current, camera);
          return nativeEffect;
        },
        loadReplayEffects: async () => {
          const generation = ++replayEffectGeneration;
          for (const { effect } of replayEffects) effect.dispose();
          replayEffects = [];
          const requiredIds = new Set((replayStateRef.current?.events ?? []).flatMap((event) =>
            getSupportedReplaySpell(event)?.components.map((component) => component.fileDataId) ?? []));
          const assets = NATIVE_EFFECT_ASSETS.filter((asset) => requiredIds.has(asset.fileDataId));
          const missing = [...requiredIds].filter((fileDataId) => !assets.some((asset) => asset.fileDataId === fileDataId));
          if (missing.length > 0) throw new Error(`Missing pinned replay FileDataID ${missing.join(", ")}. No substitute effect was rendered.`);
          const results = await Promise.allSettled(assets.map(async (asset) => {
            const instanceLimit = REPLAY_COMPONENT_INSTANCE_LIMITS.get(asset.fileDataId);
            if (!instanceLimit) throw new Error(`FileDataID ${asset.fileDataId}: no measured replay instance bound. No substitute effect was rendered.`);
            return { asset, effect: await loadNativeParticleEffect(asset, instanceLimit) };
          }));
          const loaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
          if (isStopped || generation !== replayEffectGeneration) {
            for (const { effect } of loaded) effect.dispose();
            return false;
          }
          const failure = results.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") {
            for (const { effect } of loaded) effect.dispose();
            const reason = failure.reason instanceof Error ? failure.reason.message : "Unknown native asset failure.";
            throw new Error(reason);
          }
          replayEffects = loaded;
          setReplayEffectLimitations(Object.fromEntries(loaded.map(({ asset, effect }) => [asset.fileDataId, {
            renderedEmitters: effect.renderedEmitterCount,
            expectedEmitters: asset.expectedEmitterCount,
            unsupportedEmitters: effect.unsupportedEmitters,
            ribbonCount: effect.model.ribbons.length,
            details: describeNativeEffectLimitations(effect),
          }])));
          for (const { effect } of replayEffects) {
            effect.group.visible = animationModeRef.current === "replay";
            scene.add(effect.group);
          }
          return updateReplayEffects();
        },
        setNativeVisible: (isVisible) => {
          if (nativeEffect) nativeEffect.group.visible = isVisible;
        },
        setReplayVisible: (isVisible) => {
          for (const { effect } of replayEffects) effect.group.visible = isVisible;
          if (isVisible) updateReplayEffects();
          else clearReplayEffects();
        },
        resetCamera,
      };
      setAnimationNames(animationClipNames);
      setSelectedAnimationIndex(defaultClipIndex);
      if (animationModeRef.current === "replay") {
        applyReplayAnimation(replayAnimationRef.current);
      } else {
        playManualClip(defaultClipIndex, false);
      }
      setStatus("ready");
    };

    void prepare();

    return () => {
      isUnmounted = true;
      stop();
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || loadedReplayEventsRef.current === replay?.events) return;
    loadedReplayEventsRef.current = replay?.events ?? null;
    const requestId = ++replayEffectLoadRequestRef.current;
    let isCurrent = true;
    setReplayEffectStatus("loading");
    setReplayEffectError(null);
    setReplayEffectLimitations({});
    void controllerRef.current?.loadReplayEffects().then((isReady) => {
      if (!isCurrent || requestId !== replayEffectLoadRequestRef.current || !isReady) return;
      setReplayEffectStatus("ready");
    }).catch((caught) => {
      if (!isCurrent || requestId !== replayEffectLoadRequestRef.current) return;
      const reason = caught instanceof Error ? caught.message : "The original replay components could not be loaded.";
      setReplayEffectStatus("error");
      setReplayEffectError(reason);
    });
    return () => {
      isCurrent = false;
    };
  }, [status, replay?.events]);

  useEffect(() => {
    animationModeRef.current = animationMode;
    controllerRef.current?.setNativeVisible(animationMode === "native");
    controllerRef.current?.setReplayVisible(animationMode === "replay");
    if (animationMode === "manual") {
      controllerRef.current?.playManualClip(selectedAnimationIndex, false);
      return;
    }
    setIsManualPlaying(false);
    if (animationMode === "native") {
      controllerRef.current?.playManualClip(selectedAnimationIndex, false);
      return;
    }
    setIsNativePlaying(false);
  }, [animationMode]);

  useEffect(() => {
    if (animationMode !== "native" || status !== "ready") return;
    if (loadedNativeFileDataIdRef.current === selectedNativeAsset.fileDataId && nativeStatus === "ready") {
      controllerRef.current?.setNativeVisible(true);
      return;
    }
    const requestId = ++nativeLoadRequestRef.current;
    let isCurrent = true;
    setNativeStatus("loading");
    setNativeError(null);
    setNativeEmitterCount(0);
    setNativeMeshTriangleCount(0);
    setNativeTextureCount(0);
    setNativeLimitations("");
    void controllerRef.current?.loadNativeEffect(selectedNativeAsset).then((effect) => {
      if (!isCurrent || requestId !== nativeLoadRequestRef.current || !effect) return;
      loadedNativeFileDataIdRef.current = selectedNativeAsset.fileDataId;
      setNativeEmitterCount(effect.renderedEmitterCount);
      setNativeMeshTriangleCount(effect.meshTriangleCount);
      setNativeLimitations(describeNativeEffectLimitations(effect));
      setNativeTextureCount(effect.model.textureFileDataIds.length);
      setNativeStatus("ready");
    }).catch((caught) => {
      if (!isCurrent || requestId !== nativeLoadRequestRef.current) return;
      loadedNativeFileDataIdRef.current = null;
      setNativeStatus("error");
      setNativeError(caught instanceof Error ? caught.message : "The native M2 component could not be loaded. No substitute effect was rendered.");
    });
    return () => {
      isCurrent = false;
    };
  }, [animationMode, selectedNativeAsset, status]);

  useEffect(() => {
    if (animationMode !== "native" || !isNativePlaying) return;
    let frameId = 0;
    let previous: number | null = null;
    const advance = (now: number) => {
      const elapsed = previous === null ? 0 : (now - previous) / 1000;
      previous = now;
      setNativePreviewTime((current) => (current + elapsed) % NATIVE_PREVIEW_DURATION_SECONDS);
      frameId = requestAnimationFrame(advance);
    };
    frameId = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frameId);
  }, [animationMode, isNativePlaying]);

  useEffect(() => {
    if (animationMode !== "replay") return;
    controllerRef.current?.applyReplayAnimation(replayMotionBlend);
  }, [animationMode, replay?.events, replay?.selectedIndex, replay?.cursor]);

  const onAnimationChange = (index: number) => {
    setSelectedAnimationIndex(index);
    controllerRef.current?.playManualClip(index, isManualPlaying);
  };

  const onManualPlaybackToggle = () => {
    const nextIsPlaying = !isManualPlaying;
    setIsManualPlaying(nextIsPlaying);
    controllerRef.current?.setManualPlaying(nextIsPlaying);
  };

  const selectAnimationMode = (nextMode: AnimationMode) => {
    if (nextMode !== "replay" && replay?.isPlaying) replay.onTogglePlayback();
    if (nextMode !== "manual") setIsManualPlaying(false);
    if (nextMode !== "native") setIsNativePlaying(false);
    setAnimationMode(nextMode);
  };

  const onNativeComponentChange = (fileDataId: NativeEffectAsset["fileDataId"]) => {
    nativeLoadRequestRef.current += 1;
    loadedNativeFileDataIdRef.current = null;
    setSelectedNativeFileDataId(fileDataId);
    setNativePreviewTime(0);
    setIsNativePlaying(false);
    setNativeStatus("idle");
    setNativeError(null);
  };

  const onNativePlaybackToggle = () => {
    if (nativeStatus !== "ready") return;
    if (nativePreviewTime >= NATIVE_PREVIEW_DURATION_SECONDS) setNativePreviewTime(0);
    setIsNativePlaying((current) => !current);
  };

  const onNativeReset = () => {
    setIsNativePlaying(false);
    setNativePreviewTime(0);
  };

  return (
    <section className="model-scene" aria-labelledby="model-scene-title">
      <div className="model-scene-heading">
        <div>
          <p className="eyebrow">Genuine exported assets</p>
          <h2 id="model-scene-title">Genuine WoW model scene</h2>
        </div>
        <p>Drag to orbit · scroll to zoom · focus the canvas for arrow-key pan</p>
      </div>

      <div className="model-stage">
        <canvas
          ref={canvasRef}
          className="model-canvas"
          aria-label="Interactive view of a genuine Vulpera and training dummy"
          tabIndex={0}
        />
        <div className="model-labels" aria-label="Models in scene">
          <span><i className={status === "ready" ? "is-ready" : ""} />Default Vulpera</span>
          <span><i className={status === "ready" ? "is-ready" : ""} />Training Dummy</span>
        </div>
        {status === "loading" && (
          <div className="model-loading" aria-hidden="true">
            <span />
            Loading genuine models
          </div>
        )}
      </div>

      {error && (
        <div className="model-error" role="alert">
          <strong>Genuine model scene unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="animation-mode-tabs" aria-label="Character animation mode">
        <button
          type="button"
          aria-pressed={animationMode === "replay"}
          onClick={() => selectAnimationMode("replay")}
        >
          Replay sync
        </button>
        <button
          type="button"
          aria-pressed={animationMode === "manual"}
          onClick={() => selectAnimationMode("manual")}
        >
          Manual preview
        </button>
        <button
          type="button"
          aria-pressed={animationMode === "native"}
          onClick={() => selectAnimationMode("native")}
        >
          Native M2 component preview
        </button>
      </div>

      {animationMode === "replay" ? (
        <>
          <div className="replay-motion-status" data-animation-kind={missingReplayClip ? "missing" : replayAnimation.kind} aria-live="polite">
            <span>Selected recorded action</span>
            <strong>{replayAnimation.eventLabel}</strong>
            <small>
              {missingReplayClip
                ? `Required ${missingReplayClip === replayAnimation ? "" : "outgoing "}exported clip missing (${missingReplayClip.clipName}) — ${missingReplayClip === replayAnimation ? "idle" : "transition omitted"}.`
                : replayAnimation.status}
            </small>
          </div>
          {replayEffectStatus === "loading" && (
            <p data-testid="replay-effect-status">
              Loading the selected trace's source-linked original components…
            </p>
          )}
          {replayEffectStatus === "ready" && (
            <p data-testid="replay-effect-status">
              <strong>{replayAssetIds.size > 0 ? "Original components ready" : "No original components required for this trace"}</strong>
              {replayAssetIds.has(6211617) && <span> · Lightning Bolt: 5 of 5 original emitters + 1 of 1 original LOD0 mesh batches (64 triangles, two original texture units combined (shader 0x14, UV0/UV0; shared BLP)) · FileDataID 6211617</span>}
              {replayAssetIds.has(4329984) && <span> · Shared Lava Burst / Elemental Blast missile: 10 of 10 emitters + 3 of 3 original ribbons (partially reconstructed) · FileDataID 4329984</span>}
              {replayAssetIds.has(794788) && <span> · Elemental Blast: 12 of 12 authored emitters ready in its two additional bodies · 9 original BLP textures · FileDataID 4329984 + 794788 + 613807</span>}
              <span> · Trace FileDataIDs: {[...replayAssetIds].join(", ") || "none"}</span>
              <small> · {replayAssetIds.has(794788) ? "Partial original Elemental Blast components and partial other spell components" : "Partial source-linked components only"}, not complete spells or verified native timing.</small>
            </p>
          )}
          {selectedReplaySpell && (selectedReplayEvent?.id === 51505 || selectedReplayEvent?.id === 117014 || selectedReplayEvent?.id === 188196) && (
            <p data-testid="replay-flight-status">
              {selectedReplayEvent.id === 188196
                ? "Lightning Bolt: viewer-chosen 0.80s; all three mapped SpellVisualEffectName speeds are 0 (not derived from authored speed)."
                : `${selectedReplayEvent.id === 51505 ? "Lava Burst" : "Elemental Blast"}: derived ${getReplayEffectTravelSeconds(selectedReplayEvent.id).toFixed(2)}s = SpellRange 5 maximum 40 yards / SpellVisualEffectName 47399 BaseMissileSpeed 50 (SpellMisc row ${selectedReplayEvent.id === 51505 ? 33331 : 89780} RangeIndex 5); assumes authored maximum range because the trace records no caster-target distance.`}
              {selectedReplayEvent.id === 117014 && " 2 of 3 rendered bodies have speed 0 and inherit the shared body's derived duration; motion scripts 2967, 2969, 2968 not applied."}
              {selectedReplayEvent.id === 188196 && " Branch motion 4856 parabola versus 0 unresolved; no arc applied."}
              {selectedReplayEvent.id === 51505 && " Motion ID 0 has no authored script."}
              {" 2 of 3 mapped projectile spell durations derived; 1 of 3 viewer-chosen. 0.20s viewer-chosen release; linear viewer path across 8 presentation units, not game yards; at most 1.50s source particle decay. Positioner 712 impact (Elemental Blast) and 513 cast (Lightning Bolt) have unresolved coordinate semantics; blocked FileDataID 3980281 has source attachment -1 and no cast/impact positioner (0/0), so its source origin remains unresolved. Missile FollowGroundHeight/DropSpeed/Approach, Flags and DecayTimeAfterImpact are not interpreted."}
            </p>
          )}
          {selectedReplaySpell && (
            <p data-testid="replay-anchor-status">
              Across the mapped spell list, 6 of 19 mapped components use authored caster bone origins and 13 remain bounds-anchored. Placement: {selectedReplaySpell.components.filter((component) =>
                Boolean(REPLAY_SOURCE_ATTACHMENTS[selectedReplayEvent!.id!]?.[component.fileDataId])).length} of {selectedReplaySpell.components.length} components use authored caster bone origins; remaining components use 60%-bounds anchors.
              {selectedReplaySpell.components.map((component) =>
                ` FileDataID ${component.fileDataId}: ${describeReplayComponentAnchor(selectedReplayEvent!.id!, component)}.`).join("")}
            </p>
          )}
          {selectedReplaySpell && (
            <p data-testid="replay-spell-components">
              {replayAnimation.eventLabel} ({selectedReplayEvent?.id}): {selectedReplaySpell.components.length > 0
                ? `mapped original FileDataIDs ${selectedReplaySpell.components.map((component) => component.fileDataId).join(", ")} · partial components when loaded, not complete spell visuals`
                : "no verified component; no substitute rendered"}.
            </p>
          )}
          {selectedReplaySpell && (selectedReplayEvent?.id === 51505 || selectedReplayEvent?.id === 117014) && (
            <p data-testid="replay-missile-blocker">
              FileDataID 3980281: 1 of {selectedReplayEvent.id === 51505 ? 2 : 4} original missile bodies omitted; no substitute rendered. Its acquired LOD0 SKIN has 2 of 2 mesh batches (1,576 vertex references, 4,722 indices, 1,574 triangles), 13 emitters (one refractive), and 3 ribbons. Both the full render and emitters-and-ribbons-only render were inspected and rejected as incoherent. Source attachment -1 differs from 4329984 attachments 34/21. The omitted body remains unrendered; the rendered 4329984 uses the source bone origin where mapped, while its dummy endpoint remains bounds-anchored. That difference is recorded, not established as the cause.
            </p>
          )}
          {selectedReplaySpell && (selectedReplayEvent?.id === 51505 || selectedReplayEvent?.id === 117014) && (
            <p data-testid="replay-ribbon-limitation">
              FileDataID 4329984 ribbon 1 (with a smaller overlapping strip from ribbon 2): during roughly the final 0.3 seconds, the remaining trail renders as a hard-edged bright quad. The primary BLP’s 8-bit alpha and authored M2 blend mode 2 are applied. Sampled post-arrival source positions refute edge accumulation; the cause remains unresolved. Secondary texture slots and native ribbon edge behavior are not fully reconstructed.
            </p>
          )}
          {selectedReplayEvent?.phase === "precombat" && (
            <p data-testid="replay-precombat-status">
              Precombat record: public-fixture precombat actions share timestamp zero. Mapped original components begin simultaneously at cursor zero; this is not a recorded setup timeline.
            </p>
          )}
          {replayEffectStatus === "ready" && selectedReplaySpell && selectedReplaySpell.components.length > 0 && (
            <details data-testid="replay-effect-limitations">
              <summary>
                Selected source limitations: {selectedReplaySpell.components.map((component) => {
                  const limitation = replayEffectLimitations[component.fileDataId];
                  if (!limitation) return `FileDataID ${component.fileDataId}: unavailable`;
                  return `FileDataID ${component.fileDataId}: ${limitation.renderedEmitters} of ${limitation.expectedEmitters} authored emitters${limitation.ribbonCount ? `; ${limitation.ribbonCount} of ${limitation.ribbonCount} authored ribbons (partial)` : ""}; ${limitation.unsupportedEmitters.join(", ") || "no omitted emitters"}`;
                }).join(" · ")} · when authored, secondary textures, TXAC, color flags and blend 7 have renderer limitations (expand for per-emitter details).
              </summary>
              {selectedReplaySpell.components.map((component) => (
                <p key={component.fileDataId}>FileDataID {component.fileDataId}: {describeReplayComponentAnchor(selectedReplayEvent!.id!, component)} · {replayEffectLimitations[component.fileDataId]?.details || "No additional renderer limitations recorded."}</p>
              ))}
            </details>
          )}
          {replayEffectError && (
            <div className="model-error replay-effect-error" role="alert">
              <strong>Original replay components unavailable.</strong>
              <span>{replayEffectError}</span>
            </div>
          )}
          {replay ? (
            <div className="transport model-replay-controls" aria-label="Replay controls">
              <button type="button" onClick={() => replay.onSelectEvent(replay.selectedIndex - 1)} disabled={replay.selectedIndex === 0} aria-label="Previous event">Previous</button>
              <button className="play-button" type="button" onClick={replay.onTogglePlayback} disabled={replay.maxTime === 0}>{replay.isPlaying ? "Pause" : "Play"}</button>
              <button type="button" onClick={() => replay.onSelectEvent(replay.selectedIndex + 1)} disabled={replay.selectedIndex === replay.events.length - 1} aria-label="Next event">Next</button>
              <button type="button" onClick={replay.onReset}>Reset</button>
              <label className="speed-control">Speed<select value={replay.speed} onChange={(event) => replay.onSpeedChange(Number(event.target.value) as ReplaySpeed)}>{[0.5, 1, 2].map((value) => <option value={value} key={value}>{value}×</option>)}</select></label>
              <label className="seek-control"><span>Seek</span><input aria-label="Seek playback" type="range" min="0" max={Math.max(replay.maxTime, 0.001)} step="any" value={replay.cursor} onChange={(event) => replay.onSeek(Number(event.target.value))} /><span className="seek-output">{replay.cursor.toFixed(replay.cursor < 10 ? 2 : 1)}s</span></label>
              <button type="button" onClick={() => controllerRef.current?.resetCamera()} disabled={status !== "ready"}>Reset camera</button>
            </div>
          ) : (
            <div className="replay-unavailable">
              Replay sync is unavailable. The genuine scene and separate manual preview remain usable.
            </div>
          )}
        </>
      ) : animationMode === "manual" ? (
        <div className="model-controls">
          <label>
            <span>Exported character animation</span>
            <select
              aria-label="Exported character animation"
              value={selectedAnimationIndex}
              onChange={(event) => onAnimationChange(Number(event.target.value))}
              disabled={status !== "ready" || animationNames.length === 0}
            >
              {animationNames.length === 0 ? (
                <option>Animations load with the Vulpera model</option>
              ) : animationNames.map((name, index) => (
                <option value={index} key={`${name}-${index}`}>{name}</option>
              ))}
            </select>
          </label>
          <button
            className="model-play-button"
            type="button"
            onClick={onManualPlaybackToggle}
            disabled={status !== "ready" || animationNames.length === 0}
            aria-label={isManualPlaying ? "Pause animation" : "Play animation"}
          >
            {isManualPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => controllerRef.current?.resetCamera()}
            disabled={status !== "ready"}
          >
            Reset camera
          </button>
        </div>
      ) : (
        <div className="native-preview-panel">
          <div className="native-preview-heading">
            <div>
              <span>Original source component</span>
              <strong>{selectedNativeAsset.label}</strong>
              <small>{selectedNativeAsset.filename} · FileDataID {selectedNativeAsset.fileDataId}</small>
            </div>
            <p>Original {selectedNativeAsset.skin ? "mesh + particle" : "particle"} component preview · not a complete spell</p>
          </div>
          <label className="native-component-select">
            <span>Original M2 component</span>
            <select
              aria-label="Original M2 component"
              value={selectedNativeFileDataId}
              onChange={(event) => onNativeComponentChange(Number(event.target.value) as NativeEffectAsset["fileDataId"])}
              disabled={status !== "ready"}
            >
              {NATIVE_EFFECT_ASSETS.map((asset) => (
                <option value={asset.fileDataId} key={asset.fileDataId}>
                  {asset.label} · FileDataID {asset.fileDataId}
                </option>
              ))}
            </select>
          </label>
          {nativeStatus === "loading" && (
            <p role="status" data-testid="native-effect-status">
              Loading original M2 and {selectedNativeAsset.textures.length} BLP textures for FileDataID {selectedNativeAsset.fileDataId}…
            </p>
          )}
          {nativeStatus === "ready" && (
            <p role="status" data-testid="native-effect-status" data-native-file-data-id={selectedNativeAsset.fileDataId}>
              <strong>{nativeEmitterCount} of {selectedNativeAsset.expectedEmitterCount} authored emitters ready</strong>
              <span> · {selectedNativeAsset.expectedRibbonCount ? `${selectedNativeAsset.expectedRibbonCount} of ${selectedNativeAsset.expectedRibbonCount} original ribbons (partially reconstructed) · ` : ""}{nativeTextureCount} original BLP textures · FileDataID {selectedNativeAsset.fileDataId}{selectedNativeAsset.skin ? ` · LOD0 mesh 1 of 1 batches, ${nativeMeshTriangleCount} triangles (${selectedNativeFileDataId === 4290517 ? "two original textures combined (shader 0x4014, UV0/UV1)" : "two original texture units combined (shader 0x14, UV0/UV0; shared BLP)"})` : ""}</span>
              <small> · {selectedNativeFileDataId === 794788 || selectedNativeFileDataId === 613807
                ? "Component proof, not complete Elemental Blast."
                : selectedNativeAsset.skin ? "Original mesh + particle preview, not a complete spell." : "Particle component preview, not a complete spell."}{nativeLimitations ? ` · ${nativeLimitations}` : ""}</small>
            </p>
          )}
          {nativeError && (
            <div className="model-error native-effect-error" role="alert">
              <strong>Native M2 component unavailable.</strong>
              <span>{nativeError}</span>
            </div>
          )}
          <div className="transport native-preview-controls" aria-label="Native M2 component preview controls">
            <button
              className="play-button"
              type="button"
              onClick={onNativePlaybackToggle}
              disabled={nativeStatus !== "ready"}
              aria-label={isNativePlaying ? "Pause native preview" : "Play native preview"}
            >
              {isNativePlaying ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={onNativeReset}>Reset original preview</button>
            <label className="seek-control">
              <span>Preview time</span>
              <input
                aria-label="Native preview time"
                type="range"
                min="0"
                max={NATIVE_PREVIEW_DURATION_SECONDS}
                step="0.001"
                value={nativePreviewTime}
                onChange={(event) => {
                  setIsNativePlaying(false);
                  setNativePreviewTime(Number(event.target.value));
                }}
              />
              <span className="seek-output">{nativePreviewTime.toFixed(2)}s</span>
            </label>
            <button type="button" onClick={() => controllerRef.current?.resetCamera()} disabled={status !== "ready"}>Reset camera</button>
          </div>
        </div>
      )}

      <div className="model-ready-status">
        {status === "loading" && (
          <p role="status">Loading genuine models ({loadedModelCount} of 2)…</p>
        )}
        {status === "ready" && (
          <p role="status">Both genuine models ready · {animationNames.length} exported character clips</p>
        )}
      </div>

      <p className="model-disclaimer">
        {animationMode === "replay"
          ? "Replay sync samples illustrative exported motion and original source-linked particle components for mapped successful actions, with six authored caster bone origins (including two Stormkeeper kit components) and thirteen explicitly named bounds-anchored components, plus a 0.20s emission window and decay. Lightning Shield, Lava Burst, and Lightning Bolt are conditional source visual branches, not guaranteed appearances. Missiles for these three spells use a viewer-chosen 0.20s release and linear path; Lava Burst and Elemental Blast use a 0.80s maximum-range-derived duration (40 yards / BaseMissileSpeed 50), while Lightning Bolt retains a viewer-chosen 0.80s flight because its mapped speeds are 0. Unapplied motion scripts and positioners are counted in selected status and per-component limitations. Lava Burst and Elemental Blast share original ribbon/particle missile 4329984; Lightning Bolt adds original mesh/particle missile 6211617 with its two-unit Mod2x mesh material (both units sample the original shared BLP on UV0). Source conditions do not establish which branch appears. Shared alternate missile 3980281 is blocked for both spells and counted at the selected action. Ancestral Swiftness has no replay-ready component: 4290517 is inspectable only in Native M2 preview because the combined, fast-fading component is not a discernible ancestor figure at viewer scale. No complete spell, native cast/impact timing, exact M2 attachment offsets or the Stormkeeper 1284864 kit offset, sound, damage, hit reaction, or VFX parity is claimed."
          : animationMode === "manual"
            ? "Manual preview is separate from replay time. It does not show spell impact timing, damage, VFX, hit reactions, or optimal play."
            : `Native preview time is an isolated, stationary component-viewer clock, not missile travel, a cast, an impact, or a simulation event. It renders only the selected original M2 component, its original BLP textures, and its pinned SKIN where applicable; it is not ${selectedNativeFileDataId === 794788 || selectedNativeFileDataId === 613807 ? "the complete Elemental Blast composite" : "a complete spell"}.`}
      </p>
    </section>
  );
}
