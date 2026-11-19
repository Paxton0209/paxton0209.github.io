import {isParkingEvent} from '../parking-event-types.js';
import {createArtboard} from '../artboards.js?v=scene-options-20261112';
import {waitForEngine} from '../engine-ready.js';
import {revealScene} from '../scene-reveal.js';

export function createScenePreview({clip, engineRevision, onReady, onError}) {
  const cover = document.createElement('canvas');
  cover.id = 'frame-cover';
  cover.hidden = true;
  cover.setAttribute('aria-hidden', 'true');
  clip.append(cover);
  let frame, engine, key, sceneOnCanvas, layoutOnCanvas, lanesOnCanvas, eventOnCanvas, request = 0, ready = false, reveal;
  let sceneTask = Promise.resolve(), selectedModel, coverEntryBottom;
  const resize = () => engine?.resize(clip.clientWidth);
  let resizeFrame;
  function queueResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      resize();
    });
  }
  new ResizeObserver(queueResize).observe(clip);
  // Pinch zoom scales the visual viewport without changing the clip's layout width.
  window.visualViewport?.addEventListener('resize', queueResize);

  async function mount(scene, event, board, theme, eventParams) {
    const {params, seed} = board;
    window.__draftStartupProject = {active: scene, boards: {[scene]: board}};
    frame = document.createElement('iframe');
    frame.title = '3D scene preview';
    frame.className = 'pro-scene-preview';
    frame.tabIndex = -1;
    const query = new URLSearchParams({
      'neutral-parking': '20261118-parking-handoff',
      'scene-preview': '1', 'traffic-palette': 'amber-red-20261112', 'traffic-feedback': 'cut-in-divider-20261112', 'camera-motion': 'roadworks-context-tail15-20261112', 'parking-interactions': '20261113-parking-arrival-camera', 'sky-gradient': '20261112', 'adaptive-roadworks-traffic': '1', review: 'ui-draft', quality: 'sr50', paused: '1',
      scene: params.layout, mode: theme, lanes: params.lanes,
      view: params.camera, model: params.model, weather: params.weather, seed, vehicle: '1',
      path: Number(params.path), roadworks: '0',
      ...(event && {interaction: event}),
      ...(eventParams?.cutInSeed != null && {'cut-in-seed': eventParams.cutInSeed})
    });
    for (const layer of ['traffic', 'buildings', 'trees', 'waterfront']) {
      query.set(layer, Number(params[layer]));
    }
    // A fresh prototype must not mount a cached engine shell from an older build.
    if (engineRevision) query.set('engine-v', engineRevision);
    frame.src = new URL('../engine.html?' + query, import.meta.url);
    clip.prepend(frame);
    try {
      await waitForEngine({
        host: window, frame, timeout: 120000,
        ready: () => {
          const api = frame.contentWindow?.layoutEngine;
          const state = api?.draft?.get({audit: false});
          return api?.get().ready && state?.ready && state.startup?.ready;
        }
      });
      engine = frame.contentWindow.layoutEngine.draft;
      resize();
      engine.completeStartup();
    } catch (error) {
      frame.remove();
      throw error;
    }
  }

  function show(scene, event, {camera, eventCamera = 'auto', lanes, rampLayout, model, weather, layers, theme, assist, params, t, playing, liveRoad = false}) {
    const nextKey = scene + ':' + event + (scene === 'ramp' ? ':' + rampLayout : scene === 'road' ? ':' + lanes : '');
    if (key === nextKey) return;
    key = nextKey;
    const id = ++request;
    reveal?.abort();
    const matchesCanvas = () => sceneOnCanvas === scene &&
      (scene === 'ramp' ? rampLayout === layoutOnCanvas : scene !== 'road' || lanes === lanesOnCanvas);
    function holdFrame() {
      const source = engine.canvas;
      cover.width = source.width;
      cover.height = source.height;
      cover.getContext('2d').drawImage(source, 0, 0);
      coverEntryBottom = engine.parkingEntryBottom();
      cover.hidden = false;
    }
    const morphRoad = () => sceneOnCanvas === 'road' && scene === 'road';
    if (sceneOnCanvas && cover.hidden && !matchesCanvas() && !morphRoad()) holdFrame();
    ready = false;
    const board = createArtboard(scene, {
      ...(scene === 'ramp' && {layout: rampLayout}), camera: event ? 'low' : camera,
      lanes, model, weather, ...layers, traffic: scene === 'parking' || layers.traffic, path: !!event || assist
    });
    sceneTask = sceneTask.then(async () => {
      if (id !== request) return;
      const laneEdit = morphRoad() && lanes !== lanesOnCanvas;
      const eventApplied = !!engine && (matchesCanvas() || laneEdit);
      if (selectedModel) board.params.model = selectedModel;
      if (eventApplied) {
        cover.hidden = true;
        if (isParkingEvent(event)) await engine.prepareParkingAssets();
        else if (event || board.params.traffic) await engine.prepareEventTraffic();
        if (id !== request) return;
        const incompatible = scene === 'ramp' && rampLayout === '07' && !!event && event !== eventOnCanvas;
        if (incompatible) holdFrame();
        if (!laneEdit || event !== eventOnCanvas) {
          engine.switchInteraction(event, {
            params, camera: event ? eventCamera : camera, time: t, overlay: true, assist, playing,
            trafficEnabled: board.params.traffic, animateCamera: eventOnCanvas === event, liveRoad
          });
        }
        if (laneEdit) await engine.param('lanes', Number(lanes));
      } else if (engine) {
        if (cover.hidden) holdFrame();
        if (isParkingEvent(event)) {
          await engine.prepareParkingAssets();
          if (id !== request) return;
        }
        engine.setDrivingEvent(event, params);
        const entryBottom = ['parking', 'outdoor'].includes(scene) ? coverEntryBottom : undefined;
        await engine.scene(scene, board.seed, board.params, entryBottom);
      } else {
        await mount(scene, event, board, theme, params);
      }
      sceneOnCanvas = scene;
      layoutOnCanvas = rampLayout;
      lanesOnCanvas = lanes;
      eventOnCanvas = event;
      if (id !== request) return;
      resize();
      ready = true;
      onReady(engine, event, {eventApplied});
      if (cover.hidden) return;
      reveal = new AbortController();
      void revealScene({
        cover, commit() {}, signal: reveal.signal,
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches
      });
    }).catch((error) => {
      if (id !== request) return;
      key = null;
      onError(error);
    });
  }

  function apply(operation, {sameScene = false, acrossScenes = false} = {}) {
    const id = request, scene = sceneOnCanvas;
    // A pending layer edit must finish before the next scene applies its own layer rules.
    sceneTask = sceneTask.then(async () => {
      if (!engine || (!acrossScenes && (sameScene ? scene !== sceneOnCanvas : !ready || id !== request))) return;
      await operation(engine);
    }).catch(error => {
      if (id === request) onError(error);
    });
    return sceneTask;
  }

  function selectVehicle(model) {
    const change = sceneTask.then(async () => {
      if (!engine) throw Error('The scene is still loading. Please try again.');
      await engine.param('model', model);
      selectedModel = model;
    });
    sceneTask = change.catch(() => {});
    return change;
  }

  return {show, apply, selectVehicle, hasMountedScene: scene => sceneOnCanvas === scene, bridge: () => ready ? engine : null};
}
