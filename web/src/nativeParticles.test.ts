import { describe, expect, it } from "vitest";
import type {
  NativeBone,
  NativeParticleEmitter,
  NativeParticleTrack,
  NativeTrack,
  QuaternionTuple,
  Vector2Tuple,
  Vector3Tuple,
} from "./nativeM2";
import { sampleNativeEmitter, sampleNativeParticleTrack, sampleNativeTrack } from "./nativeParticles";

function constantTrack<T>(value: T): NativeTrack<T> {
  return { interpolation: 0, globalSequence: -1, sequences: [{ timestamps: [0], values: [value] }] };
}

function particleTrack<T>(timestamps: number[], values: T[]): NativeParticleTrack<T> {
  return { timestamps, values };
}

function makeBone(): NativeBone {
  return {
    flags: 0,
    parentIndex: -1,
    pivot: [0, 0, 0],
    translation: constantTrack<Vector3Tuple>([1, 0, 0]),
    rotation: constantTrack<QuaternionTuple>([0, 0, 0, 1]),
    scale: constantTrack<Vector3Tuple>([1, 1, 1]),
  };
}

function makeEmitter(overrides: Partial<NativeParticleEmitter> = {}): NativeParticleEmitter {
  return {
    index: 0,
    flags: 0x20021,
    position: [0, 0, 0],
    boneIndex: 0,
    textureIndices: [0],
    blendingType: 4,
    emitterType: 1,
    priorityPlane: 0,
    rows: 2,
    columns: 2,
    emissionSpeed: constantTrack(2),
    speedVariation: constantTrack(0),
    verticalRange: constantTrack(0),
    horizontalRange: constantTrack(0),
    gravity: constantTrack<Vector3Tuple>([0, 0, -2]),
    lifespan: constantTrack(2),
    lifespanVariation: 0,
    emissionRate: constantTrack(2),
    emissionRateVariation: 0,
    emissionAreaWidth: constantTrack(0),
    emissionAreaLength: constantTrack(0),
    zSource: constantTrack(0),
    color: particleTrack<Vector3Tuple>([0, 32767], [[1, 0, 0], [0, 0, 1]]),
    alpha: particleTrack<number>([0, 32767], [1, 0]),
    scale: particleTrack<Vector2Tuple>([0, 32767], [[1, 2], [3, 4]]),
    scaleVariation: [0, 0],
    headUv: particleTrack<number>([0, 32767], [0, 3]),
    tailUv: particleTrack<number>([], []),
    tailLength: 0,
    twinkleSpeed: 10,
    twinklePercent: 1,
    twinkleScale: [2, 2],
    inheritVelocityScale: 0,
    drag: 0,
    baseSpin: 0,
    baseSpinVariation: 0,
    spinSpeed: 1,
    spinSpeedVariation: 0,
    tumbleMinimum: [0, 0, 0],
    tumbleMaximum: [0, 0, 0],
    windVector: [0, 0, 0],
    windTime: 0,
    followSpeed1: 0,
    followScale1: 0,
    followSpeed2: 0,
    followScale2: 0,
    alphaCutoff: particleTrack<number>([], []),
    enabled: { interpolation: 0, globalSequence: -1, sequences: [] },
    ...overrides,
  };
}

describe("native particle sampling", () => {
  it("evaluates authored step/linear tracks and normalized-lifetime tracks", () => {
    const linear: NativeTrack<number> = {
      interpolation: 1,
      globalSequence: -1,
      sequences: [{ timestamps: [0, 500, 1000], values: [0, 10, 0] }],
    };
    const step: NativeTrack<number> = { ...linear, interpolation: 0 };

    expect(sampleNativeTrack(linear, 250, 1000, -1)).toBeCloseTo(5);
    expect(sampleNativeTrack(linear, 1250, 1000, -1)).toBeCloseTo(5);
    expect(sampleNativeTrack(step, 499, 1000, -1)).toBe(0);
    expect(sampleNativeTrack(step, 500, 1000, -1)).toBe(10);
    expect(sampleNativeTrack(step, 750, 1000, -1)).toBe(10);
    expect(sampleNativeParticleTrack(particleTrack([0, 32767], [[0, 2], [2, 4]]), 0.25, [9, 9])).toEqual([0.5, 2.5]);
  });

  it("derives deterministic geometry, color, alpha, size, spin, and UV from source values", () => {
    const emitter = makeEmitter();
    const first = sampleNativeEmitter(emitter, makeBone(), 667, 0.75);

    expect(first).toHaveLength(2);
    expect(first[0].spawnIndex).toBe(0);
    expect(first[0].position).toEqual([1, 0, 0.9375]);
    expect(first[0].velocity).toEqual([0, 0, 0.5]);
    expect(first[0].color).toEqual([0.625, 0, 0.375]);
    expect(first[0].alpha).toBeCloseTo(0.625);
    expect(first[0].size).toEqual([3.5, 5.5]);
    expect(first[0].rotation).toBeCloseTo(0.75);
    expect(first[0].uvFrame).toBe(1);

    sampleNativeEmitter(emitter, makeBone(), 667, 1.25);
    expect(sampleNativeEmitter(emitter, makeBone(), 667, 0.75)).toEqual(first);

    const faster = sampleNativeEmitter(makeEmitter({ emissionSpeed: constantTrack(4) }), makeBone(), 667, 0.75);
    expect(faster[0].position[2]).toBeGreaterThan(first[0].position[2]);
  });

  it("uses the full symmetric amplitude for authored lifespan and emission-rate variation", () => {
    const lifespanVaried = makeEmitter({
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(1),
      lifespan: constantTrack(0.3),
      lifespanVariation: 0.2,
    });
    expect(sampleNativeEmitter(lifespanVaried, undefined, 667, 0.4).map((sample) => sample.spawnIndex)).toEqual([0]);

    const rateVaried = makeEmitter({
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(10),
      emissionRateVariation: 4,
      lifespan: constantTrack(10),
    });
    expect(sampleNativeEmitter(rateVaried, undefined, 667, 0.8)).toHaveLength(6);
  });

  it("keeps an identity bone pivot fixed instead of adding it twice", () => {
    const pivot: Vector3Tuple = [0.25, -0.5, 0.75];
    const identityBone: NativeBone = {
      ...makeBone(),
      pivot,
      translation: constantTrack<Vector3Tuple>([0, 0, 0]),
    };
    const emitter = makeEmitter({
      position: pivot,
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(1),
      lifespan: constantTrack(1),
    });

    expect(sampleNativeEmitter(emitter, identityBone, 667, 0)[0].position).toEqual(pivot);
  });

  it("retains world-space birth positions while local particles follow a moving source", () => {
    const movingSource = (timeSeconds: number): Vector3Tuple => [timeSeconds * 10, 0, 0];
    const base = {
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(2),
      lifespan: constantTrack(2),
    };

    const world = sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20031 }), undefined, 667, 0.75, {
      sourceTranslationAtTime: movingSource,
    });
    const local = sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20021 }), undefined, 667, 0.75, {
      sourceTranslationAtTime: movingSource,
    });

    expect(world.map((particle) => particle.position[0])).toEqual([0, 5]);
    expect(local.map((particle) => particle.position[0])).toEqual([7.5, 7.5]);
    expect(sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20031 }), undefined, 667, 0.75, {
      sourceTranslationAtTime: () => [0, 0, 0],
    })).toEqual(sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20031 }), undefined, 667, 0.75));
  });

  it("stops births at visual arrival while already emitted particles finish their lifespans", () => {
    const emitter = makeEmitter({
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(2),
      lifespan: constantTrack(2),
    });

    expect(sampleNativeEmitter(emitter, undefined, 667, 0.75, { emissionEndSeconds: 0.75 }).map(({ spawnIndex }) => spawnIndex)).toEqual([0, 1]);
    expect(sampleNativeEmitter(emitter, undefined, 667, 1.5, { emissionEndSeconds: 0.75 }).map(({ spawnIndex }) => spawnIndex)).toEqual([0, 1]);
    expect(sampleNativeEmitter(emitter, undefined, 667, 2.6, { emissionEndSeconds: 0.75 })).toEqual([]);
  });

  it("keeps world-coordinate emitters out of nonidentity bone transforms", () => {
    const halfTurn = Math.sqrt(0.5);
    const transformedBone: NativeBone = {
      ...makeBone(),
      translation: constantTrack<Vector3Tuple>([3, 4, 5]),
      rotation: constantTrack<QuaternionTuple>([0, halfTurn, 0, halfTurn]),
    };
    const emitter = makeEmitter({
      flags: 0x20031,
      position: [0.25, -0.5, 0.75],
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(1),
      lifespan: constantTrack(1),
    });

    const sample = sampleNativeEmitter(emitter, transformedBone, 667, 0)[0];
    expect(sample.position).toEqual(emitter.position);
    expect(sample.velocity).toEqual([0, 0, 2]);
  });

  it("bounds sphere source positions with authored elevation and azimuth ranges", () => {
    const sphere = makeEmitter({
      emitterType: 2,
      flags: 0x20021,
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(50),
      emissionAreaWidth: constantTrack(1),
      emissionAreaLength: constantTrack(1),
      verticalRange: constantTrack(0),
      horizontalRange: constantTrack(Math.PI),
      lifespan: constantTrack(2),
    });
    const positions = sampleNativeEmitter(sphere, undefined, 667, 1);
    expect(positions.every((sample) => Math.abs(sample.position[2]) < 0.000001)).toBe(true);
    expect(positions.every((sample) => Math.abs(Math.atan2(sample.position[1], sample.position[0])) <= Math.PI / 2)).toBe(true);

    const radial = sampleNativeEmitter({
      ...sphere,
      emissionRate: constantTrack(1),
      emissionSpeed: constantTrack(1),
      horizontalRange: constantTrack(Math.PI * 2),
    }, undefined, 667, 0)[0];
    expect(radial.velocity).toEqual(radial.position);
  });

  it("uses the sphere-up flag for velocity without folding bounded source positions", () => {
    const sphere = makeEmitter({
      emitterType: 2,
      flags: 0x20121,
      emissionSpeed: constantTrack(1),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(50),
      emissionAreaWidth: constantTrack(1),
      emissionAreaLength: constantTrack(1),
      verticalRange: constantTrack(Math.PI),
      horizontalRange: constantTrack(Math.PI * 2),
      lifespan: constantTrack(2),
    });
    const samples = sampleNativeEmitter(sphere, undefined, 667, 0);
    expect(samples.some((sample) => sample.position[2] < 0)).toBe(true);
    expect(samples.every((sample) => sample.velocity[0] === 0 && sample.velocity[1] === 0 && sample.velocity[2] > 0)).toBe(true);
  });

  it("uses stable authored random variation for plane and sphere emitters", () => {
    const varied = makeEmitter({
      emitterType: 2,
      emissionRate: constantTrack(8),
      speedVariation: constantTrack(1),
      lifespanVariation: 0.5,
      emissionAreaWidth: constantTrack(0.4),
      emissionAreaLength: constantTrack(0.2),
      scaleVariation: [0.5, 0.25],
      baseSpinVariation: 1,
      spinSpeedVariation: 0.5,
      flags: 0x30123,
    });

    const samples = sampleNativeEmitter(varied, undefined, 667, 0.8);
    expect(samples.length).toBeGreaterThan(2);
    expect(samples).toEqual(sampleNativeEmitter(varied, undefined, 667, 0.8));
    expect(new Set(samples.map((sample) => sample.uvFrame)).size).toBeGreaterThan(1);
    expect(samples.some((sample) => Math.abs(sample.position[0]) > 0.01)).toBe(true);
  });
});


describe("global particle clocks", () => {
  it("loops an authored global track independently of sequence zero", () => {
    const track: NativeTrack<number> = {
      interpolation: 1, globalSequence: 0,
      sequences: [{ timestamps: [0, 1000, 2767], values: [0, 10, 0] }],
    };
    expect(sampleNativeTrack(track, 1500, 333, -1, [2767])).toBeCloseTo(7.1703, 3);
    expect(sampleNativeTrack(track, 4267, 333, -1, [2767])).toBeCloseTo(7.1703, 3);
  });
});


describe("original emitter extensions", () => {
  it("steers nonzero authored zSource toward its z target", () => {
    const emitter = makeEmitter({ position: [1, 2, 0], emissionSpeed: constantTrack(1),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]), zSource: constantTrack(2), emissionRate: constantTrack(1) });
    const particle = sampleNativeEmitter(emitter, undefined, 667, 0)[0];
    expect(particle.velocity[0]).toBeCloseTo(-1 / 3);
    expect(particle.velocity[1]).toBeCloseTo(-2 / 3);
    expect(particle.velocity[2]).toBeCloseTo(2 / 3);
  });

  it("applies an earlier parent bone transform to a child emitter", () => {
    const parent = makeBone();
    const child = { ...makeBone(), parentIndex: 0, translation: constantTrack<Vector3Tuple>([0, 2, 0]) };
    const emitter = makeEmitter({ emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]), emissionRate: constantTrack(1) });
    const sample = sampleNativeEmitter(emitter, child, 667, 0, { bones: [parent, child] })[0];
    expect(sample.position).toEqual([1, 2, 0]);
  });

  it("keeps a separate authored variation on the second axis", () => {
    const base = makeEmitter({ scaleVariation: [0, 1], emissionRate: constantTrack(1) });
    const shared = sampleNativeEmitter(base, undefined, 667, 0)[0].size;
    const separate = sampleNativeEmitter({ ...base, flags: base.flags | 0x80000 }, undefined, 667, 0)[0].size;
    expect(shared).toEqual([2, 4]);
    expect(separate[0]).toBe(shared[0]);
    expect(separate[1]).not.toBe(shared[1]);
  });

  it("samples the authored EXP2 lifetime alpha cutoff", () => {
    const emitter = makeEmitter({ alphaCutoff: particleTrack([0, 32767], [0, 0.5]), emissionRate: constantTrack(1) });
    expect(sampleNativeEmitter(emitter, undefined, 667, 1)[0].alphaCutoff).toBeCloseTo(0.25);
  });
});
