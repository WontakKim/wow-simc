import { describe, expect, it } from "vitest";
import { geosetIdFromMeshPartId, isCreatureGeosetVisible, isGeosetVisibleByDefault, meshPartIdFromGeoset } from "./geosets";
import stageJson from "../previewStage.json";

describe("isGeosetVisibleByDefault", () => {
  it.each([
    [0, true], // base
    [1, false],
    [2, false],
    [101, true], // ends with 01
    [201, true],
    [301, true],
    [401, true],
    [501, true],
    [502, false],
    [508, false],
    [701, true],
    [802, false],
    [1102, false],
    [1202, false],
    [1502, false],
    [3201, true], // starts with 32
    [17, false], // starts with 17
    [35, false], // starts with 35
    [1701, false], // ends with 01 but hidden prefixes win
    [3501, false],
  ])("geoset %i -> %s", (geosetId, expected) => {
    expect(isGeosetVisibleByDefault(geosetId)).toBe(expected);
  });
});

describe("creature display 3019 geosets", () => {
  it("uses the creature base rule when the model has no extra-geoset data", () => {
    expect(stageJson.creature.modelId).toBe(270);
    expect(stageJson.creature.fileDataId).toBe(125259);
    expect(stageJson.creature.textureVariationFileDataIds).toEqual([125258, 0, 0, 0]);
    expect(stageJson.creature.geosetDataId).toBe(0);
    expect(stageJson.creature.geosets).toEqual([]);
    expect(isCreatureGeosetVisible(0, null)).toBe(true);
    expect(isCreatureGeosetVisible(100, null)).toBe(true);
    expect(isCreatureGeosetVisible(101, null)).toBe(true);
    expect(isCreatureGeosetVisible(102, null)).toBe(false);
    expect(isCreatureGeosetVisible(3201, null)).toBe(true);
  });

  it("uses exact display group selections only when creature model enables overrides", () => {
    const selected = [{ geosetIndex: 0, geosetValue: 2 }, { geosetIndex: 1, geosetValue: 1 }];
    expect(isCreatureGeosetVisible(0, selected)).toBe(true);
    expect(isCreatureGeosetVisible(101, selected)).toBe(false);
    expect(isCreatureGeosetVisible(102, selected)).toBe(true);
    expect(isCreatureGeosetVisible(201, selected)).toBe(true);
    expect(isCreatureGeosetVisible(901, selected)).toBe(true);
  });
});

describe("mesh part ids", () => {
  it("computes meshPartId = 100 * type + id", () => {
    expect(meshPartIdFromGeoset(0, 0)).toBe(0);
    expect(meshPartIdFromGeoset(2, 1)).toBe(201);
    expect(meshPartIdFromGeoset(5, 8)).toBe(508);
    expect(meshPartIdFromGeoset(12, 2)).toBe(1202);
  });

  it("recovers the geoset id from a mesh part id", () => {
    expect(geosetIdFromMeshPartId(0)).toBe(0);
    expect(geosetIdFromMeshPartId(201)).toBe(1);
    expect(geosetIdFromMeshPartId(508)).toBe(8);
    expect(geosetIdFromMeshPartId(1204)).toBe(4);
  });
});
