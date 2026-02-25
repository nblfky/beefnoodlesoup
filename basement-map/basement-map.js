const FALLBACK_VIEW = [1.3521, 103.8198]; // Singapore
const statusBadge = document.getElementById('statusBadge');
const featureListEl = document.getElementById('featureList');
const featureCountEl = document.getElementById('featureCount');
const fitAllBtn = document.getElementById('fitAllBtn');

const SITES = [
  {
    id: 'seascape',
    name: 'Seascape',
    address: '57/59 Cove Way, 098308, Sentosa',
    polygonised: 'October 2025',
    type: 'Condominium',
    carUrl: './Seascape%20Car%20Lot.geojson',
    backgroundUrl: './Seascape%20Background.geojson',
    photoUrl: './images/seascape.jpg',
  },
  {
    id: 'asr',
    name: 'Avenue South Residence',
    address: '1 Silat Ave, 168872',
    polygonised: 'December 2025',
    type: 'Condominium',
    carUrl: './Avenue%20South%20Residence%20Car%20Lot.geojson',
    backgroundUrl: './Avenue%20South%20Residence%20Background.geojson',
    photoUrl: './images/avenue-south.jpg',
  },
  {
    id: 'acs-barker',
    name: 'Anglo Chinese School - Barker Road',
    address: '60 Barker Rd, 309919',
    polygonised: 'December 2025',
    type: 'School',
    carUrl: './Anglo%20Chinese%20School%20Barker%20Road%20Car%20Lot.geojson',
    backgroundUrl: './Anglo%20Chinese%20School%20Barker%20Road%20Background.geojson',
    photoUrl: './images/acs-barker.jpg',
  },
  {
    id: 'costa-rhu',
    name: 'Costa Rhu',
    address: '1 Rhu Cross, 437431',
    polygonised: 'November 2025',
    type: 'Condominium',
    carUrl: './Costa%20Rhu%20Car%20Lot%20.geojson', // note intentional space before .geojson
    backgroundUrl: './Costa%20Rhu%20Background.geojson',
    photoUrl: './images/costa-rhu.jpg',
  },
  {
    id: 'normanton-park',
    name: 'Normanton Park',
    address: 'Normanton Park, 119001',
    polygonised: 'November 2025',
    type: 'Condominium',
    carUrl: './Normanton%20Park%20Car%20Lot.geojson',
    backgroundUrl: './Normanton%20Park%20Background.geojson',
    photoUrl: './images/normanton-park.jpg',
  },
  {
    id: 'parc-esta',
    name: 'Parc Esta',
    address: '916 Sims Ave, 408966',
    polygonised: 'December 2025',
    type: 'Condominium',
    carUrl: './Parc%20Esta%20Car%20Lot.geojson',
    backgroundUrl: './Parc%20Esta%20Background.geojson',
    photoUrl: './images/parc-esta.jpg',
  },
  {
    id: 'parkroyal',
    name: 'Parkroyal Collection - Marina Square',
    address: '6 Raffles Blvd, 039594',
    polygonised: 'September 2025',
    type: 'Hotel/Mall',
    carUrl: './Parkroyal%20Car%20Lot.geojson',
    backgroundUrl: './Parkroyal%20Background.geojson',
    photoUrl: './images/parkroyal-collection.jpg',
  },
  {
    id: 'mandarin-oriental',
    name: 'Mandarin Oriental - Marina Square',
    address: '5 Raffles Ave., 039797',
    polygonised: 'September 2025',
    type: 'Hotel/Mall',
    carUrl: './Mandarin%20Oriental%20Car%20Lot.geojson',
    backgroundUrl: './Mandarin%20Oriental%20Background.geojson',
    photoUrl: './images/mandarin-oriental.jpg',
  },
  {
    id: 'pan-pacific',
    name: 'Pan Pacific - Marina Square',
    address: '7 Raffles Blvd, 039595',
    polygonised: 'September 2025',
    type: 'Hotel/Mall',
    carUrl: './Pan%20Pacific%20Car%20Lot.geojson',
    backgroundUrl: './Pan%20Pacific%20Background.geojson',
    photoUrl: './images/pan-pacific.jpg',
  },
  {
    id: 'resorts-world-sentosa',
    name: 'Resorts World Sentosa',
    address: '8 Sentosa Gateway, 098269, Sentosa',
    polygonised: 'In progress',
    type: 'Hotel/Attraction',
    latLng: [1.2568479288508545, 103.8208778489055],
    progress: 50,
    photoUrl: './images/resorts-world-sentosa.jpg',
  },
  {
    id: 'treasure-tampines',
    name: 'Treasure at Tampines',
    address: '1 Tampines Ln, 528482',
    polygonised: 'In progress',
    type: 'Condominium',
    latLng: [1.3450193614711123, 103.94715235997175],
    progress: 90,
    photoUrl: './images/treasure-at-tampines.jpg',
  },
  {
    id: 'clementi-mall',
    name: 'Clementi Mall',
    address: '3155 Commonwealth Ave W, 129588',
    polygonised: 'Completed',
    type: 'Mall',
    latLng: [1.3148750946429097, 103.76450201276299],
    progress: null,
    carUrl: './Clementi%20Mall%20B2%20Car%20Lot.geojson',
    backgroundUrl: './Clementi%20Mall%20B2%20Background.geojson',
    photoUrl: './images/clementi-mall.jpg',
  },
  {
    id: 'city-square-mall',
    name: 'City Square Mall',
    address: '180 Kitchener Rd, 208539',
    polygonised: 'In progress',
    type: 'Mall',
    latLng: [1.3113228863800754, 103.85625735323987],
    progress: 0,
    photoUrl: './images/city-square-mall.jpg',
  },
  {
    id: 'grab-one-north',
    name: 'Grab @ one-north',
    address: '3 Media Close, 138498',
    polygonised: 'In progress',
    type: 'Office',
    latLng: [1.291739263726851, 103.79296846673219],
    progress: 0,
    photoUrl: './images/grab-one-north.jpg',
  },
  {
    id: 'ritz-carlton',
    name: 'Ritz Carlton',
    address: '7 Raffles Ave., Marina Bay, 039799',
    polygonised: 'July 2025',
    type: 'Hotel',
    carUrl: './Ritz%20Carlton%20Car%20Lot.geojson',
    backgroundUrl: './Ritz%20Carlton%20Background.geojson',
    photoUrl: './images/ritz-carlton.jpg',
  },
  {
    id: 'millenia-walk',
    name: 'Millenia Walk',
    address: '9 Raffles Blvd, 039596',
    polygonised: 'July 2025',
    type: 'Mall',
    carUrl: './Millenia%20Walk%20Car%20Lot.geojson',
    backgroundUrl: './Millenia%20Walk%20Background.geojson',
    photoUrl: './images/millenia-walk.jpg',
  },
];

const map = L.map('map', {
  zoomControl: true,
  scrollWheelZoom: true,
  maxZoom: 20,
});

const cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors | &copy; CARTO',
  maxZoom: 20,
});
cartoLight.addTo(map);

const polygonsLayer = L.geoJSON(null, {
  style: featureStyle,
  onEachFeature,
});

const bounds = L.latLngBounds();
let featureIndex = 0;
const PLACEHOLDERS = Array.from({ length: 10 }).map((_, i) => `Info placeholder ${i + 1}`);
const SITE_LABEL_HIDE_ZOOM = 17; // hide label when zoomed in closer than this
const siteStore = new Map(); // id -> {site, carLayers, bikeLayers, evLayers, structureLayers, bgLayers, bounds, marker}
const filterState = {
  search: '',
  type: 'all',
  sort: 'name-asc', // name-asc | car-desc | date-desc | date-asc
};
let filtersBuilt = false;
const OSM_CHANGESET_ID = 176934697;
let osmRoutesLayer = null;
let osmLoading = false;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];

async function loadData() {
  setStatus('Loading data…');
  try {
    // Pre-create store entries
    SITES.forEach(site => {
      siteStore.set(site.id, {
        site,
        carLayers: [],
        bikeLayers: [],
        evLayers: [],
        structureLayers: [],
        bgLayers: [],
        bounds: L.latLngBounds(),
        marker: null,
      });
    });

    await Promise.all(SITES.map(site => loadSiteGeoJSON(site)));

    polygonsLayer.addTo(map);

    // Add latLng-only sites to bounds
    SITES.forEach(site => {
      if (Array.isArray(site.latLng) && site.latLng.length === 2) {
        const entry = ensureSiteEntry(site.id);
        const ll = L.latLng(site.latLng[0], site.latLng[1]);
        entry.bounds.extend(ll);
        bounds.extend(ll);
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.08));
    } else {
      map.setView(FALLBACK_VIEW, 13);
    }

    // Add markers for all sites
    SITES.forEach(site => {
      const entry = siteStore.get(site.id);
      const center = entry?.bounds?.isValid() ? entry.bounds.getCenter() : null;
      if (center) addSiteMarker(site, center);
    });

    buildFeatureList();
    setStatus('Loaded');
  } catch (err) {
    console.error(err);
    setStatus('Failed to load GeoJSON');
    map.setView(FALLBACK_VIEW, 13);
  }
}

async function loadSiteGeoJSON(site) {
  const entry = siteStore.get(site.id);
  if (!entry) return;

  // Skip fetching if no carUrl (pure marker site)
  if (!site.carUrl) return;

  const fetches = [
    fetch(site.carUrl).then(r => {
      if (!r.ok) throw new Error(`${site.id} car fetch failed (${r.status})`);
      return r.json();
    }),
  ];

  if (site.backgroundUrl) {
    fetches.push(
      fetch(site.backgroundUrl)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
    );
  }

  const [carData, bgData] = await Promise.all(fetches);

  const taggedCar = tagGeoJSON(carData, site.id, null); // leave kind to per-feature type detection
  polygonsLayer.addData(taggedCar);

  if (bgData) {
    const taggedBg = tagGeoJSON(bgData, site.id, 'background');
    polygonsLayer.addData(taggedBg);
  }
}

function tagGeoJSON(geojson, siteId, kind) {
  const clone = JSON.parse(JSON.stringify(geojson));
  if (clone.type === 'FeatureCollection' && Array.isArray(clone.features)) {
    clone.features.forEach(f => {
      f.properties = f.properties || {};
      f.properties._siteId = siteId;
      if (kind) f.properties._kind = kind;
    });
  } else if (clone.type === 'Feature') {
    clone.properties = clone.properties || {};
    clone.properties._siteId = siteId;
    if (kind) clone.properties._kind = kind;
  }
  return clone;
}

function setStatus(text) {
  if (statusBadge) statusBadge.textContent = text;
}

function featureStyle(feature) {
  const { kind, type } = deriveKind(feature?.properties);
  let fill = '#5aa6ff';
  if (kind === 'background') {
    fill = '#b7c4d6';
  } else if (kind === 'car') {
    fill = 'var(--car-lot)';
  } else if (kind === 'ev') {
    fill = 'var(--ev-lot)';
  } else if (kind === 'motorbike') {
    fill = 'var(--motorbike-lot)';
  } else if (kind === 'structure') {
    fill = 'var(--structure)';
  }
  return {
    color: '#0f1828',
    weight: kind === 'background' ? 2 : 1,
    fillColor: fill,
    fillOpacity: kind === 'background' ? 0.2 : 0.7,
  };
}

function onEachFeature(feature, layer) {
  const props = feature?.properties || {};
  const title = getFeatureTitle(props);
  const typeLabel = props.type || 'Unknown type';
  const { kind } = deriveKind(props);
  const isBackground = kind === 'background';
  const isLot = kind === 'car' || kind === 'ev' || kind === 'motorbike';
  const siteId = props._siteId || 'unknown';
  const entry = ensureSiteEntry(siteId);

  if (!isBackground) {
    layer.bindPopup(
      `<strong>${title}</strong><br/><span>${typeLabel}</span>`
    );
  }
  layer.featureId = ++featureIndex;
  layer.on('click', () => highlightLayer(layer));

  // Hover tooltips for lots (car / motorbike)
  if (isLot) {
    layer.bindTooltip(`<strong>${title}</strong><br/><span>${typeLabel}</span>`, {
      sticky: true,
      direction: 'top',
      opacity: 0.9,
      className: 'lot-tooltip'
    });
  }

  // Track per-site layers and bounds
  if (isBackground) {
    entry.bgLayers.push(layer);
  } else if (kind === 'car') {
    entry.carLayers.push(layer);
  } else if (kind === 'ev') {
    entry.evLayers.push(layer);
  } else if (kind === 'motorbike') {
    entry.bikeLayers.push(layer);
  } else if (kind === 'structure') {
    entry.structureLayers.push(layer);
  }

  if (layer.getBounds) {
    entry.bounds.extend(layer.getBounds());
    bounds.extend(layer.getBounds());
  }
}

function highlightLayer(layer) {
  if (!layer) return;
  try {
    const targetBounds = layer.getBounds();
    const center = targetBounds.getCenter();
    // Keep current zoom; just pan to the feature
    map.panTo(center, { animate: true });
    layer.openPopup();
  } catch (_) {}
}

function buildFeatureList() {
  featureListEl.innerHTML = '';
  buildFiltersUI();

  // Show filters container when in list view
  const filtersEl = document.querySelector('.filters');
  if (filtersEl) filtersEl.style.display = 'flex';

  let filtered = [...SITES];

  // Search filter
  if (filterState.search.trim()) {
    const q = filterState.search.trim().toLowerCase();
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q)
    );
  }

  // Type filter
  if (filterState.type !== 'all') {
    filtered = filtered.filter(s => {
      const tokens = splitTypes(s.type);
      return tokens.includes(filterState.type);
    });
  }

  // Sort
  filtered.sort((a, b) => {
    if (filterState.sort === 'name-asc') return a.name.localeCompare(b.name);
    if (filterState.sort === 'car-desc') {
      const aLots = carLotsCount(a.id);
      const bLots = carLotsCount(b.id);
      return bLots - aLots;
    }
    if (filterState.sort === 'date-desc' || filterState.sort === 'date-asc') {
      const aDate = parsePolygonised(a.polygonised);
      const bDate = parsePolygonised(b.polygonised);
      return filterState.sort === 'date-desc' ? bDate - aDate : aDate - bDate;
    }
    return 0;
  });

  featureCountEl.textContent = filtered.length;

  filtered.forEach(site => {
    const entry = siteStore.get(site.id) || {};
    const carLotCount = entry.carLayers?.length || 0;
    const bikeLotCount = entry.bikeLayers?.length || 0;
    const evLotCount = entry.evLayers?.length || 0;
    const structureCount = entry.structureLayers?.length || 0;
    const progress = site.progress ?? null;
    const isWip = (site.polygonised || '').toLowerCase().includes('progress');

    const item = document.createElement('div');
    item.className = 'feature-card';
    item.innerHTML = `
      <header>
        <div>
          <div class="feature-name">${site.name}</div>
          <div class="feature-type">${site.address}</div>
          <div class="feature-type">${site.type || ''}</div>
        </div>
        <button class="primary-link icon-only" data-site="${site.id}" title="Show lots">+</button>
      </header>
      ${isWip ? `<div class="wip-badge">WIP</div>` : ''}
      <div class="feature-meta">
        Polygonised: ${site.polygonised}
      </div>
      <div class="feature-meta">
        Number of Lots: ${carLotCount || 'N/A'}
      </div>
      ${progress !== null ? `
      <div class="progress-row">
        <div class="progress-label">Progress: ${progress}%</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%;"></div></div>
      </div>` : ''}
    `;
    item.querySelector('button').addEventListener('click', () => {
      renderLotsView(site.id);
    });

    featureListEl.appendChild(item);
  });
}

function buildFiltersUI() {
  if (filtersBuilt) return;
  const container = document.createElement('div');
  container.className = 'filters';
  container.innerHTML = `
    <div class="filter-row">
      <select id="filterType" class="filter-select">
        <option value="all">All types</option>
        ${Array.from(new Set(SITES.flatMap(s => splitTypes(s.type)))).map(t => `<option value="${t}">${titleCase(t)}</option>`).join('')}
      </select>
      <select id="filterSort" class="filter-select">
        <option value="name-asc">Name (A→Z)</option>
        <option value="car-desc">Lots (high → low)</option>
        <option value="date-desc">Polygonised (newest)</option>
        <option value="date-asc">Polygonised (oldest)</option>
      </select>
    </div>
    <input id="filterSearch" class="filter-input full-width" placeholder="Search name or address..." />
  `;
  featureListEl.parentElement?.insertBefore(container, featureListEl);

  const searchEl = container.querySelector('#filterSearch');
  const typeEl = container.querySelector('#filterType');
  const sortEl = container.querySelector('#filterSort');

  searchEl.addEventListener('input', e => {
    filterState.search = e.target.value || '';
    buildFeatureList();
  });
  typeEl.addEventListener('change', e => {
    filterState.type = e.target.value;
    buildFeatureList();
  });
  sortEl.addEventListener('change', e => {
    filterState.sort = e.target.value;
    buildFeatureList();
  });

  filtersBuilt = true;
}

function totalLots(siteId) {
  const entry = ensureSiteEntry(siteId);
  return (entry.carLayers?.length || 0) +
    (entry.evLayers?.length || 0) +
    (entry.bikeLayers?.length || 0) +
    (entry.structureLayers?.length || 0);
}

function carLotsCount(siteId) {
  const entry = ensureSiteEntry(siteId);
  return entry.carLayers?.length || 0;
}

function buildMetaLine(props) {
  const fields = [];
  if (props?.name) fields.push(props.name);
  if (props?.car_lots) fields.push(`Lots: ${props.car_lots}`);
  if (props?.completed_at) fields.push(`Completed: ${props.completed_at}`);
  if (props?.notes) fields.push(props.notes);
  return fields.length ? fields.join(' • ') : 'No additional properties';
}

function getFeatureTitle(props, idx = 0) {
  return props?.name || props?.id || props?.type || `Feature ${idx + 1}`;
}

if (fitAllBtn) {
  // Hide "Zoom to all" per requirements
  fitAllBtn.style.display = 'none';
}

function renderLotsView(siteId) {
  const entry = ensureSiteEntry(siteId);
  const { carLayers = [], bikeLayers = [], evLayers = [], structureLayers = [], site } = entry;

  // Hide filters when in lots view
  const filtersEl = document.querySelector('.filters');
  if (filtersEl) filtersEl.style.display = 'none';

  const carBounds = L.latLngBounds();
  [...carLayers, ...bikeLayers, ...evLayers, ...structureLayers].forEach(l => {
    if (l.getBounds) carBounds.extend(l.getBounds());
  });
  if (carBounds.isValid()) {
    map.fitBounds(carBounds.pad(0.12));
  } else if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.12));
  }

  featureListEl.innerHTML = '';

  const back = document.createElement('button');
  back.className = 'ghost-btn';
  back.textContent = 'Back';
  back.style.margin = '8px 12px';
  back.addEventListener('click', buildFeatureList);
  featureListEl.appendChild(back);

  const meta = document.createElement('div');
  meta.className = 'feature-card';
  meta.innerHTML = `
    <header>
      <div>
        <div class="feature-name">${site?.name || ''}</div>
        <div class="feature-type">${site?.address || ''}</div>
        <div class="feature-type">${site?.type || ''}</div>
      </div>
    </header>
    <div class="feature-meta">
      Polygonised: ${site?.polygonised || 'N/A'} • Car Lots: ${carLayers.length || 'N/A'} • EV Car Lots: ${evLayers.length || 'N/A'} • Motorbike Lots: ${bikeLayers.length || 'N/A'} • Structures: ${structureLayers.length || 'N/A'}
    </div>
    <div class="feature-meta">
      ${PLACEHOLDERS.join(' • ')}
    </div>
    <div class="lot-actions">
      <label class="toggle-row">
        <input type="checkbox" id="osmRoadsToggle">
        <span>Show OSM roads for this site</span>
      </label>
    </div>
  `;
  featureListEl.appendChild(meta);

  const roadsToggle = meta.querySelector('#osmRoadsToggle');
  if (roadsToggle) {
    roadsToggle.addEventListener('change', async (e) => {
      if (e.target.checked) {
        setStatus('Loading OSM roads…');
        try {
          await loadOsmRoadsForSite(siteId);
          setStatus('OSM roads loaded');
        } catch (err) {
          console.error(err);
          setStatus('Failed to load OSM roads');
          e.target.checked = false;
        }
      } else {
        if (osmRoutesLayer) {
          map.removeLayer(osmRoutesLayer);
          osmRoutesLayer = null;
        }
      }
    });
  }

  const combined = [
    ...carLayers.map((layer, i) => ({ layer, label: `Car Lot ${i + 1}`, type: 'car' })),
    ...evLayers.map((layer, i) => ({ layer, label: `EV Car Lot ${i + 1}`, type: 'ev' })),
    ...bikeLayers.map((layer, i) => ({ layer, label: `Motorbike Lot ${i + 1}`, type: 'bike' })),
    ...structureLayers.map((layer, i) => ({ layer, label: `Structure ${i + 1}`, type: 'structure' })),
  ];

  combined.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'feature-card';
    card.innerHTML = `
      <header>
        <div>
          <div class="feature-name">${entry.label}</div>
          <div class="feature-type">${
            entry.type === 'car'
              ? 'Car Lot'
              : entry.type === 'ev'
              ? 'EV Car Lot'
              : entry.type === 'bike'
              ? 'Motorbike Lot'
              : 'Structure'
          }</div>
        </div>
        <button class="primary-link">Zoom</button>
      </header>
    `;
    card.querySelector('button').addEventListener('click', () => {
      highlightLayer(entry.layer);
    });
    featureListEl.appendChild(card);
  });
}

function addSiteMarker(site, center) {
  if (!center) return;
  const entry = ensureSiteEntry(site.id);
  if (entry.marker) {
    entry.marker.setLatLng(center);
    updateSiteMarkerVisibility();
    return;
  }
  const photoStyle = site.photoUrl ? `background-image:url('${site.photoUrl}')` : '';
  const icon = L.divIcon({
    className: 'site-marker',
    html: `
      <div class="site-marker-badge">
        <div class="site-marker-photo" style="${photoStyle}"></div>
        <div class="site-marker-dot"></div>
        <div class="site-marker-label">${site.name}</div>
      </div>
    `,
    iconSize: [96, 104],
    iconAnchor: [48, 80],
  });
  entry.marker = L.marker(center, { icon }).addTo(map);
  entry.marker.on('click', () => {
    if (entry.bounds.isValid()) map.fitBounds(entry.bounds.pad(0.12));
  });
  map.on('zoomend', updateSiteMarkerVisibility);
  updateSiteMarkerVisibility();
}

function updateSiteMarkerVisibility() {
  const zoom = map.getZoom();
  siteStore.forEach(entry => {
    const marker = entry.marker;
    if (!marker) return;
    const el = marker.getElement();
    if (!el) return;
    const hidden = zoom >= SITE_LABEL_HIDE_ZOOM;
    if (hidden) {
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
      marker.setZIndexOffset(-1000);
    } else {
      el.style.display = 'block';
      el.style.pointerEvents = 'auto';
      marker.setZIndexOffset(1000);
    }
  });
}

function ensureSiteEntry(siteId) {
  if (!siteStore.has(siteId)) {
    siteStore.set(siteId, {
      site: SITES.find(s => s.id === siteId),
      carLayers: [],
      bikeLayers: [],
      evLayers: [],
      structureLayers: [],
      bgLayers: [],
      bounds: L.latLngBounds(),
      marker: null,
    });
  }
  return siteStore.get(siteId);
}

function deriveKind(props = {}) {
  const rawType = (props.type || props.Type || '').toLowerCase();
  const taggedKind = (props._kind || '').toLowerCase();
  if (taggedKind === 'background') return { kind: 'background', type: rawType };
  if (rawType.includes('background')) return { kind: 'background', type: rawType };
  if (rawType.includes('ev')) return { kind: 'ev', type: rawType };
  if (rawType.includes('motorbike') || rawType.includes('bike')) return { kind: 'motorbike', type: rawType };
  if (rawType.includes('car')) return { kind: 'car', type: rawType };
  if (rawType.includes('wall') || rawType.includes('pillar') || rawType.includes('kerb') || rawType.includes('curb') || rawType.includes('structure')) {
    return { kind: 'structure', type: rawType };
  }
  return { kind: 'other', type: rawType };
}

function splitTypes(typeStr = '') {
  return typeStr
    .split(/[\/,&]/)
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
}

function titleCase(str = '') {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1));
}

async function loadOsmChangeset(changesetId) {
  const conv = await ensureOsmtogeojson();
  const url = `https://api.openstreetmap.org/api/0.6/changeset/${changesetId}/download`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Changeset fetch failed (${resp.status})`);
  }
  const xmlText = await resp.text();
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  const geojson = conv(xml);

  // Filter to routes/roads/lines of interest
  const features = (geojson.features || []).filter(f => {
    const props = f.properties || {};
    const tags = props.tags || props;
    const type = (tags.type || '').toLowerCase();
    const highway = tags.highway;
    const route = tags.route;
    return highway || route || type === 'route' || type === 'multipolygon';
  });

  if (osmRoutesLayer) {
    map.removeLayer(osmRoutesLayer);
    osmRoutesLayer = null;
  }

  osmRoutesLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: {
      color: '#8b5cf6',
      weight: 3,
      opacity: 0.8
    }
  }).addTo(map);

  const layerBounds = osmRoutesLayer.getBounds();
  if (layerBounds.isValid()) {
    map.fitBounds(layerBounds.pad(0.1));
  }
}

function ensureOsmtogeojson() {
  return new Promise((resolve, reject) => {
    const existing = window.osmtogeojson || (window.osmtogeojson && window.osmtogeojson.default);
    if (typeof existing === 'function') return resolve(existing);

    const urls = [
      'https://cdn.jsdelivr.net/npm/osmtogeojson@3.0.0/osmtogeojson.min.js',
      'https://unpkg.com/osmtogeojson@3.0.0/osmtogeojson.js',
      'https://unpkg.com/osmtogeojson@3.0.0/dist/osmtogeojson.js'
    ];

    let idx = 0;
    const scriptId = 'osmtogeojson-cdn';
    function tryNext() {
      if (idx >= urls.length) return reject(new Error('osmtogeojson failed to load'));
      const url = urls[idx++];
      let script = document.getElementById(scriptId);
      if (script) script.remove();
      script = document.createElement('script');
      script.id = scriptId;
      script.src = url;
      script.onload = () => {
        const fn = window.osmtogeojson || (window.osmtogeojson && window.osmtogeojson.default);
        if (typeof fn === 'function') return resolve(fn);
        tryNext();
      };
      script.onerror = () => tryNext();
      document.head.appendChild(script);
    }
    tryNext();
  });
}

async function loadOsmRoadsForSite(siteId) {
  if (osmLoading) return;
  osmLoading = true;
  try {
    const entry = ensureSiteEntry(siteId);
    let bbox = null;
    if (entry.bounds && entry.bounds.isValid()) {
      bbox = entry.bounds;
    } else if (entry.site?.latLng?.length === 2) {
      const ll = L.latLng(entry.site.latLng[0], entry.site.latLng[1]);
      bbox = L.latLngBounds(
        [ll.lat - 0.01, ll.lng - 0.01],
        [ll.lat + 0.01, ll.lng + 0.01]
      );
    }
    if (!bbox || !bbox.isValid()) throw new Error('No bounds for this site');

    const south = bbox.getSouth();
    const west = bbox.getWest();
    const north = bbox.getNorth();
    const east = bbox.getEast();

  const query = `[out:json][timeout:15];(way["highway"](${south},${west},${north},${east}););out geom;`;
  const data = await fetchOverpass(query);
    const geojson = overpassToGeoJSON(data);

    if (osmRoutesLayer) {
      map.removeLayer(osmRoutesLayer);
      osmRoutesLayer = null;
    }

    osmRoutesLayer = L.geoJSON(geojson, {
      style: feature => {
        const highway = feature.properties?.highway || '';
        const isMajor = ['motorway', 'trunk', 'primary'].includes(highway);
        return {
          color: isMajor ? '#ff6b6b' : '#4f83ff',
          weight: isMajor ? 4 : 2,
          opacity: 0.85,
        };
      }
    }).addTo(map);

    const layerBounds = osmRoutesLayer.getBounds();
    if (layerBounds.isValid()) {
      map.fitBounds(layerBounds.pad(0.1));
    }
  } finally {
    osmLoading = false;
  }
}

function overpassToGeoJSON(data) {
  const features = [];
  const nodes = new Map();
  (data.elements || []).forEach(el => {
    if (el.type === 'node') {
      nodes.set(el.id, el);
    }
  });
  (data.elements || []).forEach(el => {
    if (el.type === 'way' && el.geometry) {
      const coords = el.geometry.map(pt => [pt.lon, pt.lat]);
      features.push({
        type: 'Feature',
        properties: el.tags || {},
        geometry: {
          type: 'LineString',
          coordinates: coords
        }
      });
    }
  });
  return { type: 'FeatureCollection', features };
}

async function fetchOverpass(query) {
  const body = 'data=' + encodeURIComponent(query);
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (!resp.ok) throw new Error(`Overpass fetch failed (${resp.status})`);
        return await resp.json();
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error('Overpass fetch failed');
}

// Legend
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'legend');
  div.innerHTML = `
    <div class="legend-item"><span class="legend-swatch"></span>Car Lot</div>
    <div class="legend-item"><span class="legend-swatch"></span>EV Car Lot</div>
    <div class="legend-item"><span class="legend-swatch"></span>Motorbike Lot</div>
    <div class="legend-item"><span class="legend-swatch"></span>Structures</div>
  `;
  return div;
};
legend.addTo(map);

loadData();

