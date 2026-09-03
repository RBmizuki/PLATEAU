import { describe, expect, it } from 'vitest';
import { planRoute } from './route.js';
import { localProjector } from './geometry.js';

const { toLngLat } = localProjector([140.05, 35.65]);

describe('planRoute', () => {
  it('orders houses along a street and keeps the start fixed', () => {
    const pts = [0, 40, 10, 30, 20].map((x, i) => ({ id: `h${i}`, position: toLngLat([x, 0]) }));
    const plan = planRoute(pts, 'h0');
    expect(plan.order[0]).toBe('h0');
    expect(plan.order).toEqual(['h0', 'h2', 'h4', 'h3', 'h1']);
    expect(plan.lengthMeters).toBe(40);
  });

  it('handles empty and single inputs', () => {
    expect(planRoute([])).toEqual({ order: [], lengthMeters: 0 });
    expect(planRoute([{ id: 'a', position: [140, 35] }]).order).toEqual(['a']);
  });

  it('improves on a bad nearest-neighbour tour with 2-opt', () => {
    // 2 列に並んだ家: 最近傍法は列を行き来しがちだが、2-opt で片道ずつ回る
    const pts = [];
    for (let i = 0; i < 6; i++) pts.push({ id: `s${i}`, position: toLngLat([i * 10, 0]) });
    for (let i = 0; i < 6; i++) pts.push({ id: `n${i}`, position: toLngLat([i * 10, 12]) });
    const plan = planRoute(pts, 's0');
    expect(plan.lengthMeters).toBeLessThanOrEqual(50 + 12 + 50 + 1);
  });
});
