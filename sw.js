self.addEventListener("install", e => {
  e.waitUntil(
    caches.open("mindbridge").then(c =>
      c.addAll(["/main.html"])
    )
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
