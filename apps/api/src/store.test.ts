import { describe, expect, it } from 'vitest';
import { BundleStore, isoWeek, upcomingWeeks } from './store.js';

describe('BundleStore', () => {
  it('opens one bundle per cluster-week, joins idempotently, and flips status at threshold', () => {
    const s = new BundleStore(undefined, () => new Date('2026-09-03T00:00:00Z'));
    const b = s.openBundle('yc-2013-001', '2026-W47', 3);
    expect(s.openBundle('yc-2013-001', '2026-W47', 3).id).toBe(b.id);
    s.join(b.id, { buildingId: 'a', installYear: 2013, capacityKw: 4 });
    s.join(b.id, { buildingId: 'a', installYear: 2013, capacityKw: 4.5 });
    expect(s.get(b.id)!.members).toHaveLength(1);
    expect(s.get(b.id)!.members[0]!.capacityKw).toBe(4.5);
    s.join(b.id, { buildingId: 'b', installYear: 2013, capacityKw: 4 });
    expect(s.get(b.id)!.status).toBe('forming');
    s.join(b.id, { buildingId: 'c', installYear: 2014, capacityKw: 5 });
    expect(s.get(b.id)!.status).toBe('threshold_met');
    s.leave(b.id, 'c');
    expect(s.get(b.id)!.status).toBe('forming');
    expect(() => s.handover(b.id, 'contractor-1')).toThrow(/threshold/);
    s.join(b.id, { buildingId: 'c', installYear: 2014, capacityKw: 5 });
    const done = s.handover(b.id, 'contractor-1');
    expect(done.status).toBe('handed_to_contractor');
    expect(() => s.join(b.id, { buildingId: 'd', installYear: 2013, capacityKw: 4 })).toThrow();
  });

  it('moves a house between forming bundles (one house, one slot)', () => {
    const s = new BundleStore();
    const w1 = s.openBundle('c', '2026-W47', 12);
    const w2 = s.openBundle('c', '2026-W48', 12);
    s.join(w1.id, { buildingId: 'a', installYear: 2013, capacityKw: 4 });
    s.join(w2.id, { buildingId: 'a', installYear: 2013, capacityKw: 4 });
    expect(s.get(w1.id)!.members).toHaveLength(0);
    expect(s.get(w2.id)!.members).toHaveLength(1);
  });

  it('computes ISO weeks', () => {
    expect(isoWeek(new Date(2026, 10, 19))).toBe('2026-W47');
    expect(isoWeek(new Date(2026, 0, 1))).toBe('2026-W01');
    const weeks = upcomingWeeks(new Date(2026, 8, 3), 3, 0);
    expect(weeks[0]).toBe('2026-W36');
    expect(weeks).toHaveLength(3);
  });
});
