/* Jarvis: voce della Centrale di comando.
   - annuncia i nuovi ordini
   - risponde a voce ("Jarvis, quanti ordini abbiamo?") con i dati già in pagina
   - se in jarvis.json c'è l'indirizzo del server, le domande non previste vanno a Claude */
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = 'speechSynthesis' in window;
  const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

  let attivo = false, parla = false, pensa = false, ascolta = false;
  let rec = null, finestraFino = 0, voce = null, serverUrl = '';
  let precedente = null;
  const storia = [];

  const eur = new Intl.NumberFormat('it-IT', {style: 'currency', currency: 'EUR'});
  const intero = new Intl.NumberFormat('it-IT');

  /* ---------- dati dalla pagina ---------- */
  const riga = (id) => { const s = dash.data(id); return s && s.status === 'ok' && Array.isArray(s.data) ? s.data : []; };
  const leggi = () => {
    const sg = riga('sette_giorni')[0] || null, tot = riga('shopify_totale')[0] || null, ri = riga('riepilogo_citta')[0] || null;
    return {sg, tot, ri, luoghi: riga('luoghi'), giorni: riga('giorni')};
  };
  const euro = (n) => eur.format(n).replace(/ /g, ' ');
  const parlato = (n) => { // 30,99 € -> "30 euro e 99"
    const c = Math.round(n * 100), e = Math.floor(c / 100), r = c % 100;
    return intero.format(e) + ' euro' + (r ? ' e ' + r : '');
  };

  /* ---------- voce ---------- */
  function scegliVoce() {
    if (!TTS) return;
    const v = speechSynthesis.getVoices().filter((x) => /^it/i.test(x.lang));
    const punti = (x) => (/natural/i.test(x.name) ? 50 : 0) + (/online/i.test(x.name) ? 20 : 0) + (/google/i.test(x.name) ? 15 : 0) + (/premium|enhanced|neural/i.test(x.name) ? 25 : 0) + (/diego|giuseppe|benigno|luca|cosimo/i.test(x.name) ? 5 : 0) + (x.localService ? 0 : 3);
    voce = v.sort((a, b) => punti(b) - punti(a))[0] || null;
  }
  if (TTS) { scegliVoce(); speechSynthesis.onvoiceschanged = scegliVoce; }

  let audio = null, vocePro = true, mutoFino = 0, ultimaFrase = '';
  const parole = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  function eEco(testo) { // la frase sentita è in gran parte la risposta appena detta da Jarvis?
    const a = parole(testo), b = new Set(parole(ultimaFrase));
    if (!a.length || !b.size) return false;
    return a.filter((w) => b.has(w)).length / a.length >= 0.5;
  }
  function zittisci() { if (TTS) speechSynthesis.cancel(); if (audio) { try { audio.pause(); } catch (e) {} audio = null; } }
  function fine(dopo) { parla = false; mutoFino = Date.now() + 1000; aggiornaOrb(); finestraFino = Date.now() + 60000; riavviaAscolto(); if (dopo) dopo(); }
  function voceBrowser(testo, dopo) {
    if (!TTS) { fine(dopo); return; }
    const u = new SpeechSynthesisUtterance(testo);
    u.lang = 'it-IT'; if (voce) u.voice = voce; u.rate = 1.03; u.pitch = 1;
    u.onend = u.onerror = () => fine(dopo);
    speechSynthesis.speak(u);
  }
  async function di(testo, dopo) {
    mostra(testo, 'risposta');
    ultimaFrase = testo;
    if (!attivo) { if (dopo) dopo(); return; }
    zittisci();
    parla = true; aggiornaOrb();
    if (rec) { try { rec.abort(); } catch (e) {} }
    if (serverUrl && vocePro) { // voce ElevenLabs tramite il server
      try {
        const r = await fetch(serverUrl.replace(/\/$/, '') + '/voce', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Jarvis-Key': dash.password ? dash.password() : ''}, body: JSON.stringify({testo})});
        if (!r.ok) vocePro = false;
        if (!r.ok) throw new Error('voce ' + r.status);
        const url = URL.createObjectURL(await r.blob());
        const a = new Audio(url); audio = a;
        a.onended = a.onerror = () => { URL.revokeObjectURL(url); if (audio === a) audio = null; fine(dopo); };
        await a.play();
        return;
      } catch (e) { audio = null; }
    }
    voceBrowser(testo, dopo);
  }

  /* ---------- risposte locali ---------- */
  function risposteLocali(t) {
    const d = leggi();
    const nd = 'Non ho ancora i dati.';
    if (/zitto|silenzio|basta|stop/.test(t)) { zittisci(); return {tace: true}; }
    if (/aggiorna|ricarica/.test(t)) { dash.refresh(); return {dire: 'Aggiorno i dati.'}; }
    if (/riepilogo|situazione|come stiamo|come va|novit/.test(t)) {
      if (!d.tot) return {dire: nd};
      let s = 'Siamo a ' + intero.format(d.tot.orders) + ' ordini e ' + parlato(d.tot.total_sales) + ' di fatturato complessivo.';
      if (d.sg) s += ' Negli ultimi sette giorni ' + intero.format(d.sg.ordini) + ' ordini, ' + parlato(d.sg.vendite) + ' di vendite, ' + parlato(d.sg.spesa) + ' di spesa Meta, utile ' + parlato(d.sg.utile) + '.';
      return {dire: s};
    }
    if (/utile|guadagn|profitt|margine/.test(t)) return d.sg ? {dire: 'L\'utile degli ultimi sette giorni è ' + parlato(d.sg.utile) + '.'} : {dire: nd};
    if (/spesa|meta|pubblicit|ads|inserzion/.test(t)) return d.sg ? {dire: 'Negli ultimi sette giorni abbiamo speso ' + parlato(d.sg.spesa) + ' in Meta Ads' + (d.sg.spesa_per_ordine ? ', circa ' + parlato(d.sg.spesa_per_ordine) + ' per ordine' : '') + '.'} : {dire: nd};
    if (/citt|dove|classifica|provinc/.test(t)) {
      if (!d.luoghi.length) return {dire: nd};
      const top = d.luoghi.slice(0, 3).map((p) => p.nome + ' con ' + p.ordini).join(', ');
      return {dire: 'Le città che ordinano di più sono ' + top + '.' + (d.ri ? ' In tutto abbiamo raggiunto ' + d.ri.citta + ' città.' : '')};
    }
    if (/fatturat|incass|total/.test(t) && !/settiman|giorni/.test(t)) return d.tot ? {dire: 'Il fatturato complessivo è ' + parlato(d.tot.total_sales) + ', su ' + intero.format(d.tot.orders) + ' ordini.'} : {dire: nd};
    if (/vendit|settiman|giorni/.test(t)) return d.sg ? {dire: 'Negli ultimi sette giorni ' + parlato(d.sg.vendite) + ' di vendite su ' + intero.format(d.sg.ordini) + ' ordini.'} : {dire: nd};
    if (/ordin/.test(t)) return d.tot ? {dire: 'Abbiamo ricevuto ' + intero.format(d.tot.orders) + ' ordini in tutto.'} : {dire: nd};
    return null;
  }

  /* ---------- Claude (se il server è configurato) ---------- */
  function contesto() {
    const d = leggi(), r = [];
    if (d.tot) r.push('Ordini totali dall\'apertura: ' + d.tot.orders + '. Fatturato complessivo: ' + d.tot.total_sales + ' EUR.');
    if (d.sg) r.push('Ultimi 7 giorni completi (' + d.sg.dal + ' / ' + d.sg.al + '): vendite ' + d.sg.vendite + ' EUR, ordini ' + d.sg.ordini + ', spesa Meta Ads ' + d.sg.spesa + ' EUR, costi prodotto e spedizione ' + d.sg.costi + ' EUR, utile ' + d.sg.utile + ' EUR.');
    if (d.giorni.length) r.push('Giorno per giorno: ' + d.giorni.map((g) => g.day + ' vendite ' + g.vendite + ' ordini ' + g.ordini + ' spesa ' + g.spesa).join('; ') + '.');
    if (d.ri) r.push('Città raggiunte: ' + d.ri.citta + ', province: ' + d.ri.province + ', ordini dall\'estero: ' + d.ri.estero + '.');
    if (d.luoghi.length) r.push('Città con più ordini: ' + d.luoghi.slice(0, 15).map((p) => p.nome + ' ' + p.ordini).join(', ') + '.');
    return r.join('\n').slice(0, 6000);
  }
  async function chiediAClaude(domanda) {
    const pw = dash.password ? dash.password() : '';
    const r = await fetch(serverUrl, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Jarvis-Key': pw}, body: JSON.stringify({domanda, contesto: contesto(), storia: storia.slice(-8)})});
    if (r.status === 401) throw new Error('password');
    if (r.status === 429) throw new Error('limite');
    if (!r.ok) throw new Error('server ' + r.status);
    const j = await r.json();
    const risp = String(j.risposta || '').slice(0, 800);
    storia.push({role: 'user', content: domanda}, {role: 'assistant', content: risp});
    while (storia.length > 12) storia.shift();
    return risp;
  }

  async function gestisci(testo) {
    const t = testo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
    mostra('« ' + testo + ' »', 'domanda');
    if (/^(zitto|silenzio|basta|stop)\b/.test(t)) { zittisci(); parla = false; aggiornaOrb(); return; }
    if (/^(aggiorna|ricarica)( i dati)?$/.test(t)) { dash.refresh(); di('Aggiorno i dati.'); return; }
    if (serverUrl) {
      pensa = true; aggiornaOrb();
      try { di(await chiediAClaude(testo)); }
      catch (e) {
        const loc = risposteLocali(t);
        if (loc && loc.dire) di(loc.dire);
        else di(e.message === 'limite' ? 'Ho raggiunto il limite di domande per ora.' : e.message === 'password' ? 'Non sono autorizzato a rispondere.' : 'Non riesco a collegarmi a Claude in questo momento.');
      }
      finally { pensa = false; aggiornaOrb(); }
      return;
    }
    const loc = risposteLocali(t);
    if (loc && loc.tace) return;
    if (loc) { di(loc.dire); return; }
    di('Non ho capito. Chiedimi di ordini, fatturato, vendite, spesa Meta o utile.');
  }

  /* ---------- ascolto ---------- */
  const WAKE = /\b(jarvis|giarvis|gervis|jarvi|garvis|giarvi)\b/;
  function avviaAscolto() {
    if (!SR || rec) return;
    rec = new SR(); rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = false;
    rec.onstart = () => { ascolta = true; aggiornaOrb(); };
    rec.onend = () => { ascolta = false; aggiornaOrb(); rec = null; if (attivo && !parla) setTimeout(avviaAscolto, Math.max(400, mutoFino - Date.now())); };
    rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { mostra('Microfono non consentito: consenti l\'accesso al microfono per il sito.', 'errore'); LS('inkasa_jarvis_mic', 'no'); } };
    rec.onresult = (ev) => {
      if (parla || Date.now() < mutoFino) return; // mentre Jarvis parla, e subito dopo, ignoro quello che sento
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        const testo = ev.results[i][0].transcript.trim();
        if (eEco(testo)) continue;
        const t = testo.toLowerCase();
        if (WAKE.test(t)) {
          const resto = t.split(WAKE).slice(2).join(' ').trim() || t.replace(WAKE, '').trim();
          if (resto.length > 2) gestisci(resto); else { di('Dica pure.'); }
        } else if (Date.now() < finestraFino && t.length > 2) {
          if (/^(grazie|basta cosi|basta|a posto|ok grazie|chiudi|fine)( jarvis)?$/.test(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, '').trim())) { di('Quando vuoi, sono qui.', () => { finestraFino = 0; aggiornaOrb(); }); }
          else gestisci(testo);
        }
      }
    };
    try { rec.start(); } catch (e) { rec = null; }
  }
  function riavviaAscolto() { if (attivo && !rec && SR) setTimeout(() => { if (!parla) avviaAscolto(); }, Math.max(300, mutoFino - Date.now())); }

  /* ---------- nuovi ordini ---------- */
  function istantanea() {
    const d = leggi();
    if (!d.tot) return null;
    const citta = new Map(d.luoghi.map((p) => [p.nome, p.ordini]));
    return {ordini: d.tot.orders, vendite: d.tot.total_sales, citta};
  }
  function controllaOrdini() {
    const s = istantanea();
    if (!s) return;
    if (precedente && s.ordini > precedente.ordini) {
      const n = s.ordini - precedente.ordini, incasso = s.vendite - precedente.vendite;
      const nuove = [...s.citta.entries()].filter(([nome, o]) => o > (precedente.citta.get(nome) || 0)).map(([nome]) => nome);
      let frase;
      if (n === 1) frase = 'Nuovo ordine' + (nuove.length === 1 ? ' da ' + nuove[0] : '') + (incasso > 0 ? ', ' + parlato(incasso) : '') + '. Siamo a ' + intero.format(s.ordini) + ' ordini.';
      else frase = 'Sono arrivati ' + n + ' nuovi ordini' + (incasso > 0 ? ', per ' + parlato(incasso) : '') + '. Siamo a ' + intero.format(s.ordini) + ' ordini.';
      di(frase);
    }
    precedente = s;
  }

  /* ---------- interfaccia ---------- */
  const css = document.createElement('style');
  css.textContent = '.jv-jarvis{flex:1 1 280px;min-width:0;max-width:min(42vw,640px);align-self:center;display:flex;align-items:center;gap:clamp(10px,1vw,18px);padding:clamp(8px,.7vw,14px) clamp(12px,1.1vw,20px);border:1px solid var(--jv-line,rgba(108,124,255,.24));background:linear-gradient(160deg,rgba(10,10,62,.74),rgba(3,3,26,.58));-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);position:relative}'
    + '.jv-jarvis::before{content:"";position:absolute;left:-1px;top:-1px;width:12px;height:12px;border-left:2px solid var(--jv-cyan,#6c7cff);border-top:2px solid var(--jv-cyan,#6c7cff);filter:drop-shadow(0 0 5px var(--jv-cyan,#6c7cff))}'
    + '.jv-jarvis::after{content:"";position:absolute;right:-1px;bottom:-1px;width:12px;height:12px;border-right:2px solid var(--jv-cyan,#6c7cff);border-bottom:2px solid var(--jv-cyan,#6c7cff);filter:drop-shadow(0 0 5px var(--jv-cyan,#6c7cff))}'
    + '.jv-orb{flex:none;width:clamp(40px,3.4vw,62px);height:clamp(40px,3.4vw,62px);border-radius:50%;border:1px solid rgba(108,124,255,.55);background:radial-gradient(circle at 50% 40%,rgba(108,124,255,.28),rgba(2,2,26,.85) 70%);color:#9aa0d6;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:.2s;box-shadow:0 0 12px rgba(108,124,255,.25)}'
    + '.jv-orb svg{width:42%;height:42%}.jv-orb:hover{color:#f2f4ff;border-color:#eda93b}'
    + '.jv-orb.on{color:#eda93b;border-color:#eda93b;box-shadow:0 0 16px rgba(237,169,59,.5)}'
    + '.jv-orb.on.ascolta{animation:jvorb 1.8s ease-in-out infinite}.jv-orb.parla{background:radial-gradient(circle at 50% 40%,rgba(237,169,59,.5),rgba(2,2,26,.85) 70%);animation:jvorb .7s ease-in-out infinite}.jv-orb.pensa{animation:jvorb .4s ease-in-out infinite}'
    + '@keyframes jvorb{50%{box-shadow:0 0 26px rgba(237,169,59,.9);transform:scale(1.07)}}'
    + '.jv-jtext{min-width:0;font-family:var(--jv-mono,ui-monospace,Menlo,Consolas,monospace)}'
    + '.jv-jlabel{margin:0;font:600 clamp(10px,.8vw,15px) var(--jv-mono,ui-monospace,Menlo,Consolas,monospace);letter-spacing:.34em;text-transform:uppercase;color:var(--jv-cyan,#6c7cff)}'
    + '.jv-voce{margin:.3em 0 0;font-size:clamp(11px,.9vw,16px);line-height:1.35;letter-spacing:.03em;color:var(--jv-dim,#9aa0d6);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}'
    + '.jv-voce.domanda{color:#9aa0d6}.jv-voce.risposta{color:#f2f4ff}.jv-voce.errore{color:#eda93b}.jv-voce.attivo{color:#eda93b}'
    + '.jv-jarvis.flottante{position:fixed;left:14px;bottom:46px;z-index:50;max-width:min(60vw,560px)}';
  document.head.appendChild(css);

  const orb = document.createElement('button');
  orb.className = 'jv-orb'; orb.type = 'button'; orb.title = 'Jarvis (tasto J)';
  orb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  const bolla = document.createElement('p'); bolla.className = 'jv-voce';
  const modulo = document.createElement('div'); modulo.className = 'jv-jarvis';
  const blocco = document.createElement('div'); blocco.className = 'jv-jtext';
  const etichetta = document.createElement('p'); etichetta.className = 'jv-jlabel'; etichetta.textContent = 'Jarvis';
  blocco.appendChild(etichetta); blocco.appendChild(bolla);
  modulo.appendChild(orb); modulo.appendChild(blocco);
  const testata = document.getElementById('testata');
  const sys = testata && testata.querySelector('.jv-sys');
  if (testata && sys) testata.insertBefore(modulo, sys);
  else { modulo.classList.add('flottante'); document.body.appendChild(modulo); }

  let tBolla = 0, messaggio = false;
  function testoStato() {
    if (!attivo) return 'In pausa · tocca la sfera o premi J';
    if (pensa) return 'Sto pensando…';
    if (parla) return 'Sto parlando…';
    return SR ? (Date.now() < finestraFino ? 'In conversazione · parla pure, «grazie» per chiudere' : 'In ascolto · dì «Jarvis» e la domanda') : 'Attivo · annuncio i nuovi ordini';
  }
  function mostraStato() { if (messaggio) return; bolla.textContent = testoStato(); bolla.className = 'jv-voce' + (attivo ? ' attivo' : ''); }
  function mostra(testo, tipo) {
    messaggio = true; bolla.textContent = testo; bolla.className = 'jv-voce ' + (tipo || '');
    clearTimeout(tBolla); tBolla = setTimeout(() => { messaggio = false; mostraStato(); }, Math.min(14000, 3500 + testo.length * 60));
  }
  function aggiornaOrb() {
    orb.className = 'jv-orb' + (attivo ? ' on' : '') + (attivo && ascolta ? ' ascolta' : '') + (parla ? ' parla' : '') + (pensa ? ' pensa' : '');
    mostraStato();
  }
  aggiornaOrb();
  setInterval(mostraStato, 5000);

  function accendi() {
    attivo = true; LS('inkasa_jarvis', '1'); aggiornaOrb();
    zittisci();
    precedente = istantanea();
    if (SR) avviaAscolto();
    if (TTS) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } // sblocca l'audio senza parlare
    mostra(SR ? 'Attivo · dì «Jarvis» e la domanda' : 'Attivo · annuncerò i nuovi ordini', 'attivo');
  }
  function spegni() {
    attivo = false; LS('inkasa_jarvis', '0');
    zittisci();
    if (rec) { try { rec.stop(); } catch (e) {} }
    parla = false; aggiornaOrb(); mostra('Jarvis spento.', 'risposta');
  }
  window.__jarvis = {gestisci, controllaOrdini, accendi, voce: () => voce && voce.name};
  const commuta = () => (attivo ? spegni() : accendi());
  orb.addEventListener('click', commuta);
  orb.addEventListener('dblclick', (e) => e.stopPropagation()); // non attivare lo schermo intero
  document.addEventListener('keydown', (e) => { if ((e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.metaKey && !e.altKey && !/input|textarea/i.test((e.target || {}).tagName || '')) commuta(); });

  // se in jarvis.json c'è l'indirizzo del server, le domande non previste vanno a Claude
  fetch('jarvis.json?t=' + Date.now(), {cache: 'no-store'}).then((r) => r.ok ? r.json() : {}).then((j) => { serverUrl = (j && j.url) || ''; }).catch(() => {});
  setInterval(() => { if (attivo) controllaOrdini(); }, 5000);
  if (LS('inkasa_jarvis') === '1') mostra('Tocca la sfera per riattivare Jarvis.', 'errore');
})();
