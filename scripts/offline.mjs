import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url);
async function walk(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await walk(join(dir, entry.name), name + '/'));
    else if (entry.name !== 'sw.js') result.push(name);
  }
  return result.sort();
}
const files = await walk(root.pathname);
const hash = createHash('sha256');
for (const file of files) hash.update(file).update(await readFile(new URL(file, root)));
const version = hash.digest('hex').slice(0, 16);
// Only public build artifacts are allowlisted. No runtime or user-content cache.
const worker = `const VERSION = ${JSON.stringify(version)};
const FILES = ${JSON.stringify(files)};
const SCOPE = self.registration.scope;
const PREFIX = 'clauselens-' + encodeURIComponent(new URL(SCOPE).pathname) + '-';
const CACHE = PREFIX + VERSION;
const URLS = FILES.map(path => new URL(path, SCOPE).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(URLS)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'CACHE_READY') event.ports[0]?.postMessage({ ready: true, version: VERSION });
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isHome = request.mode === 'navigate' && (url.pathname === new URL(SCOPE).pathname || url.pathname === new URL('index.html', SCOPE).pathname);
  const key = isHome ? new URL('index.html', SCOPE).href : request.url;
  if (!URLS.includes(key)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(key)) || fetch(request)));
});
`;
await writeFile(new URL('sw.js', root), worker);
console.log(`Offline bundle ${version}: ${files.length} public assets precached.`);
