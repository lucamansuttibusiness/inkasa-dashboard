// Costruisce index.html (pagina autonoma) a partire da template.html (la pagina dell'artefatto Claude).
import fs from 'node:fs';
const t = fs.readFileSync(new URL('./template.html', import.meta.url), 'utf8');
const style = t.slice(t.indexOf('<style>'), t.indexOf('</style>') + 8);
const body = t.slice(t.indexOf('</style>') + 8, t.indexOf('<script>'));
const script = t.slice(t.indexOf('<script>') + 8, t.lastIndexOf('</script>'));

const shim = `
/* Sostituto minimo della piattaforma di Claude: legge data.enc.json (cifrato) e geo.json e fa girare gli stessi disegni. */
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
  // --- dati cifrati: la password sblocca data.enc.json (AES-GCM, chiave derivata con PBKDF2) ---
  let pwNow = '';
  const b64 = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
  async function decifra(enc, pw) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({name: 'PBKDF2', salt: b64(enc.s), iterations: enc.i, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
    const buf = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b64(enc.n)}, key, b64(enc.c));
    return JSON.parse(new TextDecoder().decode(buf));
  }
  let lock = null;
  function chiediPassword(msg) {
    return new Promise((resolve) => {
      if (!lock) {
        lock = document.createElement('div');
        lock.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#02021a;display:flex;align-items:center;justify-content:center;font-family:Inter,Segoe UI,system-ui,sans-serif;color:#f2f4ff';
        lock.innerHTML = '<form style="width:min(92vw,360px);text-align:center"><div style="font-size:11px;letter-spacing:.3em;color:#9aa0d6;margin-bottom:10px">CENTRALE DI COMANDO</div><div style="font-size:30px;letter-spacing:.08em;margin-bottom:26px">INKASA VOLLEY</div><input type="password" autocomplete="current-password" placeholder="Password" style="width:100%;box-sizing:border-box;padding:14px 16px;border-radius:10px;border:1px solid rgba(108,124,255,.5);background:rgba(0,0,128,.25);color:#f2f4ff;font-size:18px;text-align:center;outline:none"><button type="submit" style="margin-top:14px;width:100%;padding:13px;border-radius:10px;border:0;background:#eda93b;color:#02021a;font-size:16px;font-weight:600;cursor:pointer">Sblocca</button><div class="lk-msg" style="margin-top:14px;min-height:20px;color:#eda93b;font-size:14px"></div></form>';
        document.body.appendChild(lock);
      }
      lock.style.display = 'flex';
      lock.querySelector('.lk-msg').textContent = msg || '';
      const inp = lock.querySelector('input'), form = lock.querySelector('form');
      inp.value = ''; setTimeout(() => inp.focus(), 50);
      form.onsubmit = (e) => { e.preventDefault(); if (inp.value) resolve(inp.value); };
    });
  }
  async function leggiDati() {
    const enc = await get('data.enc.json');
    let msg = '';
    for (;;) {
      let pw = pwNow;
      if (!pw) { try { pw = localStorage.getItem('inkasa_pw') || ''; } catch (e) { pw = ''; } }
      if (!pw) pw = await chiediPassword(msg);
      try {
        const j = await decifra(enc, pw);
        pwNow = pw;
        try { localStorage.setItem('inkasa_pw', pw); } catch (e) {}
        if (lock) lock.style.display = 'none';
        return j;
      } catch (e) {
        pwNow = ''; msg = 'Password errata';
        try { localStorage.removeItem('inkasa_pw'); } catch (e2) {}
      }
    }
  }
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try { raw = await leggiDati(); } catch (e) { console.error(e); }
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
