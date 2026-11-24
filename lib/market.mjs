export const API = 'https://api.taskmarket.dev';
export const CHAINS = [4217, 8453];
export const RANGES = ['7d', '30d', '90d', 'all'];
export const TTL = 300_000;
const ROUTES = new Set(['/api/market/stats', '/api/stats/breakdowns', '/api/stats/platform-time-series', '/api/stats/activity-heatmap', '/api/stats/activity-feed', '/api/tasks']);

export function selection(chain, range = '30d') {
  const chainId = Number(chain);
  if (!CHAINS.includes(chainId) || !RANGES.includes(range)) throw new Error('Invalid chain or range');
  return { chainId, range };
}
export function weekOf(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(+d)) throw new Error('Invalid task date');
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
export function weeklyPosters(tasks, start = null, end = new Date().toISOString()) {
  const weeks = new Map();
  const counts = new Map();
  const seen = new Set();
  for (const t of tasks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (typeof t.requester !== 'string' || !/^0x[0-9a-f]{40}$/i.test(t.requester)) throw new Error('Invalid requester address');
    const week = weekOf(t.createdAt);
    if (+new Date(t.createdAt) > +new Date(end)) continue;
    if (!weeks.has(week)) weeks.set(week, new Set());
    weeks.get(week).add(t.requester.toLowerCase());
    counts.set(week, (counts.get(week) || 0) + 1);
  }
  // Whole UTC Monday weeks that overlap the selected range; no partial-week undercount.
  const first = start ? weekOf(start) : [...weeks.keys()].sort()[0];
  if (!first) return [];
  const result = [];
  for (let d = new Date(first); +d <= +new Date(end); d.setUTCDate(d.getUTCDate() + 7)) {
    const week = d.toISOString().slice(0, 10);
    result.push({ week, posters: weeks.get(week)?.size || 0, tasks: counts.get(week) || 0 });
  }
  return result;
}

export async function paginateTasks(get, chainId, maxPages = 500) {
  const tasks = new Map(), sources = [], cursors = new Set();
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const source = await get('/api/tasks', { chainId, status: 'ALL', sort: 'newest', limit: 100, ...(cursor ? { cursor } : {}) });
    const d = source.data;
    if (!Array.isArray(d.tasks) || typeof d.hasMore !== 'boolean') throw new Error('Task pagination schema changed');
    for (const t of d.tasks) {
      if (t.chainId !== chainId || typeof t.id !== 'string') throw new Error('Task chain mismatch');
      weekOf(t.createdAt);
      tasks.set(t.id, { id: t.id, requester: t.requester, createdAt: t.createdAt, chainId: t.chainId, mode: t.mode, status: t.status });
    }
    sources.push({ url: source.url, fetchedAt: source.fetchedAt, stale: source.stale || false });
    if (!d.hasMore) return { tasks: [...tasks.values()], sources, pages: page + 1, complete: true };
    if (!d.nextCursor || cursors.has(d.nextCursor) || !d.tasks.length) throw new Error('Task cursor stalled; refusing partial weekly totals');
    cursors.add(d.nextCursor);
    cursor = d.nextCursor;
  }
  throw new Error('Task page budget exceeded; weekly totals unavailable');
}

export function createMarket({ fetcher = fetch, cache = new Map(), ttl = TTL, now = () => Date.now(), maxPages = 500 } = {}) {
  const inflight = new Map(), taskCache = new Map();
  async function get(path, params = {}) {
    if (!ROUTES.has(path)) throw new Error('Route not allowed');
    const url = new URL(path, API);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const key = url.href, old = cache.get(key);
    if (old && now() - Date.parse(old.fetchedAt) < ttl) return old;
    if (inflight.has(key)) return inflight.get(key);
    const promise = (async () => {
      try {
        const res = await fetcher(key, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Upstream HTTP ${res.status}`);
        const content = await res.text();
        if (content.length > 8_000_000) throw new Error('Upstream response too large');
        const entry = { url: key, fetchedAt: new Date(now()).toISOString(), data: JSON.parse(content) };
        cache.set(key, entry);
        return entry;
      } catch (e) {
        if (old) return { ...old, stale: true, error: String(e.message) };
        throw e;
      } finally { inflight.delete(key); }
    })();
    inflight.set(key, promise);
    return promise;
  }
  async function tasks(chainId) {
    const old = taskCache.get(chainId);
    if (old && now() - old.at < ttl) return old.promise;
    const promise = paginateTasks(get, chainId, maxPages);
    taskCache.set(chainId, { at: now(), promise });
    try { return await promise; } catch (e) { taskCache.delete(chainId); throw e; }
  }
  async function feed(chainId, cursor) {
    selection(chainId);
    if (cursor && (cursor.length > 40 || !Number.isFinite(Date.parse(cursor)))) throw new Error('Invalid feed cursor');
    const items = [], sources = [], seen = new Set();
    let next = cursor;
    for (let page = 0; page < 5; page++) {
      const src = await get('/api/stats/activity-feed', { chainId, limit: 50, ...(next ? { cursor: next } : {}) });
      if (!Array.isArray(src.data.items)) throw new Error('Feed schema changed');
      sources.push({ url: src.url, fetchedAt: src.fetchedAt, stale: !!src.stale });
      for (const item of src.data.items) {
        const key = `${item.type}:${item.taskId}:${item.actor}:${item.timestamp}`;
        if (item.chainId === chainId && !seen.has(key)) { seen.add(key); items.push(item); }
      }
      const previous = next;
      next = src.data.nextCursor;
      if (!next || next === previous || items.length >= 10) break;
    }
    return { items, nextCursor: next, sources, filteredByChainId: true, note: 'Upstream feed ignores chainId. Events filtered by their explicit chainId; up to 5 pages per request.' };
  }
  async function snapshot(chainId, range) {
    selection(chainId, range);
    const startedAt = new Date(now()).toISOString();
    const jobs = [
      ['headline', () => get('/api/market/stats', { chainId })],
      ['breakdowns', () => get('/api/stats/breakdowns', { chainId })],
      ['series', () => get('/api/stats/platform-time-series', { chainId, range, bucket: 'day' })],
      ['heatmap', () => get('/api/stats/activity-heatmap', { chainId, range, dimension: 'hourOfWeek' })],
      ['feed', () => feed(chainId)],
      ['taskList', () => tasks(chainId)]
    ];
    const settled = await Promise.allSettled(jobs.map(([, fn]) => fn()));
    const result = { chainId, range, startedAt, generatedAt: new Date(now()).toISOString(), sources: {}, errors: {}, scope: { series: 'platform', breakdowns: 'platform', heatmap: 'platform', headline: 'mixed / unverified; chainId supplied', tasks: 'selected chain', feed: 'selected chain; filtered' } };
    for (let i = 0; i < jobs.length; i++) {
      const key = jobs[i][0], item = settled[i];
      if (item.status === 'rejected') { result.errors[key] = item.reason.message; continue; }
      const src = item.value;
      if (key === 'taskList') {
        try {
          const start = range === 'all' ? null : new Date(now() - Number(range.slice(0, -1)) * 86400000).toISOString();
          result.weekly = weeklyPosters(src.tasks, start, result.generatedAt);
          result.taskCoverage = { pages: src.pages, count: src.tasks.length, complete: src.complete };
          result.chainBreakdowns = Object.fromEntries(['mode', 'status'].map(k => {
            const tally = new Map();
            src.tasks.forEach(t => tally.set(t[k] || 'unknown', (tally.get(t[k] || 'unknown') || 0) + 1));
            return [k, [...tally].map(([label, count]) => ({ [k]: label, count }))];
          }));
          result.sources[key] = src.sources;
        } catch (e) { result.errors[key] = e.message; }
      } else if (key === 'feed') { result.feed = src; result.sources[key] = src.sources; }
      else {
        const d = src.data;
        const valid = key === 'series' ? Array.isArray(d) && d.every(x => typeof x.bucket === 'string' && Number.isFinite(x.activeAgents) && Number.isFinite(x.tasksCreated) && /^\d+$/.test(x.rewardVolume) && /^\d+$/.test(x.paidVolume)) : key === 'heatmap' ? Array.isArray(d.cells) && Array.isArray(d.rowKeys) && Array.isArray(d.colKeys) : key === 'breakdowns' ? Array.isArray(d.mode) && Array.isArray(d.status) : ['registeredWorkers', 'activeWorkers7d', 'activeAgents7d', 'openTasks', 'paidWorkers', 'activeWallets'].every(k => Number.isFinite(d[k]));
        if (!valid) { result.errors[key] = 'Upstream schema changed; view hidden'; continue; }
        result[key] = d;
        result.sources[key] = [{ url: src.url, fetchedAt: src.fetchedAt, stale: !!src.stale, ...(src.error ? { error: src.error } : {}) }];
      }
    }
    result.asOf = Object.values(result.sources).flat().map(x => x.fetchedAt).sort()[0] || null;
    result.stale = Object.values(result.sources).flat().some(x => x.stale);
    return result;
  }
  return { get, snapshot, feed, cache };
}
