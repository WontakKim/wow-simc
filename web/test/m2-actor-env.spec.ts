import { expect, test } from "@playwright/test";
import { Matrix3, Matrix4, Vector3 } from "three";

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

const normalScaleCases = [
  { name: "identity", rootScale: [1, 1, 1], rootAngle: 0, boneScale: [1, 1, 1], boneAngle: 0 },
  { name: "root scale", rootScale: [2, 1, 1], rootAngle: 0.35, boneScale: [1, 1, 1], boneAngle: 0 },
  { name: "bone scale", rootScale: [1, 1, 1], rootAngle: 0, boneScale: [2, 1, 1], boneAngle: 0.4 },
  { name: "combined scale", rootScale: [2, 1.3, 1], rootAngle: 0.35, boneScale: [1, 2, 1], boneAngle: -0.3 },
  { name: "reflection", rootScale: [-2, 1, 1], rootAngle: 0.2, boneScale: [1, 1, 1], boneAngle: 0 },
  { name: "singular", rootScale: [1, 1, 0], rootAngle: 0, boneScale: [1, 1, 1], boneAngle: 0 },
] as const;

test("native actor uses transformed surface normals for environment UVs and lighting", async ({ page }, testInfo) => {
  await page.route("**/m2-actor-normal-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("/m2-actor-normal-fixture");

  const normal = [0.6, 0.4, 0.7] as const;
  const samples = await page.evaluate(async (cases) => {
    const three = await import("/node_modules/.vite/deps/three.js");
    const { buildM2ModelFixture, buildSkinFixture } = await import("/src/m2/fixtures.ts");
    const { parseM2File, parseSkinFile } = await import("/src/m2/model.ts");
    const { createNativeM2Actor } = await import("/src/m2/renderer.ts");
    const { DataTexture, Matrix4, NearestFilter, NoBlending, OrthographicCamera, RGBAFormat, Scene,
      UnsignedByteType, Vector3, WebGLRenderer } = three;
    const normal = [0.6, 0.4, 0.7];
    const vertices = [[-0.3, -0.3, 0], [0.3, -0.3, 0], [0.3, 0.3, 0], [-0.3, 0.3, 0]];
    const model = parseM2File(buildM2ModelFixture({
      vertices: vertices.map((position) => ({ position, normal, uvs: [[0.5, 0.5]],
        boneIndices: [0, 0, 0, 0], boneWeights: [255, 0, 0, 0] })),
      bones: [{ pivot: [0, 0, 0] }], textures: [{ type: 0 }], textureLookup: [0],
      materials: [{ flags: 2, blendMode: 0 }],
    }), 9032);
    const skin = parseSkinFile(buildSkinFixture({
      vertexLookup: [0, 1, 2, 3], indices: [0, 1, 2, 0, 2, 3],
      sections: [{ meshPartId: 0, vertexStart: 0, vertexCount: 4, indexStart: 0, indexCount: 6 }],
      batches: [{ shaderId: 0x90, textureCount: 1, sectionIndex: 0, materialIndex: 0 }],
    }), 9033);
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) pixels.set([x * 32, y * 32, 0, 255], (y * 8 + x) * 4);
    }
    const texture = new DataTexture(pixels, 8, 8, RGBAFormat, UnsignedByteType);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.needsUpdate = true;
    const actor = createNativeM2Actor({ model, skin, label: "normal-fixture", textures: new Map([[0, texture]]) });
    const material = actor.batches[0].material;
    material.blending = NoBlending;
    material.uniforms.u_ambient_sky.value.set(0, 0, 0);
    material.uniforms.u_ambient_horizon.value.set(0, 0, 0);
    material.uniforms.u_ambient_ground.value.set(0, 0, 0);
    material.uniforms.u_sun_color.value.set(1, 1, 1);
    material.uniforms.u_sun_direction.value.set(0.8, 0.6, 0);
    material.uniforms.u_local_light.value.set(0, 0, 0);
    material.uniforms.u_unlit_add.value.set(0, 0, 0);
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(64, 64);
    renderer.setClearColor(0x000000, 1);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0.6, 0, 3);
    camera.lookAt(0, 0, 0);
    const scene = new Scene();
    scene.add(actor.root);
    const sample = new Uint8Array(4);
    const results = [];
    for (const testCase of cases) {
      actor.root.rotation.z = testCase.rootAngle;
      actor.root.scale.set(...testCase.rootScale);
      const bone = new Matrix4().makeRotationZ(testCase.boneAngle)
        .scale(new Vector3(...testCase.boneScale));
      actor.setPose([bone.toArray()]);
      material.uniforms.u_vertex_shader.value = 1;
      material.uniforms.u_apply_lighting.value = 0;
      renderer.render(scene, camera);
      renderer.getContext().readPixels(32, 32, 1, 1, renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE, sample);
      const environment = Array.from(sample);
      pixels.fill(255);
      texture.needsUpdate = true;
      material.uniforms.u_vertex_shader.value = 0;
      material.uniforms.u_apply_lighting.value = 1;
      renderer.render(scene, camera);
      renderer.getContext().readPixels(32, 32, 1, 1, renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE, sample);
      results.push({ name: testCase.name, environment, lighting: Array.from(sample) });
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) pixels.set([x * 32, y * 32, 0, 255], (y * 8 + x) * 4);
      }
      texture.needsUpdate = true;
    }
    actor.dispose();
    texture.dispose();
    renderer.dispose();
    return results;
  }, normalScaleCases);

  await testInfo.attach("actor-normal-gpu-samples", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
  const camera = new Matrix4().lookAt(new Vector3(0.6, 0, 3), new Vector3(), new Vector3(0, 1, 0));
  camera.setPosition(0.6, 0, 3);
  const viewMatrix = camera.clone().invert();
  const sourceNormal = new Vector3(...normal);
  const viewPosition = new Vector3(0, 0, 0).applyMatrix4(viewMatrix).normalize();
  for (const [index, testCase] of normalScaleCases.entries()) {
    const root = new Matrix4().makeRotationZ(testCase.rootAngle).scale(new Vector3(...testCase.rootScale));
    const bone = new Matrix4().makeRotationZ(testCase.boneAngle).scale(new Vector3(...testCase.boneScale));
    const world = root.multiply(bone);
    const view = viewMatrix.clone().multiply(world);
    const expectedNormal = (transform: Matrix4) => {
      if (transform.determinant() === 0) {
        const fallback = sourceNormal.clone().applyMatrix3(new Matrix3().setFromMatrix4(transform));
        return (fallback.lengthSq() > 0 ? fallback : sourceNormal.clone()).normalize();
      }
      return sourceNormal.clone().applyMatrix3(new Matrix3().getNormalMatrix(transform)).normalize();
    };
    const viewNormal = expectedNormal(view);
    const reflection = viewPosition.clone().reflect(viewNormal);
    const denominator = Math.hypot(reflection.x, reflection.y, reflection.z + 1);
    const environment = [
      Math.floor((0.5 - reflection.x / (2 * denominator)) * 8) * 32,
      Math.floor((0.5 - reflection.y / (2 * denominator)) * 8) * 32, 0, 255,
    ];
    const lighting = Math.round(255 * Math.max(0, expectedNormal(world).dot(new Vector3(0.8, 0.6, 0))));
    expect(samples[index].environment, `${testCase.name} environment view normal`).toEqual(environment);
    for (const channel of samples[index].lighting.slice(0, 3)) {
      expect(channel, `${testCase.name} world normal lighting`).toBeGreaterThanOrEqual(lighting - 2);
      expect(channel, `${testCase.name} world normal lighting`).toBeLessThanOrEqual(lighting + 2);
    }
  }
});

test("native actor edge fade scales mesh RGBA once before the PS7 combiner", async ({ page }, testInfo) => {
  await page.route("**/m2-actor-edge-fade-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("/m2-actor-edge-fade-fixture");

  const samples = await page.evaluate(async () => {
    const three = await import("/node_modules/.vite/deps/three.js");
    const { buildM2ModelFixture, buildSkinFixture } = await import("/src/m2/fixtures.ts");
    const { parseM2File, parseSkinFile } = await import("/src/m2/model.ts");
    const { createNativeM2Actor } = await import("/src/m2/renderer.ts");
    const { DataTexture, NoBlending, OrthographicCamera, RGBAFormat, Scene,
      UnsignedByteType, WebGLRenderer } = three;
    const normals = [[1, 0, 0], [Math.sqrt(2 / 3), 0, Math.sqrt(1 / 3)], [0, 0, 1]];
    const vertices = [[-0.8, -0.8, 0], [0.8, -0.8, 0], [0.8, 0.8, 0], [-0.8, 0.8, 0]];
    const model = parseM2File(buildM2ModelFixture({
      vertices: vertices.map((position) => ({ position, normal: normals[0] as [number, number, number],
        uvs: [[0.5, 0.5], [0.5, 0.5]], boneIndices: [0, 0, 0, 0], boneWeights: [255, 0, 0, 0] })),
      bones: [{ pivot: [0, 0, 0] }], textures: [{ type: 0 }, { type: 0 }], textureLookup: [0, 1],
      materials: [{ flags: 3, blendMode: 2 }],
    }), 9034);
    const skin = parseSkinFile(buildSkinFixture({
      vertexLookup: [0, 1, 2, 3], indices: [0, 1, 2, 0, 2, 3],
      sections: [{ meshPartId: 0, vertexStart: 0, vertexCount: 4, indexStart: 0, indexCount: 6 }],
      batches: [
        { shaderId: 0x8021, textureCount: 2, sectionIndex: 0, materialIndex: 0 }, // VS12/PS7
        { shaderId: 0x4014, textureCount: 2, sectionIndex: 0, materialIndex: 0 }, // VS2/PS7
      ],
    }), 9035);
    const textures = [
      new DataTexture(new Uint8Array([128, 192, 64, 192]), 1, 1, RGBAFormat, UnsignedByteType),
      new DataTexture(new Uint8Array([96, 128, 128, 128]), 1, 1, RGBAFormat, UnsignedByteType),
    ];
    textures.forEach((texture) => { texture.needsUpdate = true; });
    const actor = createNativeM2Actor({ model, skin, label: "edge-fade-fixture",
      textures: new Map(textures.map((texture, index) => [index, texture])) });
    actor.batches.forEach(({ material }) => {
      material.blending = NoBlending;
      material.uniforms.u_mesh_color.value.set(0.75, 0.5, 0.625, 0.625);
    });
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(65, 65);
    renderer.setClearColor(0x000000, 1);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 3;
    camera.lookAt(0, 0, 0);
    const scene = new Scene();
    scene.add(actor.root);
    const pixel = new Uint8Array(4);
    const samples = [];
    for (const [batchIndex, { material, mesh }] of actor.batches.entries()) {
      actor.batches.forEach((batch, index) => { batch.mesh.visible = index === batchIndex; });
      for (const normal of normals) {
        const attribute = mesh.geometry.getAttribute("normal");
        for (let vertex = 0; vertex < 4; vertex += 1) attribute.setXYZ(vertex, ...normal);
        attribute.needsUpdate = true;
        renderer.render(scene, camera);
        renderer.getContext().readPixels(32, 32, 1, 1, renderer.getContext().RGBA,
          renderer.getContext().UNSIGNED_BYTE, pixel);
        samples.push({ vertexShader: material.uniforms.u_vertex_shader.value,
          pixelShader: material.uniforms.u_pixel_shader.value, normal, pixel: Array.from(pixel) });
      }
    }
    actor.dispose();
    textures.forEach((texture) => texture.dispose());
    renderer.dispose();
    return samples;
  });

  await testInfo.attach("actor-edge-fade-gpu-samples", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
  // WWV forward m2Shader.frag.slang:103-125 multiplies vMeshColorAlpha by edgeFade before
  // calcM2FragMaterial. At the centered pixel the view direction is +Z, so the WWV
  // edgeScan curve gives 0, 0.5, 1 for these three normals. The exporter instead
  // fades only opacity; this test explicitly selects WWV's RGBA profile.
  const ps7 = [
    0.75 * (128 / 255) * (96 / 255) * 2,
    0.5 * (192 / 255) * (128 / 255) * 2,
    0.625 * (64 / 255) * (128 / 255) * 2,
    0.625 * (192 / 255) * (128 / 255) * 2,
  ];
  const fades = [0, 0.5, 1];
  expect(samples.map(({ vertexShader, pixelShader }) => [vertexShader, pixelShader])).toEqual([
    [12, 7], [12, 7], [12, 7], [2, 7], [2, 7], [2, 7],
  ]);
  samples.forEach(({ vertexShader, normal, pixel }, index) => {
    const fade = vertexShader === 12 ? fades[index % 3] : 1;
    ps7.forEach((channel, component) => {
      expect.soft(pixel[component], `VS${vertexShader}, normal ${normal.join(",")}, channel ${component}`)
        .toBeGreaterThanOrEqual(Math.round(channel * fade * 255) - 2);
      expect.soft(pixel[component], `VS${vertexShader}, normal ${normal.join(",")}, channel ${component}`)
        .toBeLessThanOrEqual(Math.round(channel * fade * 255) + 2);
    });
  });
});
