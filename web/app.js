'use strict';

// ===== 外部サービス =====
const VALHALLA = 'https://valhalla1.openstreetmap.de';
const PHOTON = 'https://photon.komoot.io/api/';
const GSI_SEARCH = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

// ===== 設定 =====
const DEFAULTS = { theme: 'auto', vehicle: '1', speed: 30, primary: '0.5', hills: '0.5', turns: '0', avoidReg: true, avoidTwoStage: true, voice: true, voiceType: 'zundamon', showReg: true };
const settings = Object.assign({}, DEFAULTS, load('settings', {}));
function load(k, d) { try { return JSON.parse(localStorage.getItem('gt.' + k)) ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem('gt.' + k, JSON.stringify(v)); } catch {} }

// ===== DOM =====
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) e.append(c);
  return e;
};
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), ms);
}
const fmtDist = (m) => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m / 10) * 10 + ' m';
const fmtTime = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ===== 地図 =====
// OpenFreeMap（OpenStreetMap のベクトル地図）を日本語表示にして、店などのアイコンを消して使う
const ll = (p) => [p[1], p[0]];             // [lat, lon] → MapLibre の [lng, lat]
const lineFeature = (pts, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts.map(ll) } });
const fc = (features) => ({ type: 'FeatureCollection', features });

const map = new maplibregl.Map({
  container: 'map', center: [139.767, 35.681], zoom: 13, maxZoom: 19,
  style: { version: 8, sources: {}, layers: [] }, attributionControl: false,
});
const isDesktop = matchMedia('(hover: hover) and (pointer: fine)').matches;
map.addControl(new maplibregl.AttributionControl({ compact: true }), isDesktop ? 'bottom-right' : 'bottom-left');
if (isDesktop) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

// 自前で描くもの（スタイルを切り替えても描き直せるように、データはここに持っておく）
const overlay = { alts: fc([]), route: fc([]), regLines: fc([]), regPoints: fc([]), regApprox: fc([]), meAcc: fc([]) };
function setOverlay(name, data) {
  overlay[name] = data;
  map.getSource(name)?.setData(data);
}
function addOverlays() {
  for (const [name, data] of Object.entries(overlay)) if (!map.getSource(name)) map.addSource(name, { type: 'geojson', data });
  const regVis = settings.showReg ? 'visible' : 'none';
  const regColor = ['case', ['get', 'active'], '#d32f2f', '#e57373'];
  map.addLayer({ id: 'me-acc', type: 'fill', source: 'meAcc', paint: { 'fill-color': '#1e88e5', 'fill-opacity': 0.12, 'fill-outline-color': '#1e88e5' } });
  map.addLayer({ id: 'reg-approx', type: 'fill', source: 'regApprox', minzoom: 14, layout: { visibility: regVis }, paint: { 'fill-color': regColor, 'fill-opacity': 0.1, 'fill-outline-color': regColor } });
  map.addLayer({ id: 'reg-lines', type: 'line', source: 'regLines', minzoom: 14, layout: { visibility: regVis, 'line-cap': 'round' }, paint: { 'line-color': regColor, 'line-width': 3, 'line-dasharray': [0.5, 2] } });
  map.addLayer({ id: 'reg-points', type: 'circle', source: 'regPoints', minzoom: 14, layout: { visibility: regVis }, paint: { 'circle-radius': 5, 'circle-color': regColor, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'alts', type: 'line', source: 'alts', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9aa8a0', 'line-width': 6, 'line-opacity': 0.85 } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': isDark() ? '#12301f' : '#ffffff', 'line-width': 11 } });
  map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': isDark() ? '#5fd690' : '#2f8f5b', 'line-width': 7 } });
}

// テーマ: 自動（スマホの設定に合わせる）/ ライト / ダーク
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => settings.theme === 'dark' || (settings.theme === 'auto' && darkMQ.matches);
function applyTheme() {
  document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = isDark() ? '#1d2733' : '#ffffff';
  $('#btn-theme').textContent = { auto: '◐', light: '☀', dark: '☾' }[settings.theme];
  loadBaseStyle().catch(() => toast('地図を読み込めませんでした'));
}
$('#btn-theme') && ($('#btn-theme').onclick = () => {
  settings.theme = { auto: 'light', light: 'dark', dark: 'auto' }[settings.theme];
  save('settings', settings);
  applyTheme();
  toast({ auto: '表示: 自動（スマホの設定に合わせる）', light: '表示: ライト', dark: '表示: ダーク' }[settings.theme]);
});

// 夜用の配色（Googleマップの夜モードに近い紺〜グレー系）。昼用の地図の色を差し替えて作る
const NIGHT = [
  [/^background$/, { 'background-color': '#242f3e' }],
  [/^natural_earth$/, { 'raster-opacity': 0.15 }],
  [/^(park|landcover_(wood|grass|wetland)|landuse_(pitch|track|cemetery))$/, { 'fill-color': '#263c3f', 'fill-outline-color': '#263c3f' }],
  [/^park_outline$/, { 'line-color': '#2c4447' }],
  [/^landuse_residential$/, { 'fill-color': '#27313f' }],
  [/^(landuse_|landcover_|aeroway_fill)/, { 'fill-color': '#2a3444' }],
  [/^water$/, { 'fill-color': '#17263c' }],
  [/^waterway/, { 'line-color': '#17263c' }],
  [/^building$/, { 'fill-color': '#2c3646', 'fill-outline-color': '#323d4f' }],
  [/^aeroway_(runway|taxiway)/, { 'line-color': '#3a4454' }],
  [/rail/, { 'line-color': '#3a4454' }],
  [/casing$/, { 'line-color': '#1b2330' }],
  [/motorway/, { 'line-color': '#8a6d4a' }],
  [/trunk_primary/, { 'line-color': '#6e6352' }],
  [/(secondary_tertiary|_link$)/, { 'line-color': '#55606f' }],
  [/(minor|street|service_track)/, { 'line-color': '#3d4858' }],
  [/path_pedestrian/, { 'line-color': '#344050' }],
  [/^boundary/, { 'line-color': '#4b6878' }],
];
function nightify(style) {
  for (const l of style.layers) {
    const p = (l.paint ??= {});
    if (l.type === 'symbol') {
      p['text-color'] = /water/.test(l.id) ? '#6d8bb5' : /highway/.test(l.id) ? '#9aa6b5' : /transit/.test(l.id) ? '#8fb3d9' : /label_(city|town|state)/.test(l.id) ? '#e3e7ec' : '#c3cad3';
      p['text-halo-color'] = '#1b2430';
      continue;
    }
    const rule = NIGHT.find(([re]) => re.test(l.id));
    if (rule) for (const [k, v] of Object.entries(rule[1])) if (k.split('-')[0] === l.type || l.type === 'background' || l.type === 'raster') p[k] = v;
  }
  return style;
}

const styleCache = {};
const JA_NAME = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
// 道路の正式名 → 通称（例: 八王子五日市線 → 秋川街道）
// 地図データの alt_name を Nominatim で調べて端末に覚えておく
const aliasCache = load('roadAliasCache', {}); // 正式名 → 通称（通称なしは ''）
const myRoadNames = load('myRoadNames', {});   // 自分で付けた呼び名（いちばん優先）
const allAliases = () => {
  const out = {};
  for (const [k, v] of Object.entries(aliasCache)) if (v) out[k] = v;
  return Object.assign(out, myRoadNames);
};
function roadNameExpr() {
  const pairs = Object.entries(allAliases()).flat();
  return pairs.length ? ['match', JA_NAME, ...pairs, JA_NAME] : JA_NAME;
}
// 案内文の正式名を通称に。長い名前から置き換える（短い名前が長い名前の一部のことがあるため）
const useCommonNames = (t) => t && Object.entries(allAliases()).sort((a, b) => b[0].length - a[0].length)
  .reduce((acc, [a, b]) => acc.split(a).join(b), t);

const aliasQueue = new Map();
let aliasBusy = false;
// 「〜線」で終わる名前（都道・県道の正式名）だけ調べる
function requestAlias(name, near) {
  if (!name || !/線$/.test(name) || name in aliasCache || name in myRoadNames || aliasQueue.has(name)) return;
  aliasQueue.set(name, near);
  pumpAliases();
}
async function pumpAliases() {
  if (aliasBusy) return;
  aliasBusy = true;
  let changed = false;
  while (aliasQueue.size) {
    const [name, near] = aliasQueue.entries().next().value;
    aliasQueue.delete(name);
    try {
      // 同じ正式名が別の県にもあるので、近くに絞って探す
      const d = 0.3;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&namedetails=1&limit=5&accept-language=ja&countrycodes=jp`
        + `&viewbox=${near[1] - d},${near[0] + d},${near[1] + d},${near[0] - d}&bounded=1&q=${encodeURIComponent(name)}`;
      const j = await fetch(url).then((r) => r.json());
      const nd = j.map((r) => r.namedetails || {}).find((n) => (n['name:ja'] || n.name) === name && (n['alt_name:ja'] || n.alt_name || n['loc_name:ja'] || n.loc_name));
      const alt = nd ? (nd['alt_name:ja'] || nd.alt_name || nd['loc_name:ja'] || nd.loc_name).split(';')[0].trim() : '';
      aliasCache[name] = alt;
      if (alt) changed = true;
    } catch { /* 通信エラーは覚えずに次回また調べる */ }
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim は 1 秒に 1 回まで
  }
  save('roadAliasCache', aliasCache);
  aliasBusy = false;
  if (changed) applyAliases();
}
// 新しく分かった通称を地図の文字と案内文に反映
function applyAliases() {
  const expr = roadNameExpr();
  for (const st of Object.values(styleCache)) for (const l of st.layers) if (/^highway-name/.test(l.id)) l.layout['text-field'] = expr;
  for (const l of map.getStyle()?.layers || []) if (/^highway-name/.test(l.id)) map.setLayoutProperty(l.id, 'text-field', expr);
  for (const c of candidates) for (const L of c.legs) L.maneuvers.forEach(cleanManeuver);
  if (current) renderSheet(candidates.indexOf(current));
}
// 画面に出ている道路名も調べる（moveend の時点では文字がまだ描かれていないことがあるので、描き終わった idle で）
map.on('idle', () => {
  if (map.getZoom() < 12 || !map.getStyle()) return;
  const c = map.getCenter();
  const names = new Set(map.queryRenderedFeatures().filter((f) => /^highway-name/.test(f.layer.id)).map((f) => f.properties['name:ja'] || f.properties.name));
  [...names].filter((n) => n && /線$/.test(n)).slice(0, 10).forEach((n) => requestAlias(n, [c.lat, c.lng]));
});
let baseStyleSeq = 0;
async function loadBaseStyle() {
  const name = isDark() ? 'night' : 'day';
  const my = ++baseStyleSeq;
  if (!styleCache[name]) {
    const style = await fetch('https://tiles.openfreemap.org/styles/liberty').then((r) => r.json());
    // 店などのアイコンと 3D の建物は消す（走行中に見やすいように）
    style.layers = style.layers.filter((l) => !/^poi_r/.test(l.id) && l.type !== 'fill-extrusion');
    // 道路番号の標識は間隔をあけて数を減らす
    for (const l of style.layers) if (/shield/.test(l.id)) Object.assign(l.layout, { 'symbol-spacing': 700 });
    for (const l of style.layers) {
      // 名前を出す文字だけ日本語にする（道路番号の標識は番号のまま）。道路名は通称に置き換える
      const tf = l.layout?.['text-field'];
      if (tf && JSON.stringify(tf).includes('name')) l.layout['text-field'] = /^highway-name/.test(l.id) ? roadNameExpr() : JA_NAME;
    }
    styleCache[name] = name === 'night' ? nightify(style) : style;
  }
  if (my === baseStyleSeq) map.setStyle(styleCache[name], { diff: false });
}
map.on('style.load', addOverlays);
darkMQ.addEventListener('change', () => settings.theme === 'auto' && applyTheme());
applyTheme();

let popup = null;
function openPopup(lngLat, content) {
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(lngLat);
  if (typeof content === 'string') popup.setHTML(content); else popup.setDOMContent(content);
  popup.addTo(map);
}
const htmlMarker = (html, latlng, opts = {}) => {
  const e = el('div'); e.innerHTML = html;
  return new maplibregl.Marker({ element: e.firstElementChild, ...opts }).setLngLat(ll(latlng)).addTo(map);
};
// パネルに隠れない範囲に収める
function mapPadding() {
  const wide = innerWidth >= 640;
  const sheet = $('#sheet').hidden ? innerHeight : $('#sheet').getBoundingClientRect().top;
  return {
    top: wide ? 30 : $('#search').getBoundingClientRect().bottom + 15,
    bottom: wide ? 30 : innerHeight - sheet + 15,
    left: wide ? $('#search').getBoundingClientRect().right + 30 : 25,
    right: 70,
  };
}
function fitRoute(latlngs) {
  let w = 180, e = -180, s = 90, n = -90;
  for (const [la, lo] of latlngs) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
  map.fitBounds([[w, s], [e, n]], { padding: mapPadding(), maxZoom: 17, duration: 600 });
}
const flyTo = (latlng, zoom) => map.easeTo({ center: ll(latlng), zoom: Math.max(map.getZoom(), zoom), duration: 600 });

// ===== 現在地 =====
let me = null; // {lat, lon, speed, heading, acc, rough}
const ROUGH_ACC = 500; // これより誤差が大きい現在地は出発地に使わない
let meMarker = null, firstFix = true;
const onPosition = [];
if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition((p) => {
    me = { lat: p.coords.latitude, lon: p.coords.longitude, speed: p.coords.speed, heading: p.coords.heading, acc: p.coords.accuracy, t: p.timestamp };
    // パソコンなど GPS のない端末は Wi-Fi や IP から推測した位置で、数 km ずれることがある
    me.rough = me.acc > ROUGH_ACC;
    if (!meMarker) meMarker = htmlMarker('<div class="me-marker"><div class="me-arrow"></div></div>', [me.lat, me.lon], { rotationAlignment: 'map' });
    else meMarker.setLngLat([me.lon, me.lat]);
    meMarker.getElement().classList.toggle('rough', me.rough);
    setOverlay('meAcc', fc(me.acc > 30 ? [circlePolygon([me.lat, me.lon], me.acc, {})] : []));
    if (firstFix && !current) map.jumpTo({ center: [me.lon, me.lat], zoom: me.rough ? 12 : 15 });
    $('#from').placeholder = me.rough ? '出発地を入力' : '出発地（空なら現在地）';
    if (firstFix && me.rough) toast(`この端末の現在地はおおよそです（誤差 約${fmtDist(me.acc)}）。出発地は入力してください`, 6000);
    firstFix = false;
    onPosition.forEach((f) => f(me));
  }, (e) => {
    if (!firstFix) return;
    firstFix = false;
    $('#from').placeholder = '出発地を入力';
    toast(e.code === 1 ? '位置情報が許可されていないので、出発地を入力してください' : '現在地を取得できませんでした。出発地を入力してください', 5000);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
$('#btn-locate').onclick = () => { if (me) flyTo([me.lat, me.lon], 16); else toast('現在地を取得中…'); };

// ===== 地点（出発・経由・目的地） =====
// place: {lat, lon, name} / from が null の場合は現在地
const places = { from: null, vias: [], to: null };
const recent = load('recent', []);
// マイスポット（長押しで名前を付けて保存）
const mySpots = load('myspots', []);
const normName = (t) => t.normalize('NFKC').replace(/\s/g, '').toLowerCase();
function matchSpots(q) {
  const n = normName(q);
  const hit = (sp) => [sp.name, ...(sp.aliases || [])].some((a) => normName(a).includes(n) || (n.length >= 3 && n.includes(normName(a))));
  // 名前が入力にぴったりのものを先に
  const exact = (sp) => [sp.name, ...(sp.aliases || [])].some((a) => normName(a) === n) ? 0 : 1;
  return mySpots.filter(hit).map((sp) => ({ ...sp, detail: 'マイスポット' + (sp.detail ? '・' + sp.detail : ''), spot: true }))
    .sort((a, b) => exact(a) - exact(b));
}

function setPlace(slot, place, input) {
  // 履歴やマイスポットの元データを、ピンのドラッグなどで書き換えないようにコピーして持つ
  place = place && { ...place };
  if (slot === 'from') places.from = place;
  else if (slot === 'to') places.to = place;
  else places.vias[slot] = place;
  if (input) input.value = place ? place.name : '';
  drawPins();
}
let pinMarkers = [];
function drawPins() {
  pinMarkers.forEach((m) => m.remove());
  pinMarkers = [];
  // ドラッグで位置を細かく直せる（住所検索は「〜番」までなので）
  const pin = (p, color) => {
    if (!p) return;
    const m = htmlMarker(`<div class="pin" style="background:${color}"></div>`, [p.lat, p.lon], { draggable: true });
    m.on('dragend', () => {
      const { lat, lng } = m.getLngLat();
      Object.assign(p, { lat, lon: lng });
      delete p.noVehicle; delete p.publicOnly; // 自分で決めた位置なので、そのまま目指す
      if (places.to && !nav.on) planRoute({ keepView: true });
    });
    pinMarkers.push(m);
  };
  pin(places.from, '#1e88e5');
  places.vias.forEach((v) => pin(v, '#8e8e8e'));
  pin(places.to, '#c62828');
}

function addViaField(place) {
  const i = places.vias.length;
  places.vias.push(place ? { ...place } : null);
  const input = el('input', { placeholder: '経由地を検索', autocomplete: 'off' });
  const rm = el('button', { className: 'rm', type: 'button', textContent: '✕', ariaLabel: '経由地を削除' });
  const row = el('div', { className: 'field' }, el('span', { className: 'dot via' }), input, rm);
  $('#vias').append(row);
  bindSearch(input, () => [...$('#vias').children].indexOf(row));
  rm.onclick = () => { places.vias.splice([...$('#vias').children].indexOf(row), 1); row.remove(); drawPins(); };
  if (place) input.value = place.name;
  else input.focus();
  return i;
}
$('#btn-via').onclick = () => addViaField();
$('#btn-swap').onclick = () => {
  const from = places.from || (me ? { lat: me.lat, lon: me.lon, name: '現在地' } : null);
  setPlace('from', places.to, $('#from'));
  setPlace('to', from, $('#to'));
};

// ===== 検索（候補） =====
const suggest = $('#suggest');
let suggestFor = null;

// 検索候補に出す種類
function placeKind(key, value) {
  const k = `${key}=${value}`;
  const table = [
    [/^natural=(peak|volcano)$/, '山頂'], [/^natural=/, '自然'],
    [/^(railway|public_transport)=(station|halt)$/, '駅'], [/^highway=bus_stop$/, 'バス停'],
    [/^amenity=motorcycle_parking$/, 'バイク駐車場'], [/^amenity=parking$/, '駐車場'], [/^amenity=fuel$/, 'ガソリンスタンド'],
    [/^amenity=toilets$/, 'トイレ'], [/^amenity=(restaurant|cafe|fast_food)$/, '飲食店'],
    [/^tourism=viewpoint$/, '展望'], [/^tourism=/, '観光'], [/^leisure=park$/, '公園'], [/^shop=/, '店'],
    [/^amenity=(place_of_worship)$/, '寺社'], [/^historic=/, '史跡'],
    [/^highway=(motorway_junction)$/, 'IC'], [/^highway=/, '道路'], [/^place=/, '地名'], [/^boundary=/, '地名'],
  ];
  return (table.find(([re]) => re.test(k)) || [])[1] || '';
}

async function searchPlaces(q, opts = {}) {
  const c = map.getCenter();
  const bias = me || { lat: c.lat, lon: c.lng };
  const photonQuery = (query, extra = '', suffix = '') => fetch(`${PHOTON}?q=${encodeURIComponent(query)}&limit=7&lang=default&lat=${bias.lat}&lon=${bias.lon}&bbox=122,20,154,46${extra}`)
    .then((r) => r.json())
    .then((j) => j.features.map((f) => {
      const p = f.properties;
      const area = [...new Set([p.state, p.city, p.district || p.locality, p.street].filter(Boolean))].join(' ');
      // 歩道・歩行者用の道は原付で入れないので一言そえる
      const foot = p.osm_key === 'highway' && /^(pedestrian|footway|path|steps|cycleway)$/.test(p.osm_value);
      const kind = placeKind(p.osm_key, p.osm_value);
      return {
        name: (p.name || p.street || area) + suffix,
        detail: (kind ? `［${kind}］` : '') + area + (foot ? '・歩行者用（原付は手前まで）' : ''),
        noVehicle: foot, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      };
    })).catch(() => []);
  // 地図データの駅名は「駅」なしで登録されているので、「〜駅」は駅に絞って探し直す
  const station = /.駅$/.test(q) ? photonQuery(q.slice(0, -1), '&osm_tag=railway:station', '駅').then((l) => l.slice(0, 3)) : Promise.resolve([]);
  const photon = Promise.all([station, photonQuery(q)]).then(([st, all]) => [...st, ...all]);
  const gsi = fetch(`${GSI_SEARCH}?q=${encodeURIComponent(q)}`)
    .then((r) => r.json())
    .then((j) => j.slice(0, 4).map((f, i) => {
      const title = f.properties.title;
      // 地理院の住所検索は「〜番」「〜番地」までしか返さない（号・枝番は捨てられる）。
      // 入力のほうが数字が多い（細かい）ときは、入力した住所のまま表示する
      const nums = (t) => (t.normalize('NFKC').match(/\d+|[一二三四五六七八九十]+丁目/g) || []).length;
      const finer = i === 0 && nums(q) > nums(title);
      return { name: finer ? q.trim() : title, detail: finer ? `住所・${title}の位置（ピンをドラッグで調整できます）` : '住所', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
    }))
    .catch(() => []);
  const [a, b] = await Promise.all([photon, gsi]);
  const spots = opts.noFallback ? [] : matchSpots(q);
  // マイスポットと同じ場所を指す検索結果は消す（名前ずれの元データ）
  const notNearSpot = (p) => !spots.some((sp) => haversine([sp.lat, sp.lon], [p.lat, p.lon]) < 80);
  // 住所っぽい入力なら地理院を優先
  const addressLike = /[都道府県市区町村丁目番]/.test(q) && /\d|[一二三四五六七八九十]丁目/.test(q);
  const list = dedupePlaces([...spots, ...(addressLike ? [...b, ...a] : [...a, ...b]).filter(notNearSpot)]);
  if (list.length || opts.noFallback) return list;
  // 見つからないとき: 別の検索サービス → 「旧」「新」などを外して再検索（地図上は「旧」なしの名前で登録されていることが多い）
  const nomi = await nominatimSearch(q);
  if (nomi.length) return nomi;
  const loose = q.replace(/^(旧|新|元|奥|東|西|南|北)/, '').replace(/(跡|跡地)$/, '').trim();
  if (loose !== q && loose.length >= 2) {
    const r = await searchPlaces(loose, { noFallback: true });
    return r.map((p) => ({ ...p, detail: `${p.detail}（「${loose}」で検索）` }));
  }
  return [];
}
// 同じ名前でほぼ同じ場所（200m以内）の候補は1つにまとめる
function dedupePlaces(list) {
  const out = [];
  for (const p of list) if (!out.some((o) => o.name === p.name && haversine([o.lat, o.lon], [p.lat, p.lon]) < 200)) out.push(p);
  return out;
}
async function nominatimSearch(q) {
  try {
    const j = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=jp&accept-language=ja&limit=5&q=${encodeURIComponent(q)}`).then((r) => r.json());
    return j.map((r) => ({ name: r.name || r.display_name.split(',')[0], detail: r.display_name.split(',').slice(1, 4).reverse().join(' '), lat: +r.lat, lon: +r.lon, kind: `${r.category}=${r.type}` }));
  } catch { return []; }
}

function showSuggestions(list, onPick) {
  suggest.replaceChildren(...list.map((p) => {
    const li = el('li', {}, p.name, el('small', { textContent: p.detail || '' }));
    li.onpointerdown = (e) => { e.preventDefault(); onPick(p); };
    return li;
  }));
  suggest.hidden = list.length === 0;
}

function bindSearch(input, slotFn) {
  let timer, seq = 0;
  const pick = (p) => {
    setPlace(slotFn(), p, input);
    suggest.hidden = true; input.blur();
    rememberRecent(p);
    if (places.to) planRoute();
    else flyTo([p.lat, p.lon], 15);
  };
  const run = async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) {
      const base = slotFn() === 'from' && me ? [{ name: '現在地', detail: 'GPS', current: true }] : [];
      showSuggestions([...base, ...mySpots.map((sp) => ({ ...sp, detail: 'マイスポット' })), ...recent], (p) => p.current ? (setPlace('from', null, input), suggest.hidden = true, input.blur(), places.to && planRoute()) : pick(p));
      return;
    }
    const list = await searchPlaces(q);
    if (my === seq && suggestFor === input) showSuggestions(list, pick);
  };
  input.addEventListener('focus', () => { suggestFor = input; run(); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
  input.addEventListener('blur', () => setTimeout(() => { if (suggestFor === input) suggest.hidden = true; }, 150));
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    suggestFor = input;
    const list = await searchPlaces(input.value.trim());
    // 候補が1つなら決定、複数なら一覧から選んでもらう（同名の別の場所に勝手に決めない）
    if (list.length === 1) pick(list[0]);
    else if (list.length) showSuggestions(list, pick);
    else toast('見つかりませんでした');
  });
}
bindSearch($('#from'), () => 'from');
bindSearch($('#to'), () => 'to');

function rememberRecent(p) {
  const i = recent.findIndex((r) => r.name === p.name && Math.abs(r.lat - p.lat) < 1e-4);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift({ name: p.name, detail: '履歴', lat: p.lat, lon: p.lon, noVehicle: p.noVehicle });
  recent.length = Math.min(recent.length, 8);
  save('recent', recent);
}

// 長押し / 右クリックで地点指定
async function placeMenu(lngLat) {
  const { lat, lng } = lngLat;
  const place = { lat, lon: lng, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
  const btn = (label, fn) => { const b = el('button', { textContent: label }); b.onclick = () => { popup?.remove(); fn(); }; return b; };
  const box = el('div', { className: 'menu' },
    el('div', { className: 'pname', textContent: place.name }),
    btn('ここへ行く', () => { setPlace('to', place, $('#to')); planRoute(); }),
    btn('ここから出発', () => { setPlace('from', place, $('#from')); if (places.to) planRoute(); }),
    btn('経由地にする', () => { addViaField(place); drawPins(); if (places.to) planRoute(); }),
    btn('★ 名前を付けて保存', () => {
      const name = prompt('この場所の名前（検索で一番上に出ます）', place.name);
      if (!name) return;
      mySpots.unshift({ name: name.trim(), lat: place.lat, lon: place.lon });
      save('myspots', mySpots);
      toast(`「${name.trim()}」をマイスポットに保存しました`);
    }));
  // 近くの道路名（正式名）があれば呼び名を変えられるようにする
  const pt = map.project(lngLat);
  const road = map.queryRenderedFeatures([[pt.x - 40, pt.y - 40], [pt.x + 40, pt.y + 40]])
    .filter((f) => /^highway-name/.test(f.layer.id)).map((f) => f.properties['name:ja'] || f.properties.name).find(Boolean);
  if (road) box.append(btn(`✎ 「${allAliases()[road] || road}」の呼び名を変える`, () => {
    const v = prompt(`「${road}」をなんと表示する？（空にすると元に戻す）`, allAliases()[road] || '');
    if (v === null) return;
    if (v.trim()) myRoadNames[road] = v.trim(); else delete myRoadNames[road];
    save('myRoadNames', myRoadNames);
    applyAliases();
    toast(v.trim() ? `「${road}」を「${v.trim()}」と表示します` : `「${road}」の呼び名を元に戻しました`);
  }));
  box.insertAdjacentHTML('beforeend', svLink(lat, lng));
  openPopup(lngLat, box);
  try {
    const j = await fetch(`${NOMINATIM_REVERSE}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=ja`).then((r) => r.json());
    if (j.display_name) {
      const a = j.address || {};
      place.name = j.name || [a.city || a.town || a.village, a.suburb || a.quarter || a.neighbourhood, a.road].filter(Boolean).join(' ') || j.display_name;
      box.querySelector('.pname').textContent = place.name;
    }
  } catch {}
}
map.on('contextmenu', (e) => placeMenu(e.lngLat));
// スマホ: 1本指で 0.5 秒押したまま動かさない
let pressTimer = null, pressStart = null;
map.on('touchstart', (e) => {
  clearTimeout(pressTimer);
  if (e.originalEvent.touches.length !== 1) return;
  pressStart = e.point;
  pressTimer = setTimeout(() => placeMenu(e.lngLat), 550);
});
map.on('touchmove', (e) => { if (pressStart && (Math.abs(e.point.x - pressStart.x) > 10 || Math.abs(e.point.y - pressStart.y) > 10)) clearTimeout(pressTimer); });
for (const ev of ['touchend', 'touchcancel', 'zoomstart']) map.on(ev, () => clearTimeout(pressTimer));

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  popup?.remove();
  suggest.hidden = true;
});

// ===== 規制区間データ =====
let regulations = [];
const regReady = fetch('data/regulations.json').then((r) => r.json()).then((j) => {
  regulations = j.items.filter((r) => !r.cancelled && r.points.length);
  // 上下線が別の行で登録されている区間（始点と終点が入れ替わった相方がいる）は方向つき規制として扱う
  const ends = (r) => [[r.points[0].lat, r.points[0].lon], [r.points.at(-1).lat, r.points.at(-1).lon]];
  for (const r of regulations) {
    if (r.points.length < 2) continue;
    const [a, b] = ends(r);
    r.hasTwin = regulations.some((o) => o !== r && o.points.length > 1 && haversine(ends(o)[0], b) < 300 && haversine(ends(o)[1], a) < 300);
  }
  $('#reg-date').textContent = j.fetched;
  drawRegulations();
}).catch(() => toast('規制区間データを読み込めませんでした'));

const normalize = (s) => s.replace(/[（）：０-９]/g, (c) => ({ '（': '(', '）': ')', '：': ':' }[c] || String.fromCharCode(c.charCodeAt(0) - 0xfee0)));

// この車種が規制対象か
function regApplies(r) {
  const t = normalize(r.target);
  if (settings.vehicle === '1') return /一般原付|原動機付自転車/.test(t) && !/一般原付を除く/.test(t);
  // 原付二種 = 道交法上は「二輪」(普通自動二輪の小型)
  return /二輪/.test(t) && !/(125cc以下|小型二輪)を除く/.test(t);
}
// 時間帯が今(またはdate)にかかっているか。読めない書式は「かかっている」扱い
function regActive(r, date = new Date()) {
  const t = normalize(r.time);
  if (/終日/.test(t)) return true;
  const m = t.match(/(\d{1,2}):(\d{2})\s*[～~〜-]\s*(翌)?(\d{1,2}):(\d{2})/);
  if (!m) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  const s = +m[1] * 60 + +m[2], e = +m[4] * 60 + +m[5];
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

function drawRegulations() {
  const lines = [], points = [], approx = [];
  for (const r of regulations) {
    if (!regApplies(r)) continue;
    const pts = r.points.map((p) => [p.lat, p.lon]);
    const props = { id: r.id, active: regActive(r) };
    if (r.approx) { approx.push(circlePolygon(pts[0], 250, props)); continue; }
    // 座標は始点と終点だけなので、道路に沿った線ではなく点線で結ぶ
    if (pts.length > 1) lines.push(lineFeature(pts, props));
    for (const p of pts) points.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: ll(p) } });
  }
  setOverlay('regLines', fc(lines)); setOverlay('regPoints', fc(points)); setOverlay('regApprox', fc(approx));
}
function circlePolygon(c, radius, props) {
  const ring = [];
  for (let k = 0; k <= 32; k++) {
    const a = (k / 32) * 2 * Math.PI;
    ring.push([c[1] + (radius * Math.sin(a)) / (R * Math.cos(c[0] * Math.PI / 180)) * 180 / Math.PI, c[0] + (radius * Math.cos(a)) / R * 180 / Math.PI]);
  }
  return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } };
}
function regPopup(r, lngLat) {
  const pts = r.points.map((p) => [p.lat, p.lon]);
  const active = regActive(r);
  openPopup(lngLat, `<b>${esc(r.road)}</b><br>${esc(r.section)}<br>対象: ${esc(r.target)}<br>時間: ${esc(r.time)}${active ? '' : '（今は規制時間外）'}`
    + (r.approx ? '<br><small>※住所からの推定位置（おおよそ）</small>' : '')
    + '<br>' + svLink(pts[0][0], pts[0][1], pts.length > 1 ? bearing(pts[0], pts.at(-1)) : null, '📷 始点をストリートビューで見る'));
}
for (const layer of ['reg-lines', 'reg-points', 'reg-approx']) {
  map.on('click', layer, (e) => { const r = regulations.find((x) => x.id === e.features[0].properties.id); if (r) regPopup(r, e.lngLat); });
  map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
}
function updateRegVisibility() {
  for (const id of ['reg-lines', 'reg-points', 'reg-approx']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', settings.showReg ? 'visible' : 'none');
  $('#btn-reg').classList.toggle('off', !settings.showReg);
}
$('#btn-reg').onclick = () => {
  settings.showReg = !settings.showReg; save('settings', settings); updateRegVisibility();
  toast(settings.showReg ? '二輪規制区間を表示（拡大したとき）' : '規制区間を非表示');
};
updateRegVisibility();

// ===== ストリートビュー（Googleマップで開く。APIキー不要） =====
function streetViewUrl(lat, lon, heading) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`
    + (heading != null ? `&heading=${Math.round((heading + 360) % 360)}` : '');
}
const svLink = (lat, lon, heading, label = '📷 ストリートビュー') =>
  `<a class="sv" href="${streetViewUrl(lat, lon, heading)}" target="_blank" rel="noopener">${label}</a>`;
function bearing(a, b) {
  const f1 = a[0] * Math.PI / 180, f2 = b[0] * Math.PI / 180, dl = (b[1] - a[1]) * Math.PI / 180;
  return Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) * 180 / Math.PI;
}
// 曲がり角の手前から交差点を見る位置と向き
function approachView(shape, idx) {
  let j = idx;
  while (j > 0 && haversine(shape[j], shape[idx]) < 25) j--;
  const from = shape[j], at = shape[idx];
  return { lat: from[0], lon: from[1], heading: j < idx ? bearing(from, at) : null };
}

// ===== 幾何 =====
const R = 6371000;
function decode6(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let b, shift = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / 1e6, lon / 1e6]);
  }
  return out;
}
function haversine(a, b) {
  const dLat = (b[0] - a[0]) * Math.PI / 180, dLon = (b[1] - a[1]) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
// 点 p から線分 ab への距離(m)と線分上の位置 t
function segDist(p, a, b) {
  const kx = Math.cos(p[0] * Math.PI / 180) * R * Math.PI / 180, ky = R * Math.PI / 180;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}
function nearestOnLine(p, line, from = 0, to = line.length - 1) {
  let best = { d: Infinity, i: 0, t: 0 };
  for (let i = Math.max(0, from); i < Math.min(to, line.length - 1); i++) {
    const r = segDist(p, line[i], line[i + 1]);
    if (r.d < best.d) best = { d: r.d, i, t: r.t };
  }
  return best;
}
// 線分を太らせた四角形（Valhalla の exclude_polygons 用, [lon,lat] リング）
function bufferPolygon(pts, w = 18) {
  const [a, b] = pts.length > 1 ? [pts[0], pts[pts.length - 1]] : [pts[0], pts[0]];
  const kx = Math.cos(a[0] * Math.PI / 180) * R * Math.PI / 180, ky = R * Math.PI / 180;
  let dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky; const len = Math.hypot(dx, dy) || 1;
  if (len < 1) { dx = 1; dy = 0; }
  const ux = dx / (len < 1 ? 1 : len), uy = dy / (len < 1 ? 1 : len);
  const nx = -uy * w, ny = ux * w, ex = ux * w, ey = uy * w;
  const P = (pt, ox, oy) => [pt[1] + ox / kx, pt[0] + oy / ky];
  return [P(a, -ex + nx, -ey + ny), P(b, ex + nx, ey + ny), P(b, ex - nx, ey - ny), P(a, -ex - nx, -ey - ny), P(a, -ex + nx, -ey + ny)];
}

// ===== ルート検索 =====
let current = null;       // 表示中のルート {trip, shape, legs, analysis}
let candidates = [];      // 代替ルート
let excluded = [];        // 避ける規制区間の id
let planSeq = 0;

function startPlace() {
  if (places.from) return places.from;
  if (me && !me.rough) return { lat: me.lat, lon: me.lon, name: '現在地' };
  return null;
}

// 公開サーバーなので同時2本まで・失敗したら少し待って再試行
let vActive = 0;
const vQueue = [];
async function valhalla(path, body) {
  if (vActive >= 2) await new Promise((res) => vQueue.push(res));
  vActive++;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(VALHALLA + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json();
        if (r.ok) return j;
        if (r.status !== 429 && r.status < 500) throw Object.assign(new Error(j.error || r.statusText), { fatal: true });
        throw new Error(j.error || r.statusText);
      } catch (e) {
        if (e.fatal || attempt >= 2) throw e;
        await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
      }
    }
  } finally {
    vActive--;
    vQueue.shift()?.();
  }
}

function routeRequest(locs, exclude, variant = {}) {
  const speed = +settings.speed;
  return {
    // 原付で入れない目的地（歩行者用トンネルなど）は、トンネルの中ではなく一番近い外の道まで
    locations: locs.map((p, i) => ({
      lat: p.lat, lon: p.lon, type: 'break',
      // 走っている向き（再検索のとき）。この向きに進める道から始めて、いきなり U ターンさせない
      ...(i === 0 && p.heading != null ? { heading: Math.round(p.heading), heading_tolerance: 45 } : {}),
      ...(i > 0 && (p.noVehicle || p.publicOnly) ? { search_filter: { exclude_tunnel: !!p.noVehicle, ...(p.publicOnly ? { min_road_class: 'residential' } : {}) } } : {}),
    })),
    costing: 'motor_scooter',
    costing_options: { motor_scooter: { top_speed: speed, use_primary: variant.use_primary ?? +settings.primary, ...(variant.maneuver_penalty ? { maneuver_penalty: variant.maneuver_penalty } : {}), use_hills: +settings.hills, use_ferry: 0.3 } },
    exclude_polygons: exclude,
    directions_options: { language: 'ja-JP', units: 'kilometers' },
    alternates: locs.length === 2 ? 2 : 0,
  };
}

async function planRoute(opts = {}) {
  const start = opts.start || startPlace();
  if (!start) return toast(me?.rough ? `現在地の誤差が大きい（約${fmtDist(me.acc)}）ので、出発地を入力してください` : '出発地が決まっていません（現在地を取得中）', 5000);
  if (!places.to) return toast('目的地を入れてください');
  const locs = [start, ...(opts.start ? opts.remainingVias || [] : places.vias.filter(Boolean)), places.to];
  const my = ++planSeq;
  if (!opts.quiet) toast('ルート検索中…', 10000);
  await regReady;
  // 二段階右折を避けたいときは「大通りを避けた案」も出して、全部の中から良いものを選ぶ
  const avoidTwo = settings.vehicle === '1' && settings.avoidTwoStage;
  const regPolys = () => regulations.filter((r) => excluded.includes(r.id)).flatMap(regBlockPolygons);
  const request = async (vs, extraPolys = []) => {
    let routes = [], firstErr;
    // 自動回避: 通過してしまう規制区間を除外して再検索（最大2回）
    for (let k = 0; k < 3; k++) {
      const excl = [...regPolys(), ...extraPolys];
      const lists = await Promise.all(vs.map((v) => valhalla('/route', routeRequest(locs, excl, v))
        .then((res) => [res.trip, ...(res.alternates || []).map((a) => a.trip)])
        .catch((e) => { firstErr ??= e; return []; })));
      routes = lists.flat().map(prepareTrip);
      if (!settings.avoidReg || k === 2) break;
      // まず道路の詳細なしで判定。地下道・陸橋の規制に当たったルートだけ詳しく調べる（側道かどうか）
      await Promise.all(routes.map((r) => {
        r.hits = findRegHits(r);
        return r.hits.some((h) => h.passes && isStructureReg(h.reg)) ? analyze(r) : null;
      }));
      const ids = [...new Set(routes.flatMap((r) => r.hits.filter((h) => h.passes && h.active).map((h) => h.reg.id)))].filter((id) => !excluded.includes(id));
      if (!ids.length) break;
      excluded.push(...ids);
    }
    await Promise.all(routes.map((r) => analyze(r)));
    if (!routes.length && firstErr) throw firstErr;
    return routes;
  };
  const passesReg = (r) => r.hits.some((h) => h.passes && h.active);
  const pick = (routes) => {
    const out = [];
    // 自動回避ONなら規制区間を通る案は外す（全部ダメなら残す）
    let pool = settings.avoidReg ? routes.filter((r) => !passesReg(r)) : routes;
    if (!pool.length) pool = routes;
    for (const r of pool.sort((a, b) => score(a) - score(b))) {
      // ほぼ同じルートは1つにまとめる
      const t = r.trip.summary;
      if (!out.some((o) => Math.abs(o.trip.summary.length - t.length) < 0.05 && Math.abs(o.trip.summary.time - t.time) < 30)) out.push(r);
    }
    return out.slice(0, 3);
  };
  // まだ二段階右折が残っていたら、その右折先の道の入口を一時的にふさいだ案も試す（2回まで）
  const refine = async (routes) => {
    routes = routes.concat(await request([{ use_primary: 0.05 }]).catch(() => []));
    if (my !== planSeq) return null;
    const blocks = [];
    let prev = null;
    for (let k = 0; k < 2; k++) {
      const best = pick(routes)[0];
      if (best === prev || !best.twoStage.length) break;
      prev = best;
      blocks.push(...best.twoStage.map((t) => t.exitPoly).filter(Boolean));
      routes = routes.concat(await request([{ use_primary: 0.05 }], blocks).catch(() => []));
      if (my !== planSeq) return null;
    }
    return routes;
  };
  // 低いほど良い: 所要時間(秒) + 二段階右折1回あたり2分 + 曲がる回数（設定） + 通行規制区間の通過は大きく減点
  // 解析に失敗したルート（二段階右折の数が不明）は少し不利にする
  const score = (r) => r.trip.summary.time
    + (avoidTwo ? (r.analyzed ? 120 * r.twoStage.length : 300) : 0)
    + +settings.turns * r.turns
    + 1800 * r.hits.filter((h) => h.passes && h.active).length;
  try {
    // 曲がる回数を減らしたいときは「大通りを通しで使う案」も出して比べる
    const routes = await request(+settings.turns ? [{}, { use_primary: 0.9, maneuver_penalty: 120 }] : [{}]);
    if (!routes.length) throw new Error('no route');
    if (my !== planSeq) return;
    candidates = pick(routes);
    // 目的地の手前が長い管理用道路・林道（山頂など）なら、一般道の終わりまでにして残りは徒歩
    if (!places.to.publicOnly && (candidates[0].serviceTail || 0) > 0.7 && !opts.start) {
      places.to.publicOnly = true;
      return planRoute({ ...opts, quiet: true });
    }
    $('#toast').hidden = true;
    // QR で受け取ったときは、パソコンで選んでいたのと同じルート（距離と曲がる回数が近いもの）を選ぶ
    const pref = opts.prefer;
    const first = pref ? candidates.reduce((bi, c, j) => {
      const d = (x) => Math.abs(x.trip.summary.length - pref.len) + 0.3 * Math.abs(x.turns - pref.turns);
      return d(c) < d(candidates[bi]) ? j : bi;
    }, 0) : 0;
    selectRoute(first, !opts.keepView);
    // まず結果を出してから、二段階右折の少ないルートを裏で探す（ナビ中の再検索ではやらない）
    if (avoidTwo && !opts.quiet && !pref && candidates[0].twoStage.length) {
      toast('二段階右折の少ないルートを探しています…', 20000);
      refine(routes).then((all) => {
        if (!all || my !== planSeq || nav.on) return;
        const better = pick(all);
        if (better[0] !== candidates[0]) {
          const before = candidates[0].twoStage.length;
          candidates = better;
          selectRoute(0, false);
          toast(`二段階右折 ${before}→${better[0].twoStage.length}か所 のルートに更新しました`, 4000);
        } else toast('これより二段階右折の少ないルートは見つかりませんでした', 3000);
      });
    }
    return candidates[0];
  } catch (e) {
    planRoute.lastError = e; // ナビの再検索で、電波のせいか道が見つからないのかを見分けるため
    if (my !== planSeq) return;
    toast('ルートが見つかりません: ' + e.message, 5000);
  }
}
$('#btn-route').onclick = () => planRoute();

// 「新宿四丁目/Shinjuku 4」のようなローマ字表記を取り除く
const stripRomaji = (t) => t && t.replace(/\/[A-Za-zÀ-ɏ][A-Za-z0-9À-ɏ .'’\-]*/g, '');
// 「20/甲州街道」「秋川街道/32」の道路番号を外す（読み上げで邪魔なので）
const stripRefs = (t) => t && t.replace(/(^|[、。\s先])\d{1,3}\//g, '$1').replace(/\/\d{1,3}(?!\d)/g, '')
  .replace(/その先、?\d{1,3}です。?/g, '').replace(/、\d{1,3}です。/g, 'です。');
function cleanManeuver(m) {
  for (const k of ['instruction', 'verbal_transition_alert_instruction', 'verbal_pre_transition_instruction', 'verbal_post_transition_instruction']) m[k] = useCommonNames(stripRefs(stripRomaji(m[k])));
  return m;
}

function prepareTrip(trip) {
  let offset = 0;
  const legs = trip.legs.map((leg) => {
    const shape = decode6(leg.shape);
    const cum = [0];
    for (let i = 1; i < shape.length; i++) cum.push(cum[i - 1] + haversine(shape[i - 1], shape[i]));
    const L = { leg, shape, cum, offset, maneuvers: leg.maneuvers.map((m) => cleanManeuver({ ...m, flags: [] })) };
    offset += shape.length;
    return L;
  });
  const turns = legs.reduce((n, L) => n + L.maneuvers.filter((m) => TURNS.has(m.type)).length, 0);
  return { trip, legs, shape: legs.flatMap((l) => l.shape), structure: [], hits: [], twoStage: [], turns };
}

// ===== 原付向け解析 =====
const RIGHT_TURNS = new Set([10, 11]); // 右折・鋭角右折
const TURNS = new Set([10, 11, 12, 13, 14, 15]); // 右左折・Uターン（「斜め」と分岐は数えない）

const traceCache = new Map();
async function analyze(route) {
  if (traceCache.size > 60) traceCache.clear();
  route.twoStage = [];
  route.structure = new Array(route.shape.length).fill(null); // 各点が トンネル/橋 の上か
  let traceOk = true;
  for (const L of route.legs) {
    let edges = [];
    try {
      const j = traceCache.get(L.leg.shape) || await valhalla('/trace_attributes', {
        encoded_polyline: L.leg.shape, shape_match: 'edge_walk', costing: 'motor_scooter',
        filters: { attributes: ['edge.lane_count', 'edge.names', 'edge.begin_shape_index', 'edge.end_shape_index', 'edge.use', 'edge.tunnel', 'edge.bridge', 'edge.length'], action: 'include' },
      });
      traceCache.set(L.leg.shape, j);
      edges = j.edges || [];
    } catch (e) { console.warn('trace_attributes', e); traceOk = false; }
    // 最後の区間の「管理用の道・林道」の長さ（一般の車両が入れないことが多い）
    if (L === route.legs.at(-1)) {
      route.serviceTail = 0;
      for (let k = edges.length - 1; k >= 0 && /^(service_road|track|parking_aisle|driveway|alley)$/.test(edges[k].use); k--) route.serviceTail += edges[k].length || 0;
    }
    for (const e of edges) {
      if (!e.tunnel && !e.bridge) continue;
      for (let i = e.begin_shape_index; i <= e.end_shape_index; i++) route.structure[L.offset + i] = e.tunnel ? 'tunnel' : 'bridge';
    }
    if (settings.vehicle !== '1') continue;
    for (const m of L.maneuvers) {
      if (!RIGHT_TURNS.has(m.type)) continue;
      const idx = m.begin_shape_index;
      // 交差点に入る直前の道路
      const approach = edges.filter((e) => e.begin_shape_index < idx).pop();
      if (!approach || approach.use === 'ramp') continue;
      const lanes = approach.lane_count || 0;
      if (lanes >= 3) {
        m.flags.push('two-stage');
        route.twoStage.push({ m, latlng: L.shape[idx], lanes, road: (approach.names || [])[0] || '', view: approachView(L.shape, idx), exitPoly: exitPolygon(L.shape, idx) });
      }
    }
  }
  route.analyzed = traceOk;
  if (!traceOk) route.structure = []; // 構造が分からないときは側道判定をしない
  route.hits = findRegHits(route);
}

// 規制区間をふさぐ多角形。Valhalla は外周の合計に上限(10km)があるので、
// 長い区間は全体ではなく入口と出口の短い部分だけをふさぐ
function regBlockPolygons(r) {
  const pts = r.points.map((p) => [p.lat, p.lon]);
  if (pts.length < 2 || haversine(pts[0], pts.at(-1)) < 120) return [bufferPolygon(pts, 15)];
  const toward = (a, b, m) => { const f = m / haversine(a, b); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
  const [a, b] = [pts[0], pts.at(-1)];
  return [bufferPolygon([toward(a, b, 10), toward(a, b, 45)], 8), bufferPolygon([toward(b, a, 45), toward(b, a, 10)], 8)];
}

// 右折した先の道の入口（交差点から 8〜25m）をふさぐ小さな四角形
function exitPolygon(shape, idx) {
  let a = null, b = null;
  for (let k = idx + 1; k < shape.length; k++) {
    const d = haversine(shape[idx], shape[k]);
    if (!a && d >= 8) a = shape[k];
    if (d >= 25) { b = shape[k]; break; }
  }
  return a && b ? bufferPolygon([a, b], 6) : null;
}

// 地下道・陸橋・トンネルの規制か（このときは側道は通れる）
const STRUCTURE_RE = /トンネル|アンダーパス|地下|陸橋|立体|オーバーパス|高架|跨線|ブリッジ|橋/;
// 地名の「新橋」「日本橋」などを拾わないよう、路線名と区間のカッコ書きだけを見る
const isStructureReg = (r) => STRUCTURE_RE.test(r.road + (r.section.match(/[（(][^）)]*[）)]/g) || []).join(''));

function findRegHits(route) {
  const line = route.shape;
  if (!line.length) return [];
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [la, lo] of line) { minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); }
  const pad = 0.003;
  const hits = [];
  for (const r of regulations) {
    if (r.approx || !regApplies(r)) continue; // 住所から推定した位置は精度が低いので判定に使わない
    const pts = r.points.map((p) => [p.lat, p.lon]);
    if (!pts.some(([la, lo]) => la > minLat - pad && la < maxLat + pad && lo > minLon - pad && lo < maxLon + pad)) continue;
    const near = pts.map((p) => nearestOnLine(p, line));
    const close = near.filter((n) => n.d < 35);
    if (!close.length) continue;
    // 始点→終点の順でルート上にある → 通過している可能性が高い（逆順は反対車線の規制）
    const forward = !r.hasTwin || near[0].i <= near[pts.length - 1].i;
    let passes = pts.length > 1 ? close.length === pts.length && forward : true;
    // 地下道・陸橋の規制なのに、ルートの該当区間がトンネルでも橋でもない → 横の側道を通っている
    if (passes && pts.length > 1 && route.structure.length && isStructureReg(r)) {
      const [i0, i1] = [near[0].i, near[pts.length - 1].i].sort((x, y) => x - y);
      if (!route.structure.slice(i0, i1 + 2).some(Boolean)) passes = false;
    }
    if (!passes && (close[0].d > 20 || close.length === pts.length)) continue;
    hits.push({ reg: r, passes, active: regActive(r), at: line[close[0].i], idx: close[0].i });
  }
  return hits.sort((a, b) => a.idx - b.idx);
}

// ===== 表示 =====
const ICONS = { 1: '●', 2: '●', 3: '●', 4: '🏁', 5: '🏁', 6: '🏁', 8: '↑', 9: '↗', 10: '→', 11: '↘', 12: '↶', 13: '↶', 14: '↙', 15: '←', 16: '↖', 17: '↑', 18: '↗', 19: '↖', 20: '↗', 21: '↖', 22: '↑', 23: '↗', 24: '↖', 25: '⤵', 26: '⟳', 27: '⟳', 28: '⛴', 29: '⛴' };

let badgeMarkers = [];
function selectRoute(i, fit = true) {
  current = candidates[i];
  setOverlay('alts', fc(candidates.map((c, j) => j === i ? null : lineFeature(c.shape, { idx: j })).filter(Boolean)));
  setOverlay('route', fc([lineFeature(current.shape)]));
  badgeMarkers.forEach((m) => m.remove());
  badgeMarkers = current.twoStage.map((t) => {
    const m = htmlMarker('<div class="turn-badge">二段階</div>', t.latlng, { anchor: 'bottom', offset: [0, -4] });
    m.getElement().onclick = (e) => {
      e.stopPropagation();
      openPopup(ll(t.latlng), `二段階右折の可能性<br>${esc(t.road)}（片側${t.lanes}車線）<br><small>信号のある交差点なら二段階右折。標識を確認してください。</small><br>${svLink(t.view.lat, t.view.lon, t.view.heading, '📷 交差点をストリートビューで見る')}`);
    };
    return m;
  });
  renderSheet(i);
  if (fit) fitRoute(current.shape);
  for (const L of current.legs) for (const m of L.maneuvers) for (const n of m.street_names || []) requestAlias(n, L.shape[m.begin_shape_index]);
}
map.on('click', 'alts', (e) => selectRoute(e.features[0].properties.idx, false));
map.on('mouseenter', 'alts', () => (map.getCanvas().style.cursor = 'pointer'));
map.on('mouseleave', 'alts', () => (map.getCanvas().style.cursor = ''));

function renderSheet(sel) {
  const s = current.trip.summary;
  $('#alts').replaceChildren(...(candidates.length > 1 ? candidates.map((c, j) => {
    const b = el('button', { className: j === sel ? 'sel' : '', textContent: `ルート${j + 1}  ${fmtTime(c.trip.summary.time)}・曲がる${c.turns}回${settings.vehicle === '1' ? `・二段階${c.analyzed ? c.twoStage.length : '?'}` : ''}` });
    b.onclick = () => selectRoute(j, false);
    return b;
  }) : []));
  // ルートの終点が目的地から離れている = 原付で入れない場所。残りは歩き
  const end = current.shape.at(-1);
  const walk = places.to ? haversine(end, [places.to.lat, places.to.lon]) : 0;
  $('#summary').innerHTML = `${fmtTime(s.time)}<small>${fmtDist(s.length * 1000)} ・ 曲がる${current.turns}回 ・ ${settings.speed}km/h想定</small>`
    + (walk > 40 ? `<div class="walk">🚶 原付を停めて目的地まで徒歩 約${fmtDist(walk)}（直線）${places.to?.publicOnly ? '<br><small>この先は管理用の道・林道で、一般車両は入れないことが多いため</small>' : ''}</div>` : '');

  const w = [];
  // 近くを通るだけ（地下道の横の側道など）はまとめて1行
  const nearOnly = current.hits.filter((h) => !h.passes);
  if (nearOnly.length) {
    const box = el('div', { className: 'warn' });
    box.innerHTML = `<b>付近に規制区間 ${nearOnly.length}件</b>${nearOnly.map((h) => esc(h.reg.road)).join('・')}（地下道・陸橋なら側道を通行）`;
    box.onclick = () => fitRoute(nearOnly.map((h) => h.at));
    w.push(box);
  }
  for (const h of current.hits.filter((x) => x.passes)) {
    const box = el('div', { className: 'warn' + (h.passes && h.active ? ' danger' : '') });
    box.innerHTML = `<b>${h.active ? '⛔ 通行規制区間を通過' : '規制区間（今は時間外）'}: ${esc(h.reg.road)}</b>${esc(h.reg.section)}<br>対象: ${esc(h.reg.target)} / ${esc(h.reg.time)}`;
    const btn = el('button', { className: 'act', textContent: 'この区間を避けて再検索' });
    btn.onclick = (e) => { e.stopPropagation(); excluded.push(h.reg.id); planRoute(); };
    box.append(el('br'), btn);
    box.onclick = () => flyTo(h.at, 17);
    w.push(box);
  }
  if (current.twoStage.length) {
    const box = el('div', { className: 'warn' });
    box.innerHTML = `<b>二段階右折の可能性 ${current.twoStage.length}か所</b>3車線以上の道路からの右折（地図の「二段階」）`;
    box.onclick = () => fitRoute(current.twoStage.map((t) => t.latlng));
    w.push(box);
  }
  if (excluded.length) {
    const box = el('div', { className: 'warn' });
    box.innerHTML = `${excluded.length}件の規制区間を回避中 `;
    const btn = el('button', { className: 'act', textContent: '解除' });
    btn.onclick = (e) => { e.stopPropagation(); excluded = []; planRoute(); };
    box.append(btn);
    w.push(box);
  }
  $('#warnings').replaceChildren(...w);

  const steps = [];
  current.legs.forEach((L) => L.maneuvers.forEach((m) => {
    const li = el('li', {});
    const two = m.flags.includes('two-stage');
    const v = approachView(L.shape, m.begin_shape_index);
    li.innerHTML = `<span class="ico">${ICONS[m.type] || '•'}</span><span class="txt">${esc(m.instruction)}${two ? '<span class="tag">二段階右折?</span>' : ''}<br><span class="d">${m.length ? fmtDist(m.length * 1000) : ''}</span></span>${svLink(v.lat, v.lon, v.heading, '📷')}`;
    li.querySelector('.sv').onclick = (e) => e.stopPropagation();
    li.onclick = () => flyTo(L.shape[m.begin_shape_index], 17);
    steps.push(li);
  }));
  $('#steps').replaceChildren(...steps);

  $('#sheet').hidden = false;
  document.body.classList.add('has-route');
  requestAnimationFrame(() => document.body.style.setProperty('--sheet-h', $('#sheet').offsetHeight + 'px'));
}
$('#btn-steps').onclick = () => {
  const s = $('#steps'); s.hidden = !s.hidden;
  $('#btn-steps').textContent = s.hidden ? '曲がり角一覧' : '閉じる';
  document.body.style.setProperty('--sheet-h', $('#sheet').offsetHeight + 'px');
};

// ===== ナビ =====
const nav = { on: false, legIdx: 0, mIdx: 0, lastIdx: 0, offCount: 0, spoken: new Set(), wake: null, rerouting: false, retryAt: 0, fails: 0, paused: '', prevPt: null };

// ===== 音声（ずんだもん / 端末の声） =====
// 決まり文句は VOICEVOX で作ったずんだもんの音声（web/voice/zundamon/、tools/make_voice.py で作る）をつないで流す。
// 音声ファイルがない文・道路名が入る文は端末の読み上げ（speechSynthesis）で読む
const zunda = { ctx: null, index: null, buf: {}, queue: Promise.resolve(), sources: [] };
fetch('voice/zundamon/index.json').then((r) => r.ok ? r.json() : null).then((j) => (zunda.index = j)).catch(() => {});
// ナビ開始のタップの中で呼ぶ（スマホはユーザー操作がないと音を出せない）
function unlockVoice() {
  if (settings.voiceType !== 'zundamon' || !zunda.index) return;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {} // iPhone のマナーモードでも鳴らす
  zunda.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  zunda.ctx.resume?.();
  for (const [id, v] of Object.entries(zunda.index)) {
    zunda.buf[id] ??= fetch('voice/zundamon/' + v.file).then((r) => r.arrayBuffer())
      .then((a) => new Promise((res, rej) => zunda.ctx.decodeAudioData(a, res, rej))).catch(() => { delete zunda.buf[id]; return null; });
  }
}
const canZunda = (ids) => settings.voiceType === 'zundamon' && zunda.ctx && ids?.length && ids.every((id) => id && zunda.buf[id]);
// ids: ずんだもんの音声の並び、text: 音声がないとき端末の声で読む文
function speak(text, ids) {
  if (!settings.voice || !text) return;
  if (canZunda(ids)) {
    zunda.queue = zunda.queue.then(async () => {
      for (const id of ids) {
        const b = await zunda.buf[id];
        if (!b || !settings.voice) return;
        await new Promise((res) => {
          const src = zunda.ctx.createBufferSource();
          src.buffer = b; src.connect(zunda.ctx.destination);
          src.onended = () => { zunda.sources = zunda.sources.filter((x) => x !== src); res(); };
          zunda.sources.push(src); src.start();
        });
      }
    });
    return;
  }
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; u.rate = 1.05;
  speechSynthesis.speak(u);
}
function stopVoice() {
  speechSynthesis?.cancel();
  zunda.sources.forEach((s) => { try { s.stop(); } catch {} });
  zunda.sources = [];
}
// 曲がり角の種類 → ずんだもんの音声（Valhalla の maneuver type）
const zTurn = (type) => { const id = 't' + (type === 13 ? 12 : type); return zunda.index?.[id] ? id : null; };

$('#btn-nav').onclick = async () => {
  if (!current) return;
  if (!me) return toast('現在地が取れていません');
  unlockVoice(); // タップの直後（await より前）でないと、スマホは音を出させてくれない
  // 出発地を入力したときはそのルートのまま。今いる場所がルートから離れていれば、ルートに乗るまで案内を待つ
  const startPt = current.legs[0].shape[0];
  const waitJoin = !!places.from && haversine([me.lat, me.lon], startPt) > 60;
  Object.assign(nav, { on: true, legIdx: 0, mIdx: 0, lastIdx: 0, offCount: 0, spoken: new Set(), waitJoin, retryAt: 0, fails: 0, paused: '', prevPt: null });
  document.body.classList.add('navigating');
  $('#nav-top').hidden = $('#nav-bottom').hidden = false;
  try { nav.wake = await navigator.wakeLock?.request('screen'); } catch {}
  meMarker?.getElement().classList.add('nav');
  const first = current.legs[0].maneuvers[0];
  if (waitJoin) speak(`出発地点の${places.from.name}まで向かってください`, ['toStart']);
  else speak(first.verbal_pre_transition_instruction || first.instruction, ['start']);
  navUpdate(me);
};
$('#btn-nav-end').onclick = () => endNav();
$('#btn-mute').onclick = () => { settings.voice = !settings.voice; save('settings', settings); $('#btn-mute').textContent = settings.voice ? '🔊' : '🔇'; if (!settings.voice) stopVoice(); };
document.addEventListener('visibilitychange', async () => {
  if (nav.on && document.visibilityState === 'visible') { try { nav.wake = await navigator.wakeLock?.request('screen'); } catch {} }
});

// keepVoice: 到着のときは「到着しました」を最後まで読ませる
function endNav(keepVoice = false) {
  nav.on = false;
  document.body.classList.remove('navigating');
  $('#nav-top').hidden = $('#nav-bottom').hidden = true;
  nav.wake?.release?.(); nav.wake = null;
  if (!keepVoice) stopVoice();
  meMarker?.getElement().classList.remove('nav');
  meMarker?.setRotation(0);
  map.easeTo({ bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
}

onPosition.push((p) => { if (nav.on) navUpdate(p); });

function navUpdate(p) {
  const kmh = p.speed != null && p.speed >= 0 ? Math.round(p.speed * 3.6) : null;
  $('#nav-speed b').textContent = kmh ?? '–';
  $('#nav-speed').classList.toggle('over', settings.vehicle === '1' && kmh != null && kmh > 30);

  const L = current.legs[nav.legIdx];
  const pt = [p.lat, p.lon];
  // 直前の位置の近くから探す（逆走や並行道路での誤スナップを減らす）
  let near = nearestOnLine(pt, L.shape, nav.lastIdx - 5, nav.lastIdx + 400);
  if (near.d > 40) near = nearestOnLine(pt, L.shape);
  if (nav.waitJoin) {
    // 入力した出発地のルートに乗るまでは再検索せず、出発地点までの距離だけ出す
    if (near.d > 40 || (p.acc ?? 0) > 60) {
      const toStart = haversine(pt, L.shape[0]);
      $('#nav-arrow').textContent = '⚑';
      $('#nav-dist').textContent = fmtDist(toStart);
      $('#nav-text').textContent = `出発地点（${places.from?.name || 'ルートの始まり'}）まで向かってください`;
      $('#nav-warn').textContent = p.acc > ROUGH_ACC ? `現在地の誤差 約${fmtDist(p.acc)}` : '';
      $('#nav-remain').innerHTML = `<b>${fmtDist(L.cum.at(-1))}</b><br><small>ルートに乗ったら案内を始めます</small>`;
      return;
    }
    nav.waitJoin = false;
    nav.lastIdx = near.i;
    speak('ルートに乗りました。案内を始めます', ['joined']);
  }
  // 走っている向き: GPS の向き（ある程度速いとき）か、15m 以上動いた前の位置からの向き
  if (!nav.prevPt || haversine(nav.prevPt, pt) > 15) {
    if (nav.prevPt) nav.heading = (bearing(nav.prevPt, pt) + 360) % 360;
    nav.prevPt = pt;
  }
  if (p.heading != null && !isNaN(p.heading) && (p.speed ?? 0) > 2) nav.heading = p.heading;
  if (near.d > 50 && (p.acc ?? 0) < 60) {
    // 電波がないときは再検索しない（元のルートのまま案内を続け、電波が戻ったら再開）
    if (!navigator.onLine) nav.paused = '📵 電波がないので再検索を止めています。元のルートで案内中';
    else if (++nav.offCount >= 3 && !nav.rerouting && Date.now() >= nav.retryAt) reroute(p);
  } else { nav.offCount = 0; nav.paused = ''; }
  nav.lastIdx = near.i;
  const along = L.cum[near.i] + near.t * (L.cum[near.i + 1] - L.cum[near.i] || 0);

  // 次のマニューバ
  while (nav.mIdx < L.maneuvers.length - 1 && L.maneuvers[nav.mIdx + 1].begin_shape_index <= near.i) nav.mIdx++;
  const next = L.maneuvers[Math.min(nav.mIdx + 1, L.maneuvers.length - 1)];
  const dNext = Math.max(0, L.cum[next.begin_shape_index] - along);

  $('#nav-arrow').textContent = ICONS[next.type] || '↑';
  $('#nav-dist').textContent = fmtDist(dNext);
  $('#nav-text').textContent = next.instruction;
  const two = next.flags.includes('two-stage') ? '⚠ 二段階右折の可能性' : '';
  const regAhead = current.hits.find((h) => h.passes && h.active && h.idx > near.i && h.idx - near.i < 200);
  $('#nav-warn').textContent = [nav.paused, two, regAhead ? '⛔ この先 原付通行規制区間' : ''].filter(Boolean).join(' / ');

  const key = `${nav.legIdx}-${nav.mIdx + 1}`;
  if (dNext < 300 && dNext > 80 && !nav.spoken.has(key + 'a')) {
    nav.spoken.add(key + 'a');
    const m = Math.round(dNext / 50) * 50;
    speak(`${m}メートル先、${next.verbal_transition_alert_instruction || next.instruction}`, [`d${m}`, zTurn(next.type)]);
  }
  if (dNext <= 60 && !nav.spoken.has(key + 'b')) {
    nav.spoken.add(key + 'b');
    speak((next.verbal_pre_transition_instruction || next.instruction) + (two ? '。二段階右折に注意してください' : ''), ['soon', zTurn(next.type), ...(two ? ['twostage'] : [])]);
  }

  // 残り
  let remain = L.cum[L.cum.length - 1] - along;
  let remainT = remain / ((+settings.speed * 0.7) / 3.6);
  for (let k = nav.legIdx + 1; k < current.legs.length; k++) { remain += current.legs[k].cum.at(-1); remainT += current.legs[k].leg.summary.time; }
  const eta = new Date(Date.now() + remainT * 1000);
  $('#nav-remain').innerHTML = `<b>${fmtDist(remain)}</b> ・ ${fmtTime(remainT)}<br><small>到着 ${eta.getHours()}:${String(eta.getMinutes()).padStart(2, '0')}頃</small>`;

  // 経由地・目的地到着
  if (L.cum.at(-1) - along < 30) {
    if (nav.legIdx < current.legs.length - 1) {
      speak('経由地に到着しました', ['via']); nav.legIdx++; nav.mIdx = 0; nav.lastIdx = 0;
    } else { speak('目的地に到着しました。おつかれさまでした', ['arrive']); toast('到着しました'); endNav(true); return; }
  }
  // 進行方向を上にして、自分の位置を画面の下寄りに
  let k = near.i + 1;
  while (k < L.shape.length - 1 && L.cum[k] - along < 30) k++;
  const ahead = L.shape[Math.min(k, L.shape.length - 1)];
  let heading = haversine(pt, ahead) > 3 ? bearing(pt, ahead) : map.getBearing();
  if (p.speed > 2 && p.heading != null && !Number.isNaN(p.heading) && near.d > 25) heading = p.heading;
  meMarker?.setRotation(heading);
  map.easeTo({ center: ll(pt), bearing: heading, pitch: 45, zoom: 17, padding: { top: innerHeight * 0.45, bottom: 90, left: 0, right: 0 }, duration: 900 });
}

async function reroute(p) {
  nav.rerouting = true;
  toast('ルートを再検索中…');
  speak('ルートを再検索します', ['reroute']);
  const remainingVias = places.vias.filter(Boolean).slice(nav.legIdx);
  planRoute.lastError = null;
  const r = await planRoute({ start: { lat: p.lat, lon: p.lon, name: '現在地', heading: nav.heading }, remainingVias, quiet: true, keepView: true });
  if (r) Object.assign(nav, { legIdx: 0, mIdx: 0, lastIdx: 0, offCount: 0, spoken: new Set(), fails: 0, retryAt: 0, paused: '' });
  else {
    // 失敗（電波が弱いなど）: 連打しないよう 15秒 → 30秒 → 60秒… と間をあけて、それまでは元のルートで案内
    nav.fails++;
    nav.retryAt = Date.now() + Math.min(15000 * 2 ** (nav.fails - 1), 120000);
    // Valhalla が「道が見つからない」と答えた（原付で入れない道にいるなど）のか、電波のせいで届かなかったのか
    const noPath = navigator.onLine && planRoute.lastError?.fatal;
    if (noPath) {
      nav.paused = '⚠ この場所からのルートが見つかりません。元のルートで案内中（少し進んでからもう一度試します）';
      if (nav.fails === 1) speak('この場所からはルートが見つかりません。少し進んでからもう一度試します', ['rerouteNoPath']);
    } else {
      nav.paused = '📵 再検索できませんでした。元のルートで案内中（少ししてからもう一度試します）';
      if (nav.fails === 1) speak('再検索できませんでした。電波の良い場所で、もう一度試します', ['rerouteFail']);
    }
  }
  nav.rerouting = false;
}
// 電波が戻ったら、すぐ再検索できるようにする
addEventListener('online', () => { nav.retryAt = 0; nav.fails = 0; nav.paused = ''; });

// ===== スマホに送る（QR） =====
// パソコンで決めた地点・設定を URL（#r=…）に詰めて QR コードにする。アカウントもサーバーも不要。
// スマホは同じ条件でルートを出し直す（ルートの線そのものは大きすぎて QR に入らないため）
const SHARE_KEYS = ['vehicle', 'speed', 'primary', 'hills', 'turns', 'avoidReg', 'avoidTwoStage'];
const packPlace = (p) => p && { n: p.name, a: +p.lat.toFixed(6), o: +p.lon.toFixed(6), ...(p.noVehicle ? { nv: 1 } : {}), ...(p.publicOnly ? { po: 1 } : {}) };
const unpackPlace = (p) => p && { name: p.n, lat: p.a, lon: p.o, ...(p.nv ? { noVehicle: true } : {}), ...(p.po ? { publicOnly: true } : {}) };
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipeBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

async function shareUrl() {
  const data = {
    v: 1, f: packPlace(places.from), w: places.vias.filter(Boolean).map(packPlace), t: packPlace(places.to),
    s: Object.fromEntries(SHARE_KEYS.map((k) => [k, settings[k]])), x: excluded,
    k: current && { len: +current.trip.summary.length.toFixed(2), turns: current.turns },
  };
  let bytes = new TextEncoder().encode(JSON.stringify(data)), tag = 'j';
  // 縮めると QR が細かくなりすぎず読み取りやすい（古いブラウザはそのまま）
  if ('CompressionStream' in window) { bytes = await pipeBytes(bytes, new CompressionStream('deflate-raw')); tag = 'z'; }
  return location.origin + location.pathname + '#r=' + tag + b64url(bytes);
}

let qrLib = null;
const loadQr = () => qrLib ??= new Promise((res, rej) => {
  const sc = el('script', { src: 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js' });
  sc.onload = () => res(window.qrcode); sc.onerror = () => { qrLib = null; rej(new Error('QR')); };
  document.head.append(sc);
});

$('#btn-share').onclick = async () => {
  if (!places.to) return;
  const url = await shareUrl();
  $('#share-url').value = url;
  $('#qr').replaceChildren();
  $('#share').showModal();
  try {
    const qr = (await loadQr())(0, 'L'); // 0 = 大きさは自動
    qr.addData(url); qr.make();
    $('#qr').append(el('img', { src: qr.createDataURL(4, 2), alt: 'ルートの QR コード' }));
  } catch { $('#qr').textContent = 'QR コードを作れませんでした。下のリンクをコピーして送ってください'; }
};
$('#btn-copy').onclick = async (e) => {
  e.preventDefault();
  try { await navigator.clipboard.writeText($('#share-url').value); toast('リンクをコピーしました'); }
  catch { $('#share-url').select(); }
};

// QR から開いたとき: 地点と設定を入れてルートを出す
async function receiveShared() {
  const m = location.hash.match(/^#r=([jz])(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search); // 再読み込みでまた読まないように
  let data;
  try {
    let bytes = unb64url(m[2]);
    if (m[1] === 'z') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return toast('受け取ったルートを読めませんでした', 4000); }
  for (const k of SHARE_KEYS) if (k in data.s) settings[k] = data.s[k];
  save('settings', settings);
  drawRegulations();
  setPlace('from', unpackPlace(data.f), $('#from'));
  for (const v of data.w || []) addViaField(unpackPlace(v));
  setPlace('to', unpackPlace(data.t), $('#to'));
  excluded = data.x || [];
  const go = () => planRoute({ prefer: data.k });
  toast('パソコンから受け取ったルートを出しています…', 10000);
  // 出発地が空 = 現在地から。スマホの現在地が取れるのを待つ
  if (places.from || me) go();
  else onPosition.push(function once() { setTimeout(() => onPosition.splice(onPosition.indexOf(once), 1)); go(); });
}

// ===== 設定ダイアログ =====
const dlg = $('#settings');
const form = dlg.querySelector('form');
$('#btn-settings').onclick = () => {
  for (const [k, v] of Object.entries(settings)) {
    const f = form.elements[k]; if (!f) continue;
    if (f.type === 'checkbox') f.checked = !!v; else f.value = v;
  }
  form.elements.speedOut.value = settings.speed;
  dlg.showModal();
};
form.elements.speed.oninput = () => (form.elements.speedOut.value = form.elements.speed.value);
form.elements.vehicle.onchange = () => {
  const v = form.elements.vehicle.value;
  form.elements.speed.value = form.elements.speedOut.value = v === '1' ? 30 : 50;
};
dlg.addEventListener('close', () => {
  const before = JSON.stringify(settings);
  for (const k of Object.keys(DEFAULTS)) {
    const f = form.elements[k]; if (!f) continue;
    settings[k] = f.type === 'checkbox' ? f.checked : f.type === 'range' ? +f.value : f.value;
  }
  save('settings', settings);
  $('#btn-mute').textContent = settings.voice ? '🔊' : '🔇';
  if (settings.theme !== JSON.parse(before).theme) applyTheme();
  if (JSON.stringify({ ...settings, theme: 0 }) !== JSON.stringify({ ...JSON.parse(before), theme: 0 })) {
    drawRegulations();
    if (places.to && current) planRoute();
  }
});
$('#btn-mute').textContent = settings.voice ? '🔊' : '🔇';

receiveShared();

// ベータ版のお知らせ（初めて開いたときだけ）
if (!load('betaNoticeSeen', false)) {
  $('#beta').showModal();
  $('#beta').addEventListener('close', () => save('betaNoticeSeen', true), { once: true });
}

// ===== PWA =====
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
