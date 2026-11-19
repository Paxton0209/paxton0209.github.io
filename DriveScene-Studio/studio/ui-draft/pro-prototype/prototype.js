import {sceneHasWeather,sceneHasExteriorLayers} from '../artboards.js?v=scene-options-20261112';
import {DRIVING_EVENT_SECONDS} from '../interaction-duration.js';
import {setAssistDemo} from '../assist-demo.js';
import {isParkingEvent} from '../parking-event-types.js';
import {glideIndicator, morphSegment, reducedMotion, toggleMotionFrames} from '../motion-runtime.js';
import {createScenePreview} from './scene-preview.js?v=20261119-theme';
import {cutInPhases,isAdjacentCutInScene} from '../cut-in-timing.js?v=yielding-cut-in';
import {LANE_CHANGE_TIMING} from '../lane-change-timing.js';
import {JUNCTION_LEFT_TURN, JUNCTION_LEFT_TIMING} from '../junction-left-turn.js';
import {billingRequest,hasBilling} from './billing-client.js';

(() => {
const $ = (id) => document.getElementById(id);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const LOCK = '<svg class="lock" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const CHECK = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LAYER_CHECK = '<svg class="layer-check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 6 2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON = {
  play: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.6v8.8a.6.6 0 0 0 .92.5l6.86-4.4a.6.6 0 0 0 0-1L5.92 3.1A.6.6 0 0 0 5 3.6Z" fill="currentColor"/></svg>',
  pause: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.25 3.5v9M10.75 3.5v9" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
  replay: '<svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true"><path d="M169.6 512a278.4 278.4 0 0 1 475.264-196.864c13.888 13.888 36.672 38.656 56.512 60.48l25.152 27.904 2.56 2.88H640a41.6 41.6 0 0 0 0 83.2h192a41.6 41.6 0 0 0 41.6-41.6V256a41.6 41.6 0 1 0-83.2 0v94.144l-1.92-2.112-25.472-28.288a2126.848 2126.848 0 0 0-59.328-63.424 361.6 361.6 0 1 0 0 511.36 41.6 41.6 0 1 0-58.88-58.88A278.4 278.4 0 0 1 169.6 512z"/></svg>'
};
const TOTAL = DRIVING_EVENT_SECONDS;
const {signalAt} = LANE_CHANGE_TIMING;
const laneChangePhases = ({steerAt, settledAt, conflictAt = Infinity, clearAt = 0, side = 'right', liveTraffic, waiting}) => {
  const check = ['Check gap', Number.isFinite(conflictAt) ? Math.max(signalAt, conflictAt) : signalAt, `The vehicle checks traffic in the ${side} lane.`];
  if (waiting) return [check, ['Wait for a gap', TOTAL - signalAt, 'The vehicle stays in its lane while traffic passes.']];
  const conflict = Number.isFinite(conflictAt);
  return [
    check,
    ['Gap detected', Number.isFinite(conflictAt) ? 0 : steerAt - signalAt, `The ${side} lane has room. The vehicle plans its move.`],
    ...(conflict ? [
      ['Wait for a gap', clearAt - conflictAt, liveTraffic ? 'The vehicle holds its lane while traffic passes.' : 'The vehicle eases off and lets the other car move ahead.'],
      ['Gap clear', steerAt - clearAt, 'The vehicle rechecks the space before moving.'],
    ] : []),
    ['Change lanes', settledAt - steerAt, `The vehicle steers into the ${side} lane.`],
    ['Lane change complete', TOTAL - settledAt, `The vehicle settles in the ${side} lane.`],
  ].filter(([, duration]) => duration > 0);
};
const {yieldAt, stopAt, turnAt, duration: junctionDuration} = JUNCTION_LEFT_TIMING;
const EVENTS = {
  'parking-yield': {label: 'Oncoming car', phases: [['Approach', 10, 'The vehicle makes room for an oncoming car before parking.']]},
  'parking-taken': {label: 'Space taken', phases: [['Approach', 10, 'The vehicle finds another space when the selected bay is taken.']]},
  [JUNCTION_LEFT_TURN]: {label: 'Left turn'},
  roadworks: {label: 'Roadworks', phases: [
    ['Cruise', 1.3, 'Cones close the middle lane ahead.'],
    ['Brake', 1.5, 'The vehicle slows for the closed lane.'],
    ['Merge', 3.6, 'The vehicle moves into the open lane when there is room.'],
    ['Pass', 2.2, 'The vehicle passes the work zone.'],
    ['Resume', TOTAL - 8.6, 'The work zone is behind. The vehicle returns to cruising speed.']
  ]},
  cutin: {label: 'Cut-in'},
  lanechange: {label: 'Lane change', phases: laneChangePhases(LANE_CHANGE_TIMING)},
};
const isRampMerge = () => S.scene === 'ramp' && S.rampLayout === '07';
// Driving events include a cruise tail; parking duration follows the maneuver.
const total = () => S.roadRun ? Math.round(100*(S.roadRun.duration-S.roadRun.eventStart))/100 : isParkingEvent(S.event) ? S.parkingRun?.duration ?? TOTAL : S.event === JUNCTION_LEFT_TURN ? S.junctionTiming?.duration ?? junctionDuration : TOTAL;
const eventLabel = event => event === 'cutin' && isRampMerge() ? 'Merge' : EVENTS[event].label;
const checkGap = 'The vehicle checks the next ramp lane and the mainline.';
const initialMergePhases = [['Approach', TOTAL, checkGap]];
const mergePhases = ({strategy, decisionAt, releaseAt, mergeAt, settledAt, endAt = TOTAL, yieldTo, rearAlsoPassed, passAt, followsLead}) => {
  if (strategy === 'wait') return [
    ['Approach', decisionAt, checkGap],
    ['Wait for a gap', endAt - decisionAt, 'The vehicle holds on the ramp while traffic passes.'],
  ];
  const yielding = strategy === 'yield';
  const yieldHint = rearAlsoPassed
    ? 'The vehicle leaves room for both ramp and mainline traffic to pass.'
    : yieldTo === 'ramp'
      ? 'The vehicle slows to let the car in the next ramp lane merge first.'
      : 'The vehicle slows on the ramp to let mainline traffic pass.';
  return [
    ['Approach', decisionAt, checkGap],
    ['Yield', releaseAt - decisionAt, yieldHint],
    ['Accelerate', mergeAt - releaseAt, yielding
      ? 'The way is clear. The vehicle builds speed to join behind the passing car.'
      : 'There is room ahead. The vehicle builds speed to merge.'],
    ['Merge', settledAt - mergeAt, 'The vehicle joins the mainline.'],
    [followsLead ? 'Follow' : 'Cruise', (passAt ?? endAt) - settledAt, followsLead
      ? 'The vehicle leaves room behind the car ahead.' : 'The vehicle builds up to cruising speed.'],
    ['Pass', endAt - (passAt ?? endAt), 'The left lane is clear. The vehicle moves over and accelerates past the slower car.'],
  ].filter(([, duration]) => duration > 0);
};
const junctionPhases = ({turnAt, clearAt, duration} = JUNCTION_LEFT_TIMING) => [
  ['Approach', yieldAt, 'The vehicle signals left and slows for the junction.'],
  ['Stop', stopAt - yieldAt, 'The vehicle stops at the line and checks traffic.'],
  ['Wait for a gap', Math.min(turnAt, duration) - stopAt, 'The vehicle waits for room to complete the turn.'],
  ...(Number.isFinite(turnAt) ? [
    ['Turn left', clearAt - turnAt, 'The turning path is clear. The vehicle turns left.'],
    ['Resume', duration - clearAt, 'The vehicle clears the junction and returns to cruising speed.'],
  ] : []),
];
const eventPhases = () => {
  if (S.event === 'roadworks' && S.roadRun?.workZoneTiming) {
    const {brakeAt, mergeAt, passAt, clearAt, waitAt, endAt} = S.roadRun.workZoneTiming;
    const starts = [
      ['Cruise', 0, 'Cones close the middle lane ahead.'],
      ['Brake', Math.max(0,brakeAt), 'The vehicle slows for the closed lane.'],
      ['Wait for a gap', waitAt, 'The vehicle stays clear of the work zone while traffic passes.'],
      ['Merge', mergeAt, 'The vehicle moves into the open lane.'],
      ['Pass', passAt, 'The vehicle passes the work zone.'],
      ['Resume', clearAt, 'The work zone is behind. The vehicle returns to cruising speed.'],
    ].filter(([,at]) => at < endAt).sort((a,b) => a[1]-b[1]);
    return starts.map(([label,at,guide],i) => [label,(starts[i+1]?.[1] ?? endAt)-at,guide]).filter(([,length]) => length>0);
  }
  if (S.event === JUNCTION_LEFT_TURN) return junctionPhases(S.junctionTiming);
  if (isParkingEvent(S.event)) return S.parkingRun?.phases ?? EVENTS[S.event].phases;
  if (S.event === 'lanechange') return S.laneChangePhases ?? EVENTS.lanechange.phases;
  if (!isAdjacentCutIn()) return EVENTS[S.event].phases;
  if (isRampMerge()) return S.mergePhases ?? initialMergePhases;
  return cutInPhases(S.cutInTiming);
};
const phases = () => {
  const handoff = S.roadRun?.handoff ?? 0;
  const steps = eventPhases();
  return handoff > 0 ? [['Complete maneuver', handoff, 'The vehicle finishes the current maneuver before the new one begins.'], ...steps] : steps;
};
const ROADWORKS_SCENE = 'elevated';
const FORMATS = [['png', 'PNG'], ['kit', 'Kit (ZIP)'], ['camera', 'Camera (JSON)'], ['depth', 'Depth (PNG)'], ['video', 'Video (MP4)']];
const CAMERAS = [['low', 'Low'], ['high', 'High']];
const PARKING_CAMERAS = [...CAMERAS, ['parked', 'Parked']];
const EVENT_CAMERAS = [['auto', 'Auto'], ['low', 'Low'], ['high', 'High']];
const PASS_SIDES = [['left', 'Left'], ['right', 'Right']];
const RAMP_TYPES = [['06', 'Exit'], ['07', 'Entrance']];

const S = {
  plan: 'guest', email: '', event: 'none', playing: false, t: 0,
  camera: 'low', parkedCamera: false, parkedFormat: 'png', eventCamera: 'auto', lanes: '6', rampLayout: '06', passOn: 'left',
  format: 'png', size: '3840', billing: 'yearly', intent: null,
  scene: 'road', assist: false, weather: 'default', layers: {traffic: false, buildings: true, trees: true}
};
let billingAccount = null;
function applyAccount(account) {
  billingAccount = account;
  Object.assign(S,{email:account.email??'',plan:account.pro?'pro':account.email?'free':'guest'});
  if (!account.pro) Object.assign(S,{event:'none',playing:false,t:0,liveRoad:false,roadRun:null,
    format:S.format==='video'?'png':S.format});
  renderAll();
}
const isParkingScene = scene => scene === 'parking' || scene === 'outdoor';
const pro = () => S.plan === 'pro';
const active = () => pro() && S.event !== 'none';
const isAdjacentCutIn = () => S.event === 'cutin' && isAdjacentCutInScene(S.scene);
const eventAvailable = event => S.scene !== 'road' || event === 'roadworks' || Number(S.lanes) >= 4;
const newCutInSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
function eventParams() {
  if (S.event === 'roadworks') return {side: S.passOn};
  return isAdjacentCutIn() ? {cutInSeed: S.cutInSeed} : {};
}
const phaseAt = (t, steps) => { let acc = 0; for (let i = 0; i < steps.length; i++) { acc += steps[i][1]; if (t < acc) return i; } return steps.length - 1; };

const preview = createScenePreview({
  clip: document.querySelector('.artboard-clip'),
  engineRevision: document.querySelector('meta[name="scene-engine-revision"]')?.content,
  onReady(bridge, event, {eventApplied}) {
    refreshParkedAvailability(bridge.get({audit: false}));
    if (eventApplied) {
      const state = bridge.get({audit: false});
      if (S.liveRoad) {
        if (state.roadworks?.event === S.event) {
          S.roadRun = state.roadworks;
          S.t = Math.max(0, state.roadworks.time - state.roadworks.eventStart);
          S.playing = state.requestedPlaying;
        }
        S.liveRoad = false;
      }
      updateTimeline(state);
      return;
    }
    if (event) {
      bridge.setDrivingEvent(event, eventParams());
      bridge.setRoadworksCamera(S.eventCamera);
      bridge.seekRoadworks(S.t);
      if (S.playing) bridge.setPlaying(true);
    } else {
      bridge.finishScene();
      if (restoreParkedEntry) {
        restoreParkedEntry = false;
        if (bridge.restoreParkedPreview?.()) {
          parkedSource = bridge.parkingComposition();
          autoParkedShown = true;
          refreshParkedAvailability(bridge.get({audit: false}));
          void syncParkedView();
        } else void hideParked();
      }
    }
    updateTimeline();
  },
  onError(error) {
    if (restoreParkedEntry) void hideParked();
    S.playing = false;
    updateTimeline();
    toast(error.message);
  }
});
const isTimeline = () => active() && !parkedView();
const parkedView = () => isParkingScene(S.scene) && S.parkedCamera;
const themeName = () => document.documentElement.dataset.theme;
const currentVehicle = () => vehicleOptions.find(option => option.getAttribute('aria-checked') === 'true')?.dataset.vehicle ?? 'model-3';
const parkedClip = document.querySelector('.artboard-clip');
let parkedRenderer, parkedRig, parkedCanvas, parkedFrame, parkedSource, parkedMotion, parkedLive, parkedReturn;
let parkedRequest = 0, parkedPosition = 0, canViewParked = false, restoreParkedEntry = false, parkedReplayPending = false;
let parkedCameraPending = false, exitInProgress = false, autoParkedShown = false;
let resumeAfterScrub = null;
const parkingInteractionsLocked = () => isParkingScene(S.scene) && (transportPending || parkedCameraPending || exitInProgress);
const parkedRatio = 1767 / 1090;
const parkedRenderRevision = '20261119-parked-soft-dark-grain';
const parkedMotionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = value => Math.min(1, Math.max(0, value));
const smooth = value => value * value * (3 - 2 * value);
const smoother = value => value ** 3 * (value * (6 * value - 15) + 10);
function compositeParked(live, parked, opacity) {
  const source = opacity < 1 && live ? live : parked;
  if (!source) return;
  const {width, height} = opacity > 0 && parked ? parked : source;
  if (parkedCanvas.width !== width || parkedCanvas.height !== height) {
    parkedCanvas.width = width;
    parkedCanvas.height = height;
  }
  const context = parkedCanvas.getContext('2d', {alpha: false});
  context.drawImage(source, 0, 0, width, height);
  if (parked && source !== parked && opacity > 0) {
    context.globalAlpha = opacity;
    context.drawImage(parked, 0, 0, width, height);
    context.globalAlpha = 1;
  }
  parkedCanvas.hidden = false;
}
function paintParkedView() {
  if (!parkedFrame || (parkedCanvas.hidden && !parkedView()) || !parkedPosition) return;
  const reduced = parkedMotionPreference.matches;
  const progress = reduced ? 1 : smoother(parkedPosition);
  const opacity = smooth(parkedPosition);
  const {clientWidth, clientHeight} = parkedClip;
  if (!clientWidth || !clientHeight) return;
  const animated = parkedPosition !== 1;
  const scale = animated ? Math.min(1.25, devicePixelRatio) :
    Math.min(2.5, Math.max(2.25, devicePixelRatio), Math.sqrt(5_000_000 / (clientWidth * clientHeight)));
  const returning = parkedReturn && {source: parkedReturn.source,
    weight: parkedReturn.from === 1 ? 1 : smooth(1 - parkedPosition / parkedReturn.from)};
  // Sample both layers at the same instant, including the first render after arrival.
  const frameTime = performance.timeOrigin + performance.now();
  const pose = parkedRig.render({
    ...parkedFrame, theme: themeName(), width: Math.round(clientWidth * scale), height: Math.round(clientHeight * scale),
    source: parkedSource, returning, progress, animated
  });
  let live;
  if (opacity < 1) {
    parkedLive ??= preview.bridge();
    live = reduced ? parkedLive?.canvas : parkedLive?.paintParkedBlend?.(pose, undefined, 1 - opacity, frameTime);
  }
  compositeParked(live, parkedRig.canvas, opacity);
  if (!animated && parkedView()) {
    clearParkedEntry();
    rememberParkedFrame(parkedFrame.model);
  }
}
function clearParkedEntry() {
  if (!parkedClip.hasAttribute('data-parked-entry')) return;
  delete parkedClip.dataset.parkedEntry;
  document.documentElement.style.removeProperty('--parked-entry-frame');
}
function finishParkedBlend(destination) {
  const canvas = (parkedLive ?? preview.bridge())?.paintParkedBlend?.(null, destination);
  parkedLive = null;
  return canvas;
}
new ResizeObserver(paintParkedView).observe(parkedClip);
function stopParkedMotion() {
  if (!parkedMotion) return;
  cancelAnimationFrame(parkedMotion.frame);
  parkedMotion.finish();
  parkedMotion = null;
}
function animateParked(to) {
  stopParkedMotion();
  if (parkedPosition === to) return Promise.resolve();
  const from = parkedPosition;
  const reduced = parkedMotionPreference.matches;
  const indoorArrival = to === 1 && S.scene === 'parking';
  const duration = (reduced ? 160 : indoorArrival ? 2000 : 1820) * Math.abs(to - from);
  const maxFrameMs = reduced ? 160 : indoorArrival ? Infinity : 120;
  return new Promise(finish => {
    const motion = parkedMotion = {finish};
    let previous, elapsed = 0;
    function step(now) {
      elapsed += Math.min(maxFrameMs, now - (previous ?? now));
      previous = now;
      const t = clamp(elapsed / duration);
      parkedPosition = from + (to - from) * t;
      paintParkedView();
      if (t < 1) motion.frame = requestAnimationFrame(step);
      else {
        parkedMotion = null;
        if (to === 1) finishParkedBlend();
        finish();
      }
    }
    motion.frame = requestAnimationFrame(step);
  });
}
function refreshParkedAvailability(state) {
  const run = state?.event;
  const matched = active() ? run?.event === S.event && run.time >= run.duration : !run;
  const sameScene = isParkingScene(S.scene) && state?.scene === S.scene;
  const ready = sameScene && matched &&
    !S.assist && !state.requestedPlaying && !!state.parking?.complete && !state.parking.camera.tween &&
    !!preview.bridge()?.parkingComposition?.();
  if (ready === canViewParked) return;
  canViewParked = ready;
  renderCamera();
  renderPlayback(false);
}
function renderParkedControls() {
  setParkedUrl();
  renderCamera();
  renderExport();
  renderPlayback(true);
}
function showParked(source, animate = true) {
  if (!source || parkedView()) return;
  stopParkedMotion();
  parkedSource = source;
  parkedReturn = null;
  S.parkedCamera = true;
  autoParkedShown = true;
  renderParkedControls();
  void syncParkedView(animate);
}
async function hideParked(animate = false, destination) {
  const id = ++parkedRequest;
  if (animate && parkedPosition && destination) {
    const source = preview.bridge()?.parkingComposition?.(destination);
    if (source) parkedReturn = {source, from: parkedPosition};
  }
  restoreParkedEntry = false;
  clearParkedEntry();
  S.parkedCamera = false;
  renderParkedControls();
  document.querySelector('#scene-properties [data-value=parked]')?.removeAttribute('aria-busy');
  const transitioning = animate && parkedPosition > 0;
  if (transitioning && destination && parkedMotionPreference.matches) finishParkedBlend(destination);
  if (transitioning) await animateParked(0);
  if (id !== parkedRequest) return false;
  stopParkedMotion();
  const live = finishParkedBlend(animate ? destination : undefined);
  if (transitioning && live) {
    // Present the exact destination frame before returning presentation to the live iframe.
    compositeParked(live, null, 0);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (id !== parkedRequest) return false;
  }
  if (parkedCanvas) parkedCanvas.hidden = true;
  parkedPosition = 0;
  parkedReturn = null;
  return true;
}
function prepareParkedVehicle(model = currentVehicle()) {
  parkedRenderer ??= import(`../parked-view.bundle.js?v=${parkedRenderRevision}`).then(({createParkedView}) => {
    parkedRig = createParkedView();
    const canvas = parkedCanvas = document.createElement('canvas');
    canvas.className = 'parked-view';
    canvas.hidden = true;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Parked 3D vehicle');
    parkedClip.append(canvas);
    return parkedRig;
  }).catch(error => { parkedRenderer = null; throw error; });
  return parkedRenderer.then(rig => rig.prepareVehicle(model));
}
async function syncParkedView(animate = false) {
  if (!parkedView()) return;
  const id = ++parkedRequest, camera = document.querySelector('#scene-properties [data-value=parked]');
  const model = currentVehicle();
  camera?.setAttribute('aria-busy', 'true');
  try {
    const vehicle = parkedFrame?.model === model ? parkedFrame.vehicle : await prepareParkedVehicle(model);
    if (id !== parkedRequest || !parkedView()) return;
    parkedFrame = {model, vehicle};
    if (!animate) parkedPosition = 1;
    paintParkedView();
    if (animate) await animateParked(1);
  } catch (error) {
    if (id !== parkedRequest) return;
    void hideParked();
    toast(error.message);
  } finally {
    if (id === parkedRequest) camera?.removeAttribute('aria-busy');
  }
}
function setParkedUrl() {
  const url = new URL(location.href);
  const previous = history.state;
  let state = previous;
  if (parkedView()) {
    url.searchParams.set('view', 'parked');
    const model = currentVehicle(), theme = themeName();
    if (state?.parkedPreview?.model !== model || state?.parkedPreview?.theme !== theme) {
      state = {...state, parkedPreview: {model, theme}};
    }
  } else if (url.searchParams.get('view') === 'parked') {
    url.searchParams.delete('view');
    if (state?.parkedPreview) {
      state = {...state};
      delete state.parkedPreview;
    }
  }
  if (url.href !== location.href || state !== previous) history.replaceState(state, '', url);
}
function rememberParkedFrame(model) {
  if (model !== currentVehicle()) return;
  const theme = themeName(), saved = history.state?.parkedPreview;
  if (saved?.model === model && saved?.theme === theme && saved.revision === parkedRenderRevision && saved.poster) return;
  // Keep one bounded poster in this history entry for a native reload.
  const thumbnail = document.createElement('canvas');
  thumbnail.width = Math.min(1440, parkedCanvas.width);
  thumbnail.height = Math.round(thumbnail.width * parkedCanvas.height / parkedCanvas.width);
  const context = thumbnail.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(parkedCanvas, 0, 0, thumbnail.width, thumbnail.height);
  try {
    const poster = thumbnail.toDataURL('image/jpeg', .94);
    history.replaceState({...history.state, parkedPreview: {model, theme, poster, revision: parkedRenderRevision}}, '');
  } catch {
    // A storage or browser limit must not prevent the live frame from displaying.
  }
}
function syncScene() {
  void preview.show(S.scene, active() ? S.event : null, {
    ...S, model: currentVehicle(), params: eventParams(), theme: themeName()
  });
}
function updateSceneParam(key, value) {
  return preview.apply((bridge) => bridge.param(key, value), {sameScene: key === 'traffic'});
}

/* ---------- Toast and tooltip (reuse the live elements) ---------- */
let toastTimer;
function toast(msg, action) {
  const box = $('feedback'), slot = $('feedback-action'); $('feedback-message').textContent = msg; slot.replaceChildren();
  if (action) {
    const b = h('<button type="button"></button>'); b.textContent = action.label;
    b.addEventListener('click', () => { clearTimeout(toastTimer); box.hidden = true; action.run(); });
    slot.append(b);
  }
  box.hidden = false; box.setAttribute('role', 'status'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, action ? 6000 : 4000);
}
let tipTimer, tipAnchor;
document.addEventListener('pointerover', (e) => {
  if (!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  const el = e.target.closest('[data-tip]'); if (!el || el === tipAnchor) return;
  hideTip(); tipTimer = setTimeout(() => showTip(el), 400);
});
document.addEventListener('pointerout', (e) => { const el = e.target.closest('[data-tip]'); if (el && !el.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('pointerdown', hideTip);
function showTip(el) {
  const tip = $('tooltip'); tipAnchor = el; tip.textContent = el.dataset.tip; tip.hidden = false;
  const b = el.getBoundingClientRect(), r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, b.left + b.width / 2 - r.width / 2)) + 'px';
  tip.style.top = (b.top - r.height - 8 < 8 ? b.bottom + 8 : b.top - r.height - 8) + 'px';
}
function hideTip() { clearTimeout(tipTimer); tipAnchor = null; const t = $('tooltip'); if (t) t.hidden = true; }

/* ---------- Segments (indicator follows the checked item) ---------- */
function layoutSegment(seg) {
  const buttons = [...seg.querySelectorAll('button[role=radio]')];
  if (!buttons.length || !seg.clientWidth) return;
  if (seg.dataset.param !== 'camera') {
    const width = (seg.clientWidth - 4 - 2 * (buttons.length - 1)) / buttons.length;
    buttons.forEach((button) => { button.style.width = width + 'px'; });
  }
  morphSegment(seg, seg.querySelector('[aria-checked=true]') || buttons[0], true);
}
function segmentHTML(label, key, options, value) {
  return `<div class="segment" role="radiogroup" aria-label="${label}" data-key="${key}">${options.map(([v, t]) =>
    `<button type="button" role="radio" aria-checked="${v === value}" tabindex="${v === value ? 0 : -1}" data-value="${v}" data-tip="${label} ${t}">${t}</button>`).join('')}</div>`;
}
function pick(seg, btn, animate = false) {
  seg.querySelectorAll('button[role=radio]').forEach((b) => { const on = b === btn; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
  if (seg.clientWidth) morphSegment(seg, btn, !animate);
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.segment button[role=radio]'); if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
  const seg = btn.closest('.segment'); if (seg.closest('#vehicle-panel')) return;
  const key = seg.dataset.key || seg.dataset.param, v = btn.dataset.value;
  if (key === 'camera' && isParkingScene(S.scene) && (transportPending || parkedReplayPending || parkedCameraPending)) return;
  if (key === 'camera' && v === 'parked') {
    if (canViewParked) showParked(preview.bridge()?.parkingComposition?.());
    return;
  }
  pick(seg, btn, e.detail > 0);
  if (key === 'camera') {
    const {scene, event} = S;
    const inEvent = active();
    if (inEvent) S.eventCamera = v;
    else {
      S.camera = v;
      if (!isParkingScene(scene)) S.eventCamera = v;
    }
    if (parkedView() || parkedPosition) {
      const destination = v !== 'auto' && preview.bridge()?.parkingComposition?.(v) ? v : undefined;
      parkedCameraPending = true;
      renderInteraction(false, false);
      try {
        if (!await hideParked(true, destination) || S.scene !== scene || S.event !== event || S.assist || destination) return;
      } finally {
        parkedCameraPending = false;
        renderInteraction(false, false);
      }
    }
    if (inEvent) void preview.apply(bridge => bridge.setRoadworksCamera(v, {animate: true}));
    else void updateSceneParam('camera', v);
  }
  else if (key === 'lanes' && S.lanes !== v) {
    S.lanes = v;
    if (active() && !eventAvailable(S.event)) {
      if (S.eventCamera !== 'auto') S.camera = S.eventCamera;
      Object.assign(S, {event: 'none', liveRoad: true, roadRun: null});
      renderAll({animateControls: e.detail > 0});
    } else {
      renderInteraction(false, false);
      syncScene();
    }
  }
  else if (key === 'side') changeRoute(v);
  else if (key === 'ramp-type') changeRampType(v);
});
document.addEventListener('keydown', (e) => {
  const btn = e.target.closest && e.target.closest('.segment button[role=radio]'); if (!btn || btn.disabled) return;
  const btns = [...btn.parentElement.querySelectorAll('button[role=radio]:not(:disabled):not([aria-disabled=true])')], i = btns.indexOf(btn);
  const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: btns.length - 1 }[e.key];
  if (next === undefined) return; e.preventDefault();
  const target = btns[(next + btns.length) % btns.length]; target.focus(); target.click();
});
function layoutAllSegments() {
  document.querySelectorAll('.segment').forEach((s) => { if (!s.closest('#vehicle-panel')) layoutSegment(s); });
  document.querySelectorAll('.shared-weather-options').forEach((s) => {
    const selected = s.querySelector('[aria-checked=true]');
    if (selected && s.clientWidth) morphSegment(s, selected, true);
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.shared-weather-options button'); if (!b || !sceneHasWeather(S.scene)) return;
  b.parentElement.querySelectorAll('button').forEach((x) => { x.setAttribute('aria-checked', x === b); x.tabIndex = x === b ? 0 : -1; });
  S.weather = b.dataset.weather;
  morphSegment(b.parentElement, b, e.detail === 0);
  updateSceneParam('weather', S.weather);
});

/* ---------- Menus (live .format-options popover) ---------- */
let openMenu = null;
function closeMenu(focusTrigger) {
  if (!openMenu) return; const { el, trigger, own } = openMenu;
  if (own) el.remove(); else el.hidden = true;
  trigger.setAttribute('aria-expanded', 'false'); openMenu = null; if (focusTrigger) trigger.focus();
}
function showMenu(trigger, el, { up = false, own = true, alignRight = false, width } = {}) {
  closeMenu(); if (own) document.body.append(el);
  el.hidden = false;
  const r = trigger.getBoundingClientRect();
  const inset = 8, gap = 4;
  el.style.width = (width || Math.max(160, r.width)) + 'px';
  const w = el.offsetWidth;
  if (up === 'auto') {
    const below = innerHeight - r.bottom;
    up = below < el.offsetHeight + gap + inset && r.top > below;
  }
  el.classList.toggle('up', up);
  const left = alignRight ? r.right - w : r.left;
  el.style.left = Math.max(inset, Math.min(innerWidth - w - inset, left)) + 'px';
  el.style.bottom = up ? (innerHeight - r.top + gap) + 'px' : '';
  el.style.top = up ? '' : (r.bottom + gap) + 'px';
  trigger.setAttribute('aria-expanded', 'true'); openMenu = { el, trigger, own };
  (el.querySelector('[aria-selected=true], [aria-checked=true]') || el.querySelector('button'))?.focus({ preventScroll: true });
}
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.el.contains(e.target) && !openMenu.trigger.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (openMenu) return closeMenu(true); if (dialog) return closeDialog(); }
  if (e.key === 'Tab' && dialog && !openMenu) {
    const items = [...dialog.querySelectorAll('button, input, a[href], [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = items[0], last = items.at(-1), active = document.activeElement;
    if (!items.length) return e.preventDefault();
    if (e.shiftKey && (active === first || !dialog.contains(active) || active.matches('[role=dialog]'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !dialog.contains(active))) { e.preventDefault(); first.focus(); }
  }
  if (!openMenu || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  const items = [...openMenu.el.querySelectorAll('button')], i = items.indexOf(document.activeElement);
  e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
});
addEventListener('resize', () => { closeMenu(); layout(); layoutAllSegments(); });

const vehicleCard = document.querySelector('.shell-vehicle-card');
const vehicleOptions = [...$('vehicle-strip').querySelectorAll('[data-vehicle]')];
function selectVehicleOption(option) {
  for (const item of vehicleOptions) item.setAttribute('aria-checked', String(item === option));
  const name = option.getAttribute('aria-label');
  vehicleCard.querySelector('.name').textContent = name;
  vehicleCard.querySelector('img').src = option.querySelector('img').src;
  vehicleCard.setAttribute('aria-label', 'Vehicle: ' + name);
}
function showVehicles() {
  if (vehicleCard.getAttribute('aria-busy') === 'true') return;
  if (openMenu?.trigger === vehicleCard) return closeMenu(true);
  const menu = h('<div class="shell-vehicle-menu" role="menu" aria-label="Vehicle"></div>');
  for (const source of vehicleOptions) {
    const option = h('<button type="button" role="menuitemradio" tabindex="-1"><img alt=""><span></span></button>');
    const name = source.getAttribute('aria-label'), image = source.querySelector('img').src;
    option.setAttribute('aria-checked', source.getAttribute('aria-checked'));
    option.querySelector('img').src = image;
    option.querySelector('span').textContent = name;
    option.addEventListener('click', async () => {
      closeMenu(true);
      if (source.getAttribute('aria-checked') === 'true') return;
      vehicleCard.setAttribute('aria-busy', 'true');
      try {
        await preview.selectVehicle(source.dataset.vehicle);
        selectVehicleOption(source);
        void syncParkedView();
      } catch (error) {
        toast(error.message);
      } finally {
        vehicleCard.removeAttribute('aria-busy');
      }
    });
    menu.append(option);
  }
  menu.addEventListener('keydown', e => { if (e.key === 'Tab') closeMenu(true); });
  const compact = matchMedia('(max-width:639px), (max-width:959px) and (max-height:500px), (max-width:959px) and (orientation:portrait)').matches;
  showMenu(vehicleCard, menu, {up: !compact, width: vehicleCard.getBoundingClientRect().width});
}
vehicleCard.addEventListener('click', showVehicles);
vehicleCard.addEventListener('keydown', e => {
  if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  showVehicles();
});

/* ---------- Toolbar account area ---------- */
function renderAccount() {
  const box = $('account-actions');
  if (S.plan === 'guest') box.innerHTML = '<button type="button" class="tb-btn raised-btn" id="sign-in">Sign in</button>';
  else box.innerHTML = (pro() ? '<span class="pro-tag">Pro</span>' : '<button type="button" class="tb-btn raised-btn" id="upgrade-top">Upgrade</button>') +
    '<button type="button" class="avatar" id="account" aria-haspopup="menu" aria-expanded="false" aria-label="Account" data-tip="Account"><span></span></button>';
  if (S.plan!=='guest') box.querySelector('.avatar span').textContent=(S.email[0] || 'P').toUpperCase();
}
$('account-actions').addEventListener('click', (e) => {
  if (e.target.closest('#sign-in')) openSignIn(null);
  else if (e.target.closest('#upgrade-top')) openUpgrade('top');
  else if (e.target.closest('#account')) {
    const t = e.target.closest('#account'); if (openMenu?.trigger === t) return closeMenu();
    const m = h(`<div class="format-options proto" role="menu" aria-label="Account"><div class="menu-head"><b></b><span>${pro() ? 'Pro plan' : 'Free plan'}</span></div>
      ${(!hasBilling && pro() || billingAccount?.subscription) ? '<button type="button" role="menuitem" data-act="manage">Manage subscription</button>' : ''}
      ${!pro() ? '<button type="button" role="menuitem" data-act="upgrade">Upgrade to Pro</button>' : ''}
      <button type="button" role="menuitem" data-act="signout">Sign out</button></div>`);
    m.querySelector('.menu-head b').textContent=S.email;
    m.addEventListener('click', async (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act; if (!act) return; closeMenu();
      try {
        if (act === 'upgrade') openUpgrade('top');
        if (act === 'manage') {
          if (hasBilling) location.assign((await billingRequest('portal',{})).url);
          else toast('The billing portal requires the connected workbench.');
        }
        if (act === 'signout') {
          if (hasBilling) await billingRequest('signout',{});
          applyAccount({email:null,pro:false});
        }
      } catch(error) { toast(error.message); }
    });
    showMenu(t, m, { alignRight: true, width: 232 });
  }
});

/* ---------- Inspector: interaction, camera, layers, guide, export ---------- */
const SCENE_EVENTS = Object.entries(EVENTS);
const sceneHasEvent = (scene, event) => {
  if (isParkingEvent(event)) return ['parking', 'outdoor'].includes(scene);
  if (event === 'roadworks') return scene === ROADWORKS_SCENE;
  if (event === 'lanechange') return scene === 'road';
  if (event === JUNCTION_LEFT_TURN) return scene === 'junction';
  return isAdjacentCutInScene(scene);
};
const focusEvent = (event) => document.querySelector(`[data-event="${event}"]`)?.focus({ preventScroll: true });
function renderInteraction(animate, animateControls) {
  const sec = $('interaction-settings');
  const elevated = S.scene === ROADWORKS_SCENE;
  sec.hidden = !elevated && S.scene !== 'junction' && !isAdjacentCutInScene(S.scene) && !['parking', 'outdoor'].includes(S.scene);
  if (sec.hidden) {
    sec.replaceChildren();
    return;
  }
  const eventGroup = S.plan + '-' + S.scene;
  if (!sec.firstElementChild || sec.dataset.group !== eventGroup) {
    sec.dataset.group = eventGroup;
    sec.innerHTML = `<h2>Interaction${pro() ? '' : '<span class="pro-tag">Pro</span>'}</h2>
    <div class="event-list" role="group" aria-label="Interaction events">${SCENE_EVENTS.filter(([event]) => sceneHasEvent(S.scene, event)).map(([event]) => {
      const label = eventLabel(event);
      const toggle = `<button type="button" class="layer-row${pro() ? '' : ' locked'}" role="switch" data-event="${event}"><span>${label}</span>${LAYER_CHECK}</button>`;
      if (event !== 'roadworks') return toggle;
      return `<div class="roadworks-controls" role="group" aria-label="Roadworks setup">${toggle}
        <div class="event-disclosure"><div class="event-disclosure-clip"><div class="properties event-params">
          <div class="property"><span class="property-label">Pass on</span>${segmentHTML('Pass on', 'side', PASS_SIDES, S.passOn)}</div>
        </div></div></div>
      </div>`;
    }).join('')}</div>`;
  }
  sec.dataset.motion = animate ? 'live' : 'instant';
  for (const row of sec.querySelectorAll('[data-event]')) {
    const event = row.dataset.event, label = eventLabel(event);
    if (row.firstElementChild.textContent !== label) row.firstElementChild.textContent = label;
    const on = active() && S.event === event;
    const unavailable = !eventAvailable(event);
    const parkingLocked = parkingInteractionsLocked();
    const tip = parkingLocked ? 'Available after the parking exit' : unavailable ? label + ' needs two lanes in the same direction. Choose 4 or 6 lanes.' : !pro() ? (S.plan === 'guest' ? 'Sign in to use ' : 'Upgrade to Pro to use ') + label :
      on ? 'Turn off ' + label : active() ? (S.event === 'lanechange' && event === 'cutin' ? 'Queue ' : 'Switch to ') + label : 'Play ' + label;
    setToggle(row, 'aria-checked', on, animateControls);
    row.dataset.tip = tip;
    if (unavailable || parkingLocked) row.setAttribute('aria-disabled', 'true');
    else row.removeAttribute('aria-disabled');
    if (unavailable || parkingLocked || !pro()) row.setAttribute('aria-description', tip);
    else row.removeAttribute('aria-description');
  }
  const seg = sec.querySelector('.segment[data-key=side]');
  if (seg && seg.querySelector('[aria-checked=true]')?.dataset.value !== S.passOn) {
    const btn = seg.querySelector(`[data-value=${S.passOn}]`); if (btn) pick(seg, btn);
  }
}
// Starting a new run slides the playhead back to 0 instead of jumping.
function slideToStart() {
  const tl = $('event-timeline'); tl.classList.add('is-resetting');
  clearTimeout(slideToStart.timer); slideToStart.timer = setTimeout(() => tl.classList.remove('is-resetting'), 760);
}
function changeRoute(side) {
  if (side === S.passOn) return;
  S.passOn = side;
  if (!(active() && S.event === 'roadworks')) return;
  void preview.apply(bridge => {
    bridge.cutRoadworksSide(S.passOn);
    updateTimeline();
  });
}
$('interaction-settings').addEventListener('click', (e) => {
  const row = e.target.closest('[data-event]');
  if (!row || row.getAttribute('aria-disabled') === 'true') return;
  const event = row.dataset.event;
  if (!pro()) return S.plan === 'guest' ? openSignIn(event) : openUpgrade(event);
  if (isParkingScene(S.scene)) {
    const state = preview.bridge()?.get({audit:false});
    if (parkingInteractionsLocked() || state?.parking?.mode === 'out') return;
    const turningOff = active() && S.event === event;
    const completed = state?.event?.event === event && state.parking.complete;
    if (turningOff && completed) {
      S.camera = S.eventCamera === 'high' ? 'high' : 'low';
    } else {
      canViewParked = false;
      void hideParked();
    }
  }
  resumeAfterScrub = null;
  const wasPlaying = S.playing;
  closeMenu();
  if (['road', 'elevated', 'ramp'].includes(S.scene) && preview.hasMountedScene(S.scene)) {
    const next = active() && S.event === event ? 'none' : event;
    if (next === 'none' && S.eventCamera !== 'auto') S.camera = S.eventCamera;
    Object.assign(S, {event: next, t: 0, liveRoad: true, roadRun: null,
      playing: true, laneChange: null, laneChangePhases: null});
    if (next === 'cutin') S.cutInSeed = newCutInSeed();
    lastGuide = -1;
    renderAll({animatePlayback: false, animateControls: e.detail > 0});
    return;
  }
  S.liveRoad = false;
  S.roadRun = null;
  if (active() && S.event === event) {
    if (S.scene === 'junction' && S.eventCamera !== 'auto') S.camera = S.eventCamera;
    Object.assign(S, {event: 'none', parkingRun: null, playing: false, t: 0});
    renderAll({animatePlayback: e.detail > 0, animateControls: e.detail > 0});
  } else if (active()) {
    // Selecting another parking demo starts its own playback, as on first selection.
    slideToStart();
    Object.assign(S, {event, parkingRun: null, t: 0, playing: isParkingEvent(event) || wasPlaying});
    lastGuide = -1;
    renderAll({animatePlayback: false, animateControls: e.detail > 0});
  } else {
    startEvent(event, {animatePlayback: e.detail > 0, animateControls: e.detail > 0});
  }
});

// Mirror the workbench Layers rules in this prototype, including responsive rules.
function applyLayerStylesToEvents() {
  const rules = [];
  function collect(source, wrap) {
    for (const rule of source) {
      if (rule.selectorText?.includes('#layers') && rule.selectorText.includes('layer-row')) {
        rules.push(wrap(rule.cssText.replaceAll('#layers', '#interaction-settings .event-list').replaceAll('aria-pressed', 'aria-checked')));
      } else if (rule.media && rule.cssRules) {
        collect(rule.cssRules, (text) => wrap(`@media ${rule.media.mediaText}{${text}}`));
      }
    }
  }
  for (const sheet of document.styleSheets) {
    try { collect(sheet.cssRules, (text) => text); } catch { /* Ignore inaccessible external styles. */ }
  }
  const style = document.createElement('style');
  style.textContent = rules.join('\n');
  document.head.append(style);
}
applyLayerStylesToEvents();

function startEvent(event, {animatePlayback = true, animateControls = false} = {}) {
  if (!sceneHasEvent(S.scene, event)) {
    const scene = isParkingEvent(event) ? 'parking' : event === JUNCTION_LEFT_TURN ? 'junction' : event === 'lanechange' || event === 'cutin' ? 'road' : ROADWORKS_SCENE;
    sceneMemory[S.scene] = {camera: S.camera, eventCamera: S.eventCamera};
    S.camera = sceneMemory[scene]?.camera ?? S.camera;
    S.eventCamera = sceneMemory[scene]?.eventCamera ?? (!isParkingScene(scene) && S.camera === 'high' ? 'high' : 'auto');
    selectScene(scene);
  }
  if (!eventAvailable(event)) return;
  if (isParkingScene(S.scene)) {
    S.assist = false;
    canViewParked = false;
    void hideParked();
    void prepareParkedVehicle().catch(() => {});
  }
  Object.assign(S, {event, parkingRun: null, roadRun: null, liveRoad: false, t: 0, playing: true});
  if (event === 'lanechange') S.laneChange = S.laneChangePhases = null;
  if (isAdjacentCutIn()) S.cutInSeed = newCutInSeed();
  renderAll({animatePlayback, animateControls});
}

function changeRampType(layout) {
  if (S.rampLayout === layout) return;
  S.rampLayout = layout;
  S.roadRun = S.cutInTiming = S.rampMerge = S.mergePhases = null;
  const url = new URL(location.href);
  if (layout === '07') url.searchParams.set('type', 'merge');
  else url.searchParams.delete('type');
  history.replaceState(history.state, '', url);
  if (isAdjacentCutIn()) {
    if (S.t > 0) slideToStart();
    S.t = 0;
    S.cutInSeed = newCutInSeed();
  }
  renderAll({animatePlayback: false});
}
function renderRampType() {
  const properties = $('scene-properties');
  let row = properties.querySelector('.ramp-type');
  if (!row && S.scene === 'ramp') {
    row = h(`<div class="property ramp-type"><span class="property-label">Type</span>${segmentHTML('Type', 'ramp-type', RAMP_TYPES, S.rampLayout)}</div>`);
    properties.prepend(row);
  }
  if (row) row.hidden = S.scene !== 'ramp';
}
// Every event can hold a fixed Low or High camera; Auto follows the event.
const eventCameraChoice = () => active();
function renderCamera() {
  const prop = document.querySelector('#scene-properties .segment[data-param=camera]'); if (!prop) return;
  const mode = isParkingScene(S.scene) ? eventCameraChoice() ? 'parking-event' : 'parking' : eventCameraChoice() ? 'event' : 'scene';
  if (prop.dataset.prototypeOptions !== mode) {
    prop.dataset.prototypeOptions = mode;
    const tips = {auto: 'Camera follows the event', low: 'Camera Low', high: 'Camera High', parked: 'Parked view'};
    // Keep the existing selection indicator mounted when the camera options change.
    prop.querySelectorAll('button[role=radio]').forEach((button) => button.remove());
    const options = mode === 'parking-event' ? [...EVENT_CAMERAS, PARKING_CAMERAS.at(-1)] :
      mode === 'event' ? EVENT_CAMERAS : mode === 'parking' ? PARKING_CAMERAS : CAMERAS;
    prop.insertAdjacentHTML('beforeend', options.map(([v, t]) =>
      `<button type="button" role="radio" aria-checked="false" tabindex="-1" data-value="${v}" data-tip="${tips[v]}">${t}</button>`).join(''));
  }
  const parked = prop.querySelector('[data-value=parked]');
  if (parked) {
    const available = canViewParked || parkedView();
    parked.setAttribute('aria-disabled', String(!available));
    parked.dataset.tip = available ? 'Parked view' : 'Available after parking is complete';
  }
  const value = parkedView() ? 'parked' : eventCameraChoice() ? S.eventCamera : S.camera;
  const selected = prop.querySelector(`[data-value="${value}"]`);
  if (selected && selected.getAttribute('aria-checked') !== 'true') pick(prop, selected);
}

const toggleAnimations = new WeakMap();
function setToggle(row, attribute, on, animate = false) {
  let thumb = row.querySelector('.layer-thumb');
  const previous = row.getAttribute(attribute);
  if (!thumb) {
    thumb = h('<span class="layer-thumb" aria-hidden="true"></span>');
    row.append(thumb);
    animate = false;
  } else if (previous === String(on)) return;
  const running = toggleAnimations.get(thumb);
  if (!animate || reducedMotion()) {
    running?.animation.cancel();
    toggleAnimations.delete(thumb);
    row.setAttribute(attribute, on);
    return;
  }

  // Sample the current presentation before cancelling, so a quick reversal keeps its position and velocity.
  const matrix = new DOMMatrixReadOnly(getComputedStyle(thumb).transform);
  const phase = running ? Math.min(1, Math.max(0, Number(running.animation.currentTime) / running.duration)) : 1;
  const velocity = running?.velocities[Math.round(phase * (running.velocities.length - 1))] || 0;
  const shape = (running?.shapePhase || 0) + phase;
  const shapePhase = shape < 1 ? shape : 0;
  running?.animation.cancel();
  row.setAttribute(attribute, on);
  const target = on ? thumb.offsetWidth : 0;
  const {frames, duration, velocities} = toggleMotionFrames(
    {x: matrix.m41, width: matrix.a, height: matrix.d, velocity}, target, undefined, shapePhase
  );
  const animation = thumb.animate(frames, {duration});
  toggleAnimations.set(thumb, {animation, duration, velocities, shapePhase});
  animation.onfinish = () => {
    if (toggleAnimations.get(thumb)?.animation === animation) toggleAnimations.delete(thumb);
  };
}
const trafficRow = document.querySelector('#layers [data-layer=traffic]');
function renderLayers(animate) {
  const indoor = !sceneHasWeather(S.scene);
  const layers = $('layers');
  layers.closest('section').hidden = indoor;
  $('shared-settings').hidden = indoor;
  for (const row of layers.querySelectorAll('.layer-row')) {
    if (row === trafficRow) continue;
    row.hidden = !sceneHasExteriorLayers(S.scene);
    setToggle(row, 'aria-pressed', S.layers[row.dataset.layer] === true);
  }
  // Roadworks negotiates with background traffic, so Traffic stays yours there; the scripted events own it.
  const locked = active() && S.event !== 'roadworks', tip = 'Traffic is set by the event';
  trafficRow.disabled = locked;
  trafficRow.classList.toggle('event-controlled', locked);
  setToggle(trafficRow, 'aria-pressed', locked || S.layers.traffic, animate);
  trafficRow.dataset.tip = locked ? tip : 'Traffic';
  if (locked) trafficRow.setAttribute('aria-description', tip);
  else trafficRow.removeAttribute('aria-description');
}
$('layers').addEventListener('click', (e) => {
  const r = e.target.closest('.layer-row'); if (!r || r.disabled || r.closest('[hidden]')) return;
  const on = r.getAttribute('aria-pressed') !== 'true';
  setToggle(r, 'aria-pressed', on, e.detail > 0);
  S.layers[r.dataset.layer] = on;
  const change = updateSceneParam(r.dataset.layer, on);
  if (S.event === 'roadworks' && r.dataset.layer === 'traffic') void change.then(() => updateTimeline());
});
function renderGuide() {
  const box = $('tl-guide'); if (!box) return;
  if (!active()) return;
  const steps = phases(), ended = !S.playing && S.t >= total();
  const held = S.event === JUNCTION_LEFT_TURN && S.junctionTiming?.turnAt === Infinity
    || S.event === 'roadworks' && S.roadRun?.workZoneTiming?.clearAt === Infinity;
  const [phase, , guide] = ended && !held ? ['End', 0, 'Replay to watch again, or drag to pick a frame.'] : steps[phaseAt(S.t, steps)];
  const html = `<b>${phase}</b>${guide}`;
  const current = box.querySelector('p:not(.out)');
  if (current?.innerHTML === html) return;
  // Crossfade between phases: the old line fades out while the new one fades in, stacked in one grid cell.
  box.querySelectorAll('p').forEach((old) => {
    if (old.classList.contains('out')) return old.remove();
    old.classList.remove('in'); old.classList.add('out');
    setTimeout(() => old.remove(), 240);
  });
  const next = document.createElement('p'); next.className = 'in'; next.innerHTML = html;
  box.append(next);
}
let lastGuide = -1;
const sizeLabel = (width, parked) => width + ' × ' + Math.round(parked ? width / parkedRatio : width * 9 / 16);
const currentFormat = () => parkedView() ? S.parkedFormat : S.format;
const currentFormats = () => parkedView() ? FORMATS.filter(([id]) => id === 'png' || id === 'camera') : FORMATS;
function renderExport() {
  const format = currentFormat();
  const label = FORMATS.find((f) => f[0] === format)[1];
  document.querySelector('.format-trigger[aria-controls=format-options] span').textContent = label;
  $('format').value = format;
  const parked = parkedView();
  const sizeTrigger = document.querySelector('.format-trigger[aria-controls=image-size-options]');
  for (const item of $('image-size-options').querySelectorAll('button[data-value]')) {
    item.textContent = sizeLabel(Number(item.dataset.value), parked);
  }
  sizeTrigger.querySelector('span').textContent = sizeLabel(Number(S.size), parked);
  $('overlay-export')?.remove();
}
document.querySelector('.format-trigger[aria-controls=format-options]').addEventListener('click', (e) => {
  const t = e.currentTarget; if (openMenu?.trigger === t) return closeMenu();
  const m = $('format-options');
  m.innerHTML = currentFormats().map(([v, label]) => { const locked = v === 'video' && !pro();
    return `<button type="button" role="option" aria-selected="${currentFormat() === v}" tabindex="-1" data-value="${v}"${locked ? ' aria-disabled="true" class="has-tag"' : ''}>${label}${locked ? '<span class="pro-tag">Pro</span>' : ''}</button>`; }).join('');
  m.onclick = (ev) => { const b = ev.target.closest('button[data-value]'); if (!b) return; closeMenu(true);
    if (b.dataset.value === 'video' && !pro()) return S.plan === 'guest' ? openSignIn('video') : openUpgrade('video');
    S[parkedView() ? 'parkedFormat' : 'format'] = b.dataset.value; renderExport(); };
  showMenu(t, m, { up: true, own: false, alignRight: true, width: Math.max(176, t.getBoundingClientRect().width) });
});
document.querySelector('.format-trigger[aria-controls=image-size-options]').addEventListener('click', (e) => {
  const t = e.currentTarget; if (openMenu?.trigger === t) return closeMenu();
  const m = $('image-size-options');
  m.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.value === S.size));
  m.onclick = (ev) => { const b = ev.target.closest('button[data-value]'); if (!b) return; S.size = b.dataset.value; t.querySelector('span').textContent = b.textContent; closeMenu(true); };
  showMenu(t, m, { up: true, own: false });
});
$('export').addEventListener('click', async () => {
  const button=$('export'), format=currentFormat(), width=Number(S.size), parked=parkedView();
  if(button.disabled) return;
  const intent=format==='video'?'video':'export';
  const requiresPro = format === 'video' || width === 3840;
  if(requiresPro&&!pro()) {
    return S.plan==='guest'?openSignIn(intent):openUpgrade(intent);
  }
  const base = parked ? 'parked' : active() ? eventLabel(S.event).toLowerCase().replaceAll(' ', '-') : S.scene;
  const name = { png: base + '.png', kit: base + '-perspective-kit.zip', camera: base + '-camera.json', depth: base + '-depth.png', video: base + '.mp4' }[format];
  button.disabled=true;
  button.setAttribute('aria-busy','true');
  try {
    if(hasBilling&&requiresPro) {
      const account=await billingRequest('session');
      if(!account.pro) { applyAccount(account); return account.email?openUpgrade(intent):openSignIn(intent); }
    }
    button.textContent='Exporting…';
    let blob;
    if (parked) {
      if (!parkedRig || parkedCanvas.hidden || parkedFrame?.model !== currentVehicle()) throw Error('The parked view is still loading. Try exporting again.');
      try {
        blob = await parkedRig.exportFrame({format,width,height:Math.round(width / parkedRatio)});
      } finally { paintParkedView(); }
    } else {
      const bridge=preview.bridge();
      if(!bridge)throw Error('The scene is still loading. Try exporting again.');
      ({blob}=await bridge.export({format,width,onProgress:percent => {button.textContent='Exporting '+percent+'%';}}));
    }
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    Object.assign(link,{href:url,download:name});
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),30_000);
    toast('Exported '+name);
  } catch(error) { toast(error.message); }
  finally { button.disabled=false;button.removeAttribute('aria-busy');button.textContent='Export'; }
});

/* ---------- Timeline ---------- */
function buildTimeline() {
  const tl = h(`<div id="event-timeline" role="group" aria-label="Interaction timeline" inert aria-hidden="true">
    <button type="button" class="tl-play" id="tl-play" aria-label="Pause" data-tip="Pause">${ICON.pause}</button>
    <div class="tl-body">
      <div class="tl-track">
        <div class="tl-progress" aria-hidden="true"></div>
        <div class="tl-notches" aria-hidden="true"></div>
        <input class="tl-range" id="tl-range" type="range" min="0" max="1000" step="1" value="0" aria-label="Timeline position">
        <span class="tl-thumb" aria-hidden="true"></span>
      </div>
    </div>
    <div class="tl-readout" aria-hidden="true"></div>
  </div>`);
  const playback = $('canvas-playback'), assist = $('scene-transport');
  playback.dataset.mode = 'assist';
  playback.prepend(h('<div class="playback-surface" aria-hidden="true"></div>'));
  // The wheel exists in both states, so it is one element that travels with the plate's edge;
  // the button and the timeline only hold a space for it.
  assist.innerHTML = '<span class="playback-wheel-space" aria-hidden="true"></span><span class="playback-label-measure" aria-hidden="true">Driving assist</span>';
  // One shot: the wheel travels with the plate's left edge, and the "Driving assist" words travel to the
  // right end of the bar, where they become the time. Only the words themselves crossfade.
  playback.append(tl, h('<div class="playback-leading"><span class="playback-wheel" id="playback-wheel" role="img" aria-label="Driving assist on"></span><span class="tl-divider" aria-hidden="true"></span></div>'),
    h('<span class="playback-text" aria-hidden="true"><span class="pt-label">Driving assist</span><span class="pt-time tl-time" id="tl-time">0.0 s</span></span>'));
  const footer = h('<div id="playback-footer"></div>');
  playback.before(footer);
  footer.append(playback, h('<div id="tl-guide" aria-live="polite" aria-hidden="true"></div>'));
  const wheel = $('playback-wheel');
  wheel.addEventListener('click', () => {
    if (wheel.getAttribute('role') === 'button') void toggleSceneAssist();
  });
  wheel.addEventListener('keydown', e => {
    if (wheel.getAttribute('role') !== 'button' || !['Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    wheel.click();
  });
  $('tl-play').addEventListener('click', async () => {
    if (parkedReplayPending) return;
    const replay = !S.playing && S.t >= total();
    const reroll = replay && isAdjacentCutIn();
    if (parkedView() || parkedPosition) {
      const {scene, event} = S;
      parkedReplayPending = true;
      const leftParked = await hideParked(true);
      parkedReplayPending = false;
      if (!leftParked || scene !== S.scene || event !== S.event) return;
    }
    if (replay) { S.t = 0; S.roadRun = null; }
    if (reroll) S.cutInSeed = newCutInSeed();
    S.playing = !S.playing;
    void preview.apply(bridge => {
      if (!active()) return;
      if (replay) bridge.clearRoadRun();
      if (reroll) bridge.setDrivingEvent(S.event, eventParams());
      if (S.playing && S.t === 0) bridge.seekRoadworks(0);
      bridge.setPlaying(S.playing, {newRun: replay && !reroll});
    });
    updateTimeline();
  });
  // Scrubbing holds the frame; if the event was playing, it carries on from the new point on release.
  $('tl-range').addEventListener('change', () => {
    const resume = resumeAfterScrub; resumeAfterScrub = null;
    if (!resume || !isTimeline() || S.t >= total()) return;
    void preview.apply(bridge => {
      if (!isTimeline()) return;
      bridge.setPlaying(true);
      const state = bridge.get({audit: false});
      S.playing = state.requestedPlaying;
      updateTimeline(state);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || !isTimeline() || dialog || openMenu || e.target.closest?.('button, input, select, textarea, [role=radio], [role=switch]')) return;
    e.preventDefault(); $('tl-play').click();
  });
  $('tl-range').addEventListener('input', (e) => {
    if (!isTimeline()) return;
    if (parkedPosition) void hideParked();
    resumeAfterScrub ??= S.playing;
    const progress = e.target.valueAsNumber;
    const time = progress === Number(e.target.max) ? total() : progress / 100;
    S.t = time;
    S.playing = false;
    void preview.apply(bridge => {
      if (!isTimeline()) return;
      bridge.seekRoadworks(time + (S.roadRun?.eventStart ?? 0));
      S.t = time;
      S.playing = false;
      updateTimeline(bridge.get({audit: false}));
    });
  });
  // Hover the track to read the phase at that point; the track itself stays one clean line.
  const range = $('tl-range'), track = tl.querySelector('.tl-track');
  range.addEventListener('pointermove', (e) => {
    if (!active()) return;
    const b = track.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), t = f * total(), steps = phases();
    const tip = $('tooltip'); tipAnchor = range; tip.textContent = steps[phaseAt(t, steps)][0] + '  ' + t.toFixed(1) + ' s'; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, b.left + f * b.width - r.width / 2)) + 'px';
    tip.style.top = (b.top - r.height - 14) + 'px';
  });
  range.addEventListener('pointerleave', hideTip);
}
const playbackWait = () => S.event === JUNCTION_LEFT_TURN ? [stopAt, S.junctionTiming?.turnAt ?? turnAt] :
  isParkingEvent(S.event) && S.parkingRun ? [S.parkingRun.yieldEnd ?? S.parkingRun.decisionAt, S.parkingRun.releaseAt] : EVENTS[S.event]?.wait;
function updateTimeline(state) {
  const tl = $('event-timeline'); if (!tl || !active()) return;
  if (S.event === 'roadworks') {
    const run = (state ?? preview.bridge()?.get({audit:false}))?.roadworks;
    if (run?.event === S.event) S.roadRun = run;
  }
  if (S.event === JUNCTION_LEFT_TURN) {
    const run = (state ?? preview.bridge()?.get({audit: false}))?.event;
    S.junctionTiming = run?.event === S.event ? run.timing : undefined;
  }
  if (isParkingEvent(S.event)) {
    const run = (state ?? preview.bridge()?.get({audit: false}))?.event;
    if (run?.event === S.event) S.parkingRun = run;
  }
  if (isAdjacentCutIn() && !isRampMerge()) {
    const road = (state ?? preview.bridge()?.get({audit: false}))?.roadworks;
    S.cutInTiming = road?.event === S.event && road.time >= road.eventStart + road.handoff ? road.cutInTiming : null;
  }
  if (isRampMerge() && S.event === 'cutin') {
    const merge = (state ?? preview.bridge()?.get({audit: false}))?.roadworks?.rampMerge;
    if (S.rampMerge !== merge) {
      S.rampMerge = merge;
      S.mergePhases = merge && mergePhases(merge);
      S.mergeTimelineKey = S.mergePhases?.map(([phase, duration]) => phase + duration).join(':') ?? '';
    }
  }
  if (S.event === 'lanechange') {
    const road = (state ?? preview.bridge()?.get({audit: false}))?.roadworks;
    const maneuver = road?.time >= (road?.eventStart ?? 0)+(road?.handoff ?? 0) ? road?.laneChange : null;
    if (S.laneChange !== maneuver) {
      S.laneChange = maneuver;
      S.laneChangePhases = maneuver && laneChangePhases(maneuver);
    }
  }
  const steps = phases();
  const eventKey = S.scene + ':' + S.event
    + (S.event === JUNCTION_LEFT_TURN ? ':' + S.junctionTiming?.turnAt : '')
    + (isParkingEvent(S.event) || S.event === 'roadworks' ? ':' + steps.map(([p, d]) => p + d).join(':') : '')
    + (isRampMerge() ? ':merge:' + (S.mergeTimelineKey ?? '') : '')
    + (isAdjacentCutIn() && !isRampMerge() ? ':' + steps.map(([label, duration]) => label + duration).join(':') : '')
    + ':' + (S.roadRun?.eventStart ?? 0)
    + (S.event === 'lanechange' ? ':' + S.laneChange?.steerAt + ':' + S.laneChange?.conflictAt + ':' + S.laneChange?.clearAt : '');
  if (tl.dataset.timelineEvent !== eventKey) {
    tl.dataset.timelineEvent = eventKey;
    lastGuide = -1;
    let at = 0;
    tl.querySelector('.tl-notches').innerHTML = steps.slice(0, -1).map(([, d]) => `<span style="left:${(at += d) / total() * 100}%"></span>`).join('');
    tl.setAttribute('aria-label', eventLabel(S.event) + ' timeline');
    renderWait(tl);
  }
  const wait = playbackWait();
  if (wait) tl.dataset.wait = S.t < wait[0] ? 'before' : S.t < wait[1] ? 'in' : 'after';
  else delete tl.dataset.wait;
  const i = phaseAt(S.t, steps);
  tl.style.setProperty('--timeline-progress', (S.t / total()) * 100 + '%');
  const phase = isParkingEvent(S.event) && S.t >= total() ? 'Parked' : steps[i][0];
  const range = $('tl-range'); range.max = Math.round(total() * 100); range.value = Math.round(S.t * 100); range.setAttribute('aria-valuetext', S.t.toFixed(1) + ' seconds, ' + phase);
  $('tl-time').textContent = S.t.toFixed(1) + ' s';
  const ended = !S.playing && S.t >= total(), play = $('tl-play'), label = S.playing ? 'Pause' : ended ? 'Replay' : 'Play';
  if (play.dataset.state !== label) { play.innerHTML = S.playing ? ICON.pause : ended ? ICON.replay : ICON.play; play.setAttribute('aria-label', label); play.dataset.tip = label; play.dataset.state = label; }
  const guideKey = ended ? 'end' : i;
  if (guideKey !== lastGuide) { lastGuide = guideKey; renderGuide(); }
}
// A stop-and-wait event marks the stretch where the vehicle stands still (dotted track)
// and the moment it is released (ring). The ring fills once the playhead passes it.
function renderWait(tl) {
  const track = tl.querySelector('.tl-track'), range = $('tl-range');
  track.querySelectorAll('.tl-wait, .tl-release').forEach((el) => el.remove());
  const wait = playbackWait();
  if (!wait) return;
  const [from, to] = wait.map((s) => Math.min(s, total()) / total() * 100);
  track.insertBefore(h(`<span class="tl-wait" aria-hidden="true" style="left:${from}%;width:${to - from}%"></span>`), range);
  if (Number.isFinite(wait[1])) track.insertBefore(h(`<span class="tl-release" aria-hidden="true" style="left:${to}%"></span>`), range);
}
function tick() {
  if ((S.playing || isParkingEvent(S.event)) && isTimeline()) {
    const state = preview.bridge()?.get({audit: false});
    // Ignore frames from the previous event while a switch is still settling.
    const playback = state?.event ?? state?.roadworks;
    if (playback?.event === S.event) {
      if (S.event === 'roadworks') S.roadRun = playback;
      S.playing = state.requestedPlaying;
      S.t = Math.max(0, playback.time - (S.roadRun?.eventStart ?? 0));
      if (!S.playing && playback.time >= playback.duration) S.t = total();
      updateTimeline(state);
    }
  }
  requestAnimationFrame(tick);
}

/* ---------- Dialogs ---------- */
let dialog = null, returnFocus = null;
function openDialog(el) {
  const opener = dialog?.contains(document.activeElement) ? returnFocus : document.activeElement;
  closeDialog(true); returnFocus = opener; dialog = el; document.body.append(el);
  (el.querySelector('[role=dialog]') || el).focus({ preventScroll: true });
  el.addEventListener('pointerdown', (e) => { if (e.target === el) closeDialog(); });
  // A double click must not reach the button that replaces the one under the pointer (Continue, Simulate payment).
  el.addEventListener('click', (e) => { if (e.detail > 1) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}
function closeDialog(silent) {
  if (!dialog) return;
  if (openMenu && dialog.contains(openMenu.trigger)) closeMenu();
  dialog.remove();
  dialog = null;
  if (!silent) { S.intent = null; returnFocus?.focus?.(); }
}
const CLOSE = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const SELECT_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const GOOGLE = '<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/></svg>';
function authShell(inner) {
  return h(`<div class="scrim"><div class="dlg auth" role="dialog" aria-modal="true" aria-labelledby="auth-title" tabindex="-1">
    <button type="button" class="dlg-close" data-close aria-label="Close">${CLOSE}</button>${inner}</div></div>`);
}
function openSignIn(intent) {
  S.intent = intent; closeMenu();
  const el = authShell(`<div class="auth-head"><h2 id="auth-title">${intent ? 'Sign in to continue' : 'Sign in to DriveScene Studio'}</h2>
      <p class="lead">${intent ? 'Interaction events need an account and Pro.' : 'Keep your settings and unlock Pro when you need it.'}</p></div>
    ${!hasBilling ? `<button type="button" class="d-btn lg block" id="si-google">${GOOGLE}Continue with Google</button><div class="divider">or</div>` : ''}
    <form novalidate>
      <label class="field"><span>Email</span><input class="lg" id="si-email" type="email" autocomplete="email" placeholder="you@studio.com" aria-describedby="si-err"><span class="err" id="si-err" role="alert" hidden></span></label>
      <button type="submit" class="d-btn primary lg block">Continue with email</button>
    </form>
    ${!hasBilling ? '<p class="fine">Preview sign-in uses a sample six-digit code.</p>' : ''}`);
  el.querySelector('#si-email').value=S.email;
  el.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const input=el.querySelector('#si-email'), email=input.value.trim();
    if(!/^\S+@\S+\.\S+$/.test(email)) {
      setFormError(el,'si-err','Enter a valid email address.');
      input.focus();
      return;
    }
    await submitBillingForm(el,'si-err',async()=>{
      if(hasBilling) await billingRequest('login',{email});
      if(dialog!==el) return;
      S.email=email;
      openCode();
    });
  });
  el.querySelector('#si-google')?.addEventListener('click', () => { S.email = S.email || 'peixin@gmail.com'; finishSignIn({email:S.email,pro:false}); });
  el.querySelector('[data-close]').addEventListener('click', () => closeDialog());
  openDialog(el);
}
function setFormError(el,id,message) {
  const row=el.querySelector('#'+id);
  row.textContent=message;
  row.hidden=!message;
}
async function submitBillingForm(el, errorId, operation) {
  const button=el.querySelector('button[type=submit]');
  if(button.disabled) return;
  button.disabled=true;
  setFormError(el,errorId,'');
  try { await operation(); }
  catch(error) { setFormError(el,errorId,error.message); }
  finally { button.disabled=false; }
}
function openCode() {
  const intent = S.intent;
  const el = authShell(`<div class="auth-head"><h2 id="auth-title">Check your email</h2>
      <p class="lead"></p></div>
    <form novalidate>
      <label class="field"><span>Code</span><input class="lg code-input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-describedby="code-err"><span class="err" id="code-err" role="alert" hidden></span></label>
      <button type="submit" class="d-btn primary lg block">Sign in</button>
    </form>
    <p class="fine"><a href="#" data-back>Use a different email</a></p>`);
  el.querySelector('.lead').textContent=hasBilling?'Enter the six-digit code sent to '+S.email+'.':'Enter any six digits for the prototype.';
  el.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const inp=el.querySelector('#code'),code=inp.value.trim();
    if(!/^\d{6}$/.test(code)) { setFormError(el,'code-err','Enter the six digits from the email.');return inp.focus(); }
    await submitBillingForm(el,'code-err',async()=>{
      const account=hasBilling?await billingRequest('verify',{email:S.email,code}):{email:S.email,pro:false};
      if(dialog===el) finishSignIn(account);
      else if(hasBilling) applyAccount(account);
    });
  });
  el.querySelector('[data-back]').addEventListener('click', (e) => { e.preventDefault(); openSignIn(intent); });
  el.querySelector('[data-close]').addEventListener('click', () => closeDialog());
  openDialog(el); S.intent = intent;
  el.querySelector('#code').focus();
}
function finishSignIn(account) {
  const intent = S.intent;
  closeDialog(true); S.intent=null; applyAccount(account);
  if (SCENE_EVENTS.some(([event]) => event === intent)) focusEvent(intent);
  if (intent && !pro()) openUpgrade(intent);
  else if (intent === 'video') { S.format='video';renderExport(); }
  else if (Object.hasOwn(EVENTS,intent)) startEvent(intent);
  else toast('Signed in as ' + S.email);
}
function billingPrice({ amount, currency, key }) {
  if (!currency) return [];
  const money = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'code',
    trailingZeroDisplay: 'stripIfInteger',
  });
  // "US$9" reads as a price at a glance; other currencies keep their ISO code ("EUR 9").
  const price = money.formatToParts(amount / 10 ** money.resolvedOptions().maximumFractionDigits)
    .map(({ type, value }) => type === 'currency' ? (value === 'USD' ? 'US$' : value + ' ') : type === 'literal' ? '' : value)
    .join('');
  const term = { monthly: '/ month', yearly: '/ year' }[key] ?? 'for 1 year';
  return [price, term];
}
const BILLING_RENEWAL = { monthly: 'Monthly plan, renews until you cancel.', yearly: 'Yearly plan, renews until you cancel.' };
const CHECKOUT_NOTE = { paddle: 'Secure checkout by Paddle' };

const BILLING_PRICE = '<div class="up-price"><p class="price"><strong></strong> <span></span></p><p class="renewal"></p></div>';
function showBillingPrice(group, offer) {
  const [amount, term] = billingPrice(offer);
  if (!amount) return;
  group.querySelector('strong').textContent = amount;
  group.querySelector('.price span').textContent = term;
  const renewal = group.querySelector('.renewal');
  renewal.textContent = BILLING_RENEWAL[offer.key] ?? '';
  renewal.hidden = !renewal.textContent;
  group.dataset.ready = '';
}

function openCheckoutPreview(intent, offer) {
  const el = h(`<div class="scrim"><div class="dlg upgrade checkout-demo" role="dialog" aria-modal="true" aria-labelledby="checkout-demo-title" aria-describedby="checkout-demo-note" tabindex="-1">
    <button type="button" class="dlg-close" data-close aria-label="Close">${CLOSE}</button>
    <div class="up-head"><h2 id="checkout-demo-title">Demo checkout</h2>
      <p class="lead" id="checkout-demo-note">No payment is taken. The live workbench opens Paddle at this step.</p></div>
    <div class="co-summary"><span>DriveScene Studio Pro</span>${BILLING_PRICE}</div>
    <div class="actions">
      <button type="button" class="d-btn lg" data-back>Back</button>
      <button type="button" class="d-btn primary lg" data-complete>Simulate payment</button>
    </div>
  </div></div>`);
  showBillingPrice(el.querySelector('.up-price'), offer);
  el.querySelector('[data-close]').onclick = () => closeDialog();
  el.querySelector('[data-back]').onclick = () => openUpgrade(intent);
  el.querySelector('[data-complete]').onclick = event => {
    if (event.currentTarget.disabled) return;
    event.currentTarget.disabled = true;
    setPreviewPlan('pro');
    showProActive(el, intent);
  };
  openDialog(el);
}

function showProActive(el, intent) {
  const box = el.querySelector('[role=dialog]');
  box.classList.add('pro-active');
  box.setAttribute('aria-labelledby', 'pro-active-title');
  box.setAttribute('aria-describedby', 'pro-active-note');
  box.replaceChildren(h(`<button type="button" class="dlg-close" data-close aria-label="Close">${CLOSE}</button>`),
    h(`<div class="up-head"><h2 id="pro-active-title">Pro is active</h2>
      <p class="lead" id="pro-active-note">Demo payment complete. No charge was made.</p></div>`),
    h(`<ul class="benefits">${PRO_BENEFITS.map(benefit => `<li>${CHECK}${benefit}</li>`).join('')}</ul>`),
    h('<button type="button" class="d-btn primary lg block" data-done>Done</button>'));
  box.querySelector('[data-close]').onclick = () => closeDialog();
  box.querySelector('[data-done]').onclick = () => { closeDialog(); continueProIntent(intent); };
  box.querySelector('[data-done]').focus({ preventScroll: true });
}

function continueProIntent(intent) {
  if (!pro()) return;
  if (intent === 'video') { S.format = 'video'; renderExport(); }
  else if (Object.hasOwn(EVENTS, intent)) { focusEvent(intent); startEvent(intent); }
}

function renderBillingPicker(field, label, choices, current, select) {
  field.replaceChildren();
  field.hidden = choices.length < 2;
  if (field.hidden) return;
  const id = field.id;
  const caption = h(`<span class="picker-label" id="${id}-label"></span>`);
  caption.textContent = label;
  const trigger = h(`<button type="button" class="format-trigger" aria-labelledby="${id}-label ${id}-value"
    aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-options">
    <span id="${id}-value"></span>${SELECT_CHEVRON}</button>`);
  const value = trigger.querySelector('span');
  const menu = h(`<div id="${id}-options" class="format-options" role="listbox" aria-labelledby="${id}-label" hidden></div>`);
  for (const [key, name] of choices) {
    const option = h('<button type="button" role="option" tabindex="-1"></button>');
    option.setAttribute('aria-selected', String(key === current));
    option.textContent = name;
    if (key === current) value.textContent = name;
    option.onclick = () => {
      menu.querySelector('[aria-selected=true]').setAttribute('aria-selected', 'false');
      option.setAttribute('aria-selected', 'true');
      value.textContent = name;
      closeMenu(true);
      select(key);
    };
    menu.append(option);
  }
  const show = () => showMenu(trigger, menu, { up: 'auto', own: false });
  trigger.onclick = () => openMenu?.trigger === trigger ? closeMenu(true) : show();
  trigger.onkeydown = event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    show();
  };
  menu.onkeydown = event => { if (event.key === 'Tab') closeMenu(true); };
  field.append(caption, trigger, menu);
}

const PRO_BENEFITS = ['Interaction timeline', '4K still export', '1080p MP4 export'];
async function openUpgrade(intent) {
  S.intent = intent; closeMenu();
  const title = intent === 'video' ? 'Export video with Pro' : intent==='export' ? 'Export in 4K with Pro'
    : intent && intent !== 'top' ? 'Unlock interactions with Pro' : 'Upgrade to Pro';
  const el = h(`<div class="scrim"><div class="dlg upgrade" role="dialog" aria-modal="true" aria-labelledby="up-title" tabindex="-1">
    <button type="button" class="dlg-close" data-close aria-label="Close">${CLOSE}</button>
    <div class="up-head"><h2 id="up-title">${title}</h2>${BILLING_PRICE}</div>
    <ul class="benefits">${PRO_BENEFITS.map(benefit => `<li>${CHECK}${benefit}</li>`).join('')}</ul>
    <form>
      <div class="field" id="billing-plan" hidden></div>
      <div class="field" id="billing-method" hidden></div>
      <p class="err" role="alert" id="billing-error" hidden></p>
      <div class="up-action">
        <button type="submit" class="d-btn primary lg block" id="checkout" disabled aria-describedby="checkout-note">Continue to checkout</button>
        <p class="checkout-note" id="checkout-note" hidden>${LOCK}<span></span></p>
      </div>
    </form>
  </div></div>`);
  el.querySelector('[data-close]').addEventListener('click', () => closeDialog());
  openDialog(el);
  const paymentNames = { card: 'Card', paddle: 'Card or PayPal', wechat_pay: 'WeChat Pay', alipay: 'Alipay', hosted: 'Hosted checkout' };
  const note = el.querySelector('#checkout-note');
  const showNote = method => {
    note.querySelector('span').textContent = CHECKOUT_NOTE[method] ?? 'Secure hosted checkout';
    note.hidden = false;
  };
  try {
    const offers = hasBilling ? await billingRequest('offers') : [
      { key: 'monthly', amount: 900, currency: 'usd', methods: ['paddle'] },
    ];
    if (dialog !== el) return;
    if (!offers.length) {
      setFormError(el, 'billing-error', 'Checkout is currently unavailable.');
      return;
    }
    let paymentMethod;
    const applyOffer = key => {
      S.billing = key;
      const { methods } = offers.find(offer => offer.key === key);
      paymentMethod = methods[0];
      showNote(paymentMethod);
      renderBillingPicker(el.querySelector('#billing-method'), 'Payment method',
        methods.map(method => [method, paymentNames[method]]), paymentMethod, method => { paymentMethod = method; showNote(method); });
    };
    const current = offers.find(offer => offer.key === S.billing) ?? offers[0];
    applyOffer(current.key);
    if (offers.length === 1) {
      showBillingPrice(el.querySelector('.up-price'), current);
    } else {
      el.querySelector('.up-price').hidden = true;
      const walletLabel = offers.some(offer => offer.key === 'annual-pass') ? ' (wallets)' : '';
      renderBillingPicker(el.querySelector('#billing-plan'), 'Plan',
        offers.map(offer => [offer.key, billingPrice(offer).join(' ') + (offer.key === 'wallet-year' ? walletLabel : '')]),
        current.key, applyOffer);
    }
    const button = el.querySelector('#checkout');
    button.disabled = false;
    el.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      if (button.disabled) return;
      if (!hasBilling) return openCheckoutPreview(intent, current);
      setCheckoutBusy(button, true);
      setFormError(el, 'billing-error', '');
      try {
        const payment = await billingRequest('checkout', { offer: S.billing, method: paymentMethod });
        if (payment.pending) throw Error('Payment is being confirmed. Check your account shortly.');
        // Stay busy while the browser leaves for the hosted checkout, so a second click cannot open another.
        if (dialog === el) return location.assign(payment.url);
      } catch (error) { setFormError(el, 'billing-error', error.message); }
      setCheckoutBusy(button, false);
    };
  } catch (error) { setFormError(el, 'billing-error', error.message); }
}
function setCheckoutBusy(button, busy) {
  if (busy) { button.style.minWidth = button.offsetWidth + 'px'; button.dataset.label = button.textContent; button.textContent = 'Loading…'; }
  else if (button.dataset.label) { button.textContent = button.dataset.label; delete button.dataset.label; }
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}
// Returning from the hosted checkout with the browser's Back button restores this page from cache.
addEventListener('pageshow', event => {
  const button = event.persisted && dialog?.querySelector('#checkout[aria-busy=true]');
  if (button) setCheckoutBusy(button, false);
});

/* ---------- Scene nav, assist, theme ---------- */
function selectScene(scene, animate = false) {
  if (scene !== S.scene && (isParkingScene(scene) || isParkingScene(S.scene))) {
    exitInProgress = false;
    autoParkedShown = false;
    resumeAfterScrub = null;
    S.assist = false;
    canViewParked = false;
    restoreParkedEntry = false;
    if (parkedView() || parkedPosition) void hideParked();
  }
  S.scene = scene;
  const rows = [...document.querySelectorAll('#scene-nav .scene-row')];
  const row = rows.find((r) => r.dataset.scene === scene);
  rows.forEach((r) => r === row ? r.setAttribute('aria-current', 'page') : r.removeAttribute('aria-current'));
  placeSceneIndicator(animate);
  const label = row.getAttribute('aria-label') || row.textContent.trim();
  $('scene-group').textContent = 'Scene';
  $('mobile-scene').textContent = label;
  $('mobile-scene').setAttribute('aria-label', `Scene: ${label}`);
  const lanes = document.querySelector('.segment[data-param=lanes]');
  lanes.closest('.property').hidden = scene !== 'road';
}
// Each scene keeps its own camera; the event scene also keeps its event, frame and play state.
const sceneMemory = {};
function changeScene(scene, animate) {
  if (scene === S.scene) return;
  resumeAfterScrub = null;
  closeMenu();
  sceneMemory[S.scene] = {camera: S.camera, eventCamera: S.eventCamera, ...(active() && {event: S.event, t: Math.max(0, S.t - (S.roadRun?.handoff ?? 0)), playing: S.playing, cutInSeed: S.cutInSeed})};
  selectScene(scene, animate);
  const url = new URL(location.href);
  url.searchParams.set('scene', scene);
  url.searchParams.delete('type');
  history.replaceState(history.state, '', url);
  Object.assign(S, {event: 'none', playing: false, t: 0, liveRoad: false, roadRun: null});
  const saved = sceneMemory[scene];
  if (saved?.event && pro()) Object.assign(S, {event: saved.event, t: saved.t, playing: saved.playing, cutInSeed: saved.cutInSeed});
  S.camera = saved?.camera ?? S.camera;
  setParkedUrl();
  S.eventCamera = saved?.eventCamera ?? (!isParkingScene(scene) && S.camera === 'high' ? 'high' : 'auto');
  renderAll();
  // The inspector's content changes with the scene; let it settle in rather than snap.
  const sc = $('inspector-scroll'); sc.classList.remove('scene-in'); void sc.offsetWidth; sc.classList.add('scene-in');
}
$('scene-nav').addEventListener('click', (e) => {
  const row = e.target.closest('.scene-row');
  if (row) changeScene(row.dataset.scene, e.detail > 0);
});
$('mobile-scene').addEventListener('click', (e) => {
  const trigger = e.currentTarget;
  if (openMenu?.trigger === trigger) return closeMenu(true);
  const menu = h('<div class="shell-scene-menu" id="mobile-scene-menu" role="menu" aria-label="Scenes"></div>');
  let group;
  for (const row of $('scene-nav').querySelectorAll('.nav-title, .scene-row')) {
    if (row.classList.contains('nav-title')) {
      group = h('<div role="group"><div class="shell-menu-heading" aria-hidden="true"></div></div>');
      group.firstElementChild.textContent = row.textContent;
      group.setAttribute('aria-label', row.textContent.trim());
      menu.append(group);
      continue;
    }
    const option = h(`<button type="button" role="menuitemradio" tabindex="-1" aria-checked="${row.dataset.scene === S.scene}"></button>`);
    option.textContent = row.getAttribute('aria-label') || row.textContent.trim();
    option.addEventListener('click', () => { closeMenu(true); changeScene(row.dataset.scene); });
    group.append(option);
  }
  menu.addEventListener('keydown', (ev) => { if (ev.key === 'Tab') closeMenu(true); });
  showMenu(trigger, menu);
});
function setSceneAssist(value) {
  S.assist = value;
  const button = $('scene-transport');
  button.setAttribute('aria-checked', String(value));
  button.dataset.tip = (value ? 'Turn off' : 'Turn on') + ' driving assist';
  if (isParkingScene(S.scene)) refreshParkedAvailability(preview.bridge()?.get({audit: false}));
}

let transportPending = false;
async function toggleSceneAssist() {
  if (transportPending || parkedCameraPending) return;
  const scene = S.scene, assist = !S.assist;
  const parkingScene = isParkingScene(scene);
  const depart = assist && parkingScene && !!preview.bridge()?.get({audit:false})?.parking?.complete;
  if (isTimeline() && !depart) return;
  transportPending = true;
  setSceneAssist(assist);
  if (parkingScene) renderInteraction(false, false);
  try {
    if (depart) {
      S.camera = 'low';
      if (active()) S.eventCamera = 'low';
    }
    if ((parkedView() || parkedPosition) && !await hideParked(true, depart ? 'low' : undefined)) return;
    if (scene !== S.scene) return;
    await preview.apply(async bridge => {
      try {
        if (assist && parkingScene) {
          if (!depart) void prepareParkedVehicle().catch(() => {});
          await bridge.parkingPlay({depart});
        }
        else await setAssistDemo(bridge, assist);
        if (scene !== S.scene) return;
        const current = bridge.get({audit:false});
        if (depart && current.parking?.mode === 'out') {
          exitInProgress = true;
          if (active()) {
            Object.assign(S, {event: 'none', playing: false, t: 0, parkingRun: null});
            renderAll();
          } else renderCamera();
        }
        if (assist && parkingScene && !current.requestedPlaying) setSceneAssist(false);
      } catch (error) {
        if (scene === S.scene) setSceneAssist(!assist);
        throw error;
      }
    });
  } finally {
    transportPending = false;
    if (isParkingScene(S.scene)) renderInteraction(false, false);
  }
}
$('scene-transport').addEventListener('click', toggleSceneAssist);
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== document.querySelector('.pro-scene-preview')?.contentWindow ||
      event.data?.type !== 'ui-draft-status' || !isParkingScene(S.scene) || event.data.value?.scene !== S.scene) return;
  const bridge = preview.bridge();
  const current = bridge?.get({audit: false});
  if (!current?.parking) return;
  const {parking, requestedPlaying, event: run} = current;
  if (!parking.complete) autoParkedShown = false;
  const exiting = parking.mode === 'out';
  if (exitInProgress !== exiting) {
    exitInProgress = exiting;
    renderInteraction(false, false);
  }
  if (!transportPending && !requestedPlaying) {
    if (S.assist && parking.exited) setSceneAssist(false);
    const matchingEvent = active() && run?.event === S.event && run.time >= run.duration;
    if ((matchingEvent || !active() && !run && S.assist) && parking.completedInPlayback && parking.replayReady && !autoParkedShown && !parkedView()) {
      const pose = bridge.parkingComposition();
      if (pose) {
        if (matchingEvent) {
          S.playing = false;
          S.t = run.duration;
          updateTimeline(current);
        }
        setSceneAssist(false);
        showParked(pose);
      }
    }
  }
  refreshParkedAvailability(current);
});
const themeButton = $('theme');
const renderThemeLabel = () => themeButton.setAttribute('aria-label', `Switch to ${themeName() === 'dark' ? 'light' : 'dark'} theme`);
renderThemeLabel();
let requestedTheme = themeName(), themeTransition, themeRequest = 0;
themeButton.addEventListener('click', async () => {
  const root = document.documentElement;
  const target = requestedTheme === 'dark' ? 'light' : 'dark';
  const request = ++themeRequest;
  const animate = Boolean(document.startViewTransition) && !reducedMotion();
  requestedTheme = target;
  try { localStorage.setItem('sr-ui-draft-theme', target); } catch {}
  const applyShell = () => {
    if (request !== themeRequest) return;
    root.dataset.theme = target;
    renderThemeLabel();
  };
  const refreshParked = () => {
    if (request !== themeRequest) return;
    if (parkedView()) setParkedUrl();
    paintParkedView();
  };
  themeTransition?.skipTransition();
  const sceneTheme = preview.apply(bridge => {
    if (request === themeRequest) return bridge.theme(target, {animate});
  }, {acrossScenes: true});
  if (!animate) {
    applyShell();
    refreshParked();
    return;
  }
  // Let the live scene start its blend before capturing the shell, as in the
  // published workbench. Async scene work stays outside the snapshot callback.
  await sceneTheme;
  if (request !== themeRequest) return;
  const b = themeButton.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
  root.style.setProperty('--theme-reveal-x', x + 'px'); root.style.setProperty('--theme-reveal-y', y + 'px');
  root.style.setProperty('--theme-reveal-radius', Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 180 + 'px');
  root.classList.add('theme-changing', 'theme-live-scene');
  const transition = document.startViewTransition(applyShell);
  themeTransition = transition;
  void transition.updateCallbackDone.then(() => {
    if (themeTransition === transition) refreshParked();
  });
  void transition.finished.catch(() => {}).then(() => {
    if (themeTransition !== transition) return;
    themeTransition = null;
    root.classList.remove('theme-changing', 'theme-live-scene');
  });
});

/* ---------- Prototype switch (outside the product UI) ---------- */
function setPreviewPlan(plan) {
  if (plan !== 'pro') for (const key in sceneMemory) delete sceneMemory[key];
  if (plan === 'guest') Object.assign(S, { plan: 'guest', email: '', event: 'none', playing: false, t: 0, liveRoad: false, roadRun: null, camera: 'low', eventCamera: 'auto', format: 'png' });
  if (plan === 'free') Object.assign(S, { plan: 'free', email: S.email || 'peixin@studio.com', event: 'none', playing: false, t: 0, liveRoad: false, roadRun: null, camera: 'low', eventCamera: 'auto', format: 'png' });
  if (plan === 'pro' && pro()) return;
  if (plan === 'pro') Object.assign(S, { plan: 'pro', email: S.email || 'peixin@studio.com' });
  const url = new URL(location.href);
  if (plan === 'guest') url.searchParams.delete('plan');
  else url.searchParams.set('plan', plan);
  history.replaceState(history.state, '', url);
  renderAll();
}

function renderSwitch() {
  let bar = $('proto-bar');
  if (!bar) {
    bar = h(`<div class="proto-bar" id="proto-bar" role="region" aria-label="Prototype controls"><b>Prototype controls</b><span>Not part of the product. View the workbench as</span><div class="pb-seg" role="radiogroup" aria-label="View as"></div></div>`);
    document.body.prepend(bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      closeDialog(true); closeMenu();
      setPreviewPlan(b.dataset.value);
    });
  }
  bar.querySelector('.pb-seg').innerHTML = [['guest', 'Signed out'], ['free', 'Free'], ['pro', 'Pro with timeline']].map(([v, t]) =>
    `<button type="button" role="radio" aria-checked="${S.plan === v}" data-value="${v}">${t}</button>`).join('');
}

/* Scene indicator follows the current row, sized like the live workbench */
function placeSceneIndicator(animate) {
  const nav = $('scene-nav'), row = nav.querySelector('.scene-row[aria-current=page]');
  if (!row?.offsetWidth) return;
  glideIndicator(nav, row.offsetTop, !animate, row.offsetHeight, row.offsetLeft, row.offsetWidth);
}

/* ---------- Layout ---------- */
function layout() {
  const stage = $('stage'), art = $('artboard'); if (!stage || !art) return;
  const r = stage.getBoundingClientRect(), footer = $('playback-footer'), playback = $('canvas-playback');
  const below = footer.offsetHeight, padX = r.width < 480 ? 12 : 40, padY = r.height < 360 ? 12 : 40;
  const ratio = 16 / 9;
  const w = Math.max(1, Math.floor(Math.min(r.width - padX * 2, (r.height - padY * 2 - below) * ratio)));
  const hgt = Math.round(w / ratio);
  // Measure the collapsed button only while it is collapsed; expanded, it shrinks to the wheel.
  playback.style.setProperty('--playback-compact', $('scene-transport').offsetWidth + 'px');
  playback.style.setProperty('--playback-label-w', playback.querySelector('.playback-label-measure').offsetWidth + 'px');
  Object.assign(art.style, { width: w + 'px', height: hgt + 'px', left: Math.round((r.width - w) / 2) + 'px', top: Math.round((r.height - hgt - below) / 2) + 'px' });
  updateTimeline(); placeSceneIndicator(false);
}

let wheelDeformation;
function renderPlayback(animate) {
  const playingEvent = isTimeline(), playback = $('canvas-playback'), assist = $('scene-transport'), timeline = $('event-timeline'), guide = $('tl-guide');
  playback.dataset.motion = animate ? 'live' : 'instant';
  const mode = playingEvent ? 'timeline' : 'assist';
  const modeChanged = playback.dataset.mode !== mode;
  playback.dataset.mode = mode;
  // The footer always reserves the guide line, so canvas and footer stay centred as one block
  // and the canvas never moves when the scene changes.
  $('playback-footer').dataset.reserveGuide = 'true';
  // Read-only while an event plays, but still hoverable so its tooltip explains the state.
  assist.disabled = false;
  assist.setAttribute('aria-disabled', String(playingEvent));
  assist.setAttribute('aria-hidden', String(playingEvent));
  const wheel = $('playback-wheel');
  const canExitFromTimeline = playingEvent && isParkingEvent(S.event) && canViewParked;
  wheel.setAttribute('aria-hidden', String(!playingEvent));
  wheel.setAttribute('role', canExitFromTimeline ? 'button' : 'img');
  wheel.setAttribute('aria-label', canExitFromTimeline ? 'Driving assist' : 'Driving assist on');
  wheel.tabIndex = canExitFromTimeline ? 0 : -1;
  if (playingEvent) wheel.dataset.tip = canExitFromTimeline ? 'Exit parking space' : 'Driving assist stays on during the event'; else delete wheel.dataset.tip;
  assist.tabIndex = playingEvent ? -1 : 0;
  assist.setAttribute('role', playingEvent ? 'img' : 'switch');
  assist.setAttribute('aria-label', playingEvent ? 'Driving assist on' : 'Driving assist');
  if (playingEvent) assist.removeAttribute('aria-checked');
  else assist.setAttribute('aria-checked', S.assist);
  assist.dataset.tip = playingEvent ? 'Driving assist stays on during the event' : (S.assist ? 'Turn off' : 'Turn on') + ' driving assist';
  timeline.inert = !playingEvent;
  timeline.setAttribute('aria-hidden', !playingEvent);
  guide.setAttribute('aria-hidden', !playingEvent);
  if (!animate) wheelDeformation?.cancel();
  if (animate && modeChanged && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const travel = playback.getAnimations({subtree: true}).find(animation =>
      animation.transitionProperty === 'transform' && animation.effect.target === wheel.parentElement);
    const style = getComputedStyle(wheel);
    const from = style.scale;
    const easing = style.getPropertyValue('--ds-motion-ease');
    wheelDeformation?.cancel();
    if (travel) {
      const {duration, delay} = travel.effect.getTiming();
      wheelDeformation = wheel.animate([
        {scale: from, easing},
        {scale: '1.06 .97', offset: .32, easing},
        {scale: '1'}
      ], {duration, delay, fill: 'backwards'});
    }
  }
}

let playbackReady = false;
function renderAll({animatePlayback = true, animateControls = false} = {}) {
  renderAccount(); renderInteraction(playbackReady && animatePlayback, animateControls); renderCamera(); renderRampType(); renderLayers(animateControls); renderGuide(); lastGuide = -1; renderExport();
  renderPlayback(playbackReady && animatePlayback);
  layout(); updateTimeline(); layoutAllSegments(); if(!hasBilling)renderSwitch();
  syncScene();
  playbackReady = true;
}

const inspectorScroll = $('inspector-scroll');
const updateInspectorOverflow = () => {
  const {scrollTop, clientHeight, scrollHeight} = inspectorScroll;
  inspectorScroll.classList.toggle('has-more', scrollTop + clientHeight < scrollHeight - 2);
};
inspectorScroll.addEventListener('scroll', updateInspectorOverflow, {passive: true});
const inspectorResize = new ResizeObserver(updateInspectorOverflow);
inspectorResize.observe(inspectorScroll);
for (const group of inspectorScroll.children) inspectorResize.observe(group);

buildTimeline(); layout();
const entry = new URL(location.href);
const initialEvent = entry.searchParams.get('interaction');
const initialPlan = Object.hasOwn(EVENTS, initialEvent) ? 'pro' : entry.searchParams.get('plan');
if (!hasBilling && (initialPlan === 'pro' || initialPlan === 'free')) S.plan = initialPlan;
const initialScene = entry.searchParams.get('scene');
const oldScene = initialEvent === 'roadworks' ? 'elevated' : initialEvent === JUNCTION_LEFT_TURN ? 'junction'
  : isParkingEvent(initialEvent) ? 'parking' : 'road';
const scene = ['road', 'elevated', 'ramp', 'junction', 'parking', 'outdoor'].includes(initialScene) ? initialScene : oldScene;
if (scene === 'ramp' && entry.searchParams.get('type') === 'merge') S.rampLayout = '07';
selectScene(scene);
restoreParkedEntry = isParkingScene(scene) && !initialEvent && entry.searchParams.get('view') === 'parked';
if (restoreParkedEntry) {
  S.parkedCamera = true;
  parkedClip.dataset.parkedEntry = '';
  const savedModel = history.state?.parkedPreview?.model;
  const option = vehicleOptions.find(item => item.dataset.vehicle === savedModel);
  if (option) selectVehicleOption(option);
  $('theme').setAttribute('aria-label', 'Switch to ' + (themeName() === 'dark' ? 'light' : 'dark') + ' theme');
  void prepareParkedVehicle().catch(() => {});
}
if (!hasBilling && Object.hasOwn(EVENTS, initialEvent)) {
  entry.searchParams.delete('interaction');
  entry.searchParams.set('plan', 'pro');
  entry.searchParams.set('scene', scene);
  history.replaceState(history.state, '', entry);
}
renderAll();
delete document.documentElement.dataset.parkedEntry;
if(hasBilling) void (async()=>{
  try {
    const status=entry.searchParams.get('checkout'),sessionId=entry.searchParams.get('session_id');
    let account=await billingRequest('session');
    if(status==='success'&&sessionId&&account.email) account=await billingRequest('confirm',{sessionId});
    applyAccount(account);
    if(status==='success'||status==='lemon') toast(account.pro?'Pro access is active.':'Payment is being confirmed.');
    if(status) {
      entry.searchParams.delete('checkout');entry.searchParams.delete('session_id');
      history.replaceState(history.state,'',entry);
    }
  } catch(error) { toast(error.message); }
})();
requestAnimationFrame(tick);
document.fonts?.ready?.then(() => { layout(); layoutAllSegments(); });
})();
