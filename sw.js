'use strict';
const CACHE = 'edt-v2';

// ---- Lifecycle ----
self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first with cache fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ---- Push (reçoit les notifications du serveur) ----
self.addEventListener('push', e => {
  if (!e.data) return;
  let d;
  try { d = e.data.json(); } catch { d = { title: '📅 Rappel', body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || '📅 Rappel', {
      body: d.body || '',
      tag: d.tag || 'edt',
      renotify: true,
      icon: './icon.svg',
    })
  );
});

// ---- Rattrapage des notifications manquées ----
// Appelé par la page à chaque ouverture via postMessage
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_MISSED') {
    e.waitUntil(checkMissed());
  }
});

async function checkMissed() {
  try {
    const db = await openDB();
    const all = await getAll(db);
    const now = Date.now();
    for (const n of all) {
      if (!n.fired && n.fireAt <= now && n.fireAt > now - 3600000) {
        await self.registration.showNotification(n.title, {
          body: n.body,
          tag: n.id,
          icon: './icon.svg',
          renotify: true,
        });
        await markFired(db, n.id);
      }
      // Nettoyer les entrées de plus de 24h
      if (n.fireAt < now - 86400000) await deleteEntry(db, n.id);
    }
  } catch (e) {}
}

// ---- IndexedDB ----
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('edt-notifs', 1);
    r.onupgradeneeded = ev => ev.target.result.createObjectStore('pending', { keyPath: 'id' });
    r.onsuccess = ev => res(ev.target.result);
    r.onerror = rej;
  });
}
function getAll(db) {
  return new Promise((res, rej) => {
    const r = db.transaction('pending', 'readonly').objectStore('pending').getAll();
    r.onsuccess = ev => res(ev.target.result || []);
    r.onerror = rej;
  });
}
function markFired(db, id) {
  return new Promise((res, rej) => {
    const tx = db.transaction('pending', 'readwrite');
    const s = tx.objectStore('pending');
    const r = s.get(id);
    r.onsuccess = ev => {
      const n = ev.target.result;
      if (n) { n.fired = true; s.put(n); }
      res();
    };
    r.onerror = rej;
  });
}
function deleteEntry(db, id) {
  return new Promise((res, rej) => {
    const r = db.transaction('pending', 'readwrite').objectStore('pending').delete(id);
    r.onsuccess = () => res();
    r.onerror = rej;
  });
}
