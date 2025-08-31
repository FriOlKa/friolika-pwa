/* FriOlKa PWA – Grundlogik */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---- PWA Setup ---- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}

/* ---- State ---- */
let state = {
  pos: null,
  spots: [],      // importierte + manuell hinzugefügte Punkte
  weather: null,
  filters: { kinderwagen:false, schattig:false, freistehen:false },
  basecamps: []
};

const storage = {
  load() {
    try {
      const s = JSON.parse(localStorage.getItem('friolika-state') || '{}');
      if (s.spots) state.spots = s.spots;
    } catch {}
  },
  save() {
    localStorage.setItem('friolika-state', JSON.stringify({ spots: state.spots }));
  }
};
storage.load();

/* ---- Tabs ---- */
$$('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $$('.tab').forEach(t => t.classList.remove('active'));
    $(`#tab-${tab}`).classList.add('active');
    if (tab === 'map') setTimeout(initMapOnce, 0);
  });
});

/* ---- Standort ---- */
$('#btn-refresh').addEventListener('click', () => getLocation(true));

async function getLocation(watch = false) {
  if (!navigator.geolocation) { alert('Geolocation wird nicht unterstützt.'); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
    updateUIAfterLocation();
    if (watch) {
      navigator.geolocation.watchPosition((p) => {
        state.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
        updateUIAfterLocation();
      }, console.warn, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    }
  }, (err) => {
    alert('Standort nicht verfügbar: ' + err.message);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}

async function updateUIAfterLocation() {
  renderMap();
  await fetchWeather();
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
  url.searchParams.set('daily','temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max');
  url.searchParams.set('timezone','auto');

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error('Wetter HTTP ' + resp.status);
    state.weather = await resp.json();
  } catch (e) {
    console.warn('Wetter fehlgeschlagen', e);
  }
}

/* ---- Karte (Leaflet) ---- */
let map, userMarker, markersLayer;
function initMapOnce() {
  if (map) return;
  map = L.map('map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  renderMap();
}
function renderMap() {
  if (!map) return;
  markersLayer.clearLayers();
  const iconMap = {
    culture: '🏛️', beach:'🏖️', hike:'🥾', swim:'💧', camperFree:'🚐', camperCampground:'⛺',
    restaurant:'🍽️', snorkel:'🤿', fishing:'🎣'
  };
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

/* ---- Empfehlungen ---- */
function computeRecommendations() {
  const centers = gridAround(state.pos || {lat:37.5, lon:22.4}, 20, 80);
  const results = centers.map(c => {
    const spotsAround = state.spots.filter(s => distKm(c.lat,c.lon,s.lat,s.lon) < 25);
    if (spotsAround.length===0) return null;
    const cats = new Set(spotsAround.map(s=>s.category));
    let score = 0; const reasons = [];
    const variety = Math.min(100, cats.size*18);
    score += Math.round(variety*0.25);
    if (cats.size>=4) reasons.push('Vielseitige Aktivitäten in <25 km');

    const hasFood = spotsAround.some(s=>s.category==='restaurant');
    const hasCamp = spotsAround.some(s=>s.category==='camperFree'||s.category==='camperCampground');
    const hasWater = spotsAround.some(s=>['beach','swim','snorkel'].includes(s.category));
    let supply = 0; if (hasFood) supply+=35; if (hasCamp) supply+=35; if (hasWater) supply+=30;
    score += Math.round(supply*0.15);
    if (supply>=60) reasons.push('Gute Versorgung & Stellplätze');

    const kidSpots = spotsAround.filter(s=> (s.category==='beach' && (s.hasShade || (s.tags||[]).some(t=>/flach/i.test(t)))) ||
                                            (s.category==='hike' && (s.estDurationMin||0)<=240));
    const kidScore = Math.min(100, kidSpots.length*15);
    score += Math.round(kidScore*0.10);
    if (kidScore>=30) reasons.push('Familienfreundliche Spots vorhanden');

    if (state.weather?.daily) {
      const d = state.weather.daily;
      const rainMax = (d.precipitation_probability_max||[]).slice(0,3).reduce((a,b)=>Math.max(a, b||0),0);
      const windMax = (d.wind_speed_10m_max||[]).slice(0,3).reduce((a,b)=>Math.max(a, b||0),0);
      let wScore = 100;
      if (rainMax>=60) wScore -= 40;
      if (windMax>=9) wScore -= 30;
      score += Math.round(Math.max(0,wScore)*0.35);
      reasons.push(wScore>=70 ? 'Stabiles Wetterfenster (3 Tage)' : 'Wetter gemischt – Alternativen in der Nähe');
    }
    score = Math.min(100, Math.max(20, score));
    return { center:c, label:'Gutes Basislager', score, reasons, sample:spotsAround.slice(0,8) };
  }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,5);
  state.basecamps = results;
}

/* ---- Render Nearby & Basecamps ---- */
function renderNearby() {
  const list = $('#nearby-list'); list.innerHTML = '';
  if (!state.pos) { list.innerHTML = '<li class="msg">Tippe 🔄 für Standort.</li>'; return; }
  const in60 = state.spots
    .map(s => ({s, d: distKm(state.pos.lat,state.pos.lon,s.lat,s.lon)}))
    .filter(o => o.d <= 60)
    .sort((a,b)=>a.d-b.d);
  if (in60.length===0) { list.innerHTML = '<li class="msg">Keine Spots im Umkreis (noch). Importiere oder füge manuell hinzu.</li>'; return; }
  in60.forEach(({s,d}) => {
    const li = document.createElement('li'); li.className='card';
    const badges = badgeTextFor(s).map(b=>`<span class="badge">${b}</span>`).join(' ');
    li.innerHTML = `<b>${escapeHtml(s.name)}</b> <span class="badge">${s.category}</span> <span class="badge">${d.toFixed(1)} km</span>
      <div class="badges">${badges}</div>
      <div class="muted">${escapeHtml(s.details||'')}</div>
      <div style="margin-top:8px"><button class="btn" data-id="${s.id}">Details</button></div>`;
    li.querySelector('button').addEventListener('click', () => Friolika.showDetail(s.id));
    list.appendChild(li);
  });
}
function renderBasecamps() {
  const ul = $('#basecamp-list'); ul.innerHTML='';
  (state.basecamps||[]).forEach(b=>{
    const li = document.createElement('li'); li.className='card';
    li.innerHTML = `<b>Basecamp: ${b.label}</b> <span class="badge">Score ${b.score}</span>
      <ul style="margin:6px 0 8px 18px">${b.reasons.slice(0,3).map(r=>`<li>${r}</li>`).join('')}</ul>
      <div class="badges">${(b.sample||[]).map(s=>`<span class="badge">${escapeHtml(s.name)}</span>`).join(' ')}</div>`;
    ul.appendChild(li);
  });
}
function renderWeatherPanel() {
  const w = $('#weather'); const next = $('#where-next');
  if (!state.weather?.daily) { w.innerHTML = '<div class="msg">Warte auf Wetterdaten …</div>'; next.innerHTML=''; return; }
  const d = state.weather.daily;
  const days = d.time?.slice(0,3)||[];
  w.innerHTML = `<div class="card"><b>Wetter (3 Tage)</b>${
    days.map((date,i)=>`
      <div>${date}:
        max ${Math.round(d.temperature_2m_max[i])}°C,
        min ${Math.round(d.temperature_2m_min[i])}°C,
        Regen ${(d.precipitation_probability_max[i]??0)}%,
        Wind ${Math.round(d.wind_speed_10m_max[i]??0)} m/s
      </div>`).join('')
  }</div>`;
  next.innerHTML = `<div><b>Wohin weiter?</b><br/>Tipp: Suche windgeschützte Leeseiten (Buchten an der der Wind <i>ablandig</i> ist). Ich markiere Schnorchel/Angel-Spots mit passenden Badges.</div>`;
}

/* ---- Detail-Modal (Guide, Deeplinks) ---- */
const Friolika = {
  showDetail: (id) => {
    const s = state.spots.find(x=>x.id===id);
    if (!s) return;
    $('#detail-title').textContent = s.name;
    $('#detail-desc').textContent = s.details || '';
    $('#detail-badges').innerHTML = badgeTextFor(s).map(b=>`<span class="badge">${b}</span>`).join(' ');
    const apple = `http://maps.apple.com/?ll=${s.lat},${s.lon}&q=${encodeURIComponent(s.name)}`;
    const google = `https://www.google.com/maps?q=${s.lat},${s.lon}(${encodeURIComponent(s.name)})`;
    $('#open-apple').href = apple; $('#open-google').href = google;
    $('#wiki').innerHTML = '<div class="msg">Lade Guide‑Information …</div>';
    fetchGuide(s.name).then(html => { $('#wiki').innerHTML = html; }).catch(()=>{
      $('#wiki').innerHTML = '<div class="msg">Keine Hintergrundinfos gefunden.</div>';
    });
    $('#detail-modal').classList.remove('hidden');
  }
};
window.Friolika = Friolika;
$('#detail-close').addEventListener('click', ()=>$('#detail-modal').classList.add('hidden'));
$('#detail-modal').addEventListener('click', (e)=>{ if (e.target.id==='detail-modal') $('#detail-modal').classList.add('hidden'); });

async function fetchGuide(name) {
  // Versuche zuerst deutschsprachige Zusammenfassung, fallback englisch
  const de = `https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
  const en = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
  try {
    const r = await fetch(de, {headers:{'accept':'application/json'}});
    if (r.ok) {
      const j = await r.json();
      return wikiHtml(j, 'de');
    }
  } catch {}
  try {
    const r = await fetch(en, {headers:{'accept':'application/json'}});
    if (r.ok) {
      const j = await r.json();
      return wikiHtml(j, 'en');
    }
  } catch {}
  throw new Error('no summary');
}
function wikiHtml(j, lang) {
  const title = j.title || 'Wikipedia';
  const extract = j.extract || '';
  const url = j.content_urls?.desktop?.page || (lang==='de'?`https://de.wikipedia.org/wiki/${encodeURIComponent(title)}`:`https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`);
  return `<div><b>Guide</b><div style="margin-top:6px">${escapeHtml(extract)}</div><div style="margin-top:6px"><a href="${url}" target="_blank" rel="noopener">Mehr auf Wikipedia</a></div></div>`;
}

/* ---- Filter Badges ---- */
function badgeTextFor(s) {
  const arr = [];
  if (s.category==='hike' && (s.estDurationMin||0)<=240) arr.push('Kraxe ok ≤ 4h');
  if (s.category==='beach' && s.hasShade) arr.push('Schatten');
  if (s.category==='camperFree') arr.push('frei stehen');
  if (s.category==='snorkel') arr.push('🤿 schnorcheln');
  if (s.category==='fishing') arr.push('🎣 angeln');
  return arr;
}

/* ---- Import: Datei (GPX/CSV), Paste, Manuell ---- */
$('#file-input').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  const text = await f.text();
  let added = [];
  if (f.name.toLowerCase().endsWith('.gpx')) {
    added = importGPX(text);
  } else {
    added = importCSV(text);
  }
  mergeSpots(added, sourceLabel(f.name));
});

$('#btn-paste').addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) { $('#import-msg').textContent = 'Zwischenablage leer.'; return; }
    const spots = parseTextForSpots(t);
    if (spots.length===0) { $('#import-msg').textContent = 'Keine Koordinaten/Links erkannt. Bitte direkt Koordinaten einfügen (lat, lon).'; return; }
    mergeSpots(spots, 'Paste');
  } catch (e) {
    $('#import-msg').textContent = 'Zugriff auf Zwischenablage nicht möglich. Kopiere & nutze „Manuell hinzufügen“.';
  }
});

$('#btn-add-manual').addEventListener('click', async () => {
  const name = prompt('Name des Spots (z. B. Freier Stellplatz an Bucht)'); if (!name) return;
  const lat = parseFloat(prompt('Breite (lat), z. B. 36.1234')||''); if (Number.isNaN(lat)) return;
  const lon = parseFloat(prompt('Länge (lon), z. B. 22.5678')||''); if (Number.isNaN(lon)) return;
  const category = prompt('Kategorie (culture,beach,hike,swim,camperFree,camperCampground,restaurant,snorkel,fishing)','camperFree') || 'camperFree';
  const details = prompt('Details (optional)') || '';
  mergeSpots([{ id: makeId(name,lat,lon,category), name, lat, lon, category, details }], 'Manual');
});

function mergeSpots(added, source='Import') {
  let mapById = new Map(state.spots.map(s=>[s.id,s]));
  added.forEach(s => {
    s.source = s.source || source;
    mapById.set(s.id, {...mapById.get(s.id), ...s});
  });
  state.spots = Array.from(mapById.values());
  storage.save();
  $('#import-msg').textContent = `Import ok: ${added.length} Punkte.`;
  renderSpotList();
  renderNearby(); renderMap(); computeRecommendations(); renderBasecamps();
}
function renderSpotList() {
  const ul = $('#spot-list'); ul.innerHTML='';
  state.spots.forEach(s => {
    const li = document.createElement('li'); li.className='card';
    li.innerHTML = `<b>${escapeHtml(s.name)}</b> <span class="badge">${s.category}</span>
      <div class="muted">${escapeHtml(s.details||'')}</div>`;
    ul.appendChild(li);
  });
}

/* ---- Parser & Utils ---- */
function sourceLabel(name) {
  if (!name) return 'Import';
  const lower = name.toLowerCase();
  if (lower.endsWith('.gpx')) return 'GPX';
  if (lower.endsWith('.csv')) return 'CSV';
  return 'Import';
}
function importGPX(text) {
  const wptRe = /<wpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/g;
  const nameRe = /<name>([\s\S]*?)<\/name>/; const descRe = /<desc>([\s\S]*?)<\/desc>/;
  const out = [];
  let m; while ((m = wptRe.exec(text))) {
    const lat = parseFloat(m[1]); const lon = parseFloat(m[2]);
    const inner = m[3];
    const name = (nameRe.exec(inner)?.[1] || 'Importierter Punkt').trim();
    const desc = descRe.exec(inner)?.[1]?.trim();
    const cat = inferCategory(name + ' ' + (desc||''));
    out.push({ id: makeId(name,lat,lon,cat), name, lat, lon, category:cat, details:desc });
  }
  return out;
}
function importCSV(text) {
  const lines = text.split(/?
/).filter(l=>l.trim().length);
  const out = []; let header=false;
  if (/name.*lat.*lon/i.test(lines[0])) { header=true; }
  lines.forEach((l,i) => {
    if (header && i===0) return;
    const cols = l.split(',').map(c=>c.trim());
    if (cols.length<3) return;
    const name = cols[0]; const lat = parseFloat(cols[1]); const lon = parseFloat(cols[2]);
    if (Number.isNaN(lat)||Number.isNaN(lon)) return;
    const category = (cols[3]||'culture').trim();
    const details = cols[4]||'';
    out.push({ id: makeId(name,lat,lon,category), name, lat, lon, category, details });
  });
  return out;
}
function parseTextForSpots(t) {
  const out = [];
  const coordsRe = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g;
  let m; while ((m = coordsRe.exec(t))) {
    const lat = parseFloat(m[1]); const lon = parseFloat(m[2]);
    out.push({ id: makeId(`${lat},${lon}`,lat,lon,'camperFree'), name:`Punkt ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'Hinzugefügt via Einfügen' });
  }
  const llRe = /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/g;
  while ((m = llRe.exec(t))) {
    const lat = parseFloat(m[1]); const lon = parseFloat(m[2]);
    out.push({ id: makeId(`${lat},${lon}`,lat,lon,'camperFree'), name:`Karte ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'Aus Kartenlink' });
  }
  const atRe = /@(-?\d+\.\d+),(-?\d+\.\d+)/g;
  while ((m = atRe.exec(t))) {
    const lat = parseFloat(m[1]); const lon = parseFloat(m[2]);
    out.push({ id: makeId(`${lat},${lon}`,lat,lon,'camperFree'), name:`Karte ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'Aus Kartenlink' });
  }
  return out;
}
function inferCategory(text) {
  const t = text.toLowerCase();
  if (t.includes('camp') || t.includes('stellplatz')) return 'camperCampground';
  if (t.includes('free') || t.includes('frei')) return 'camperFree';
  if (t.includes('beach') || t.includes('strand')) return 'beach';
  if (t.includes('snork') || t.includes('schnorch')) return 'snorkel';
  if (t.includes('fish') || t.includes('angel')) return 'fishing';
  if (t.includes('hike') || t.includes('wander') || t.includes('trail')) return 'hike';
  if (t.includes('swim') || t.includes('baden')) return 'swim';
  if (t.includes('taverna') || t.includes('restaurant') || t.includes('ouz')) return 'restaurant';
  return 'culture';
}
function makeId(name,lat,lon,cat) {
  const base = `${name}|${lat.toFixed(6)}|${lon.toFixed(6)}|${cat}`;
  let h = 0; for (let i=0;i<base.length;i++) { h=((h<<5)-h)+base.charCodeAt(i); h|=0; }
  return String(h);
}
function distKm(lat1,lon1,lat2,lon2) {
  const R=6371; const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function toRad(d){return d*Math.PI/180}
function gridAround(c, cellKm, radiusKm) {
  const latDegPerKm = 1/110.574;
  const lonDegPerKm = 1/(111.320*Math.cos(((c.lat||37)*Math.PI/180)));
  const steps = Math.max(1, Math.floor(radiusKm/cellKm));
  const out = [];
  for (let i=-steps;i<=steps;i++) for (let j=-steps;j<=steps;j++) {
    out.push({lat:(c.lat||37)+i*cellKm*latDegPerKm, lon:(c.lon||22)+j*cellKm*lonDegPerKm});
  }
  return out;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

/* ---- Start ---- */
document.addEventListener('DOMContentLoaded', () => {
  renderSpotList();
  const params = new URLSearchParams(location.search);
  if (params.get('refresh')==='1') getLocation(false);
});
