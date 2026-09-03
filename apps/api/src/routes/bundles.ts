import { Hono } from 'hono';
import { z } from 'zod';
import type { Dataset } from '../dataset.js';
import { BundleStore, upcomingWeeks, type BundleRecord } from '../store.js';

export interface BundleRouteDeps {
  ds: Dataset;
  store: BundleStore;
  /** 成立閾値(軒)。 */
  defaultThreshold: number;
  now: () => Date;
  /** 束の見積(段差価格エンジン接続後に注入)。 */
  quote?: (bundle: BundleRecord) => unknown;
  /** 発注仕様(段差価格エンジン接続後に注入)。 */
  lead?: (bundle: BundleRecord) => unknown;
}

const joinSchema = z.object({
  clusterId: z.string().min(1),
  week: z.string().regex(/^\d{4}-W\d{2}$/).optional(),
  buildingId: z.string().min(1),
  installYear: z.number().int().min(1990).max(2100),
  capacityKw: z.number().positive().max(100).optional(),
  contactName: z.string().max(80).optional(),
  threshold: z.number().int().min(2).max(100).optional(),
});

export function bundleRoutes(deps: BundleRouteDeps): Hono {
  const { ds, store } = deps;
  const app = new Hono();

  app.get('/weeks', (c) => c.json({ weeks: upcomingWeeks(deps.now(), 6) }));

  app.get('/', (c) => {
    const clusterId = c.req.query('clusterId');
    const list = store.list(clusterId ? { clusterId } : {});
    return c.json({ bundles: list.map((b) => summarize(b, deps)) });
  });

  app.get('/:id', (c) => {
    const b = store.get(c.req.param('id'));
    if (!b) return c.json({ error: 'not found' }, 404);
    return c.json({ bundle: summarize(b, deps), quote: deps.quote?.(b) ?? null });
  });

  app.post('/join', async (c) => {
    const parsed = joinSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const cluster = ds.clusterById.get(body.clusterId);
    if (!cluster) return c.json({ error: `cluster ${body.clusterId} not found` }, 404);
    if (!ds.buildingById.has(body.buildingId)) return c.json({ error: `building ${body.buildingId} not found` }, 404);
    if (!cluster.buildingIds.includes(body.buildingId)) return c.json({ error: 'building is not in this cluster' }, 400);
    const week = body.week ?? upcomingWeeks(deps.now(), 1)[0]!;
    const threshold = body.threshold ?? Math.min(deps.defaultThreshold, cluster.candidateCount);
    const bundle = store.openBundle(cluster.id, week, threshold);
    try {
      const updated = store.join(bundle.id, {
        buildingId: body.buildingId,
        installYear: body.installYear,
        capacityKw: body.capacityKw ?? 4,
        contactName: body.contactName,
      });
      return c.json({ bundle: summarize(updated, deps), quote: deps.quote?.(updated) ?? null });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409);
    }
  });

  app.post('/:id/leave', async (c) => {
    const { buildingId } = (await c.req.json()) as { buildingId?: string };
    if (!buildingId) return c.json({ error: 'buildingId required' }, 400);
    try {
      return c.json({ bundle: summarize(store.leave(c.req.param('id'), buildingId), deps) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409);
    }
  });

  app.post('/:id/handover', async (c) => {
    const { contractorId } = (await c.req.json().catch(() => ({}))) as { contractorId?: string };
    try {
      const b = store.handover(c.req.param('id'), contractorId ?? 'demo-contractor');
      return c.json({ bundle: summarize(b, deps), lead: deps.lead?.(b) ?? null });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409);
    }
  });

  app.get('/:id/lead', (c) => {
    const b = store.get(c.req.param('id'));
    if (!b) return c.json({ error: 'not found' }, 404);
    return c.json({ bundle: summarize(b, deps), lead: deps.lead?.(b) ?? null });
  });

  return app;
}

export function summarize(b: BundleRecord, deps: Pick<BundleRouteDeps, 'ds'>) {
  const cluster = deps.ds.clusterById.get(b.clusterId);
  return {
    id: b.id,
    clusterId: b.clusterId,
    week: b.week,
    status: b.status,
    threshold: b.threshold,
    registered: b.members.length,
    remaining: Math.max(0, b.threshold - b.members.length),
    candidateCount: cluster?.candidateCount ?? null,
    members: b.members.map((m) => ({
      buildingId: m.buildingId,
      installYear: m.installYear,
      capacityKw: m.capacityKw,
      address: deps.ds.buildingById.get(m.buildingId)?.address ?? null,
      registeredAt: m.registeredAt,
    })),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    handedOverAt: b.handedOverAt ?? null,
    contractorId: b.contractorId ?? null,
  };
}
