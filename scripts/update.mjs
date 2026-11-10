// Aggiorna data.json con i dati di Shopify e Meta Ads. Girato da GitHub Actions ogni 15 minuti.
import fs from 'node:fs';

const {SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, META_TOKEN, META_AD_ACCOUNT} = process.env;
let SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN || ''; // facoltativo: se manca lo ottengo da client id + secret
const SHOPIFY_API = process.env.SHOPIFY_API_VERSION || '2026-07';
const META_API = process.env.META_API_VERSION || 'v27.0';
const FILE = new URL('../data.json', import.meta.url);

const vecchio = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {answers: {}};
const risposte = {...vecchio.answers};
const errori = [];

async function tokenShopify() {
  if (SHOPIFY_TOKEN) return SHOPIFY_TOKEN;
  const r = await fetch(`https://${SHOPIFY_SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, grant_type: 'client_credentials'}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Shopify token: ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  SHOPIFY_TOKEN = j.access_token;
  return SHOPIFY_TOKEN;
}

async function shopifyqlUna(query) {
  await tokenShopify();
  const r = await fetch(`https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API}/graphql.json`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_TOKEN},
    body: JSON.stringify({query: `query($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name } rows } } }`, variables: {q: query}}),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error('Shopify: ' + JSON.stringify(j.errors || r.status).slice(0, 300));
  const res = j.data.shopifyqlQuery;
  if (res.parseErrors && res.parseErrors.length) throw new Error('ShopifyQL: ' + JSON.stringify(res.parseErrors).slice(0, 300));
  const columns = res.tableData.columns.map((c) => ({name: c.name}));
  // le righe arrivano come oggetti: le riporto a elenchi di testi, nell'ordine delle colonne
  const rows = res.tableData.rows.map((row) => columns.map((c, i) => String((Array.isArray(row) ? row[i] : row[c.name]) ?? '')));
  return {columns, rows};
}

// Shopify limita le query pesanti: se risponde "THROTTLED" aspetto e riprovo
async function shopifyql(query) {
  for (let t = 1; ; t++) {
    try { return await shopifyqlUna(query); }
    catch (e) {
      if (!/THROTTLED|Rate limited/.test(e.message) || t >= 5) throw e;
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
}

async function meta() {
  const base = META_API ? `https://graph.facebook.com/${META_API}` : 'https://graph.facebook.com';
  const u = new URL(`${base}/act_${META_AD_ACCOUNT}/insights`);
  u.search = new URLSearchParams({fields: 'spend,account_currency,date_start', date_preset: 'last_7d', time_increment: '1', limit: '31', access_token: META_TOKEN});
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('Meta: ' + JSON.stringify(j.error || r.status).slice(0, 300));
  return {ad_entities: j.data.map((d) => ({date_start: d.date_start, amount_spent: {value: d.spend, unit: d.account_currency || 'EUR'}}))};
}

const compiti = {
  shopify_giorni: () => shopifyql('FROM sales SHOW orders, total_sales TIMESERIES day SINCE -7d UNTIL today'),
  shopify_totale: () => shopifyql('FROM sales SHOW orders, total_sales SINCE 2015-01-01 UNTIL today'),
  ordini_citta: () => shopifyql('FROM sales SHOW orders, total_sales GROUP BY shipping_city, shipping_region, shipping_country SINCE 2015-01-01 UNTIL today ORDER BY orders DESC LIMIT 1000'),
  meta_giorni: meta,
};
const servono = {
  shopify_giorni: ['SHOPIFY_SHOP', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'], shopify_totale: ['SHOPIFY_SHOP', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'],
  ordini_citta: ['SHOPIFY_SHOP', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'], meta_giorni: ['META_TOKEN', 'META_AD_ACCOUNT'],
};

for (const [id, fn] of Object.entries(compiti)) {
  const mancanti = servono[id].filter((k) => !process.env[k]);
  if (mancanti.length) { errori.push(`${id}: manca il segreto ${mancanti.join(', ')}`); continue; }
  try { risposte[id] = await fn(); console.log('ok', id); }
  catch (e) { errori.push(`${id}: ${e.message}`); }
}

// riscrivo il file solo se i dati sono cambiati, così non si riempie di aggiornamenti inutili
const cambiato = JSON.stringify(risposte) !== JSON.stringify(vecchio.answers);
if (cambiato) fs.writeFileSync(FILE, JSON.stringify({updated: new Date().toISOString(), answers: risposte}));
console.log(cambiato ? 'data.json aggiornato' : 'nessun cambiamento');
if (errori.length) { console.error('ERRORI:\n' + errori.join('\n')); process.exit(1); }
