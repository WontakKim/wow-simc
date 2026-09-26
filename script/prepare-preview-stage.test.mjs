import assert from "node:assert/strict";
import test from "node:test";
import { resolvePreviewStage } from "./prepare-preview-stage.mjs";

const db = {
  CreatureDisplayInfo: [{ ID: "3019", ModelID: "270", TextureVariationFileDataID_0: "125258",
    TextureVariationFileDataID_1: "0", TextureVariationFileDataID_2: "0", TextureVariationFileDataID_3: "0" }],
  CreatureModelData: [{ ID: "270", FileDataID: "125259", CreatureGeosetDataID: "3" }],
  CreatureDisplayInfoGeosetData: [{ CreatureDisplayInfoID: "3019", GeosetIndex: "0", GeosetValue: "2" }],
  Light: [{ ID: "1", ContinentID: "0", GameCoords_0: "0", GameCoords_1: "0", GameCoords_2: "0", LightParamsID_0: "12" }],
  LightParams: [{ ID: "12" }],
  LightData: [{ ID: "20977", LightParamID: "12", Time: "1440", AmbientColor: "8361386",
    HorizonAmbientColor: "0", GroundAmbientColor: "0", DirectColor: "6968898", SkyTopColor: "8009",
    SkyMiddleColor: "5406631", SkyBand1Color: "10083573", SkyBand2Color: "11524832",
    SkySmogColor: "11842740", SkyFogColor: "5077135", FogEnd: "18000", FogScaler: "0.25", FogDensity: "4.5" }],
};

test("resolves creature display geoset override and LightData at a fixed exterior time", () => {
  const stage = resolvePreviewStage(db, { LightData: "test-digest" });
  assert.equal(stage.source.lightDataId, 20977);
  assert.equal(stage.source.time, 1440);
  assert.deepEqual(stage.creature.geosets, [{ geosetIndex: 0, geosetValue: 2 }]);
  assert.deepEqual(stage.creature.textureVariationFileDataIds, [125258, 0, 0, 0]);
  assert.equal(stage.colors.skyTop, 8009);
  assert.deepEqual(stage.fog, { end: 18000, scaler: 0.25, density: 4.5 });
});

test("fails when a required build join drifts", () => {
  assert.throws(() => resolvePreviewStage({ ...db, CreatureModelData: [] }, {}), /CreatureModelData 270 is missing/);
  assert.throws(() => resolvePreviewStage({ ...db, LightData: [] }, {}), /LightData.*time 1440 is missing/);
});
