// Native M2 -> three.js coordinate conversion. Native M2 models are Z-up with
// a left-handed feel on Y; three.js is Y-up right-handed. The map is applied
// exactly once, at the scene boundary (task N2), never inside the loader.

import type { Vec3 } from "./model";
import { multiplyMatrices } from "./sampler";

/** Native (x, y, z) -> three (x, z, -y). */
export function nativeToThreePoint(point: Vec3): Vec3 {
  return [point[0], point[2], -point[1]];
}

export function threeToNativePoint(point: Vec3): Vec3 {
  return [point[0], -point[2], point[1]];
}

// C maps native basis vectors to three basis vectors (column-major): e1 -> e1,
// e2 -> -e3, e3 -> e2. C is a proper rotation, so C^-1 = C^T.
const C: number[] = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

/** The Z-up -> Y-up basis for a whole native actor: native +Z (up) -> three
 * +Y, native +X -> three +X, native +Y -> three -Z. Apply once at the actor
 * root; nativeToThreeMatrix(identity) conjugates C away into the identity, so
 * pass this matrix directly instead. */
export const NATIVE_TO_THREE_BASIS: number[] = C;

function transpose(matrix: number[]): number[] {
  return [
    matrix[0], matrix[4], matrix[8], matrix[12],
    matrix[1], matrix[5], matrix[9], matrix[13],
    matrix[2], matrix[6], matrix[10], matrix[14],
    matrix[3], matrix[7], matrix[11], matrix[15],
  ];
}

/** Converts a native-space transform into three space: C · M · C^-1. */
export function nativeToThreeMatrix(matrix: number[]): number[] {
  return multiplyMatrices(C, multiplyMatrices(matrix, transpose(C)));
}

/** Converts a three-space transform back into native space: C^-1 · M · C. */
export function threeToNativeMatrix(matrix: number[]): number[] {
  return multiplyMatrices(transpose(C), multiplyMatrices(matrix, C));
}

export function matrix3Determinant(matrix: number[]): number {
  return (
    matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
    - matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9])
    + matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5])
  );
}
