// Costruisce index.html (pagina autonoma) a partire da template.html (la pagina dell'artefatto Claude).
import fs from 'node:fs';
const t = fs.readFileSync(new URL('./template.html', import.meta.url), 'utf8');
const style = t.slice(t.indexOf('<style>'), t.indexOf('</style>') + 8);
const body = t.slice(t.indexOf('</style>') + 8, t.indexOf('<script>'));
const script = t.slice(t.indexOf('<script>') + 8, t.lastIndexOf('</script>'));

const shim = `
/* Sostituto minimo della piattaforma di Claude: legge data.json e geo.json e fa girare gli stessi disegni. */
window.dash = (() => {
  const loaders = {}, calcs = {}, draws = {}, store = {}, calcOrder = [], mounted = [];
  let raw = null, geo = null, loading = null, rendered = false;
  const api = {
    loader: (id, o) => { loaders[id] = o; },
    calc: (id, o) => { calcs[id] = o; calcOrder.push(id); },
    draw: (name, f) => { draws[name] = f; },
    data: (id) => store[id] || {status: 'loading', data: []},
    refresh: () => { clearTimeout(api._t); api._t = setTimeout(load, 50); },
  };
  const compute = () => {
    for (const id in loaders) {
      try {
        const ans = id === 'geo' ? geo : (raw && raw.answers ? raw.answers[id] : undefined);
        if (ans === undefined || ans === null) throw new Error('dato mancante');
        store[id] = {status: 'ok', data: loaders[id].fn({answer: ans})};
      } catch (e) { store[id] = {status: 'error', error: String(e.message || e), data: []}; }
    }
    for (const id of calcOrder) {
      try {
        const ins = calcs[id].inputs.map((i) => { const s = store[i]; if (!s || s.status !== 'ok') throw new Error('manca ' + i); return s.data; });
        store[id] = {status: 'ok', data: calcs[id].fn(...ins)};
      } catch (e) { store[id] = {status: 'error', error: String(e.message || e), data: []}; }
    }
  };
  const render = () => {
    for (const el of document.querySelectorAll('[data-draw]')) {
      const f = draws[el.dataset.draw];
      if (!f) continue;
      try {
        if (typeof f === 'function') f(el);
        else if (!rendered) { el.__m = f.mount(el); }
        else if (f.update) f.update(el, el.__m);
      } catch (e) { console.error(el.dataset.draw, e); }
    }
    rendered = true;
  };
  const get = async (url) => { const r = await fetch(url + '?t=' + Date.now(), {cache: 'no-store'}); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try { raw = await get('data.json'); } catch (e) { console.error(e); }
      if (!geo) { try { geo = await get('geo.json'); } catch (e) { console.error(e); } }
      compute(); render();
    })().finally(() => { loading = null; });
    return loading;
  }
  api.start = () => { render(); return load(); };
  return api;
})();
`;

const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Inkasa Volley — Centrale di comando</title>
${style}
<style>html,body{margin:0;height:100%;background:#02021a}:root{--font-anthropic-sans:"Inter","Segoe UI",system-ui,-apple-system,Roboto,sans-serif}.dash-skeleton{opacity:.55}</style>
</head>
<body>
${body}
<script src="d3.min.js"></script>
<script>${shim}</script>
<script>${script}</script>
<script>
dash.start();
// doppio clic in qualsiasi punto: schermo intero (vale anche il tasto F)
const schermoIntero = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); };
document.addEventListener('dblclick', schermoIntero);
document.addEventListener('keydown', (e) => { if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) schermoIntero(); });
</script>
</body>
</html>
`;
fs.writeFileSync(new URL('./index.html', import.meta.url), html);
console.log('index.html', html.length, 'byte');
