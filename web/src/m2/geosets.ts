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

/** SKIN section meshPartId encoding: 100 * geosetType + geosetId. */
export function meshPartIdFromGeoset(geosetType: number, geosetId: number): number {
  return 100 * geosetType + geosetId;
}

export function geosetIdFromMeshPartId(meshPartId: number): number {
  return meshPartId % 100;
}
