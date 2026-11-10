// Gasolineras VILLVERG — precios oficiales del Ministerio (Geoportal de carburantes)
// para las furgonetas de okservice. Sin dependencias: Node 20+.
//
// Uso: node generar.mjs            → descarga, guarda histórico y genera docs/
//      node generar.mjs fichero.json [fichero2.json]  → usa JSON ya descargados (pruebas)
//
// Si la descarga falla o viene incompleta, sale con error y NO toca lo publicado.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const API = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroProvincia/';
const PROVINCIAS = ['38', '35']; // Santa Cruz de Tenerife, Las Palmas
const MINIMO_ESTACIONES = 300;   // hoy hay ~490; menos = respuesta parcial
const HISTORICO = 'datos/historico.csv';
const DEPOSITO_L = 60;

const COMBUSTIBLES = {
  gasoleo: { nombre: 'Gasóleo A', campo: 'Precio Gasoleo A' },
  g95: { nombre: 'Gasolina 95', campo: 'Precio Gasolina 95 E5' },
};

// Zona de trabajo habitual de okservice (sur de Tenerife)
const SUR = ['ADEJE', 'ARONA', 'SAN MIGUEL DE ABONA', 'GRANADILLA DE ABONA', 'GUIA DE ISORA',
  'VILAFLOR DE CHASNA', 'ARICO', 'SANTIAGO DEL TEIDE'];

// La tarjeta SOLRED es de Repsol: vale en la red Repsol / Campsa / Petronor
const SOLRED = /REPSOL|CAMPSA|PETRONOR/i;

const num = (s) => (s ? Number(String(s).replace(',', '.')) : null);
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

// Isla por coordenadas: no depende de cómo escriba el Ministerio el municipio
function isla(lat, lon) {
  if (lon > -14.6) return lat > 28.75 ? 'Lanzarote' : 'Fuerteventura';
  if (lon > -16.0) return 'Gran Canaria';
  if (lon > -16.95) return 'Tenerife';
  if (lat < 27.9) return 'El Hierro';
  if (lon > -17.45) return 'La Gomera';
  return 'La Palma';
}

async function descargar(provincia) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(API + provincia, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      console.error(`Provincia ${provincia}, intento ${intento}/3: ${e.message}`);
      if (intento < 3) await new Promise((ok) => setTimeout(ok, 15_000 * intento));
    }
  }
  throw new Error(`No se pudo descargar la provincia ${provincia}`);
}

function limpiar(listas) {
  const estaciones = [];
  for (const e of listas.flatMap((d) => d.ListaEESSPrecio)) {
    const lat = num(e.Latitud), lon = num(e['Longitud (WGS84)']);
    if (!lat || !lon) continue;
    const precios = {};
    for (const [k, c] of Object.entries(COMBUSTIBLES)) precios[k] = num(e[c.campo]);
    if (!precios.gasoleo && !precios.g95) continue;
    estaciones.push({
      id: e.IDEESS,
      rotulo: e['Rótulo'].trim(),
      direccion: e['Dirección'].trim(),
      municipio: e.Municipio.trim(),
      isla: isla(lat, lon),
      sur: SUR.includes(sinTildes(e.Municipio)),
      solred: SOLRED.test(e['Rótulo']),
      horario: e.Horario,
      lat, lon, ...precios,
    });
  }
  return estaciones;
}

// Histórico: fecha,id,gasoleo,g95 — una foto por día
function leerHistorico() {
  if (!existsSync(HISTORICO)) return [];
  return readFileSync(HISTORICO, 'utf8').trim().split('\n').slice(1).map((l) => {
    const [fecha, id, gasoleo, g95] = l.split(',');
    return { fecha, id, gasoleo: num(gasoleo), g95: num(g95) };
  });
}

function guardarHistorico(filas, hoy, estaciones) {
  const otras = filas.filter((f) => f.fecha !== hoy);
  const nuevas = estaciones.map((e) => ({ fecha: hoy, id: e.id, gasoleo: e.gasoleo, g95: e.g95 }));
  const csv = ['fecha,id,gasoleo,g95', ...[...otras, ...nuevas].map((f) => [f.fecha, f.id, f.gasoleo ?? '', f.g95 ?? ''].join(','))];
  mkdirSync('datos', { recursive: true });
  writeFileSync(HISTORICO, csv.join('\n') + '\n');
}

const media = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const masBarata = (lista, k) => lista.filter((e) => e[k]).sort((a, b) => a[k] - b[k])[0];
const eur = (n, d = 3) => n.toFixed(d).replace('.', ',');

function resumen(estaciones, fecha) {
  const sur = estaciones.filter((e) => e.sur);
  const out = { fecha, deposito_litros: DEPOSITO_L, sur_tenerife: {} };
  for (const k of Object.keys(COMBUSTIBLES)) {
    const conPrecio = sur.filter((e) => e[k]);
    const barata = masBarata(conPrecio, k), solred = masBarata(conPrecio.filter((e) => e.solred), k);
    const m = media(conPrecio.map((e) => e[k]));
    out.sur_tenerife[k] = {
      combustible: COMBUSTIBLES[k].nombre,
      estaciones: conPrecio.length,
      media: +m.toFixed(3),
      mas_barata: barata && { rotulo: barata.rotulo, direccion: barata.direccion, municipio: barata.municipio, precio: barata[k] },
      solred_mas_barata: solred && { rotulo: solred.rotulo, direccion: solred.direccion, municipio: solred.municipio, precio: solred[k] },
      ahorro_deposito_vs_media: +((m - barata[k]) * DEPOSITO_L).toFixed(2),
    };
  }
  return out;
}

function html(estaciones, res) {
  const g = res.sur_tenerife.gasoleo;
  const datos = JSON.stringify(estaciones).replace(/</g, '\\u003c');
  const tile = (titulo, valor, pie) => `<div class="tile"><div class="t">${titulo}</div><div class="v">${valor}</div><div class="p">${pie}</div></div>`;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gasolineras · okservice</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
body{font-family:system-ui,sans-serif;margin:0;color:#1d2433;background:#f6f7f9}
header{padding:14px 16px;background:#0f2a4a;color:#fff}h1{margin:0;font-size:1.2rem}
header small{opacity:.8}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;padding:12px 16px}
.tile{background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 3px #0001}
.t{font-size:.8rem;color:#5b6475}.v{font-size:1.5rem;font-weight:700;margin:4px 0}.p{font-size:.85rem}
.ctrl{padding:0 16px 8px;display:flex;gap:8px;flex-wrap:wrap}
select,label{font-size:1rem;padding:6px}#mapa{height:55vh;margin:0 16px;border-radius:10px}
table{width:calc(100% - 32px);margin:12px 16px 24px;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden}
td,th{padding:8px;border-bottom:1px solid #eef0f3;text-align:left;font-size:.92rem}
th{background:#eef0f3}.sol{background:#ff8200;color:#fff;border-radius:4px;padding:1px 5px;font-size:.75rem}
.sube{color:#c62828}.baja{color:#2e7d32}a{color:#0f5bb5}
</style></head><body>
<header><h1>⛽ Gasolineras · okservice</h1>
<small>Precios oficiales del Ministerio a ${esc(res.fecha)} · se actualiza solo cada mañana</small></header>
<div class="tiles">
${tile('Gasoil más barato · sur de Tenerife', eur(g.mas_barata.precio) + ' €/L', esc(`${g.mas_barata.rotulo} · ${g.mas_barata.municipio}`))}
${g.solred_mas_barata ? tile('Con tarjeta SOLRED (Repsol/Campsa)', eur(g.solred_mas_barata.precio) + ' €/L', esc(`${g.solred_mas_barata.rotulo} · ${g.solred_mas_barata.direccion}, ${g.solred_mas_barata.municipio}`)) : ''}
${tile(`Ahorro por depósito de ${DEPOSITO_L} L`, eur(g.ahorro_deposito_vs_media, 2) + ' €', `frente a la media del sur (${eur(g.media)} €/L)`)}
</div>
<div class="ctrl">
<select id="isla"></select>
<select id="comb"><option value="gasoleo">Gasóleo A</option><option value="g95">Gasolina 95</option></select>
<label><input type="checkbox" id="sur" checked> Solo sur de Tenerife</label>
<label><input type="checkbox" id="solred"> Solo SOLRED</label>
</div>
<div id="mapa"></div>
<table><thead><tr><th>#</th><th>Gasolinera</th><th>€/L</th><th>vs ayer</th><th></th></tr></thead><tbody id="tabla"></tbody></table>
<script>
const E=${datos};
const $=id=>document.getElementById(id);
const islas=[...new Set(E.map(e=>e.isla))].sort();
$('isla').innerHTML=islas.map(i=>'<option'+(i==='Tenerife'?' selected':'')+'>'+i+'</option>').join('');
const mapa=L.map('mapa');L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(mapa);
const capa=L.layerGroup().addTo(mapa);
const f=n=>n.toFixed(3).replace('.',',');
const t=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function pinta(){
  const k=$('comb').value,ais=$('isla').value,soloSur=$('sur').checked&&ais==='Tenerife',soloSol=$('solred').checked;
  const L1=E.filter(e=>e.isla===ais&&e[k]&&(!soloSur||e.sur)&&(!soloSol||e.solred)).sort((a,b)=>a[k]-b[k]);
  capa.clearLayers();if(!L1.length){$('tabla').innerHTML='<tr><td colspan=5>Sin estaciones con ese filtro</td></tr>';return}
  const q1=L1[Math.floor(L1.length*.25)][k],q3=L1[Math.floor(L1.length*.75)][k];
  for(const e of L1){
    const col=e[k]<=q1?'#2e7d32':e[k]>=q3?'#c62828':'#f9a825';
    L.circleMarker([e.lat,e.lon],{radius:8,color:'#fff',weight:1.5,fillColor:col,fillOpacity:.95})
     .bindPopup('<b>'+t(e.rotulo)+'</b>'+(e.solred?' <span class=sol>SOLRED</span>':'')+'<br>'+t(e.direccion)+', '+t(e.municipio)+'<br><b>'+f(e[k])+' €/L</b><br>'+t(e.horario)+'<br><a target=_blank href="https://www.google.com/maps/dir/?api=1&destination='+e.lat+','+e.lon+'">Cómo llegar</a>').addTo(capa);
  }
  mapa.fitBounds(L1.map(e=>[e.lat,e.lon]),{padding:[20,20]});
  $('tabla').innerHTML=L1.slice(0,15).map((e,i)=>{const d=e.ayer&&e.ayer[k]!=null?e[k]-e.ayer[k]:null;
    const v=d==null||Math.abs(d)<.0005?'=':(d>0?'<span class=sube>▲ '+f(d)+'</span>':'<span class=baja>▼ '+f(-d)+'</span>');
    return '<tr><td>'+(i+1)+'</td><td><b>'+t(e.rotulo)+'</b>'+(e.solred?' <span class=sol>SOLRED</span>':'')+'<br><small>'+t(e.direccion)+', '+t(e.municipio)+'</small></td><td><b>'+f(e[k])+'</b></td><td>'+v+'</td><td><a target=_blank href="https://www.google.com/maps/dir/?api=1&destination='+e.lat+','+e.lon+'">Ir</a></td></tr>'}).join('');
}
['isla','comb','sur','solred'].forEach(id=>$(id).onchange=pinta);pinta();
</script></body></html>`;
}

async function main() {
  const ficheros = process.argv.slice(2);
  const listas = ficheros.length
    ? ficheros.map((f) => JSON.parse(readFileSync(f, 'utf8')))
    : await Promise.all(PROVINCIAS.map(descargar));
  const estaciones = limpiar(listas);
  if (estaciones.length < MINIMO_ESTACIONES) {
    throw new Error(`Solo ${estaciones.length} estaciones (mínimo ${MINIMO_ESTACIONES}): respuesta parcial, no publico`);
  }
  // "10/11/2026 9:05:12" → 2026-11-10
  const [d, m, a] = listas[0].Fecha.split(' ')[0].split('/');
  const hoy = `${a}-${m}-${d}`;

  const filas = leerHistorico();
  const anterior = filas.filter((f) => f.fecha < hoy).map((f) => f.fecha).sort().pop();
  const ayer = new Map(filas.filter((f) => f.fecha === anterior).map((f) => [f.id, f]));
  for (const e of estaciones) {
    const p = ayer.get(e.id);
    if (p) e.ayer = { gasoleo: p.gasoleo, g95: p.g95 };
  }
  guardarHistorico(filas, hoy, estaciones);

  const res = resumen(estaciones, listas[0].Fecha);
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/resumen.json', JSON.stringify(res, null, 2) + '\n');
  writeFileSync('docs/index.html', html(estaciones, res));
  const g = res.sur_tenerife.gasoleo;
  console.log(`${estaciones.length} estaciones · gasoil sur: ${g.mas_barata.rotulo} ${g.mas_barata.municipio} ${g.mas_barata.precio} €/L · SOLRED ${g.solred_mas_barata?.precio} · media ${g.media} · ahorro/depósito ${g.ahorro_deposito_vs_media} €`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
