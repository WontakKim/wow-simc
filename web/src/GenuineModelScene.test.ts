import { BufferGeometry, Mesh, MeshStandardMaterial, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { configureVulperaMaterials } from "./GenuineModelScene";

describe("configureVulperaMaterials", () => {
  it("uses the exported alpha channel only for the Vulpera eye reflection", () => {
    const root = new Object3D();
    const eyeReflection = new MeshStandardMaterial({ name: "vulperamale_eyereflect" });
    const body = new MeshStandardMaterial({ name: "data-1" });
    root.add(new Mesh(new BufferGeometry(), [eyeReflection, body]));

    configureVulperaMaterials(root);

    expect(eyeReflection.transparent).toBe(true);
    expect(eyeReflection.depthWrite).toBe(false);
    expect(body.transparent).toBe(false);
    expect(body.depthWrite).toBe(true);
  });
});
