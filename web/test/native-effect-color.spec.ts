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

test("native particles alpha-test the EXP2-scaled result without premultiplying blend-7 RGB", async ({ page }, testInfo) => {
  await page.route("**/native-effect-alpha-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto("/native-effect-alpha-fixture");

  const observations = await page.evaluate(async () => {
    const three = await import("/node_modules/.vite/deps/three.js");
    const { NativeParticleEffect } = await import("/src/NativeParticleEffect.ts");
    const { parseNativeM2, parseNativeSkin } = await import("/src/nativeM2.ts");
    const {
      Mesh, NoBlending, NoToneMapping, OneFactor, OrthographicCamera, Scene, SRGBColorSpace, WebGLRenderer,
    } = three;
    const loadBytes = async (id, extension) => {
      const response = await fetch(`/model/native-effects/${id}.${extension}`);
      if (!response.ok) throw new Error(`Missing fixture ${id}.${extension}: ${response.status}`);
      return response.arrayBuffer();
    };
    const singleSource = parseNativeM2(await loadBytes(794788, "m2"), 794788);
    const multiSource = parseNativeM2(await loadBytes(6211617, "m2"), 6211617);
    const multiSkin = parseNativeSkin(await loadBytes(6212146, "skin"), 6212146, multiSource.vertices.length);
    const singleModel = { ...singleSource, ribbons: [], emitters: [{ ...singleSource.emitters[0],
      flags: (singleSource.emitters[0].flags | 0x20000) & ~0x10100000, blendingType: 7,
      exp2: { zSource: 0, colorMultiplier: 0.5, alphaMultiplier: 0.5 },
    }] };
    const multiModel = { ...multiSource, emitters: [multiSource.emitters[0]] };
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(32, 32);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 3;
    camera.lookAt(0, 0, 0);
    const scene = new Scene();
    const pixel = new Uint8Array(4);
    const results = [];
    for (const [kind, model, skin] of [["single", singleModel, undefined], ["multi", multiModel, multiSkin]]) {
      const textures = model.textureFileDataIds.map(() => ({ pixels: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 }));
      const effect = new NativeParticleEffect(model, textures, 1, skin);
      const source = effect.group.children[0];
      const { geometry, material } = source;
      const pixelShader = material.uniforms.uPixelShader.value;
      if (pixelShader !== (kind === "single" ? 0 : 2)) throw new Error(`Unexpected ${kind} pixel shader ${pixelShader}`);
      if (kind === "single" && (material.blendSrc !== OneFactor || material.uniforms.uAlphaMult.value !== 0.5
        || material.uniforms.uColorMult.value !== 0.5)) throw new Error("Blend-7 EXP2 fixture did not bind authored values");
      if (material.uniforms.uAlphaTest.value !== Math.fround(1 / 255)) throw new Error("Authored alpha threshold changed");
      material.blending = NoBlending;
      geometry.instanceCount = 1;
      geometry.getAttribute("instanceSize").setXY(0, 0.8, 0.8);
      geometry.getAttribute("instanceUvRect").setXYZW(0, 0, 0, 1, 1);
      const primary = material.uniforms.map.value;
      primary.image.data.set([200, 100, 50, 255]);
      primary.needsUpdate = true;
      if (kind === "multi") {
        material.uniforms.uColorMult.value = 0.5;
        material.uniforms.map2.value.image.data.set([255, 255, 255, 204]);
        material.uniforms.map2.value.needsUpdate = true;
        material.uniforms.map3.value.image.data.set([255, 255, 255, 191]);
        material.uniforms.map3.value.needsUpdate = true;
      }
      const mesh = new Mesh(geometry, material);
      scene.add(mesh);
      const cases = kind === "single" ? [
        { name: "scaled cutoff", alpha: 0.6, multiplier: 0.5, cutoff: 0.4, primaryAlpha: 255 },
        { name: "scaled alpha test", alpha: 0.6, multiplier: 0.005, cutoff: 0, primaryAlpha: 255 },
        { name: "cutoff equality", alpha: 0.5, multiplier: 0.5, cutoff: 0.25, primaryAlpha: 255 },
        { name: "identity multiplier", alpha: 0.5, multiplier: 1, cutoff: 0.25, primaryAlpha: 255 },
        { name: "primary alpha rejection", alpha: 1, multiplier: 4, cutoff: 0, primaryAlpha: 0 },
        { name: "primary threshold equality", alpha: 1, multiplier: 1, cutoff: 0, primaryAlpha: 1 },
      ] : [
        { name: "scaled multi-texture cutoff", alpha: 1, multiplier: 0.5, cutoff: 0.4, primaryAlpha: 255 },
      ];
      for (const { name, alpha, multiplier, cutoff, primaryAlpha } of cases) {
        primary.image.data[3] = primaryAlpha;
        primary.needsUpdate = true;
        geometry.getAttribute("instanceColor").setXYZW(0, 1, 1, 1, alpha);
        geometry.getAttribute("instanceColor").needsUpdate = true;
        geometry.getAttribute("instanceAlphaCutoff").setX(0, cutoff);
        geometry.getAttribute("instanceAlphaCutoff").needsUpdate = true;
        material.uniforms.uAlphaMult.value = multiplier;
        renderer.render(scene, camera);
        renderer.getContext().readPixels(16, 16, 1, 1, renderer.getContext().RGBA,
          renderer.getContext().UNSIGNED_BYTE, pixel);
        results.push({ kind, name, pixel: Array.from(pixel) });
      }
      scene.remove(mesh);
      effect.dispose();
    }
    renderer.dispose();
    return results;
  });

  await testInfo.attach("particle-alpha-gpu-samples", {
    body: JSON.stringify(observations, null, 2), contentType: "application/json",
  });
  const expected = {
    "scaled cutoff": [0, 0, 0, 255],
    "scaled alpha test": [0, 0, 0, 255],
    "cutoff equality": [100, 50, 25, 64],
    "identity multiplier": [100, 50, 25, 128],
    "primary alpha rejection": [0, 0, 0, 255],
    "primary threshold equality": [100, 50, 25, 1],
    "scaled multi-texture cutoff": [0, 0, 0, 255],
  };
  for (const { name, pixel } of observations) {
    expect(pixel, name).toEqual(expected[name]);
  }
});
