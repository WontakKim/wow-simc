#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDb2Csv } from "./prepare-vulpera-appearance.mjs";

const BUILD = "12.1.0.69933";
const TABLES = ["SpellXSpellVisual", "SpellVisual", "SpellVisualEvent", "SpellVisualKit", "SpellVisualKitEffect", "SpellVisualKitModelAttach", "SpellVisualEffectName", "SpellVisualMissile", "SpellVisualAnim", "AnimKit", "AnimKitSegment"];
const SPELL_IDS = [318038, 192106, 191634, 443454, 1219480, 51505, 188196, 117014, 188389, 285466, 447419, 45284, 120588];
const SOURCE_HASHES = {
  SpellXSpellVisual: "d5f4882c0ba3904e9c8dfe062ea3131e02d4645b706a58cbb75d035b90bd2e6d",
  SpellVisual: "7d5ea43f79492b9487d8d127218f8ff9fad6224eb0477164cdc6d3fda6fa2780",
  SpellVisualEvent: "a706c4aab73753fbc992f784e0e2c8323a88c4a3c13261626ce09f7be0bbfe1e",
  SpellVisualKit: "7a7e0905a655548c88b79cdb3518838bc929f362469814be7ab1ba5226f3746a",
  SpellVisualKitEffect: "8eb0fc9d4389f8e05b80bcd0ae2679499d4d68a42516aca227bf617462f84a9e",
  SpellVisualKitModelAttach: "e95a0b7918ada320261e61f9de1076cb99dca2331d8877d8c6f5aaf4cb7e15f2",
  SpellVisualEffectName: "5c2c0c3d130c1fdaa475ceb548f0d7e8754307339c775192f5e1e86968a4c1f2",
  SpellVisualMissile: "55997511f5d12038e564d9c45ed52f91bacd9144660da3abd163f6afa6e533e1",
  SpellVisualAnim: "0bb3d097c494b6f807d1c6fa8cfd812e65297c0451a8fb5de2ef9e998d23afff",
  AnimKit: "0b233e00a80a7fec7c1a9694cba2a6a70b2a89845c4d1766918c24c2c5f47cda",
  AnimKitSegment: "bc6739a5e4dbc5c7e2c6fc1ed0640b333758f961e73b83217cda818b1daaf0f2",
};
// Preview policy: unresolved condition IDs are retained, not evaluated. These
// branch choices reproduce the source-linked mapped assets; 188196 uses visual
// 156513 (Base-attachment missile). This does not identify the retail branch.
const PREVIEW_VISUALS = { 318038: 152472, 192106: 39810, 191634: 53892, 443454: 152381, 1219480: 105780,
  51505: 182304, 188196: 156513, 117014: 182369, 188389: 182129, 285466: 82366,
  447419: 70637, 45284: 166682, 120588: 166684 };
const OUTPUT = resolve(import.meta.dirname, "../web/src/spellVisualGraph.json");
const digest = (text) => createHash("sha256").update(text).digest("hex");
const numeric = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));

export function resolveSpellVisualGraph(db, previewVisuals = PREVIEW_VISUALS, spellIds = SPELL_IDS) {
  const index = (table) => {
    if (!db[table]) throw new Error(`Missing required DB2 table ${table}`);
    return new Map(db[table].map((row) => [Number(row.ID), row]));
  };
  const required = (table, id, rows) => {
    const row = rows.get(id);
    if (!row) throw new Error(`${table} ${id} referenced by the selected graph is missing`);
    return numeric(row);
  };
  const visualRows = index("SpellVisual");
  const kitRows = index("SpellVisualKit");
  const attachRows = index("SpellVisualKitModelAttach");
  const nameRows = index("SpellVisualEffectName");
  const animRows = index("SpellVisualAnim");
  const animKitRows = index("AnimKit");
  for (const table of ["SpellXSpellVisual", "SpellVisualEvent", "SpellVisualKitEffect", "SpellVisualMissile", "AnimKitSegment"]) {
    if (!db[table]) throw new Error(`Missing required DB2 table ${table}`);
  }
  const animKit = (id) => id > 0 ? { ...required("AnimKit", id, animKitRows),
    segments: db.AnimKitSegment.filter((row) => Number(row.ParentAnimKitID) === id)
      .map(numeric).sort((a, b) => a.OrderIndex - b.OrderIndex || a.ID - b.ID) } : null;
  const effectName = (id) => id > 0 ? required("SpellVisualEffectName", id, nameRows) : null;
  const kit = (id) => {
    const data = required("SpellVisualKit", id, kitRows);
    return { ...data, effects: db.SpellVisualKitEffect.filter((row) => Number(row.ParentSpellVisualKitID) === id)
      .map((row) => {
        const effect = numeric(row);
        if (effect.EffectType === 2) {
          const modelAttach = required("SpellVisualKitModelAttach", effect.Effect, attachRows);
          return { ...effect, modelAttach: { ...modelAttach,
            effectName: effectName(modelAttach.SpellVisualEffectNameID), animKit: animKit(modelAttach.AnimKitID) } };
        }
        if (effect.EffectType === 6) {
          const visualAnim = required("SpellVisualAnim", effect.Effect, animRows);
          return { ...effect, visualAnim: { ...visualAnim, animKit: animKit(visualAnim.AnimKitID) } };
        }
        return effect;
      }) };
  };
  const spells = {};
  const visuals = {};
  for (const spellId of spellIds) {
    const alternatives = db.SpellXSpellVisual.filter((row) => Number(row.SpellID) === spellId).map(numeric);
    if (!alternatives.length) throw new Error(`Spell ${spellId} has no SpellXSpellVisual alternatives`);
    const selectedVisualId = previewVisuals[spellId];
    if (!alternatives.some((row) => row.SpellVisualID === selectedVisualId)) {
      throw new Error(`Spell ${spellId}: preview visual ${selectedVisualId} is not an alternative`);
    }
    spells[spellId] = { alternatives, selectedVisualId };
    for (const { SpellVisualID: visualId } of alternatives) {
      if (visuals[visualId]) continue;
      const visual = required("SpellVisual", visualId, visualRows);
      visuals[visualId] = { ...visual,
        stateKit: visual.StateKit > 0 ? kit(visual.StateKit) : null,
        events: db.SpellVisualEvent.filter((row) => Number(row.SpellVisualID) === visualId)
          .map((row) => ({ ...numeric(row), kit: kit(Number(row.SpellVisualKitID)) })),
        missiles: db.SpellVisualMissile.filter((row) => visual.SpellVisualMissileSetID > 0
          && Number(row.SpellVisualMissileSetID) === visual.SpellVisualMissileSetID)
          .map((row) => { const missile = numeric(row); return { ...missile,
            effectName: effectName(missile.SpellVisualEffectNameID), animKit: animKit(missile.AnimKitID) }; }),
      };
    }
  }
  return { spells, visuals };
}

export async function prepareSpellVisuals({ fetchText = async (table) => {
  const response = await fetch(`https://wago.tools/db2/${table}/csv?build=${BUILD}`);
  if (!response.ok) throw new Error(`${table} DB2 fetch failed: HTTP ${response.status}`);
  return response.text();
}, output = OUTPUT } = {}) {
  const db = {};
  const sourceHashes = {};
  for (const table of TABLES) {
    const text = await fetchText(table);
    sourceHashes[table] = digest(text);
    if (sourceHashes[table] !== SOURCE_HASHES[table]) {
      throw new Error(`${table} ${BUILD} CSV SHA-256 mismatch: expected ${SOURCE_HASHES[table]}, received ${sourceHashes[table]}`);
    }
    db[table] = parseDb2Csv(text);
  }
  const graph = { build: BUILD, sourceHashes, previewPolicy: "Explicit preview visual IDs; unresolved player/unit conditions and probabilities are not evaluated", ...resolveSpellVisualGraph(db) };
  await writeFile(output, `${JSON.stringify(graph, null, 2)}\n`);
  return graph;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const cache = process.argv[2];
  prepareSpellVisuals(cache ? { fetchText: (table) => readFile(resolve(cache, `${table}.csv`), "utf8") } : {})
    .then((graph) => console.log(`Prepared ${Object.keys(graph.spells).length} spells, ${Object.keys(graph.visuals).length} visuals for ${graph.build}`))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
