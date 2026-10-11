const BASE=new URL('./',self.location.href);
const CACHE_PREFIX='budget:'+BASE.pathname+':shell-';
const CACHE=CACHE_PREFIX+'1fbe092d6cad4369';
const SHELL=['./','index.html','app.bundle.js','style.css','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'].map(p=>new URL(p,BASE).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
// Activate after previous clients close; avoid replacing a running app during edits.
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{const req=event.request,url=new URL(req.url);if(req.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname)||!SHELL.includes(url.href))return;
 event.respondWith(fetch(req).then(response=>{if(response.ok&&response.type==='basic'){const clone=response.clone();void caches.open(CACHE).then(c=>c.put(req,clone));}return response;}).catch(()=>caches.match(req).then(r=>r||Response.error())));
});
