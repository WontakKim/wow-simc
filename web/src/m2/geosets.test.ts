import { describe, expect, it } from "vitest";
import { geosetIdFromMeshPartId, isGeosetVisibleByDefault, meshPartIdFromGeoset } from "./geosets";

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
