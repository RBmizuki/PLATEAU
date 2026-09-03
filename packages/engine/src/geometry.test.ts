import { describe, expect, it } from 'vitest';
import {
  closeRing,
  localProjector,
  pointInRing,
  ringArea,
  ringCentroid,
  ringPerimeter,
  ringRingDistance,
  segmentSegmentDistance,
} from './geometry.js';

const square = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];

describe('geometry', () => {
  it('computes area, perimeter, centroid of a square', () => {
    const r = square(0, 0, 10);
    expect(ringArea(r)).toBeCloseTo(100);
    expect(ringPerimeter(r)).toBeCloseTo(40);
    expect(ringCentroid(r)).toEqual([5, 5]);
  });

  it('closes an open ring', () => {
    const open = square(0, 0, 4).slice(0, 4);
    expect(closeRing(open)).toHaveLength(5);
    expect(ringArea(open)).toBeCloseTo(16);
  });

  it('measures the gap between two squares', () => {
    expect(ringRingDistance(square(0, 0, 10), square(11.2, 0, 10))).toBeCloseTo(1.2);
    expect(ringRingDistance(square(0, 0, 10), square(13, 13, 10))).toBeCloseTo(Math.hypot(3, 3));
    expect(ringRingDistance(square(0, 0, 10), square(5, 5, 10))).toBe(0);
    expect(ringRingDistance(square(0, 0, 10), square(2, 2, 3))).toBe(0);
  });

  it('segment distance handles parallel and crossing segments', () => {
    expect(segmentSegmentDistance([0, 0], [10, 0], [0, 3], [10, 3])).toBeCloseTo(3);
    expect(segmentSegmentDistance([0, 0], [10, 10], [0, 10], [10, 0])).toBe(0);
  });

  it('point in ring', () => {
    expect(pointInRing([5, 5], square(0, 0, 10))).toBe(true);
    expect(pointInRing([15, 5], square(0, 0, 10))).toBe(false);
  });

  it('local projector round-trips and yields metres', () => {
    const origin: [number, number] = [140.05, 35.65];
    const { toXY, toLngLat } = localProjector(origin);
    const p = toXY([140.051, 35.651]);
    expect(p[0]).toBeGreaterThan(80);
    expect(p[0]).toBeLessThan(100);
    expect(p[1]).toBeCloseTo(111.19, 0);
    const back = toLngLat(p);
    expect(back[0]).toBeCloseTo(140.051, 9);
    expect(back[1]).toBeCloseTo(35.651, 9);
  });
});
