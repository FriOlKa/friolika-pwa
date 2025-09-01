/* FriOlKa PWA – v6 (proaktiv, Tiles, Green, Safe-Area fix) */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Error banner
window.addEventListener('error', (e) => showError('Fehler: ' + (e.message||e)));
window.addEventListener('unhandledrejection', (e) => showError('Fehler: ' + (e.reason?.message||e.reason||e)));
function showError(msg){ const b=$('#error-banner'); if(!b) return; b.textContent=msg; b.classList.remove('hidden'); setTimeout(()=>b.classList.add('hidden'), 7000); }

// Config
const FETCH_RADIUS_KM = 30;      // Umkreis für Overpass-POIs
const REFRESH_MINUTES = 15;      // Auto-Refresh, solange App offen

// State
let state = {
  pos: null,
  lastFetchPos: null,
  weather: null,
  spots: [],           // aktive Spots (online + user-import)
  imported: [],        // user-importierte Spots
  quality: {},
  basecamps: [],
  filters: { kinderwagen:false, schattig:false, freistehen:false, lokal:false, preiswert:false }
};

// Storage
const storage = {
  load(){ try{ const s=JSON.parse(localStorage.getItem('friolika-state')||'{}'); if(s.imported) state.imported=s.imported; }catch{} },
  save(){ localStorage.setItem('friolika-state', JSON.stringify({ imported: state.imported })); }
};
storage.load();

// Home tiles navigation
$$('.tile').forEach(t=>t.addEventListener('click',()=>{ const tab = t.dataset.go; if (tab) activateTab(tab); }));

// Tabs
$$('.tabs button').forEach(btn => { btn.addEventListener('click', () => activateTab(btn.dataset.tab)); });
function activateTab(tab){
  $$('.tabs button').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`.tabs button[data-tab="${tab}"]`); if (btn) btn.classList.add('active');
  $$('.tab').forEach(t=>t.classList.remove('active'));
  const pane = document.getElementById('tab-'+tab); if (pane) pane.classList.add('active');
  if (tab==='map') setTimeout(initMapOnce,0);
}

// Standort & Auto-Refresh
const refreshBtn = document.getElementById('btn-refresh'); if (refreshBtn) refreshBtn.addEventListener('click', ()=>getLocation(true));
let refreshTimer = null;
function startAutoRefresh(){ if (refreshTimer) clearInterval(refreshTimer); refreshTimer = setInterval(()=>{ if (document.visibilityState==='visible') getLocation(false); }, REFRESH_MINUTES*60*1000); }

async function getLocation(watch=false){
  if (!navigator.geolocation){ showError('Geolocation wird nicht unterstützt.'); return; }
  navigator.geolocation.getCurrentPosition(async (pos)=>{
    const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
    const movedKm = state.pos ? distKm(state.pos.lat,state.pos.lon,p.lat,p.lon) : 999;
    state.pos = p; startAutoRefresh();
    if (!state.lastFetchPos || movedKm>2){ await refreshAll(); state.lastFetchPos = p; }
    renderAll();
    if (watch){ navigator.geolocation.watchPosition(async (pp)=>{ const np={lat:pp.coords.latitude,lon:pp.coords.longitude,acc:pp.coords.accuracy}; const mk=distKm(state.pos.lat,state.pos.lon,np.lat,np.lon); state.pos=np; if (mk>2){ await refreshAll(); state.lastFetchPos=np; } renderAll(); }, (err)=>showError(err.message), {enableHighAccuracy:true, maximumAge:10000, timeout:20000}); }
  }, (err)=>showError('Standort nicht verfügbar: '+err.message), {enableHighAccuracy:true, maximumAge:0, timeout:20000});
}

async function refreshAll(){ await fetchWeather(); await fetchPOIs(); computeQuality(); computeBasecamps(); }
function renderAll(){ renderMap(); renderNearby(); renderBasecamps(); renderWeatherPanel(); renderSpotList(); }

// Wetter
async function fetchWeather(){ if(!state.pos) return; const url=new URL('https://api.open-meteo.com/v1/forecast'); url.searchParams.set('latitude',String(state.pos.lat)); url.searchParams.set('longitude',String(state.pos.lon)); url.searchParams.set('daily','temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'); url.searchParams.set('timezone','auto'); try{ const r=await fetch(url.toString()); if(!r.ok) throw new Error('Wetter HTTP '+r.status); state.weather=await r.json(); }catch(e){ showError('Wetter fehlgeschlagen'); }}

// Overpass helpers
function overpassBBox(lat,lon,km){
  const dlat = km/110.574; const dlon = km/(111.320*Math.cos(lat*Math.PI/180));
  const s = lat-dlat, n = lat+dlat, w = lon-dlon, e = lon+dlon; return s+','+w+','+n+','+e;
}
async function overpass(query){
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
  ];
  const body = new URLSearchParams({ data: query });
  for (let i=0;i<endpoints.length;i++){
    const ep = endpoints[i];
    try{ const r = await fetch(ep, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}, body }); if (r.ok){ return await r.json(); }}
    catch(e){ /* try next */ }
  }
  throw new Error('Overpass nicht erreichbar');
}

// Fetch POIs (OSM via Overpass)
async function fetchPOIs(){ if(!state.pos) return; const bbox = overpassBBox(state.pos.lat,state.pos.lon,FETCH_RADIUS_KM);
  const q1 = "[out:json][timeout:25];(node[\"natural\"=\"beach\"]({bbox}); way[\"natural\"=\"beach\"]({bbox}); node[\"leisure\"=\"beach_resort\"]({bbox}); node[\"natural\"=\"water\"]({bbox}););out center;".split('{bbox}').join(bbox);
  const q2 = "[out:json][timeout:25];(way[\"highway\"~\"path|track|footway\"]({bbox}););out center;".split('{bbox}').join(bbox);
  const q3 = "[out:json][timeout:25];(node[\"tourism\"=\"attraction\"]({bbox}); node[\"historic\"]({bbox}); way[\"historic\"]({bbox}););out center;".split('{bbox}').join(bbox);
  const q4 = "[out:json][timeout:25];(node[\"amenity\"~\"restaurant|cafe|fast_food|food_court\"]({bbox}););out center;".split('{bbox}').join(bbox);
  const q5 = "[out:json][timeout:25];(node[\"tourism\"~\"camp_site|caravan_site\"]({bbox}); node[\"amenity\"=\"parking\"]({bbox}););out center;".split('{bbox}').join(bbox);

  let elements = [];
  for (const q of [q1,q2,q3,q4,q5]){ try{ const j = await overpass(q); if (j && j.elements) elements = elements.concat(j.elements); }catch(e){ /* continue */ } }

  const fetched = [];
  const seen = new Set();
  for (const el of elements){
    const lat = el.lat || (el.center && el.center.lat);
    const lon = el.lon || (el.center && el.center.lon);
    if (lat==null || lon==null) continue;
    const tags = el.tags||{};
    const name = tags.name || tags['name:de'] || tags['name:en'] || 'Ort';
    const cat = classify(tags);
    const id = makeId(name,lat,lon,cat);
    if (seen.has(id)) continue; seen.add(id);
    const strollerOk = cat==='hike' ? strollerFromTags(tags) : undefined;
    const estMin = cat==='hike' ? estDurationFromTags(tags) : undefined;
    const hasShade = cat==='beach' ? shadeFromTags(tags) : undefined;
    const costLevel = cat==='restaurant' ? costFromTags(tags) : undefined;
    const details = detailFromTags(tags);
    fetched.push({ id, name, lat, lon, category:cat, details, strollerOk, estDurationMin: estMin, hasShade, costLevel, source:'OSM' });
  }
  const byId = new Map();
  state.imported.forEach(s=>byId.set(s.id, s));
  fetched.forEach(s=>byId.set(s.id, s));
  state.spots = Array.from(byId.values());
}

function classify(tags){
  if (tags.natural==='beach' || tags.leisure==='beach_resort') return 'beach';
  if (tags.tourism==='attraction' || tags.historic) return 'culture';
  if (tags.highway && /path|track|footway/.test(tags.highway)) return 'hike';
  if (tags.tourism && /camp_site|caravan_site/.test(tags.tourism)) return 'camperCampground';
  if (tags.amenity==='parking') return 'camperFree';
  if (tags.amenity && /restaurant|cafe|fast_food|food_court/.test(tags.amenity)) return 'restaurant';
  if (tags.natural==='water') return 'swim';
  return 'culture';
}
function strollerFromTags(tags){
  const surfaceOk = /asphalt|paved|compacted|fine_gravel|gravel/.test(tags.surface||'');
  const sac = (tags.sac_scale||'').toLowerCase();
  const incline = parseFloat((tags.incline||'0').toString().replace('%',''))||0;
  return surfaceOk && (!sac || sac==='hiking' || sac==='mountain_hiking') && Math.abs(incline)<=10;
}
function estDurationFromTags(tags){
  const len = parseFloat(tags.distance||tags.length||'0');
  if (len>0){ const km = /km|kilometer/.test(String(tags.distance||tags.length||'')) ? len : len/1000; return Math.round(km*45); }
  return 120;
}
function shadeFromTags(tags){ return /trees|forest|wood|shade/.test((tags.natural||'') + ' ' + (tags.landuse||'')); }
function costFromTags(tags){
  const price = (tags.price||'').toLowerCase(); if (price.includes('€€€')) return 3; if (price.includes('€€')) return 2; if (price.includes('€')) return 1; return undefined;
}
function detailFromTags(tags){
  const arr = [];
  if (tags.cuisine) arr.push('Küche: '+tags.cuisine);
  if (tags.opening_hours) arr.push('Öffnungszeiten: '+tags.opening_hours);
  if (tags.operator) arr.push('Betreiber: '+tags.operator);
  return arr.join(' · ');
}

// Quality
function computeQuality(){
  const q = {}; const wind = (state.weather && state.weather.daily && state.weather.daily.wind_speed_10m_max && state.weather.daily.wind_speed_10m_max[0]) || 0;
  state.spots.forEach(s=>{
    const rocky = /fels|rock|skala|reef|klippe|cliff/i.test((s.name||'')+' '+(s.details||''));
    let snork = 50; if (wind<4) snork+=30; else if (wind<6) snork+=15; else if (wind>9) snork-=20; if (rocky) snork+=10; if (s.category==='snorkel') snork+=10; q[s.id]={snorkelScore:Math.max(0,Math.min(100,snork))};
    let fish = 50; if (wind>=3 && wind<=8) fish+=20; if (wind>10) fish-=15; if (rocky) fish+=10; if (s.category==='fishing') fish+=10; q[s.id].fishingScore=Math.max(0,Math.min(100,fish));
  });
  state.quality=q;
}

// Basecamps
function computeBasecamps(){ if(!state.pos) return; const centers=gridAround(state.pos,20,80); const res=[]; centers.forEach(c=>{
  const around = state.spots.filter(s=>distKm(c.lat,c.lon,s.lat,s.lon)<25);
  if(!around.length) return; const cats=new Set(around.map(s=>s.category));
  let score=0; const reasons=[]; const variety=Math.min(100,cats.size*18); score+=Math.round(variety*0.25); if(cats.size>=4) reasons.push('Vielseitige Aktivitäten in <25\u202Fkm');
  const hasFood=around.some(s=>s.category==='restaurant'); const hasCamp=around.some(s=>s.category==='camperFree'||s.category==='camperCampground'); const hasWater=around.some(s=>['beach','swim','snorkel'].includes(s.category));
  let supply=0; if(hasFood)supply+=35; if(hasCamp)supply+=35; if(hasWater)supply+=30; score+=Math.round(supply*0.15); if(supply>=60) reasons.push('Gute Versorgung & Stellplätze');
  const kid=around.filter(s=>(s.category==='beach'&&s.hasShade)||(s.category==='hike'&&(s.estDurationMin||0)<=240)); const kidScore=Math.min(100,kid.length*15); score+=Math.round(kidScore*0.10); if(kidScore>=30) reasons.push('Familienfreundliche Spots vorhanden');
  if(state.weather&&state.weather.daily){ const d=state.weather.daily; const rainMax=(d.precipitation_probability_max||[]).slice(0,3).reduce((a,b)=>Math.max(a,b||0),0); const windMax=(d.wind_speed_10m_max||[]).slice(0,3).reduce((a,b)=>Math.max(a,b||0),0); let w=100; if(rainMax>=60) w-=40; if(windMax>=9) w-=30; score+=Math.round(Math.max(0,w)*0.35); reasons.push(w>=70?'Stabiles Wetterfenster (3 Tage)':'Wetter gemischt – Alternativen in der Nähe'); }
  score=Math.min(100,Math.max(20,score)); const plan=buildDayPlan(c,around); res.push({center:c,label:'Gutes Basislager',score,reasons,sample:around.slice(0,8),plan}); });
  state.basecamps=res.sort((a,b)=>b.score-a.score).slice(0,5);
}
function buildDayPlan(center, spots){ const within=(km,c=[])=>spots.filter(s=>distKm(center.lat,center.lon,s.lat,s.lon)<=km && (c.length?c.includes(s.category):true)); const beaches=within(20,['beach','snorkel']); const culture=within(25,['culture']); const hikes=within(25,['hike']).filter(s=>(s.estDurationMin||0)<=180); const food=within(25,['restaurant']).filter(isLocalRestaurant);
  const days=[]; for(let d=0; d<3; d++){ const beach=beaches.length?beaches[d%beaches.length]:null; const cult=culture.length?culture[d%culture.length]:null; const hike=hikes.length?hikes[d%hikes.length]:null; const eat=food.length?food[d%food.length]:null; if(!beach&&!cult&&!hike&&!eat) break; days.push({morning:beach,noon:cult,afternoon:hike,evening:eat}); } return days; }

// Restaurant heuristics
function isLocalRestaurant(s){ const t=((s.name||'')+' '+(s.details||'')).toLowerCase(); const local=['taverna','tavern','ouzeri','mezed','psarotaverna','kafeneio','μαγειρείο']; const tourist=['tourist','touristy','all inclusive']; if(tourist.some(w=>t.includes(w))) return false; return local.some(w=>t.includes(w)) || /[α-ωΑ-Ω]/.test(t); }
function isBudgetRestaurant(s){ if (s.costLevel && s.costLevel<=2) return true; const euros=(s.details||'').match(/€+/g)||[]; if(!euros.length) return true; return euros.sort((a,b)=>b.length-a.length)[0].length<=2; }

// Map (Leaflet)
let map, markersLayer, userMarker;
function initMapOnce(){ if(map) return; if(!window.L){ showError('Kartenbibliothek nicht geladen'); return; } map=L.map('map'); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map); markersLayer=L.layerGroup().addTo(map); renderMap(); }
function renderMap(){ if(!map) return; markersLayer.clearLayers(); const icons={culture:'🏛️',beach:'🏖️',hike:'🥾',swim:'💧',camperFree:'🚐',camperCampground:'⛺',restaurant:'🍽️',snorkel:'🤿',fishing:'🎣'}; state.spots.forEach(s=>{ const m=L.marker([s.lat,s.lon]).addTo(markersLayer); const badges = badgeTextFor(s).map(b=>`<span class="badge">${b}</span>`).join(' '); const html=`<div class="card"><b>${escapeHtml(s.name)}</b><br/>${escapeHtml(s.details||'')}<div class="badges" style="margin-top:6px">${badges}</div><div style="margin-top:8px"><button class="btn" onclick="Friolika.showDetail('${s.id}')">Details</button></div></div>`; m.bindPopup(html); m.setIcon(L.divIcon({className:'',html:`<div style="font-size:20px">${icons[s.category]||'📍'}</div>`})); }); if(state.pos){ if(!userMarker) userMarker=L.marker([state.pos.lat,state.pos.lon],{opacity:0.6}).addTo(map); else userMarker.setLatLng([state.pos.lat,state.pos.lon]); map.setView([state.pos.lat,state.pos.lon], 11, {animate:true}); }}

// Nearby
function badgeTextFor(s){ const arr=[]; if(s.category==='hike' && (s.estDurationMin||0)<=240) arr.push('Kraxe≤4h'); if(s.category==='beach' && s.hasShade) arr.push('Schatten'); if(s.category==='camperFree') arr.push('frei'); if(s.category==='snorkel') arr.push('🤿'); if(s.category==='fishing') arr.push('🎣'); if(s.category==='restaurant' && isLocalRestaurant(s)) arr.push('lokal'); if(s.category==='restaurant' && isBudgetRestaurant(s)) arr.push('€-€€'); return arr; }
function qualityBadges(s){ const q=state.quality[s.id]||{}; let out=''; if((s.category==='snorkel'||s.category==='beach')){ if((q.snorkelScore||0)>=75) out+='<span class="badge">🤿 heute sehr gut</span>'; else if((q.snorkelScore||0)>=60) out+='<span class="badge">🤿 gut</span>'; } if((s.category==='fishing'||s.category==='beach') && (q.fishingScore||0)>=70) out+=' <span class="badge">🎣 gut</span>'; return out; }
function renderNearby(){ const list=$('#nearby-list'); if(!list) return; list.innerHTML=''; if(!state.pos){ list.innerHTML='<li class="msg">Tippe 🔄 für Standort.</li>'; return; } const F=state.filters; let arr=state.spots.map(s=>({s, d: distKm(state.pos.lat,state.pos.lon,s.lat,s.lon)})).filter(o=>o.d<=60); arr=arr.filter(o=>{ const s=o.s; if(F.freistehen && s.category!=='camperFree') return false; if(F.kinderwagen && s.category==='hike' && (s.estDurationMin||999)>240) return false; if(F.schattig && s.category==='beach' && !s.hasShade) return false; if((F.lokal||F.preiswert)&&s.category==='restaurant'){ if(F.lokal && !isLocalRestaurant(s)) return false; if(F.preiswert && !isBudgetRestaurant(s)) return false; } return true; }).sort((a,b)=>a.d-b.d);
  if(!arr.length){ list.innerHTML='<li class="msg">Keine Spots im Umkreis (noch).</li>'; return; }
  arr.slice(0,50).forEach(({s,d})=>{ const li=document.createElement('li'); li.className='card'; const badges=badgeTextFor(s).map(b=>`<span class="badge">${b}</span>`).join(' '); const qual=qualityBadges(s); li.innerHTML = `<b>${escapeHtml(s.name)}</b> <span class="badge">${s.category}</span> <span class="badge">${d.toFixed(1)} km</span><div class="badges">${badges} ${qual}</div><div class="muted">${escapeHtml(s.details||'')}</div><div style="margin-top:8px"><button class="btn" data-id="${s.id}">Details</button></div>`; li.querySelector('button').addEventListener('click',()=>Friolika.showDetail(s.id)); list.appendChild(li); }); }

// Basecamps
function renderBasecamps(){ const ul=$('#basecamp-list'); if(!ul) return; ul.innerHTML=''; (state.basecamps||[]).forEach((b,i)=>{ const planId='plan-'+i; const li=document.createElement('li'); li.className='card'; li.innerHTML=`<b>Basecamp: ${b.label}</b> <span class="badge">Score ${b.score}</span><ul style="margin:6px 0 8px 18px">${b.reasons.slice(0,3).map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul><div class="badges">${(b.sample||[]).map(s=>`<span class='badge'>${escapeHtml(s.name)}</span>`).join(' ')}</div><div style="margin-top:8px"><button class="btn" data-plan="${planId}">Tagespläne anzeigen</button></div><div id="${planId}" class="card" style="margin-top:8px; display:none;"></div>`; li.querySelector(`button[data-plan]`).addEventListener('click',(ev)=>{ const div=document.getElementById(planId); if(!div)return; const open = div.style.display!=='none'; if(open){ div.style.display='none'; ev.target.textContent='Tagespläne anzeigen'; } else { div.innerHTML = renderDayPlanHtml(b.plan); div.style.display='block'; ev.target.textContent='Tagespläne ausblenden'; } }); ul.appendChild(li); }); }
function renderDayPlanHtml(days){ if(!days||!days.length) return '<div class="msg">Noch keine Vorschläge.</div>'; return days.map((d,i)=>{ const row=(l,s)=> s?`<div><b>${l}:</b> ${escapeHtml(s.name)}</div>`:''; return `<div style="margin-bottom:8px"><b>Tag ${i+1}</b>${row('Vormittag (Wasser)',d.morning)}${row('Mittag (Kultur)',d.noon)}${row('Nachmittag (kurze Wanderung)',d.afternoon)}${row('Abends (Taverne)',d.evening)}</div>`; }).join(''); }

// Wetterpanel
function renderWeatherPanel(){ const w=$('#weather'), next=$('#where-next'); if(!w||!next) return; if(!state.weather||!state.weather.daily){ w.innerHTML='<div class="msg">Warte auf Wetterdaten …</div>'; next.innerHTML=''; return; } const d=state.weather.daily; const days=(d.time||[]).slice(0,3); w.innerHTML = `<div class="card"><b>Wetter (3 Tage)</b>${days.map((date,i)=>`<div>${date}: max ${Math.round(d.temperature_2m_max[i])}°C, min ${Math.round(d.temperature_2m_min[i])}°C, Regen ${(d.precipitation_probability_max[i]||0)}%, Wind ${Math.round(d.wind_speed_10m_max[i]||0)} m/s</div>`).join('')}</div>`; next.innerHTML = `<div><b>Heute empfehle ich</b><br/>Suche windgeschützte Buchten bei stärkerem Wind (🤿). Für 🎣 sind 3–8 m/s oft gut. Ich markiere geeignete Spots mit Badges.</div>`; }

// Detail + Routing
const Friolika = { showDetail:(id)=>{ const s=(state.spots.find(x=>x.id===id)||state.imported.find(x=>x.id===id)); if(!s) return; $('#detail-title').textContent=s.name; $('#detail-desc').textContent=s.details||''; $('#detail-badges').innerHTML = badgeTextFor(s).map(b=>`<span class='badge'>${b}</span>`).join(' ') + ' ' + qualityBadges(s); $('#open-apple').href = `http://maps.apple.com/?daddr=${s.lat},${s.lon}&q=${encodeURIComponent(s.name)}`; $('#open-google').href = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=driving`; const wikiBox=$('#wiki'); wikiBox.innerHTML='<div class="msg">Lade Guide‑Information …</div>'; fetchGuide(s.name).then(html=>wikiBox.innerHTML=html).catch(()=>wikiBox.innerHTML='<div class="msg">Keine Hintergrundinfos gefunden.</div>'); $('#detail-modal').classList.remove('hidden'); } };
window.Friolika = Friolika;
const dc = document.getElementById('detail-close'); if (dc) dc.addEventListener('click',()=>document.getElementById('detail-modal').classList.add('hidden'));
const dm = document.getElementById('detail-modal'); if (dm) dm.addEventListener('click',(e)=>{ if (e.target.id==='detail-modal') dm.classList.add('hidden'); });

async function fetchGuide(name){ const de=`https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`; const en=`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`; try{ const r=await fetch(de,{headers:{'accept':'application/json'}}); if(r.ok){ const j=await r.json(); return wikiHtml(j,'de'); } }catch{} try{ const r=await fetch(en,{headers:{'accept':'application/json'}}); if(r.ok){ const j=await r.json(); return wikiHtml(j,'en'); } }catch{} throw new Error('no summary'); }
function wikiHtml(j,lang){ const title=j.title||'Wikipedia'; const extract=j.extract||''; const url=(j.content_urls&&j.content_urls.desktop&&j.content_urls.desktop.page)||(lang==='de'?`https://de.wikipedia.org/wiki/${encodeURIComponent(title)}`:`https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`); return `<div><b>Guide</b><div style='margin-top:6px'>${escapeHtml(extract)}</div><div style='margin-top:6px'><a href='${url}' target='_blank' rel='noopener'>Mehr auf Wikipedia</a></div></div>`; }

// Import / Export
const fi = document.getElementById('file-input'); if (fi) fi.addEventListener('change', async (ev)=>{ const f=ev.target.files[0]; if(!f) return; const text=await f.text(); let added=[]; if(f.name.toLowerCase().endsWith('.gpx')) added=importGPX(text); else added=importCSV(text); importMerge(added, f.name.toLowerCase().endsWith('.gpx')?'GPX':'CSV'); });
const bp = document.getElementById('btn-paste'); if (bp) bp.addEventListener('click', async ()=>{ try{ const t=await navigator.clipboard.readText(); if(!t){ $('#import-msg').textContent='Zwischenablage leer.'; return; } const spots=parseTextForSpots(t); if(spots.length===0){ $('#import-msg').textContent='Keine Koordinaten/Links erkannt. Bei Park4Night bitte den Karten-Link einfügen.'; return; } importMerge(spots,'Paste'); }catch(e){ $('#import-msg').textContent='Kein Zugriff auf Zwischenablage. Kopiere & nutze „Manuell hinzufügen“. '; } });
const ba = document.getElementById('btn-add-manual'); if (ba) ba.addEventListener('click', async ()=>{ const name=prompt('Name des Spots'); if(!name) return; const lat=parseFloat(prompt('Breite (lat)')||''); if(Number.isNaN(lat)) return; const lon=parseFloat(prompt('Länge (lon)')||''); if(Number.isNaN(lon)) return; const category=prompt('Kategorie (culture,beach,hike,swim,camperFree,camperCampground,restaurant,snorkel,fishing)','camperFree')||'camperFree'; const details=prompt('Details (optional)')||''; importMerge([{id:makeId(name,lat,lon,category),name,lat,lon,category,details,source:'Manual'}],'Manual'); });
const be1 = document.getElementById('btn-export-csv'); if (be1) be1.addEventListener('click',()=> downloadFile('spots.csv', toCSV(state.imported.length?state.imported:state.spots)));
const be2 = document.getElementById('btn-export-gpx'); if (be2) be2.addEventListener('click',()=> downloadFile('spots.gpx', toGPX(state.imported.length?state.imported:state.spots)));

function importMerge(added, source){ const byId=new Map(state.imported.map(s=>[s.id,s])); added.forEach(s=>{ s.source=s.source||source; byId.set(s.id, Object.assign({}, byId.get(s.id)||{}, s)); }); state.imported=Array.from(byId.values()); storage.save(); const msg = document.getElementById('import-msg'); if (msg) msg.textContent=`Import ok: ${added.length} Punkte.`; const mainById=new Map(state.spots.map(s=>[s.id,s])); state.imported.forEach(s=>mainById.set(s.id,s)); state.spots=Array.from(mainById.values()); renderSpotList(); renderNearby(); renderMap(); }
function renderSpotList(){ const ul=document.getElementById('spot-list'); if(!ul) return; ul.innerHTML=''; state.imported.forEach(s=>{ const li=document.createElement('li'); li.className='card'; li.innerHTML=`<b>${escapeHtml(s.name)}</b> <span class='badge'>${s.category}</span><div class='muted'>${escapeHtml(s.details||'')}</div>`; ul.appendChild(li); }); }

function parseTextForSpots(t){ const out=[]; let m; // 1) lat,lon
  const coords=/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g; while((m=coords.exec(t))){ const lat=parseFloat(m[1]), lon=parseFloat(m[2]); out.push({ id: makeId(`${lat},${lon}`,lat,lon,'camperFree'), name:`Punkt ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'aus Einfügen' }); }
  // 2) Apple/Google maps ll=/@ coords
  const ll=/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/g; while((m=ll.exec(t))){ const lat=parseFloat(m[1]), lon=parseFloat(m[2]); out.push({ id: makeId(`${lat},${lon}`,lat,lon,'camperFree'), name:`Karte ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'aus Kartenlink' }); }
  const at=/@(-?\d+\.\d+),(-?\d+\.\d+)/g; while((m=at.exec(t))){ const lat=parseFloat(m[1]), lon=parseFloat(m[2]); out.push({ id: makeId(`${lat},${lon}`,lat,lon,'camperFree'), name:`Karte ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'aus Kartenlink' }); }
  // 3) Park4Night: lat/lon in Query? sonst Hinweis
  const p4n=/https?:\/\/park4night\.com\/[^\s]+/ig; while((m=p4n.exec(t))){ const url=m[0]; const latm=/[?&](lat|latitude)=(-?\d+\.\d+)/i.exec(url); const lonm=/[?&](lon|lng|longitude)=(-?\d+\.\d+)/i.exec(url); if(latm&&lonm){ const lat=parseFloat(latm[2]), lon=parseFloat(lonm[2]); out.push({ id: makeId(`P4N ${lat},${lon}`,lat,lon,'camperFree'), name:`P4N ${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, category:'camperFree', details:'aus Park4Night-Link' }); } else { const msg = document.getElementById('import-msg'); if (msg && !parseTextForSpots._p4nWarned){ msg.textContent='P4N-Link ohne Koordinaten erkannt. Bitte in Park4Night „In Karten öffnen“ nutzen und den Karten-Link einfügen.'; parseTextForSpots._p4nWarned=true; } } }
  return out; }

// Export
function downloadFile(filename, content){ const blob=new Blob([content],{type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function toCSV(spots){ const esc=(s)=>'"'+String(s||'').replace(/"/g,'""')+'"'; const rows=[['name','lat','lon','category','details']].concat(spots.map(s=>[s.name,s.lat,s.lon,s.category,s.details||''])); return rows.map(r=>r.map(esc).join(',')).join('\n'); }
function toGPX(spots){ const header='<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FriOlKa" xmlns="http://www.topografix.com/GPX/1/1">'; const wpts=spots.map(s=>`<wpt lat="${s.lat}" lon="${s.lon}"><name>${escapeXml(s.name)}</name>${s.details?`<desc>${escapeXml(s.details)}</desc>`:''}</wpt>`).join(''); return header+wpts+'</gpx>'; }

// Utils
function makeId(name,lat,lon,cat){ const base=(name||'')+'|'+Number(lat).toFixed(6)+'|'+Number(lon).toFixed(6)+'|'+(cat||''); let h=0; for(let i=0;i<base.length;i++){ h=((h<<5)-h)+base.charCodeAt(i); h|=0; } return String(h); }
function distKm(lat1,lon1,lat2,lon2){ const R=6371; const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1); const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
function toRad(d){return d*Math.PI/180}
function gridAround(c, cellKm, radiusKm){ const latDegPerKm=1/110.574; const lonDegPerKm=1/(111.320*Math.cos(((c.lat||37)*Math.PI/180))); const steps=Math.max(1,Math.floor(radiusKm/cellKm)); const out=[]; for(let i=-steps;i<=steps;i++) for(let j=-steps;j<=steps;j++){ out.push({lat:(c.lat||37)+i*cellKm*latDegPerKm, lon:(c.lon||22)+j*cellKm*lonDegPerKm}); } return out; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, (c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeXml(s){ return String(s||'').replace(/[<>&"']/g, (c)=>({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;','\'':'&apos;' }[c]||c)); }

// Start
document.addEventListener('DOMContentLoaded', ()=>{ renderSpotList(); const params=new URLSearchParams(location.search); if(params.get('refresh')==='1') getLocation(false); });
