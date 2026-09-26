/**
 * Resolves and prepares the native Vulpera male (ChrModel 69) customization
 * appearance: DB2 join graph (ported from wow.export's DBCharacterCustomization,
 * MIT licensed) -> tracked choice manifest -> composited texture atlas plan ->
 * pinned BLP downloads.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BUILD = "12.1.0.69933";
const WAGO_DB2_BASE_URL = "https://wago.tools/db2";
const WAGO_CASC_BASE_URL = "https://wago.tools/api/casc";
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const SKIN_TEXTURE_TYPES = new Set([1, 8]); // composited into the atlases; everything else binds directly

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_OUTPUT_JSON_PATH = join(REPOSITORY_ROOT, "web/src/vulperaAppearance.json");
const DEFAULT_MANIFEST_PATH = join(REPOSITORY_ROOT, "web/src/nativeModelManifest.json");
const DEFAULT_MODEL_OUTPUT_DIRECTORY = join(REPOSITORY_ROOT, "web/public/model/native-models");
const DEFAULT_CSV_CACHE_DIRECTORY = join(REPOSITORY_ROOT, "web/public/model/db2");

export const DB2_TABLES = [
  "ChrModel",
  "ChrRaceXChrModel",
  "ChrCustomizationOption",
  "ChrCustomizationChoice",
  "ChrCustomizationElement",
  "ChrCustomizationMaterial",
  "ChrCustomizationGeoset",
  "ChrModelTextureLayer",
  "ChrModelMaterial",
  "CharComponentTextureSections",
  "TextureFileData",
];

/**
 * The tracked appearance choice manifest. Explicit choices are verified by
 * hand; every other non-0x20 option falls back to the lowest-OrderIndex
 * choice (the policy wow.export uses to build a default appearance).
 */
export const VULPERA_APPEARANCE_REQUEST = {
  chrModelId: 69,
  explicitChoices: { 336: 3323, 852: 9541, 854: 9581 },
};

/** RFC-4180 field splitter: quoted fields may contain commas and "" escapes. */
function splitCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current);
  return fields;
}

export function parseDb2Csv(text) {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 2) throw new Error("DB2 CSV must have a header row and at least one data row.");
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    header.forEach((column, index) => {
      row[column] = values[index] ?? "";
    });
    return row;
  });
}

const number = (value) => Number(value);

function rowIndexes(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const id = number(row[key]);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

/**
 * Joins the parsed DB2 tables into the appearance description the browser
 * consumes. Ported from wow.export's DBCharacterCustomization build (MIT).
 */
export function resolveAppearance(db, request = VULPERA_APPEARANCE_REQUEST) {
  const chrModelId = request.chrModelId;
  const chrModel = db.ChrModel.find((row) => number(row.ID) === chrModelId);
  if (!chrModel) {
    throw new Error(`ChrModel ${chrModelId} is missing from the ChrModel table.`);
  }
  const layoutId = number(chrModel.CharComponentTextureLayoutID);
  if (!layoutId) throw new Error(`ChrModel ${chrModelId} has no CharComponentTextureLayoutID.`);

  const options = db.ChrCustomizationOption
    .filter((row) => number(row.ChrModelID) === chrModelId)
    .map((row) => ({
      id: number(row.ID),
      name: row.Name_lang,
      orderIndex: number(row.OrderIndex),
      excludedFromDefaults: (number(row.Flags) & 0x20) !== 0,
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
  const optionById = new Map(options.map((option) => [option.id, option]));

  const choicesByOption = rowIndexes(db.ChrCustomizationChoice, "ChrCustomizationOptionID");
  const choiceById = new Map(db.ChrCustomizationChoice.map((row) => [number(row.ID), row]));

  const explicitChoices = request.explicitChoices ?? {};
  const selection = [];
  for (const option of options) {
    const explicitChoiceId = explicitChoices[option.id];
    if (explicitChoiceId !== undefined) {
      const choice = choiceById.get(explicitChoiceId);
      if (!choice || number(choice.ChrCustomizationOptionID) !== option.id) {
        throw new Error(`explicit choice ${explicitChoiceId} for option ${option.id} is not a ChrCustomizationChoice of that option.`);
      }
    }
    if (option.excludedFromDefaults && explicitChoiceId === undefined) continue;
    const choices = (choicesByOption.get(option.id) ?? [])
      .map((row) => ({ id: number(row.ID), orderIndex: number(row.OrderIndex) }))
      .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
    if (choices.length === 0) continue;
    const selected = explicitChoiceId !== undefined ? choices.find((choice) => choice.id === explicitChoiceId) : choices[0];
    selection.push({
      optionId: option.id,
      optionName: option.name,
      choiceId: selected.id,
      choiceName: choiceById.get(selected.id)?.Name_lang ?? "",
      source: explicitChoiceId !== undefined ? "explicit" : "default",
    });
  }
  const selectedChoiceIds = new Set(selection.map((entry) => entry.choiceId));

  // Geosets: every choice of a controlled option contributes its mesh parts to
  // the family; the selected choice's parts are the visible ones.
  // DB2 optional foreign keys: absent, empty or 0 all mean "no reference".
  const optionalNumber = (value) => {
    if (value === undefined || value === "" || value === "0") return null;
    return Number(value);
  };
  const elements = db.ChrCustomizationElement.map((row) => ({
    id: number(row.ID),
    choiceId: number(row.ChrCustomizationChoiceID),
    relatedChoiceId: optionalNumber(row.RelatedChrCustomizationChoiceID),
    geosetId: optionalNumber(row.ChrCustomizationGeosetID),
    materialId: optionalNumber(row.ChrCustomizationMaterialID),
  }));
  const geosetById = new Map(db.ChrCustomizationGeoset.map((row) => [number(row.ID), row]));
  const meshPartId = (geoset) => number(geoset.GeosetType) * 100 + number(geoset.GeosetID);
  const choicesByOptionIds = new Map([...choicesByOption.entries()].map(([optionId, rows]) =>
    [optionId, rows.map((row) => number(row.ID))]));

  const families = [];
  for (const entry of selection) {
    const memberChoiceIds = choicesByOptionIds.get(entry.optionId) ?? [];
    const familyParts = new Set();
    const selectedParts = [];
    for (const memberChoiceId of memberChoiceIds) {
      for (const element of elements) {
        if (element.choiceId !== memberChoiceId || element.geosetId === null) continue;
        const geoset = geosetById.get(element.geosetId);
        if (!geoset) continue;
        const partId = meshPartId(geoset);
        familyParts.add(partId);
        if (memberChoiceId === entry.choiceId) selectedParts.push(partId);
      }
    }
    if (familyParts.size === 0) continue;
    families.push({
      optionId: entry.optionId,
      selectedChoiceId: entry.choiceId,
      meshPartIds: [...familyParts].sort((a, b) => a - b),
      selectedMeshPartIds: [...new Set(selectedParts)].sort((a, b) => a - b),
    });
  }
  const enabledMeshPartIds = [...new Set(families.flatMap((family) => family.selectedMeshPartIds))].sort((a, b) => a - b);

  // Texture joins: target -> layer (keyed by layout + first target column, as
  // in wow.export), material sizes, sections in CSV order.
  const layerByLayoutTarget = new Map(db.ChrModelTextureLayer
    .filter((row) => number(row.CharComponentTextureLayoutsID) === layoutId)
    .map((row) => [`${layoutId}-${number(row.ChrModelTextureTargetID_0)}`, row]));
  const materialSizeByType = new Map(db.ChrModelMaterial
    .filter((row) => number(row.CharComponentTextureLayoutsID) === layoutId)
    .map((row) => [number(row.TextureType), { width: number(row.Width), height: number(row.Height) }]));
  const atlasSizes = [...materialSizeByType.entries()]
    .map(([textureType, size]) => ({ textureType, ...size }))
    .sort((a, b) => a.textureType - b.textureType);
  const sections = db.CharComponentTextureSections
    .filter((row) => number(row.CharComponentTextureLayoutID) === layoutId);

  // TextureFileData: UsageType 0 only, last row wins per resource.
  const fileDataByResource = new Map();
  for (const row of db.TextureFileData) {
    if (number(row.UsageType) !== 0) continue;
    fileDataByResource.set(number(row.MaterialResourcesID), number(row.FileDataID));
  }
  const resolveFileDataId = (resourceId) => {
    const fileDataId = fileDataByResource.get(resourceId) ?? 0;
    if (fileDataId === 0) {
      throw new Error(`MaterialResourcesID ${resourceId} resolves to FileDataID 0 (no UsageType 0 TextureFileData row).`);
    }
    return fileDataId;
  };

  const materialById = new Map(db.ChrCustomizationMaterial.map((row) => [number(row.ID), row]));
  const atlasOperations = [];
  const directTextures = [];
  const skippedMaterials = [];
  for (const element of elements) {
    if (element.materialId === null || !selectedChoiceIds.has(element.choiceId)) continue;
    if (element.relatedChoiceId !== null && !selectedChoiceIds.has(element.relatedChoiceId)) {
      skippedMaterials.push({
        materialId: element.materialId,
        reason: `related choice ${element.relatedChoiceId} is not part of the selection`,
        relatedChoiceId: element.relatedChoiceId,
      });
      continue;
    }
    const material = materialById.get(element.materialId);
    if (!material) {
      throw new Error(`ChrCustomizationMaterial ${element.materialId} (element ${element.id}) is missing from the table.`);
    }
    const targetId = number(material.ChrModelTextureTargetID);
    const layer = layerByLayoutTarget.get(`${layoutId}-${targetId}`);
    if (!layer) {
      skippedMaterials.push({
        materialId: element.materialId,
        reason: `no ChrModelTextureLayer for layout ${layoutId} target ${targetId}`,
        relatedChoiceId: element.relatedChoiceId,
      });
      continue;
    }
    const textureType = number(layer.TextureType);
    const sourceFileDataId = resolveFileDataId(number(material.MaterialResourcesID));
    const common = {
      elementId: element.id,
      choiceId: element.choiceId,
      materialId: element.materialId,
      targetId,
      relatedChoiceId: element.relatedChoiceId,
      sourceFileDataId,
      textureType,
    };
    if (!SKIN_TEXTURE_TYPES.has(textureType)) {
      // Non-skin layers bind their source directly to the replaceable slot.
      directTextures.push(common);
      continue;
    }
    const size = materialSizeByType.get(textureType);
    if (!size) {
      skippedMaterials.push({
        materialId: element.materialId,
        reason: `no ChrModelMaterial for layout ${layoutId} texture type ${textureType}`,
        relatedChoiceId: element.relatedChoiceId,
      });
      continue;
    }
    const mask = number(layer.TextureSectionTypeBitMask);
    let destination;
    if (mask === -1) {
      destination = { x: 0, y: 0, width: size.width, height: size.height };
    } else {
      const section = sections.find((row) => (2 ** number(row.SectionType)) & mask);
      if (!section) {
        skippedMaterials.push({
          materialId: element.materialId,
          reason: `no CharComponentTextureSection matches the layer mask ${mask}`,
          relatedChoiceId: element.relatedChoiceId,
        });
        continue;
      }
      destination = {
        x: number(section.X),
        y: number(section.Y),
        width: number(section.Width),
        height: number(section.Height),
      };
    }
    atlasOperations.push({
      ...common,
      layer: number(layer.Layer),
      blendMode: number(layer.BlendMode),
      destination,
    });
  }
  atlasOperations.sort((a, b) => a.targetId - b.targetId || a.layer - b.layer);
  directTextures.sort((a, b) => a.textureType - b.textureType || a.targetId - b.targetId);

  return {
    build: BUILD,
    chrModelId,
    charComponentTextureLayoutId: layoutId,
    choices: selection,
    geosets: { enabledMeshPartIds, families },
    atlasOperations,
    atlasSizes,
    skippedMaterials,
    directTextures,
  };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function validateBlp(bytes, fileDataId) {
  const label = `FileDataID ${fileDataId}`;
  if (bytes.length < 148 || bytes[0] !== 0x42 || bytes[1] !== 0x4c || bytes[2] !== 0x50 || bytes[3] !== 0x32) {
    throw new Error(`${label}: BLP2 magic is missing or truncated.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 1) throw new Error(`${label}: unsupported BLP version.`);
  const encoding = view.getUint8(8);
  if (encoding !== 1 && encoding !== 2) throw new Error(`${label}: unexpected BLP encoding ${encoding}.`);
  if (view.getUint32(12, true) === 0 || view.getUint16(16, true) === 0) throw new Error(`${label}: BLP dimensions are zero.`);
  const mipOffset = view.getUint32(20, true);
  const mipSize = view.getUint32(84, true);
  if (mipSize === 0 || mipOffset < 148 || mipOffset + mipSize > bytes.length) {
    throw new Error(`${label}: first BLP mip is missing or truncated.`);
  }
}

function verifyAgainstPin(fileDataId, bytes, pin) {
  if (bytes.length !== pin.byteSize) {
    throw new Error(`FileDataID ${fileDataId}: byte size ${bytes.length} does not match the pinned ${pin.byteSize}.`);
  }
  const digest = sha256(bytes);
  if (digest !== pin.sha256) {
    throw new Error(`FileDataID ${fileDataId}: SHA-256 mismatch (pinned ${pin.sha256}, found ${digest}).`);
  }
}

async function readBounded(response, label, limitBytes = MAX_DOWNLOAD_BYTES) {
  if (!response.body) throw new Error(`${label}: response body is missing.`);
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > limitBytes) {
      await reader.cancel();
      throw new Error(`${label}: response exceeds ${limitBytes} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.length === 0) throw new Error(`${label}: downloaded file is empty.`);
  return bytes;
}

function makeWagoFetcher({ fetchImplementation = fetch, attempts = 3, timeoutMs = 60_000 } = {}) {
  const request = async (url, label) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImplementation(url, { signal: controller.signal, redirect: "follow" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
      } catch (error) {
        lastError = error;
        if (attempt === attempts) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`${label}: download failed after ${attempts} attempts (${reason}).`);
  };
  return {
    fetchText: async (table) => {
      const response = await request(`${WAGO_DB2_BASE_URL}/${table}/csv?build=${BUILD}`, `DB2 table ${table}`);
      return new TextDecoder().decode(await readBounded(response, `DB2 table ${table}`));
    },
    fetchFileData: async (fileDataId) => {
      const response = await request(`${WAGO_CASC_BASE_URL}/${fileDataId}?download&version=${BUILD}`, `FileDataID ${fileDataId}`);
      return readBounded(response, `FileDataID ${fileDataId}`);
    },
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Downloads (or verifies from cache) the DB2 CSVs, resolves the Vulpera
 * appearance, downloads the referenced BLPs and emits the tracked
 * vulperaAppearance.json plus appended manifest pins.
 */
export async function prepareVulperaAppearance({
  request = VULPERA_APPEARANCE_REQUEST,
  outputJsonPath = DEFAULT_OUTPUT_JSON_PATH,
  manifestPath = DEFAULT_MANIFEST_PATH,
  modelOutputDirectory = DEFAULT_MODEL_OUTPUT_DIRECTORY,
  csvCacheDirectory = DEFAULT_CSV_CACHE_DIRECTORY,
  fetchText,
  fetchFileData,
  fetchImplementation = fetch,
} = {}) {
  const network = makeWagoFetcher({ fetchImplementation });
  const loadText = fetchText ?? network.fetchText;
  const loadFileData = fetchFileData ?? network.fetchFileData;

  const previous = await readJsonIfExists(outputJsonPath);
  const db2Pins = new Map((previous?.sources?.db2 ?? []).map((pin) => [pin.table, pin.sha256]));

  await mkdir(csvCacheDirectory, { recursive: true });
  const db = {};
  const csvTexts = {};
  for (const table of DB2_TABLES) {
    const cachePath = join(csvCacheDirectory, `${table}.csv`);
    let text = null;
    try {
      text = await readFile(cachePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const expected = db2Pins.get(table);
    if (text !== null && expected !== undefined && sha256(Buffer.from(text, "utf8")) !== expected) {
      throw new Error(`DB2 table ${table}: cached CSV SHA-256 does not match the pin emitted in ${outputJsonPath}; delete the cache to re-fetch.`);
    }
    if (text === null) {
      text = await loadText(table);
      const digest = sha256(Buffer.from(text, "utf8"));
      if (expected !== undefined && digest !== expected) {
        throw new Error(`DB2 table ${table}: downloaded CSV SHA-256 ${digest} does not match the pinned ${expected}.`);
      }
      await writeFile(cachePath, text, { flag: "wx" });
    }
    csvTexts[table] = text;
    db[table] = parseDb2Csv(text);
  }

  const appearance = resolveAppearance(db, request);

  const manifest = await readJsonIfExists(manifestPath);
  if (manifest && manifest.build !== BUILD) {
    throw new Error(`manifest build ${manifest.build} does not match the pinned build ${BUILD}.`);
  }
  const assets = manifest?.assets ?? [];
  const pinned = new Map(assets.map((asset) => [asset.fileDataId, asset]));

  const requiredFileDataIds = [
    ...new Set([
      ...appearance.atlasOperations.map((operation) => operation.sourceFileDataId),
      ...appearance.directTextures.map((texture) => texture.sourceFileDataId),
    ]),
  ].sort((a, b) => a - b);

  await mkdir(modelOutputDirectory, { recursive: true });
  const newPins = [];
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "prepare-vulpera-appearance-"));
  try {
    for (const fileDataId of requiredFileDataIds) {
      const filename = `${fileDataId}.blp`;
      const destinationPath = join(modelOutputDirectory, filename);
      const pin = pinned.get(fileDataId);
      let bytes = null;
      try {
        bytes = await readFile(destinationPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (bytes !== null && pin) {
        verifyAgainstPin(fileDataId, bytes, pin);
        continue;
      }
      if (bytes === null) {
        bytes = await loadFileData(fileDataId);
        validateBlp(bytes, fileDataId);
        if (pin) verifyAgainstPin(fileDataId, bytes, pin);
        const temporary = join(temporaryDirectory, filename);
        await writeFile(temporary, bytes, { flag: "wx" });
        await rename(temporary, destinationPath);
        console.log(`Prepared ${filename} (${bytes.length} bytes, ${sha256(bytes)})`);
      } else if (!pin) {
        validateBlp(bytes, fileDataId);
      }
      if (!pin) newPins.push({ fileDataId, kind: "blp", byteSize: bytes.length, sha256: sha256(bytes) });
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const contents = `${JSON.stringify({
    ...appearance,
    sources: { db2: DB2_TABLES.map((table) => ({ table, sha256: sha256(Buffer.from(csvTexts[table], "utf8")) })) },
  }, null, 2)}\n`;
  await writeFile(outputJsonPath, contents);
  console.log(`Emitted ${outputJsonPath} (${appearance.atlasOperations.length} atlas operations, `
    + `${appearance.directTextures.length} direct textures, ${appearance.skippedMaterials.length} skipped materials).`);

  if (newPins.length > 0) {
    const updatedAssets = [...assets, ...newPins].sort((a, b) => a.fileDataId - b.fileDataId);
    const manifestContents = `${JSON.stringify({
      build: BUILD,
      actors: manifest?.actors ?? [],
      assets: updatedAssets,
    }, null, 2)}\n`;
    await writeFile(manifestPath, manifestContents);
    console.log(`Pinned ${newPins.length} appearance BLPs in ${manifestPath}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareVulperaAppearance().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
