// Native animation-name and spell mappings for the M2 actors.
// The name table is minimal on purpose: only the animations the viewer can
// actually play (replay kits, stand, locomotion) get names; everything else
// keeps its numeric fallback label.

export const STAND_ANIMATION_ID = 0;

export const M2_ANIMATION_NAMES: Record<number, string> = {
  0: "Stand",
  4: "Walk",
  5: "Run",
  9: "Wound",
  10: "WoundCritical",
  51: "SpellCastStand",
  52: "SpellCastDeath",
  53: "SpellCastDirected",
  54: "SpellCastOmni",
  124: "SpellCastCTC",
  125: "SpellCastWalk",
  828: "ShaSpellPrecastBoth",
  830: "ShaSpellCastBothFront",
  862: "ShaSpellPrecastBothChannel",
  1122: "CastOutStrong",
  1148: "CastStrongUpRight",
  1448: "ChannelCastOmniUp",
};

export function animationOptionLabel(animationId: number, variationIndex: number): string {
  const name = M2_ANIMATION_NAMES[animationId] ?? `Animation ${animationId}`;
  return `${name} (ID ${animationId} variation ${variationIndex})`;
}

// Elemental Shaman replay spells -> native animation ids. Each mapped id is
// present in the prepared Vulpera sequence list; unmapped records idle at Stand.
export const REPLAY_SPELL_ANIMATION_IDS: ReadonlyMap<number, number> = new Map([
  [318038, 54], // Flametongue Weapon -> SpellCastOmni
  [192106, 862], // Lightning Shield -> ShaSpellPrecastBothChannel
  [191634, 828], // Stormkeeper -> ShaSpellPrecastBoth
  [443454, 54], // Ancestral Swiftness -> SpellCastOmni
  [1219480, 1448], // Ascendance -> ChannelCastOmniUp
  [51505, 1148], // Lava Burst -> CastStrongUpRight
  [188196, 830], // Lightning Bolt -> ShaSpellCastBothFront
  [117014, 1122], // Elemental Blast -> CastOutStrong
  [188389, 53], // Flame Shock -> SpellCastDirected
]);
