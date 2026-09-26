# Character Customization and Skin Composition

Research date: **2026-09-26**. Statement classes are defined in the [directory index](README.md). The reference implementation for the join graph, geoset defaults, and atlas compositing is Kruithne/wow.export at commit `c2fd7bde36a712be78a5da896c995b84fbfa2545` (cited repo-relative). WebWowViewerCpp implements none of this pipeline. Schema names follow WoWDBDefs conventions; exact spellings matter and are called out below.

## 1. Join graph

The concrete join chain (Reference (wow.export), principally `src/js/db/caches/DBCharacterCustomization.js` and `src/js/ui/character-appearance.js`):

| Step | Join / result |
| --- | --- |
| Race + sex | `ChrRaceXChrModel (ChrRacesID, Sex) → ChrModelID` (`:194-200`) |
| ChrModel.DisplayID | `CreatureDisplayInfo.ModelID → CreatureModelData.FileDataID` (`DBCreatures.js:34-56`) |
| ChrModel | Character texture-layout ID (`CharComponentTextureLayoutID`) |
| ChrModel → options | `ChrCustomizationOption.ChrModelID` — options for this model (`:113-123`) |
| Option → choices | `ChrCustomizationChoice.ChrCustomizationOptionID` (`:125-181`) |
| Choice → elements | `ChrCustomizationElement.ChrCustomizationChoiceID` — reads geoset, skinned-model, bone-set, cond-model, display-info, and material IDs plus `RelatedChrCustomizationChoiceID` (`:68-110`) |
| Element geoset ID | `ChrCustomizationGeoset.GeosetType / GeosetID` (`:218-222`) |
| Element skinned-model ID | `ChrCustomizationSkinnedModel.CollectionsFileDataID` + its own geoset fields (`:224-226,277-294`) |
| Element material ID | `ChrCustomizationMaterial (ID, ChrModelTextureTargetID, MaterialResourcesID)` (`:101-110`) |
| Material resource | `TextureFileData` rows with `UsageType == 0`: `MaterialResourcesID → FileDataID` (`:54-59`) |
| Material target + layout | `ChrModelTextureLayer` keyed by layout + target ID; supplies `TextureType`, `Layer`, `BlendMode`, `TextureSectionTypeBitMask` (`:214-216`) |
| Layer texture type + layout | `ChrModelMaterial.Width / Height` keyed by layout + texture type (`:202-204`) |
| Layer section mask + layout | `CharComponentTextureSections (SectionType, X, Y, Width, Height)` (`:206-212`) |

Spelling warning: some tables use singular `CharComponentTextureLayoutID` while the examined `ChrModelMaterial`/`ChrModelTextureLayer` access uses plural `CharComponentTextureLayoutsID`. Preserve exact schema spellings; do not normalize them.

Build evidence for the project's character (from the 2026-09-25 audit, relayed via G1; **not** independently re-extracted here):

```text
Race 35, sex/type 1 → ChrModel 69 → M2 1890761, SKIN 1893903
Ears option 336       → choice 3323 (Compact)
Eyesight option 852   → choice 9541 (Both)
Eye Style option 854  → choice 9581 (Slit)
```

The audit does not provide a complete re-extracted map of every fur/face choice or exact atlas dimensions — those must come from the prepare step's manifest, not from "1024×1024 defaults".

## 2. Geoset selection

The exporter's base visibility rule (Reference (wow.export) `M2RendererGL.js:661-679` and `character-appearance.js:21-58`) — an exporter rule, not proof of an immutable retail algorithm:

```text
show ID 0
show IDs ending in 01
show IDs starting with 32
hide IDs starting with 17 or 35
```

Customization then: for each selected option, iterate all choices, resolve each choice's geoset, and check only the active choice's geoset; base geoset 0 is never toggled. Collection/skinned models then hide base geosets in the families they replace, and equipment may override customization (`tab_characters.js:321-389`). Collection-model visibility is `submeshID === 0 || selectedGeosets.has(submeshID)`.

Geoset encoding: `meshPartId = 100·GeosetType + GeosetID`.

Do not build visibility through uncontrolled "last option wins" mutations. Compile selections first (Policy sketch from G1):

```ts
function compileGeosets(model, appearance, db) {
  const selectedChoices = new Set(Object.values(appearance.choices));
  const activeElements = resolveElements(selectedChoices, db);
  const baseVisible = exporterCompatibleDefaults(model.sections);
  const selectionsByFamily = collectSelectedGeosets(activeElements);
  for (const family of familiesControlledByCustomization(db, appearance)) {
    hideCustomizationAlternatives(baseVisible, family);
    enableSelectedSet(baseVisible, selectionsByFamily.get(family));
  }
  const collections = resolveSkinnedModels(activeElements);
  hideBaseFamiliesReplacedByCollections(baseVisible, collections);
  applyExplicitEquipmentOverrides(baseVisible, collections, appearance.equipment);
  validateNoUnresolvedConflictingSelections();
  return { baseVisible, collections };
}
```

A family can legitimately contain several selected pieces: "no overlaps" must mean no conflicting alternatives, not "exactly one section per `floor(meshPartId/100)`". Collection models need bone correspondence to the character skeleton — the exporter matches pivots/CRCs; do not silently fall back to numeric bone-index coincidence.

## 3. Defaults must be explicit

The exporter default activates only options whose `Flags & 0x20` is clear and picks each option's **first iterated choice** — the arrays are not sorted by `OrderIndex` in this path, so "first" means first `getAllRows()` iteration order (Reference (wow.export) `DBCharacterCustomization.js:183-185`, `tab_characters.js:1041-1055`). Consequences:

- Reproducing the exporter means preserving its actual selected IDs (row-order dependent).
- A stable viewer default means storing a complete explicit choice manifest.
- Sorting by `OrderIndex` is a separate policy and can change appearance.

Do not describe "first CSV row" as a retail default.

## 4. Atlas compositing

One output texture per resolved `ChrModelMaterial.TextureType`, at that table's `Width × Height` (never a guessed default). Per active material (Reference (wow.export) `character-appearance.js:70-174`, `CharMaterialRenderer.js`):

1. Apply `RelatedChrCustomizationChoiceID` gating (material applies only when the related choice is also active).
2. Resolve `MaterialResourcesID → TextureFileData.FileDataID`.
3. Resolve target + layout → `ChrModelTextureLayer`.
4. Select the destination texture type.
5. Resolve the section rectangle: mask `-1` means the full material rectangle; otherwise the **first** section row where `(mask & (1 << SectionType)) !== 0`. If multiple sections match, retain that fact — a general "draw into every matching rectangle" is not equivalent to the exporter path.

**Layer order:** the examined `CharMaterialRenderer` sorts operations by **texture target ID**, not `ChrModelTextureLayer.Layer` (`CharMaterialRenderer.js:291-308`). Reproduce target-ID ordering as an explicit compatibility mode, retain `Layer` on every operation, and emit a diagnostic whenever the two orders disagree. Do not silently switch to Layer ordering while claiming unchanged appearance.

Recommended prepared operation record (Policy):

```ts
interface AtlasOperation {
  elementId: number;
  materialId: number;
  targetId: number;
  layer: number;
  textureType: number;
  blendMode: number;
  sourceFileDataId: number;
  destination: { x: number; y: number; width: number; height: number };
  relatedChoiceId: number | null;
}
```

Normalize top-left vs bottom-left coordinates once, and test with a four-quadrant synthetic image before touching real fur textures.

## 5. Character-compositor blend modes

These are **compositor modes**, not M2 material blend modes. Let `D` be destination RGB, `S` incoming RGB (Reference (wow.export) `char.fragment.shader:7-32`, `CharMaterialRenderer.js:345-380`):

| Mode | Examined behavior |
| ---:| --- |
| 0, 1 | Copy path (blending disabled) |
| 4 | Multiply: `D·S` |
| 6 | Source-threshold overlay: `2DS` when `S<0.5`, else `1−2(1−D)(1−S)` |
| 7 | Screen: `1−(1−D)(1−S)` |
| 9 | Alpha-straight path with separate RGB/alpha factors |
| 15 | Alpha-composited source path |
| 2,3,5,8,10–14 | Logged as unsupported/not used by the exporter |
| 16/default | Ordinary alpha blending |

Mode 6's threshold is on **source**, not destination — despite the "Overlay" label, switching to the common destination-threshold overlay definition changes the result.

Separate the blend function from alpha compositing. For a straight-alpha source over an opaque atlas destination:

```text
C_out = (1 − a_s)·D + a_s·F(D, S)
```

For destinations with meaningful alpha, use a correct straight/premultiplied representation and its full alpha equation. Do not mix Canvas2D premultiplied readback, straight decoded BLP pixels, and WebGL blending without an explicit conversion boundary.

## 6. Replaceable texture types

Build a `Map<TextureType, ResolvedTexture>` and replace every M2 texture slot whose numeric type matches (`M2RendererGL.js:1630-1717`).

- Type **1** is body skin; type **8** is skin-extra (explicit in `character-appearance.js:9-14`).
- Collection models bind composites for types 1 and 8, with the body composite as fallback for missing type 8 (`tab_characters.js:825-848`).
- Non-skin slots on collection models bind raw source FileDataIDs; type 9 is the exporter's example of a direct replaceable texture.
- The exporter's built-in replaceable display mapping covers 2–4 and 11–13 for its preview display textures; the repository does **not** define a complete named texture-type enum — type 6's "hair" label, in particular, is not declared in this source and must come from format documentation or actual customization data.

Do not require every TXID slot to be a nonzero original BLP: replaceable slots are a different binding mechanism. Resolve other replaceable types from actual customization/display data — never assign them all the body atlas.

## 7. Unresolved items specific to this document

- Complete named M2 texture-type enum (types beyond 1, 8, 9, 2–4, 11–13 are numeric-only in the reference).
- Whether the exporter's target-ID layer ordering reproduces retail compositing for all models (the code does not explain why it should).
- Retail default customization choices (the exporter default is row-order dependent, not a documented game default).
- Complete bone-correspondence rules for collection models beyond pivot/CRC matching.
