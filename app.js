/* FriOlKa PWA – v4 (final) */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Global error banner for quicker diagnostics
window.addEventListener('error', (e) => showError('Fehler: ' + (e.message||e)));
window.addEventListener('unhandledrejection', (e) => showError('Fehler (Promise): ' + (e.reason?.message||e.reason||e)));
function showError(msg){ const b=$('#error-banner'); if(!b) return; b.textContent=msg; b.classList.remove('hidden'); setTimeout(()=>b.classList.add('hidden'), 8000); }

/* ---- PWA Setup ---- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err=>showError('SW: '+err));
}

/* ---- State ---- */
let state = {
  pos: null,
  spots: [],
  weather: null,
  filters: { kinderwagen:false, schattig:false, freistehen:false, lokal:false, preiswert:false },
  basecamps: [],
  quality: {} // { id: { snorkelScore, fishingScore } }
};

const storage = {
  load() {
    try { const s = JSON.parse(localStorage.getItem('friolika-state') || '{}'); if (s.spots) state.spots = s.spots; } catch {}
  },
  save() { localStorage.setItem('friolika-state', JSON.stringify({ spots: state.spots })); }
};
storage.load();

/* ---- Tabs ---- */
$$('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $$('.tab').forEach(t => t.classList.remove('active'));
    const shown = document.getElementById('tab-'+tab); if (shown) shown.classList.add('active');
    if (tab === 'map') setTimeout(initMapOnce, 0);
  });
});

/* ---- Filter Events ---- */
['f-kinderwagen','f-schattig','f-freistehen','f-lokal','f-preiswert'].forEach(id=>{
  const el = document.getElementById(id); if(!el) return; el.addEventListener('change', ()=>{
    state.filters.kinderwagen = !!document.getElementById('f-kinderwagen')?.checked;
    state.filters.schattig    = !!document.getElementById('f-schattig')?.checked;
    state.filters.freistehen  = !!document.getElementById('f-freistehen')?.checked;
    state.filters.lokal       = !!document.getElementById('f-lokal')?.checked;
    state.filters.preiswert   = !!document.getElementById('f-preiswert')?.checked;
    renderNearby();
  });
});

/* ---- Standort ---- */
const btnRefresh = document.getElementById('btn-refresh');
if (btnRefresh) btnRefresh.addEventListener('click', () => getLocation(true));

async function getLocation(watch = false) {
  if (!navigator.geolocation) { showError('Geolocation wird nicht unterstützt.'); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
    updateUIAfterLocation();
    if (watch) {
      navigator.geolocation.watchPosition((p) => {
        state.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
        updateUIAfterLocation();
      }, (err)=>showError(err.message), { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    }
  }, (err) => {
    showError('Standort nicht verfügbar: ' + err.message);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}

async function updateUIAfterLocation() {
  renderMap();
  await fetchWeather();
  computeQualityScores();
  computeRecommendations();
  renderNearby();
  renderBasecamps();
  renderWeatherPanel();
}

/* ---- Wetter (Open-Meteo) ---- */
async function fetchWeather() {
  if (!state.pos) return;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(state.pos.lat));
  url.searchParams.set('longitude', String(state.pos.lon));
  url.searchParams.set('daily','temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant');
  url.searchParams.set('timezone','auto');
  try { const resp = await fetch(url.toString()); if (!resp.ok) throw new Error('Wetter HTTP ' + resp.status); state.weather = await resp.json(); }
  catch (e) { showError('Wetter fehlgeschlagen'); }
}

/* ---- Karte (Leaflet) ---- */
let map, userMarker, markersLayer;
function initMapOnce() {
  if (map) return;
  if (!window.L) { showError('Kartenbibliothek nicht geladen'); return; }
  map = L.map('map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  renderMap();
}
function renderMap() {
  if (!map) return;
  markersLayer.clearLayers();
  const iconMap = { culture:'\u{1F3DB}\uFE0F', beach:'\u{1F3D6}\uFE0F', hike:'\u{1F97E}', swim:'\u{1F4A7}', camperFree:'\u{1F690}', camperCampground:'⛺', restaurant:'\u{1F37D}\uFE0F', snorkel:'\u{1F93F}', fishing:'\u{1F3A3}' };
  state.spots.forEach(s => {
    const m = L.marker([s.lat, s.lon]).addTo(markersLayer);
    const badges = badgeTextFor(s).map(b=>`<span class="badge">${b}</span>`).join(' ');
    const html = `<div class="card"><b>${escapeHtml(s.name)}</b><br/>${escapeHtml(s.details||'')}` +
      `<div class="badges" style="margin-top:6px">${badges}</div>`+
      `<div style="margin-top:8px"><button class="btn" onclick="Friolika.showDetail('${s.id}')">Details</button></div>`+
      `</div>`;
    m.bindPopup(html);
    m.setIcon(L.divIcon({className:'', html:`<div style="font-size:20px">${iconMap[s.category]||'📍'}</div>`}));
  });
  if (state.pos) {
    if (!userMarker) userMarker = L.marker([state.pos.lat, state.pos.lon], {opacity:0.6}).addTo(map);
    else userMarker.setLatLng([state.pos.lat, state.pos.lon]);
    map.setView([state.pos.lat, state.pos.lon], 11, { animate: true });
  }
}

/* ---- Qualität: Schnorcheln/Angeln ---- */
function computeQualityScores(){
  const q = {}; if(!state.weather || !state.weather.daily) { state.quality=q; return; }
  const d = state.weather.daily; const wind = (d.wind_speed_10m_max && d.wind_speed_10m_max[0]) || 0; // m/s
  state.spots.forEach(s=>{
    const key = s.id; q[key] = q[key]||{};
    const rocky = /fels|rock|skala|reef|klippe|cliff/i.test(`${s.name} ${s.details||''}`);
    let snork = 50; if (wind < 4) snork += 30; else if (wind < 6) snork += 15; else if (wind > 9) snork -= 20; if (rocky) snork += 10; if (s.category==='snorkel') snork += 10; snork = Math.max(0, Math.min(100, snork)); q[key].snorkelScore = snork;
    let fish = 50; if (wind >= 3 && wind <= 8) fish += 20; if (wind > 10) fish -= 15; if (rocky || /mole|breakwater|pier|hafen/i.test(`${s.name} ${s.details||''}`)) fish += 10; if (s.category==='fishing') fish += 10; fish = Math.max(0, Math.min(100, fish)); q[key].fishingScore = fish;
  });
  state.quality = q;
}

/* ---- Empfehlungen & Basecamps ---- */
function computeRecommendations() {
  const centers = gridAround(state.pos || {lat:37.5, lon:22.4}, 20, 80);
  const results = centers.map(c => {
    const spotsAround = state.spots.filter(s => distKm(c.lat,c.lon,s.lat,s.lon) < 25);
    if (spotsAround.length===0) return null;
    const cats = new Set(spotsAround.map(s=>s.category));
    let score = 0; const reasons = [];
    const variety = Math.min(100, cats.size*18); score += Math.round(variety*0.25);
    if (cats.size>=4) reasons.push('Vielseitige Aktivitäten in <25\u202Fkm');
    const hasFood = spotsAround.some(s=>s.category==='restaurant');
    const hasCamp = spotsAround.some(s=>s.category==='camperFree'||s.category==='camperCampground');
    const hasWater = spotsAround.some(s=>['beach','swim','snorkel'].includes(s.category));
    let supply = 0; if (hasFood) supply+=35; if (hasCamp) supply+=35; if (hasWater) supply+=30; score += Math.round(supply*0.15); if (supply>=60) reasons.push('Gute Versorgung & Stellplätze');
    const kidSpots = spotsAround.filter(s=> (s.category==='beach' && (s.hasShade || (s.tags||[]).some(t=>/flach/i.test(t)))) || (s.category==='hike' && (s.estDurationMin||0)<=240));
    const kidScore = Math.min(100, kidSpots.length*15); score += Math.round(kidScore*0.10); if (kidScore>=30) reasons.push('Familienfreundliche Spots vorhanden');
    if (state.weather && state.weather.daily) { const d = state.weather.daily; const rainMax = (d.precipitation_probability_max||[]).slice(0,3).reduce((a,b)=>Math.max(a, b||0),0); const windMax = (d.wind_speed_10m_max||[]).slice(0,3).reduce((a,b)=>Math.max(a, b||0),0); let wScore = 100; if (rainMax>=60) wScore -= 40; if (windMax>=9) wScore -= 30; score += Math.round(Math.max(0,wScore)*0.35); reasons.push(wScore>=70 ? 'Stabiles Wetterfenster (3 Tage)' : 'Wetter gemischt – Alternativen in der Nähe'); }
    score = Math.min(100, Math.max(20, score));
    const plan = buildDayPlan(c, spotsAround);
    return { center:c, label:'Gutes Basislager', score, reasons, sample:spotsAround.slice(0,8), plan };
  }).filter(x=>x).sort((a,b)=>b.score-a.score).slice(0,5);
  state.basecamps = results;
}

/* ---- Mehr‑Tage‑Tagespläne je Basecamp ---- */
function buildDayPlan(center, spots){
  const within = (km, cats=[])=>spots.filter(s=>distKm(center.lat,center.lon,s.lat,s.lon)<=km && (cats.length?cats.includes(s.category):true));
  const beaches = within(20, ['beach','snorkel']).sort((a,b)=> (scoreFor(a,'snorkel')-scoreFor(b,'snorkel')) ).reverse();
  const culture = within(25, ['culture']);
  const hikes = within(25, ['hike']).filter(s=>(s.estDurationMin||0)<=180);
  const food = within(25, ['restaurant']).filter(isLocalRestaurant);
  const days = [];
  for(let d=0; d<3; d++){
    const beach = beaches.length? beaches[d%beaches.length]: null;
    const cult  = culture.length?  culture[d%culture.length]:   null;
    const hike  = hikes.length?    hikes[d%hikes.length]:       null;
    const eat   = food.length?     food[d%food.length]:         null;
    if (!beach && !cult && !hike && !eat) break;
    days.push({ morning: beach, noon: cult, afternoon: hike, evening: eat });
  }
  return days;
}
function scoreFor(s, kind){ const q = state.quality[s.id]||{}; return kind==='snorkel'? (q.snorkelScore||0) : (q.fishingScore||0); }

/* ---- Render Nearby & Basecamps ---- */
function renderNearby() {
  const list = document.getElementById('nearby-list'); if (!list) return; list.innerHTML = '';
  if (!state.pos) { list.innerHTML = '<li class="msg">Tippe 🔄 für Standort.</li>'; return; }
  let arr = state.spots.map(s => ({s, d: distKm(state.pos.lat,state.pos.lon,s.lat,s.lon)}));
  const F = state.filters;
  arr = arr.filter(o => {
    const s = o.s; if (o.d > 60) return false;
    if (F.freistehen && s.category!=='camperFree') return false;
    if (F.kinderwagen && s.category==='hike' && (s.estDurationMin||999)>240) return false;
    if (F.schattig && s.category==='beach' && !s.hasShade) return false;
    if ((F.lokal || F.preiswert) && s.category==='restaurant') {
      if (F.lokal && !isLocalRestaurant(s)) return false;
      if (F.preiswert && !isBudgetRestaurant(s)) return false;
    }
    return true;
  }).sort((a,b)=>a.d-b.d);
  if (arr.length===0) { list.innerHTML = '<li class="msg">Keine Spots im Umkreis (noch). Importiere oder füge manuell hinzu.</li>'; return; }
  arr.forEach(({s,d}) => {
    const li = document.createElement('li'); li.className='card';
    const badges = badgeTextFor(s).map(b=>`<span class="badge">${b}</span>`).join(' ');
    const qual = qualityBadges(s);
    li.innerHTML = `<b>${escapeHtml(s.name)}</b> <span class="badge">${s.category}</span> <span class="badge">${d.toFixed(1)} km</span>
      <div class="badges">${badges} ${qual}</div>
      <div class="muted">${escapeHtml(s.details||'')}</div>
      <div style="margin-top:8px"><button class="btn" data-id="${s.id}">Details</button></div>`;
    li.querySelector('button').addEventListener('click', () => Friolika.showDetail(s.id));
    list.appendChild(li);
  });
}
function qualityBadges(s){
  const q = state.quality[s.id]||{}; let out='';
  if (s.category==='snorkel'||s.category==='beach'){
    if ((q.snorkelScore||0)>=75) out+=`<span class="badge">🤿 heute sehr gut</span>`;
    else if ((q.snorkelScore||0)>=60) out+=`<span class="badge">🤿 gut</span>`;
  }
  if (s.category==='fishing'||s.category==='beach'){
    if ((q.fishingScore||0)>=70) out+=` <span class="badge">🎣 gut</span>`;
  }
  return out;
}
function renderBasecamps() {
  const ul = document.getElementById('basecamp-list'); if (!ul) return; ul.innerHTML='';
  (state.basecamps||[]).forEach((b,idx)=>{
    const li = document.createElement('li'); li.className='card';
    const planId = `plan-${idx}`;
    li.innerHTML = `<b>Basecamp: ${b.label}</b> <span class="badge">Score ${b.score}</span>
      <ul style="margin:6px 0 8px 18px">${b.reasons.slice(0,3).map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul>
      <div class="badges">${(b.sample||[]).map(s=>`<span class="badge">${escapeHtml(s.name)}</span>`).join(' ')}</div>
      <div style="margin-top:8px"><button class="btn" data-plan="${planId}">Tagespläne anzeigen</button></div>
      <div id="${planId}" class="card" style="margin-top:8px; display:none;"></div>`;
    li.querySelector('button[data-plan]').addEventListener('click', (ev)=>{
      const div = document.getElementById(planId); if (!div) return; const open = div.style.display!=='none';
      if (open) { div.style.display='none'; ev.target.textContent='Tagespläne anzeigen'; }
      else { div.innerHTML = renderDayPlanHtml(b.plan); div.style.display='block'; ev.target.textContent='Tagespläne ausblenden'; }
    });
    ul.appendChild(li);
  });
}
function renderDayPlanHtml(days){
  if (!days || days.length===0) return '<div class="msg">Noch keine Vorschläge.</div>';
  return days.map((d,i)=>{
    const row = (label, s)=> s? `<div><b>${label}:</b> ${escapeHtml(s.name)}</div>` : '';
    return `<div style="margin-bottom:8px"><b>Tag ${i+1}</b>
      ${row('Vormittag (Wasser)', d.morning)}
      ${row('Mittag (Kultur)', d.noon)}
      ${row('Nachmittag (kurze Wanderung)', d.afternoon)}
      ${row('Abends (Taverne)', d.evening)}
    </div>`;
  }).join('');
}
function renderWeatherPanel() {
  const w = document.getElementById('weather'); const next = document.getElementById('where-next'); if (!w||!next) return;
  if (!state.weather || !state.weather.daily) { w.innerHTML = '<div class="msg">Warte auf Wetterdaten …</div>'; next.innerHTML=''; return; }
  const d = state.weather.daily; const days = (d.time||[]).slice(0,3);
  w.innerHTML = `<div class="card"><b>Wetter (3 Tage)</b>${
    days.map((date,i)=>`<div>${date}: max ${Math.round(d.temperature_2m_max[i])}°C, min ${Math.round(d.temperature_2m_min[i])}°C, Regen ${(d.precipitation_probability_max[i]||0)}%, Wind ${Math.round(d.wind_speed_10m_max[i]||0)} m/s</div>`).join('')
  }</div>`;
  next.innerHTML = `<div><b>Wohin weiter?</b><br/>Suche windgeschützte Leeseiten (Buchten, Halbinseln). Bei stärkerem Wind sind Schnorchel-Spots im Lee besser. Ich markiere geeignete Spots mit 🤿/🎣‑Badges.</div>`;
}

/* ---- Detail-Modal (Guide, Deeplinks) ---- */
const Friolika = {
  showDetail: (id) => {
    const s = state.spots.find(x=>x.id===id); if (!s) return;
    document.getElementById('detail-title').textContent = s.name;
    document.getElementById('detail-desc').textContent = s.details || '';
    document.getElementById('detail-badges').innerHTML = badgeTextFor(s).map(b=>`<span class="badge">${b}</span>`).join(' ') + ' ' + qualityBadges(s);
    document.getElementById('open-apple').href = `http://maps.apple.com/?ll=${s.lat},${s.lon}&q=${encodeURIComponent(s.name)}`;
    document.getElementById('open-google').href = `https://www.google.com/maps?q=${s.lat},${s.lon}(${encodeURIComponent(s.name)})`;
    const wikiBox = document.getElementById('wiki'); wikiBox.innerHTML = '<div class="msg">Lade Guide‑Information …</div>';
    fetchGuide(s.name).then(html => { wikiBox.innerHTML = html; }).catch(()=>{ wikiBox.innerHTML = '<div class="msg">Keine Hintergrundinfos gefunden.</div>'; });
    document.getElementById('detail-modal').classList.remove('hidden');
  }
};
window.Friolika = Friolika;
const detailClose = document.getElementById('detail-close'); if (detailClose) detailClose.addEventListener('click', ()=>document.getElementById('detail-modal').classList.add('hidden'));
const detailModal = document.getElementById('detail-modal'); if (detailModal) detailModal.addEventListener('click', (e)=>{ if (e.target.id==='detail-modal') detailModal.classList.add('hidden'); });

async function fetchGuide(name) {
  const de = `https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
  const en = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
  try { const r = await fetch(de, {headers:{'accept':'application/json'}}); if (r.ok) return wikiHtml(await r.json(), 'de'); } catch{}
  try { const r = await fetch(en, {headers:{'accept':'application/json'}}); if (r.ok) return wikiHtml(await r.json(), 'en'); } catch{}
  throw new Error('no summary');
}
function wikiHtml(j, lang) {
  const title = j.title || 'Wikipedia'; const extract = j.extract || '';
  const url = (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || (lang==='de'?`https://de.wikipedia.org/wiki/${encodeURIComponent(title)}`:`https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`);
  return `<div><b>Guide</b><div style="margin-top:6px">${escapeHtml(extract)}</div><div style="margin-top:6px"><a href="${url}" target="_blank" rel="noopener">Mehr auf Wikipedia</a></div></div>`;
}

/* ---- Restaurant-Heuristiken ---- */
function isLocalRestaurant(s){
  const t = `${s.name} ${s.details||''}`.toLowerCase();
  const localWords = ['taverna','tavern','ouzeri','mezed','psarotaverna','kafeneio','μαγειρείο'];
  const touristHints = ['tourist','touristy','all inclusive'];
  if (touristHints.some(w=>t.includes(w))) return false;
  return localWords.some(w=>t.includes(w)) || /[α-ωΑ-Ω]/.test(t);
}
function isBudgetRestaurant(s){
  if (s.costLevel && s.costLevel <= 2) return true;
  const t = `${s.details||''}`; const euros = (t.match(/€+/g)||[]).sort((a,b)=>b.length-a.length)[0];
  if (!euros) return true; return euros.length <= 2;
}

/* ---- Filter Badges ---- */
function badgeTextFor(s) {
  const arr = [];
  if (s.category==='hike' && (s.estDurationMin||0)<=240) arr.push('Kraxe ok ≤ 4h');
  if (s.category==='beach' && s.hasShade) arr.push('Schatten');
  if (s.category==='camperFree') arr.push('frei stehen');
  if (s.category==='snorkel') arr.push('🤿 schnorcheln');
  if (s.category==='fishing') arr.push('🎣 angeln');
  if (s.category==='restaurant' && isLocalRestaurant(s)) arr.push('lokal');
  if (s.category==='restaurant' && isBudgetRestaurant(s)) arr.push('€-€€');
  return arr;
}

/* ---- Import/Export ---- */
const fileInput = document.getElementById('file-input'); if (fileInput) fileInput.addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; if (!f) return; const text = await f.text();
  let added = []; if (f.name.toLowerCase().endsWith('.gpx')) added = importGPX(text); else added = importCSV(text);
  mergeSpots(added, sourceLabel(f.name));
});
const btnPaste = document.getElementById('btn-paste'); if (btnPaste) btnPaste.addEventListener('click', async () => {
  try { const t = await navigator.clipboard.readText(); if (!t) { document.getElementById('import-msg').textContent = 'Zwischenablage leer.'; return; }
    const spots = parseTextForSpots(t); if (spots.length===0) { document.getElementById('import-msg').textContent = 'Keine Koordinaten/Links erkannt. Bitte direkt Koordinaten einfügen (lat, lon).'; return; }
    mergeSpots(spots, 'Paste');
  } catch (e) { document.getElementById('import-msg').textContent = 'Zugriff auf Zwischenablage nicht möglich. Kopiere & nutze „Manuell hinzufügen“.'; }
});
const btnAdd = document.getElementById('btn-add-manual'); if (btnAdd) btnAdd.addEventListener('click', async () => {
  const name = prompt('Name des Spots (z. B. Freier Stellplatz an Bucht)'); if (!name) return;
  const lat = parseFloat(prompt('Breite (lat), z. B. 36.1234')||''); if (Number.isNaN(lat)) return;
  const lon = parseFloat(prompt('Länge (lon), z. B. 22.5678')||''); if (Number.isNaN(lon)) return;
  const category = prompt('Kategorie (culture,beach,hike,swim,camperFree,camperCampground,restaurant,snorkel,fishing)','camperFree') || 'camperFree';
  const details = prompt('Details (optional)') || '';
  mergeSpots([{ id: makeId(name,lat,lon,category), name, lat, lon, category, details }], 'Manual');
});
const btnCSV = document.getElementById('btn-export-csv'); if (btnCSV) btnCSV.addEventListener('click', ()=> downloadFile('spots.csv', toCSV(state.spots)));
const btnGPX = document.getElementById('btn-export-gpx'); if (btnGPX) btnGPX.addEventListener('click', ()=> downloadFile('spots.gpx', toGPX(state.spots)));

function downloadFile(filename, content){
  const blob = new Blob([content], {type: 'text/plain;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

function mergeSpots(added, source='Import') {
  let mapById = new Map(state.spots.map(s=>[s.id,s]));
  added.forEach(s => { s.source = s.source || source; mapById.set(s.id, Object.assign({}, mapById.get(s.id)||{}, s)); });
  state.spots = Array.from(mapById.values()); storage.save();
  document.getElementById('import-msg').textContent = `Import ok: ${added.length} Punkte.`;
  renderSpotList(); updateUIAfterLocation();
}
function renderSpotList() {
  const ul = document.getElementById('spot-list'); if (!ul) return; ul.innerHTML='';
  state.spots.forEach(s => { const li = document.createElement('li'); li.className='card'; li.innerHTML = `<b>${escapeHtml(s.name)}</b> <span class="badge">${s.category}</span><div class="muted">${escapeHtml(s.details||'')}</div>`; ul.appendChild(li); });
}

/* ---- Parser & Utils ---- */
function sourceLabel(name) { if (!name) return 'Import'; const lower = name.toLowerCase(); if (lower.endsWith('.gpx')) return 'GPX'; if (lower.endsWith('.csv')) return 'CSV'; return 'Import'; }
function importGPX(text) {
  const wptRe = /<wpt[^>]*lat=\"([^\"]+)\"[^>]*lon=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/wpt>/g; const nameRe = /<name>([\s\S]*?)<\/name>/; const descRe = /<desc>([\s\S]*?)<\/desc>/;
  const out = []; let m; while ((m = wptRe.exec(text))) { const lat = parseFloat(m[1]); const lon = parseFloat(m[2]); const inner = m[3]; const nm = nameRe.exec(inner); const ds = descRe.exec(inner); const name = (nm ? nm[1] : 'Importierter Punkt').trim(); const desc = ds ? ds[1].trim() : '';
    const cat = inferCategory(name + ' ' + (desc||'')); out.push({ id: makeId(name,lat,lon,cat), name, lat, lon, category:cat, details:desc }); }
  return out;
}
function importCSV(text) {
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length); const out = []; let header=false; if (/name.*lat.*lon/i.test(lines[0]||'')) { header=true; }
  lines.forEach((l,i) => { if (header && i===0) return; const cols = l.split(',').map(c=>c.trim()); if (cols.length<3) return; const name = cols[0]; const lat = parseFloat(cols[1]); const lon = parseFloat(cols[2]); if (Number.isNaN(lat)||Number.isNaN(lon)) return; const category = (cols[3]||'culture').trim(); const details = cols[4]||''; out.push({ id: makeId(name,lat,lon,category), name, lat, lon, category, details }); });
  return out;
}
function toCSV(spots){
  const esc = (s)=>'"'+String(s||'').replace(/"/g,'""')+'"';
  const rows = [['name','lat','lon','category','details']].concat(spots.map(s=>[s.name,s.lat,s.lon,s.category,s.details||'']));
  return rows.map(r=>r.map(esc).join(',')).join('\n');
}
function toGPX(spots){
  const header = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FriOlKa" xmlns="http://www.topografix.com/GPX/1/1">';
  const wpts = spots.map(s=>`<wpt lat="${s.lat}" lon="${s.lon}"><name>${escapeXml(s.name)}</name>${s.details?`<desc>${escapeXml(s.details)}</desc>`:''}</wpt>`).join('');
  return header + wpts + '</gpx>';
}
function escapeXml(s){ return String(s||'').replace(/[<>&"']/g, (c)=>({ '<':'&lt;','>':'&gt;','&':'&amp;','\"':'&quot;','\'':'&apos;' }[c]||c)); }
function parseTextForSpots(t) {
  const out = []; let m;
  const coordsRe = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g; while ((m = coordsRe.exec(t))) { const lat = parseFloat(m[1]); const lon = parseFloat(m[2]); out.push({ id: makeId(`${lat},${lon}`,lat,lon,'camperFree'), name:`Punkt ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'Hinzugefügt via Einfügen' }); }
  const llRe = /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/g; while ((m = llRe.exec(t))) { const lat = parseFloat(m[1]); const lon = parseFloat(m[2]); out.push({ id: makeId(`${lat},${lon}`,lat,lon,'camperFree'), name:`Karte ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'Aus Kartenlink' }); }
  const atRe = /@(-?\d+\.\d+),(-?\d+\.\d+)/g; while ((m = atRe.exec(t))) { const lat = parseFloat(m[1]); const lon = parseFloat(m[2]); out.push({ id: makeId(`${lat},${lon}`,lat,lon,'camperFree'), name:`Karte ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'Aus Kartenlink' }); }
  return out;
}
function inferCategory(text) {
  const t = String(text||'').toLowerCase();
  if (t.includes('taverna') || t.includes('restaurant') || t.includes('ouz')) return 'restaurant';
  if (t.includes('camp') || t.includes('stellplatz')) return 'camperCampground';
  if (t.includes('free') || t.includes('frei')) return 'camperFree';
  if (t.includes('beach') || t.includes('strand')) return 'beach';
  if (t.includes('snork') || t.includes('schnorch')) return 'snorkel';
  if (t.includes('fish') || t.includes('angel')) return 'fishing';
  if (t.includes('hike') || t.includes('wander') || t.includes('trail')) return 'hike';
  if (t.includes('swim') || t.includes('baden')) return 'swim';
  return 'culture';
}
function makeId(name,lat,lon,cat) { const base = `${name}|${Number(lat).toFixed(6)}|${Number(lon).toFixed(6)}|${cat}`; let h = 0; for (let i=0;i<base.length;i++) { h=((h<<5)-h)+base.charCodeAt(i); h|=0; } return String(h); }
function distKm(lat1,lon1,lat2,lon2) { const R=6371; const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1); const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
function toRad(d){return d*Math.PI/180}
function gridAround(c, cellKm, radiusKm) { const latDegPerKm = 1/110.574; const lonDegPerKm = 1/(111.320*Math.cos(((c.lat||37)*Math.PI/180))); const steps = Math.max(1, Math.floor(radiusKm/cellKm)); const out = []; for (let i=-steps;i<=steps;i++) for (let j=-steps;j<=steps;j++) { out.push({lat:(c.lat||37)+i*cellKm*latDegPerKm, lon:(c.lon||22)+j*cellKm*lonDegPerKm}); } return out; }
function escapeHtml(s){return String(s).replace(/[&<>"']/g, (c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

/* ---- Start ---- */
document.addEventListener('DOMContentLoaded', () => {
  renderSpotList();
  const params = new URLSearchParams(location.search);
  if (params.get('refresh')==='1') getLocation(false);
});
