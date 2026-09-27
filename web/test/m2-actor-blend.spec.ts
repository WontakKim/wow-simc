import { expect, test } from "@playwright/test";

test("native actor shader applies raw M2 blend alpha-discard rules", async ({ page }, testInfo) => {
  await page.route("**/m2-actor-blend-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("/m2-actor-blend-fixture");

  const samples = await page.evaluate(async () => {
    const three = await import("/node_modules/.vite/deps/three.js");
    const { buildM2ModelFixture, buildSkinFixture } = await import("/src/m2/fixtures.ts");
    const { parseM2File, parseSkinFile } = await import("/src/m2/model.ts");
    const { createNativeM2Actor } = await import("/src/m2/renderer.ts");
    const { DataTexture, NoBlending, OrthographicCamera, RGBAFormat, Scene, UnsignedByteType, WebGLRenderer } = three;
    const modes = [0, 1, 2, 3, 4, 5, 6, 7];
    const vertices = [[-0.8, -0.8, 0], [0.8, -0.8, 0], [0.8, 0.8, 0], [-0.8, 0.8, 0]]
      .map((position) => ({ position, normal: [0, 0, 1], uvs: [[0.5, 0.5]], boneIndices: [0, 0, 0, 0], boneWeights: [255, 0, 0, 0] }));
    const model = parseM2File(buildM2ModelFixture({
      vertices, bones: [{ pivot: [0, 0, 0] }], textures: [{ type: 0 }], textureLookup: [0],
      materials: modes.map((blendMode) => ({ flags: 1, blendMode })),
    }), 9010);
    const skin = parseSkinFile(buildSkinFixture({
      vertexLookup: [0, 1, 2, 3], indices: [0, 1, 2, 0, 2, 3],
      sections: [{ meshPartId: 0, vertexStart: 0, vertexCount: 4, indexStart: 0, indexCount: 6 }],
      batches: modes.map((materialIndex) => ({ shaderId: 0x10, textureCount: 1, materialIndex, sectionIndex: 0 })),
    }), 9011);
    const texture = new DataTexture(new Uint8Array([255, 255, 255, 64]), 1, 1, RGBAFormat, UnsignedByteType);
    texture.needsUpdate = true;
    const actor = createNativeM2Actor({ model, skin, label: "blend-fixture", textures: new Map([[0, texture]]) });
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(32, 32);
    renderer.setClearColor(0x000000, 1);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 3;
    camera.lookAt(0, 0, 0);
    const scene = new Scene();
    scene.add(actor.root);
    // Isolate fragment discard and opacity from destination-dependent blend factors.
    actor.batches.forEach(({ material }) => {
      material.blending = NoBlending;
      material.transparent = false;
      material.depthWrite = false;
      material.uniforms.u_mesh_color.value.w = 0.5;
    });
    const pixel = new Uint8Array(4);
    const samples = [];
    for (const alpha of [64, 128]) {
      texture.image.data[3] = alpha;
      texture.needsUpdate = true;
      for (const blendMode of modes) {
        actor.batches.forEach(({ mesh }, index) => { mesh.visible = index === blendMode; });
        renderer.render(scene, camera);
        renderer.getContext().readPixels(16, 16, 1, 1, renderer.getContext().RGBA,
          renderer.getContext().UNSIGNED_BYTE, pixel);
        samples.push({ blendMode, alpha, pixel: Array.from(pixel) });
      }
    }
    for (const blendMode of [5, 6]) {
      actor.batches[blendMode].material.uniforms.u_pixel_shader.value = 0;
      actor.batches.forEach(({ mesh }, index) => { mesh.visible = index === blendMode; });
      texture.image.data[3] = 64;
      texture.needsUpdate = true;
      renderer.render(scene, camera);
      renderer.getContext().readPixels(16, 16, 1, 1, renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE, pixel);
      samples.push({ blendMode, alpha: 64, noDiscardCombiner: true, pixel: Array.from(pixel) });
    }
    actor.dispose();
    texture.dispose();
    renderer.dispose();
    return samples;
  });

  await testInfo.attach("actor-blend-gpu-samples", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
  for (const { blendMode, alpha, noDiscardCombiner, pixel } of samples) {
    const shouldDiscard = !noDiscardCombiner && alpha < 128 && [1, 5, 6].includes(blendMode);
    const opacity = noDiscardCombiner || blendMode < 2 ? 0.5 : alpha / 255 * 0.5;
    const expected = shouldDiscard ? [0, 0, 0, 255] : [255, 255, 255, Math.round(opacity * 255)];
    expect(pixel, `raw blend ${blendMode}, texture alpha ${alpha}, PS${noDiscardCombiner ? 0 : 1}`)
      .toEqual(expected);
  }
});
