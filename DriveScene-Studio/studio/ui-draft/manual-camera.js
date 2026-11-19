// ds-allow: Author requested a 500 ms manual camera transition in every scene.
export const MANUAL_CAMERA_MS = 500;

// One phase keeps orbit, rotation and screen composition together, with no
// residual settling leg after the selected view has arrived.
export function manualCameraBlend(elapsed) {
 const t=Math.max(0,Math.min(1,elapsed/MANUAL_CAMERA_MS));
 return Math.max(0,Math.min(1,t*t*t*(t*(t*6-15)+10)));
}

export function parkingCameraChoice(value) {
 return ({low:'default',high:'raised','10':'default','16':'raised','14':'bev'})[value]||value;
}
