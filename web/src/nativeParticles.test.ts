import { describe, expect, it } from "vitest";
import type {
  NativeBone,
  NativeParticleEmitter,
  NativeParticleTrack,
  NativeRibbonEmitter,
  NativeTrack,
  QuaternionTuple,
  Vector2Tuple,
  Vector3Tuple,
} from "./nativeM2";
import {
  sampleNativeEmitter,
  sampleNativeParticleTrack,
  sampleNativeRibbonEdges,
  sampleNativeTrack,
  type NativeMatrix,
} from "./nativeParticles";

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
    multiTextureParam0: [[0, 0], [0, 0]],
    multiTextureParam1: [[0, 0], [0, 0]],
    multiTextureScale: [0, 0],
    followSpeed1: 0,
    followScale1: 0,
    followSpeed2: 0,
    followScale2: 0,
    alphaCutoff: particleTrack<number>([], []),
    enabled: { interpolation: 0, globalSequence: -1, sequences: [] },
    ...overrides,
  };
}

function makeRibbon(overrides: Partial<NativeRibbonEmitter> = {}): NativeRibbonEmitter {
  return {
    index: 0,
    boneIndex: 0,
    position: [0, 0, 0],
    textureIndices: [0],
    materialIndices: [0],
    color: constantTrack<Vector3Tuple>([1, 1, 1]),
    alpha: constantTrack(1),
    heightAbove: constantTrack(0.5),
    heightBelow: constantTrack(0.5),
    edgesPerSecond: 4,
    edgeLifetime: 0.25,
    gravity: -2,
    rows: 1,
    columns: 4,
    textureSlot: constantTrack(0),
    enabled: constantTrack(1),
    priorityPlane: 0,
    colorIndex: 0,
    textureTransformLookupIndex: -1,
    ...overrides,
  };
}

describe("reference semantics (M0b)", () => {
  it("keeps world particles on their birth transform while local particles follow a moving and rotating source", () => {
    // Source translates along +X at 10/s and rotates about native Y a quarter turn per second.
    const sourceTransformAtTime = (timeSeconds: number): NativeMatrix => {
      const angle = timeSeconds * Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return [cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, timeSeconds * 10, 0, 0, 1];
    };
    const base = {
      emissionSpeed: constantTrack(1),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(2),
      lifespan: constantTrack(2),
    };
    const options = { sourceTransformAtTime };

    // One birth so far (at 0.5 s, age 0.25 s); +Z emission rotated by the birth/current source.
    const world = sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20021 }), undefined, 667, 0.75, options);
    const local = sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20031 }), undefined, 667, 0.75, options);

    expect(world).toHaveLength(1);
    expect(local).toHaveLength(1);
    const quarter = Math.SQRT1_2;
    expect(world[0].position[0]).toBeCloseTo(5 + 0.25 * quarter, 5);
    expect(world[0].position[1]).toBeCloseTo(0, 5);
    expect(world[0].position[2]).toBeCloseTo(0.25 * quarter, 5);
    expect(world[0].velocity[0]).toBeCloseTo(quarter, 5);
    expect(world[0].velocity[2]).toBeCloseTo(quarter, 5);
    expect(local[0].position[0]).toBeCloseTo(7.5 + 0.25 * Math.sin(3 * Math.PI / 8), 5);
    expect(local[0].position[2]).toBeCloseTo(0.25 * Math.cos(3 * Math.PI / 8), 5);
    expect(local[0].velocity[0]).toBeCloseTo(Math.sin(3 * Math.PI / 8), 5);
    expect(local[0].velocity[2]).toBeCloseTo(Math.cos(3 * Math.PI / 8), 5);

    const scaledWorld = sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20021 }), undefined, 667, 0.75,
      { ...options, modelScale: 0.38 });
    expect(scaledWorld[0].position[0]).toBeCloseTo(5 + 0.25 * quarter * 0.38, 5);
  });

  it("steers z-source emission away from the source point on the raw generator offset", () => {
    const emitter = makeEmitter({
      emissionSpeed: constantTrack(1),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      zSource: constantTrack(2),
      emissionAreaLength: constantTrack(2),
      emissionRate: constantTrack(1),
    });
    const particle = sampleNativeEmitter(emitter, undefined, 667, 1.005)[0];
    expect(particle).toBeDefined();
    // Reconstruct the generator offset (constant velocity, no forces), then expect
    // the unit direction away from the source point (0, 0, 2).
    const offsetX = particle.position[0] - particle.velocity[0] * particle.age;
    const offsetY = particle.position[1] - particle.velocity[1] * particle.age;
    const length = Math.hypot(offsetX, offsetY, 2);
    expect(particle.velocity[0]).toBeCloseTo(offsetX / length, 5);
    expect(particle.velocity[1]).toBeCloseTo(offsetY / length, 5);
    expect(particle.velocity[2]).toBeCloseTo(-2 / length, 5);
  });

  it("applies the full signed multiplicative speed variation", () => {
    const emitter = makeEmitter({
      emissionSpeed: constantTrack(2),
      speedVariation: constantTrack(1),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(50),
      lifespan: constantTrack(2),
    });
    const speeds = sampleNativeEmitter(emitter, undefined, 667, 1).map((sample) => sample.velocity[2]);
    expect(speeds.length).toBeGreaterThan(10);
    expect(Math.min(...speeds)).toBeLessThan(1.2);
    expect(Math.max(...speeds)).toBeGreaterThan(2.8);
    expect(speeds.every((speed) => speed >= 0 && speed <= 4)).toBe(true);
  });

  it("spawns at integer emission thresholds instead of at time zero", () => {
    const emitter = makeEmitter({
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(1),
      lifespan: constantTrack(5),
    });
    expect(sampleNativeEmitter(emitter, undefined, 667, 0)).toEqual([]);
    expect(sampleNativeEmitter(emitter, undefined, 667, 0.995)).toEqual([]);
    const justAfter = sampleNativeEmitter(emitter, undefined, 667, 1.005);
    expect(justAfter.map((sample) => sample.spawnIndex)).toEqual([0]);
    expect(justAfter[0].age).toBeCloseTo(0.005, 5);
  });

  it("matches the reference per-step wind/gravity/drag integrator at a 1/120 s tick", () => {
    const wind: Vector3Tuple = [0.5, 0, 0];
    const gravity: Vector3Tuple = [0, 0, -2];
    const drag = 0.3;
    // Literal reference stepper: wind drift, pre-gravity displacement, then gravity+drag on velocity.
    const step = (state: { p: Vector3Tuple; v: Vector3Tuple }, dt: number) => {
      const drifted: Vector3Tuple = [state.v[0] + wind[0] * dt, state.v[1] + wind[1] * dt, state.v[2] + wind[2] * dt];
      const next: Vector3Tuple = [
        (drifted[0] + gravity[0] * dt) * (1 - Math.min(drag * dt, 1)),
        (drifted[1] + gravity[1] * dt) * (1 - Math.min(drag * dt, 1)),
        (drifted[2] + gravity[2] * dt) * (1 - Math.min(drag * dt, 1)),
      ];
      return {
        p: [
          state.p[0] + drifted[0] * dt + gravity[0] * 0.5 * dt * dt,
          state.p[1] + drifted[1] * dt + gravity[1] * 0.5 * dt * dt,
          state.p[2] + drifted[2] * dt + gravity[2] * 0.5 * dt * dt,
        ] as Vector3Tuple,
        v: next,
      };
    };
    const stepReference = (age: number) => {
      let state = { p: [0, 0, 0] as Vector3Tuple, v: [0, 0, 0] as Vector3Tuple };
      const dt = 1 / 120;
      let elapsed = 0;
      while (age - elapsed > 1e-12) {
        const delta = Math.min(dt, age - elapsed);
        state = step(state, delta);
        elapsed += delta;
      }
      return state;
    };
    const emitter = makeEmitter({
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>(gravity),
      drag,
      windVector: wind,
      emissionRate: constantTrack(1),
      lifespan: constantTrack(10),
    });

    for (const age of [1, 0.7563]) {
      const particle = sampleNativeEmitter(emitter, undefined, 667, 1 + age)[0];
      const reference = stepReference(age);
      expect(particle.position[0]).toBeCloseTo(reference.p[0], 5);
      expect(particle.position[1]).toBeCloseTo(reference.p[1], 5);
      expect(particle.position[2]).toBeCloseTo(reference.p[2], 5);
      expect(particle.velocity[0]).toBeCloseTo(reference.v[0], 5);
      expect(particle.velocity[1]).toBeCloseTo(reference.v[1], 5);
      expect(particle.velocity[2]).toBeCloseTo(reference.v[2], 5);
    }
  });

  it("keys random streams by occurrence and stays stable under backward re-sampling", () => {
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
    const sampleWith = (occurrenceSeed: string, time = 0.8) =>
      sampleNativeEmitter(varied, undefined, 667, time, { occurrenceSeed });

    const firstCast = sampleWith("cast-1");
    const secondCast = sampleWith("cast-2");
    expect(JSON.stringify(firstCast)).not.toBe(JSON.stringify(secondCast));
    expect(sampleWith("cast-1")).toEqual(firstCast);

    // Sampling a later time, then rewinding, must reproduce the earlier frame exactly.
    sampleWith("cast-1", 1.5);
    expect(sampleWith("cast-1")).toEqual(firstCast);
  });

  it("adds flag 0x40 burst velocity only when the emitter was empty", () => {
    const sourceTransformAtTime = (timeSeconds: number): NativeMatrix =>
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, timeSeconds * 10, 0, 0, 1];
    const emitter = makeEmitter({ flags: 0x20061, emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]), emissionRate: constantTrack(2),
      inheritVelocityScale: 2, lifespan: constantTrack(2) });
    const samples = sampleNativeEmitter(emitter, undefined, 667, 1.25, { sourceTransformAtTime });
    expect(samples).toHaveLength(2);
    // Previous 30 ms displacement is 0.3 units; multiplier 2 yields 0.6 speed.
    expect(samples[0].velocity[0]).toBeCloseTo(0.6, 5);
    expect(samples[0].position[0]).toBeCloseTo(5 + 0.6 * 0.75, 5);
    expect(samples[1].velocity[0]).toBeCloseTo(0, 5);
    expect(samples[1].position[0]).toBeCloseTo(10, 5);
    sampleNativeEmitter(emitter, undefined, 667, 1.5, { sourceTransformAtTime });
    expect(sampleNativeEmitter(emitter, undefined, 667, 1.25, { sourceTransformAtTime })).toEqual(samples);
  });

  it("emits ribbon edges at ceil(edgesPerSecond) with gravity accumulating to g*age^2", () => {
    const ribbon = makeRibbon({ edgesPerSecond: 3.7, edgeLifetime: 0.1 });
    // Effective rate 4/s, lifetime max(0.1, 0.25) = 0.25 s; grid birth at 0.25 s plus the zero-advance endpoint edge.
    const edges = sampleNativeRibbonEdges(ribbon, undefined, 667, 0.4);
    expect(edges.map((edge) => edge.age)[0]).toBeCloseTo(0, 5);
    expect(edges.map((edge) => edge.age)[1]).toBeCloseTo(0.15, 5);
    expect(edges[0].above[2]).toBeCloseTo(0.5, 5);
    expect(edges[1].above[2]).toBeCloseTo(0.5 - 2 * 0.15 * 0.15, 5);
    expect(edges[1].below[2]).toBeCloseTo(-0.5 - 2 * 0.15 * 0.15, 5);
    expect(sampleNativeRibbonEdges(ribbon, undefined, 667, 0.2).map((edge) => edge.age)).toEqual([0]);
  });

  it("keeps aging ribbon edges after emission stops and scrolls their UV cells", () => {
    const ribbon = makeRibbon({ textureSlot: constantTrack(2) });
    const aging = sampleNativeRibbonEdges(ribbon, undefined, 667, 0.4, { emissionEndSeconds: 0.3 });
    // Births stop at 0.3 s: only the 0.25 s grid edge remains, still aging.
    expect(aging).toHaveLength(1);
    expect(aging[0].age).toBeCloseTo(0.15, 5);
    expect(aging[0].u).toBeCloseTo(0.5 + (0.15 / 0.25) / 4, 5);
    expect(aging[0].v).toBeCloseTo(0, 5);

    const later = sampleNativeRibbonEdges(ribbon, undefined, 667, 0.45, { emissionEndSeconds: 0.3 });
    expect(later).toHaveLength(1);
    expect(later[0].age).toBeCloseTo(0.2, 5);
    expect(later[0].u).toBeCloseTo(0.5 + 0.2, 5);
    expect(later[0].above[2]).toBeCloseTo(0.5 - 2 * 0.2 * 0.2, 5);

    // The edge dies once its age exceeds the effective lifetime.
    expect(sampleNativeRibbonEdges(ribbon, undefined, 667, 0.52, { emissionEndSeconds: 0.3 })).toEqual([]);
  });

  it("samples ribbon edges deterministically", () => {
    const ribbon = makeRibbon({ edgesPerSecond: 5 });
    const first = sampleNativeRibbonEdges(ribbon, makeBone(), 667, 0.6);
    expect(first.length).toBeGreaterThan(2);
    sampleNativeRibbonEdges(ribbon, makeBone(), 667, 0.9);
    expect(sampleNativeRibbonEdges(ribbon, makeBone(), 667, 0.6)).toEqual(first);
  });
});


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

    // Birth at the first emission threshold (0.5 s), so age 0.25 s.
    expect(first).toHaveLength(1);
    expect(first[0].spawnIndex).toBe(0);
    expect(first[0].age).toBeCloseTo(0.25, 5);
    expect(first[0].position).toEqual([1, 0, 0.4375]);
    expect(first[0].velocity).toEqual([0, 0, 1.5]);
    expect(first[0].color).toEqual([0.875, 0, 0.125]);
    expect(first[0].alpha).toBeCloseTo(0.875);
    expect(first[0].size).toEqual([2.5, 4.5]);
    expect(first[0].rotation).toBeCloseTo(0.25);
    expect(first[0].uvFrame).toBe(0);

    sampleNativeEmitter(emitter, makeBone(), 667, 1.25);
    expect(sampleNativeEmitter(emitter, makeBone(), 667, 0.75)).toEqual(first);

    const faster = sampleNativeEmitter(makeEmitter({ emissionSpeed: constantTrack(4) }), makeBone(), 667, 0.75);
    expect(faster[0].position[2]).toBeGreaterThan(first[0].position[2]);
  });

  it("uses the full symmetric amplitude for authored lifespan and emission-rate variation", () => {
    const lifespanVaried = makeEmitter({
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(50),
      lifespan: constantTrack(0.3),
      lifespanVariation: 0.2,
    });
    // Lifespans span [0.1, 0.5] s while ages span [0.02, 0.98] s, so some of the
    // 49 born particles have died and some survive.
    const alive = sampleNativeEmitter(lifespanVaried, undefined, 667, 1);
    expect(alive.length).toBeGreaterThan(0);
    expect(alive.length).toBeLessThan(49);

    const rateVaried = makeEmitter({
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(10),
      emissionRateVariation: 4,
      lifespan: constantTrack(10),
    });
    // The per-occurrence rate draw spans [6, 14): between 4 and 11 births by 0.8 s.
    const count = sampleNativeEmitter(rateVaried, undefined, 667, 0.8).length;
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(11);
    const counts = ["a", "b", "c", "d", "e", "f"].map((occurrenceSeed) =>
      sampleNativeEmitter(rateVaried, undefined, 667, 0.8, { occurrenceSeed }).length);
    expect(new Set(counts).size).toBeGreaterThan(1);
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

    expect(sampleNativeEmitter(emitter, identityBone, 667, 1.5)[0].position).toEqual(pivot);
  });

  it("retains world-space birth positions while local particles follow a moving source", () => {
    const movingSource = (timeSeconds: number): NativeMatrix =>
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, timeSeconds * 10, 0, 0, 1];
    const base = {
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(2),
      lifespan: constantTrack(2),
    };

    const world = sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20021 }), undefined, 667, 0.75, {
      sourceTransformAtTime: movingSource,
    });
    const local = sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20031 }), undefined, 667, 0.75, {
      sourceTransformAtTime: movingSource,
    });

    expect(world.map((particle) => particle.position[0])).toEqual([5]);
    expect(local.map((particle) => particle.position[0])).toEqual([7.5]);
    expect(sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20021 }), undefined, 667, 0.75, {
      sourceTransformAtTime: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    })).toEqual(sampleNativeEmitter(makeEmitter({ ...base, flags: 0x20021 }), undefined, 667, 0.75));
  });

  it("stops births at visual arrival while already emitted particles finish their lifespans", () => {
    const emitter = makeEmitter({
      emissionSpeed: constantTrack(0),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      emissionRate: constantTrack(2),
      lifespan: constantTrack(2),
    });

    expect(sampleNativeEmitter(emitter, undefined, 667, 0.75, { emissionEndSeconds: 0.75 }).map(({ spawnIndex }) => spawnIndex)).toEqual([0]);
    expect(sampleNativeEmitter(emitter, undefined, 667, 1.5, { emissionEndSeconds: 0.75 }).map(({ spawnIndex }) => spawnIndex)).toEqual([0]);
    expect(sampleNativeEmitter(emitter, undefined, 667, 2.6, { emissionEndSeconds: 0.75 })).toEqual([]);
  });

  it("applies the bone transform to local-space emitters", () => {
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

    // 180-degree turn about Y maps the emitter offset and +Z emission direction.
    const sample = sampleNativeEmitter(emitter, transformedBone, 667, 1.25)[0];
    expect(sample.position[0]).toBeCloseTo(4.25, 5);
    expect(sample.position[1]).toBeCloseTo(3.5, 5);
    expect(sample.position[2]).toBeCloseTo(4.75, 5);
    expect(sample.velocity[0]).toBeCloseTo(2, 5);
    expect(sample.velocity[1]).toBeCloseTo(0, 5);
    expect(sample.velocity[2]).toBeCloseTo(0, 5);
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
      horizontalRange: constantTrack(Math.PI / 2),
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
    }, undefined, 667, 1.005)[0];
    // Radial emission: velocity is the unit direction of the birth offset.
    const radius = Math.hypot(radial.position[0], radial.position[1], radial.position[2]);
    expect(radial.velocity[0]).toBeCloseTo(radial.position[0] / radius, 5);
    expect(radial.velocity[1]).toBeCloseTo(radial.position[1] / radius, 5);
    expect(radial.velocity[2]).toBeCloseTo(radial.position[2] / radius, 5);
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
    const samples = sampleNativeEmitter(sphere, undefined, 667, 1);
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

    const samples = sampleNativeEmitter(varied, undefined, 667, 1.9);
    expect(samples.length).toBeGreaterThan(2);
    expect(samples).toEqual(sampleNativeEmitter(varied, undefined, 667, 1.9));
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
  it("steers nonzero authored zSource away from its source point", () => {
    const emitter = makeEmitter({ position: [1, 2, 0], emissionSpeed: constantTrack(1),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]), zSource: constantTrack(2), emissionRate: constantTrack(1) });
    const particle = sampleNativeEmitter(emitter, undefined, 667, 1.005)[0];
    // Emitter position is part of its transform; generator offset is zero.
    expect(particle.velocity[0]).toBeCloseTo(0);
    expect(particle.velocity[1]).toBeCloseTo(0);
    expect(particle.velocity[2]).toBeCloseTo(-1);
  });

  it("applies an earlier parent bone transform to a child emitter", () => {
    const parent = makeBone();
    const child = { ...makeBone(), parentIndex: 0, translation: constantTrack<Vector3Tuple>([0, 2, 0]) };
    const emitter = makeEmitter({ emissionSpeed: constantTrack(0), boneIndex: 1,
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]), emissionRate: constantTrack(1) });
    const sample = sampleNativeEmitter(emitter, child, 667, 1.005, { bones: [parent, child] })[0];
    expect(sample.position).toEqual([1, 2, 0]);
  });

  it("keeps a separate authored variation on the second axis", () => {
    const base = makeEmitter({ scaleVariation: [0, 1], emissionRate: constantTrack(1) });
    const shared = sampleNativeEmitter(base, undefined, 667, 1.5)[0].size;
    const separate = sampleNativeEmitter({ ...base, flags: base.flags | 0x80000 }, undefined, 667, 1.5)[0].size;
    expect(shared).toEqual([3, 5]);
    expect(separate[0]).toBe(shared[0]);
    expect(separate[1]).not.toBe(shared[1]);
  });

  it("samples the authored EXP2 lifetime alpha cutoff", () => {
    const emitter = makeEmitter({ alphaCutoff: particleTrack([0, 32767], [0, 0.5]), emissionRate: constantTrack(1) });
    expect(sampleNativeEmitter(emitter, undefined, 667, 1.5)[0].alphaCutoff).toBeCloseTo(0.125);
  });

  it("prefers the EXP2 static z-source over the legacy track", () => {
    const emitter = makeEmitter({
      position: [1, 2, 0],
      emissionSpeed: constantTrack(1),
      gravity: constantTrack<Vector3Tuple>([0, 0, 0]),
      zSource: constantTrack(0),
      exp2: { zSource: 2, colorMultiplier: 1, alphaMultiplier: 1 },
      emissionRate: constantTrack(1),
    });
    const particle = sampleNativeEmitter(emitter, undefined, 667, 1.005)[0];
    expect(particle.velocity[0]).toBeCloseTo(0);
    expect(particle.velocity[1]).toBeCloseTo(0);
    expect(particle.velocity[2]).toBeCloseTo(-1);
  });

  it("scrolls secondary and tertiary UVs from the authored multi-texture parameters", () => {
    const scrollEmitter = makeEmitter({
      flags: 0x10020021,
      emissionRate: constantTrack(1),
      lifespan: constantTrack(4),
      multiTextureParam0: [[0.5, 0], [0, 0]],
      multiTextureParam1: [[0, 0], [0, 0]],
    });
    const sampleAt = (time: number) => sampleNativeEmitter(scrollEmitter, undefined, 667, time)
      .find((sample) => sample.spawnIndex === 0)!;

    const initial = sampleAt(1.005).uvScrollOffsets;
    expect(initial).toBeDefined();
    expect(initial!.flat().every((value) => value >= 0 && value < 1)).toBe(true);
    expect(sampleAt(2.005).uvScrollOffsets![1]).toEqual(initial![1]);

    const half = sampleAt(2.005).uvScrollOffsets!;
    expect(half[0][0]).toBeCloseTo(initial![0][0] < 0.5 ? initial![0][0] + 0.5 : initial![0][0] - 0.5, 10);
    expect(half[0][1]).toBeCloseTo(initial![0][1], 10);
    expect(sampleAt(3.005).uvScrollOffsets![0][0]).toBeCloseTo(initial![0][0], 10);
    expect(sampleAt(2.005).uvScrollOffsets).toEqual(half);

    const plain = makeEmitter({ emissionRate: constantTrack(1) });
    expect(sampleNativeEmitter(plain, undefined, 667, 1.005)[0].uvScrollOffsets).toBeUndefined();
  });
});

describe("quaternion track interpolation", () => {
  const rotationTrack = (values: QuaternionTuple[]): NativeTrack<QuaternionTuple> => ({
    interpolation: 1,
    globalSequence: -1,
    sequences: [{ timestamps: values.map((_, index) => index * 1000), values }],
  });

  it("slerps bone rotations along the shortest arc", () => {
    const half = Math.SQRT1_2;
    const mid = sampleNativeTrack(rotationTrack([[0, 0, 0, 1], [0, 0, half, half]]), 500, 1000, [0, 0, 0, 1]);
    expect(mid[0]).toBeCloseTo(0, 5);
    expect(mid[1]).toBeCloseTo(0, 5);
    expect(mid[2]).toBeCloseTo(Math.sin(Math.PI / 8), 5);
    expect(mid[3]).toBeCloseTo(Math.cos(Math.PI / 8), 5);
  });

  it("resolves antipodal key pairs to the same rotation", () => {
    const half = Math.SQRT1_2;
    const identity = sampleNativeTrack(rotationTrack([[0, 0, 0, 1], [0, 0, 0, -1]]), 500, 1000, [0, 0, 0, 1]);
    expect(identity).toEqual([expect.closeTo(0), expect.closeTo(0), expect.closeTo(0), expect.closeTo(1)]);

    const negated = sampleNativeTrack(rotationTrack([[0, 0, half, half], [0, 0, -half, -half]]), 250, 1000, [0, 0, 0, 1]);
    expect(negated[2]).toBeCloseTo(half, 5);
    expect(negated[3]).toBeCloseTo(half, 5);
  });
});
