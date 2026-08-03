// The gear train is pure math, so its rules are testable without rendering:
// the halfway-overlap rule (pitch circles touch), the shared circular pitch,
// ratio-locked periods, and — independently of the phase-solving formula —
// that teeth of meshed rings pass their contact point strictly alternately.

import { describe, expect, it } from "vitest";

import { MESHES, TRAIN } from "./onboarding-layout";

const DEG = Math.PI / 180;

type Vec = { readonly x: number; readonly y: number };

const pitchRadius = (ring: { outer: number; hole: number }): number =>
  (ring.outer + ring.hole) / 2;

const distance = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

const bearingDeg = (from: Vec, to: Vec): number =>
  Math.atan2(to.y - from.y, to.x - from.x) / DEG;

const gears = { s: TRAIN.s, m: TRAIN.m, l: TRAIN.l } as const;

function meshSides(): Array<{
  name: string;
  a: { gear: (typeof gears)[keyof typeof gears]; ring: (typeof TRAIN.s.rings)[number] };
  b: { gear: (typeof gears)[keyof typeof gears]; ring: (typeof TRAIN.s.rings)[number] };
}> {
  return MESHES.map(({ a, b }) => {
    const gearA = gears[a[0]];
    const gearB = gears[b[0]];
    const ringA = gearA.rings[a[1]];
    const ringB = gearB.rings[b[1]];
    if (ringA === undefined || ringB === undefined) {
      throw new Error("mesh points at a missing ring");
    }
    return {
      name: `${a[0]}[${String(a[1])}] ↔ ${b[0]}[${String(b[1])}]`,
      a: { gear: gearA, ring: ringA },
      b: { gear: gearB, ring: ringB },
    };
  });
}

describe("gear train geometry", () => {
  it("keeps one circular pitch across every ring", () => {
    const rings = [...TRAIN.s.rings, ...TRAIN.m.rings, ...TRAIN.l.rings];
    const pitches = rings.map((ring) => pitchRadius(ring) / ring.teeth);
    for (const pitch of pitches) {
      expect(pitch).toBeCloseTo(pitches[0] ?? Number.NaN, 9);
    }
  });

  it("meshes exactly halfway: center distance is the sum of pitch radii", () => {
    for (const mesh of meshSides()) {
      const expected = pitchRadius(mesh.a.ring) + pitchRadius(mesh.b.ring);
      expect(distance(mesh.a.gear.center, mesh.b.gear.center)).toBeCloseTo(expected, 6);
    }
  });

  it("locks periods so meshed rings share one pitch-line speed", () => {
    for (const mesh of meshSides()) {
      const speedA = (360 / mesh.a.gear.periodS) * pitchRadius(mesh.a.ring);
      const speedB = (360 / mesh.b.gear.periodS) * pitchRadius(mesh.b.ring);
      expect(speedA).toBeCloseTo(speedB, 6);
    }
  });

  it("counter-rotates every meshed pair", () => {
    for (const mesh of meshSides()) {
      expect(mesh.a.gear.spin * mesh.b.gear.spin).toBe(-1);
    }
  });
});

describe("gear train meshing", () => {
  // A ring's tooth k points at angle phase + spin·(360/period)·t + k·spacing.
  // It crosses the contact bearing θ when that expression ≡ θ (mod spacing).
  // Collect those times for both rings and the trains must interleave strictly,
  // each arrival landing halfway between the other ring's arrivals.
  function passTimes(
    gear: { periodS: number; spin: 1 | -1; center: Vec },
    ring: { phase: number; teeth: number },
    contactBearing: number,
    windowS: number,
  ): number[] {
    const spacing = 360 / ring.teeth;
    const omega = (360 / gear.periodS) * gear.spin;
    const period = spacing / Math.abs(omega);
    const first = (((contactBearing - ring.phase) / omega) % period + period) % period;
    const times: number[] = [];
    for (let t = first; t < windowS; t += period) {
      times.push(t);
    }
    return times;
  }

  it("teeth arrive at the contact point strictly alternately, half a beat apart", () => {
    for (const mesh of meshSides()) {
      const windowS = 12;
      const bearingA = bearingDeg(mesh.a.gear.center, mesh.b.gear.center);
      const bearingB = bearingDeg(mesh.b.gear.center, mesh.a.gear.center);
      const timesA = passTimes(mesh.a.gear, mesh.a.ring, bearingA, windowS);
      const timesB = passTimes(mesh.b.gear, mesh.b.ring, bearingB, windowS);
      expect(timesA.length).toBeGreaterThan(2);
      expect(timesB.length).toBeGreaterThan(2);

      const beat =
        (360 / mesh.a.ring.teeth / (360 / mesh.a.gear.periodS));
      const merged = [
        ...timesA.map((t) => ({ t, source: "a" })),
        ...timesB.map((t) => ({ t, source: "b" })),
      ].sort((x, y) => x.t - y.t);

      for (let i = 1; i < merged.length; i += 1) {
        const previous = merged[i - 1];
        const current = merged[i];
        if (previous === undefined || current === undefined) {
          continue;
        }
        expect(current.source, mesh.name).not.toBe(previous.source);
        expect(current.t - previous.t).toBeCloseTo(beat / 2, 6);
      }
    }
  });
});
