export interface NativeTextureAsset {
  fileDataId: number;
  sha256: string;
}

export interface NativeEffectAsset {
  fileDataId: 794788 | 613807;
  label: string;
  filename: string;
  sha256: string;
  expectedEmitterCount: 6;
  textures: NativeTextureAsset[];
}

export const NATIVE_EFFECT_ASSETS: readonly NativeEffectAsset[] = [
  {
    fileDataId: 794788,
    label: "Leishen lightning burst missile",
    filename: "spells/leishen_lightning_burst_missile.m2",
    sha256: "d74e632a23699e81ca90907baf6f6a74a005e22642567094134bf41ac4393ea4",
    expectedEmitterCount: 6,
    textures: [
      { fileDataId: 397894, sha256: "882871dc36baf215cb4166385e16be327c10f84b0f66f6937d84f7a7ea63c202" },
      { fileDataId: 796153, sha256: "8d9f1fadfe4422ffd3bb040ec550fdcb81de0f9a003b2c2c71b2d15abf9e56bf" },
      { fileDataId: 243229, sha256: "f2ecaa3d47fc455148e57154dadd1d6324c5d31136b70172c94a7c1418dde08e" },
      { fileDataId: 669041, sha256: "ec0af25f0cbfe223e273a7d7cfd8c6d5df1e9e7054eeac23858d8fb463b82a9e" },
    ],
  },
  {
    fileDataId: 613807,
    label: "Shaman frost missile",
    filename: "spells/shaman_frost_missile.m2",
    sha256: "0ac91aa529011cd808b5d2880d685f5bf6714813dba898824797c345333376b9",
    expectedEmitterCount: 6,
    textures: [
      { fileDataId: 613804, sha256: "3890881a5441048e10de3a474a110cb64ed22bcf11e8dd215f60f36de360adce" },
      { fileDataId: 613805, sha256: "4b5a9d337499d317f5c465d655278be49db9e30f86df4b9b7b80e29c14cffb06" },
      { fileDataId: 613806, sha256: "68a30b5caa5557f7a9569b4f925eefcdfba05aa2a95899e7f3c0cd8da9224b86" },
      { fileDataId: 167020, sha256: "d4c485e69747d98297f931cacdb2b7311828a577b975b709e2f8dd6d1daa9c35" },
      { fileDataId: 167034, sha256: "ce09ebf4b23d22a7b53db389526e352020820c2da4352a51b79ccee87966e7f8" },
    ],
  },
] as const;

export const NATIVE_PREVIEW_DURATION_SECONDS = 3;
