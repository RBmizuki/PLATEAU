import type { LngLat } from './types.js';
import { localProjector, type XY } from './geometry.js';

export interface RoutePoint {
  id: string;
  position: LngLat;
}

export interface RoutePlan {
  order: string[];
  /** 経路長 [m](出発点から順に巡って最後の地点まで。周回しない)。 */
  lengthMeters: number;
}

/**
 * 巡回順(最近傍法 + 2-opt)。束の軒数は高々数十なので十分。
 * 車両は街区の入口(最初の地点)から入り、順に回る。
 */
export function planRoute(points: readonly RoutePoint[], startId?: string): RoutePlan {
  if (points.length === 0) return { order: [], lengthMeters: 0 };
  const { toXY } = localProjector(points[0]!.position);
  const xy: XY[] = points.map((p) => toXY(p.position));
  const n = points.length;
  const dist = (i: number, j: number) => Math.hypot(xy[i]![0] - xy[j]![0], xy[i]![1] - xy[j]![1]);

  let start = startId ? points.findIndex((p) => p.id === startId) : 0;
  if (start < 0) start = 0;
  const visited = new Array<boolean>(n).fill(false);
  const order: number[] = [start];
  visited[start] = true;
  while (order.length < n) {
    const last = order[order.length - 1]!;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      const d = dist(last, j);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    visited[best] = true;
    order.push(best);
  }

  // 2-opt(開路: 先頭固定)
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const a = order[i - 1]!;
        const b = order[i]!;
        const c = order[k]!;
        const d = k + 1 < n ? order[k + 1]! : undefined;
        const before = dist(a, b) + (d !== undefined ? dist(c, d) : 0);
        const after = dist(a, c) + (d !== undefined ? dist(b, d) : 0);
        if (after + 1e-9 < before) {
          order.splice(i, k - i + 1, ...order.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    }
  }

  let length = 0;
  for (let i = 1; i < order.length; i++) length += dist(order[i - 1]!, order[i]!);
  return { order: order.map((i) => points[i]!.id), lengthMeters: Math.round(length) };
}
