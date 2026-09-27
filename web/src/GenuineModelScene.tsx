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
  getNativeEffectTailBound,
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
  attachmentMatrix,
  blendBoneMatrices,
  resolveSequence,
  sampleBoneMatrices,
  type SequenceResolution,
} from "./m2/sampler";
import { createNativeM2Actor, type NativeM2Actor } from "./m2/renderer";
import type { M2Model, M2Sequence } from "./m2/model";
import { composeAttachmentTransform, getPreviewVisual, resolveVisualAnimation, sampleKitStart, scheduleVisualPhases } from "./spellVisuals";

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
const DUMMY_TARGET_NAME = "Fluffy_Pillow";
const DUMMY_WOUND_ANIMATION_ID = 9;
const CAMERA_FOV = 32; // fixed vertical FOV for both default framing and reset
const REPLAY_POSE_BLEND_SECONDS = 0.15;
const PREVIEW_TRANSIENT_EMISSION_SECONDS = 0.2;
const PREVIEW_UNKNOWN_TAIL_SECONDS = 1.5;
type ReplayEffectAnchor = "caster" | "target" | "projectile";
type ReplayComponent = { fileDataId: number; anchor: ReplayEffectAnchor; placement?: PreparedPlacement };
type PreparedPlacement = { attachmentId: number; positionerId: number; offset: [number, number, number];
  angles: [number, number, number]; scale: number; startDelay: number; sourceRowId: number; eventId?: number; targetType?: number };
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

// Baseline simultaneous component counts measured from the pinned paired combat log.
// Loaded replay capacity also includes the selected timeline's source-bound tails.
export const REPLAY_COMPONENT_INSTANCE_LIMITS = new Map<number, number>([
  [794788, 4], [613807, 4], [4006618, 8], [1598036, 1],
  [1355634, 1], [1284864, 1], [1109885, 2], [4006621, 3],
  [3980244, 8], [4329984, 11], [6211617, 7], [6211618, 7], [1571475, 7], [4392095, 1], [4050773, 1],
]);
// SpellVisualMissile rows 28854 and 28867–28869 and SpellVisualKitModelAttach rows 321812/321824, build 12.1.0.69933.
// Mapped to native M2 attachment ids on the caster model (21 SpellHandL, 22 SpellHandR, 34 Chest).
export const REPLAY_SOURCE_ATTACHMENTS: Record<number, Record<number, number>> = {
  191634: { 1355634: 22, 1284864: 22 },
  188196: { 6211617: 19 },
  51505: { 4329984: 34 },
  117014: { 4329984: 21, 794788: 22, 613807: 34 },
};
interface PreparedVisual {
  MissileDestinationAttachment: number;
  events: Array<{ ID: number; SpellVisualID: number; StartEvent: number; EndEvent: number; TargetType: number; SpellVisualKitID: number;
    StartMinOffsetMs: number; StartMaxOffsetMs: number; kit: { DelayMin: number; DelayMax: number; effects: Array<{
      modelAttach?: { ID: number; AttachmentID: number; PositionerID: number; Offset_0: number; Offset_1: number; Offset_2: number;
        Yaw: number; Pitch: number; Roll: number; Scale: number; StartDelay: number;
        effectName: { ModelFileDataID: number } };
      visualAnim?: { InitialAnimID: number; LoopAnimID: number; AnimKitID: number;
        animKit: { segments: Array<{ AnimID: number; OrderIndex: number }> } | null };
    }> } }>;
  missiles: Array<{ ID: number; Attachment: number; DestinationAttachment: number; CastPositionerID: number;
    CastOffset_0: number; CastOffset_1: number; CastOffset_2: number;
    effectName: { ModelFileDataID: number } }>;
}

function preparedVisual(spellId: number): PreparedVisual | null {
  return getPreviewVisual(spellId) as unknown as PreparedVisual | null;
}

export function getPreparedComponentPlacements(spellId: number, component: ReplayComponent): PreparedPlacement[] {
  const visual = preparedVisual(spellId);
  if (!visual) return [];
  if (component.anchor === "projectile") return visual.missiles
    .filter((missile) => missile.effectName.ModelFileDataID === component.fileDataId)
    .map((missile) => ({ attachmentId: missile.Attachment, positionerId: missile.CastPositionerID,
      offset: [missile.CastOffset_0, missile.CastOffset_1, missile.CastOffset_2], angles: [0, 0, 0],
      scale: 1, startDelay: 0, sourceRowId: missile.ID } satisfies PreparedPlacement));
  return visual.events.flatMap((event) => event.kit.effects.flatMap((effect) => {
    const attach = effect.modelAttach;
    if (!attach || attach.effectName.ModelFileDataID !== component.fileDataId) return [];
    return [{ attachmentId: attach.AttachmentID, positionerId: attach.PositionerID,
      offset: [attach.Offset_0, attach.Offset_1, attach.Offset_2],
      angles: [attach.Yaw, attach.Pitch, attach.Roll], scale: attach.Scale,
      startDelay: attach.StartDelay, sourceRowId: attach.ID, eventId: event.ID, targetType: event.TargetType } satisfies PreparedPlacement];
  }));
}

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
  startTime: number;
  emissionStopTime: number;
  renderEndTime: number;
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

const LOGGED_EFFECT_DECAY_SECONDS = PREVIEW_UNKNOWN_TAIL_SECONDS;

function getRenderablePlacements(placements: PreparedPlacement[]): Array<PreparedPlacement | undefined> {
  const resolved = placements.filter((placement) => placement.attachmentId >= 0);
  // Distinct unresolved positioners cannot be separated by the bounds fallback.
  return resolved.length ? resolved : placements.length ? placements.slice(0, 1) : [undefined];
}

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

type ScheduledReplayEffect = Omit<ReplayEffectOccurrence, "elapsedSeconds" | "componentTimeSeconds">;

function getLoggedEffectIntervals(timeline: CombatTimeline,
  tailBounds: ReadonlyMap<number, number>): ScheduledReplayEffect[] {
  const effects: ScheduledReplayEffect[] = [];
  const schedules = new Map<number, ReturnType<typeof scheduleVisualPhases>["kits"]>();
  const getKits = (spellId: number) => {
    if (!schedules.has(spellId)) {
      const visual = preparedVisual(spellId);
      schedules.set(spellId, visual ? scheduleVisualPhases(timeline, visual.events, spellId).kits : []);
    }
    return schedules.get(spellId)!;
  };
  const add = (spellId: number, component: ReplayComponent, placement: PreparedPlacement | undefined,
    eventKey: string, eventTime: number, startTime: number, stopTime: number | undefined,
    sourceActor: string, travelDuration?: number) => {
    const emissionStopTime = stopTime ?? roundReplayTime(startTime + PREVIEW_TRANSIENT_EMISSION_SECONDS);
    if (emissionStopTime <= startTime) return;
    const tail = tailBounds.get(component.fileDataId) ?? PREVIEW_UNKNOWN_TAIL_SECONDS;
    const renderEndTime = emissionStopTime + tail;
    effects.push({ eventKey, eventTime, startTime, emissionStopTime, renderEndTime,
      emissionDuration: roundReplayTime(emissionStopTime - startTime),
      spellId, components: [{ ...component, placement }], travelDuration, sourceActor });
  };
  for (const occurrence of timeline.occurrences) {
    // No native pet actor is loaded. Do not move pet missiles to the player.
    if (/_ancestor|_elemental|_wolf|_guardian/.test(occurrence.actor)) continue;
    const spell = getLoggedSpell(occurrence.actionName);
    if (!spell) continue;
    for (const component of spell.components) {
      if (component.anchor === "projectile") {
        const start = occurrence.travelStart;
        const stop = occurrence.impacts[0]?.time ?? (start !== null && occurrence.travelDuration !== null
          ? roundReplayTime(start + occurrence.travelDuration) : null);
        if (start === null || stop === null || stop <= start) continue;
        for (const placement of getRenderablePlacements(getPreparedComponentPlacements(occurrence.spellId, component))) {
          add(occurrence.spellId, component, placement, occurrence.key, occurrence.castFinish ?? start,
            start, stop, occurrence.actor, occurrence.travelDuration ?? undefined);
        }
        continue;
      }
      for (const placement of getRenderablePlacements(getPreparedComponentPlacements(occurrence.spellId, component))) {
        if (!placement?.eventId) continue;
        for (const kit of getKits(occurrence.spellId)) {
          if (kit.occurrenceKey !== occurrence.key || kit.sourceRowId !== placement.eventId) continue;
          const start = roundReplayTime(kit.time + placement.startDelay);
          const anchor = placement.targetType === 4 ? "target" : "caster";
          const key = kit.impactOrdinal === undefined ? occurrence.key
            : `${occurrence.key}/impact-${kit.impactOrdinal}/${kit.impactTarget}`;
          add(occurrence.spellId, { ...component, anchor }, placement, key,
            occurrence.castFinish ?? start, start, kit.endTime, occurrence.actor);
        }
      }
    }
  }
  for (const aura of timeline.auras) {
    if (aura.transition !== "gain" && aura.transition !== "refresh") continue;
    const spell = getLoggedSpell(aura.name);
    if (!spell) continue;
    for (const component of spell.components) {
      if (component.anchor === "projectile") continue;
      for (const placement of getRenderablePlacements(getPreparedComponentPlacements(aura.spellId, component))) {
        if (!placement?.eventId) continue;
        const kit = getKits(aura.spellId).find((candidate) => candidate.occurrenceKey === `aura-${aura.ordinal}`
          && candidate.sourceRowId === placement.eventId);
        if (!kit) continue;
        const start = roundReplayTime(kit.time + placement.startDelay);
        add(aura.spellId, { ...component, anchor: placement.targetType === 4 ? "target" : "caster" },
          placement, `aura-${aura.ordinal}`, aura.time, start,
          kit.endTime ?? Number.POSITIVE_INFINITY, aura.actor);
      }
    }
  }
  return effects;
}

export function resolveLoggedEffectOccurrences(timeline: CombatTimeline, cursor: number,
  tailBounds: ReadonlyMap<number, number> = new Map()): ReplayEffectOccurrence[] {
  return getLoggedEffectIntervals(timeline, tailBounds)
    .filter((effect) => effect.startTime <= cursor && cursor < effect.renderEndTime)
    .map((effect) => {
      const elapsedSeconds = roundReplayTime(cursor - effect.startTime);
      return { ...effect, elapsedSeconds, componentTimeSeconds: elapsedSeconds };
    });
}

export function getReplayComponentPeak(timeline: CombatTimeline, fileDataId: number, tailBound: number) {
  const boundaries = getLoggedEffectIntervals(timeline, new Map([[fileDataId, tailBound]]))
    .filter((effect) => effect.components.some((component) => component.fileDataId === fileDataId))
    .flatMap((effect) => [{ time: effect.startTime, change: 1 }, { time: effect.renderEndTime, change: -1 }])
    .sort((left, right) => left.time - right.time || left.change - right.change);
  let active = 0;
  let peak = 0;
  for (const boundary of boundaries) {
    active += boundary.change;
    peak = Math.max(peak, active);
  }
  return peak;
}

const playbackEndTimes = new WeakMap<CombatTimeline, number>();

export function getLoggedPlaybackEndTime(timeline: CombatTimeline) {
  const cached = playbackEndTimes.get(timeline);
  if (cached !== undefined) return cached;
  let endTime = Math.max(0, ...timeline.occurrences.flatMap((occurrence) => occurrence.impacts.map((impact) => impact.time + LOGGED_EFFECT_DECAY_SECONDS)),
    ...timeline.occurrences.map((occurrence) => occurrence.castFinish ?? occurrence.castStart ?? 0),
    ...timeline.auras.map((aura) => aura.time),
    ...timeline.unmatched.map((event) => event.time));
  for (const effect of getLoggedEffectIntervals(timeline, new Map())) {
    if (Number.isFinite(effect.renderEndTime)) endTime = Math.max(endTime, effect.renderEndTime);
  }
  playbackEndTimes.set(timeline, endTime);
  return endTime;
}

function getLoggedForegroundCasts(timeline: CombatTimeline) {
  return timeline.occurrences.filter((occurrence) => {
    const mapped = ELEMENTAL_SHAMAN_ANIMATIONS.get(occurrence.spellId);
    return !occurrence.isBackground && occurrence.castFinish !== null
      && mapped !== undefined && occurrence.actionName.startsWith(mapped.actionName);
  });
}

function createLoggedCastAnimation(occurrence: CombatTimeline["occurrences"][number], cursor: number,
  phase: "prepare" | "release", clipDurations?: Map<number, number>): ReplayAnimationResolution {
  const fallback = ELEMENTAL_SHAMAN_ANIMATIONS.get(occurrence.spellId)!.animationId;
  const visual = preparedVisual(occurrence.spellId);
  const event = visual?.events.find((row) => row.StartEvent === (phase === "prepare" ? 1 : 3));
  const authored = event?.kit.effects.find((effect) => effect.visualAnim)?.visualAnim ?? null;
  const initial = resolveVisualAnimation(authored, phase, fallback);
  const elapsed = cursor - (phase === "prepare" ? occurrence.castStart! : occurrence.castFinish!);
  const duration = clipDurations?.get(initial.animationId);
  const isLoop = phase === "prepare" && duration !== undefined && duration > 0 && elapsed * 1000 >= duration;
  const selection = isLoop ? resolveVisualAnimation(authored, "loop", fallback) : initial;
  const loopDuration = isLoop ? clipDurations?.get(selection.animationId) : undefined;
  const clipTime = isLoop && selection.provenance !== "viewer fallback"
    ? loopDuration && loopDuration > 0 ? (elapsed - duration / 1000) % (loopDuration / 1000) : elapsed - duration / 1000
    : elapsed;
  return { kind: "motion", eventLabel: occurrence.actionName.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    clipName: animationOptionLabel(selection.animationId, 0), animationId: selection.animationId, clipTime,
    status: `${phase === "prepare" ? `Logged cast ${occurrence.castStart!.toFixed(3)}–${occurrence.castFinish!.toFixed(3)}s` : `Release at ${occurrence.castFinish!.toFixed(3)}s`}; ${selection.provenance} from preview visual ${visual ? "DB2" : "unresolved"}${selection.provenance === "viewer fallback" ? ` (clip ${fallback})` : ""}.` };
}

export function resolveLoggedAnimation(timeline: CombatTimeline, cursor: number, selectedEvent?: ReplayEvent,
  clipDurations?: Map<number, number>): ReplayAnimationResolution {
  const casts = getLoggedForegroundCasts(timeline);
  const current = casts.filter((occurrence) => occurrence.castStart !== null && occurrence.castStart <= cursor
    && cursor < occurrence.castFinish!).at(-1);
  if (current) return createLoggedCastAnimation(current, cursor, "prepare", clipDurations);
  const release = casts.filter((occurrence) => occurrence.castFinish! <= cursor
    && cursor < occurrence.castFinish! + REPLAY_POSE_BLEND_SECONDS).at(-1);
  if (release) return createLoggedCastAnimation(release, cursor, "release", clipDurations);

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

export function resolveLoggedMotionBlend(timeline: CombatTimeline, cursor: number, selectedEvent?: ReplayEvent,
  clipDurations?: Map<number, number>): ReplayMotionBlend {
  const incoming = resolveLoggedAnimation(timeline, cursor, selectedEvent, clipDurations);
  const casts = getLoggedForegroundCasts(timeline);
  const stand: ReplayAnimationResolution = { kind: "settled", eventLabel: "No active foreground cast", clipName: STAND_CLIP_NAME,
    animationId: STAND_ANIMATION_ID, clipTime: 0, status: "Idle before the logged cast." };
  const active = casts.filter((occurrence) => occurrence.castStart !== null
    && occurrence.castStart <= cursor && cursor < occurrence.castFinish!).at(-1);
  if (active && cursor - active.castStart! < REPLAY_POSE_BLEND_SECONDS) {
    const previous = casts.filter((occurrence) => occurrence.ordinal < active.ordinal
      && occurrence.castFinish! <= active.castStart!).at(-1);
    const outgoing = previous && active.castStart! - previous.castFinish! < REPLAY_POSE_BLEND_SECONDS
      ? createLoggedCastAnimation(previous, active.castStart!, "release", clipDurations) : stand;
    return { incoming, outgoing, incomingWeight: roundReplayTime(cursor - active.castStart!) / REPLAY_POSE_BLEND_SECONDS };
  }
  if (active) return { incoming, outgoing: null, incomingWeight: 1 };
  const release = casts.filter((occurrence) => occurrence.castFinish! <= cursor
    && cursor < occurrence.castFinish! + REPLAY_POSE_BLEND_SECONDS).at(-1);
  if (release) {
    const outgoing = release.castStart !== null
      ? createLoggedCastAnimation(release, release.castFinish!, "prepare", clipDurations) : stand;
    return { incoming, outgoing, incomingWeight: roundReplayTime(cursor - release.castFinish!) / REPLAY_POSE_BLEND_SECONDS };
  }
  const finished = casts.filter((occurrence) => occurrence.castFinish! + REPLAY_POSE_BLEND_SECONDS <= cursor
    && cursor < occurrence.castFinish! + 2 * REPLAY_POSE_BLEND_SECONDS).at(-1);
  if (!finished) return { incoming, outgoing: null, incomingWeight: 1 };
  return { incoming, outgoing: createLoggedCastAnimation(finished, finished.castFinish! + REPLAY_POSE_BLEND_SECONDS,
    "release", clipDurations), incomingWeight: roundReplayTime(cursor - finished.castFinish! - REPLAY_POSE_BLEND_SECONDS)
      / REPLAY_POSE_BLEND_SECONDS };
}

export function resolveLoggedDummyReaction(timeline: CombatTimeline, cursor: number, woundDurationMs: number) {
  const latest = timeline.occurrences.flatMap((occurrence) => occurrence.impacts)
    .filter((impact) => impact.target === DUMMY_TARGET_NAME && (impact.result === "hit" || impact.result === "crit")
      && impact.damage !== null && Number.isFinite(impact.damage) && impact.damage > 0 && impact.time <= cursor
      && cursor < impact.time + woundDurationMs / 1000)
    .sort((left, right) => right.time - left.time || right.ordinal - left.ordinal)[0];
  return latest ? { impactOrdinal: latest.ordinal, animationId: DUMMY_WOUND_ANIMATION_ID,
    clipTimeMs: (cursor - latest.time) * 1000 } : null;
}

export function sampleReplayDummyPose(model: M2Model, timeline: CombatTimeline, cursor: number) {
  const stand = resolveSequence(model, STAND_ANIMATION_ID, { variationIndex: 0 });
  const wound = resolveSequence(model, DUMMY_WOUND_ANIMATION_ID, { variationIndex: 0 });
  if (!stand || !wound || wound.sequence.durationMs <= 0) {
    throw new Error(`FileDataID ${model.fileDataId}: native Stand or Wound (ID 9 variation 0) sequence is unavailable for replay.`);
  }
  const reaction = resolveLoggedDummyReaction(timeline, cursor, wound.sequence.durationMs);
  const resolution = reaction ? wound : stand;
  const timeMs = reaction ? reaction.clipTimeMs : 0;
  return { resolution, timeMs, matrices: sampleBoneMatrices(model, resolution, timeMs) };
}

export function sampleReplayActorPose(model: M2Model, blend: ReplayMotionBlend) {
  const samplePoseFor = (animation: ReplayAnimationResolution) => {
    const isMotion = animation.kind === "motion";
    const resolution = resolveSequence(model, isMotion ? animation.animationId : STAND_ANIMATION_ID,
      { variationIndex: 0 });
    if (!resolution) return null;
    const timeMs = isMotion
      ? Math.min(animation.clipTime * 1000, Math.max(0, resolution.sequence.durationMs - 0.1)) : 0;
    return { resolution, timeMs, matrices: sampleBoneMatrices(model, resolution, timeMs) };
  };
  const incoming = samplePoseFor(blend.incoming) ?? samplePoseFor({ ...blend.incoming,
    kind: "settled", animationId: STAND_ANIMATION_ID, clipTime: 0 });
  if (!incoming) throw new Error(`FileDataID ${model.fileDataId}: native Stand pose is unavailable for replay.`);
  const outgoing = blend.outgoing && samplePoseFor(blend.outgoing);
  return { resolution: incoming.resolution, timeMs: incoming.timeMs,
    matrices: outgoing ? blendBoneMatrices(outgoing.matrices, incoming.matrices, blend.incomingWeight) : incoming.matrices };
}

export function getReplaySourceTransform(
  occurrence: ReplayEffectOccurrence,
  component: ReplayComponent,
  targetFrame: number[],
  casterFallbackFrame: number[],
  sampleAttachmentAtTime: (attachmentId: number, absoluteTime: number, anchor: ReplayEffectAnchor) => number[] | null,
): (timeSeconds: number) => number[] {
  const placement = component.placement;
  const attachmentId = placement?.attachmentId ?? REPLAY_SOURCE_ATTACHMENTS[occurrence.spellId]?.[component.fileDataId];
  const sourceAt = (timeSeconds: number) => {
    const frame = attachmentId !== undefined && attachmentId >= 0
      ? sampleAttachmentAtTime(attachmentId, occurrence.startTime + timeSeconds, component.anchor) : null;
    if (attachmentId !== undefined && attachmentId >= 0 && !frame) {
      throw new Error(`FileDataID ${component.fileDataId}: native attachment ${attachmentId} is unavailable.`);
    }
    return frame && placement
      ? composeAttachmentTransform(frame, placement.offset, placement.angles, placement.scale)
      : frame ?? (component.anchor === "target"
        ? sampleAttachmentAtTime(34, occurrence.startTime + timeSeconds, "target") ?? targetFrame
        : casterFallbackFrame);
  };
  if (component.anchor !== "projectile") return sourceAt;

  // The logged travel start fixes both the launch point and the native body's
  // facing; this straight path does not infer an authored missile motion script.
  const launch = sourceAt(0);
  return (timeSeconds) => {
    const fraction = Math.max(0, Math.min(1, timeSeconds / (occurrence.travelDuration ?? 1)));
    const frame = [...launch];
    for (const index of [12, 13, 14]) frame[index] += (targetFrame[index] - frame[index]) * fraction;
    return frame;
  };
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
  [19, "Base"],
  [21, "SpellHandL"],
  [22, "SpellHandR"],
  [34, "Chest"],
]);

function hasCasterAttachment(spellId: number, component: ReplayComponent) {
  return component.anchor !== "target" && (getPreparedComponentPlacements(spellId, component)
    .some((placement) => placement.attachmentId >= 0)
    || REPLAY_SOURCE_ATTACHMENTS[spellId]?.[component.fileDataId] !== undefined);
}

function describeReplayComponentAnchor(spellId: number, component: ReplayComponent) {
  const placements = getPreparedComponentPlacements(spellId, component);
  const sourced = placements.filter((placement) => placement.attachmentId >= 0);
  const attachmentId = sourced[0]?.attachmentId ?? REPLAY_SOURCE_ATTACHMENTS[spellId]?.[component.fileDataId];
  const attachmentName = attachmentId !== undefined ? M2_ATTACHMENT_NAMES.get(attachmentId) : undefined;
  if (attachmentId !== undefined && component.anchor === "caster") {
    const sources = [...new Set(sourced.map((placement) => placement.attachmentId))];
    const detail = sources.length > 1 ? `; source-linked attachments ${sources.join(" and ")}` : "";
    return `native caster attachment ${attachmentId} (${attachmentName}) frame sampled at the replay time${detail}${component.fileDataId === 1284864 ? "; attachment-local kit offset (0, 0.15, 0) applied" : ""}`;
  }
  if (attachmentId !== undefined) {
    return `native caster attachment ${attachmentId} (${attachmentName}) origin for launch · dummy attachment 34 (Chest) translation sampled at logged arrival${spellId === 117014 ? "; impact positioner 712 unresolved" : ""}`;
  }
  if (component.anchor === "projectile") {
    return "60%-bounds anchored launch (missile source attachment unresolved) · dummy attachment 34 (Chest) translation sampled at logged arrival";
  }
  if (component.anchor === "target") {
    const positioners = [...new Set(placements.map((placement) => placement.positionerId).filter(Boolean))];
    return `native dummy attachment 34 (Chest) sampled at particle birth from the logged reaction pose${positioners.length ? `; source positioner ${positioners.join("/")} unresolved` : ""}`;
  }
  const positioners = [...new Set(placements.map((placement) => placement.positionerId).filter(Boolean))];
  return `60%-bounds anchored at caster${positioners.length ? `; source positioner ${positioners.join("/")} unresolved` : "; source attachment not established"}`;
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

function sampleAttachmentEffectTransform(actor: NativeM2Actor, attachmentId: number, matrices?: number[][]) {
  const nativeMatrix = matrices ? attachmentMatrix(actor.model, matrices, attachmentId) : actor.sampleAttachment(attachmentId);
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
    "caster frames use historical replay pose; missiles keep native release facing on a straight path (no authored aim/motion)",
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
  const [clipDurations, setClipDurations] = useState<Map<number, number>>(new Map());
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
    ? resolveLoggedMotionBlend(replay.timeline, replay.cursor, replay.events[replay.selectedIndex], clipDurations)
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
    let replayClipDurations = new Map<number, number>();
    let dummyStandPose: number[][] | null = null;
    let dummyStand: SequenceResolution | null = null;
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
      const historicalCasterPoses = new Map<number, number[][]>();
      const historicalDummyPoses = new Map<number, number[][]>();
      const sampleHistoricalAttachment = (attachmentId: number, absoluteTime: number, anchor: ReplayEffectAnchor) => {
        const isTarget = anchor === "target";
        const historicalPoses = isTarget ? historicalDummyPoses : historicalCasterPoses;
        let matrices = historicalPoses.get(absoluteTime);
        if (!matrices) {
          matrices = isTarget
            ? sampleReplayDummyPose(dummyActor!.model, replayState.timeline!, absoluteTime).matrices
            : sampleReplayActorPose(vulperaActor!.model,
              resolveLoggedMotionBlend(replayState.timeline!, absoluteTime, undefined, replayClipDurations)).matrices;
          if (historicalPoses.size >= 256) historicalPoses.clear();
          historicalPoses.set(absoluteTime, matrices);
        }
        return sampleAttachmentEffectTransform(isTarget ? dummyActor! : vulperaActor!, attachmentId, matrices);
      };
      const occurrences = replayState.timeline
        ? resolveLoggedEffectOccurrences(replayState.timeline, replayState.cursor,
          new Map(replayEffects.map(({ asset, effect }) => [asset.fileDataId, getNativeEffectTailBound(effect.model)]))) : [];
      let particleCount = 0;
      let meshTriangles = 0;
      const activeFileDataIds: number[] = [];
      let componentCount = 0;
      try {
        for (const { asset, effect } of replayEffects) {
          const matching = occurrences.flatMap((occurrence) => occurrence.components
            .filter((component) => component.fileDataId === asset.fileDataId)
            .map((component) => ({ occurrence, component })));
          const instances: NativeParticleRenderInstance[] = matching.map(({ occurrence, component }) => ({
            timeSeconds: occurrence.componentTimeSeconds,
            emissionEndSeconds: occurrence.emissionDuration!,
            modelScale: [4329984, 794788, 613807].includes(asset.fileDataId)
              ? asset.effectNameScale : NATIVE_REPLAY_BASE_SCALE * asset.effectNameScale,
            occurrenceSeed: `${occurrence.eventKey}/${component.placement?.sourceRowId ?? component.fileDataId}`,
            sourceTransformAtTime: getReplaySourceTransform(occurrence, component,
              (component.anchor === "projectile"
                ? sampleHistoricalAttachment(34, occurrence.emissionStopTime, "target") : null)
                ?? effectTranslationMatrix(anchors.target),
              effectTranslationMatrix(anchors.caster), sampleHistoricalAttachment),
          }));
          particleCount += effect.setReplayInstances(instances, camera);
          meshTriangles += instances.filter((instance) => instance.timeSeconds >= 0
            && instance.timeSeconds < instance.emissionEndSeconds).length * effect.meshTriangleCount;
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
      const latestProjectile = occurrences.filter((occurrence) => occurrence.spellId === 117014
        && occurrence.components[0].fileDataId === 4329984).at(-1);
      const latestFrame = latestProjectile && getReplaySourceTransform(latestProjectile,
        latestProjectile.components[0],
        sampleHistoricalAttachment(34, latestProjectile.emissionStopTime, "target")
          ?? effectTranslationMatrix(anchors.target), effectTranslationMatrix(anchors.caster),
        sampleHistoricalAttachment)(latestProjectile.componentTimeSeconds);
      canvas.dataset.replayNativeLatestSourceX = latestFrame ? latestFrame[12].toFixed(6) : "";
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

      dummyStand = resolveSequence(dummyActor.model, STAND_ANIMATION_ID, { variationIndex: 0 });
      const dummyWound = resolveSequence(dummyActor.model, DUMMY_WOUND_ANIMATION_ID, { variationIndex: 0 });
      if (!dummyStand || !dummyWound || dummyWound.sequence.durationMs <= 0) {
        const fileDataId = dummyActor.model.fileDataId;
        stop();
        setStatus("error");
        setError(`FileDataID ${fileDataId}: native Stand or Wound (ID 9 variation 0) sequence is unavailable for replay.`);
        return;
      }
      dummyStandPose = sampleBoneMatrices(dummyActor.model, dummyStand, 0);
      dummyActor.setPose(dummyStandPose);
      dummyActor.updateAnimatedTracks(dummyStand, 0);

      replayClipDurations = new Map(sequences.map((sequence) => [sequence.animationId, sequence.durationMs]));
      const applyReplayAnimation = (blend: ReplayMotionBlend) => {
        if (!vulperaActor || !dummyActor) return;
        const pose = sampleReplayActorPose(vulperaActor.model, blend);
        vulperaActor.setPose(pose.matrices);
        vulperaActor.updateAnimatedTracks(pose.resolution, pose.timeMs);
        const state = replayStateRef.current;
        const dummyPose = sampleReplayDummyPose(dummyActor.model,
          state?.timeline ?? { occurrences: [], auras: [], unmatched: [] }, state?.cursor ?? 0);
        dummyActor.setPose(dummyPose.matrices);
        dummyActor.updateAnimatedTracks(dummyPose.resolution, dummyPose.timeMs);
        canvas.dataset.replayDummyAnimationId = String(dummyPose.resolution.sequence.animationId);
        canvas.dataset.replayDummyClipTimeMs = dummyPose.timeMs.toFixed(3);
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
          const timeline = replayStateRef.current?.timeline ?? undefined;
          const requiredIds = getLoggedAssetIds(timeline);
          const assets = NATIVE_EFFECT_ASSETS.filter((asset) => requiredIds.has(asset.fileDataId));
          const missing = [...requiredIds].filter((fileDataId) => !assets.some((asset) => asset.fileDataId === fileDataId));
          if (missing.length > 0) throw new Error(`Missing pinned replay FileDataID ${missing.join(", ")}. No substitute effect was rendered.`);
          const results = await Promise.allSettled(assets.map(async (asset) => {
            const instanceLimit = REPLAY_COMPONENT_INSTANCE_LIMITS.get(asset.fileDataId);
            if (!instanceLimit) throw new Error(`FileDataID ${asset.fileDataId}: no measured replay instance bound. No substitute effect was rendered.`);
            const effect = await loadNativeParticleEffect(asset, (model) => Math.max(instanceLimit,
              timeline ? getReplayComponentPeak(timeline, asset.fileDataId, getNativeEffectTailBound(model)) : 0));
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
          else {
            clearReplayEffects();
            if (dummyActor && dummyStand && dummyStandPose) {
              dummyActor.setPose(dummyStandPose);
              dummyActor.updateAnimatedTracks(dummyStand, 0);
            }
          }
        },
        resetCamera,
      };
      setAnimationNames(animationClipNames);
      setClipDurations(replayClipDurations);
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
  }, [animationMode, replay?.events, replay?.selectedIndex, replay?.cursor, clipDurations]);

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
              <small> · Partial original components only; combat-log timestamps drive cast, travel and impact. Unbound event ends use a 0.2s preview emission; authored lifespan bounds retain particles and ribbons, not exact retail expiration. Ranged event offsets are sampled deterministically for preview (native VFX fidelity is not verified).</small>
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
              Across the mapped spell list, {[...REPLAY_SPELL_EFFECTS].reduce((total, [spellId, spell]) => total + spell.components.filter((component) => hasCasterAttachment(spellId, component)).length, 0)} of {[...REPLAY_SPELL_EFFECTS.values()].reduce((total, spell) => total + spell.components.length, 0)} mapped components use native caster attachment frames. Placement: {selectedReplaySpell.components.filter((component) =>
                hasCasterAttachment(selectedReplayEvent!.id!, component)).length} of {selectedReplaySpell.components.length} components use native caster attachment origins; others use the dummy Chest or bounds fallback. Authored kit offsets and delays apply only to resolved attachment rows; conditional visual branches and positioners 513, 36, 216, 1172 and 712 are not reconstructed.
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
          ? "Cast, missile release, flight, impact and mapped aura lifetimes use timestamps from the bundled SimC combat log. Native M2 pose and original partial VFX are presentation, not complete spell visuals; projectile positions interpolate between the presented actors, not recorded coordinates. Ancestor casts are listed in the logged event table but their missiles are intentionally omitted: no native ancestor model or unambiguous pet identity is available. Dummy Wound (ID 9 variation 0) is a viewer policy for matched positive-damage hit/crit records naming Fluffy_Pillow, not a retail hit/crit animation mapping. No inferred GCD, recorded actor world motion, authoritative historical attachment coordinates, sound or complete VFX parity is claimed."
          : animationMode === "manual"
            ? "Manual preview is separate from replay time. It does not show spell impact timing, damage, VFX, hit reactions, or optimal play."
            : `Native preview time is an isolated, stationary component-viewer clock, not missile travel, a cast, an impact, or a simulation event. It renders only the selected original M2 component, its original BLP textures, and its pinned SKIN where applicable; it is not ${selectedNativeFileDataId === 794788 || selectedNativeFileDataId === 613807 ? "the complete Elemental Blast composite" : "a complete spell"}.`}
      </p>
    </section>
  );
}
