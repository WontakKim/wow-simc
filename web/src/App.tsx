import { useEffect, useMemo, useRef, useState } from "react";
import {
  AuraSnapshot,
  findEventAtOrBefore,
  parseReplayReport,
  ReplayActor,
  ReplayEvent,
  ReplayReport,
  ReplayValidationError,
  RecordedDuration,
} from "./replay";
import { GenuineModelScene } from "./GenuineModelScene";
import "./styles.css";

const SPEEDS = [0.5, 1, 2] as const;

function formatNumber(value: number | null, maximumFractionDigits = 0) {
  return value === null
    ? "Not recorded"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatSeconds(value: number) {
  return `${value.toFixed(value < 10 ? 2 : 1)}s`;
}

function eventLabel(event: ReplayEvent) {
  return event.kind === "wait" ? `Wait ${formatSeconds(event.wait ?? 0)}` : (event.spellName ?? event.name);
}

function formatDuration(value: RecordedDuration) {
  if (value === null) return "Duration not recorded";
  if (value === "indefinite") return "No scheduled expiration";
  return `${formatSeconds(value)} remains`;
}


function eventAriaLabel(event: ReplayEvent, index: number) {
  const status = event.queueFailed ? ", queue failed" : "";
  return `Event ${index + 1}, ${event.phase}, ${formatSeconds(event.time)}, ${eventLabel(event)}${status}`;
}

function BreakableLabel({ value }: { value: string }) {
  const parts = value.split("_");
  return parts.map((part, index) => (
    <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <>_<wbr /></>}</span>
  ));
}


function AuraList({ entries, missingMessage, emptyMessage }: {
  entries: AuraSnapshot[] | null;
  missingMessage: string;
  emptyMessage: string;
}) {
  if (entries === null) {
    return <p className="empty-state">{missingMessage}</p>;
  }
  if (entries.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }
  return (
    <ul className="state-list">
      {entries.map((entry, index) => (
        <li key={`${entry.id}-${entry.name}-${index}`}>
          <span><strong>{entry.name}</strong><small>Spell {entry.id}</small></span>
          <span className="state-values">{entry.stacks} stack{entry.stacks === 1 ? "" : "s"}<small>{formatDuration(entry.remains)}</small></span>
        </li>
      ))}
    </ul>
  );
}

function StateSnapshot({ event }: { event: ReplayEvent }) {
  const targetDebuffs = event.targets?.flatMap((target) =>
    target.debuffs.map((debuff) => ({ ...debuff, targetName: target.name })),
  ) ?? [];

  return (
    <section className="snapshot-grid" aria-label="Recorded state snapshot">
      <article className="card state-card">
        <div className="card-heading"><h3>Resources</h3><span>At {formatSeconds(event.time)}</span></div>
        {!event.resources?.length ? <p className="empty-state">Resource values were not recorded at this event.</p> : (
          <ul className="resource-list">
            {event.resources.map((resource) => (
              <li key={resource.name}>
                <span>{resource.name.replaceAll("_", " ")}</span>
                <strong>{formatNumber(resource.value, 2)} <small>/ {resource.max === null ? "max not recorded" : formatNumber(resource.max, 2)}</small></strong>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="card state-card">
        <div className="card-heading"><h3>Active buffs</h3><span>Recorded snapshot</span></div>
        <AuraList
          entries={event.buffs}
          missingMessage="Buff snapshot was not recorded at this event."
          emptyMessage="No active buffs were recorded at this snapshot."
        />
      </article>

      <article className="card state-card">
        <div className="card-heading"><h3>Cooldowns down</h3><span>Recorded snapshot</span></div>
        {event.cooldowns === null ? <p className="empty-state">Cooldown snapshot was not recorded at this event.</p> : event.cooldowns.length === 0 ? <p className="empty-state">No cooldowns were down at this snapshot.</p> : (
          <ul className="state-list">
            {event.cooldowns.map((cooldown, index) => (
              <li key={`${cooldown.id}-${cooldown.name}-${index}`}>
                <span><strong>{cooldown.name}</strong><small>Spell {cooldown.id}</small></span>
                <span className="state-values">Configured max charges: {cooldown.maxCharges}<small>{formatSeconds(cooldown.remains)} remains</small></span>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="card state-card">
        <div className="card-heading"><h3>Target debuffs</h3><span>Recorded snapshot</span></div>
        {event.targets === null ? <p className="empty-state">Target debuff snapshot was not recorded at this event.</p> : targetDebuffs.length === 0 ? <p className="empty-state">No active target debuffs were recorded at this snapshot.</p> : (
          <ul className="state-list">
            {targetDebuffs.map((debuff, index) => (
              <li key={`${debuff.targetName}-${debuff.id}-${index}`}>
                <span><strong>{debuff.name}</strong><small>{debuff.targetName} · Spell {debuff.id}</small></span>
                <span className="state-values">{debuff.stacks} stack{debuff.stacks === 1 ? "" : "s"}<small>{formatDuration(debuff.remains)}</small></span>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

function Timeline({ actor, selectedIndex, cursor, onSelect }: {
  actor: ReplayActor;
  selectedIndex: number;
  cursor: number;
  onSelect: (index: number) => void;
}) {
  const combatEvents = actor.events.flatMap((event, index) => event.phase === "combat" ? [{ event, index }] : []);
  const precombatEvents = actor.events.flatMap((event, index) => event.phase === "precombat" ? [{ event, index }] : []);
  const maxTime = Math.max(0, ...combatEvents.map(({ event }) => event.time));
  const plotDuration = Math.max(maxTime, 0.001);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const firstPrecombatTime = precombatEvents[0]?.event.time ?? 0;
  const lastPrecombatTime = precombatEvents.at(-1)?.event.time ?? firstPrecombatTime;
  const precombatTimeLabel = firstPrecombatTime === lastPrecombatTime
    ? formatSeconds(firstPrecombatTime)
    : `${formatSeconds(firstPrecombatTime)} to ${formatSeconds(lastPrecombatTime)}`;

  return (
    <figure className="card timeline-card" aria-labelledby="timeline-title">
      <div className="card-heading timeline-heading">
        <div>
          <h2 id="timeline-title">Recorded event timeline</h2>
          <p>Combat marks use source timestamps. Focus or hover a mark for details.</p>
        </div>
        <div className="timeline-key" aria-label="Timeline key">
          <span><i className="key-action" />Action</span>
          <span><i className="key-wait" />Wait</span>
          <span><i className="key-failed" />Queue failed</span>
        </div>
      </div>

      {precombatEvents.length > 0 && (
        <div className="precombat-lane">
          <div className="lane-label"><strong>Precombat</strong><span>Source order · {precombatTimeLabel}</span></div>
          <div className="precombat-events">
            {precombatEvents.map(({ event, index }) => (
              <button
                className={`precombat-event ${selectedIndex === index ? "is-selected" : ""}`}
                key={event.key}
                type="button"
                aria-label={eventAriaLabel(event, index).replace("Event ", "Timeline mark ")}
                aria-pressed={selectedIndex === index}
                onClick={() => onSelect(index)}
              >
                <span>{event.phaseIndex + 1}</span>{eventLabel(event)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="combat-lane">
        <div className="lane-label"><strong>Combat</strong><span>0.00s to {formatSeconds(maxTime)}</span></div>
        <div className="timeline-plot">
          {ticks.map((tick) => (
            <div className="axis-tick" key={tick} style={{ left: `${tick * 100}%` }}>
              <i />
              <span>{formatSeconds(maxTime * tick)}</span>
            </div>
          ))}
          <div className="playback-cursor" aria-hidden="true" style={{ left: `${Math.min(100, (cursor / plotDuration) * 100)}%` }} />
          {combatEvents.map(({ event, index }) => {
            const position = (event.time / plotDuration) * 100;
            const lane = event.phaseIndex % 3;
            return (
              <button
                className={`event-hit-target event-${event.kind} ${event.queueFailed ? "is-failed" : ""} ${selectedIndex === index ? "is-selected" : ""}`}
                key={event.key}
                type="button"
                style={{ left: `${position}%`, top: `${22 + lane * 26}px` }}
                aria-label={eventAriaLabel(event, index).replace("Event ", "Timeline mark ")}
                aria-pressed={selectedIndex === index}
                onClick={() => onSelect(index)}
              >
                <i aria-hidden="true" />
                <span className="mark-tooltip" role="tooltip">
                  <strong>{eventLabel(event)}</strong>
                  <small>{formatSeconds(event.time)} · {event.id === null ? "No spell ID" : `Spell ${event.id}`}{event.queueFailed ? " · Queue failed" : ""}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <figcaption>Each mark is a recorded action or wait entry, not inferred damage or a decision explanation.</figcaption>
    </figure>
  );
}

function EventTable({ actor, selectedIndex, onSelect }: {
  actor: ReplayActor;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <section className="card event-table-card" aria-labelledby="event-table-title">
      <div className="card-heading">
        <div><h2 id="event-table-title">All recorded events</h2><p>Table alternative · source phase and order preserved</p></div>
        <span>{actor.events.length} entries</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Order</th><th scope="col">Phase</th><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Spell ID</th><th scope="col">Target</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {actor.events.map((event, index) => (
              <tr key={event.key} className={selectedIndex === index ? "is-selected" : ""}>
                <td>{index + 1}</td>
                <td>{event.phase}</td>
                <td>{formatSeconds(event.time)}</td>
                <td><button type="button" aria-label={eventAriaLabel(event, index)} aria-pressed={selectedIndex === index} onClick={() => onSelect(index)}>{eventLabel(event)}</button></td>
                <td>{event.id ?? "—"}</td>
                <td>{event.target ?? "—"}</td>
                <td>{event.queueFailed ? <span className="status-failed"><i aria-hidden="true">!</i> Queue failed</span> : event.kind === "wait" ? "Wait record" : "Recorded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function App() {
  const [report, setReport] = useState<ReplayReport | null>(null);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [message, setMessage] = useState("Loading bundled reference…");
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const lastFrameRef = useRef<number | null>(null);
  const referenceRequestRef = useRef(0);

  const actor = report?.actors.find((candidate) => candidate.id === selectedActorId) ?? null;
  const selectedEvent = actor?.events[selectedIndex] ?? null;
  const maxTime = actor ? Math.max(0, ...actor.events.filter((event) => event.phase === "combat").map((event) => event.time)) : 0;

  const dpsSampleLabel = useMemo(() => {
    if (!actor || actor.aggregateDpsSamples === null) return "DPS sample count not recorded";
    return `Aggregate across ${formatNumber(actor.aggregateDpsSamples)} sample${actor.aggregateDpsSamples === 1 ? "" : "s"}`;
  }, [actor]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!isPlaying || !actor) {
      lastFrameRef.current = null;
      return;
    }

    let frameId = 0;
    const advance = (now: number) => {
      const previous = lastFrameRef.current ?? now;
      const nextCursor = Math.min(maxTime, cursor + ((now - previous) / 1000) * speed);
      lastFrameRef.current = now;
      setCursor(nextCursor);
      setSelectedIndex(findEventAtOrBefore(actor.events, nextCursor));
      if (nextCursor >= maxTime) {
        setIsPlaying(false);
        return;
      }
      frameId = requestAnimationFrame(advance);
    };
    frameId = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frameId);
  }, [actor, cursor, isPlaying, maxTime, speed]);

  const resetSelection = (nextActor: ReplayActor | null) => {
    setIsPlaying(false);
    setSelectedIndex(0);
    setCursor(nextActor?.events[0]?.time ?? 0);
  };

  const applyReport = (nextReport: ReplayReport) => {
    setReport(nextReport);
    const onlyActor = nextReport.actors.length === 1 ? nextReport.actors[0] : null;
    setSelectedActorId(onlyActor?.id ?? null);
    resetSelection(onlyActor);
    setError(null);
    setMessage("Loaded bundled Elemental Shaman reference.");
  };

  const loadText = (text: string) => {
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new ReplayValidationError("The bundled reference is not valid JSON.");
    }
    applyReport(parseReplayReport(input));
  };

  const loadReference = async () => {
    const requestId = ++referenceRequestRef.current;
    setError(null);
    setMessage("Loading bundled reference…");
    try {
      const response = await fetch("/fixture/elemental-shaman-replay.json");
      if (requestId !== referenceRequestRef.current) return;
      if (!response.ok) throw new Error(`Reference request failed with status ${response.status}.`);
      const text = await response.text();
      if (requestId !== referenceRequestRef.current) return;
      loadText(text);
    } catch (caught) {
      if (requestId !== referenceRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : "The bundled reference could not be loaded.");
      setMessage("Reference unavailable. The genuine model scene remains available.");
    }
  };

  useEffect(() => {
    void loadReference();
    return () => {
      referenceRequestRef.current += 1;
    };
  }, []);

  const selectActor = (id: string) => {
    const nextActor = report?.actors.find((candidate) => candidate.id === id) ?? null;
    setSelectedActorId(nextActor?.id ?? null);
    resetSelection(nextActor);
  };

  const selectEvent = (index: number) => {
    if (!actor || index < 0 || index >= actor.events.length) return;
    setIsPlaying(false);
    setSelectedIndex(index);
    setCursor(actor.events[index].time);
  };

  const seek = (time: number) => {
    if (!actor) return;
    setIsPlaying(false);
    setCursor(time);
    setSelectedIndex(findEventAtOrBefore(actor.events, time));
  };

  useEffect(() => {
    const navigateWithArrowKeys = (event: KeyboardEvent) => {
      if (!actor || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      if (event.defaultPrevented || event.target instanceof HTMLCanvasElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      selectEvent(Math.max(0, Math.min(actor.events.length - 1, selectedIndex + (event.key === "ArrowLeft" ? -1 : 1))));
    };
    window.addEventListener("keydown", navigateWithArrowKeys);
    return () => window.removeEventListener("keydown", navigateWithArrowKeys);
  }, [actor, selectedIndex]);

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="SimC Replay home"><i aria-hidden="true" />SimC Replay</a>
        <div className="privacy-note">Local browser inspection · no upload</div>
        <button className="theme-toggle" type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>
          <span aria-hidden="true">{theme === "light" ? "Dark" : "Light"}</span>
        </button>
      </header>

      <div id="top" className="page-shell">
        <section className="model-intro">
          <div>
            <p className="eyebrow">Local genuine-model proof</p>
            <h1>Two genuine models. One WebGL scene.</h1>
            <p>A default Vulpera and a training dummy exported from WoW data with wow.export, rendered together from local files without recreating a private character.</p>
          </div>
          <dl className="model-provenance">
            <div><dt>Character</dt><dd>Default Vulpera · Type 1 · no equipment</dd></div>
            <div><dt>Target</dt><dd>Training Dummy · Creature 109595</dd></div>
            <div><dt>Source</dt><dd>wow.export 0.2.19 · Retail 12.1.0.69933</dd></div>
          </dl>
        </section>

        <GenuineModelScene />

        <section className="intro replay-intro" aria-labelledby="trace-inspector-title">
          <div>
            <p className="eyebrow">Secondary sampled trace inspector</p>
            <h2 id="trace-inspector-title">Inspect what SimC recorded.</h2>
            <p>The bundled reference opens automatically for recorded-state inspection. The trace is independent of the manual animation preview above; this tool does not simulate, optimize, infer damage, or explain why an action was chosen.</p>
          </div>
          <div className="reference-note">
            <strong>Built-in reference</strong>
            <span>Elemental Shaman · official MID2 profile</span>
            <small>Same-origin fixture · report schema 2.0.0</small>
          </div>
        </section>

        <div className="load-status" role="status">{message}</div>
        {error && (
          <div className="error-banner" role="alert">
            <strong>Could not load reference.</strong>
            <span>{error}</span>
            <button className="retry-button" type="button" onClick={loadReference}>Retry loading reference</button>
          </div>
        )}

        {report && report.actors.length > 1 && (
          <section className="actor-picker card">
            <label htmlFor="actor-select">Trace actor</label>
            <select id="actor-select" value={selectedActorId ?? ""} onChange={(event) => selectActor(event.target.value)}>
              <option value="">Choose an actor</option>
              {report.actors.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.specialization ?? "Specialization not recorded"}</option>)}
            </select>
            {!actor && <p>Choose one of {report.actors.length} actors. Their state snapshots are never combined.</p>}
          </section>
        )}

        {report && actor && selectedEvent && (
          <>
            <section className="replay-heading">
              <div>
                <p className="eyebrow">{actor.specialization ?? "Specialization not recorded"}</p>
                <h2><BreakableLabel value={actor.name} /></h2>
                <p>Sampled action trace · {report.simulationIterations === null ? "Sampled iteration not recorded" : `Sampled iteration ${report.simulationIterations > 1 ? 1 : 0}`}. It is not the highest, optimal, or representative result.</p>
              </div>
              <dl className="report-meta">
                <div><dt>Engine</dt><dd>{report.engineVersion}</dd></div>
                <div><dt>Environment</dt><dd>{report.environment ?? "Not recorded"} {report.gameVersion ? `· ${report.gameVersion}` : ""}</dd></div>
                <div><dt>Report schema</dt><dd>{report.reportVersion}</dd></div>
                <div><dt>Revision</dt><dd title={report.gitRevision ?? undefined}>{report.gitRevision?.slice(0, 10) ?? "Not recorded"}</dd></div>
                <div><dt>Generated</dt><dd>{report.timestamp ?? "Not recorded"}</dd></div>
                <div><dt>PTR compiled support</dt><dd>{report.ptrCompiledSupport === null ? "Not recorded" : report.ptrCompiledSupport ? "Yes" : "No"}</dd></div>
              </dl>
            </section>

            <section className="metric-grid" aria-label="Report overview">
              <article className="metric-card"><span>Mean DPS</span><strong>{formatNumber(actor.aggregateDps, 0)}</strong><small>{dpsSampleLabel}</small></article>
              <article className="metric-card"><span>Mean fight length</span><strong>{actor.fightLength === null ? "—" : formatSeconds(actor.fightLength)}</strong><small>Aggregate report metric</small></article>
              <article className="metric-card"><span>Trace entries</span><strong>{formatNumber(actor.events.length)}</strong><small>Precombat + combat sample</small></article>
              <article className="metric-card"><span>Selected snapshot</span><strong>{formatSeconds(selectedEvent.time)}</strong><small>Playback cursor {formatSeconds(cursor)}</small></article>
            </section>

            <section className="transport card" aria-label="Replay controls">
              <button type="button" onClick={() => selectEvent(selectedIndex - 1)} disabled={selectedIndex === 0} aria-label="Previous event">Previous</button>
              <button className="play-button" type="button" onClick={() => {
                if (cursor >= maxTime) seek(0);
                setIsPlaying(!isPlaying);
              }} disabled={maxTime === 0}>{isPlaying ? "Pause" : "Play"}</button>
              <button type="button" onClick={() => selectEvent(selectedIndex + 1)} disabled={selectedIndex === actor.events.length - 1} aria-label="Next event">Next</button>
              <button type="button" onClick={() => selectEvent(0)}>Reset</button>
              <label className="speed-control">Speed<select value={speed} onChange={(event) => setSpeed(Number(event.target.value) as (typeof SPEEDS)[number])}>{SPEEDS.map((value) => <option value={value} key={value}>{value}×</option>)}</select></label>
              <label className="seek-control"><span>Seek</span><input aria-label="Seek playback" type="range" min="0" max={Math.max(maxTime, 0.001)} step="0.01" value={cursor} onChange={(event) => seek(Number(event.target.value))} /><output>{formatSeconds(cursor)}</output></label>
            </section>

            <Timeline actor={actor} selectedIndex={selectedIndex} cursor={cursor} onSelect={selectEvent} />

            <section className="selected-event card" data-testid="selected-event" aria-labelledby="selected-event-title">
              <div className="event-index"><span>{selectedEvent.phase}</span><strong>{selectedIndex + 1}</strong><small>of {actor.events.length}</small></div>
              <div className="event-copy">
                <p className="eyebrow">Recorded snapshot at {formatSeconds(selectedEvent.time)} · cursor {formatSeconds(cursor)}</p>
                <h2 id="selected-event-title">{eventLabel(selectedEvent)}</h2>
                <div className="event-tags">
                  {selectedEvent.id !== null && <span>Spell {selectedEvent.id}</span>}
                  {selectedEvent.target && <span>Target: {selectedEvent.target}</span>}
                  {selectedEvent.kind === "wait" && <span>Wait duration: {formatSeconds(selectedEvent.wait ?? 0)}</span>}
                  {selectedEvent.queueFailed && <span className="status-failed"><i aria-hidden="true">!</i> Queue failed</span>}
                </div>
              </div>
            </section>

            <StateSnapshot event={selectedEvent} />

            {report.diagnostics.length > 0 && (
              <section className="diagnostic-card card" aria-labelledby="diagnostic-title">
                <div className="card-heading"><div><h2 id="diagnostic-title">Engine diagnostics</h2><p>Copied from the imported report</p></div><span>{report.diagnostics.length}</span></div>
                <ul>{report.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.level}-${index}`}><strong>{diagnostic.level.replaceAll("_", " ")}</strong><span>{diagnostic.message}</span></li>)}</ul>
              </section>
            )}

            <EventTable actor={actor} selectedIndex={selectedIndex} onSelect={selectEvent} />
          </>
        )}
      </div>
    </main>
  );
}
