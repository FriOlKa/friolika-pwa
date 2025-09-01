
(function(){
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  function logDiag(k,m){const box=$('#diag'); if(!box) return; box.classList.remove('hidden'); const pre=box.querySelector('pre')||document.createElement('pre'); if(!pre.parentElement){ box.innerHTML='<b>Diagnose</b><pre></pre>'; box.appendChild(pre);} pre.textContent=(pre.textContent?pre.textContent+'
':'')+`[${new Date().toLocaleTimeString()}] ${k}: ${m}`}
  function setGeoState(t){const p=$('#geo-state'); if(p) p.textContent=t}
  function showToast(m){const t=$('#toast'); if(!t) return; t.textContent=m; t.style.display='block'; setTimeout(()=>t.style.display='none',1500)}

  // Safe init after DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init, {once:true});
  function init(){
    // Fallback: if JS didn't run earlier, anchors (#tab-*) still work due to href fix.
    bindNav(); bindToggles(); bindNetTest(); if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
    renderQuickSearch();
  }

  function bindNav(){
    // Kacheln und Tabs
    document.addEventListener('click', e=>{ const a=e.target.closest('.tile[data-go]'); if(!a) return; e.preventDefault(); const tab=a.getAttribute('data-go'); activateTab(tab); });
    $$('.tabs button').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tab)));
    function activateTab(tab){ $$('.tabs button').forEach(x=>x.classList.remove('active')); document.querySelector(`.tabs button[data-tab="${tab}"]`)?.classList.add('active'); $$('.tab').forEach(t=>t.classList.remove('active')); $('#tab-'+tab)?.classList.add('active'); logDiag('NAV','Tab '+tab); }
  }

  function bindToggles(){
    $('#btn-refresh')?.addEventListener('click',()=>getLocation());
    $('#btn-pick-location')?.addEventListener('click',manualLocationPrompt);
    $('#btn-grant')?.addEventListener('click',()=>{ getLocation(); });
    $('#btn-reset')?.addEventListener('click', async ()=>{ try{ const regs=await navigator.serviceWorker?.getRegistrations?.(); regs&&regs.forEach(r=>r.unregister()); localStorage.clear(); showToast('Reset – neu laden'); setTimeout(()=>location.reload(),500);}catch{location.reload();}});
  }

  function bindNetTest(){ $('#btn-nettest')?.addEventListener('click', async()=>{ let lines=[]; try{ const r1=await fetch('https://overpass-api.de/api/status'); lines.push('Overpass: '+r1.status);}catch(e){lines.push('Overpass: FAIL');} try{ const r2=await fetch('https://tile.openstreetmap.org/0/0/0.png'); lines.push('OSM tiles: '+r2.status);}catch(e){lines.push('OSM tiles: FAIL');} logDiag('NET',lines.join(' | ')); showToast('Netztest ok'); }); }

  // Geolocation minimal (nur Anzeige + manueller Fallback)
  async function getLocation(){ if(!navigator.geolocation){ setGeoState('Nicht unterstützt'); manualLocationPrompt(); return; } setGeoState('Ortung…'); navigator.geolocation.getCurrentPosition(p=>{ setGeoState('OK'); logDiag('GEO',`ok ${p.coords.latitude.toFixed(4)},${p.coords.longitude.toFixed(4)}`); }, err=>{ setGeoState('Fehler'); logDiag('GEO','Fehler '+err.message); manualLocationPrompt(); }, {enableHighAccuracy:true,timeout:12000,maximumAge:0}); }
  function manualLocationPrompt(){ const lat=prompt('Breite (lat)'); if(lat===null) return; const lon=prompt('Länge (lon)'); if(lon===null) return; const la=parseFloat(lat), lo=parseFloat(lon); if(isFinite(la)&&isFinite(lo)){ setGeoState('OK'); logDiag('GEO','manuell '+la+','+lo); showToast('Ort gesetzt'); } }

  // Chips (Deep Links)
  function renderQuickSearch(){ const box=$('#quick-search'); if(!box) return; const chips=[['Taverna','taverna'],['Pizzeria','pizzeria'],['Cafe','cafe'],['Strand','strand beach'],['Schnorcheln','snorkeling'],['Wanderung','hiking trail'],['Spielplatz','playground'],['Supermarkt','supermarket']]; box.innerHTML=''; chips.forEach(([lbl,q])=>{ const a=document.createElement('a'); a.className='chip'; a.href='#'; a.textContent=lbl; a.addEventListener('click',e=>{ e.preventDefault(); window.open('https://www.google.com/maps/search/'+encodeURIComponent(q),'_blank','noopener');}); box.appendChild(a);}); }
})();
