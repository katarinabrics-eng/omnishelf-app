/**
 * Omshelf PWA – Service Worker (kostlivec)
 * Zatím jen prázdná registrace pro splnění podmínky instalace na mobil.
 * Žádné cachování ani fetch – logiku Knihovny ani Vitusu nemění.
 */
'use strict';

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
