import { describe, expect, it } from "vitest";
import {
  matrix3Determinant,
  nativeToThreeMatrix,
  nativeToThreePoint,
  threeToNativeMatrix,
  threeToNativePoint,
} from "./coordinates";

describe("nativeToThreePoint", () => {
  it("maps (x, y, z) to (x, z, -y)", () => {
    expect(nativeToThreePoint([1, -2, 3])).toEqual([1, 3, 2]);
    expect(nativeToThreePoint([0, 1, 0])).toEqual([0, 0, -1]);
  });

  it("round-trips with threeToNativePoint", () => {
    for (const point of [[0, 0, 0], [1, 2, 3], [-4.5, 0.25, -9]] as const) {
      expect(threeToNativePoint(nativeToThreePoint([...point] as [number, number, number])))
        .toEqual([...point].map((value) => expect.closeTo(value, 6)));
    }
  });
});

describe("nativeToThreeMatrix", () => {
  const rotationZNative = (theta: number): number[] => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // Column-major rotation about native +Z.
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  };
  const rotationYThree = (theta: number): number[] => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // Column-major rotation about three +Y.
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  };
  const applyMatrix = (m: number[], v: [number, number, number]): [number, number, number] => [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];

  it("is a proper rotation with determinant +1", () => {
    const converted = nativeToThreeMatrix(rotationZNative(Math.PI / 3));
    expect(matrix3Determinant(converted)).toBeCloseTo(1, 6);
  });

  it("maps native +Z to three +Y: the converted rotation keeps three +Y fixed", () => {
    const converted = nativeToThreeMatrix(rotationZNative(Math.PI / 3));
    expect(applyMatrix(converted, [0, 1, 0])).toEqual([0, 1, 0].map((value) => expect.closeTo(value, 6)));
  });

  it("turns a native Z rotation into a three Y rotation of the same angle", () => {
    const theta = Math.PI / 3;
    const converted = nativeToThreeMatrix(rotationZNative(theta));
    const expected = rotationYThree(theta);
    expect(converted).toEqual(expected.map((value) => expect.closeTo(value, 6)));
  });

  it("transforms translations into the converted frame", () => {
    const translateNative: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 5, -7, 1];
    const converted = nativeToThreeMatrix(translateNative);
    // Native translation (2, 5, -7) becomes three translation (2, -7, -5).
    expect(applyMatrix(converted, [0, 0, 0])).toEqual([2, -7, -5].map((value) => expect.closeTo(value, 6)));
  });

  it("round-trips through threeToNativeMatrix", () => {
    const original = rotationZNative(1.234);
    original[12] = 3;
    original[13] = -4;
    original[14] = 5;
    const roundTrip = threeToNativeMatrix(nativeToThreeMatrix(original));
    expect(roundTrip).toEqual(original.map((value) => expect.closeTo(value, 5)));
  });
});
