import { expect, test } from "@playwright/test";

test("native actor samples asymmetric environment UVs with the WWV sign", async ({ page }, testInfo) => {
  await page.route("**/m2-actor-env-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("/m2-actor-env-fixture");

  const samples = await page.evaluate(async () => {
    const three = await import("/node_modules/.vite/deps/three.js");
    const { buildM2ModelFixture, buildSkinFixture } = await import("/src/m2/fixtures.ts");
    const { parseM2File, parseSkinFile } = await import("/src/m2/model.ts");
    const { createNativeM2Actor } = await import("/src/m2/renderer.ts");
    const { DataTexture, NearestFilter, NoBlending, OrthographicCamera, RGBAFormat, Scene,
      UnsignedByteType, WebGLRenderer } = three;
    const normals = [[0.6, 0.4, 0.7], [-0.6, 0.4, 0.7], [0.6, -0.4, 0.7]];
    const vertices = [[-0.8, -0.8, 0], [0.8, -0.8, 0], [0.8, 0.8, 0], [-0.8, 0.8, 0]];
    const model = parseM2File(buildM2ModelFixture({
      vertices: vertices.map((position) => ({ position, normal: normals[0] as [number, number, number],
        uvs: [[0.5, 0.5]], boneIndices: [0, 0, 0, 0], boneWeights: [255, 0, 0, 0] })),
      bones: [{ pivot: [0, 0, 0] }], textures: [{ type: 0 }], textureLookup: [0],
      materials: [{ flags: 1, blendMode: 0 }],
    }), 9030);
    const skin = parseSkinFile(buildSkinFixture({
      vertexLookup: [0, 1, 2, 3], indices: [0, 1, 2, 0, 2, 3],
      sections: [{ meshPartId: 0, vertexStart: 0, vertexCount: 4, indexStart: 0, indexCount: 6 }],
      batches: [{ shaderId: 0x90, textureCount: 1, sectionIndex: 0, materialIndex: 0 }],
    }), 9031);
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) pixels.set([x * 32, y * 32, (x ^ y) * 16, 255], (y * 8 + x) * 4);
    }
    const texture = new DataTexture(pixels, 8, 8, RGBAFormat, UnsignedByteType);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.needsUpdate = true;
    const actor = createNativeM2Actor({ model, skin, label: "env-fixture", textures: new Map([[0, texture]]) });
    actor.batches[0].material.blending = NoBlending;
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(64, 64);
    renderer.setClearColor(0x000000, 1);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 3;
    camera.lookAt(0, 0, 0);
    const scene = new Scene();
    scene.add(actor.root);
    const sample = new Uint8Array(4);
    const results = [];
    for (const normal of normals) {
      const normalsAttribute = actor.batches[0].mesh.geometry.getAttribute("normal");
      for (let vertex = 0; vertex < 4; vertex += 1) normalsAttribute.setXYZ(vertex, ...normal);
      normalsAttribute.needsUpdate = true;
      renderer.render(scene, camera);
      renderer.getContext().readPixels(32, 32, 1, 1, renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE, sample);
      results.push({ normal, pixel: Array.from(sample) });
    }
    actor.dispose();
    texture.dispose();
    renderer.dispose();
    return results;
  });

  await testInfo.attach("environment-uv-gpu-samples", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
  for (const { normal, pixel } of samples) {
    const length = Math.hypot(...normal);
    const [nx, ny, nz] = normal.map((component) => component / length);
    const reflection = [2 * nz * nx, 2 * nz * ny, -1 + 2 * nz * nz];
    const denominator = Math.hypot(reflection[0], reflection[1], reflection[2] + 1);
    const uv = [0.5 - reflection[0] / (2 * denominator), 0.5 - reflection[1] / (2 * denominator)];
    const x = Math.floor(uv[0] * 8);
    const y = Math.floor(uv[1] * 8);
    expect(pixel, `normal ${normal.join(",")} should sample UV ${uv.join(",")}`)
      .toEqual([x * 32, y * 32, (x ^ y) * 16, 255]);
  }
});
