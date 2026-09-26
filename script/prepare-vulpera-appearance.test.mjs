import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DB2_TABLES,
  VULPERA_APPEARANCE_REQUEST,
  parseDb2Csv,
  prepareVulperaAppearance,
  resolveAppearance,
} from "./prepare-vulpera-appearance.mjs";

/**
 * Synthetic DB2 CSV fixture exercising the whole join graph: race -> model ->
 * layout, options/choices/defaults, elements with geosets and materials,
 * related-choice gating, target -> layer -> material, sections, and
 * TextureFileData usage-type filtering.
 */
function csv(rows, header) {
  const columns = header ?? Object.keys(rows[0]);
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => row[column] ?? "").join(","));
  return `${lines.join("\n")}\n`;
}

const SYNTHETIC_DB = {
  ChrModel: csv([
    { ID: 69, Sex: 0, DisplayID: 83913, CharComponentTextureLayoutID: 145 },
  ]),
  ChrRaceXChrModel: csv([
    { ID: 901, ChrRacesID: 35, ChrModelID: 69, Sex: 0 },
  ]),
  ChrCustomizationOption: csv([
    { ID: 336, Name_lang: "Ears", ChrModelID: 69, OrderIndex: 4, Flags: 8 },
    { ID: 338, Name_lang: "Snout", ChrModelID: 69, OrderIndex: 6, Flags: 8 },
    { ID: 331, Name_lang: "Fur Color", ChrModelID: 69, OrderIndex: 2, Flags: 16 },
    { ID: 406, Name_lang: "Face", ChrModelID: 69, OrderIndex: 1, Flags: 0 },
    { ID: 6376, Name_lang: "Eyesight", ChrModelID: 69, OrderIndex: 21, Flags: 32 },
    { ID: 777, Name_lang: "Other Model", ChrModelID: 70, OrderIndex: 0, Flags: 0 },
  ]),
  ChrCustomizationChoice: csv([
    // Ears: explicit choice 3323 is NOT the lowest OrderIndex choice.
    { ID: 3321, ChrCustomizationOptionID: 336, OrderIndex: 0 },
    { ID: 3323, ChrCustomizationOptionID: 336, OrderIndex: 1 },
    // Snout: defaults to the lowest OrderIndex choice 3335.
    { ID: 3336, ChrCustomizationOptionID: 338, OrderIndex: 1 },
    { ID: 3335, ChrCustomizationOptionID: 338, OrderIndex: 0 },
    // Fur Color: three choices; the selected one has three materials.
    { ID: 3304, ChrCustomizationOptionID: 331, OrderIndex: 0 },
    { ID: 3305, ChrCustomizationOptionID: 331, OrderIndex: 1 },
    // Face: one choice; its material element is gated on fur choice 3305.
    { ID: 3313, ChrCustomizationOptionID: 406, OrderIndex: 0 },
    // Eyesight is skipped entirely: Flags 0x20 -> not a default candidate.
    { ID: 45238, ChrCustomizationOptionID: 6376, OrderIndex: 0 },
    // Choice of another model's option must not be picked up.
    { ID: 8001, ChrCustomizationOptionID: 777, OrderIndex: 0 },
  ]),
  ChrCustomizationElement: csv([
    // Explicit header: csv() takes columns from row 0, which would drop the
    // RelatedChrCustomizationChoiceID column the gated element needs.
    // Ears Wanderer: two geoset elements (exporter toggles only the last; the
    // compiled policy enables every geoset of the selected choice).
    { ID: 1018, ChrCustomizationChoiceID: 3321, ChrCustomizationGeosetID: 1779 },
    { ID: 1019, ChrCustomizationChoiceID: 3321, ChrCustomizationGeosetID: 1780 },
    // Ears Compact.
    { ID: 1020, ChrCustomizationChoiceID: 3323, ChrCustomizationGeosetID: 1783 },
    { ID: 1021, ChrCustomizationChoiceID: 3323, ChrCustomizationGeosetID: 1784 },
    // Snout choices.
    { ID: 1030, ChrCustomizationChoiceID: 3335, ChrCustomizationGeosetID: 2316 },
    { ID: 1031, ChrCustomizationChoiceID: 3336, ChrCustomizationGeosetID: 2317 },
    // Fur Color 3304: full-material base (target 1), section overlay (target 13)
    // and a material whose target has no texture layer (target 14).
    { ID: 9710, ChrCustomizationChoiceID: 3304, ChrCustomizationMaterialID: 13474 },
    { ID: 9711, ChrCustomizationChoiceID: 3304, ChrCustomizationMaterialID: 13475 },
    { ID: 9712, ChrCustomizationChoiceID: 3304, ChrCustomizationMaterialID: 13476 },
    // Face 3313: material gated on fur choice 3305 (inactive -> skipped).
    { ID: 9737, ChrCustomizationChoiceID: 3313, RelatedChrCustomizationChoiceID: 3305, ChrCustomizationMaterialID: 13501 },
  ], ["ID", "ChrCustomizationChoiceID", "RelatedChrCustomizationChoiceID", "ChrCustomizationGeosetID", "ChrCustomizationMaterialID"]),
  ChrCustomizationMaterial: csv([
    { ID: 13474, ChrModelTextureTargetID: 1, MaterialResourcesID: 435410 },
    { ID: 13475, ChrModelTextureTargetID: 13, MaterialResourcesID: 435394 },
    { ID: 13476, ChrModelTextureTargetID: 14, MaterialResourcesID: 435402 },
    { ID: 13501, ChrModelTextureTargetID: 5, MaterialResourcesID: 435346 },
  ]),
  ChrCustomizationGeoset: csv([
    { ID: 1779, GeosetType: 2, GeosetID: 2 },
    { ID: 1780, GeosetType: 1, GeosetID: 0 },
    { ID: 1783, GeosetType: 1, GeosetID: 0 },
    { ID: 1784, GeosetType: 2, GeosetID: 3 },
    { ID: 2316, GeosetType: 41, GeosetID: 2 },
    { ID: 2317, GeosetType: 41, GeosetID: 3 },
  ]),
  ChrModelTextureLayer: csv([
    { ID: 501, TextureType: 1, Layer: 0, BlendMode: 1, TextureSectionTypeBitMask: -1, ChrModelTextureTargetID_0: 1, ChrModelTextureTargetID_1: 0, CharComponentTextureLayoutsID: 145 },
    { ID: 507, TextureType: 1, Layer: 6, BlendMode: 15, TextureSectionTypeBitMask: 32, ChrModelTextureTargetID_0: 13, ChrModelTextureTargetID_1: 0, CharComponentTextureLayoutsID: 145 },
    { ID: 504, TextureType: 1, Layer: 3, BlendMode: 15, TextureSectionTypeBitMask: 512, ChrModelTextureTargetID_0: 4, ChrModelTextureTargetID_1: 0, CharComponentTextureLayoutsID: 145 },
    { ID: 505, TextureType: 1, Layer: 4, BlendMode: 15, TextureSectionTypeBitMask: 1024, ChrModelTextureTargetID_0: 5, ChrModelTextureTargetID_1: 0, CharComponentTextureLayoutsID: 145 },
    // A layer of another layout must not resolve.
    { ID: 600, TextureType: 1, Layer: 0, BlendMode: 1, TextureSectionTypeBitMask: -1, ChrModelTextureTargetID_0: 1, ChrModelTextureTargetID_1: 0, CharComponentTextureLayoutsID: 99 },
  ]),
  ChrModelMaterial: csv([
    { ID: 147, CharComponentTextureLayoutsID: 145, TextureType: 1, Width: 2048, Height: 1024 },
    { ID: 148, CharComponentTextureLayoutsID: 145, TextureType: 6, Width: 512, Height: 256 },
  ]),
  CharComponentTextureSections: csv([
    // Section type 5 matches the target-13 layer mask 32; an earlier row of
    // another type must not be selected instead.
    { ID: 578, CharComponentTextureLayoutID: 145, SectionType: 10, X: 1024, Y: 0, Width: 1024, Height: 1024 },
    { ID: 584, CharComponentTextureLayoutID: 145, SectionType: 5, X: 512, Y: 384, Width: 512, Height: 256 },
    { ID: 585, CharComponentTextureLayoutID: 145, SectionType: 6, X: 512, Y: 640, Width: 512, Height: 256 },
  ]),
  TextureFileData: csv([
    { FileDataID: 1940014, UsageType: 0, MaterialResourcesID: 435410 },
    // Non-zero usage types must be ignored.
    { FileDataID: 9999999, UsageType: 1, MaterialResourcesID: 435410 },
    { FileDataID: 1939998, UsageType: 0, MaterialResourcesID: 435394 },
    // Two usage-type-0 rows for one resource: wow.export's map keeps the last.
    { FileDataID: 1111111, UsageType: 0, MaterialResourcesID: 435402 },
    { FileDataID: 1940006, UsageType: 0, MaterialResourcesID: 435402 },
    { FileDataID: 1939950, UsageType: 0, MaterialResourcesID: 435346 },
  ]),
};

const SYNTHETIC_REQUEST = {
  ...VULPERA_APPEARANCE_REQUEST,
  explicitChoices: { 336: 3323 },
};

test("parseDb2Csv parses headers and values as strings", () => {
  const rows = parseDb2Csv(SYNTHETIC_DB.ChrModel);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ID, "69");
  assert.equal(rows[0].CharComponentTextureLayoutID, "145");
});

test("resolveAppearance joins the synthetic DB into selections, geoset families and texture operations", () => {
  const db = Object.fromEntries(DB2_TABLES.map((table) => [table, parseDb2Csv(SYNTHETIC_DB[table])]));
  const appearance = resolveAppearance(db, SYNTHETIC_REQUEST);

  assert.equal(appearance.chrModelId, 69);
  assert.equal(appearance.charComponentTextureLayoutId, 145);

  const selection = new Map(appearance.choices.map((choice) => [choice.optionId, choice.choiceId]));
  assert.equal(selection.get(336), 3323); // explicit override wins
  assert.equal(selection.get(338), 3335); // lowest OrderIndex default
  assert.equal(selection.get(331), 3304);
  assert.equal(selection.get(406), 3313);
  assert.equal(selection.get(6376), undefined); // Flags 0x20 -> no default
  assert.equal(selection.get(777), undefined); // other ChrModel

  // Enabled mesh parts: every geoset of each selected choice.
  assert.deepEqual(appearance.geosets.enabledMeshPartIds.sort((a, b) => a - b), [100, 203, 4102]);

  // Families carry the alternatives so the browser can hide them.
  const ears = appearance.geosets.families.find((family) => family.optionId === 336);
  assert.equal(ears.selectedChoiceId, 3323);
  assert.deepEqual(ears.meshPartIds.sort((a, b) => a - b), [100, 202, 203]);
  assert.deepEqual(ears.selectedMeshPartIds.sort((a, b) => a - b), [100, 203]);

  // Composited operations (skin types only): base copy + section overlay.
  // The target-14 material has no layer and is skipped with a diagnostic; the
  // face material is gated on the inactive fur choice 3305 and is skipped.
  assert.deepEqual(
    appearance.atlasOperations.map((operation) => operation.targetId),
    [1, 13],
  );
  const base = appearance.atlasOperations[0];
  assert.equal(base.elementId, 9710);
  assert.equal(base.materialId, 13474);
  assert.equal(base.textureType, 1);
  assert.equal(base.layer, 0);
  assert.equal(base.blendMode, 1);
  assert.equal(base.sourceFileDataId, 1940014);
  assert.deepEqual(base.destination, { x: 0, y: 0, width: 2048, height: 1024 });
  assert.equal(base.relatedChoiceId, null);

  const overlay = appearance.atlasOperations[1];
  assert.equal(overlay.sourceFileDataId, 1939998);
  assert.equal(overlay.blendMode, 15);
  assert.equal(overlay.layer, 6);
  // First matching section (type 5 in the mask 32), not the earlier type-10 row.
  assert.deepEqual(overlay.destination, { x: 512, y: 384, width: 512, height: 256 });

  // Skipped materials are named, not silent.
  assert.equal(appearance.skippedMaterials.length, 2);
  const noLayer = appearance.skippedMaterials.find((entry) => entry.materialId === 13476);
  assert.ok(noLayer.reason.includes("14"));
  const gated = appearance.skippedMaterials.find((entry) => entry.materialId === 13501);
  assert.equal(gated.relatedChoiceId, 3305);

  // Atlas sizes come from ChrModelMaterial for the layout.
  assert.deepEqual(appearance.atlasSizes, [
    { textureType: 1, width: 2048, height: 1024 },
    { textureType: 6, width: 512, height: 256 },
  ]);
});

test("resolveAppearance collects non-skin layers as direct replaceable textures", () => {
  const db = Object.fromEntries(DB2_TABLES.map((table) => [table, parseDb2Csv(SYNTHETIC_DB[table])]));
  db.ChrModelTextureLayer = parseDb2Csv(csv([
    { ID: 512, TextureType: 19, Layer: 11, BlendMode: 1, TextureSectionTypeBitMask: -1, ChrModelTextureTargetID_0: 25, ChrModelTextureTargetID_1: 0, CharComponentTextureLayoutsID: 145 },
    ...parseDb2Csv(SYNTHETIC_DB.ChrModelTextureLayer),
  ]));
  db.ChrCustomizationElement = parseDb2Csv(csv([
    ...parseDb2Csv(SYNTHETIC_DB.ChrCustomizationElement).map((row) => ({ ...row })),
    { ID: 18652, ChrCustomizationChoiceID: 3321, ChrCustomizationMaterialID: 24865 },
  ]));
  db.ChrCustomizationMaterial = parseDb2Csv(csv([
    ...parseDb2Csv(SYNTHETIC_DB.ChrCustomizationMaterial).map((row) => ({ ...row })),
    { ID: 24865, ChrModelTextureTargetID: 25, MaterialResourcesID: 683940 },
  ]));
  db.ChrModelMaterial = parseDb2Csv(csv([
    ...parseDb2Csv(SYNTHETIC_DB.ChrModelMaterial).map((row) => ({ ...row })),
    { ID: 149, CharComponentTextureLayoutsID: 145, TextureType: 19, Width: 256, Height: 128 },
  ]));
  db.TextureFileData = parseDb2Csv(csv([
    ...parseDb2Csv(SYNTHETIC_DB.TextureFileData).map((row) => ({ ...row })),
    { FileDataID: 3635066, UsageType: 0, MaterialResourcesID: 683940 },
  ]));

  const appearance = resolveAppearance(db, SYNTHETIC_REQUEST);
  // The type-19 material belongs to the unselected ears choice 3321 -> absent.
  assert.equal(appearance.directTextures.length, 0);

  db.ChrCustomizationElement = parseDb2Csv(csv([
    ...db.ChrCustomizationElement,
    { ID: 18653, ChrCustomizationChoiceID: 3323, ChrCustomizationMaterialID: 24865 },
  ]));
  const withDirect = resolveAppearance(db, SYNTHETIC_REQUEST);
  assert.equal(withDirect.directTextures.length, 1);
  assert.equal(withDirect.directTextures[0].textureType, 19);
  assert.equal(withDirect.directTextures[0].sourceFileDataId, 3635066);
  // Type 19 is not composited: no atlas operation for it.
  assert.ok(withDirect.atlasOperations.every((operation) => operation.textureType !== 19));
});

test("resolveAppearance fails fast on broken joins", () => {
  const db = Object.fromEntries(DB2_TABLES.map((table) => [table, parseDb2Csv(SYNTHETIC_DB[table])]));

  assert.throws(() => resolveAppearance({ ...db, ChrModel: [] }, SYNTHETIC_REQUEST), /ChrModel 69/);
  assert.throws(
    () => resolveAppearance(db, { ...SYNTHETIC_REQUEST, explicitChoices: { 336: 99999 } }),
    /choice 99999/,
  );
  // A material whose resource has no UsageType 0 row resolves to FileDataID 0
  // and must fail the prepare instead of emitting a zero reference.
  db.TextureFileData = parseDb2Csv(csv([
    { FileDataID: 9999998, UsageType: 1, MaterialResourcesID: 435410 },
    { FileDataID: 1939998, UsageType: 0, MaterialResourcesID: 435394 },
    { FileDataID: 1940006, UsageType: 0, MaterialResourcesID: 435402 },
  ]));
  assert.throws(() => resolveAppearance(db, SYNTHETIC_REQUEST), /435410.*FileDataID 0/);
});

function blpBytes({ width = 4, height = 4 } = {}) {
  const bytes = new Uint8Array(148 + width * height * 8);
  bytes.set(Buffer.from("BLP2", "ascii"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true);
  view.setUint8(8, 2);
  view.setUint32(12, width, true);
  view.setUint16(16, height, true);
  view.setUint32(20, 148, true);
  view.setUint32(84, width * height * 8, true);
  return bytes;
}

function syntheticPrepareWorld() {
  const csvTexts = { ...SYNTHETIC_DB };
  // Widen the fixture until the appearance resolves BLPs for every operation.
  csvTexts.ChrCustomizationElement = csv([
    { ID: 1018, ChrCustomizationChoiceID: 3321, ChrCustomizationGeosetID: 1779 },
    { ID: 1020, ChrCustomizationChoiceID: 3323, ChrCustomizationGeosetID: 1783 },
    { ID: 1030, ChrCustomizationChoiceID: 3335, ChrCustomizationGeosetID: 2316 },
    { ID: 9710, ChrCustomizationChoiceID: 3304, ChrCustomizationMaterialID: 13474 },
  ], ["ID", "ChrCustomizationChoiceID", "ChrCustomizationGeosetID", "ChrCustomizationMaterialID"]);
  return { csvTexts, blps: new Map([[1940014, blpBytes()]]) };
}

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "prepare-vulpera-appearance-"));
  return {
    root,
    outputJsonPath: join(root, "vulperaAppearance.json"),
    manifestPath: join(root, "nativeModelManifest.json"),
    modelOutputDirectory: join(root, "native-models"),
    csvCacheDirectory: join(root, "db2"),
  };
}

test("prepareVulperaAppearance downloads, validates, pins and emits deterministically", async (t) => {
  const workspace = await makeWorkspace();
  t.after(() => rm(workspace.root, { recursive: true, force: true }));
  const { csvTexts, blps } = syntheticPrepareWorld();
  await writeFile(workspace.manifestPath, JSON.stringify({
    build: "12.1.0.69933",
    actors: [],
    assets: [],
  }));

  const downloadedTables = [];
  const downloadedFileDataIds = [];
  await prepareVulperaAppearance({
    ...workspace,
    fetchText: async (table) => {
      downloadedTables.push(table);
      return csvTexts[table];
    },
    fetchFileData: async (fileDataId) => {
      downloadedFileDataIds.push(fileDataId);
      const bytes = blps.get(fileDataId);
      if (!bytes) throw new Error(`unexpected FileDataID ${fileDataId}`);
      return bytes;
    },
  });

  assert.equal(downloadedTables.length, DB2_TABLES.length);
  assert.deepEqual(downloadedFileDataIds, [1940014]);

  const emitted = JSON.parse(await readFile(workspace.outputJsonPath, "utf8"));
  assert.equal(emitted.build, "12.1.0.69933");
  assert.equal(emitted.chrModelId, 69);
  assert.equal(emitted.atlasOperations.length, 1);
  assert.equal(emitted.sources.db2.length, DB2_TABLES.length);
  for (const pin of emitted.sources.db2) {
    assert.match(pin.sha256, /^[0-9a-f]{64}$/);
  }

  // The BLP was written and pinned into the model manifest.
  const files = await readdir(workspace.modelOutputDirectory);
  assert.deepEqual(files, ["1940014.blp"]);
  const manifest = JSON.parse(await readFile(workspace.manifestPath, "utf8"));
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].fileDataId, 1940014);
  assert.equal(manifest.assets[0].sha256, createHash("sha256").update(blps.get(1940014)).digest("hex"));

  // Second run with everything present: verify-only, no network.
  let networkCalls = 0;
  await prepareVulperaAppearance({
    ...workspace,
    fetchText: async () => {
      networkCalls += 1;
      throw new Error("network must not be touched");
    },
    fetchFileData: async () => {
      networkCalls += 1;
      throw new Error("network must not be touched");
    },
  });
  assert.equal(networkCalls, 0);

  // Regeneration is deterministic: same inputs -> identical file.
  const before = await readFile(workspace.outputJsonPath, "utf8");
  await rm(workspace.csvCacheDirectory, { recursive: true, force: true });
  await prepareVulperaAppearance({
    ...workspace,
    fetchText: async (table) => csvTexts[table],
    fetchFileData: async (fileDataId) => blps.get(fileDataId),
  });
  assert.equal(await readFile(workspace.outputJsonPath, "utf8"), before);
});

test("prepareVulperaAppearance fails on CSV hash drift against the emitted pins", async (t) => {
  const workspace = await makeWorkspace();
  t.after(() => rm(workspace.root, { recursive: true, force: true }));
  const { csvTexts, blps } = syntheticPrepareWorld();
  await writeFile(workspace.manifestPath, JSON.stringify({ build: "12.1.0.69933", actors: [], assets: [] }));

  await prepareVulperaAppearance({
    ...workspace,
    fetchText: async (table) => csvTexts[table],
    fetchFileData: async (fileDataId) => blps.get(fileDataId),
  });

  const tampered = { ...csvTexts, ChrModel: csvTexts.ChrModel.replace("83913", "83914") };
  // Drop only the ChrModel cache entry so the next run must re-fetch it; the
  // server now serves a drifted CSV whose hash no longer matches the pin the
  // first run emitted.
  await rm(join(workspace.csvCacheDirectory, "ChrModel.csv"));
  await assert.rejects(
    () => prepareVulperaAppearance({
      ...workspace,
      fetchText: async (table) => tampered[table],
      fetchFileData: async (fileDataId) => blps.get(fileDataId),
    }),
    /ChrModel.*SHA-256/,
  );
});

test("prepareVulperaAppearance fails on a local BLP that no longer matches its pin", async (t) => {
  const workspace = await makeWorkspace();
  t.after(() => rm(workspace.root, { recursive: true, force: true }));
  const { csvTexts } = syntheticPrepareWorld();
  await writeFile(workspace.manifestPath, JSON.stringify({ build: "12.1.0.69933", actors: [], assets: [] }));
  // Pin a wrong hash for the one BLP the appearance needs.
  await prepareVulperaAppearance({
    ...workspace,
    fetchText: async (table) => csvTexts[table],
    fetchFileData: async () => blpBytes({ width: 8, height: 8 }),
  });
  // Tamper the local BLP so the verify pass fails.
  await writeFile(join(workspace.modelOutputDirectory, "1940014.blp"), blpBytes({ width: 16, height: 16 }));
  await assert.rejects(
    () => prepareVulperaAppearance({
      ...workspace,
      fetchText: async (table) => csvTexts[table],
      fetchFileData: async () => {
        throw new Error("network must not be touched");
      },
    }),
    /1940014/,
  );
});
