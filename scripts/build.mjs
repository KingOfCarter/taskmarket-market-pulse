import { cp, mkdir, writeFile } from 'node:fs/promises';
import { CHAINS, RANGES, createMarket } from '../lib/market.mjs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const snapshots = new URL('snapshots/', dist);
await mkdir(snapshots, { recursive: true });
await cp(new URL('public/', root), dist, { recursive: true });
await cp(new URL('notes.txt', root), new URL('notes.txt', dist));
await writeFile(new URL('.nojekyll', dist), '');
const market = createMarket();
const save = (name, data) => writeFile(new URL(name, snapshots), JSON.stringify(data));

for (const chain of CHAINS) {
  // All ranges share the same first feed batch within the build cache.
  const extra = new Map();
  for (const range of RANGES) {
    const view = await market.snapshot(chain, range);
    if (!view.asOf || view.stale || Object.keys(view.errors).length || !view.taskCoverage?.complete) {
      throw new Error('Incomplete snapshot for ' + chain + '/' + range + ': ' + JSON.stringify(view.errors));
    }
    let cursor = view.feed.nextCursor;
    for (let depth = 0; cursor && depth < 3; depth++) {
      if (!Number.isFinite(Date.parse(cursor))) throw new Error('Invalid feed cursor');
      if (!extra.has(cursor)) {
        const page = await market.feed(chain, cursor);
        if (page.sources.some(source => source.stale)) throw new Error('Stale feed batch');
        if (depth === 2 || page.nextCursor === cursor) page.nextCursor = null;
        extra.set(cursor, page);
        await save('feed-' + chain + '-' + Date.parse(cursor) + '.json', page);
      }
      cursor = extra.get(cursor).nextCursor;
    }
    await save(chain + '-' + range + '.json', view);
    console.log(chain, range, view.asOf, view.taskCoverage.count, 'tasks');
  }
}
