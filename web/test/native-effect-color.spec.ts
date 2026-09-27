import { expect, test } from "@playwright/test";

test("native particle, ribbon, and mesh shaders preserve display-domain color", async ({ page }, testInfo) => {
  await page.route("**/native-effect-color-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("/native-effect-color-fixture");

  const observations = await page.evaluate(async () => {
    const three = await import("/node_modules/.vite/deps/three.js");
    const { NativeParticleEffect } = await import("/src/NativeParticleEffect.ts");
    const { parseNativeM2, parseNativeSkin } = await import("/src/nativeM2.ts");
    const {
      ACESFilmicToneMapping, BufferAttribute, DataTexture, InstancedBufferGeometry, Mesh,
      NoBlending, NoColorSpace, NoToneMapping, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial,
      SRGBColorSpace, UnsignedByteType, WebGLRenderer,
    } = three;
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(32, 32);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 3;
    camera.lookAt(0, 0, 0);
    const scene = new Scene();
    const bytes = new Uint8Array(4);
    const readCenter = () => {
      renderer.getContext().readPixels(16, 16, 1, 1, renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE, bytes);
      return Array.from(bytes.slice(0, 3));
    };
    const makeTexture = (value) => {
      const texture = new DataTexture(new Uint8Array([value, value, value, 255]), 1, 1, RGBAFormat, UnsignedByteType);
      texture.needsUpdate = true;
      return texture;
    };
    const loadBytes = async (id, extension) => {
      const response = await fetch(`/model/native-effects/${id}.${extension}`);
      if (!response.ok) throw new Error(`Missing fixture ${id}.${extension}: ${response.status}`);
      return response.arrayBuffer();
    };
    const models = await Promise.all([794788, 4329984, 6211617].map(async (id) =>
      parseNativeM2(await loadBytes(id, "m2"), id)));
    const skin = parseNativeSkin(await loadBytes(6212146, "skin"), 6212146, models[2].vertices.length);
    const results = [];
    for (const toneMapping of [NoToneMapping, ACESFilmicToneMapping]) {
      renderer.toneMapping = toneMapping;
      for (const [kind, model, color] of ["particle", "ribbon", "mesh"].flatMap((name, index) =>
        [[5, 5, 5], [128, 128, 128], [12, 96, 203]].map((sample) => [name, models[index], sample]))) {
        const whiteTexture = makeTexture(255);
        const decodedTextures = model.textureFileDataIds.map(() => ({
          pixels: new Uint8Array([...color, 255]), width: 1, height: 1,
        }));
        const effect = new NativeParticleEffect(model, decodedTextures, 1, kind === "mesh" ? skin : undefined);
        const sourceMesh = kind === "mesh" ? effect.group.children.at(-1)
          : kind === "ribbon" ? effect.group.children.find((child) => child.material.fragmentShader.includes("vRibbonColor"))
            : effect.group.children.find((child) => child.geometry instanceof InstancedBufferGeometry);
        if (!sourceMesh) throw new Error(`No ${kind} material in source fixture`);
        const material = sourceMesh.material;
        const sampleTexture = kind === "mesh" ? material.uniforms.primaryMap.value : material.uniforms.map.value;
        if (sampleTexture.colorSpace !== NoColorSpace) throw new Error(`${kind} texture is not display-domain`);
        const geometry = kind === "particle" ? sourceMesh.geometry : new PlaneGeometry(1.6, 1.6);
        if (kind === "particle") {
          geometry.instanceCount = 1;
          geometry.getAttribute("instanceSize").setXY(0, 0.8, 0.8);
          geometry.getAttribute("instanceColor").setXYZW(0, 1, 1, 1, 1);
          geometry.getAttribute("instanceUvRect").setXYZW(0, 0, 0, 1, 1);
          if (material.uniforms.map2) material.uniforms.map2.value = whiteTexture;
          if (material.uniforms.map3) material.uniforms.map3.value = whiteTexture;
          material.uniforms.uColorMult.value = 1;
          material.uniforms.uAlphaTest.value = 0;
        } else if (kind === "ribbon") {
          geometry.setAttribute("ribbonColor", new BufferAttribute(new Float32Array(16).fill(1), 4));
          material.uniforms.uAlphaTest.value = 0;
        } else {
          material.uniforms.secondaryMap.value = whiteTexture;
          material.uniforms.meshColor.value.setRGB(0.5, 0.5, 0.5);
          material.uniforms.meshOpacity.value = 1;
        }
        // Compare fragment output without the authored blend factors mixing in the clear color.
        material.blending = NoBlending;
        const effectMesh = new Mesh(geometry, material);
        scene.add(effectMesh);
        renderer.render(scene, camera);
        const actual = readCenter();
        scene.remove(effectMesh);
        const referenceMaterial = new ShaderMaterial({
          uniforms: { map: { value: sampleTexture } },
          vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
          fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }",
          toneMapped: false,
        });
        const referenceMesh = new Mesh(new PlaneGeometry(1.6, 1.6), referenceMaterial);
        scene.add(referenceMesh);
        renderer.render(scene, camera);
        const reference = readCenter();
        scene.remove(referenceMesh);
        referenceMesh.geometry.dispose();
        referenceMaterial.dispose();
        if (kind !== "particle") geometry.dispose();
        whiteTexture.dispose();
        effect.dispose();
        results.push({ kind, color, toneMapping: toneMapping === NoToneMapping ? "application" : "ACES stress", actual, reference });
      }
    }
    renderer.dispose();
    return results;
  });

  await testInfo.attach("gpu-color-samples", {
    body: JSON.stringify(observations, null, 2), contentType: "application/json",
  });
  for (const { kind, color, toneMapping, actual, reference } of observations) {
    expect(reference, `${kind} raw reference at ${color} with ${toneMapping}`).toEqual(color);
    expect.soft(actual, `${kind} GPU output at ${color} with ${toneMapping}; reference ${reference}`).toEqual(reference);
  }
});
