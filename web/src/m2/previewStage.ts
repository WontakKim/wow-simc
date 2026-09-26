import type { M2LightPreset } from "./shaders";

type Color = [number, number, number];

/** DB2 LightData color channels are packed BGR, with high byte unused. */
function unpackColor(packed: number): Color {
  if (!Number.isInteger(packed) || packed < 0 || packed > 0xffffff) throw new Error(`Invalid LightData packed color: ${packed}`);
  return [(packed >>> 16 & 255) / 255, (packed >>> 8 & 255) / 255, (packed & 255) / 255];
}

export function parsePreviewStage(raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("Pinned preview stage is missing.");
  const stage = raw as Record<string, any>;
  const { source, creature, colors, fog } = stage;
  if (source?.build !== "12.1.0.69933" || source.lightId !== 1 || source.lightParamsId !== 12
    || source.lightDataId !== 20977 || source.time !== 1440 || source.displayId !== 3019
    || !["CreatureDisplayInfo", "CreatureModelData", "CreatureDisplayInfoGeosetData", "Light", "LightParams", "LightData"]
      .every((table) => typeof source.csvSha256?.[table] === "string" && /^[a-f0-9]{64}$/.test(source.csvSha256[table]))) {
    throw new Error("Pinned preview stage provenance is invalid.");
  }
  if (creature?.modelId !== 270 || creature.fileDataId !== 125259 || !Array.isArray(creature.geosets)
    || !Number.isInteger(creature.geosetDataId)) throw new Error("Pinned creature display is invalid.");
  if (!fog || !Number.isFinite(fog.end) || fog.end <= 0 || !Number.isFinite(fog.scaler)
    || fog.scaler < 0 || fog.scaler >= 1 || !Number.isFinite(fog.density) || fog.density < 0) {
    throw new Error("Pinned LightData fog is invalid.");
  }
  const ambientSky = unpackColor(colors.ambient);
  // This LightData row has zero-valued horizon/ground channels. wow.export
  // supplies the ambient color as their fallback instead of black.
  const lighting: M2LightPreset = {
    name: `Azeroth default exterior Light ${source.lightId}, LightData ${source.lightDataId}, noon preview`,
    ambientSky,
    ambientHorizon: colors.horizonAmbient ? unpackColor(colors.horizonAmbient) : ambientSky,
    ambientGround: colors.groundAmbient ? unpackColor(colors.groundAmbient) : ambientSky,
    sunColor: unpackColor(colors.direct),
    sunDirectionNative: [0, 0, 1], // wow.export's noon time-of-day sun direction, converted from Y-up.
    localLight: [0, 0, 0],
    unlitAdd: [0, 0, 0],
  };
  return {
    source,
    creature,
    lighting,
    sky: {
      top: unpackColor(colors.skyTop), middle: unpackColor(colors.skyMiddle),
      band1: unpackColor(colors.skyBand1), band2: unpackColor(colors.skyBand2),
      smog: unpackColor(colors.skySmog), fog: unpackColor(colors.skyFog),
    },
    fog: { end: fog.end as number, density: fog.density as number,
      // Preview stage units are not map yards; this fixed 1:250 reduction
      // makes the authored distant haze visible behind our two close actors.
      startPreview: fog.end * fog.scaler / 250,
      endPreview: fog.end / 250,
      color: unpackColor(colors.skyFog),
    },
  };
}
