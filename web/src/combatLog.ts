export type CombatLogKind = "schedule" | "perform" | "travel" | "impact" | "aura" | "arise" | "demise" | "summon";
export interface CombatLogEvent {
  ordinal: number;
  time: number;
  actor: string;
  kind: CombatLogKind;
  actionName?: string;
  spellId?: number;
  duration?: number;
  target?: string;
  result?: string;
  name?: string;
  stacks?: number;
  transition?: "gain" | "loss" | "decrement" | "refresh";
  spawnIndex?: number;
}
export interface CombatOccurrence {
  key: string;
  actor: string;
  actorInstance: string;
  actionName: string;
  family: string;
  spellId: number;
  isBackground: boolean;
  castStart: number | null;
  castFinish: number | null;
  travelStart: number | null;
  travelDuration: number | null;
  impacts: Array<{ time: number; ordinal: number; target: string; result: string }>;
  ordinal: number;
}
export interface CombatTimeline {
  occurrences: CombatOccurrence[];
  auras: Array<{ time: number; ordinal: number; actor: string; name: string; spellId: number; stacks: number; transition: string }>;
  unmatched: CombatLogEvent[];
}

// The text log has no instance identifier on action lines. Round-robin slots are
// presentation identities, not claims about which summoned pet actually cast.
export function parseCombatLog(lines: Array<string | [number, string]>): CombatLogEvent[] {
  const parsed: CombatLogEvent[] = [];
  lines.forEach((entry, index) => {
    const [ordinal, line] = typeof entry === "string" ? [index, entry] : entry;
    const prefix = /^(\d+\.\d+) (?:Player '([^']+)'|([^ ]+)) (.*)$/.exec(line.trim());
    if (!prefix) return;
    const [, rawTime, quoted, bare, body] = prefix;
    const common = { ordinal, time: Number(rawTime), actor: quoted ?? bare };
    const action = /Action '([^']+)' \((\d+)\)/.exec(body);
    const buff = /(gains|loses|decrements|refreshes) Buff '([^']+)' \((\d+)\)/.exec(body);
    const spawn = /Spawn Index=(\d+)/.exec(body);
    if (body.includes("arises.") && spawn) parsed.push({ ...common, kind: "arise", spawnIndex: Number(spawn[1]) });
    else if (body.includes("demises.") && spawn) parsed.push({ ...common, kind: "demise", spawnIndex: Number(spawn[1]) });
    else if (/summons \S+ for \d/.test(body)) parsed.push({ ...common, kind: "summon", name: /summons (\S+)/.exec(body)?.[1], duration: Number(/for (\d+\.\d+)s/.exec(body)?.[1]) });
    else if (buff) {
      const transition = ({ gains: "gain", loses: "loss", decrements: "decrement", refreshes: "refresh" } as const)[buff[1] as "gains" | "loses" | "decrements" | "refreshes"];
      const stacks = transition === "loss" ? 0 : Number((transition === "decrement" ? /to (\d+) stacks/ : /stacks=(\d+)/).exec(body)?.[1] ?? 1);
      parsed.push({ ...common, kind: "aura", transition, name: buff[2], spellId: Number(buff[3]), stacks });
    } else if (action) {
      const attributes = { ...common, actionName: action[1], spellId: Number(action[2]) };
      if (body.startsWith("schedules execute")) parsed.push({ ...attributes, kind: "schedule" });
      else if (body.startsWith("performs")) parsed.push({ ...attributes, kind: "perform" });
      else if (body.startsWith("schedules travel")) parsed.push({ ...attributes, kind: "travel", duration: Number(/travel \((\d+\.\d+)\)/.exec(body)?.[1]) });
      else if (/\b(?:hits|misses|ticks(?: \([^)]*\) on)?) Enemy '/.test(body)) parsed.push({ ...attributes, kind: "impact", target: /Enemy '([^']+)'/.exec(body)?.[1] ?? "", result: /\((crit|hit|miss|dodge|parry)\)/.exec(body)?.[1] ?? "unknown" });
    }
  });
  return parsed;
}

export function buildCombatTimeline(events: CombatLogEvent[]): CombatTimeline {
  const occurrences: CombatOccurrence[] = [];
  const unmatched: CombatLogEvent[] = [];
  const auras: CombatTimeline["auras"] = [];
  const slots = new Map<string, number[]>();
  const slotCursor = new Map<string, number>();
  const scheduled = new Map<string, CombatOccurrence[]>();
  const performed = new Map<string, CombatOccurrence[]>();
  const keyFor = (event: CombatLogEvent) => `${event.actor}/${event.actionName}/${event.spellId}`;
  const queue = (map: Map<string, CombatOccurrence[]>, key: string) => {
    if (!map.has(key)) map.set(key, []);
    return map.get(key)!;
  };
  const assignInstance = (actor: string) => {
    const active = slots.get(actor) ?? [];
    if (active.length === 0) return actor;
    const index = slotCursor.get(actor) ?? 0;
    slotCursor.set(actor, index + 1);
    return `${actor}#${active[index % active.length]}`;
  };
  const makeOccurrence = (event: CombatLogEvent): CombatOccurrence => {
    const actionName = event.actionName!;
    const isBackground = /_ancestor|_elemental|_wolf|_guardian/.test(event.actor)
      || /(?:_overload|_asc$|_aoe$)/.test(actionName);
    const occurrence: CombatOccurrence = {
      key: `${event.actor}/${event.ordinal}`, actor: event.actor, actorInstance: assignInstance(event.actor),
      actionName, family: actionName.replace(/(?:_overload)?_asc$|_overload$/, ""), spellId: event.spellId!,
      isBackground, castStart: event.kind === "schedule" ? event.time : null, castFinish: null, travelStart: null, travelDuration: null, impacts: [], ordinal: event.ordinal,
    };
    occurrences.push(occurrence);
    return occurrence;
  };
  for (const event of events) {
    if (event.kind === "arise") {
      const active = slots.get(event.actor) ?? [];
      active.push(event.spawnIndex!);
      slots.set(event.actor, active);
    } else if (event.kind === "demise") {
      slots.set(event.actor, (slots.get(event.actor) ?? []).filter((slot) => slot !== event.spawnIndex));
    } else if (event.kind === "aura") {
      auras.push({ time: event.time, ordinal: event.ordinal, actor: event.actor, name: event.name!, spellId: event.spellId!, stacks: event.stacks!, transition: event.transition! });
    } else if (event.kind === "schedule") {
      const occurrence = makeOccurrence(event);
      queue(scheduled, keyFor(event)).push(occurrence);
    } else if (event.kind === "perform") {
      const occurrence = queue(scheduled, keyFor(event)).shift() ?? makeOccurrence(event);
      occurrence.castFinish = event.time;
      if (occurrence.isBackground || occurrence.castStart === event.time) occurrence.castStart = null;
      queue(performed, keyFor(event)).push(occurrence);
    } else if (event.kind === "travel") {
      const candidates = queue(performed, keyFor(event));
      const index = candidates.findIndex((occurrence) => occurrence.castFinish === event.time);
      if (index < 0) { unmatched.push(event); continue; }
      const [occurrence] = candidates.splice(index, 1);
      occurrence.travelStart = event.time;
      occurrence.travelDuration = event.duration!;
    } else if (event.kind === "impact") {
      const traveling = occurrences.filter((occurrence) => occurrence.actor === event.actor
        && occurrence.actionName === event.actionName && occurrence.spellId === event.spellId
        && occurrence.travelStart !== null && occurrence.travelDuration !== null
        && Math.abs(occurrence.travelStart + occurrence.travelDuration - event.time) <= 0.002);
      const direct = occurrences.filter((occurrence) => occurrence.actor === event.actor
        && occurrence.actionName === event.actionName && occurrence.spellId === event.spellId
        && occurrence.travelStart === null
        && Math.abs((occurrence.castFinish ?? occurrence.castStart ?? -1) - event.time) <= 0.002);
      const compatible = [...traveling, ...direct];
      const occurrence = compatible.find((candidate) => candidate.impacts.length === 0)
        ?? (compatible.length === 1 ? compatible[0] : undefined);
      if (!occurrence) { unmatched.push(event); continue; }
      occurrence.impacts.push({ time: event.time, ordinal: event.ordinal, target: event.target ?? "", result: event.result ?? "unknown" });
    }
  }
  return { occurrences, auras, unmatched };
}
