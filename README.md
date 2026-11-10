# Inkasa Volley — Centrale di comando

Pagina a schermo intero con vendite Shopify, spesa Meta Ads, ordini totali e la mappa dell'Italia che gira da città a città.

- `index.html` — la pagina (legge `data.enc.json` e `geo.json`, chiede la password)
- `data.enc.json` — dati di Shopify e Meta CIFRATI con la password (segreto `DASH_PASSWORD`), aggiornati da GitHub Actions
- `scripts/update.mjs` + `.github/workflows/aggiorna.yml` — l'aggiornamento automatico
- `template.html` + `build.mjs` — sorgente della pagina (`node build.mjs` rigenera `index.html`)

Schermo intero: tasto **F** oppure doppio clic sulla pagina (per togliere anche la barra del browser: **F11**).

## Segreti da inserire (Settings → Secrets and variables → Actions → New repository secret)

| Nome | Valore |
|---|---|
| `DASH_PASSWORD` | la password della dashboard (scelta da te; cifra i dati) |
| `SHOPIFY_SHOP` | `b70fa5-2.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | ID client dell'app "Inkasa Dashboard" (Dev Dashboard, permessi `read_reports`, `read_orders`) |
| `SHOPIFY_CLIENT_SECRET` | Segreto client della stessa app |
| `META_TOKEN` | token di un utente di sistema del Business Manager con permesso `ads_read` sull'account INKASA |
| `META_AD_ACCOUNT` | `1797943081369913` |

Dopo averli inseriti: scheda **Actions** → "Aggiorna dati" → **Run workflow** per il primo aggiornamento.
