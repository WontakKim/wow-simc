#!/usr/bin/env node
// Pins the creature display and one exterior LightData sample. Source CSVs are
// build-pinned by SHA-256; the preview stage is not a claim about fight location.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDb2Csv } from "./prepare-vulpera-appearance.mjs";

const BUILD = "12.1.0.69933";
const TABLES = ["CreatureDisplayInfo", "CreatureModelData", "CreatureDisplayInfoGeosetData", "Light", "LightParams", "LightData"];
const OUTPUT = resolve(import.meta.dirname, "../web/src/previewStage.json");
const digest = (text) => createHash("sha256").update(text).digest("hex");

export function resolvePreviewStage(db, sourceHashes) {
  const row = (table, id) => {
    const value = db[table].find((entry) => Number(entry.ID) === id);
    if (!value) throw new Error(`${table} ${id} is missing from build ${BUILD}.`);
    return value;
  };
  const display = row("CreatureDisplayInfo", 3019);
  const model = row("CreatureModelData", Number(display.ModelID));
  const light = row("Light", 1); // Azeroth (ContinentID 0), default exterior at origin.
  const params = row("LightParams", Number(light.LightParamsID_0));
  const data = db.LightData.find((entry) => Number(entry.LightParamID) === Number(params.ID) && Number(entry.Time) === 1440);
  if (!data) throw new Error(`LightData for LightParams ${params.ID} at time 1440 is missing.`);
  if (Number(light.ContinentID) !== 0 || ["GameCoords_0", "GameCoords_1", "GameCoords_2"].some((key) => Number(light[key]) !== 0)) {
    throw new Error("Light 1 is no longer the Azeroth default exterior light.");
  }
  if (Number(model.FileDataID) !== 125259) throw new Error("Training Dummy display no longer maps to M2 125259.");
  const geosets = db.CreatureDisplayInfoGeosetData
    .filter((entry) => Number(entry.CreatureDisplayInfoID) === 3019)
    .map((entry) => ({ geosetIndex: Number(entry.GeosetIndex), geosetValue: Number(entry.GeosetValue) }));
  const colorColumns = {
    ambient: "AmbientColor", horizonAmbient: "HorizonAmbientColor", groundAmbient: "GroundAmbientColor",
    direct: "DirectColor", skyTop: "SkyTopColor", skyMiddle: "SkyMiddleColor",
    skyBand1: "SkyBand1Color", skyBand2: "SkyBand2Color", skySmog: "SkySmogColor", skyFog: "SkyFogColor",
  };
  return {
    source: {
      build: BUILD, displayId: 3019, lightId: 1, lightParamsId: Number(params.ID),
      lightDataId: Number(data.ID), time: 1440, csvSha256: sourceHashes,
    },
    creature: {
      modelId: Number(model.ID), fileDataId: Number(model.FileDataID),
      textureVariationFileDataIds: [0, 1, 2, 3].map((index) => Number(display[`TextureVariationFileDataID_${index}`])),
      geosetDataId: Number(model.CreatureGeosetDataID), geosets,
    },
    colors: Object.fromEntries(Object.entries(colorColumns).map(([name, column]) => [name, Number(data[column])])),
    fog: { end: Number(data.FogEnd), scaler: Number(data.FogScaler), density: Number(data.FogDensity) },
  };
}

export async function preparePreviewStage({ fetchText = async (table) => {
  const response = await fetch(`https://wago.tools/db2/${table}/csv?build=${BUILD}`);
  if (!response.ok) throw new Error(`${table} download failed: HTTP ${response.status}`);
  return response.text();
}, outputPath = OUTPUT } = {}) {
  const db = {};
  const hashes = {};
  for (const table of TABLES) {
    const text = await fetchText(table);
    hashes[table] = digest(text);
    db[table] = parseDb2Csv(text);
  }
  const result = resolvePreviewStage(db, hashes);
  const contents = `${JSON.stringify(result, null, 2)}\n`;
  try {
    const previous = await readFile(outputPath, "utf8");
    if (previous !== contents) throw new Error(`Pinned preview stage drift at ${outputPath}; inspect the DB2 build before updating the pin.`);
    console.log(`Verified pinned preview stage (${result.source.lightDataId}).`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(outputPath, contents, { flag: "wx" });
    console.log(`Pinned preview stage at ${outputPath}.`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  preparePreviewStage().catch((error) => { console.error(error); process.exitCode = 1; });
}
