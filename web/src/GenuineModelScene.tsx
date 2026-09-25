import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AnimationAction,
  AnimationMixer,
  Box3,
  CircleGeometry,
  Clock,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";

const MODEL_ASSETS = {
  vulpera: {
    label: "Default Vulpera",
    url: "/model/vulpera.glb",
    localPath: "web/public/model/vulpera.glb",
  },
  trainingDummy: {
    label: "Training Dummy",
    url: "/model/training-dummy.glb",
    localPath: "web/public/model/training-dummy.glb",
  },
} as const;

const WEBGL_ERROR =
  "WebGL is unavailable. Use a browser with WebGL 2 enabled and turn on hardware acceleration, then reload. No placeholder model was substituted.";

type SceneStatus = "loading" | "ready" | "error";

interface CameraView {
  position: Vector3;
  target: Vector3;
}

interface AnimationController {
  playClip: (index: number, shouldPlay: boolean) => void;
  setPlaying: (shouldPlay: boolean) => void;
  resetCamera: () => void;
}

export function configureVulperaMaterials(root: Object3D) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.name !== "vulperamale_eyereflect") continue;
      material.transparent = true;
      material.depthWrite = false;
      material.needsUpdate = true;
    }
  });
}

function disposeObject(root: Object3D) {
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

function placeModel(root: Group, x: number, scale = 1) {
  root.rotation.y = -Math.PI / 2;
  root.scale.setScalar(scale);
  root.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(root);
  const center = bounds.getCenter(new Vector3());
  root.position.set(x - center.x, -bounds.min.y, -center.z);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

function frameModels(camera: PerspectiveCamera, controls: OrbitControls, bounds: Box3): CameraView {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const verticalFov = (camera.fov * Math.PI) / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const fitFov = Math.min(verticalFov, horizontalFov);
  const distance = radius / Math.sin(fitFov / 2) * 1.2;
  const direction = new Vector3(0.42, 0.28, 1).normalize();
  const position = center.clone().add(direction.multiplyScalar(distance));
  const target = center.clone().add(new Vector3(0, size.y * 0.02, 0));

  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 20;
  camera.position.copy(position);
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.minDistance = radius * 0.7;
  controls.maxDistance = radius * 5;
  controls.update();

  return { position, target };
}

function createAssetError(asset: (typeof MODEL_ASSETS)[keyof typeof MODEL_ASSETS]) {
  return new Error(
    `Could not load ${asset.url}. Export the genuine model with wow.export and copy it to ${asset.localPath}, then reload. No placeholder model was substituted.`,
  );
}

async function loadModel(loader: GLTFLoader, asset: (typeof MODEL_ASSETS)[keyof typeof MODEL_ASSETS]) {
  try {
    return await loader.loadAsync(asset.url);
  } catch {
    throw createAssetError(asset);
  }
}

export function GenuineModelScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AnimationController | null>(null);
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [loadedModelCount, setLoadedModelCount] = useState(0);
  const [animationNames, setAnimationNames] = useState<string[]>([]);
  const [selectedAnimationIndex, setSelectedAnimationIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let context: WebGL2RenderingContext | null = null;
    try {
      context = canvas.getContext("webgl2", {
        alpha: false,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      // Some browsers throw instead of returning null when WebGL is disabled.
    }
    if (!context) {
      setStatus("error");
      setError(WEBGL_ERROR);
      return;
    }

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, context, antialias: true });
    } catch {
      setStatus("error");
      setError(WEBGL_ERROR);
      return;
    }

    let isUnmounted = false;
    let isStopped = false;
    let animationFrame = 0;
    let mixer: AnimationMixer | null = null;
    let activeAction: AnimationAction | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let modelBounds: Box3 | null = null;
    let defaultView: CameraView | null = null;
    const loadedRoots: Object3D[] = [];
    const scene = new Scene();
    const camera = new PerspectiveCamera(36, 1, 0.01, 100);
    const controls = new OrbitControls(camera, canvas);
    const clock = new Clock();

    scene.background = new Color(0x111820);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.listenToKeyEvents(canvas);

    const hemisphereLight = new HemisphereLight(0xdcecff, 0x222016, 2.4);
    scene.add(hemisphereLight);
    const keyLight = new DirectionalLight(0xfff0d2, 4.2);
    keyLight.position.set(4, 7, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0x8ab4ff, 2.2);
    fillLight.position.set(-5, 3, 2);
    scene.add(fillLight);

    const floor = new Mesh(
      new CircleGeometry(7, 72),
      new MeshStandardMaterial({ color: 0x202a32, roughness: 0.88, metalness: 0.03 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (modelBounds) defaultView = frameModels(camera, controls, modelBounds);
    };
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const renderFrame = () => {
      if (isStopped) return;
      animationFrame = requestAnimationFrame(renderFrame);
      const delta = Math.min(clock.getDelta(), 0.1);
      mixer?.update(delta);
      controls.update();
      renderer.render(scene, camera);
    };
    renderFrame();

    const stop = () => {
      if (isStopped) return;
      isStopped = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      controls.stopListenToKeyEvents();
      controls.dispose();
      mixer?.stopAllAction();
      for (const root of loadedRoots) disposeObject(root);
      floor.geometry.dispose();
      floor.material.dispose();
      renderer.dispose();
      controllerRef.current = null;
    };

    const prepare = async () => {
      const loader = new GLTFLoader();
      const loadTracked = async (asset: (typeof MODEL_ASSETS)[keyof typeof MODEL_ASSETS]) => {
        const gltf = await loadModel(loader, asset);
        loadedRoots.push(gltf.scene);
        if (isStopped) {
          disposeObject(gltf.scene);
          return gltf;
        }
        setLoadedModelCount((count) => count + 1);
        return gltf;
      };

      let vulpera: GLTF;
      let trainingDummy: GLTF;
      try {
        [vulpera, trainingDummy] = await Promise.all([
          loadTracked(MODEL_ASSETS.vulpera),
          loadTracked(MODEL_ASSETS.trainingDummy),
        ]);
      } catch (caught) {
        if (!isUnmounted) {
          stop();
          setStatus("error");
          setError(caught instanceof Error ? caught.message : "The genuine models could not be loaded.");
        }
        return;
      }
      if (isStopped) return;

      configureVulperaMaterials(vulpera.scene);
      placeModel(vulpera.scene, -0.95);
      placeModel(trainingDummy.scene, 0.95, 0.7);
      scene.add(vulpera.scene, trainingDummy.scene);

      modelBounds = new Box3()
        .setFromObject(vulpera.scene)
        .union(new Box3().setFromObject(trainingDummy.scene));
      defaultView = frameModels(camera, controls, modelBounds);
      const clips = vulpera.animations;
      const defaultClipIndex = Math.max(0, clips.findIndex((clip) => clip.name === "Stand (ID 0 variation 0)"));
      mixer = new AnimationMixer(vulpera.scene);

      const playClip = (index: number, shouldPlay: boolean) => {
        const clip = clips[index];
        if (!clip || !mixer) return;
        activeAction?.stop();
        activeAction = mixer.clipAction(clip);
        activeAction.reset().play();
        activeAction.paused = !shouldPlay;
        mixer.update(0);
      };
      const resetCamera = () => {
        if (!defaultView) return;
        camera.position.copy(defaultView.position);
        controls.target.copy(defaultView.target);
        controls.update();
      };

      controllerRef.current = {
        playClip,
        setPlaying: (shouldPlay) => {
          if (activeAction) activeAction.paused = !shouldPlay;
        },
        resetCamera,
      };
      setAnimationNames(clips.map((clip) => clip.name));
      setSelectedAnimationIndex(defaultClipIndex);
      playClip(defaultClipIndex, false);
      setStatus("ready");
    };

    void prepare();

    return () => {
      isUnmounted = true;
      stop();
    };
  }, []);

  const onAnimationChange = (index: number) => {
    setSelectedAnimationIndex(index);
    controllerRef.current?.playClip(index, isPlaying);
  };

  const onPlaybackToggle = () => {
    const nextIsPlaying = !isPlaying;
    setIsPlaying(nextIsPlaying);
    controllerRef.current?.setPlaying(nextIsPlaying);
  };

  return (
    <section className="model-scene" aria-labelledby="model-scene-title">
      <div className="model-scene-heading">
        <div>
          <p className="eyebrow">Genuine exported assets</p>
          <h2 id="model-scene-title">Genuine WoW model scene</h2>
        </div>
        <p>Drag to orbit · scroll to zoom · focus the canvas for arrow-key pan</p>
      </div>

      <div className="model-stage">
        <canvas
          ref={canvasRef}
          className="model-canvas"
          aria-label="Interactive view of a genuine Vulpera and training dummy"
          tabIndex={0}
        />
        <div className="model-labels" aria-label="Models in scene">
          <span><i className={status === "ready" ? "is-ready" : ""} />Default Vulpera</span>
          <span><i className={status === "ready" ? "is-ready" : ""} />Training Dummy</span>
        </div>
        {status === "loading" && (
          <div className="model-loading" aria-hidden="true">
            <span />
            Loading genuine models
          </div>
        )}
      </div>

      {error && (
        <div className="model-error" role="alert">
          <strong>Genuine model scene unavailable.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="model-controls">
        <label>
          <span>Exported character animation</span>
          <select
            aria-label="Exported character animation"
            value={selectedAnimationIndex}
            onChange={(event) => onAnimationChange(Number(event.target.value))}
            disabled={status !== "ready" || animationNames.length === 0}
          >
            {animationNames.length === 0 ? (
              <option>Animations load with the Vulpera model</option>
            ) : animationNames.map((name, index) => (
              <option value={index} key={`${name}-${index}`}>{name}</option>
            ))}
          </select>
        </label>
        <button
          className="model-play-button"
          type="button"
          onClick={onPlaybackToggle}
          disabled={status !== "ready" || animationNames.length === 0}
          aria-label={isPlaying ? "Pause animation" : "Play animation"}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => controllerRef.current?.resetCamera()}
          disabled={status !== "ready"}
        >
          Reset camera
        </button>
        {status === "loading" && (
          <p role="status">Loading genuine models ({loadedModelCount} of 2)…</p>
        )}
        {status === "ready" && (
          <p role="status">Both genuine models ready · {animationNames.length} exported character clips</p>
        )}
      </div>

      <p className="model-disclaimer">
        Manual exported animation preview — not synchronized to the sampled SimC trace. It does not show spell impact timing, damage, VFX, or optimal play.
      </p>
    </section>
  );
}
