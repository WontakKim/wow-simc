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
import type { ReplayEvent } from "./replay";
import {
  loadNativeParticleEffect,
  type NativeParticleEffect,
  type NativeParticleRenderInstance,
} from "./NativeParticleEffect";
import { NATIVE_EFFECT_ASSETS, NATIVE_PREVIEW_DURATION_SECONDS, type NativeEffectAsset } from "./nativeEffectAssets";

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
const STAND_CLIP_NAME = "Stand (ID 0 variation 0)";
const CAMERA_FOV = 36;
export const ILLUSTRATIVE_MOTION_WINDOW_SECONDS = 1.2;
export const REPLAY_EFFECT_RELEASE_SECONDS = 0.2;
export const REPLAY_EFFECT_TRAVEL_SECONDS = 0.8;
export const REPLAY_EFFECT_DECAY_SECONDS = 1.5;

const REPLAY_EFFECT_DURATION_SECONDS = REPLAY_EFFECT_RELEASE_SECONDS
  + REPLAY_EFFECT_TRAVEL_SECONDS
  + REPLAY_EFFECT_DECAY_SECONDS;
const NATIVE_REPLAY_INSTANCE_LIMIT = 16;
const NATIVE_REPLAY_BASE_SCALE = 0.38;

const ELEMENTAL_SHAMAN_CLIPS = new Map<number, { actionName: string; clipName: string }>([
  [318038, { actionName: "flametongue_weapon", clipName: "SpellCastOmni (ID 54 variation 0)" }],
  [192106, { actionName: "lightning_shield", clipName: "ShaSpellPrecastBothChannel (ID 862 variation 0)" }],
  [191634, { actionName: "stormkeeper", clipName: "ShaSpellPrecastBoth (ID 828 variation 0)" }],
  [443454, { actionName: "ancestral_swiftness", clipName: "SpellCastOmni (ID 54 variation 0)" }],
  [1219480, { actionName: "ascendance", clipName: "ChannelCastOmniUp (ID 1448 variation 0)" }],
  [51505, { actionName: "lava_burst", clipName: "CastStrongUpRight (ID 1148 variation 0)" }],
  [188196, { actionName: "lightning_bolt", clipName: "ShaSpellCastBothFront (ID 830 variation 0)" }],
  [117014, { actionName: "elemental_blast", clipName: "CastOutStrong (ID 1122 variation 0)" }],
  [188389, { actionName: "flame_shock", clipName: "SpellCastDirected (ID 53 variation 0)" }],
]);

type SceneStatus = "loading" | "ready" | "error";
type AnimationMode = "replay" | "manual" | "native";
export type ReplaySpeed = 0.5 | 1 | 2;
export type ReplayAnimationKind = "motion" | "settled" | "before" | "wait" | "failed" | "unmapped" | "unavailable";

export interface ReplayEffectOccurrence {
  eventKey: string;
  eventTime: number;
  elapsedSeconds: number;
  componentTimeSeconds: number;
}

export interface ReplayAnimationResolution {
  kind: ReplayAnimationKind;
  eventLabel: string;
  clipName: string;
  clipTime: number;
  status: string;
}

export interface SceneReplayState {
  events: ReplayEvent[];
  selectedIndex: number;
  cursor: number;
  isPlaying: boolean;
  speed: ReplaySpeed;
  maxTime: number;
  onSelectEvent: (index: number) => void;
  onSeek: (time: number) => void;
  onTogglePlayback: () => void;
  onReset: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
}

export interface GenuineModelSceneProps {
  replay: SceneReplayState | null;
}

interface CameraView {
  position: Vector3;
  target: Vector3;
}

interface AnimationController {
  applyReplayAnimation: (resolution: ReplayAnimationResolution) => void;
  playManualClip: (index: number, shouldPlay: boolean) => void;
  setManualPlaying: (shouldPlay: boolean) => void;
  loadNativeEffect: (asset: NativeEffectAsset) => Promise<NativeParticleEffect | null>;
  loadReplayEffects: () => Promise<boolean>;
  setNativeVisible: (isVisible: boolean) => void;
  setReplayVisible: (isVisible: boolean) => void;
  resetCamera: () => void;
}

function getEventLabel(event: ReplayEvent) {
  if (event.kind === "wait") return `Wait ${(event.wait ?? 0).toFixed(2)}s`;
  return event.spellName ?? event.name;
}

function isSupportedElementalBlast(event: ReplayEvent) {
  return event.phase === "combat"
    && event.kind === "action"
    && event.id === 117014
    && event.name === "elemental_blast"
    && event.queueFailed === false;
}

function roundReplayTime(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function resolveReplayEffectOccurrences(
  events: ReplayEvent[],
  selectedIndex: number,
  cursor: number,
): ReplayEffectOccurrence[] {
  if (selectedIndex < 0 || selectedIndex >= events.length) return [];
  return events.slice(0, selectedIndex + 1).flatMap((event) => {
    if (!isSupportedElementalBlast(event)) return [];
    const elapsedSeconds = roundReplayTime(cursor - event.time);
    if (elapsedSeconds < REPLAY_EFFECT_RELEASE_SECONDS
      || elapsedSeconds > REPLAY_EFFECT_DURATION_SECONDS) return [];
    return [{
      eventKey: event.key,
      eventTime: event.time,
      elapsedSeconds,
      componentTimeSeconds: roundReplayTime(elapsedSeconds - REPLAY_EFFECT_RELEASE_SECONDS),
    }];
  });
}

export function getReplayPlaybackEndTime(events: ReplayEvent[]) {
  const combatEvents = events.filter((event) => event.phase === "combat");
  if (combatEvents.length === 0) return 0;
  const lastCombatTime = Math.max(...combatEvents.map((event) => event.time));
  const lastEffectEnd = Math.max(
    0,
    ...combatEvents
      .filter(isSupportedElementalBlast)
      .map((event) => event.time + REPLAY_EFFECT_DURATION_SECONDS),
  );
  return roundReplayTime(Math.max(
    lastCombatTime + ILLUSTRATIVE_MOTION_WINDOW_SECONDS,
    lastEffectEnd,
  ));
}

export function getReplayEffectAnchors(caster: Group, target: Group) {
  const anchorFromBounds = (root: Group) => {
    const bounds = new Box3().setFromObject(root);
    const center = bounds.getCenter(new Vector3());
    const height = bounds.getSize(new Vector3()).y;
    return new Vector3(center.x, bounds.min.y + height * 0.6, center.z);
  };
  return { caster: anchorFromBounds(caster), target: anchorFromBounds(target) };
}

function sampleReplayEffectPath(caster: Vector3, target: Vector3, componentTimeSeconds: number) {
  const progress = Math.max(0, Math.min(1, componentTimeSeconds / REPLAY_EFFECT_TRAVEL_SECONDS));
  return caster.clone().lerp(target, progress);
}

function threeToNative(value: Vector3): [number, number, number] {
  return [value.x, value.z, -value.y];
}

export function resolveReplayAnimation(
  events: ReplayEvent[],
  selectedIndex: number,
  cursor: number,
): ReplayAnimationResolution {
  const event = events[selectedIndex];
  if (!event) {
    return {
      kind: "unavailable",
      eventLabel: "No replay event",
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "Replay sync is unavailable — idle.",
    };
  }

  const eventLabel = getEventLabel(event);
  if (cursor < event.time) {
    return {
      kind: "before",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "The cursor is before this recorded action — idle.",
    };
  }
  if (event.kind === "wait") {
    return {
      kind: "wait",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "Recorded wait — idle; no cast motion.",
    };
  }
  if (event.queueFailed) {
    return {
      kind: "failed",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "Recorded queue failure — idle; no successful cast motion.",
    };
  }

  const mappedClip = event.id === null ? undefined : ELEMENTAL_SHAMAN_CLIPS.get(event.id);
  if (!mappedClip || mappedClip.actionName !== event.name) {
    return {
      kind: "unmapped",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "No supported exported motion mapping — idle.",
    };
  }

  const elapsed = cursor - event.time;
  if (elapsed >= ILLUSTRATIVE_MOTION_WINDOW_SECONDS - 0.000001) {
    return {
      kind: "settled",
      eventLabel,
      clipName: STAND_CLIP_NAME,
      clipTime: 0,
      status: "Illustrative motion window complete — idle.",
    };
  }

  return {
    kind: "motion",
    eventLabel,
    clipName: mappedClip.clipName,
    clipTime: elapsed,
    status: "Illustrative exported motion — not cast duration or hit timing.",
  };
}

export function isReplayClipMissing(
  resolution: ReplayAnimationResolution,
  animationNames: string[],
) {
  return resolution.kind === "motion" && !animationNames.includes(resolution.clipName);
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

function placeModel(root: Group, x: number, rotationY: number, scale = 1) {
  root.rotation.y = rotationY;
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

export function arrangeCombatants(vulpera: Group, trainingDummy: Group) {
  placeModel(vulpera, -4, 0);
  placeModel(trainingDummy, 4, Math.PI, 0.7);
}

export function frameModels(camera: PerspectiveCamera, controls: OrbitControls, bounds: Box3): CameraView {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const target = center.clone().add(new Vector3(0, size.y * 0.02, 0));
  const direction = new Vector3(0.42, 0.28, 1).normalize();
  const viewDirection = direction.clone().negate();
  const viewRight = new Vector3().crossVectors(viewDirection, camera.up).normalize();
  const viewUp = new Vector3().crossVectors(viewRight, viewDirection).normalize();
  const verticalTangent = Math.tan((camera.fov * Math.PI) / 360);
  const horizontalTangent = verticalTangent * camera.aspect;
  let distance = 1;

  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const relative = new Vector3(x, y, z).sub(target);
        const depthOffset = relative.dot(direction);
        const horizontalDistance = Math.abs(relative.dot(viewRight)) / horizontalTangent;
        const verticalDistance = Math.abs(relative.dot(viewUp)) / verticalTangent;
        distance = Math.max(distance, depthOffset + Math.max(horizontalDistance, verticalDistance) * 1.08);
      }
    }
  }

  const position = target.clone().add(direction.multiplyScalar(distance));
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 20;
  camera.position.copy(position);
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.minDistance = radius * 0.7;
  controls.maxDistance = Math.max(radius * 5, distance * 1.5);
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

export function GenuineModelScene({ replay }: GenuineModelSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AnimationController | null>(null);
  const animationModeRef = useRef<AnimationMode>("replay");
  const replayAnimationRef = useRef(resolveReplayAnimation(
    replay?.events ?? [],
    replay?.selectedIndex ?? -1,
    replay?.cursor ?? 0,
  ));
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [loadedModelCount, setLoadedModelCount] = useState(0);
  const [animationNames, setAnimationNames] = useState<string[]>([]);
  const [selectedAnimationIndex, setSelectedAnimationIndex] = useState(0);
  const [animationMode, setAnimationMode] = useState<AnimationMode>("replay");
  const [isManualPlaying, setIsManualPlaying] = useState(false);
  const [selectedNativeFileDataId, setSelectedNativeFileDataId] = useState<NativeEffectAsset["fileDataId"]>(794788);
  const [nativePreviewTime, setNativePreviewTime] = useState(0);
  const [isNativePlaying, setIsNativePlaying] = useState(false);
  const [nativeStatus, setNativeStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [nativeEmitterCount, setNativeEmitterCount] = useState(0);
  const [nativeTextureCount, setNativeTextureCount] = useState(0);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [replayEffectStatus, setReplayEffectStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [replayEffectError, setReplayEffectError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nativePreviewTimeRef = useRef(0);
  const nativeLoadRequestRef = useRef(0);
  const replayEffectLoadRequestRef = useRef(0);
  const loadedNativeFileDataIdRef = useRef<number | null>(null);
  const replayStateRef = useRef(replay);

  const replayAnimation = resolveReplayAnimation(
    replay?.events ?? [],
    replay?.selectedIndex ?? -1,
    replay?.cursor ?? 0,
  );
  replayAnimationRef.current = replayAnimation;
  replayStateRef.current = replay;
  nativePreviewTimeRef.current = nativePreviewTime;
  const selectedNativeAsset = NATIVE_EFFECT_ASSETS.find((asset) => asset.fileDataId === selectedNativeFileDataId) ?? NATIVE_EFFECT_ASSETS[0];
  const hasMissingReplayClip = status === "ready" && isReplayClipMissing(replayAnimation, animationNames);

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
    let nativeEffect: NativeParticleEffect | null = null;
    let nativeEffectGeneration = 0;
    let replayEffectGeneration = 0;
    let replayEffects: Array<{ asset: NativeEffectAsset; effect: NativeParticleEffect }> = [];
    let replayAnchors: ReturnType<typeof getReplayEffectAnchors> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let modelBounds: Box3 | null = null;
    let defaultView: CameraView | null = null;
    const loadedRoots: Object3D[] = [];
    const scene = new Scene();
    canvas.dataset.replayNativeComponents = "0";
    canvas.dataset.replayNativeParticles = "0";
    canvas.dataset.replayNativeLatestSourceX = "";
    const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.01, 100);
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
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.camera.updateProjectionMatrix();
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

    const clearReplayEffectEvidence = () => {
      canvas.dataset.replayNativeComponents = "0";
      canvas.dataset.replayNativeParticles = "0";
      canvas.dataset.replayNativeLatestSourceX = "";
    };

    const clearReplayEffects = () => {
      for (const { effect } of replayEffects) effect.clearInstances();
      clearReplayEffectEvidence();
    };

    const updateReplayEffects = () => {
      const replayState = replayStateRef.current;
      if (animationModeRef.current !== "replay"
        || replayEffects.length !== NATIVE_EFFECT_ASSETS.length
        || !replayState
        || !replayAnchors) {
        clearReplayEffects();
        return true;
      }

      const anchors = replayAnchors;
      const occurrences = resolveReplayEffectOccurrences(
        replayState.events,
        replayState.selectedIndex,
        replayState.cursor,
      );
      let particleCount = 0;
      try {
        for (const { asset, effect } of replayEffects) {
          const instances: NativeParticleRenderInstance[] = occurrences.map((occurrence) => ({
            timeSeconds: occurrence.componentTimeSeconds,
            emissionEndSeconds: REPLAY_EFFECT_TRAVEL_SECONDS,
            modelScale: NATIVE_REPLAY_BASE_SCALE * asset.effectNameScale,
            sourceTranslationAtTime: (timeSeconds) => threeToNative(sampleReplayEffectPath(
              anchors.caster,
              anchors.target,
              timeSeconds,
            )),
          }));
          particleCount += effect.setReplayInstances(instances, camera);
        }
      } catch (caught) {
        const reason = caught instanceof Error ? caught.message : "Native replay rendering failed.";
        for (const { effect } of replayEffects) effect.dispose();
        replayEffects = [];
        clearReplayEffectEvidence();
        setReplayEffectStatus("error");
        setReplayEffectError(`${reason} No substitute effect was rendered.`);
        return false;
      }

      canvas.dataset.replayNativeComponents = String(occurrences.length * replayEffects.length);
      canvas.dataset.replayNativeParticles = String(particleCount);
      const latestOccurrence = occurrences.at(-1);
      canvas.dataset.replayNativeLatestSourceX = latestOccurrence
        ? sampleReplayEffectPath(
            anchors.caster,
            anchors.target,
            latestOccurrence.componentTimeSeconds,
          ).x.toFixed(6)
        : "";
      return true;
    };

    const renderFrame = () => {
      if (isStopped) return;
      animationFrame = requestAnimationFrame(renderFrame);
      const delta = Math.min(clock.getDelta(), 0.1);
      if (animationModeRef.current === "manual") mixer?.update(delta);
      controls.update();
      if (animationModeRef.current === "replay") updateReplayEffects();
      if (animationModeRef.current === "native" && nativeEffect) {
        try {
          nativeEffect.setTime(nativePreviewTimeRef.current, camera);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Native particle rendering failed.";
          nativeEffect.dispose();
          nativeEffect = null;
          setNativeStatus("error");
          setNativeError(`${message} No substitute effect was rendered.`);
        }
      }
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
      nativeEffectGeneration += 1;
      replayEffectGeneration += 1;
      nativeEffect?.dispose();
      nativeEffect = null;
      for (const { effect } of replayEffects) effect.dispose();
      replayEffects = [];
      clearReplayEffectEvidence();
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
      // Facial bones extend along native +X, so these rotations face both exports toward each other.
      arrangeCombatants(vulpera.scene, trainingDummy.scene);
      replayAnchors = getReplayEffectAnchors(vulpera.scene, trainingDummy.scene);
      scene.add(vulpera.scene, trainingDummy.scene);

      modelBounds = new Box3()
        .setFromObject(vulpera.scene)
        .union(new Box3().setFromObject(trainingDummy.scene));
      defaultView = frameModels(camera, controls, modelBounds);
      const clips = vulpera.animations;
      const animationClipNames = clips.map((clip) => clip.name);
      const defaultClipIndex = Math.max(0, animationClipNames.indexOf(STAND_CLIP_NAME));
      mixer = new AnimationMixer(vulpera.scene);
      let activeClipIndex = -1;

      const activateClip = (index: number, shouldRestart: boolean) => {
        const clip = clips[index];
        if (!clip || !mixer) return null;
        if (activeClipIndex !== index) {
          activeAction?.stop();
          activeAction = mixer.clipAction(clip);
          activeClipIndex = index;
          shouldRestart = true;
        }
        const action = activeAction;
        if (!action) return null;
        if (shouldRestart) action.reset().play();
        return action;
      };
      const applyReplayAnimation = (resolution: ReplayAnimationResolution) => {
        if (!mixer) return;
        const requestedIndex = resolution.kind === "motion"
          ? animationClipNames.indexOf(resolution.clipName)
          : defaultClipIndex;
        const clipIndex = requestedIndex >= 0 ? requestedIndex : defaultClipIndex;
        const action = activateClip(clipIndex, false);
        if (!action) return;
        action.paused = true;
        const clipDuration = clips[clipIndex]?.duration ?? 0;
        const finalClipSample = Math.max(0, clipDuration - 0.0001);
        action.time = resolution.kind === "motion" && requestedIndex >= 0
          ? Math.min(resolution.clipTime, finalClipSample)
          : 0;
        mixer.update(0);
      };
      const playManualClip = (index: number, shouldPlay: boolean) => {
        const action = activateClip(index, true);
        if (!action || !mixer) return;
        action.paused = !shouldPlay;
        mixer.update(0);
      };
      const resetCamera = () => {
        if (!defaultView) return;
        camera.position.copy(defaultView.position);
        controls.target.copy(defaultView.target);
        controls.update();
      };

      controllerRef.current = {
        applyReplayAnimation,
        playManualClip,
        setManualPlaying: (shouldPlay) => {
          if (activeAction) activeAction.paused = !shouldPlay;
        },
        loadNativeEffect: async (asset) => {
          const generation = ++nativeEffectGeneration;
          nativeEffect?.dispose();
          nativeEffect = null;
          const loadedEffect = await loadNativeParticleEffect(asset);
          if (isStopped || generation !== nativeEffectGeneration) {
            loadedEffect.dispose();
            return null;
          }
          nativeEffect = loadedEffect;
          nativeEffect.group.visible = animationModeRef.current === "native";
          scene.add(nativeEffect.group);
          nativeEffect.setTime(nativePreviewTimeRef.current, camera);
          return nativeEffect;
        },
        loadReplayEffects: async () => {
          const generation = ++replayEffectGeneration;
          for (const { effect } of replayEffects) effect.dispose();
          replayEffects = [];
          const results = await Promise.allSettled(NATIVE_EFFECT_ASSETS.map(async (asset) => ({
            asset,
            effect: await loadNativeParticleEffect(asset, NATIVE_REPLAY_INSTANCE_LIMIT),
          })));
          const loaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
          if (isStopped || generation !== replayEffectGeneration) {
            for (const { effect } of loaded) effect.dispose();
            return false;
          }
          const failure = results.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") {
            for (const { effect } of loaded) effect.dispose();
            const reason = failure.reason instanceof Error ? failure.reason.message : "Unknown native asset failure.";
            throw new Error(reason);
          }
          replayEffects = loaded;
          for (const { effect } of replayEffects) {
            effect.group.visible = animationModeRef.current === "replay";
            scene.add(effect.group);
          }
          return updateReplayEffects();
        },
        setNativeVisible: (isVisible) => {
          if (nativeEffect) nativeEffect.group.visible = isVisible;
        },
        setReplayVisible: (isVisible) => {
          for (const { effect } of replayEffects) effect.group.visible = isVisible;
          if (isVisible) updateReplayEffects();
          else clearReplayEffects();
        },
        resetCamera,
      };
      setAnimationNames(animationClipNames);
      setSelectedAnimationIndex(defaultClipIndex);
      if (animationModeRef.current === "replay") {
        applyReplayAnimation(replayAnimationRef.current);
      } else {
        playManualClip(defaultClipIndex, false);
      }
      setStatus("ready");
    };

    void prepare();

    return () => {
      isUnmounted = true;
      stop();
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || replayEffectStatus !== "idle") return;
    const requestId = ++replayEffectLoadRequestRef.current;
    let isCurrent = true;
    setReplayEffectStatus("loading");
    setReplayEffectError(null);
    void controllerRef.current?.loadReplayEffects().then((isReady) => {
      if (!isCurrent || requestId !== replayEffectLoadRequestRef.current || !isReady) return;
      setReplayEffectStatus("ready");
    }).catch((caught) => {
      if (!isCurrent || requestId !== replayEffectLoadRequestRef.current) return;
      const reason = caught instanceof Error ? caught.message : "The original replay components could not be loaded.";
      setReplayEffectStatus("error");
      setReplayEffectError(reason);
    });
    return () => {
      isCurrent = false;
    };
  }, [status]);

  useEffect(() => {
    animationModeRef.current = animationMode;
    controllerRef.current?.setNativeVisible(animationMode === "native");
    controllerRef.current?.setReplayVisible(animationMode === "replay");
    if (animationMode === "manual") {
      controllerRef.current?.playManualClip(selectedAnimationIndex, false);
      return;
    }
    setIsManualPlaying(false);
    if (animationMode === "native") {
      controllerRef.current?.playManualClip(selectedAnimationIndex, false);
      return;
    }
    setIsNativePlaying(false);
  }, [animationMode]);

  useEffect(() => {
    if (animationMode !== "native" || status !== "ready") return;
    if (loadedNativeFileDataIdRef.current === selectedNativeAsset.fileDataId && nativeStatus === "ready") {
      controllerRef.current?.setNativeVisible(true);
      return;
    }
    const requestId = ++nativeLoadRequestRef.current;
    let isCurrent = true;
    setNativeStatus("loading");
    setNativeError(null);
    setNativeEmitterCount(0);
    setNativeTextureCount(0);
    void controllerRef.current?.loadNativeEffect(selectedNativeAsset).then((effect) => {
      if (!isCurrent || requestId !== nativeLoadRequestRef.current || !effect) return;
      loadedNativeFileDataIdRef.current = selectedNativeAsset.fileDataId;
      setNativeEmitterCount(effect.model.emitters.length);
      setNativeTextureCount(effect.model.textureFileDataIds.length);
      setNativeStatus("ready");
    }).catch((caught) => {
      if (!isCurrent || requestId !== nativeLoadRequestRef.current) return;
      loadedNativeFileDataIdRef.current = null;
      setNativeStatus("error");
      setNativeError(caught instanceof Error ? caught.message : "The native M2 component could not be loaded. No substitute effect was rendered.");
    });
    return () => {
      isCurrent = false;
    };
  }, [animationMode, selectedNativeAsset, status]);

  useEffect(() => {
    if (animationMode !== "native" || !isNativePlaying) return;
    let frameId = 0;
    let previous: number | null = null;
    const advance = (now: number) => {
      const elapsed = previous === null ? 0 : (now - previous) / 1000;
      previous = now;
      setNativePreviewTime((current) => (current + elapsed) % NATIVE_PREVIEW_DURATION_SECONDS);
      frameId = requestAnimationFrame(advance);
    };
    frameId = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frameId);
  }, [animationMode, isNativePlaying]);

  useEffect(() => {
    if (animationMode !== "replay") return;
    controllerRef.current?.applyReplayAnimation(replayAnimation);
  }, [animationMode, replayAnimation.kind, replayAnimation.clipName, replayAnimation.clipTime]);

  const onAnimationChange = (index: number) => {
    setSelectedAnimationIndex(index);
    controllerRef.current?.playManualClip(index, isManualPlaying);
  };

  const onManualPlaybackToggle = () => {
    const nextIsPlaying = !isManualPlaying;
    setIsManualPlaying(nextIsPlaying);
    controllerRef.current?.setManualPlaying(nextIsPlaying);
  };

  const selectAnimationMode = (nextMode: AnimationMode) => {
    if (nextMode !== "replay" && replay?.isPlaying) replay.onTogglePlayback();
    if (nextMode !== "manual") setIsManualPlaying(false);
    if (nextMode !== "native") setIsNativePlaying(false);
    setAnimationMode(nextMode);
  };

  const onNativeComponentChange = (fileDataId: NativeEffectAsset["fileDataId"]) => {
    nativeLoadRequestRef.current += 1;
    loadedNativeFileDataIdRef.current = null;
    setSelectedNativeFileDataId(fileDataId);
    setNativePreviewTime(0);
    setIsNativePlaying(false);
    setNativeStatus("idle");
    setNativeError(null);
  };

  const onNativePlaybackToggle = () => {
    if (nativeStatus !== "ready") return;
    if (nativePreviewTime >= NATIVE_PREVIEW_DURATION_SECONDS) setNativePreviewTime(0);
    setIsNativePlaying((current) => !current);
  };

  const onNativeReset = () => {
    setIsNativePlaying(false);
    setNativePreviewTime(0);
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

      <div className="animation-mode-tabs" aria-label="Character animation mode">
        <button
          type="button"
          aria-pressed={animationMode === "replay"}
          onClick={() => selectAnimationMode("replay")}
        >
          Replay sync
        </button>
        <button
          type="button"
          aria-pressed={animationMode === "manual"}
          onClick={() => selectAnimationMode("manual")}
        >
          Manual preview
        </button>
        <button
          type="button"
          aria-pressed={animationMode === "native"}
          onClick={() => selectAnimationMode("native")}
        >
          Native M2 component preview
        </button>
      </div>

      {animationMode === "replay" ? (
        <>
          <div className="replay-motion-status" data-animation-kind={hasMissingReplayClip ? "missing" : replayAnimation.kind} aria-live="polite">
            <span>Selected recorded action</span>
            <strong>{replayAnimation.eventLabel}</strong>
            <small>
              {hasMissingReplayClip
                ? `Required exported clip missing (${replayAnimation.clipName}) — idle.`
                : replayAnimation.status}
            </small>
          </div>
          {replayEffectStatus === "loading" && (
            <p data-testid="replay-effect-status">
              Loading both source-linked original Elemental Blast components…
            </p>
          )}
          {replayEffectStatus === "ready" && (
            <p data-testid="replay-effect-status">
              <strong>12 of 12 authored emitters ready</strong>
              <span> · 9 original BLP textures · FileDataID 794788 + 613807</span>
              <small> · Partial original Elemental Blast components, not the complete spell.</small>
            </p>
          )}
          {replayEffectError && (
            <div className="model-error replay-effect-error" role="alert">
              <strong>Original replay components unavailable.</strong>
              <span>{replayEffectError}</span>
            </div>
          )}
          {replay ? (
            <div className="transport model-replay-controls" aria-label="Replay controls">
              <button type="button" onClick={() => replay.onSelectEvent(replay.selectedIndex - 1)} disabled={replay.selectedIndex === 0} aria-label="Previous event">Previous</button>
              <button className="play-button" type="button" onClick={replay.onTogglePlayback} disabled={replay.maxTime === 0}>{replay.isPlaying ? "Pause" : "Play"}</button>
              <button type="button" onClick={() => replay.onSelectEvent(replay.selectedIndex + 1)} disabled={replay.selectedIndex === replay.events.length - 1} aria-label="Next event">Next</button>
              <button type="button" onClick={replay.onReset}>Reset</button>
              <label className="speed-control">Speed<select value={replay.speed} onChange={(event) => replay.onSpeedChange(Number(event.target.value) as ReplaySpeed)}>{[0.5, 1, 2].map((value) => <option value={value} key={value}>{value}×</option>)}</select></label>
              <label className="seek-control"><span>Seek</span><input aria-label="Seek playback" type="range" min="0" max={Math.max(replay.maxTime, 0.001)} step="any" value={replay.cursor} onChange={(event) => replay.onSeek(Number(event.target.value))} /><span className="seek-output">{replay.cursor.toFixed(replay.cursor < 10 ? 2 : 1)}s</span></label>
              <button type="button" onClick={() => controllerRef.current?.resetCamera()} disabled={status !== "ready"}>Reset camera</button>
            </div>
          ) : (
            <div className="replay-unavailable">
              Replay sync is unavailable. The genuine scene and separate manual preview remain usable.
            </div>
          )}
        </>
      ) : animationMode === "manual" ? (
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
            onClick={onManualPlaybackToggle}
            disabled={status !== "ready" || animationNames.length === 0}
            aria-label={isManualPlaying ? "Pause animation" : "Play animation"}
          >
            {isManualPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => controllerRef.current?.resetCamera()}
            disabled={status !== "ready"}
          >
            Reset camera
          </button>
        </div>
      ) : (
        <div className="native-preview-panel">
          <div className="native-preview-heading">
            <div>
              <span>Original source component</span>
              <strong>{selectedNativeAsset.label}</strong>
              <small>{selectedNativeAsset.filename} · FileDataID {selectedNativeAsset.fileDataId}</small>
            </div>
            <p>Two-component renderer proof · not complete Elemental Blast</p>
          </div>
          <label className="native-component-select">
            <span>Original M2 component</span>
            <select
              aria-label="Original M2 component"
              value={selectedNativeFileDataId}
              onChange={(event) => onNativeComponentChange(Number(event.target.value) as NativeEffectAsset["fileDataId"])}
              disabled={status !== "ready"}
            >
              {NATIVE_EFFECT_ASSETS.map((asset) => (
                <option value={asset.fileDataId} key={asset.fileDataId}>
                  {asset.label} · FileDataID {asset.fileDataId}
                </option>
              ))}
            </select>
          </label>
          {nativeStatus === "loading" && (
            <p role="status" data-testid="native-effect-status">
              Loading original M2 and {selectedNativeAsset.textures.length} BLP textures for FileDataID {selectedNativeAsset.fileDataId}…
            </p>
          )}
          {nativeStatus === "ready" && (
            <p role="status" data-testid="native-effect-status" data-native-file-data-id={selectedNativeAsset.fileDataId}>
              <strong>{nativeEmitterCount} of {selectedNativeAsset.expectedEmitterCount} authored emitters ready</strong>
              <span> · {nativeTextureCount} original BLP textures · FileDataID {selectedNativeAsset.fileDataId}</span>
              <small> · Component proof, not complete Elemental Blast.</small>
            </p>
          )}
          {nativeError && (
            <div className="model-error native-effect-error" role="alert">
              <strong>Native M2 component unavailable.</strong>
              <span>{nativeError}</span>
            </div>
          )}
          <div className="transport native-preview-controls" aria-label="Native M2 component preview controls">
            <button
              className="play-button"
              type="button"
              onClick={onNativePlaybackToggle}
              disabled={nativeStatus !== "ready"}
              aria-label={isNativePlaying ? "Pause native preview" : "Play native preview"}
            >
              {isNativePlaying ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={onNativeReset}>Reset original preview</button>
            <label className="seek-control">
              <span>Preview time</span>
              <input
                aria-label="Native preview time"
                type="range"
                min="0"
                max={NATIVE_PREVIEW_DURATION_SECONDS}
                step="0.001"
                value={nativePreviewTime}
                onChange={(event) => {
                  setIsNativePlaying(false);
                  setNativePreviewTime(Number(event.target.value));
                }}
              />
              <span className="seek-output">{nativePreviewTime.toFixed(2)}s</span>
            </label>
            <button type="button" onClick={() => controllerRef.current?.resetCamera()} disabled={status !== "ready"}>Reset camera</button>
          </div>
        </div>
      )}

      <div className="model-ready-status">
        {status === "loading" && (
          <p role="status">Loading genuine models ({loadedModelCount} of 2)…</p>
        )}
        {status === "ready" && (
          <p role="status">Both genuine models ready · {animationNames.length} exported character clips</p>
        )}
      </div>

      <p className="model-disclaimer">
        {animationMode === "replay"
          ? "Replay sync samples illustrative exported motion and both source-linked original M2 components for successful Spell 117014 elemental_blast records. The 0.20s release and 0.80s linear flight use neutral model-bounds anchors and are viewer-only, not game cast, missile, hit, or attachment data. Particles decay after visual arrival; no impact, damage, sound, or hit reaction is inferred, and two components are not the complete four-component spell."
          : animationMode === "manual"
            ? "Manual preview is separate from replay time. It does not show spell impact timing, damage, VFX, hit reactions, or optimal play."
            : "Native preview time is an isolated, stationary component-viewer clock, not missile travel, a cast, an impact, or a simulation event. It renders only the selected original M2 component and its original BLP textures; it is not the complete Elemental Blast composite."}
      </p>
    </section>
  );
}
