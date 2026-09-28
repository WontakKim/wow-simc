import { expect, test } from "@playwright/test";

test("native actor routes PS26/27/28 texture coordinates and VS11 animated stage 2", async ({ page }, testInfo) => {
  await page.route("**/m2-actor-uv-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("/m2-actor-uv-fixture");

  const samples = await page.evaluate(async () => {
    const three = await import("/node_modules/.vite/deps/three.js");
    const { buildM2ModelFixture, buildSkinFixture } = await import("/src/m2/fixtures.ts");
    const { parseM2File, parseSkinFile } = await import("/src/m2/model.ts");
    const { createNativeM2Actor } = await import("/src/m2/renderer.ts");
    const { resolveSequence } = await import("/src/m2/sampler.ts");
    const { DataTexture, NearestFilter, NoBlending, OrthographicCamera, RGBAFormat, Scene,
      UnsignedByteType, WebGLRenderer } = three;
    const positions = [[-0.8, -0.8, 0], [0.8, -0.8, 0], [0.8, 0.8, 0], [-0.8, 0.8, 0]];
    const model = parseM2File(buildM2ModelFixture({
      sequences: [{ animationId: 0, durationMs: 1000, flags: 0x20 }], sequenceLookup: [0],
      vertices: positions.map((position) => ({ position, normal: [0, 0, 1],
        uvs: [[0.125, 0.125], [0.625, 0.375]], boneIndices: [0, 0, 0, 0], boneWeights: [255, 0, 0, 0] })),
      bones: [{ pivot: [0, 0, 0] }], textures: Array.from({ length: 4 }, () => ({ type: 0 })),
      textureLookup: [0, 1, 2, 3], materials: [{ flags: 1, blendMode: 2 }],
      textureTransforms: [[0.125, 0], [0.25, 0], [-0.25, 0.25]].map((offset) => ({
        translation: { sequences: [{ timestamps: [0, 1000], values: [[0, 0, 0], [...offset, 0]] }] },
      })),
      textureTransformLookup: [0, 1, 2],
    }), 9042);
    const skin = parseSkinFile(buildSkinFixture({
      vertexLookup: [0, 1, 2, 3], indices: [0, 1, 2, 0, 2, 3],
      sections: [{ meshPartId: 0, vertexStart: 0, vertexCount: 4, indexStart: 0, indexCount: 6 }],
      batches: [
        { shaderId: 0x8012, textureCount: 3 }, // VS0/PS26
        { shaderId: 0x8014, textureCount: 3 }, // VS11/PS27
        { shaderId: 0x8016, textureCount: 4 }, // VS2/PS28
      ],
    }), 9043);
    const makeTexture = (width: number, height: number, color: (x: number, y: number) => number[]) => {
      const data = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) data.set(color(x, y), (y * width + x) * 4);
      }
      const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.needsUpdate = true;
      return texture;
    };
    const textures = [
      makeTexture(1, 1, () => [255, 255, 255, 0]),
      makeTexture(8, 8, (x, y) => [x * 16, y * 16, 0, 255]),
      makeTexture(8, 8, (x, y) => [x * 24, y * 24, 0, 255]),
      makeTexture(8, 8, (x, y) => [0, 0, 0, x * 16 + y * 9 + 20]),
    ];
    const actor = createNativeM2Actor({ model, skin, label: "uv-fixture",
      textures: new Map(textures.map((texture, index) => [index, texture])) });
    actor.updateAnimatedTracks(resolveSequence(model, 0), 1000);
    actor.batches.forEach(({ material }) => { material.blending = NoBlending; });
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(32, 32);
    renderer.setClearColor(0x000000, 1);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 3;
    camera.lookAt(0, 0, 0);
    const scene = new Scene();
    scene.add(actor.root);
    const pixel = new Uint8Array(4);
    const thirdPixels = textures[2].image.data as Uint8Array;
    const results = [];
    for (const [name, batchIndex, thirdAlpha] of [
      ["PS26 shared UV1", 0, 255],
      ["PS27 environment UV2", 1, 0],
      ["VS11 stage 2 UV3", 1, 255],
      ["PS28 second-UV mask", 2, 255],
    ] as const) {
      for (let index = 3; index < thirdPixels.length; index += 4) thirdPixels[index] = thirdAlpha;
      textures[2].needsUpdate = true;
      actor.batches.forEach(({ mesh }, index) => { mesh.visible = index === batchIndex; });
      renderer.render(scene, camera);
      renderer.getContext().readPixels(16, 16, 1, 1, renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE, pixel);
      results.push({ name, pixel: Array.from(pixel),
        vertexShader: actor.batches[batchIndex].material.uniforms.u_vertex_shader.value,
        pixelShader: actor.batches[batchIndex].material.uniforms.u_pixel_shader.value });
    }
    actor.dispose();
    textures.forEach((texture) => texture.dispose());
    renderer.dispose();
    return results;
  });

  await testInfo.attach("actor-uv-gpu-samples", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
  expect(samples.map(({ vertexShader, pixelShader }) => [vertexShader, pixelShader])).toEqual([
    [0, 26], [11, 27], [11, 27], [2, 28],
  ]);
  // UV0 (0.125,0.125) + stage 0 (0.125,0) => texel (2,1).
  // The sampled pixel's +0.03125 view offset maps WWV environment UV to texel (3,3);
  // UV1 + stage 2 maps to texel (3,5).
  // UV1 (0.625,0.375) + stage 1 (0.25,0) => texel (7,3) for PS28's mask.
  expect.soft(samples[0].pixel, samples[0].name).toEqual([48, 24, 0, 255]);
  expect.soft(samples[1].pixel, samples[1].name).toEqual([96, 96, 0, 255]);
  expect.soft(samples[2].pixel, samples[2].name).toEqual([72, 120, 0, 255]);
  expect.soft(samples[3].pixel, samples[3].name).toEqual([48, 24, 0, 159]);
});
