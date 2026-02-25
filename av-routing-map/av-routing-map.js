// AV Routing Map - Road network analysis for autonomous vehicles
const FALLBACK_VIEW = [1.3521, 103.8198]; // Singapore center
const SINGAPORE_BOUNDS = [
  [1.1583, 103.6058], // Southwest
  [1.4707, 104.0405]  // Northeast
];

// OneMap API Proxy endpoint (via Netlify function)
const ONEMAP_PROXY_ENDPOINT = '/.netlify/functions/onemap';

const statusBadge = document.getElementById('statusBadge');
const errorNotification = document.getElementById('errorNotification');
const featureListEl = document.getElementById('featureList');
const featureCountEl = document.getElementById('featureCount');
const fitAllBtn = document.getElementById('fitAllBtn');
const filterRoadType = document.getElementById('filterRoadType');
const filterLanes = document.getElementById('filterLanes');
const showSilverZones = document.getElementById('showSilverZones');
const showSchoolZones = document.getElementById('showSchoolZones');
const showTraffic = document.getElementById('showTraffic');
const showRoadClosures = document.getElementById('showRoadClosures');
const loadCurrentViewBtn = document.getElementById('loadCurrentViewBtn');
const loadSingaporeBtn = document.getElementById('loadSingaporeBtn');

// Map initialization
const map = L.map('map', {
  zoomControl: true,
  scrollWheelZoom: true,
  maxZoom: 20,
  preferCanvas: true, // Use canvas renderer for better performance with many features
});

// Base map layer
const cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors | &copy; CARTO',
  maxZoom: 20,
});
cartoLight.addTo(map);

// Set initial view to Singapore
map.setView(FALLBACK_VIEW, 12);

// Layers
let roadsLayer = null;
let silverZonesLayer = null;
let schoolZonesLayer = null;
let trafficLayer = null;
let closuresLayer = null;

// Filter state
const filterState = {
  roadType: 'all',
  minLanes: 0,
  showSilverZones: false,
  showSchoolZones: false,
  showTraffic: false,
  showRoadClosures: false,
};

// Overpass API endpoints
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];

let isLoading = false;
let allRoadsData = null; // Store all loaded roads data for zoom-based filtering

// Initialize event listeners
function initializeListeners() {
  if (fitAllBtn) {
    fitAllBtn.addEventListener('click', () => {
      map.fitBounds(SINGAPORE_BOUNDS, { padding: [50, 50] });
    });
  }
  
  // Update roads visibility on zoom
  map.on('zoomend', updateRoadsByZoom);

  if (filterRoadType) {
    filterRoadType.addEventListener('change', (e) => {
      filterState.roadType = e.target.value;
      applyFilters();
    });
  }

  if (filterLanes) {
    filterLanes.addEventListener('change', (e) => {
      filterState.minLanes = parseInt(e.target.value) || 0;
      applyFilters();
    });
  }

  if (showSilverZones) {
    showSilverZones.addEventListener('change', (e) => {
      filterState.showSilverZones = e.target.checked;
      toggleSilverZones();
    });
  }

  if (showSchoolZones) {
    showSchoolZones.addEventListener('change', (e) => {
      filterState.showSchoolZones = e.target.checked;
      toggleSchoolZones();
    });
  }

  if (showTraffic) {
    showTraffic.addEventListener('change', (e) => {
      filterState.showTraffic = e.target.checked;
      toggleTraffic();
    });
  }

  if (showRoadClosures) {
    showRoadClosures.addEventListener('change', (e) => {
      filterState.showRoadClosures = e.target.checked;
      toggleRoadClosures();
    });
  }

  if (loadCurrentViewBtn) {
    loadCurrentViewBtn.addEventListener('click', () => {
      loadRoadsForCurrentView();
    });
  }

  if (loadSingaporeBtn) {
    loadSingaporeBtn.addEventListener('click', () => {
      loadRoadsForSingapore();
    });
  }
}

// Load roads for current map view
async function loadRoadsForCurrentView() {
  if (isLoading) return;
  
  const bounds = map.getBounds();
  await loadRoads(bounds);
}

// Load roads for all of Singapore
async function loadRoadsForSingapore() {
  if (isLoading) return;
  
  const bounds = L.latLngBounds(SINGAPORE_BOUNDS);
  await loadRoads(bounds);
}

// Main function to load roads from Overpass API
async function loadRoads(bounds) {
  if (isLoading) return;
  isLoading = true;
  
  setStatus('Loading roads...');
  hideError();
  
  try {
    const south = bounds.getSouth();
    const west = bounds.getWest();
    const north = bounds.getNorth();
    const east = bounds.getEast();

    // Overpass query to get highways/roads
    const query = `[out:json][timeout:25];
(
  way["highway"](${south},${west},${north},${east});
);
out geom;`;

    const data = await fetchOverpass(query);
    
    if (!data || !data.elements || data.elements.length === 0) {
      throw new Error('No road data returned from Overpass API');
    }
    
    const geojson = overpassToGeoJSON(data);
    
    if (!geojson || !geojson.features || geojson.features.length === 0) {
      throw new Error('No valid road features found in response');
    }

    // Store all roads data for zoom-based filtering
    allRoadsData = geojson;

    // Remove existing roads layer
    if (roadsLayer) {
      map.removeLayer(roadsLayer);
      roadsLayer = null;
    }

    // Filter features by zoom level for better performance
    const currentZoom = map.getZoom();
    const filteredFeatures = filterRoadsByZoom(geojson.features, currentZoom);

    // Create optimized GeoJSON with filtered features
    const optimizedGeoJSON = {
      type: 'FeatureCollection',
      features: filteredFeatures
    };

    setStatus(`Rendering ${filteredFeatures.length} roads...`);
    
    // Use requestAnimationFrame for smoother rendering
    requestAnimationFrame(() => {
      // Create new roads layer with canvas renderer
      roadsLayer = L.geoJSON(optimizedGeoJSON, {
        style: getRoadStyle,
        onEachFeature: onEachRoadFeature,
        renderer: L.canvas({ padding: 0.5 }) // Use canvas renderer for better performance
      }).addTo(map);

      updateFeatureCount(filteredFeatures.length);
      setStatus(`Loaded ${filteredFeatures.length} roads (${geojson.features.length} total)`);
      
      // Fit bounds to loaded roads
      if (roadsLayer.getBounds().isValid()) {
        map.fitBounds(roadsLayer.getBounds().pad(0.05));
      }
      
      applyFilters();
    });
  } catch (err) {
    const errorMessage = err.message || 'Unknown error occurred';
    const errorDetails = err.networkError ? 'Network error - check your connection' :
                         err.timeout ? 'Request timeout - server took too long to respond' :
                         'Overpass API unavailable';
    
    showError('Failed to load roads', errorDetails);
    setStatus('Failed to load roads', true);
    console.error('Error loading roads:', err);
  } finally {
    isLoading = false;
  }
}

// Simplify geometry using Douglas-Peucker algorithm
function simplifyGeometry(coordinates, tolerance = 0.0001) {
  if (coordinates.length <= 2) return coordinates;
  
  // Simple distance-based simplification
  const simplified = [coordinates[0]];
  
  for (let i = 1; i < coordinates.length - 1; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    const next = coordinates[i + 1];
    
    // Calculate distance from current point to line segment
    const dx1 = curr[0] - prev[0];
    const dy1 = curr[1] - prev[1];
    const dx2 = next[0] - prev[0];
    const dy2 = next[1] - prev[1];
    
    const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
    const len = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const dist = len > 0 ? cross / len : 0;
    
    // Keep point if it's far enough from the line
    if (dist > tolerance) {
      simplified.push(curr);
    }
  }
  
  simplified.push(coordinates[coordinates.length - 1]);
  return simplified;
}

// Convert Overpass API response to GeoJSON with optimization
function overpassToGeoJSON(data) {
  const features = [];
  const nodes = new Map();
  
  // First pass: collect nodes
  (data.elements || []).forEach(el => {
    if (el.type === 'node') {
      nodes.set(el.id, el);
    }
  });
  
  // Second pass: create ways as LineStrings with simplification
  (data.elements || []).forEach(el => {
    if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      // GeoJSON uses [lng, lat] format
      let coords = el.geometry.map(pt => [pt.lon, pt.lat]);
      
      // Filter out very short segments (less than ~10 meters)
      const minSegmentLength = 0.0001; // Approximate threshold
      const filteredCoords = [];
      for (let i = 0; i < coords.length; i++) {
        if (i === 0 || i === coords.length - 1) {
          filteredCoords.push(coords[i]);
        } else {
          const prev = coords[i - 1];
          const curr = coords[i];
          const dist = Math.sqrt(
            Math.pow(curr[0] - prev[0], 2) + Math.pow(curr[1] - prev[1], 2)
          );
          if (dist > minSegmentLength) {
            filteredCoords.push(curr);
          }
        }
      }
      
      // Simplify geometry based on zoom level (will be applied later)
      // For now, apply basic simplification
      if (filteredCoords.length > 2) {
        coords = simplifyGeometry(filteredCoords, 0.00005);
      } else {
        coords = filteredCoords;
      }
      
      // Skip if too few coordinates after filtering
      if (coords.length < 2) return;
      
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

// Style roads based on highway type
function getRoadStyle(feature) {
  const highway = feature.properties?.highway || '';
  const lanes = parseInt(feature.properties?.lanes) || 0;
  
  // Color by road type
  let color = '#4f83ff'; // Default blue
  let weight = 2;
  
  switch (highway) {
    case 'motorway':
      color = '#ff6b6b';
      weight = 5;
      break;
    case 'trunk':
      color = '#ff8c42';
      weight = 4;
      break;
    case 'primary':
      color = '#ffd93d';
      weight = 4;
      break;
    case 'secondary':
      color = '#6bcf7f';
      weight = 3;
      break;
    case 'tertiary':
      color = '#4dabf7';
      weight = 2;
      break;
    case 'residential':
      color = '#a0a0a0';
      weight = 1.5;
      break;
    case 'service':
      color = '#c0c0c0';
      weight = 1;
      break;
  }
  
  return {
    color,
    weight,
    opacity: 0.85,
    lineCap: 'round',
    lineJoin: 'round'
  };
}

// Handle each road feature
function onEachRoadFeature(feature, layer) {
  const props = feature.properties || {};
  const highway = props.highway || 'unknown';
  const lanes = props.lanes || 'unknown';
  const name = props.name || 'Unnamed road';
  const maxspeed = props.maxspeed || 'unknown';
  
  // Only bind popup for major roads or on click (lazy loading)
  // This reduces initial processing time
  if (['motorway', 'trunk', 'primary'].includes(highway)) {
    const popupContent = `
      <div class="road-popup">
        <strong>${name}</strong><br/>
        <span>Type: ${highway}</span><br/>
        ${lanes !== 'unknown' ? `<span>Lanes: ${lanes}</span><br/>` : ''}
        ${maxspeed !== 'unknown' ? `<span>Max Speed: ${maxspeed}</span>` : ''}
      </div>
    `;
    layer.bindPopup(popupContent);
  } else {
    // Lazy popup binding for minor roads
    layer.on('click', function() {
      if (!this._popup) {
        const popupContent = `
          <div class="road-popup">
            <strong>${name}</strong><br/>
            <span>Type: ${highway}</span><br/>
            ${lanes !== 'unknown' ? `<span>Lanes: ${lanes}</span><br/>` : ''}
            ${maxspeed !== 'unknown' ? `<span>Max Speed: ${maxspeed}</span>` : ''}
          </div>
        `;
        this.bindPopup(popupContent).openPopup();
      }
    });
  }
  
  // Store original style for filtering
  layer._originalStyle = getRoadStyle(feature);
}

// Filter roads by zoom level
function filterRoadsByZoom(features, zoom) {
  return features.filter(feature => {
    const highway = feature.properties?.highway || '';
    
    // At low zoom levels, only show major roads
    if (zoom < 12) {
      return ['motorway', 'trunk', 'primary'].includes(highway);
    } else if (zoom < 14) {
      return ['motorway', 'trunk', 'primary', 'secondary'].includes(highway);
    }
    // At zoom 14+, show all roads
    return true;
  });
}

// Update roads visibility based on zoom level
let zoomUpdateTimeout = null;
function updateRoadsByZoom() {
  if (!roadsLayer) return;
  
  // Debounce zoom updates
  clearTimeout(zoomUpdateTimeout);
  zoomUpdateTimeout = setTimeout(() => {
    const currentZoom = map.getZoom();
    let visibleCount = 0;
    
    // Show/hide features based on zoom without recreating layer
    roadsLayer.eachLayer((layer) => {
      const feature = layer.feature;
      const highway = feature?.properties?.highway || '';
      const style = layer._originalStyle || getRoadStyle(feature);
      
      // Show/hide based on zoom level
      let shouldShow = true;
      if (currentZoom < 12) {
        shouldShow = ['motorway', 'trunk', 'primary'].includes(highway);
      } else if (currentZoom < 14) {
        shouldShow = ['motorway', 'trunk', 'primary', 'secondary'].includes(highway);
      }
      
      if (shouldShow) {
        layer.setStyle(style);
        visibleCount++;
      } else {
        layer.setStyle({ opacity: 0, fillOpacity: 0, weight: 0 });
      }
    });
    
    updateFeatureCount(visibleCount);
  }, 150); // Debounce for 150ms
}

// Apply filters to roads layer
function applyFilters() {
  if (!roadsLayer) return;
  
  // Use requestAnimationFrame for smoother updates
  requestAnimationFrame(() => {
    const currentZoom = map.getZoom();
    let visibleCount = 0;
    
    roadsLayer.eachLayer((layer) => {
      const feature = layer.feature;
      const props = feature?.properties || {};
      const highway = props.highway || '';
      const lanes = parseInt(props.lanes) || 0;
      
      let visible = true;
      
      // Zoom-based visibility
      if (currentZoom < 12) {
        visible = ['motorway', 'trunk', 'primary'].includes(highway);
      } else if (currentZoom < 14) {
        visible = ['motorway', 'trunk', 'primary', 'secondary'].includes(highway);
      }
      
      // Road type filter
      if (visible && filterState.roadType !== 'all' && highway !== filterState.roadType) {
        visible = false;
      }
      
      // Lanes filter
      if (visible && filterState.minLanes > 0 && lanes < filterState.minLanes) {
        visible = false;
      }
      
      if (visible) {
        layer.setStyle(layer._originalStyle || getRoadStyle(feature));
        visibleCount++;
      } else {
        layer.setStyle({ opacity: 0, fillOpacity: 0 });
      }
    });
    
    updateFeatureCount(visibleCount);
  });
}

// Update feature count
function updateFeatureCount(count) {
  if (featureCountEl) {
    if (count !== undefined) {
      featureCountEl.textContent = `${count} roads loaded`;
    } else {
      // Count visible roads
      let visibleCount = 0;
      if (roadsLayer) {
        roadsLayer.eachLayer((layer) => {
          const style = layer.options;
          if (style.opacity > 0) visibleCount++;
        });
      }
      featureCountEl.textContent = `${visibleCount} roads visible`;
    }
  }
}

// Toggle Silver Zones - Load from data.gov.sg API
async function toggleSilverZones() {
  if (filterState.showSilverZones) {
    if (silverZonesLayer) {
      // Already loaded, just show it
      map.addLayer(silverZonesLayer);
      return;
    }
    
    setStatus('Loading Silver Zones...');
    hideError();
    
    try {
      await loadSilverZones();
      setStatus('Silver Zones loaded');
    } catch (err) {
      const errorMessage = err.message || 'Unknown error occurred';
      let errorDetails = 'Data source unavailable';
      
      if (errorMessage.includes('Rate limit')) {
        errorDetails = 'Rate limit exceeded - please wait a moment and try again';
      } else if (errorMessage.includes('data.gov.sg')) {
        errorDetails = 'Please download GeoJSON from data.gov.sg/collections/330 and load manually';
      } else if (errorMessage.includes('timeout')) {
        errorDetails = 'Request timeout - server took too long to respond';
      } else if (errorMessage.includes('Network')) {
        errorDetails = 'Network error - check your connection';
      }
      
      showError('Failed to load Silver Zones', errorDetails);
      setStatus('Failed to load Silver Zones', true);
      
      // Reset checkbox
      filterState.showSilverZones = false;
      if (showSilverZones) showSilverZones.checked = false;
    }
  } else {
    if (silverZonesLayer) {
      map.removeLayer(silverZonesLayer);
    }
    hideError();
  }
}

// Toggle School Zones - Load from data.gov.sg API
async function toggleSchoolZones() {
  if (filterState.showSchoolZones) {
    if (schoolZonesLayer) {
      // Already loaded, just show it
      map.addLayer(schoolZonesLayer);
      return;
    }
    
    setStatus('Loading School Zones...');
    hideError();
    
    try {
      await loadSchoolZones();
      setStatus('School Zones loaded');
    } catch (err) {
      const errorMessage = err.message || 'Unknown error occurred';
      let errorDetails = 'Data source unavailable';
      
      if (errorMessage.includes('Rate limit')) {
        errorDetails = 'Rate limit exceeded - please wait a moment and try again';
      } else if (errorMessage.includes('data.gov.sg')) {
        errorDetails = 'Please download GeoJSON from data.gov.sg/collections/329 and load manually';
      } else if (errorMessage.includes('timeout')) {
        errorDetails = 'Request timeout - server took too long to respond';
      } else if (errorMessage.includes('Network')) {
        errorDetails = 'Network error - check your connection';
      }
      
      showError('Failed to load School Zones', errorDetails);
      setStatus('Failed to load School Zones', true);
      
      // Reset checkbox
      filterState.showSchoolZones = false;
      if (showSchoolZones) showSchoolZones.checked = false;
    }
  } else {
    if (schoolZonesLayer) {
      map.removeLayer(schoolZonesLayer);
    }
    hideError();
  }
}

// Load Silver Zones from data.gov.sg API (via Netlify proxy or direct)
async function loadSilverZones() {
  const timeout = 15000; // 15 second timeout
  
  try {
    // First try Netlify proxy function (if available)
    try {
      const proxyController = new AbortController();
      const proxyTimeout = setTimeout(() => proxyController.abort(), timeout);
      
      const proxyResponse = await fetch('/.netlify/functions/onemap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getSilverZones' }),
        signal: proxyController.signal
      });
      
      clearTimeout(proxyTimeout);
      
      if (proxyResponse.ok) {
        const data = await proxyResponse.json();
        
        // Check for error in response
        if (data.error) {
          throw new Error(`Proxy error: ${data.error}`);
        }
        
        // Validate GeoJSON structure
        if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
          if (data.features.length === 0) {
            throw new Error('No Silver Zones found in data source');
          }
          displaySilverZones(data);
          return;
        } else {
          throw new Error('Invalid GeoJSON format received from proxy');
        }
      } else {
        // Try to get error details
        let errorMessage = `HTTP ${proxyResponse.status}`;
        try {
          const errorData = await proxyResponse.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch (e) {
          errorMessage = proxyResponse.statusText || `HTTP ${proxyResponse.status}`;
        }
        
        // If proxy returns 404, the function might not be deployed or accessible
        if (proxyResponse.status === 404) {
          throw new Error(`Function not found (404). The onemap.js function may not be deployed or accessible. Error: ${errorMessage}`);
        }
        
        throw new Error(`Proxy returned ${proxyResponse.status}: ${errorMessage}`);
      }
    } catch (proxyErr) {
      if (proxyErr.name === 'AbortError') {
        throw new Error('Request timeout - proxy function took too long to respond');
      }
      // If it's a 404, we can't use direct API (needs API key)
      if (proxyErr.message && (proxyErr.message.includes('404') || proxyErr.message.includes('Not Found'))) {
        throw new Error('Netlify function not accessible. Please verify: 1) Function is deployed, 2) Function file exists at netlify/functions/onemap.js, 3) Function includes getSilverZones handler. See docs/DATAGOVSG_SETUP.md');
      }
      // Re-throw other errors
      throw proxyErr;
    }
    
    // Fallback: Try direct data.gov.sg API
    // Collection ID 330 for Silver Zones
    try {
      const metadataController = new AbortController();
      const metadataTimeout = setTimeout(() => metadataController.abort(), timeout);
      
      // Note: API key is handled by Netlify proxy function
      const response = await fetch('https://api-production.data.gov.sg/v2/public/api/collections/330/metadata', {
        signal: metadataController.signal,
        headers: {
          'Accept': 'application/json',
        },
      });
      
      clearTimeout(metadataTimeout);
      
      if (response.status === 429) {
        throw new Error('Rate limit exceeded - please wait a moment and try again');
      }
      
      if (!response.ok) {
        throw new Error(`data.gov.sg API returned ${response.status}: ${response.statusText}`);
      }
      
      const metadata = await response.json();
      
      // Get the GeoJSON download URL
      let geojsonUrl = null;
      if (metadata.data && metadata.data.downloads) {
        const geojsonDownload = metadata.data.downloads.find(d => d.format === 'geojson');
        if (geojsonDownload) {
          geojsonUrl = geojsonDownload.url;
        }
      }
      
      if (!geojsonUrl) {
        throw new Error('GeoJSON download URL not found in metadata');
      }
      
      // Fetch GeoJSON data
      const geojsonController = new AbortController();
      const geojsonTimeout = setTimeout(() => geojsonController.abort(), timeout);
      
      const geojsonResponse = await fetch(geojsonUrl, {
        signal: geojsonController.signal
      });
      
      clearTimeout(geojsonTimeout);
      
      if (!geojsonResponse.ok) {
        throw new Error(`Failed to fetch GeoJSON: ${geojsonResponse.status} ${geojsonResponse.statusText}`);
      }
      
      const geojson = await geojsonResponse.json();
      
      // Validate GeoJSON
      if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
        if (geojson.features.length === 0) {
          throw new Error('No Silver Zones found in GeoJSON data');
        }
        displaySilverZones(geojson);
        return;
      } else {
        throw new Error('Invalid GeoJSON format received');
      }
    } catch (directErr) {
      if (directErr.name === 'AbortError') {
        throw new Error('Request timeout - data.gov.sg API took too long to respond');
      }
      throw directErr;
    }
    
  } catch (err) {
    // Try fallback before giving up
    try {
      await loadSilverZonesFallback();
    } catch (fallbackErr) {
      // If fallback also fails, throw the original error
      throw err;
    }
  }
}

// Load School Zones from data.gov.sg API (via Netlify proxy or direct)
async function loadSchoolZones() {
  const timeout = 15000; // 15 second timeout
  
  try {
    // First try Netlify proxy function (if available)
    try {
      const proxyController = new AbortController();
      const proxyTimeout = setTimeout(() => proxyController.abort(), timeout);
      
      const proxyResponse = await fetch('/.netlify/functions/onemap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getSchoolZones' }),
        signal: proxyController.signal
      });
      
      clearTimeout(proxyTimeout);
      
      if (proxyResponse.ok) {
        const data = await proxyResponse.json();
        
        // Check for error in response
        if (data.error) {
          throw new Error(`Proxy error: ${data.error}`);
        }
        
        // Validate GeoJSON structure
        if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
          if (data.features.length === 0) {
            throw new Error('No School Zones found in data source');
          }
          displaySchoolZones(data);
          return;
        } else {
          throw new Error('Invalid GeoJSON format received from proxy');
        }
      } else {
        // If proxy returns 404, the function might not be deployed
        if (proxyResponse.status === 404) {
          throw new Error('Netlify function not found (404). Please ensure the function is deployed and the action "getSchoolZones" is available.');
        }
        const errorData = await proxyResponse.json().catch(() => ({}));
        const errorMsg = errorData.error || proxyResponse.statusText || 'Unknown error';
        throw new Error(`Proxy returned ${proxyResponse.status}: ${errorMsg}`);
      }
    } catch (proxyErr) {
      if (proxyErr.name === 'AbortError') {
        throw new Error('Request timeout - proxy function took too long to respond');
      }
      // If it's a 404, we can't use direct API (needs API key)
      if (proxyErr.message && proxyErr.message.includes('404')) {
        throw new Error('Netlify function not deployed. Please deploy the updated onemap.js function with getSchoolZones handler.');
      }
      console.warn('Proxy function error, trying direct API:', proxyErr.message);
    }
    
    // Fallback: Try direct data.gov.sg API
    // Collection ID 329 for School Zones
    try {
      const metadataController = new AbortController();
      const metadataTimeout = setTimeout(() => metadataController.abort(), timeout);
      
      // Note: API key is handled by Netlify proxy function
      const response = await fetch('https://api-production.data.gov.sg/v2/public/api/collections/329/metadata', {
        signal: metadataController.signal,
        headers: {
          'Accept': 'application/json',
        },
      });
      
      clearTimeout(metadataTimeout);
      
      if (response.status === 429) {
        throw new Error('Rate limit exceeded - please wait a moment and try again');
      }
      
      if (!response.ok) {
        throw new Error(`data.gov.sg API returned ${response.status}: ${response.statusText}`);
      }
      
      const metadata = await response.json();
      
      // Get the GeoJSON download URL
      let geojsonUrl = null;
      if (metadata.data && metadata.data.downloads) {
        const geojsonDownload = metadata.data.downloads.find(d => d.format === 'geojson');
        if (geojsonDownload) {
          geojsonUrl = geojsonDownload.url;
        }
      }
      
      if (!geojsonUrl) {
        throw new Error('GeoJSON download URL not found in metadata');
      }
      
      // Fetch GeoJSON data
      const geojsonController = new AbortController();
      const geojsonTimeout = setTimeout(() => geojsonController.abort(), timeout);
      
      const geojsonResponse = await fetch(geojsonUrl, {
        signal: geojsonController.signal
      });
      
      clearTimeout(geojsonTimeout);
      
      if (!geojsonResponse.ok) {
        throw new Error(`Failed to fetch GeoJSON: ${geojsonResponse.status} ${geojsonResponse.statusText}`);
      }
      
      const geojson = await geojsonResponse.json();
      
      // Validate GeoJSON
      if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
        if (geojson.features.length === 0) {
          throw new Error('No School Zones found in GeoJSON data');
        }
        displaySchoolZones(geojson);
        return;
      } else {
        throw new Error('Invalid GeoJSON format received');
      }
    } catch (directErr) {
      if (directErr.name === 'AbortError') {
        throw new Error('Request timeout - data.gov.sg API took too long to respond');
      }
      throw directErr;
    }
    
  } catch (err) {
    // Try fallback before giving up
    try {
      await loadSchoolZonesFallback();
    } catch (fallbackErr) {
      // If fallback also fails, throw the original error
      throw err;
    }
  }
}

// Display Silver Zones on map
function displaySilverZones(geojson) {
  if (silverZonesLayer) {
    map.removeLayer(silverZonesLayer);
  }
  
  silverZonesLayer = L.geoJSON(geojson, {
    style: {
      color: '#ff6b6b',
      weight: 2,
      opacity: 0.8,
      fillColor: '#ff6b6b',
      fillOpacity: 0.2,
      dashArray: '5, 5'
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties || {};
      const name = props.name || props.NAME || props.DESCRIPTION || 'Silver Zone';
      
      layer.bindPopup(`
        <div class="zone-popup">
          <strong>Silver Zone</strong><br/>
          <span>${name}</span>
        </div>
      `);
    }
  }).addTo(map);
}

// Display School Zones on map
function displaySchoolZones(geojson) {
  if (schoolZonesLayer) {
    map.removeLayer(schoolZonesLayer);
  }
  
  schoolZonesLayer = L.geoJSON(geojson, {
    style: {
      color: '#4dabf7',
      weight: 2,
      opacity: 0.8,
      fillColor: '#4dabf7',
      fillOpacity: 0.2,
      dashArray: '5, 5'
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties || {};
      const name = props.name || props.NAME || props.SCHOOL_NAME || props.DESCRIPTION || 'School Zone';
      
      layer.bindPopup(`
        <div class="zone-popup">
          <strong>School Zone</strong><br/>
          <span>${name}</span>
        </div>
      `);
    }
  }).addTo(map);
}

// Fallback: Try alternative methods to load Silver Zones
async function loadSilverZonesFallback() {
  // Note: Direct data.gov.sg downloads require proper resource IDs
  // These are not publicly available without API keys or direct download links
  // Users should download GeoJSON files directly from data.gov.sg/collections/330
  
  throw new Error('Silver Zones data requires direct download from data.gov.sg. Please visit https://data.gov.sg/collections/330 to download the GeoJSON file.');
}

// Fallback: Try alternative methods to load School Zones
async function loadSchoolZonesFallback() {
  // Note: Direct data.gov.sg downloads require proper resource IDs
  // These are not publicly available without API keys or direct download links
  // Users should download GeoJSON files directly from data.gov.sg/collections/329
  
  throw new Error('School Zones data requires direct download from data.gov.sg. Please visit https://data.gov.sg/collections/329 to download the GeoJSON file.');
}

// Convert data.gov.sg records to GeoJSON format
function convertRecordsToGeoJSON(records, zoneType) {
  const features = records.map(record => {
    // Try to extract geometry from various possible fields
    let geometry = null;
    
    if (record.geometry) {
      geometry = typeof record.geometry === 'string' ? JSON.parse(record.geometry) : record.geometry;
    } else if (record.GEOMETRY) {
      geometry = typeof record.GEOMETRY === 'string' ? JSON.parse(record.GEOMETRY) : record.GEOMETRY;
    } else if (record.coordinates) {
      geometry = {
        type: 'Polygon',
        coordinates: record.coordinates
      };
    } else if (record.lat && record.lng) {
      geometry = {
        type: 'Point',
        coordinates: [record.lng, record.lat]
      };
    }
    
    if (!geometry) {
      return null;
    }
    
    return {
      type: 'Feature',
      properties: {
        ...record,
        zoneType: zoneType
      },
      geometry: geometry
    };
  }).filter(f => f !== null);
  
  return {
    type: 'FeatureCollection',
    features: features
  };
}

// Toggle Traffic data (placeholder - needs LTA DataMall API)
function toggleTraffic() {
  if (filterState.showTraffic) {
    setStatus('Traffic Data: Coming soon (LTA DataMall API integration needed)');
    // TODO: Load traffic data from LTA DataMall API
  } else {
    if (trafficLayer) {
      map.removeLayer(trafficLayer);
      trafficLayer = null;
    }
  }
}

// Toggle Road Closures (placeholder - needs LTA DataMall API)
function toggleRoadClosures() {
  if (filterState.showRoadClosures) {
    setStatus('Road Closures: Coming soon (LTA DataMall API integration needed)');
    // TODO: Load road closures from LTA DataMall API
  } else {
    if (closuresLayer) {
      map.removeLayer(closuresLayer);
      closuresLayer = null;
    }
  }
}

// Fetch from Overpass API with retry logic
async function fetchOverpass(query) {
  const body = 'data=' + encodeURIComponent(query);
  const timeout = 30000; // 30 second timeout for Overpass
  let lastErr = null;
  
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!resp.ok) {
          const errorText = await resp.text().catch(() => '');
          throw new Error(`Overpass API returned ${resp.status}: ${resp.statusText}${errorText ? ' - ' + errorText.substring(0, 100) : ''}`);
        }
        
        const data = await resp.json();
        
        // Check for Overpass API errors in response
        if (data.error) {
          throw new Error(`Overpass API error: ${data.error}`);
        }
        
        return data;
      } catch (err) {
        if (err.name === 'AbortError') {
          lastErr = new Error('Request timeout - Overpass API took too long to respond');
        } else if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
          lastErr = new Error('Network error - cannot reach Overpass API. Check your internet connection.');
          lastErr.networkError = true;
        } else {
          lastErr = err;
        }
        
        // Wait before retry (except on last attempt)
        if (attempt < 1) {
          await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    }
  }
  
  throw lastErr || new Error('All Overpass API endpoints failed');
}

// Update status badge
function setStatus(text, isError = false) {
  if (statusBadge) {
    statusBadge.textContent = text;
    if (isError) {
      statusBadge.style.background = 'rgba(240, 84, 84, 0.2)';
      statusBadge.style.borderColor = 'var(--danger)';
      statusBadge.style.color = 'var(--danger)';
    } else {
      statusBadge.style.background = 'rgba(255, 255, 255, 0.06)';
      statusBadge.style.borderColor = 'var(--panel-border)';
      statusBadge.style.color = 'var(--muted)';
    }
  }
}

// Show error notification
function showError(message, details = null) {
  console.error('AV Routing Map Error:', message, details);
  
  // Update status badge
  setStatus(`Error: ${message}`, true);
  
  // Show error notification
  if (errorNotification) {
    errorNotification.textContent = details ? `${message}: ${details}` : message;
    errorNotification.classList.remove('hidden');
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
      errorNotification.classList.add('hidden');
    }, 10000);
  }
  
  // Also log to console for debugging
  if (details) {
    console.error('Error details:', details);
  }
}

// Hide error notification
function hideError() {
  if (errorNotification) {
    errorNotification.classList.add('hidden');
  }
}

// Legend
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'legend');
  div.innerHTML = `
    <div class="legend-title">Road Types</div>
    <div class="legend-item"><span class="legend-swatch" style="background: #ff6b6b; width: 5px;"></span>Motorway</div>
    <div class="legend-item"><span class="legend-swatch" style="background: #ff8c42; width: 4px;"></span>Trunk</div>
    <div class="legend-item"><span class="legend-swatch" style="background: #ffd93d; width: 4px;"></span>Primary</div>
    <div class="legend-item"><span class="legend-swatch" style="background: #6bcf7f; width: 3px;"></span>Secondary</div>
    <div class="legend-item"><span class="legend-swatch" style="background: #4dabf7; width: 2px;"></span>Tertiary</div>
    <div class="legend-item"><span class="legend-swatch" style="background: #a0a0a0; width: 1.5px;"></span>Residential</div>
    <div class="legend-divider"></div>
    <div class="legend-title">Restricted Zones</div>
    <div class="legend-item"><span class="legend-swatch" style="background: #ff6b6b; border: 1px dashed rgba(255,255,255,0.5);"></span>Silver Zone</div>
    <div class="legend-item"><span class="legend-swatch" style="background: #4dabf7; border: 1px dashed rgba(255,255,255,0.5);"></span>School Zone</div>
  `;
  return div;
};
legend.addTo(map);

// Test function availability on load
async function testFunctionAvailability() {
  try {
    const testResponse = await fetch('/.netlify/functions/onemap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' })
    });
    
    if (testResponse.ok) {
      const testData = await testResponse.json();
      console.log('Function test result:', testData);
      if (!testData.hasDataGovApiKey) {
        console.warn('⚠️ DATAGOVSG_API_KEY not configured in Netlify environment variables');
      }
    } else {
      console.warn('Function test failed:', testResponse.status, testResponse.statusText);
    }
  } catch (err) {
    console.warn('Could not test function availability:', err.message);
  }
}

// Initialize
initializeListeners();
testFunctionAvailability(); // Test function on page load
setStatus('Ready - Click "Load Singapore" to start');
