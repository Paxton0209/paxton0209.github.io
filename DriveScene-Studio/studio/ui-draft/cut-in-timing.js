import {DRIVING_EVENT_SECONDS} from './interaction-duration.js';

// Sample markers for a three-second lane change.
export const CUT_IN_TIMING = {
 merge: 2.55,
 nearLine: 3.35, // The car's leading corner is just short of the divider.
 halfIn: 4.05,   // The car's center crosses the divider.
 inLane: 5.55,
 resume: 6.9,
};

export const isAdjacentCutInScene = scene => scene === 'road' || scene === 'ramp';

export function cutInPhases(timing) {
 const cruise = 'The vehicle continues in its lane.';
 if (timing?.phases) {
  if (!Number.isFinite(timing.merge)) return [['No opening', DRIVING_EVENT_SECONDS, 'Traffic leaves no safe opening for a car to merge.']];
  const labels = {
   cruise: ['Cruise', cruise],
   approach: ['Approach', 'A car signals and moves toward this lane.'],
   'cut-in': ['Cut-in', 'A car moves in close ahead. The vehicle leaves more room.'],
   follow: ['Follow', 'The vehicle adjusts speed to leave room behind the car ahead.'],
   risk: ['Collision risk', 'The vehicles are close to overlapping. The vehicle leaves more room.'],
  };
  return timing.phases.map(({phase, at}, index) => {
   const [label, guide] = labels[phase];
   return [label, (timing.phases[index + 1]?.at ?? DRIVING_EVENT_SECONDS) - at, guide];
  });
 }
 return [['Cruise', DRIVING_EVENT_SECONDS, cruise]];
}
