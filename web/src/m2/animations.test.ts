import { describe, expect, it } from "vitest";
import {
  M2_ANIMATION_NAMES,
  REPLAY_SPELL_ANIMATION_IDS,
  STAND_ANIMATION_ID,
  animationOptionLabel,
} from "./animations";

describe("animation labels", () => {
  it("labels replay-relevant native animations in the exported clip-name format", () => {
    expect(animationOptionLabel(0, 0)).toBe("Stand (ID 0 variation 0)");
    expect(animationOptionLabel(9, 0)).toBe("Wound (ID 9 variation 0)");
    expect(animationOptionLabel(10, 0)).toBe("WoundCritical (ID 10 variation 0)");
    expect(animationOptionLabel(830, 0)).toBe("ShaSpellCastBothFront (ID 830 variation 0)");
    expect(animationOptionLabel(862, 0)).toBe("ShaSpellPrecastBothChannel (ID 862 variation 0)");
    expect(animationOptionLabel(1148, 0)).toBe("CastStrongUpRight (ID 1148 variation 0)");
    expect(animationOptionLabel(1122, 0)).toBe("CastOutStrong (ID 1122 variation 0)");
    expect(animationOptionLabel(1448, 0)).toBe("ChannelCastOmniUp (ID 1448 variation 0)");
    expect(animationOptionLabel(53, 0)).toBe("SpellCastDirected (ID 53 variation 0)");
    expect(animationOptionLabel(54, 0)).toBe("SpellCastOmni (ID 54 variation 0)");
    expect(animationOptionLabel(828, 0)).toBe("ShaSpellPrecastBoth (ID 828 variation 0)");
  });

  it("falls back to a numeric label for unnamed animations and keeps variation indices", () => {
    expect(animationOptionLabel(1234, 0)).toBe("Animation 1234 (ID 1234 variation 0)");
    expect(animationOptionLabel(830, 2)).toBe("ShaSpellCastBothFront (ID 830 variation 2)");
    expect(M2_ANIMATION_NAMES[0]).toBe("Stand");
    expect(M2_ANIMATION_NAMES[4]).toBe("Walk");
    expect(M2_ANIMATION_NAMES[5]).toBe("Run");
  });
});

describe("replay spell to native animation mapping", () => {
  it("maps every Elemental Shaman replay spell to its native animation id", () => {
    expect(REPLAY_SPELL_ANIMATION_IDS).toEqual(new Map([
      [318038, 54],
      [192106, 862],
      [191634, 828],
      [443454, 54],
      [1219480, 1448],
      [51505, 1148],
      [188196, 830],
      [117014, 1122],
      [188389, 53],
    ]));
    expect(STAND_ANIMATION_ID).toBe(0);
  });
});
