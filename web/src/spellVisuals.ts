import { Euler, Matrix4, Vector3 } from "three";
import type { CombatTimeline } from "./combatLog";
import graphJson from "./spellVisualGraph.json";

export interface VisualEventRow {
  ID: number;
  SpellVisualID: number;
  SpellVisualKitID: number;
  StartEvent: number;
  EndEvent: number;
  TargetType: number;
  StartMinOffsetMs: number;
  StartMaxOffsetMs: number;
  kit?: { DelayMin: number; DelayMax: number };
}
export type VisualPhase = "castStart" | "castFinish" | "missile" | "impact" | "auraGain" | "auraLoss";
type PhaseBinding = { start: VisualPhase; end?: VisualPhase; evidence: string };

// Evidence is restricted to the paired SimC log and the named source-linked
// kits: 1/2 encloses Lava Burst and Lightning Bolt precasts, 3/13 contains
// their release kits, 6/13 contains their target hit kits, 7/8 encloses
// Stormkeeper's persistent hand kit. Other raw values stay unbound.
const VERIFIED_BINDINGS: Record<string, PhaseBinding> = {
  "1/2/1": { start: "castStart", end: "castFinish", evidence: "Lava Burst and Lightning Bolt precast kits bracket logged execution" },
  "3/13/1": { start: "castFinish", evidence: "Lava Burst and Lightning Bolt release kits follow logged execution" },
  "6/13/4": { start: "impact", evidence: "Lightning Bolt and Elemental Blast target kits follow logged hit" },
  "7/8/1": { start: "auraGain", end: "auraLoss", evidence: "Stormkeeper hand kit follows logged aura gain and loss" },
  "7/8/2": { start: "auraGain", end: "auraLoss", evidence: "Lightning Shield target-state kit follows logged aura transitions" },
};

export const SPELL_VISUAL_GRAPH = graphJson;
export function getPreviewVisual(spellId: number) {
  const spell = graphJson.spells[String(spellId) as keyof typeof graphJson.spells];
  return spell ? graphJson.visuals[String(spell.selectedVisualId) as keyof typeof graphJson.visuals] : null;
}

export function getPhaseBinding(row: VisualEventRow): PhaseBinding | null {
  return VERIFIED_BINDINGS[`${row.StartEvent}/${row.EndEvent}/${row.TargetType}`] ?? null;
}

function deterministicFraction(seed: string) {
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}

export function sampleKitStart(key: string, row: VisualEventRow, phaseTime: number, delay: number,
  kitDelayMin = 0, kitDelayMax = kitDelayMin) {
  const fraction = deterministicFraction(`${key}/${row.ID}`);
  const offsetMs = row.StartMinOffsetMs + (row.StartMaxOffsetMs - row.StartMinOffsetMs) * fraction;
  return Math.round((phaseTime + delay + (kitDelayMin + (kitDelayMax - kitDelayMin) * fraction) / 1000 + offsetMs / 1000) * 1e6) / 1e6;
}

export function scheduleVisualPhases(timeline: CombatTimeline, rows: VisualEventRow[], spellId?: number) {
  const phases: Array<{ occurrenceKey: string; phase: VisualPhase; time: number }> = [];
  const kits: Array<{ occurrenceKey: string; sourceRowId: number; time: number; phase: VisualPhase; evidence: string }> = [];
  const unbound = rows.filter((row) => !getPhaseBinding(row));
  for (const occurrence of timeline.occurrences) {
    if (spellId !== undefined && occurrence.spellId !== spellId) continue;
    if (occurrence.castStart !== null) phases.push({ occurrenceKey: occurrence.key, phase: "castStart", time: occurrence.castStart });
    if (occurrence.castFinish !== null) phases.push({ occurrenceKey: occurrence.key, phase: "castFinish", time: occurrence.castFinish });
    if (occurrence.travelStart !== null) phases.push({ occurrenceKey: occurrence.key, phase: "missile", time: occurrence.travelStart });
    for (const impact of occurrence.impacts) phases.push({ occurrenceKey: occurrence.key, phase: "impact", time: impact.time });
    for (const row of rows) {
      const binding = getPhaseBinding(row);
      if (!binding || binding.start.startsWith("aura")) continue;
      const timestamps = binding.start === "castStart" ? [occurrence.castStart]
        : binding.start === "castFinish" ? [occurrence.castFinish]
          : occurrence.impacts.map((impact) => impact.time);
      for (const time of timestamps) if (time !== null) kits.push({ occurrenceKey: occurrence.key,
        sourceRowId: row.ID, phase: binding.start, time: sampleKitStart(occurrence.key, row, time, 0, row.kit?.DelayMin, row.kit?.DelayMax), evidence: binding.evidence });
    }
  }
  for (const aura of timeline.auras) {
    if (spellId !== undefined && aura.spellId !== spellId) continue;
    const phase: VisualPhase | null = aura.transition === "gain" || aura.transition === "refresh" ? "auraGain"
      : aura.transition === "loss" ? "auraLoss" : null;
    if (!phase) continue;
    const occurrenceKey = `aura-${aura.ordinal}`;
    phases.push({ occurrenceKey, phase, time: aura.time });
    for (const row of rows) {
      const binding = getPhaseBinding(row);
      if (binding?.start !== phase) continue;
      kits.push({ occurrenceKey, sourceRowId: row.ID, phase, time: sampleKitStart(occurrenceKey, row, aura.time, 0, row.kit?.DelayMin, row.kit?.DelayMax), evidence: binding.evidence });
    }
  }
  phases.sort((left, right) => left.time - right.time);
  return { phases, kits, unbound };
}

type VisualAnimation = { InitialAnimID: number; LoopAnimID: number; AnimKitID: number;
  animKit?: { segments: Array<{ AnimID: number; OrderIndex: number }> } | null };
export function resolveVisualAnimation(animation: VisualAnimation | null, phase: "prepare" | "loop" | "release", fallback: number) {
  const segments = animation?.animKit?.segments ?? [];
  const animationId = phase === "loop" ? (segments[1]?.AnimID ?? animation?.LoopAnimID)
    : (segments[0]?.AnimID ?? animation?.InitialAnimID);
  return animationId !== undefined && animationId > 0
    ? { animationId, provenance: segments.length ? "AnimKit segment" : "SpellVisualAnim" }
    : { animationId: fallback, provenance: "viewer fallback" };
}

// Inputs are native M2 frames. DB2 angular fields are radians; native yaw is Z,
// pitch is Y, roll is X. Offset is attachment-local and precedes the rotation.
export function composeAttachmentTransform(frame: number[], offset: number[], angles: number[], scale: number) {
  return new Matrix4().fromArray(frame)
    .multiply(new Matrix4().makeTranslation(...offset as [number, number, number]))
    .multiply(new Matrix4().makeRotationFromEuler(new Euler(angles[2], angles[1], angles[0], "ZYX")))
    .multiply(new Matrix4().makeScale(scale, scale, scale)).toArray();
}

export function getAttachmentWorldPosition(root: Matrix4, frame: number[], offset: number[]) {
  return new Vector3().setFromMatrixPosition(root.clone().multiply(new Matrix4().fromArray(frame))
    .multiply(new Matrix4().makeTranslation(...offset as [number, number, number])));
}
