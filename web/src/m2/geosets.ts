// Character geoset (mesh part) visibility rules. Ported from the wow.export
// character-appearance logic (MIT): show the base mesh, all "...01" and "32xx"
// geosets; hide everything starting with 17 or 35.

/**
 * Exporter-compatible default visibility for a character model geoset:
 * visible when id 0, any id ending in 01, or any id starting with 32,
 * unless it starts with 17 or 35.
 */
export function isGeosetVisibleByDefault(geosetId: number): boolean {
  const id = String(geosetId);
  if (id.startsWith("17") || id.startsWith("35")) return false;
  return geosetId === 0 || id.endsWith("01") || id.startsWith("32");
}

/** Creature display fallback differs from the character rule: xxx0 or xx01.
 * ModelData.CreatureGeosetDataID > 0 replaces only IDs 1..899 with exact
 * CreatureDisplayInfoGeosetData selections; base and >=900 retain defaults.
 * See wow.export tab_creatures.js display selection (MIT).
 */
export function isCreatureGeosetVisible(
  meshPartId: number,
  selectedGeosets: ReadonlyArray<{ geosetIndex: number; geosetValue: number }> | null,
): boolean {
  if (selectedGeosets !== null && meshPartId > 0 && meshPartId < 900) {
    return selectedGeosets.some(({ geosetIndex, geosetValue }) =>
      meshPartId === (geosetIndex + 1) * 100 + geosetValue);
  }
  return String(meshPartId).endsWith("0") || String(meshPartId).endsWith("01");
}

/** SKIN section meshPartId encoding: 100 * geosetType + geosetId. */
export function meshPartIdFromGeoset(geosetType: number, geosetId: number): number {
  return 100 * geosetType + geosetId;
}

export function geosetIdFromMeshPartId(meshPartId: number): number {
  return meshPartId % 100;
}
