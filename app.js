
/* FriOlKa V13.1 – Hotfix: Auto-Fallback, Reset, Netztest, noch schneller */
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
function showError(m){const b=$('#error-banner'); if(!b) return; b.textContent=m; b.classList.remove('hidden'); clearTimeout(showError._tmr); showError._tmr=setTimeout(()=>b.classList.add('hidden'),8000); logDiag('ERROR',m)}
function showToast(m){const t=$('#toast'); if(!t) return; t.textContent=m; t.style.display='block'; clearTimeout(showToast._tmr); showToast._tmr=setTimeout(()=>t.style.display='none',1500)}
function setGeoState(t,v='ok'){const p=$('#geo-state'); if(p){ p.textContent=t; p.style.background = v==='err'?'#ef4444':(v==='wait'?'#f59e0b':'#10b981'); }}
function logDiag(k,m){const box=$('#diag'); if(!box) return; box.classList.remove('hidden'); const pre=box.querySelector('pre')||document.createElement('pre'); if(!pre.parentElement){ box.innerHTML='<b>Diagnose</b><pre></pre>'; box.appendChild(pre);} pre.textContent=(pre.textContent?pre.textContent+'
':'')+`[${new Date().toLocaleTimeString()}] ${k}: ${m}`}

const REFRESH_MIN=15, CACHE_TTL_H=18, CELL_DEG=0.25; // ~28km
let state={pos:null,lastFetchKey:null,weather:null,spots:[],imported:[],viewMode:'recommendations',speed:false};
const storage={load(){try{const s=JSON.parse(localStorage.getItem('friolika-state')||'{}'); if(s.imported) state.imported=s.imported; if(s.compact) document.body.classList.add('compact'); if(s.speed){ state.speed=true; $('#cb-speed')&&( $('#cb-speed').checked=true ); }}catch{}},save(){localStorage.setItem('friolika-state',JSON.stringify({imported:state.imported,compact:document.body.classList.contains('compact'),speed:state.speed}))}}; storage.load();
const cacheStore={load(){try{return JSON.parse(localStorage.getItem('friolika-cache')||'{}')}catch{return{}}},save(o){localStorage.setItem('friolika-cache',JSON.stringify(o))},clear(){localStorage.removeItem('friolika-cache')}};

// Reset (SW + Storage)
$('#btn-reset')?.addEventListener('click', async ()=>{ try{ const regs=await navigator.serviceWorker?.getRegistrations?.(); regs&&regs.forEach(r=>r.unregister()); cacheStore.clear(); localStorage.removeItem('friolika-state'); showToast('Cache & SW zurückgesetzt – neu laden …'); setTimeout(()=>location.reload(),600); }catch{ location.reload(); } });

// Quick chips (nur Deep-Links)
const chips=[{label:'🍽️ Taverna',q:'taverna'},{label:'🍕 Pizzeria',q:'pizzeria'},{label:'☕ Café',q:'cafe'},{label:'🏖️ Strand',q:'strand beach'},{label:'🤿 Schnorcheln',q:'snorkeling'},{label:'🥾 Wanderung',q:'hiking trail'},{label:'🧒 Spielplatz',q:'playground'},{label:'🛒 Supermarkt',q:'supermarket'}];
function renderQuickSearch(){const box=$('#quick-search'); if(!box) return; box.innerHTML=''; chips.forEach(c=>{const a=document.createElement('a'); a.className='chip'; a.href='#'; a.textContent=c.label; a.addEventListener('click',e=>{e.preventDefault(); openGoogleSearch(c.q)}); box.appendChild(a);})}
function openGoogleSearch(q){ if(!state.pos){ showError('Kein Standort für Suche. Tippe 🔄 oder „Ort wählen“.'); return;} const url=`https://www.google.com/maps/search/${encodeURIComponent(q)}/@${state.pos.lat},${state.pos.lon},14z`; window.open(url,'_blank','noopener'); }

// Kachel-Handling
['click','touchend'].forEach(evt=>document.addEventListener(evt,e=>{const a=e.target.closest('.tile[data-go]'); if(!a) return; e.preventDefault(); const tab=a.getAttribute('data-go'); onTile(tab);}));
function onTile(tab){activateTab(tab); if(tab==='nearby'){ state.viewMode='recommendations'; ensureLocation().then(()=>{ renderNearby(); ensureDataAndMaybeFetch(); document.getElementById('tab-nearby')?.scrollIntoView({behavior:'smooth'}); }); } else if(tab==='map'){ if(!state.speed) initMapOnce(); setTimeout(()=>{ renderMap(); document.getElementById('tab-map')?.scrollIntoView({behavior:'smooth'}); },0); } else { document.getElementById('tab-'+tab)?.scrollIntoView({behavior:'smooth'}); }}
function activateTab(tab){$$('.tabs button').forEach(x=>x.classList.remove('active')); document.querySelector(`.tabs button[data-tab="${tab}"]`)?.classList.add('active'); $$('.tab').forEach(t=>t.classList.remove('active')); $('#tab-'+tab)?.classList.add('active');}
$$('.tabs button').forEach(b=>b.addEventListener('click',()=>onTile(b.dataset.tab)));

// Toggles
$('#cb-compact')?.addEventListener('change',e=>{document.body.classList.toggle('compact',e.target.checked); storage.save()});
$('#cb-speed')?.addEventListener('change',e=>{ state.speed=e.target.checked; storage.save(); if(state.speed){ showToast('Speed‑Modus aktiv'); }})
$('#cb-demo')?.addEventListener('change',e=>{ if(e.target.checked && state.pos) injectSampleData();});
$('#btn-pick-location')?.addEventListener('click',()=>{const lat=parseFloat(prompt('Breite (lat)',state.pos?state.pos.lat:'')); if(Number.isNaN(lat)) return; const lon=parseFloat(prompt('Länge (lon)',state.pos?state.pos.lon:'')); if(Number.isNaN(lon)) return; state.pos={lat,lon,acc:50}; state.lastFetchKey=null; ensureDataAndMaybeFetch(true); renderAll(); showToast('Ort gesetzt')});

// Netztest
$('#btn-nettest')?.addEventListener('click', async()=>{ let lines=[]; try{ const r1=await fetch('https://overpass-api.de/api/status',{method:'GET'}); lines.push('Overpass status: '+r1.status); }catch(e){ lines.push('Overpass status: FAIL '+e); }
 try{ const r2=await fetch('https://tile.openstreetmap.org/0/0/0.png'); lines.push('OSM tiles: '+r2.status); }catch(e){ lines.push('OSM tiles: FAIL '+e); }
 logDiag('NET', lines.join(' | ')); showToast('Netztest durchgeführt'); });

// Standort
const refreshBtn=$('#btn-refresh'); let refreshTimer=null;
refreshBtn&&refreshBtn.addEventListener('click',()=>getLocation(true));
function startAutoRefresh(){ if(refreshTimer) clearInterval(refreshTimer); refreshTimer=setInterval(()=>{ if(document.visibilityState==='visible') getLocation(false); }, REFRESH_MIN*60*1000); }
async function ensureLocation(){ if(state.pos) return; await getLocation(false); }
async function getLocation(watch=false){ if(!navigator.geolocation){ showError('Geolocation wird nicht unterstützt.'); setGeoState('Nicht unterstützt','err'); return;} try{ setGeoState('Ortung…','wait'); refreshBtn&&(refreshBtn.disabled=true); await new Promise((resolve,reject)=>{ navigator.geolocation.getCurrentPosition(async p=>{ const pos={lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy}; state.pos=pos; setGeoState('OK'); startAutoRefresh(); resolve(); if(watch){ navigator.geolocation.watchPosition(pp=>{ state.pos={lat:pp.coords.latitude,lon:pp.coords.longitude,acc:pp.coords.accuracy}; setGeoState('OK'); }, ()=>{}, {enableHighAccuracy:true,maximumAge:10000,timeout:20000}); } }, err=>{ showError('Standort nicht verfügbar: '+err.message); setGeoState('Fehler','err'); reject(err); }, {enableHighAccuracy:true,maximumAge:0,timeout:20000}); }); } finally{ refreshBtn&&(refreshBtn.disabled=false); }}

// Data – Fast-first cache + Auto-Fallback
let inflight=false; const endpoints=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.openstreetmap.ru/api/interpreter'];
function cellKey(lat,lon){ const q=(x)=>Math.round(x/CELL_DEG)*CELL_DEG; return q(lat).toFixed(3)+','+q(lon).toFixed(3); }
function ensureDataAndMaybeFetch(force=false){ if(!state.pos) return; const key=cellKey(state.pos.lat,state.pos.lon); const cache=cacheStore.load(); const entry=cache[key]; const fresh=entry && (Date.now()-entry.ts < CACHE_TTL_H*3600*1000);
 if(state.lastFetchKey!==key){ state.lastFetchKey=key; }
 if(entry){ state.spots=mergeImported(entry.spots||[]); renderAll(); logDiag('INFO',`Cache-Hit ${key} (${state.spots.length} Spots)`); }
 // Auto-fallback: wenn nach 12s kein Ergebnis und kein Cache -> Testdaten
 let autoFallback=true; if(entry && entry.spots && entry.spots.length) autoFallback=false; setTimeout(()=>{ if(autoFallback && (!state.spots||state.spots.length===0)){ logDiag('WARN','Auto-Fallback aktiv – Testdaten'); injectSampleData(); } }, 12000);
 if(force || !fresh){ fetchSpotsFromOSM(key).then(spots=>{ if(spots&&spots.length){ cache[key]={ts:Date.now(),spots}; cacheStore.save(cache); state.spots=mergeImported(spots); renderAll(); logDiag('INFO',`Cache-Update ${key}: ${spots.length} Spots`);} else { logDiag('WARN','Overpass 0 Elemente'); }}).catch(e=>{ logDiag('ERROR','Fetch fehlgeschlagen: '+e); }); }
}
function mergeImported(spots){ const m=new Map((spots||[]).map(s=>[s.id,s])); (state.imported||[]).forEach(s=>m.set(s.id,s)); return Array.from(m.values()); }

async function fetchSpotsFromOSM(key){ if(inflight){ logDiag('INFO','Fetch bereits läuft'); return []; }
 inflight=true; try{
   const bbox=overpassBBox(state.pos.lat,state.pos.lon, 30);
   const q=`[out:json][timeout:25];(
     node["natural"="beach"](${bbox}); way["natural"="beach"](${bbox}); node["leisure"="beach_resort"](${bbox}); node["natural"="water"](${bbox});
     way["highway"~"path|track|footway"](${bbox}); node["tourism"="attraction"](${bbox}); node["historic"](${bbox});
     node["amenity"~"restaurant|cafe|fast_food"](${bbox}); node["tourism"~"camp_site|caravan_site"](${bbox}); node["amenity"="parking"](${bbox});
     node["leisure"="playground"](${bbox}); node["shop"~"bakery|supermarket|convenience"](${bbox}); node["amenity"~"pharmacy|fuel|doctors|clinic|hospital"](${bbox});
   ); out center qt;`;
   const body=new URLSearchParams({data:q});
   for(let i=0;i<endpoints.length;i++){
     try{ const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort('timeout'), 20000);
       const r=await fetch(endpoints[i],{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded; charset=UTF-8','accept':'application/json'},body, signal:ctrl.signal});
       clearTimeout(to);
       if(r.ok){ const j=await r.json(); logDiag('INFO',`Overpass ${i}: ${j.elements?.length||0} Elemente`); return toSpots(j.elements||[]); }
       else { logDiag('WARN',`Overpass ${i} HTTP ${r.status}`); }
     }catch(e){ logDiag('WARN',`Overpass ${i} Fehler: ${e}`); }
   }
   throw new Error('Kein Overpass-Endpunkt erreichbar');
 } finally { inflight=false; }
}
function overpassBBox(lat,lon,km){ const dlat=km/110.574, dlon=km/(111.320*Math.cos(lat*Math.PI/180)); return `${lat-dlat},${lon-dlon},${lat+dlat},${lon+dlon}`}
function toSpots(els){ const out=[]; const seen=new Set(); for(const el of els){ const lat=el.lat||(el.center&&el.center.lat); const lon=el.lon||(el.center&&el.center.lon); if(lat==null||lon==null) continue; const t=el.tags||{}; const name=t.name||t['name:de']||t['name:en']||'Ort'; const cat=classify(t); const id=makeId(name,lat,lon,cat); if(seen.has(id)) continue; seen.add(id); out.push({id,name,lat,lon,category:cat,details:detailFromTags(t),source:'OSM'});} return out; }
function classify(t){ if(t.natural==='beach'||t.leisure==='beach_resort') return 'beach'; if(t.natural==='water') return 'swim'; if(t.highway&&/(path|track|footway)/.test(t.highway)) return 'hike'; if(t.tourism==='attraction'||t.historic) return 'culture'; if(t.tourism&&/(camp_site|caravan_site)/.test(t.tourism)) return 'camperCampground'; if(t.amenity==='parking') return 'camperFree'; if(t.leisure==='playground') return 'playground'; if(t.amenity&&/(restaurant|cafe|fast_food)/.test(t.amenity)) return 'restaurant'; if(t.shop&&/(bakery|supermarket|convenience)/.test(t.shop)) return 'shop'; if(t.amenity&&/(pharmacy|fuel|doctors|clinic|hospital)/.test(t.amenity)) return 'service'; return 'culture'; }
function detailFromTags(t){ const arr=[]; if(t.cuisine) arr.push('Küche: '+t.cuisine); if(t.opening_hours) arr.push('Öffnungszeiten: '+t.opening_hours); if(t.operator) arr.push('Betreiber: '+t.operator); return arr.join(' · '); }

// Renderers
function renderAll(){ if(!state.speed) renderMap(); renderNearby(); renderWeather(); renderSpotList(); }
function renderNearby(){ const reco=$('#nearby-reco'), list=$('#nearby-list'); if(!reco||!list) return; if(!state.pos){ reco.innerHTML='<div class="msg">Tippe 🔄 oder „Ort wählen“.</div>'; list.style.display='none'; return; }
  if(state.viewMode==='recommendations'){
    list.style.display='none'; reco.style.display='block';
    const spots=state.spots||[]; const within=(km,cat)=>spots.filter(s=>distKm(state.pos.lat,state.pos.lon,s.lat,s.lon)<=km && (!cat||cat.includes(s.category)));
    const dsort=(a,b)=>distKm(state.pos.lat,state.pos.lon,a.lat,a.lon)-distKm(state.pos.lat,state.pos.lon,b.lat,b.lon);
    const sec=(title,items)=>!items.length?'' : `<div class='section'><h3>${title}</h3>${items.slice(0,6).map(s=>row(s)).join('')}</div>`;
    const row=(s)=>{ const d=distKm(state.pos.lat,state.pos.lon,s.lat,s.lon).toFixed(1)+' km'; return `<div class='card' style='margin-top:6px'><b>${escapeHtml(s.name)}</b> <span class='badge'>${s.category}</span> <span class='badge'>${d}</span><div class='muted'>${escapeHtml(s.details||'')}</div><div style='margin-top:6px'><a class='chip' target='_blank' rel='noopener' href='https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}'>Route</a></div></div>`; };
    const parts=[
      sec('🍽️ Essen & Trinken', within(25,['restaurant']).sort(dsort)),
      sec('🥾 Kurze Wanderungen', within(25,['hike']).sort(dsort)),
      sec('🌊 Wasser & Strand', within(25,['beach','swim']).sort(dsort)),
      sec('🚐 Stellplätze & Camping', within(30,['camperFree','camperCampground']).sort(dsort)),
      sec('🏛️ Kultur', within(25,['culture']).sort(dsort)),
      sec('🧒 Spielplätze', within(20,['playground']).sort(dsort)),
      sec('🛍️ Einkaufen', within(20,['shop']).sort(dsort)),
      sec('🧭 Services', within(25,['service']).sort(dsort)),
    ].filter(Boolean).join('');
    reco.innerHTML = parts || '<div class="msg">Noch keine Daten. Ich aktualisiere im Hintergrund … Oder nutze die Such‑Chips oben.</div>';
  } else {
    reco.style.display='none'; list.style.display='block'; list.innerHTML=''; (state.spots||[]).slice(0,100).forEach(s=>{ const li=document.createElement('li'); const d=state.pos?distKm(state.pos.lat,state.pos.lon,s.lat,s.lon).toFixed(1)+' km':''; li.className='card'; li.innerHTML=`<b>${escapeHtml(s.name)}</b> <span class='badge'>${s.category}</span> <span class='badge'>${d}</span>`; list.appendChild(li); });
  }
}

// Wetter
async function fetchWeather(){ if(!state.pos) return; try{ const url=new URL('https://api.open-meteo.com/v1/forecast'); url.searchParams.set('latitude',String(state.pos.lat)); url.searchParams.set('longitude',String(state.pos.lon)); url.searchParams.set('daily','temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'); url.searchParams.set('timezone','auto'); const r=await fetch(url.toString(),{headers:{'accept':'application/json'}}); if(!r.ok) throw new Error('Wetter HTTP '+r.status); state.weather=await r.json(); renderWeather(); }catch(e){ logDiag('WARN','Wetter fehlgeschlagen'); }}
function renderWeather(){ const w=$('#weather'); if(!w){return;} if(!state.pos){ w.innerHTML='<div class="msg">Kein Standort.</div>'; return;} if(state.weather?.daily){ const d=state.weather.daily; const days=(d.time||[]).slice(0,3); w.innerHTML=`<div class='card'><b>Wetter (3 Tage)</b>${days.map((date,i)=>`<div>${date}: max ${Math.round(d.temperature_2m_max[i])}°C, min ${Math.round(d.temperature_2m_min[i])}°C, Regen ${(d.precipitation_probability_max[i]||0)}%, Wind ${Math.round(d.wind_speed_10m_max[i]||0)} m/s</div>`).join('')}</div>`; } else { w.innerHTML='<div class="msg">Warte auf Wetter …</div>'; fetchWeather(); } }

// Karte (lazy)
let map=null, markersLayer=null, userMarker=null;
function initMapOnce(){ if(map||state.speed) return; if(!window.L){ showError('Kartenbibliothek nicht geladen'); return; } map=L.map('map'); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map); markersLayer=L.layerGroup().addTo(map); }
function renderMap(){ if(state.speed) return; if(!map){ initMapOnce(); if(!map) return; } markersLayer.clearLayers(); (state.spots||[]).forEach(s=>{ const m=L.marker([s.lat,s.lon]).addTo(markersLayer); m.bindPopup(`<div class='card'><b>${escapeHtml(s.name)}</b><br/>${escapeHtml(s.details||'')}<div style='margin-top:6px'><a class='chip' href='https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}' target='_blank' rel='noopener'>Route</a></div></div>`); }); if(state.pos){ if(!userMarker) userMarker=L.marker([state.pos.lat,state.pos.lon],{opacity:0.6}).addTo(map); else userMarker.setLatLng([state.pos.lat,state.pos.lon]); map.setView([state.pos.lat,state.pos.lon], 11, {animate:true}); }}

// Utils
function distKm(a,b,c,d){ const R=6371; const dLat=toRad(c-a), dLon=toRad(d-b); const x=Math.sin(dLat/2)**2 + Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function toRad(x){return x*Math.PI/180}
function makeId(name,lat,lon,cat){ const base=(name||'')+'|'+Number(lat).toFixed(6)+'|'+Number(lon).toFixed(6)+'|'+(cat||''); let h=0; for(let i=0;i<base.length;i++){ h=((h<<5)-h)+base.charCodeAt(i); h|=0;} return String(h) }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Testdaten
function injectSampleData(){ if(!state.pos){ showError('Keine Position – Testdaten benötigen eine Position.'); return; } const p=state.pos; const add=(lat,lon,name,category,details)=>({id:makeId(name,lat,lon,category),name,lat,lon,category,details,source:'Sample'}); const d=0.12; const arr=[ add(p.lat+d*0.2,p.lon+d*0.1,'Taverna Nikos','restaurant','Küche: greek · €-€€ · lokal'), add(p.lat-d*0.15,p.lon+d*0.05,'Ouzeri Marina','restaurant','Küche: seafood · €-€€ · lokal'), add(p.lat+d*0.05,p.lon-d*0.06,'Küstenpfad','hike','3.5 km · kompakt'), add(p.lat-d*0.08,p.lon-d*0.08,'Kiefern-Rundweg','hike','6.0 km · Schatten'), add(p.lat+d*0.1,p.lon+d*0.12,'Bucht Agios','beach','teils Schatten'), add(p.lat-d*0.12,p.lon-d*0.1,'Schnorchelstelle Riff','swim','klar, Fels'), add(p.lat+d*0.09,p.lon-d*0.02,'Freier Stellplatz','camperFree','ruhig, eben'), add(p.lat-d*0.02,p.lon+d*0.09,'Camping Akropolis','camperCampground','Duschen, Strom') ]; const cache=cacheStore.load(); const key=cellKey(p.lat,p.lon); cache[key]={ts:Date.now(),spots:arr}; cacheStore.save(cache); state.spots=mergeImported(arr); renderAll(); logDiag('INFO','Testdaten injiziert: '+arr.length); }

// Import/Export Minimal (CSV)
$('#file-input')?.addEventListener('change', async ev=>{ const f=ev.target.files[0]; if(!f) return; const text=await f.text(); const spots=[]; text.split(/
|/).forEach((line,i)=>{ if(i===0 && line.includes(',')) return; const m=line.match(/"?([^,]+)"?,([^,]+),([^,]+),([^,]+),?(.*)/); if(!m) return; const name=m[1], lat=parseFloat(m[2]), lon=parseFloat(m[3]), cat=m[4]; const details=m[5]||''; if(!isFinite(lat)||!isFinite(lon)) return; spots.push({id:makeId(name,lat,lon,cat),name,lat,lon,category:cat,details,source:'CSV'}); }); if(spots.length){ state.imported = (state.imported||[]).concat(spots); storage.save(); state.spots=mergeImported(state.spots); renderAll(); showToast('Import ok: '+spots.length); }});
$('#btn-paste')?.addEventListener('click', async()=>{ try{ const t=await navigator.clipboard.readText(); if(!t){ $('#import-msg').textContent='Zwischenablage leer.'; return; } const m=t.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/); if(!m){ $('#import-msg').textContent='Keine Koordinaten erkannt.'; return;} const lat=parseFloat(m[1]),lon=parseFloat(m[2]); const s={id:makeId(`Punkt ${lat},${lon}`,lat,lon,'camperFree'),name:`Punkt ${lat.toFixed(4)},${lon.toFixed(4)}`,lat,lon,category:'camperFree',details:'aus Zwischenablage'}; state.imported.push(s); storage.save(); state.spots=mergeImported(state.spots); renderAll(); $('#import-msg').textContent='1 Punkt hinzugefügt.'; }catch(e){ $('#import-msg').textContent='Zwischenablage nicht verfügbar.'; }});
$('#btn-add-manual')?.addEventListener('click',()=>{ const name=prompt('Name des Spots'); if(!name) return; const lat=parseFloat(prompt('Breite (lat)')||''); if(Number.isNaN(lat)) return; const lon=parseFloat(prompt('Länge (lon)')||''); if(Number.isNaN(lon)) return; const category=prompt('Kategorie (culture,beach,hike,swim,camperFree,camperCampground,restaurant,playground,shop,service)','camperFree')||'camperFree'; const details=prompt('Details (optional)')||''; const s={id:makeId(name,lat,lon,category),name,lat,lon,category,details,source:'Manual'}; state.imported.push(s); storage.save(); state.spots=mergeImported(state.spots); renderAll(); });
$('#btn-export-csv')?.addEventListener('click',()=>downloadFile('spots.csv',toCSV(state.imported.length?state.imported:state.spots)));
$('#btn-export-gpx')?.addEventListener('click',()=>downloadFile('spots.gpx',toGPX(state.imported.length?state.imported:state.spots)));
function downloadFile(filename,content){ const blob=new Blob([content],{type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function toCSV(spots){ const esc=s=>'"'+String(s||'').replace(/"/g,'""')+'"'; const rows=[['name','lat','lon','category','details']].concat(spots.map(s=>[s.name,s.lat,s.lon,s.category,s.details||''])); return rows.map(r=>r.map(esc).join(',')).join('
'); }
function toGPX(spots){ const header='<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FriOlKa" xmlns="http://www.topografix.com/GPX/1/1">'; const wpts=spots.map(s=>`<wpt lat='${s.lat}' lon='${s.lon}'><name>${escapeHtml(s.name)}</name>${s.details?`<desc>${escapeHtml(s.details)}</desc>`:''}</wpt>`).join(''); return header+wpts+'</gpx>'; }

// Start
document.addEventListener('DOMContentLoaded', async()=>{ renderQuickSearch(); try{ if(navigator.permissions&&navigator.permissions.query){ const p=await navigator.permissions.query({name:'geolocation'}); if(p.state==='granted'){ await ensureLocation(); ensureDataAndMaybeFetch(); renderAll(); } else { renderNearby(); } } }catch{ renderNearby(); }});
