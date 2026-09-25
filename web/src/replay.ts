export type ReplayPhase = "precombat" | "combat";

export interface ResourceSnapshot {
  name: string;
  value: number;
  max: number | null;
}

export type RecordedDuration = number | "indefinite" | null;

export interface AuraSnapshot {
  id: number;
  name: string;
  stacks: number;
  remains: RecordedDuration;
}

export interface ReplayEvent {
  key: string;
  phase: ReplayPhase;
  phaseIndex: number;
  time: number;
  kind: "action" | "wait";
  name: string;
  spellName: string | null;
  id: number | null;
  target: string | null;
  queueFailed: boolean | null;
  wait: number | null;
  resources: ResourceSnapshot[] | null;
  buffs: AuraSnapshot[] | null;
  cooldowns: Array<{ id: number; name: string; maxCharges: number; remains: number }> | null;
  targets: Array<{
    name: string;
    debuffs: AuraSnapshot[];
  }> | null;
}

export interface ReplayActor {
  id: string;
  name: string;
  specialization: string | null;
  role: string | null;
  aggregateDps: number | null;
  aggregateDpsSamples: number | null;
  fightLength: number | null;
  events: ReplayEvent[];
  hasFullState: boolean;
}

export interface ReplayReport {
  reportVersion: string;
  engineVersion: string;
  gitRevision: string | null;
  timestamp: string | null;
  environment: string | null;
  gameVersion: string | null;
  ptrCompiledSupport: boolean | null;
  simulationIterations: number | null;
  actors: ReplayActor[];
  diagnostics: Array<{ level: string; message: string }>;
}

export class ReplayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayValidationError";
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new ReplayValidationError(`${path} must be an object.`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ReplayValidationError(`${path} must be an array.`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReplayValidationError(`${path} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireString(value, path);
}

function optionalTimestamp(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return requireString(value, "report.timestamp");
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const timestamp = new Date(value * 1000);
    if (!Number.isNaN(timestamp.valueOf())) {
      return timestamp.toISOString();
    }
  }
  throw new ReplayValidationError("report.timestamp must be a non-negative Unix timestamp or non-empty string when present.");
}


function requireFiniteNumber(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new ReplayValidationError(`${path} must be a finite number greater than or equal to ${minimum}.`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, path: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requireFiniteNumber(value, path);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function parseAuraDuration(value: unknown, path: string): RecordedDuration {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ReplayValidationError(`${path} must be a finite number when present.`);
  }
  if (value >= 0) {
    return value;
  }
  // timespan_t::min() serializes near -9.22e15 when an active aura has no expiration event.
  if (value <= -9_000_000_000_000_000) {
    return "indefinite";
  }
  throw new ReplayValidationError(`${path} must be non-negative or SimulationCraft's indefinite-duration sentinel.`);
}


function parseResources(event: UnknownRecord, path: string): ResourceSnapshot[] | null {
  if (!hasOwn(event, "resources")) {
    return null;
  }

  const resources = requireRecord(event.resources, `${path}.resources`);
  const maxima = hasOwn(event, "resources_max")
    ? requireRecord(event.resources_max, `${path}.resources_max`)
    : {};

  return Object.keys(resources).sort().map((name) => ({
    name,
    value: requireFiniteNumber(resources[name], `${path}.resources.${name}`),
    max: hasOwn(maxima, name)
      ? requireFiniteNumber(maxima[name], `${path}.resources_max.${name}`)
      : null,
  }));
}

function parseAuras(value: unknown, path: string, stackKey: "stacks" | "stack"): AuraSnapshot[] {
  return requireArray(value, path).map((rawAura, index) => {
    const auraPath = `${path}[${index}]`;
    const aura = requireRecord(rawAura, auraPath);
    return {
      id: requireFiniteNumber(aura.id, `${auraPath}.id`),
      name: requireString(aura.name, `${auraPath}.name`),
      stacks: requireFiniteNumber(aura[stackKey], `${auraPath}.${stackKey}`),
      remains: parseAuraDuration(aura.remains, `${auraPath}.remains`),
    };
  });
}

function parseCooldowns(value: unknown, path: string): ReplayEvent["cooldowns"] {
  return requireArray(value, path).map((rawCooldown, index) => {
    const cooldownPath = `${path}[${index}]`;
    const cooldown = requireRecord(rawCooldown, cooldownPath);
    return {
      id: requireFiniteNumber(cooldown.id, `${cooldownPath}.id`),
      name: requireString(cooldown.name, `${cooldownPath}.name`),
      // SimC serializes configured cooldown_t::charges as "stacks"; current availability is not recorded.
      maxCharges: requireFiniteNumber(cooldown.stacks, `${cooldownPath}.stacks`),
      remains: requireFiniteNumber(cooldown.remains, `${cooldownPath}.remains`),
    };
  });
}

function parseTargets(value: unknown, path: string): ReplayEvent["targets"] {
  return requireArray(value, path).map((rawTarget, index) => {
    const targetPath = `${path}[${index}]`;
    const target = requireRecord(rawTarget, targetPath);
    return {
      name: requireString(target.name, `${targetPath}.name`),
      debuffs: parseAuras(target.debuffs, `${targetPath}.debuffs`, "stack"),
    };
  });
}

function parseEvent(rawEvent: unknown, phase: ReplayPhase, phaseIndex: number, path: string): ReplayEvent {
  const event = requireRecord(rawEvent, path);
  const time = requireFiniteNumber(event.time, `${path}.time`);
  const isWait = hasOwn(event, "wait");
  if (isWait && hasOwn(event, "name")) {
    throw new ReplayValidationError(`${path} cannot be both an action and a wait record.`);
  }

  if (isWait) {
    return {
      key: `${phase}-${phaseIndex}`,
      phase,
      phaseIndex,
      time,
      kind: "wait",
      name: "Wait",
      spellName: null,
      id: null,
      target: null,
      queueFailed: null,
      wait: requireFiniteNumber(event.wait, `${path}.wait`),
      resources: parseResources(event, path),
      buffs: hasOwn(event, "buffs") ? parseAuras(event.buffs, `${path}.buffs`, "stacks") : null,
      cooldowns: hasOwn(event, "cooldowns") ? parseCooldowns(event.cooldowns, `${path}.cooldowns`) : null,
      targets: hasOwn(event, "targets") ? parseTargets(event.targets, `${path}.targets`) : null,
    };
  }

  if (event.queue_failed !== undefined && typeof event.queue_failed !== "boolean") {
    throw new ReplayValidationError(`${path}.queue_failed must be a boolean when present.`);
  }

  return {
    key: `${phase}-${phaseIndex}`,
    phase,
    phaseIndex,
    time,
    kind: "action",
    name: requireString(event.name, `${path}.name`),
    spellName: optionalString(event.spell_name, `${path}.spell_name`),
    id: optionalFiniteNumber(event.id, `${path}.id`),
    target: optionalString(event.target, `${path}.target`),
    queueFailed: event.queue_failed === undefined ? null : event.queue_failed,
    wait: null,
    resources: parseResources(event, path),
    buffs: hasOwn(event, "buffs") ? parseAuras(event.buffs, `${path}.buffs`, "stacks") : null,
    cooldowns: hasOwn(event, "cooldowns") ? parseCooldowns(event.cooldowns, `${path}.cooldowns`) : null,
    targets: hasOwn(event, "targets") ? parseTargets(event.targets, `${path}.targets`) : null,
  };
}

function parseEvents(collectedData: UnknownRecord, actorPath: string): ReplayEvent[] {
  const phases: Array<[ReplayPhase, string]> = [
    ["precombat", "action_sequence_precombat"],
    ["combat", "action_sequence"],
  ];
  const events: ReplayEvent[] = [];

  for (const [phase, field] of phases) {
    if (!hasOwn(collectedData, field)) {
      continue;
    }
    const phaseEvents = requireArray(collectedData[field], `${actorPath}.collected_data.${field}`);
    let previousTime = -1;
    phaseEvents.forEach((event, index) => {
      const parsedEvent = parseEvent(event, phase, index, `${actorPath}.collected_data.${field}[${index}]`);
      if (parsedEvent.time < previousTime) {
        throw new ReplayValidationError(`${actorPath}.collected_data.${field}[${index}].time must not go backwards within its phase.`);
      }
      previousTime = parsedEvent.time;
      events.push(parsedEvent);
    });
  }

  return events;
}

function readMean(summary: unknown, path: string): number | null {
  if (summary === undefined || summary === null) {
    return null;
  }
  const record = requireRecord(summary, path);
  return optionalFiniteNumber(record.mean, `${path}.mean`);
}

function readCount(summary: unknown, path: string): number | null {
  if (summary === undefined || summary === null) {
    return null;
  }
  const record = requireRecord(summary, path);
  return optionalFiniteNumber(record.count, `${path}.count`);
}

function parseDiagnostics(value: unknown): ReplayReport["diagnostics"] {
  if (value === undefined || value === null) {
    return [];
  }
  return requireArray(value, "logs").map((rawDiagnostic, index) => {
    const path = `logs[${index}]`;
    const diagnostic = requireRecord(rawDiagnostic, path);
    return {
      level: requireString(diagnostic.level, `${path}.level`),
      message: requireString(diagnostic.message, `${path}.message`),
    };
  });
}

export function parseReplayReport(input: unknown): ReplayReport {
  const root = requireRecord(input, "report");
  const reportVersion = requireString(root.report_version, "report.report_version");
  if (reportVersion !== "2.0.0") {
    throw new ReplayValidationError(`Expected report_version 2.0.0, received ${reportVersion}. Export SimulationCraft JSON with version=2.0.0.`);
  }

  const sim = requireRecord(root.sim, "report.sim");
  const players = requireArray(sim.players, "report.sim.players");
  const actors: ReplayActor[] = [];

  players.forEach((rawPlayer, playerIndex) => {
    const playerPath = `report.sim.players[${playerIndex}]`;
    const player = requireRecord(rawPlayer, playerPath);
    const collectedData = requireRecord(player.collected_data, `${playerPath}.collected_data`);
    const events = parseEvents(collectedData, playerPath);
    if (events.length === 0) {
      return;
    }

    actors.push({
      id: `actor-${playerIndex}`,
      name: requireString(player.name, `${playerPath}.name`),
      specialization: optionalString(player.specialization, `${playerPath}.specialization`),
      role: optionalString(player.role, `${playerPath}.role`),
      aggregateDps: readMean(collectedData.dps, `${playerPath}.collected_data.dps`),
      aggregateDpsSamples: readCount(collectedData.dps, `${playerPath}.collected_data.dps`),
      fightLength: readMean(collectedData.fight_length, `${playerPath}.collected_data.fight_length`),
      events,
      hasFullState: events.some((event) => event.cooldowns !== null || event.targets !== null),
    });
  });

  if (actors.length === 0) {
    throw new ReplayValidationError("No player action trace was found. Export with report_details=1 and collect_action_sequence=1.");
  }

  const options = isRecord(sim.options) ? sim.options : {};
  const dbc = isRecord(options.dbc) ? options.dbc : {};
  const environment = optionalString(dbc.version_used, "report.sim.options.dbc.version_used");
  const environmentData = environment && isRecord(dbc[environment]) ? dbc[environment] : null;

  const ptrCompiledSupport = root.ptr_enabled === undefined || root.ptr_enabled === null
    ? null
    : root.ptr_enabled === true || root.ptr_enabled === 1
      ? true
      : root.ptr_enabled === false || root.ptr_enabled === 0
        ? false
        : undefined;
  if (ptrCompiledSupport === undefined) {
    throw new ReplayValidationError("report.ptr_enabled must be a boolean or binary 0/1 value when present.");
  }

  return {
    reportVersion,
    engineVersion: requireString(root.version, "report.version"),
    gitRevision: optionalString(root.git_revision, "report.git_revision"),
    timestamp: optionalTimestamp(root.timestamp),
    environment,
    gameVersion: environmentData ? optionalString(environmentData.wow_version, `report.sim.options.dbc.${environment}.wow_version`) : null,
    ptrCompiledSupport,
    simulationIterations: optionalFiniteNumber(options.iterations, "report.sim.options.iterations"),
    actors,
    diagnostics: parseDiagnostics(root.logs),
  };
}

export function findEventAtOrBefore(events: ReplayEvent[], time: number): number {
  const combatIndexes = events.flatMap((event, index) => event.phase === "combat" ? [index] : []);
  if (combatIndexes.length === 0) {
    return events.length === 0 ? -1 : 0;
  }

  let selectedIndex = combatIndexes[0];
  for (const index of combatIndexes) {
    if (events[index].time > time) {
      break;
    }
    selectedIndex = index;
  }
  return selectedIndex;
}
