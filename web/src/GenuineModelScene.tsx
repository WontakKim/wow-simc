import { useEffect, useRef, useState } from "react";
import {
  BackSide,
  Box3,
  Clock,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ReplayEvent } from "./replay";
import type { CombatTimeline } from "./combatLog";
import {
  loadNativeParticleEffect,
  type NativeParticleEffect,
  type NativeParticleRenderInstance,
} from "./NativeParticleEffect";
import { NATIVE_EFFECT_ASSETS, NATIVE_PREVIEW_DURATION_SECONDS, type NativeEffectAsset } from "./nativeEffectAssets";
import { selectParticlePixelShader } from "./nativeM2Blend";
import nativeModelManifest from "./nativeModelManifest.json";
import appearanceJson from "./vulperaAppearance.json";
import { loadAppearanceTextures, loadNativeActorBundle, type NativeModelManifest } from "./m2/actorLoader";
import { compileGeosetVisibility } from "./m2/appearance";
import { isCreatureGeosetVisible } from "./m2/geosets";
import previewStageJson from "./previewStage.json";
import { parsePreviewStage } from "./m2/previewStage";
import { NATIVE_TO_THREE_BASIS, threeToNativePoint } from "./m2/coordinates";
import { STAND_ANIMATION_ID, animationOptionLabel } from "./m2/animations";
import {
  blendBoneMatrices,
  resolveSequence,
  sampleBoneMatrices,
  type SequenceResolution,
} from "./m2/sampler";
import { createNativeM2Actor, type NativeM2Actor } from "./m2/renderer";
import type { M2Sequence } from "./m2/model";

// resolveJsonModule widens the asset `kind` strings; the manifest is generated
// by script/prepare-native-models.mjs and pinned by SHA-256 per asset.
const manifest = nativeModelManifest as NativeModelManifest;
const PREVIEW_STAGE = parsePreviewStage(previewStageJson);

const ACTOR_ASSETS = {
  vulpera: { label: "Vulpera", manifestName: "vulpera-male" },
  trainingDummy: { label: "Training Dummy", manifestName: "training-dummy" },
} as const;

// Native M2 actors are Z-up; the basis conversion is applied exactly once, at
// the actor root (NATIVE_TO_THREE_BASIS = C from ./m2/coordinates). The
// Vulpera is authored facing native +X, which C already keeps on three +X, so
// no extra base yaw is needed and arrangeCombatants' 0 / pi rotations face the
// combatants toward each other.
export const NATIVE_BASIS = new Matrix4().fromArray(NATIVE_TO_THREE_BASIS);
export const ACTOR_BASE_YAW = 0;

const WEBGL_ERROR =
  "WebGL is unavailable. Use a browser with WebGL 2 enabled and turn on hardware acceleration, then reload. No placeholder model was substituted.";
const STAND_CLIP_NAME = animationOptionLabel(STAND_ANIMATION_ID, 0);
const CAMERA_FOV = 32; // fixed vertical FOV for both default framing and reset
const REPLAY_POSE_BLEND_SECONDS = 0.15;
const NATIVE_REPLAY_INSTANCE_LIMIT = 16;
const OTHER_REPLAY_EMISSION_SECONDS = 0.2;
type ReplayEffectAnchor = "caster" | "target" | "projectile";
type ReplayComponent = { fileDataId: number; anchor: ReplayEffectAnchor };
interface ReplaySpellEffect {
  actionName: string;
  components: ReplayComponent[];
}

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

// Peak simultaneous component counts measured from the pinned paired combat log,
// including overloads, impact decay, and shared assets across spell families.
export const REPLAY_COMPONENT_INSTANCE_LIMITS = new Map<number, number>([
  [794788, 4], [613807, 4], [4006618, 8], [1598036, 1],
  [1355634, 1], [1284864, 1], [1109885, 1], [4006621, 3],
  [3980244, 8], [4329984, 7], [6211617, 4], [6211618, 4], [1571475, 7], [4392095, 1], [4050773, 1],
]);
// SpellVisualMissile rows 28854 and 28867–28869 and SpellVisualKitModelAttach rows 321812/321824, build 12.1.0.69933.
// Mapped to native M2 attachment ids on the caster model (21 SpellHandL, 22 SpellHandR, 34 Chest).
export const REPLAY_SOURCE_ATTACHMENTS: Record<number, Record<number, number>> = {
  191634: { 1355634: 22, 1284864: 22 },
  51505: { 4329984: 34 },
  117014: { 4329984: 21, 794788: 22, 613807: 34 },
};
const NATIVE_REPLAY_BASE_SCALE = 0.38;

const ELEMENTAL_SHAMAN_ANIMATIONS = new Map<number, { actionName: string; animationId: number }>([
  [318038, { actionName: "flametongue_weapon", animationId: 54 }],
  [192106, { actionName: "lightning_shield", animationId: 862 }],
  [191634, { actionName: "stormkeeper", animationId: 828 }],
  [443454, { actionName: "ancestral_swiftness", animationId: 54 }],
  [1219480, { actionName: "ascendance", animationId: 1448 }],
  [51505, { actionName: "lava_burst", animationId: 1148 }],
  [188196, { actionName: "lightning_bolt", animationId: 830 }],
  [117014, { actionName: "elemental_blast", animationId: 1122 }],
  [188389, { actionName: "flame_shock", animationId: 53 }],
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
  travelDuration?: number;
  emissionDuration?: number;
  sourceActor?: string;
}

export interface ReplayAnimationResolution {
  kind: ReplayAnimationKind;
  eventLabel: string;
  clipName: string;
  /** Native M2 animation id; 0 (Stand) for every idle resolution. */
  animationId: number;
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
  timeline: CombatTimeline | null;
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

const LOGGED_EFFECT_DECAY_SECONDS = 1.5;

function getLoggedSpell(actionName: string) {
  const family = actionName.replace(/(?:_overload)?_asc$|_overload$/, "");
  return [...REPLAY_SPELL_EFFECTS.values()].find((spell) => spell.actionName === family);
}

function getLoggedAssetIds(timeline: CombatTimeline | undefined): Set<number> {
  return new Set(timeline
    ? [...timeline.occurrences.filter((occurrence) => !/_ancestor|_elemental|_wolf|_guardian/.test(occurrence.actor))
      .flatMap((occurrence) => getLoggedSpell(occurrence.actionName)?.components ?? []),
      ...timeline.auras.flatMap((aura) => getLoggedSpell(aura.name)?.components ?? [])]
      .map((component) => component.fileDataId)
    : []);
}

export function resolveLoggedEffectOccurrences(timeline: CombatTimeline, cursor: number): ReplayEffectOccurrence[] {
  const effects: ReplayEffectOccurrence[] = [];
  for (const occurrence of timeline.occurrences) {
    // No native pet actor is loaded. Do not move pet missiles to the player.
    if (/_ancestor|_elemental|_wolf|_guardian/.test(occurrence.actor)) continue;
    const spell = getLoggedSpell(occurrence.actionName);
    if (!spell) continue;
    const sourceActor = occurrence.actor;
    const add = (components: ReplayComponent[], start: number | null, end: number, travelDuration?: number) => {
      if (!components.length || start === null || cursor < start || cursor >= end) return;
      effects.push({ eventKey: occurrence.key, eventTime: occurrence.castFinish ?? start,
        elapsedSeconds: roundReplayTime(cursor - start), componentTimeSeconds: roundReplayTime(cursor - start),
        spellId: occurrence.spellId, components, travelDuration, sourceActor });
    };
    const components = spell.components;
    const impact = occurrence.impacts[0]?.time ?? null;
    // Buff visuals follow their aura transitions below, not the execution's arbitrary tail.
    if ([318038, 192106, 191634, 1219480].includes(occurrence.spellId)) continue;
    const release = occurrence.castFinish;
    add(components.filter((component) => component.anchor === "caster"),
      occurrence.castStart ?? release, (release ?? 0) + 0.2);
    add(components.filter((component) => component.anchor === "projectile"),
      occurrence.travelStart, impact ?? (occurrence.travelStart ?? 0) + (occurrence.travelDuration ?? 0), occurrence.travelDuration ?? undefined);
    if (impact !== null) add(components.filter((component) => component.anchor === "target"), impact, impact + LOGGED_EFFECT_DECAY_SECONDS);
  }
  const auraNames = new Set(["stormkeeper", "ascendance", "lightning_shield", "flametongue_weapon"]);
  const state = new Map<string, { time: number; ordinal: number; spellId: number; name: string }>();
  for (const aura of timeline.auras) {
    if (!auraNames.has(aura.name) || aura.time > cursor) continue;
    if (aura.stacks === 0) state.delete(`${aura.actor}/${aura.name}`);
    else if (aura.transition === "gain" || aura.transition === "refresh") {
      state.set(`${aura.actor}/${aura.name}`, { time: aura.time, ordinal: aura.ordinal, spellId: aura.spellId, name: aura.name });
    }
  }
  for (const [actor, aura] of state) {
    const spell = getLoggedSpell(aura.name);
    if (!spell) continue;
    const nextLoss = timeline.auras.find((event) => event.ordinal > aura.ordinal && event.name === aura.name
      && `${event.actor}/${event.name}` === actor && event.stacks === 0)?.time;
    effects.push({ eventKey: `aura-${aura.ordinal}`, eventTime: aura.time,
      elapsedSeconds: roundReplayTime(cursor - aura.time), componentTimeSeconds: roundReplayTime(cursor - aura.time),
      spellId: aura.spellId, components: spell.components, emissionDuration: (nextLoss ?? 45) - aura.time });
  }
  return effects;
}

export function getLoggedPlaybackEndTime(timeline: CombatTimeline) {
  return Math.max(0, ...timeline.occurrences.flatMap((occurrence) => occurrence.impacts.map((impact) => impact.time + LOGGED_EFFECT_DECAY_SECONDS)),
    ...timeline.occurrences.map((occurrence) => occurrence.castFinish ?? occurrence.castStart ?? 0),
    ...timeline.auras.map((aura) => aura.time),
    ...timeline.unmatched.map((event) => event.time));
}

function getLoggedForegroundCasts(timeline: CombatTimeline) {
  return timeline.occurrences.filter((occurrence) => {
    const mapped = ELEMENTAL_SHAMAN_ANIMATIONS.get(occurrence.spellId);
    return !occurrence.isBackground && occurrence.castFinish !== null
      && mapped !== undefined && occurrence.actionName.startsWith(mapped.actionName);
  });
}

function createLoggedCastAnimation(occurrence: CombatTimeline["occurrences"][number], cursor: number): ReplayAnimationResolution {
  const animationId = ELEMENTAL_SHAMAN_ANIMATIONS.get(occurrence.spellId)!.animationId;
  return { kind: "motion", eventLabel: occurrence.actionName.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    clipName: animationOptionLabel(animationId, 0), animationId,
    clipTime: cursor - (occurrence.castStart ?? occurrence.castFinish!),
    status: occurrence.castStart === null ? `Instant release at ${occurrence.castFinish!.toFixed(3)}s (SimC log); pose blend after release is presentation only.`
      : `Logged cast ${occurrence.castStart.toFixed(3)}–${occurrence.castFinish!.toFixed(3)}s; native pose holds at clip end until release.` };
}

export function resolveLoggedAnimation(timeline: CombatTimeline, cursor: number, selectedEvent?: ReplayEvent): ReplayAnimationResolution {
  const casts = getLoggedForegroundCasts(timeline);
  const current = casts.filter((occurrence) => (occurrence.castStart ?? occurrence.castFinish!) <= cursor
    && cursor <= occurrence.castFinish!).at(-1);
  if (current) return createLoggedCastAnimation(current, cursor);
  const instant = casts.filter((occurrence) => occurrence.castStart === null
    && occurrence.castFinish! < cursor && cursor < occurrence.castFinish! + REPLAY_POSE_BLEND_SECONDS).at(-1);
  if (instant) return createLoggedCastAnimation(instant, cursor);

  const idle = (kind: ReplayAnimationKind, status: string): ReplayAnimationResolution => ({
    kind, eventLabel: selectedEvent && kind !== "settled" ? getEventLabel(selectedEvent) : "No active foreground cast",
    clipName: STAND_CLIP_NAME, animationId: STAND_ANIMATION_ID, clipTime: 0, status,
  });
  if (selectedEvent && cursor < selectedEvent.time) return idle("before", "The cursor is before this recorded action — idle.");
  if (selectedEvent?.kind === "wait") return idle("wait", "Recorded wait — idle; no cast motion.");
  if (selectedEvent?.queueFailed) return idle("failed", "Recorded queue failure — idle; no successful cast motion.");
  if (selectedEvent?.kind === "action" && selectedEvent.id !== null
    && !ELEMENTAL_SHAMAN_ANIMATIONS.has(selectedEvent.id)) {
    return idle("unmapped", "No supported native cast animation mapping — idle.");
  }
  return idle("settled", "Idle between logged casts; background procs do not restart the caster pose.");
}

export function resolveLoggedMotionBlend(timeline: CombatTimeline, cursor: number, selectedEvent?: ReplayEvent): ReplayMotionBlend {
  const incoming = resolveLoggedAnimation(timeline, cursor, selectedEvent);
  const casts = getLoggedForegroundCasts(timeline);
  const active = casts.filter((occurrence) => (occurrence.castStart ?? occurrence.castFinish!) <= cursor
    && cursor <= occurrence.castFinish!).at(-1);
  const instant = active ?? casts.filter((occurrence) => occurrence.castStart === null
    && occurrence.castFinish! < cursor && cursor < occurrence.castFinish! + REPLAY_POSE_BLEND_SECONDS).at(-1);
  if (instant && incoming.kind === "motion") {
    const boundary = instant.castStart ?? instant.castFinish!;
    const elapsed = roundReplayTime(cursor - boundary);
    if (elapsed < REPLAY_POSE_BLEND_SECONDS) {
      const previous = casts.filter((occurrence) => occurrence.ordinal < instant.ordinal
        && occurrence.castFinish! <= boundary).at(-1);
      const outgoing = previous && boundary - previous.castFinish! < REPLAY_POSE_BLEND_SECONDS
        ? createLoggedCastAnimation(previous, previous.castFinish!)
        : { kind: "settled" as const, eventLabel: "No active foreground cast", clipName: STAND_CLIP_NAME,
          animationId: STAND_ANIMATION_ID, clipTime: 0, status: "Idle before the logged cast." };
      return { incoming, outgoing, incomingWeight: elapsed / REPLAY_POSE_BLEND_SECONDS };
    }
    return { incoming, outgoing: null, incomingWeight: 1 };
  }
  const finished = casts.filter((occurrence) => occurrence.castFinish! < cursor
    && cursor < occurrence.castFinish! + (occurrence.castStart === null ? 2 : 1) * REPLAY_POSE_BLEND_SECONDS).at(-1);
  if (!finished) return { incoming, outgoing: null, incomingWeight: 1 };
  const boundary = finished.castFinish! + (finished.castStart === null ? REPLAY_POSE_BLEND_SECONDS : 0);
  const elapsed = roundReplayTime(cursor - boundary);
  if (elapsed < 0 || elapsed >= REPLAY_POSE_BLEND_SECONDS) return { incoming, outgoing: null, incomingWeight: 1 };
  return { incoming, outgoing: createLoggedCastAnimation(finished, boundary),
    incomingWeight: elapsed / REPLAY_POSE_BLEND_SECONDS };
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

export function getReplayEffectSourceAnchor(
  spellId: number,
  fileDataId: number,
  sampleAttachment: (attachmentId: number) => Vector3 | null,
  boundsAnchor: Vector3,
) {
  const attachmentId = REPLAY_SOURCE_ATTACHMENTS[spellId]?.[fileDataId];
  if (attachmentId === undefined) return boundsAnchor;
  const sampled = sampleAttachment(attachmentId);
  if (!sampled) {
    throw new Error(`FileDataID ${fileDataId}: native attachment ${attachmentId} is unavailable on the caster model.`);
  }
  return sampled;
}

const M2_ATTACHMENT_NAMES = new Map<number, string>([
  [21, "SpellHandL"],
  [22, "SpellHandR"],
  [34, "Chest"],
]);

function describeReplayComponentAnchor(spellId: number, component: ReplayComponent) {
  const attachmentId = REPLAY_SOURCE_ATTACHMENTS[spellId]?.[component.fileDataId];
  const attachmentName = attachmentId !== undefined ? M2_ATTACHMENT_NAMES.get(attachmentId) : undefined;
  if (attachmentId !== undefined && component.anchor === "caster") {
    return `native caster attachment ${attachmentId} (${attachmentName}) origin sampled at the replay time${component.fileDataId === 1284864 ? "; kit offset (0, 0.15, 0) unapplied (attachment-local frame unavailable)" : ""}`;
  }
  if (attachmentId !== undefined) {
    return `native caster attachment ${attachmentId} (${attachmentName}) origin for launch · dummy attachment 34 (Chest) translation for arrival${spellId === 117014 ? "; impact positioner 712 unresolved" : ""}`;
  }
  if (component.anchor === "projectile") {
    return "60%-bounds anchored launch (source attachment 19 Base or -1 with positioner 513, Lightning Bolt branch unresolved) · dummy attachment 34 (Chest) translation for arrival";
  }
  if (component.anchor === "target") {
    return "native dummy attachment 34 (Chest) transform from the current pose; historical orientation not reconstructed";
  }
  return "60%-bounds anchored at caster (source attachment not established for this component)";
}

function threeToNative(value: Vector3): [number, number, number] {
  return threeToNativePoint(value.toArray());
}

export function isReplayClipMissing(
  resolution: ReplayAnimationResolution,
  animationNames: string[],
) {
  return resolution.kind === "motion" && !animationNames.includes(resolution.clipName);
}

function mountNativeActor(actor: NativeM2Actor) {
  // The native->three basis is applied exactly once, here: root = yaw · C.
  // After this, native attachment positions convert with localToWorld().
  const mount = new Group();
  mount.name = `${actor.label}-mount`;
  const orientation = new Matrix4().makeRotationY(ACTOR_BASE_YAW).multiply(NATIVE_BASIS);
  actor.root.quaternion.setFromRotationMatrix(orientation);
  mount.add(actor.root);
  return mount;
}

function sampleAttachmentWorldPosition(actor: NativeM2Actor, mount: Group, attachmentId: number) {
  const nativeMatrix = actor.sampleAttachment(attachmentId);
  if (!nativeMatrix) return null;
  actor.root.updateWorldMatrix(true, false);
  return actor.root.localToWorld(new Vector3(nativeMatrix[12], nativeMatrix[13], nativeMatrix[14]));
}

function sampleAttachmentEffectTransform(actor: NativeM2Actor, attachmentId: number) {
  const nativeMatrix = actor.sampleAttachment(attachmentId);
  if (!nativeMatrix) return null;
  actor.root.updateWorldMatrix(true, false);
  // Convert from three.js world coordinates back to native effect space. The
  // attachment matrix is already native column-major and includes bone motion.
  return NATIVE_BASIS.clone().invert().multiply(actor.root.matrixWorld)
    .multiply(new Matrix4().fromArray(nativeMatrix)).toArray();
}

function effectTranslationMatrix(worldPosition: Vector3) {
  const [x, y, z] = threeToNative(worldPosition);
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function placeModel(root: Group, x: number, rotationY: number) {
  root.rotation.y = rotationY;
  root.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(root);
  const center = bounds.getCenter(new Vector3());
  root.position.add(new Vector3(x - center.x, -bounds.min.y, -center.z));
}

export function arrangeCombatants(vulpera: Group, trainingDummy: Group, spacing = 8) {
  // Keep combatants facing each other; on a narrow stage close the gap rather
  // than shrinking the models to fit an eight-unit path into a phone viewport.
  placeModel(vulpera, -spacing / 2, 0);
  placeModel(trainingDummy, spacing / 2, Math.PI);
}

export function frameModels(camera: PerspectiveCamera, controls: OrbitControls, bounds: Box3): CameraView {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const target = center.clone().add(new Vector3(0, size.y * 0.02, 0));
  const direction = new Vector3(0.78, 0.22, 1).normalize();
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
  camera.far = Math.max(250, distance * 20);
  camera.position.copy(position);
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.minDistance = radius * 0.7;
  controls.maxDistance = Math.max(radius * 5, distance * 1.5);
  controls.update();

  return { position, target };
}

function describeNativeEffectLimitations(effect: NativeParticleEffect) {
  return [
    ...effect.unsupportedEmitters,
    ...(effect.model.emitters.some((emitter) => {
      const control = effect.model.particleTextureControls[emitter.index];
      const value = control ? control[0] | (control[1] << 8) : 0;
      return selectParticlePixelShader(emitter.flags, value) === 3;
    }) ? ["reference PS3 color equation; TXAC UV behavior not reconstructed"] : []),
    ...effect.unsupportedMeshBatches,
    ...(effect.model.fileDataId === 4329984 ? ["SpellMissileMotion 2967 (Elemental Blast) has authored transAngle/transMag/transFront/scale script but its runtime coordinate frame is unverified; not applied; Lava Burst motion ID 0 has no script"] : []),
    ...(effect.model.fileDataId === 794788 ? ["SpellMissileMotion 2969 script coordinate frame unverified; not applied; BaseMissileSpeed 0 inherits shared 4329984 flight duration"] : []),
    ...(effect.model.fileDataId === 613807 ? ["SpellMissileMotion 2968 script coordinate frame unverified; not applied; BaseMissileSpeed 0 inherits shared 4329984 flight duration"] : []),
    ...(effect.model.fileDataId === 6211617 ? ["Lightning Bolt branch has SpellMissileMotion 4856 parabola or motion ID 0; branch unresolved; no arc applied; BaseMissileSpeed 0"] : []),
    ...effect.ribbonLimitations,
    "caster attachment rotation sampled at the displayed pose (past pose unavailable); projectile source paths translate only",
    "128-entry deterministic twinkle table replaces unrecoverable client std::rand entries; variable emission-rate variation is held per occurrence",
    ...(effect.meshTriangleCount > 0
      ? [`authored animation sequence ${effect.animationSequenceIndex} (ID ${effect.model.sequenceIds[effect.animationSequenceIndex]}) sampled for the mesh and emitters; retail spell sequence scheduling not verified`]
      : []),
    ...(effect.model.dboc ? [`DBOC four authored values (${[...effect.model.dboc.floats, ...effect.model.dboc.integers].join(", ")}) parsed but unused; purpose undocumented`] : []),
    ...effect.model.emitters.flatMap((emitter) => (emitter.flags & 0x8000000) !== 0
      ? [`emitter ${emitter.index}: flag 0x8000000 not reconstructed (meaning unverified)`] : []),
    ...effect.model.materialTextureControls.flatMap(([first, second], index) =>
      first || second ? [`material ${index} TXAC (${first},${second}) parsed but unused by the mesh texture units`] : []),
    ...effect.model.emitters.flatMap((emitter) =>
      (emitter.flags & 0x1) !== 0 ? [`emitter ${emitter.index} flag 0x1 particle shading not reconstructed (unlit billboard)`] : []),
    ...effect.model.emitters.flatMap((emitter) =>
      (emitter.flags & 0x20) !== 0 ? [`emitter ${emitter.index} flag 0x20 particle bone-scale size inheritance not reconstructed`] : []),
    ...effect.model.emitters.flatMap((emitter) =>
      (emitter.flags & 0x20000000) !== 0
        ? [`emitter ${emitter.index}: Modx4 color flag not applied (no invented multiply rule)`]
        : []),
  ].join(" · ");
}

export function GenuineModelScene({ replay }: GenuineModelSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AnimationController | null>(null);
  const animationModeRef = useRef<AnimationMode>("replay");
  const replayAnimationRef = useRef<ReplayMotionBlend>(replay?.timeline
    ? resolveLoggedMotionBlend(replay.timeline, replay.cursor, replay.events[replay.selectedIndex])
    : { incoming: resolveLoggedAnimation({ occurrences: [], auras: [], unmatched: [] }, 0), outgoing: null, incomingWeight: 1 });
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [loadedModelCount, setLoadedModelCount] = useState(0);
  const [actorStatusLines, setActorStatusLines] = useState<string[]>([]);
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

  const replayMotionBlend = replay?.timeline
    ? resolveLoggedMotionBlend(replay.timeline, replay.cursor, replay.events[replay.selectedIndex])
    : { incoming: { kind: "unavailable" as const, eventLabel: "No combat log", clipName: STAND_CLIP_NAME,
      animationId: STAND_ANIMATION_ID, clipTime: 0, status: "No combat log timing is available for this report; native cast replay is idle." },
      outgoing: null, incomingWeight: 1 };
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
  const replayAssetIds = getLoggedAssetIds(replay?.timeline ?? undefined);

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
    let vulperaActor: NativeM2Actor | null = null;
    let dummyActor: NativeM2Actor | null = null;
    let vulperaMount: Group | null = null;
    let dummyMount: Group | null = null;
    let nativeEffect: NativeParticleEffect | null = null;
    let nativeEffectGeneration = 0;
    let replayEffectGeneration = 0;
    let replayEffects: Array<{ asset: NativeEffectAsset; effect: NativeParticleEffect }> = [];
    let replayAnchors: ReturnType<typeof getReplayEffectAnchors> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let modelBounds: Box3 | null = null;
    let defaultView: CameraView | null = null;
    const scene = new Scene();
    canvas.dataset.replayNativeComponents = "0";
    canvas.dataset.replayNativeParticles = "0";
    canvas.dataset.replayNativeLatestSourceX = "";
    canvas.dataset.replayNativeMeshTriangles = "0";
    canvas.dataset.actorPendingTextureTypes = "";
    const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.01, 100);
    const controls = new OrbitControls(camera, canvas);
    const clock = new Clock();
    // Native-sequence pose state: replay poses are pure functions of the replay
    // cursor (deterministic seeks); manual mode advances its own clock.
    let manualSequence: M2Sequence | null = null;
    let manualResolution: SequenceResolution | null = null;
    let manualTimeMs = 0;
    let manualIsPlaying = false;

    // M2 textures and procedural stage colors are display-domain values. All
    // custom shaders write them directly: no ACES, exposure or output encode.
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.listenToKeyEvents(canvas);

    const stage = PREVIEW_STAGE;
    const sky = new Mesh(new SphereGeometry(100, 48, 24), new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        top: { value: new Vector3().fromArray(stage.sky.top) },
        middle: { value: new Vector3().fromArray(stage.sky.middle) },
        band1: { value: new Vector3().fromArray(stage.sky.band1) },
        band2: { value: new Vector3().fromArray(stage.sky.band2) },
        haze: { value: new Vector3().fromArray(stage.sky.fog) },
      },
      vertexShader: `varying float elevation;
        void main() { elevation = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top, middle, band1, band2, haze;
        varying float elevation;
        void main() {
          vec3 color = mix(haze, band2, smoothstep(-0.06, 0.005, elevation));
          color = mix(color, band1, smoothstep(0.005, 0.045, elevation));
          color = mix(color, middle, smoothstep(0.045, 0.13, elevation));
          color = mix(color, top, smoothstep(0.13, 0.35, elevation));
          gl_FragColor = vec4(color, 1.0);
        }`,
    }));
    sky.renderOrder = -100;
    sky.frustumCulled = false;
    scene.add(sky);

    const floor = new Mesh(new PlaneGeometry(200, 200), new ShaderMaterial({
      uniforms: {
        ambient: { value: new Vector3().fromArray(stage.lighting.ambientSky) },
        direct: { value: new Vector3().fromArray(stage.lighting.sunColor) },
        fogColor: { value: new Vector3().fromArray(stage.fog.color) },
        fogRange: { value: new Vector2(stage.fog.startPreview, stage.fog.endPreview) },
      },
      vertexShader: `varying vec3 worldPosition;
        void main() { vec4 world = modelMatrix * vec4(position, 1.0);
          worldPosition = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world; }`,
      fragmentShader: `uniform vec3 ambient, direct, fogColor; uniform vec2 fogRange;
        varying vec3 worldPosition;
        void main() {
          float soil = 0.98 + 0.02 * sin(worldPosition.x * 1.8) * sin(worldPosition.z * 2.3)
            + 0.025 * sin(worldPosition.x * 0.53 + worldPosition.z * 0.71);
          vec3 color = vec3(0.53, 0.48, 0.37) * (ambient + direct) * soil;
          float fog = smoothstep(fogRange.x, fogRange.y, distance(worldPosition, cameraPosition));
          gl_FragColor = vec4(mix(color, fogColor, fog), 1.0);
        }`,
    }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const contactShadows = [-1, 1].map(() => {
      const mesh = new Mesh(new PlaneGeometry(3, 2.5), new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `varying vec2 shadowUv;
          void main() { shadowUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec2 shadowUv;
          void main() { float radius = dot(shadowUv, shadowUv);
            gl_FragColor = vec4(0.08, 0.075, 0.06, 0.32 * pow(1.0 - smoothstep(0.0, 1.0, radius), 2.0)); }`,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.012;
      mesh.renderOrder = 1;
      scene.add(mesh);
      return mesh;
    });

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (vulperaMount && dummyMount) {
        arrangeCombatants(vulperaMount, dummyMount, width < 620 ? 5.6 : 8);
        contactShadows[0].position.x = vulperaMount.position.x;
        contactShadows[1].position.x = dummyMount.position.x;
        replayAnchors = getReplayEffectAnchors(vulperaMount, dummyMount);
        modelBounds = new Box3().setFromObject(vulperaMount).union(new Box3().setFromObject(dummyMount));
      }
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
      const requiredIds = getLoggedAssetIds(replayState?.timeline ?? undefined);
      if (animationModeRef.current !== "replay"
        || !replayState
        || !replayAnchors
        || replayEffects.length !== requiredIds.size
        || replayEffects.some(({ asset }) => !requiredIds.has(asset.fileDataId))) {
        clearReplayEffects();
        return true;
      }

      const anchors = replayAnchors;
      if (!vulperaActor || !vulperaMount || !dummyActor || !dummyMount) {
        throw new Error("Replay caster model is unavailable.");
      }
      // Target endpoint from the dummy's authored chest attachment; the bounds
      // anchor remains the fallback.
      const targetAnchor = sampleAttachmentWorldPosition(dummyActor, dummyMount, 34) ?? anchors.target;
      const targetTransform = sampleAttachmentEffectTransform(dummyActor, 34)
        ?? effectTranslationMatrix(targetAnchor);
      const sampleCasterAttachment = (attachmentId: number) =>
        sampleAttachmentWorldPosition(vulperaActor!, vulperaMount!, attachmentId);
      const occurrences = replayState.timeline
        ? resolveLoggedEffectOccurrences(replayState.timeline, replayState.cursor) : [];
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
            const source = getReplayEffectSourceAnchor(occurrence.spellId, component.fileDataId, sampleCasterAttachment, anchors.caster);
            const attachmentId = REPLAY_SOURCE_ATTACHMENTS[occurrence.spellId]?.[component.fileDataId];
            // The pose sampler currently supplies the attachment's rotation at
            // the displayed frame; past caster rotations are not reconstructed.
            const casterTransform = attachmentId === undefined ? null
              : sampleAttachmentEffectTransform(vulperaActor!, attachmentId);
            return {
              timeSeconds: occurrence.componentTimeSeconds,
              emissionEndSeconds: occurrence.emissionDuration ?? (component.anchor === "projectile"
                ? occurrence.travelDuration ?? 0 : OTHER_REPLAY_EMISSION_SECONDS),
              modelScale: [4329984, 794788, 613807].includes(asset.fileDataId)
                ? asset.effectNameScale : NATIVE_REPLAY_BASE_SCALE * asset.effectNameScale,
              occurrenceSeed: occurrence.eventKey,
              sourceTransformAtTime: (timeSeconds) => component.anchor === "projectile"
                ? effectTranslationMatrix(source.clone().lerp(targetAnchor,
                  Math.max(0, Math.min(1, timeSeconds / (occurrence.travelDuration ?? 1)))))
                : component.anchor === "caster" ? casterTransform ?? effectTranslationMatrix(source) : targetTransform,
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
        ? getReplayEffectSourceAnchor(latestProjectile.spellId, 4329984, sampleCasterAttachment, anchors.caster)
            .lerp(targetAnchor, Math.max(0, Math.min(1, latestProjectile.componentTimeSeconds / (latestProjectile.travelDuration ?? 1)))).x.toFixed(6)
        : "";
      return true;
    };

    const applySequencePose = (resolution: SequenceResolution, timeMs: number) => {
      if (!vulperaActor) return;
      vulperaActor.setPose(sampleBoneMatrices(vulperaActor.model, resolution, timeMs));
      vulperaActor.updateAnimatedTracks(resolution, timeMs);
    };

    const renderFrame = () => {
      if (isStopped) return;
      animationFrame = requestAnimationFrame(renderFrame);
      const delta = Math.min(clock.getDelta(), 0.1);
      if (animationModeRef.current === "manual" && manualResolution && manualSequence) {
        if (manualIsPlaying) {
          manualTimeMs = (manualTimeMs + delta * 1000) % Math.max(manualSequence.durationMs, 1);
          applySequencePose(manualResolution, manualTimeMs);
        }
      }
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
      sky.position.copy(camera.position);
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
      nativeEffectGeneration += 1;
      replayEffectGeneration += 1;
      nativeEffect?.dispose();
      nativeEffect = null;
      for (const { effect } of replayEffects) effect.dispose();
      replayEffects = [];
      clearReplayEffectEvidence();
      vulperaActor?.dispose();
      dummyActor?.dispose();
      vulperaActor = null;
      dummyActor = null;
      floor.geometry.dispose();
      floor.material.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      for (const shadow of contactShadows) {
        shadow.geometry.dispose();
        shadow.material.dispose();
      }
      renderer.dispose();
      controllerRef.current = null;
    };

    const prepare = async () => {
      let vulperaBundle: Awaited<ReturnType<typeof loadNativeActorBundle>>;
      let dummyBundle: Awaited<ReturnType<typeof loadNativeActorBundle>>;
      try {
        [vulperaBundle, dummyBundle] = await Promise.all([
          loadNativeActorBundle(manifest, ACTOR_ASSETS.vulpera.manifestName),
          loadNativeActorBundle(manifest, ACTOR_ASSETS.trainingDummy.manifestName),
        ]);
      } catch (caught) {
        if (!isUnmounted) {
          stop();
          setStatus("error");
          setError(caught instanceof Error ? caught.message : "The genuine native models could not be loaded.");
        }
        return;
      }
      if (isStopped) return;
      setLoadedModelCount(2);

      // Prepared customization appearance: composited body atlas, direct
      // eye-colour texture and the geoset visibility of the tracked choices.
      const appearance = await loadAppearanceTextures(appearanceJson, manifest);
      if (isStopped) return;

      vulperaActor = createNativeM2Actor({
        model: vulperaBundle.model,
        skin: vulperaBundle.skin,
        label: ACTOR_ASSETS.vulpera.label,
        textures: vulperaBundle.textures,
        replaceableTextures: appearance.textures,
        geosetVisibility: compileGeosetVisibility(
          vulperaBundle.skin.sections.map((section) => section.meshPartId),
          appearanceJson,
        ),
        lightPreset: stage.lighting,
        fog: stage.fog,
      });
      dummyActor = createNativeM2Actor({
        model: dummyBundle.model,
        skin: dummyBundle.skin,
        label: ACTOR_ASSETS.trainingDummy.label,
        textures: dummyBundle.textures,
        geosetVisibility: new Map(dummyBundle.skin.sections.map((section) => [
          section.meshPartId,
          isCreatureGeosetVisible(section.meshPartId,
            stage.creature.geosetDataId > 0 ? stage.creature.geosets : null),
        ])),
        lightPreset: stage.lighting,
        fog: stage.fog,
      });
      vulperaMount = mountNativeActor(vulperaActor);
      dummyMount = mountNativeActor(dummyActor);
      arrangeCombatants(vulperaMount, dummyMount, canvas.clientWidth < 620 ? 5.6 : 8);
      contactShadows[0].position.x = vulperaMount.position.x;
      contactShadows[1].position.x = dummyMount.position.x;
      replayAnchors = getReplayEffectAnchors(vulperaMount, dummyMount);
      scene.add(vulperaMount, dummyMount);
      canvas.dataset.actorPendingTextureTypes = vulperaActor.pendingTextureTypes.join(",");
      setActorStatusLines([
        ...appearance.diagnostics,
        ...vulperaActor.statusLines,
        ...dummyActor.statusLines,
      ]);

      modelBounds = new Box3()
        .setFromObject(vulperaMount)
        .union(new Box3().setFromObject(dummyMount));
      defaultView = frameModels(camera, controls, modelBounds);

      // Manual preview lists the in-file native sequences by animation id.
      const sequences = vulperaActor.model.sequences;
      const animationClipNames = sequences.map((sequence) =>
        animationOptionLabel(sequence.animationId, sequence.variationIndex));
      const defaultClipIndex = Math.max(0, animationClipNames.indexOf(STAND_CLIP_NAME));

      const standResolution = resolveSequence(vulperaActor.model, STAND_ANIMATION_ID, { variationIndex: 0 });
      const dummyStand = resolveSequence(dummyActor.model, STAND_ANIMATION_ID, { variationIndex: 0 });
      if (dummyStand) {
        dummyActor.setPose(sampleBoneMatrices(dummyActor.model, dummyStand, 0));
        dummyActor.updateAnimatedTracks(dummyStand, 0);
      }

      const samplePoseFor = (resolution: ReplayAnimationResolution) => {
        const isMotion = resolution.kind === "motion";
        const animationId = isMotion ? resolution.animationId : STAND_ANIMATION_ID;
        const sequenceResolution = vulperaActor
          ? resolveSequence(vulperaActor.model, animationId, { variationIndex: 0 })
          : null;
        if (!sequenceResolution) return null;
        const timeMs = isMotion
          ? Math.min(resolution.clipTime * 1000, Math.max(0, sequenceResolution.sequence.durationMs - 0.1))
          : 0;
        return {
          resolution: sequenceResolution,
          timeMs,
          matrices: sampleBoneMatrices(vulperaActor!.model, sequenceResolution, timeMs),
        };
      };
      const applyReplayAnimation = (blend: ReplayMotionBlend) => {
        if (!vulperaActor || !standResolution) return;
        const incoming = samplePoseFor(blend.incoming) ?? {
          resolution: standResolution,
          timeMs: 0,
          matrices: sampleBoneMatrices(vulperaActor.model, standResolution, 0),
        };
        let matrices = incoming.matrices;
        if (blend.outgoing) {
          const outgoing = samplePoseFor(blend.outgoing);
          if (outgoing) {
            matrices = blendBoneMatrices(outgoing.matrices, incoming.matrices, blend.incomingWeight);
          }
        }
        vulperaActor.setPose(matrices);
        vulperaActor.updateAnimatedTracks(incoming.resolution, incoming.timeMs);
      };
      const playManualClip = (index: number, shouldPlay: boolean) => {
        if (!vulperaActor) return;
        const sequence = sequences[index];
        if (!sequence) return;
        manualSequence = sequence;
        manualResolution = resolveSequence(vulperaActor.model, sequence.animationId, {
          variationIndex: sequence.variationIndex,
        });
        if (!manualResolution) return;
        manualIsPlaying = shouldPlay;
        applySequencePose(manualResolution, manualTimeMs);
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
          manualIsPlaying = shouldPlay;
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
          nativeEffect.setFog(stage.fog);
          nativeEffect.group.visible = animationModeRef.current === "native";
          scene.add(nativeEffect.group);
          nativeEffect.setTime(nativePreviewTimeRef.current, camera);
          return nativeEffect;
        },
        loadReplayEffects: async () => {
          const generation = ++replayEffectGeneration;
          for (const { effect } of replayEffects) effect.dispose();
          replayEffects = [];
          const requiredIds = getLoggedAssetIds(replayStateRef.current?.timeline ?? undefined);
          const assets = NATIVE_EFFECT_ASSETS.filter((asset) => requiredIds.has(asset.fileDataId));
          const missing = [...requiredIds].filter((fileDataId) => !assets.some((asset) => asset.fileDataId === fileDataId));
          if (missing.length > 0) throw new Error(`Missing pinned replay FileDataID ${missing.join(", ")}. No substitute effect was rendered.`);
          const results = await Promise.allSettled(assets.map(async (asset) => {
            const instanceLimit = REPLAY_COMPONENT_INSTANCE_LIMITS.get(asset.fileDataId);
            if (!instanceLimit) throw new Error(`FileDataID ${asset.fileDataId}: no measured replay instance bound. No substitute effect was rendered.`);
            const effect = await loadNativeParticleEffect(asset, instanceLimit);
            effect.setFog(stage.fog);
            return { asset, effect };
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
                ? `Required ${missingReplayClip === replayAnimation ? "" : "outgoing "}native sequence missing (${missingReplayClip.clipName}) — ${missingReplayClip === replayAnimation ? "idle" : "transition omitted"}.`
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
              {replayAssetIds.has(4329984) && <span> · Shared Lava Burst / Elemental Blast missile: 6 of 10 emitters + 3 of 3 original ribbons (partially reconstructed) · FileDataID 4329984</span>}
              {replayAssetIds.has(794788) && <span> · Elemental Blast: 12 of 12 authored emitters ready in its two additional bodies · 9 original BLP textures · FileDataID 4329984 + 794788 + 613807</span>}
              <span> · Trace FileDataIDs: {[...replayAssetIds].join(", ") || "none"}</span>
              <small> · Partial original components only; combat-log timestamps drive cast, travel and impact (native VFX fidelity is not verified).</small>
            </p>
          )}
          {selectedReplaySpell?.components.some((component) => component.anchor === "projectile") && replay?.timeline && (
            <p data-testid="replay-flight-status">
              {selectedReplayEvent?.spellName ?? selectedReplayEvent?.name}: {replay.timeline.occurrences.filter((occurrence) =>
                occurrence.actionName === selectedReplayEvent?.name && occurrence.spellId === selectedReplayEvent?.id &&
                !occurrence.actor.includes("_ancestor") && (Math.abs((occurrence.castStart ?? -1) - selectedReplayEvent!.time) < 0.002 || Math.abs((occurrence.castFinish ?? -1) - selectedReplayEvent!.time) < 0.002))
                .map((occurrence) => `cast ${occurrence.castStart === null ? "instant" : `${occurrence.castStart.toFixed(3)}s`}, finish ${occurrence.castFinish?.toFixed(3)}s, flight ${occurrence.travelDuration?.toFixed(3) ?? "not logged"}s, impact ${occurrence.impacts[0]?.time.toFixed(3) ?? "not logged"}s`).join("; ") || "no matching logged occurrence"}. Missile path interpolates between the presented actors; logged timestamps, not a simulated trajectory.
            </p>
          )}
          {selectedReplaySpell && (
            <p data-testid="replay-anchor-status">
              Across the mapped spell list, 6 of 19 mapped components use native caster attachment origins and 13 remain bounds-anchored. Placement: {selectedReplaySpell.components.filter((component) =>
                Boolean(REPLAY_SOURCE_ATTACHMENTS[selectedReplayEvent!.id!]?.[component.fileDataId])).length} of {selectedReplaySpell.components.length} components use native caster attachment origins; remaining components use 60%-bounds anchors.
              {selectedReplaySpell.components.map((component) =>
                ` FileDataID ${component.fileDataId}: ${describeReplayComponentAnchor(selectedReplayEvent!.id!, component)}.`).join("")}
            </p>
          )}
          {selectedReplaySpell && (
            <p data-testid="replay-spell-components">
              {selectedReplayEvent ? getEventLabel(selectedReplayEvent) : replayAnimation.eventLabel} ({selectedReplayEvent?.id}): {selectedReplaySpell.components.length > 0
                ? `mapped original FileDataIDs ${selectedReplaySpell.components.map((component) => component.fileDataId).join(", ")} · partial components when loaded, not complete spell visuals`
                : "no verified component; no substitute rendered"}.
            </p>
          )}
          {selectedReplaySpell && (selectedReplayEvent?.id === 51505 || selectedReplayEvent?.id === 117014) && (
            <p data-testid="replay-missile-blocker">
              FileDataID 3980281: 1 of {selectedReplayEvent.id === 51505 ? 2 : 4} original missile bodies omitted; no substitute rendered. Its acquired LOD0 SKIN has 2 of 2 mesh batches (1,576 vertex references, 4,722 indices, 1,574 triangles), 13 emitters (one refractive), and 3 ribbons. Both the full render and emitters-and-ribbons-only render were inspected and rejected as incoherent. Source attachment -1 differs from 4329984 attachments 34/21. The omitted body remains unrendered; the rendered 4329984 launches from its native caster attachment where mapped, with its dummy endpoint at native dummy attachment 34 (translation only). That difference is recorded, not established as the cause.
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
                }).join(" · ")} · when authored, Modx4 color flags and mesh material TXAC have renderer limitations (expand for per-emitter details).
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
            <span>Native character animation</span>
            <select
              aria-label="Native character animation"
              value={selectedAnimationIndex}
              onChange={(event) => onAnimationChange(Number(event.target.value))}
              disabled={status !== "ready" || animationNames.length === 0}
            >
              {animationNames.length === 0 ? (
                <option>Native sequences load with the Vulpera model</option>
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
          <p role="status">Both genuine models ready · {animationNames.length} native sequences</p>
        )}
      </div>

      {status === "ready" && actorStatusLines.length > 0 && (
        <ul className="native-actor-status" data-testid="native-actor-status">
          {actorStatusLines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}

      {animationMode === "replay" && !replay?.timeline && <p>No combat-log timing in this report; native replay remains idle rather than estimating casts or hits.</p>}
      <p className="model-disclaimer">
        {animationMode === "replay"
          ? "Cast, missile release, flight, impact and mapped aura lifetimes use timestamps from the bundled SimC combat log. Native M2 pose and original partial VFX are presentation, not complete spell visuals; projectile positions interpolate between the presented actors, not recorded coordinates. Ancestor casts are listed in the logged event table but their missiles are intentionally omitted: no native ancestor model or unambiguous pet identity is available. No inferred GCD, exact historical attachment transforms, hit reaction, sound or complete VFX parity is claimed."
          : animationMode === "manual"
            ? "Manual preview is separate from replay time. It does not show spell impact timing, damage, VFX, hit reactions, or optimal play."
            : `Native preview time is an isolated, stationary component-viewer clock, not missile travel, a cast, an impact, or a simulation event. It renders only the selected original M2 component, its original BLP textures, and its pinned SKIN where applicable; it is not ${selectedNativeFileDataId === 794788 || selectedNativeFileDataId === 613807 ? "the complete Elemental Blast composite" : "a complete spell"}.`}
      </p>
    </section>
  );
}
