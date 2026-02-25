// Initialize camera feed

const OPENAI_PROXY_URL = (() => {
  const value = window.OPENAI_PROXY_URL;
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return '/.netlify/functions/openai';
})();

// Google Sheets Sync Configuration (via Netlify serverless function)
const SHEETS_SYNC_ENDPOINT = '/.netlify/functions/sheets-sync';

// Country to Google Sheet ID mapping
// Singapore uses the default sheet ID from environment variable (null = use default)
// Other countries have their own sheet IDs
const COUNTRY_SHEET_IDS = {
  'Singapore': null, // null means use default from environment variable
  'Thailand': '1eyXm4DUNxmvK5ngutQJKq1QsKdSxiCYGSwGuZ-zdwjw',
  'Malaysia': null, // Placeholder - no sheet ID yet
  'Indonesia': null, // Placeholder - no sheet ID yet
  'Vietnam': null, // Placeholder - no sheet ID yet
  'Philippines': null, // Placeholder - no sheet ID yet
  'Cambodia': null, // Placeholder - no sheet ID yet
  'Myanmar': null // Placeholder - no sheet ID yet
};

// Email addresses storage key
const EMAIL_STORAGE_KEY = 'bnsvision_emails';

// OneMap API Configuration (via Netlify serverless function)
const ONEMAP_PROXY_ENDPOINT = '/.netlify/functions/onemap';

// OneMap Coordinates Cache (localStorage)
const ONEMAP_COORDS_CACHE_KEY = 'onemapCoordsCache';
const ONEMAP_CACHE_VERSION = 1; // Increment to invalidate cache

// Global variables (declared early to avoid initialization errors)
let currentSearchFilter = null;
let progressDashboardMap = null;
let liveLocationWatchId = null;
let liveLocationMarker = null;
let isLiveLocationEnabled = false;
let hasZoomedToUserLocation = false;
let dashboardLocationMarkers = {};
let selectedDashboardLocation = null;
let gridPolygons = {};

// Load coordinates cache from localStorage
function loadCoordsCache() {
  try {
    const cached = localStorage.getItem(ONEMAP_COORDS_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      // Check cache version
      if (data.version === ONEMAP_CACHE_VERSION) {
        return data.coords || {};
      }
    }
  } catch (e) {
    console.warn('Failed to load coords cache:', e);
  }
  return {};
}

// Save coordinates cache to localStorage
function saveCoordsCache(cache) {
  try {
    localStorage.setItem(ONEMAP_COORDS_CACHE_KEY, JSON.stringify({
      version: ONEMAP_CACHE_VERSION,
      coords: cache,
      lastUpdated: new Date().toISOString()
    }));
  } catch (e) {
    console.warn('Failed to save coords cache:', e);
  }
}

// Get cache key from location name (normalized)
function getCoordsKey(locationName) {
  return locationName.toLowerCase().trim().replace(/\s+/g, ' ');
}

// In-memory cache (populated from localStorage on first use)
let coordsCache = null;

// Clear coordinates cache (for debugging/testing)
function clearCoordsCache() {
  coordsCache = {};
  localStorage.removeItem(ONEMAP_COORDS_CACHE_KEY);
  console.log('📍 Coordinates cache cleared');
}

// Get cache stats (for debugging)
function getCoordsCacheStats() {
  if (coordsCache === null) {
    coordsCache = loadCoordsCache();
  }
  const entries = Object.entries(coordsCache);
  const validEntries = entries.filter(([_, v]) => v !== null);
  const nullEntries = entries.filter(([_, v]) => v === null);
  
  return {
    total: entries.length,
    valid: validEntries.length,
    failed: nullEntries.length,
    locations: validEntries.map(([k, _]) => k)
  };
}

// Search OneMap for an address/street (via proxy) - fetches a single page
async function searchOneMapPage(searchQuery, pageNum = 1) {
  try {
    const response = await fetch(ONEMAP_PROXY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'search',
        searchVal: searchQuery,
        returnGeom: 'Y',
        getAddrDetails: 'Y',
        pageNum: String(pageNum)
      })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('OneMap search error:', error);
    return { found: 0, results: [], totalNumPages: 0 };
  }
}

// Search OneMap for an address/street - fetches ALL pages
async function searchOneMap(searchQuery, fetchAllPages = false) {
  try {
    // Fetch first page
    const firstPage = await searchOneMapPage(searchQuery, 1);
    
    if (!firstPage || firstPage.found === 0) {
    console.log(`🗺️ OneMap: No results for "${searchQuery}"`);
    return [];
    }
    
    let allResults = firstPage.results || [];
    const totalPages = firstPage.totalNumPages || 1;
    
    console.log(`🗺️ OneMap found ${firstPage.found} results for "${searchQuery}" (${totalPages} pages)`);
    
    // If fetchAllPages is true and there are more pages, fetch them
    if (fetchAllPages && totalPages > 1) {
      console.log(`📄 Fetching remaining ${totalPages - 1} pages...`);
      
      // Fetch remaining pages in parallel (max 5 at a time to avoid rate limiting)
      for (let page = 2; page <= totalPages; page++) {
        const pageData = await searchOneMapPage(searchQuery, page);
        if (pageData && pageData.results) {
          allResults = allResults.concat(pageData.results);
        }
        // Small delay to avoid rate limiting
        if (page % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`📄 Fetched all ${totalPages} pages, total ${allResults.length} results`);
    }
    
    return allResults;
  } catch (error) {
    console.error('OneMap search error:', error);
    return [];
  }
}

// Get coordinates for a location name via OneMap (with caching)
async function getLocationCoordinates(locationName) {
  if (!locationName) return null;
  
  // Initialize cache from localStorage if not loaded
  if (coordsCache === null) {
    coordsCache = loadCoordsCache();
    const cacheSize = Object.keys(coordsCache).length;
    if (cacheSize > 0) {
      console.log(`📍 Loaded ${cacheSize} cached coordinates from localStorage`);
    }
  }
  
  // Check cache first
  const cacheKey = getCoordsKey(locationName);
  if (coordsCache[cacheKey]) {
    console.log(`📍 Cache HIT: "${locationName}"`);
    return coordsCache[cacheKey];
  }
  
  // Also check without "Singapore" suffix
  const keyWithoutSG = getCoordsKey(locationName.replace(/\s*singapore\s*/gi, '').trim());
  if (keyWithoutSG !== cacheKey && coordsCache[keyWithoutSG]) {
    console.log(`📍 Cache HIT (normalized): "${locationName}"`);
    return coordsCache[keyWithoutSG];
  }
  
  console.log(`📍 Cache MISS: "${locationName}" - fetching from OneMap...`);
  
  try {
    // Search OneMap for the location
    const results = await searchOneMap(locationName);
    
    if (results && results.length > 0) {
      const first = results[0];
      const coords = {
        lat: parseFloat(first.LATITUDE),
        lng: parseFloat(first.LONGITUDE),
        address: first.ADDRESS || locationName
      };
      
      // Save to cache
      coordsCache[cacheKey] = coords;
      saveCoordsCache(coordsCache);
      
      return coords;
    }
    
    // Try alternative search with "Singapore" appended
    if (!locationName.toLowerCase().includes('singapore')) {
      const altResults = await searchOneMap(locationName + ' Singapore');
      if (altResults && altResults.length > 0) {
        const first = altResults[0];
        const coords = {
          lat: parseFloat(first.LATITUDE),
          lng: parseFloat(first.LONGITUDE),
          address: first.ADDRESS || locationName
        };
        
        // Save to cache (use original key without Singapore)
        coordsCache[keyWithoutSG] = coords;
        saveCoordsCache(coordsCache);
        
        return coords;
      }
    }
    
    // Cache null result to avoid repeated failed lookups
    coordsCache[cacheKey] = null;
    saveCoordsCache(coordsCache);
    
    return null;
  } catch (error) {
    console.warn(`Could not get coordinates for "${locationName}":`, error);
    return null;
  }
}

// Get building footprints from OneMap Themes API (via proxy)
async function getOneMapBuildings(bbox) {
  try {
    const response = await fetch(ONEMAP_PROXY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'getBuildings',
        extents: bbox
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      console.warn('OneMap buildings error:', data.error);
      return [];
    }
    
    return data.SrchResults || [];
  } catch (error) {
    console.error('OneMap buildings error:', error);
    return [];
  }
}

// Reverse geocode to get address from coordinates (via proxy)
async function reverseGeocodeOneMap(lat, lng) {
  try {
    const response = await fetch(ONEMAP_PROXY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'reverseGeocode',
        lat: lat,
        lng: lng,
        buffer: 50
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      console.warn('OneMap reverse geocode error:', data.error);
      return null;
    }
    
    if (data.GeocodeInfo && data.GeocodeInfo.length > 0) {
      return data.GeocodeInfo[0];
    }
    return null;
  } catch (error) {
    console.error('OneMap reverse geocode error:', error);
    return null;
  }
}

// Check OneMap token status (for debugging)
async function checkOneMapStatus() {
  try {
    const response = await fetch(ONEMAP_PROXY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'checkToken' })
    });
    
    const data = await response.json();
    console.log('OneMap status:', data);
    return data;
  } catch (error) {
    console.error('OneMap status check error:', error);
    return { success: false, error: error.message };
  }
}

// Legacy global sync check (deprecated - now per-project)
// Kept for backwards compatibility
function isSheetsSyncEnabled() {
  return false; // Always false - use project sync instead
}

function setSheetsSyncEnabled(enabled) {
  // No-op - sync is now per-project
}

// Build sync record with project metadata
function buildSyncRecord(scan, project) {
  // Debug: Check what image data is available
  const imageData = scan.photoData || scan.photoDataUrl || '';
  console.log('🔍 buildSyncRecord - Image data check:', {
    hasPhotoData: !!scan.photoData,
    hasPhotoDataUrl: !!scan.photoDataUrl,
    photoDataLength: scan.photoData ? scan.photoData.length : 0,
    photoDataUrlLength: scan.photoDataUrl ? scan.photoDataUrl.length : 0,
    finalImageDataLength: imageData.length,
    scanKeys: Object.keys(scan)
  });
  
  // Calculate image size if available
  let imageSize = 0;
  if (scan.photoId) {
    // Estimate size from thumbnail if full-res not available
    imageSize = scan.photoData ? scan.photoData.length : 0;
  } else if (scan.photoData) {
    imageSize = scan.photoData.length;
  }
  
  // Parse opening hours for sheets
  const openingHoursDays = parseOpeningHoursForSheets(scan.openingHours || '');
  
  return {
    entryId: scan.entryId || '',
    projectId: project?.id || scan.projectId || '',
    projectName: project?.name || scan.projectName || '',
    location: project?.location || scan.projectLocation || '',
    date: project?.date || scan.projectDate || '',
    email: project?.email || scan.projectEmail || '',
    environment: scan.environment || project?.environment || 'Indoor',
    category: scan.category || '',
    storeName: scan.storeName || '',
    poiName: scan.storeName || '',
    lat: scan.lat || '',
    lng: scan.lng || '',
    houseNo: scan.houseNo || '',
    street: scan.street || '',
    unit: scan.unit || scan.unitNumber || '',
    floor: scan.floor || '',
    building: scan.building || '',
    postcode: scan.postcode || '',
    phoneNumber: scan.phoneNumber || '',
    website: scan.website || '',
    remarks: scan.remarks || '',
    openingHours: scan.openingHours || '', // Full formatted string
    openingHoursMon: openingHoursDays.Mon || '',
    openingHoursTue: openingHoursDays.Tue || '',
    openingHoursWed: openingHoursDays.Wed || '',
    openingHoursThu: openingHoursDays.Thu || '',
    openingHoursFri: openingHoursDays.Fri || '',
    openingHoursSat: openingHoursDays.Sat || '',
    openingHoursSun: openingHoursDays.Sun || '',
    photoFilename: scan.photoFilename || '', // Image filename for reference
    imageSize: imageSize, // Image size in bytes
    imageData: imageData, // Include image data for Drive upload (photoData or photoDataUrl)
    // Note: Images are stored locally in IndexedDB, but also uploaded to Drive if imageData is provided
  };
}

// Sync a single scan record to Google Sheets
// tabNameOverride: optional - use a specific tab instead of the project's tab
async function syncToGoogleSheets(scanData, tabNameOverride = null) {
  const project = getActiveProject();
  
  // Debug: Log sync check
  const projectSyncEnabled = isProjectSyncEnabled();
  const globalSyncEnabled = isSheetsSyncEnabled();
  console.log('🔍 Sync check:', {
    hasProject: !!project,
    projectName: project?.name || 'None',
    projectSyncEnabled,
    globalSyncEnabled,
    tabNameOverride: tabNameOverride || 'None',
    projectSyncEnabledValue: project?.syncEnabled,
    projectSheetId: project?.sheetId || 'default'
  });
  
  // Check if sync is enabled (either global or project-specific)
  // Skip check if tabNameOverride is provided (e.g., for condo scanning)
  if (!tabNameOverride && !projectSyncEnabled && !globalSyncEnabled) {
    const projectName = project?.name || 'Unknown';
    console.warn(`⚠️ Sync disabled for project "${projectName}". Enable sync in project settings to sync scans automatically.`);
    return { success: false, reason: 'sync_disabled' };
  }

  try {
    const tabName = tabNameOverride || project?.sheetTab || project?.location || 'Sheet1';
    const syncRecord = buildSyncRecord(scanData, project);
    const payload = {
      tabName,
      ...syncRecord
    };
    
    // Add country-specific sheetId if project has one
    if (project?.sheetId) {
      payload.sheetId = project.sheetId;
      console.log(`📋 Using country-specific sheet: ${project.sheetId.substring(0, 20)}...`);
    }

    // Debug logging
    console.log('📤 Syncing record:', {
      entryId: syncRecord.entryId,
      storeName: syncRecord.storeName,
      hasImageData: !!syncRecord.imageData,
      imageDataLength: syncRecord.imageData ? syncRecord.imageData.length : 0,
      imageDataPreview: syncRecord.imageData ? syncRecord.imageData.substring(0, 50) + '...' : 'none',
      imageDataStartsWith: syncRecord.imageData ? syncRecord.imageData.substring(0, 20) : 'none',
      payloadKeys: Object.keys(payload),
      payloadHasImageData: !!payload.imageData,
      sheetId: payload.sheetId || 'default'
    });

    const response = await fetch(SHEETS_SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    console.log('📥 Sync response status:', response.status);

    const result = await response.json();
    
    console.log('📥 Full sync response:', {
      success: result.success,
      message: result.message,
      details: result.details,
      imagesUploaded: result.details?.imagesUploaded || 0,
      imageLinks: result.details?.imageLinks || {},
      errors: result.details?.errors || [],
      inserted: result.details?.inserted || 0,
      updated: result.details?.updated || 0
    });
    
    // Log any errors from the sync
    if (result.details?.errors && result.details.errors.length > 0) {
      console.error('❌ Sync errors:', result.details.errors);
      result.details.errors.forEach(err => {
        console.error(`  - Entry ${err.entryId}: ${err.error}`);
      });
    }
    
    if (result.success) {
      const inserted = result.details?.inserted || 0;
      const updated = result.details?.updated || 0;
      const totalProcessed = inserted + updated;
      
      if (totalProcessed > 0) {
        console.log(`✅ Google Sheets sync successful: ${inserted} inserted, ${updated} updated`);
      } else if (result.details?.errors && result.details.errors.length > 0) {
        console.error('❌ Google Sheets sync failed: All records had errors');
        return { 
          success: false, 
          error: `Sync failed: ${result.details.errors.map(e => e.error).join('; ')}`,
          details: result.details || {}
        };
      } else {
        console.warn('⚠️ Google Sheets sync returned success but no records were inserted or updated');
      }
      
      console.log('📊 Sync details:', result.details);
      if (result.details?.imagesUploaded > 0) {
        console.log(`📸 Successfully uploaded ${result.details.imagesUploaded} image(s) to Drive`);
        console.log('🔗 Image links:', result.details.imageLinks);
      } else {
        console.warn('⚠️ No images were uploaded. Check logs above for reasons.');
      }
      // Return details including image upload count
      return { 
        success: true, 
        message: result.message,
        details: result.details || {}
      };
    } else {
      console.error('❌ Google Sheets sync failed:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ Google Sheets sync error:', error);
    return { success: false, error: error.message };
  }
}

// Fetch data from Google Sheets (read from Sheets)
async function fetchFromGoogleSheets(options = {}) {
  const project = getActiveProject();
  
  // Check if sync is enabled (either global or project-specific)
  if (!isProjectSyncEnabled() && !isSheetsSyncEnabled()) {
    return { success: false, reason: 'sync_disabled' };
  }

  try {
    const tabName = options.tabName || project?.sheetTab || project?.location || 'Sheet1';
    const entryId = options.entryId; // Optional: filter by specific entryId
    const includeDeleted = options.includeDeleted || false; // Default: exclude deleted entries
    const sheetId = options.sheetId || project?.sheetId || null; // Country-specific sheet ID
    
    // Build query parameters
    const params = new URLSearchParams({
      tabName: tabName
    });
    
    if (entryId) {
      params.append('entryId', entryId);
    }
    
    if (includeDeleted) {
      params.append('includeDeleted', 'true');
    }
    
    // Add country-specific sheetId if project has one
    if (sheetId) {
      params.append('sheetId', sheetId);
      console.log(`📋 Using country-specific sheet: ${sheetId.substring(0, 20)}...`);
    }

    const url = `${SHEETS_SYNC_ENDPOINT}?${params.toString()}`;
    
    console.log('📥 Fetching data from Google Sheets:', { tabName, entryId, includeDeleted, sheetId: sheetId || 'default' });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    console.log('📥 Fetch response status:', response.status);

    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Fetched ${result.count} record(s) from Google Sheets`);
      return { 
        success: true, 
        records: result.records || [],
        count: result.count || 0,
        tabName: result.tabName
      };
    } else {
      console.error('❌ Failed to fetch from Google Sheets:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ Error fetching from Google Sheets:', error);
    return { success: false, error: error.message };
  }
}

// Sync multiple records to Google Sheets (for batch operations)
async function syncBatchToGoogleSheets(records) {
  const project = getActiveProject();
  
  // Check if sync is enabled
  if (!isProjectSyncEnabled() && !isSheetsSyncEnabled()) {
    return { success: false, reason: 'sync_disabled' };
  }

  try {
    const tabName = project?.sheetTab || project?.location || 'Sheet1';
    const payload = {
      tabName,
      records: records.map(scan => buildSyncRecord(scan, project))
    };
    
    // Add country-specific sheetId if project has one
    if (project?.sheetId) {
      payload.sheetId = project.sheetId;
      console.log(`📋 Using country-specific sheet: ${project.sheetId.substring(0, 20)}...`);
    }

    const response = await fetch(SHEETS_SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Google Sheets batch sync successful: ${records.length} records`);
      return { success: true, count: records.length, message: result.message };
    } else {
      console.error('❌ Google Sheets batch sync failed:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ Google Sheets batch sync error:', error);
    return { success: false, error: error.message };
  }
}

// Create a new tab in Google Sheets
async function createSheetTab(tabName, sheetId = null) {
  try {
    console.log(`📋 Creating Google Sheets tab: ${tabName}${sheetId ? ` (sheet: ${sheetId.substring(0, 20)}...)` : ' (default sheet)'}`);
    
    const payload = {
      createTab: true,
      tabName: tabName
    };
    
    // Add sheetId if provided (for country-specific sheets)
    if (sheetId) {
      payload.sheetId = sheetId;
    }
    
    const response = await fetch(SHEETS_SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    if (result.success) {
      if (result.alreadyExists) {
        console.log(`✅ Tab already exists: ${tabName} (will sync to existing tab)`);
      } else {
        console.log(`✅ Created new Google Sheets tab: ${tabName}`);
      }
      return { 
        success: true, 
        tabName: result.tabName,
        created: result.created,
        alreadyExists: result.alreadyExists
      };
    } else {
      console.error('❌ Failed to create tab:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ Error creating Google Sheets tab:', error);
    return { success: false, error: error.message };
  }
}

// ---------------------------
// Project Management
// ---------------------------
const PROJECTS_KEY = 'bnsvision_projects';
const ACTIVE_PROJECT_KEY = 'bnsvision_activeProjectId';

// Available locations for projects (will sync to corresponding sheet tabs)
// Each location includes address details for auto-fill
const PROJECT_LOCATIONS = [
  {
    name: 'Mall A',
    houseNo: '',
    street: '',
    building: '',
    postcode: ''
  },
  {
    name: 'Wisma Atria',
    houseNo: '435',
    street: 'Orchard Road',
    building: 'Wisma Atria',
    postcode: '238877'
  },
  {
    name: 'ION Orchard',
    houseNo: '2',
    street: 'Orchard Turn',
    building: 'ION Orchard',
    postcode: '238801'
  },
  {
    name: 'Tang Plaza',
    houseNo: '320',
    street: 'Orchard Road',
    building: 'Tang Plaza',
    postcode: '238865'
  },
  {
    name: 'Lucky Plaza',
    houseNo: '304',
    street: 'Orchard Road',
    building: 'Lucky Plaza',
    postcode: '238863'
  },
  {
    name: 'Orchard Parksuites',
    houseNo: '11',
    street: 'Orchard Turn',
    building: 'Orchard Parksuites',
    postcode: '238800'
  },
  {
    name: 'Ngee Ann City',
    houseNo: '391',
    street: 'Orchard Road',
    building: 'Ngee Ann City',
    postcode: '238872'
  },
  {
    name: 'The Centrepoint',
    houseNo: '176',
    street: 'Orchard Road',
    building: 'The Centrepoint',
    postcode: '238843'
  },
  {
    name: 'The Paragon',
    houseNo: '290',
    street: 'Orchard Road',
    building: 'The Paragon',
    postcode: '238859'
  },
  {
    name: 'Tong Building',
    houseNo: '302',
    street: 'Orchard Road',
    building: 'Tong Building',
    postcode: '238862'
  },
  {
    name: 'Scotts Square',
    houseNo: '6',
    street: 'Scotts Road',
    building: 'Scotts Square',
    postcode: '228209'
  },
  {
    name: 'Grand Hyatt Singapore',
    houseNo: '10',
    street: 'Scotts Road',
    building: 'Grand Hyatt Singapore',
    postcode: '228211'
  },
  {
    name: 'Far East Plaza',
    houseNo: '14',
    street: 'Scotts Road',
    building: 'Far East Plaza',
    postcode: '228213'
  },
  {
    name: 'Midpoint Orchard',
    houseNo: '220',
    street: 'Orchard Road',
    building: 'Midpoint Orchard',
    postcode: '238852'
  },
  {
    name: 'Holiday Inn Singapore Orchard City Centre',
    houseNo: '11',
    street: 'Cavenagh Road',
    building: 'Holiday Inn Singapore Orchard City Centre',
    postcode: '229616'
  },
  {
    name: 'Holiday Inn Express Orchard',
    houseNo: '20',
    street: 'Bideford Road',
    building: 'Holiday Inn Express Singapore Orchard Road',
    postcode: '229921'
  },
  {
    name: 'Ascott Orchard Singapore',
    houseNo: '11',
    street: 'Cairnhill Road',
    building: 'Ascott Orchard Singapore',
    postcode: '229724'
  },
  {
    name: 'Concorde Hotel + Shopping Ctr',
    houseNo: '100',
    street: 'Orchard Road',
    building: 'Concorde Hotel and Shopping Mall',
    postcode: '238840'
  },
  {
    name: 'Pullman Singapore Orchard',
    houseNo: '270',
    street: 'Orchard Road',
    building: 'Pullman Singapore Orchard',
    postcode: '238857'
  },
  {
    name: 'Mt Elizabeth Hospital',
    houseNo: '3',
    street: 'Mount Elizabeth',
    building: 'Mount Elizabeth Hospital/Medical Centre',
    postcode: '228510'
  },
  {
    name: 'Hotel Chancellor @ Orchard',
    houseNo: '28',
    street: 'Cavenagh Road',
    building: 'Hotel Chancellor @ Orchard',
    postcode: '229635'
  },
  {
    name: 'Hotel Grand Central',
    houseNo: '22',
    street: 'Cavenagh Road',
    building: 'Hotel Grand Central',
    postcode: '229617'
  },
  {
    name: 'United House',
    houseNo: '20',
    street: 'Kramat Lane',
    building: 'United House',
    postcode: '228773'
  },
  {
    name: 'Hotel Supreme Singapore',
    houseNo: '15',
    street: 'Kramat Road',
    building: 'Hotel Supreme Singapore',
    postcode: '228750'
  },
  {
    name: 'Design Orchard',
    houseNo: '250',
    street: 'Orchard Road',
    building: 'Design Orchard',
    postcode: '238905'
  },
  {
    name: 'The Heeran',
    houseNo: '260',
    street: 'Orchard Road',
    building: 'The Heeren',
    postcode: '238855'
  },
  {
    name: 'COMO Metropolitan Singapore',
    houseNo: '28',
    street: 'Bideford Road',
    building: 'COMO Metropolitan Singapore',
    postcode: '229924'
  },
  {
    name: 'Oakwood Studios Singapore',
    houseNo: '18',
    street: 'Mount Elizabeth',
    building: 'Oakwood Studios Singapore',
    postcode: '228514'
  },
  {
    name: 'Cuppage Plaza',
    houseNo: '5',
    street: 'Koek Road',
    building: 'Cuppage Plaza',
    postcode: '228796'
  },
  {
    name: 'Orchard Plaza',
    houseNo: '150',
    street: 'Orchard Road',
    building: 'Orchard Plaza',
    postcode: '238841'
  },
  {
    name: '268 Orchard',
    houseNo: '268',
    street: 'Orchard Road',
    building: '',
    postcode: '238856'
  },
  {
    name: 'Parkway Parade',
    houseNo: '80',
    street: 'Marine Parade Road',
    building: 'Parkway Parade',
    postcode: '449269'
  },
  {
    name: 'Parkway Centre',
    houseNo: '1',
    street: 'Marine Parade Central',
    building: 'Parkway Centre',
    postcode: '449408'
  },
  {
    name: '112 Katong / i12',
    houseNo: '112',
    street: 'East Coast Road',
    building: '112 Katong',
    postcode: '428802'
  },
  {
    name: 'Holiday Inn Express Katong (Located in Katong Square)',
    houseNo: '88',
    street: 'East Coast Road',
    building: 'Holiday Inn Express Singapore Katong',
    postcode: '423371'
  },
  {
    name: 'Katong Square',
    houseNo: '88',
    street: 'East Coast Road',
    building: 'Katong Square',
    postcode: '423371'
  },
  {
    name: 'The Flow Mall',
    houseNo: '66',
    street: 'East Coast Road',
    building: 'The Flow Mall',
    postcode: '428778'
  },
  {
    name: 'Roxy Square',
    houseNo: '50',
    street: 'East Coast Road',
    building: 'Roxy Square',
    postcode: '428769'
  },
  {
    name: 'Grand Mercure Roxy Hotel',
    houseNo: '50',
    street: 'East Coast Road',
    building: 'Grand Mercure Roxy Hotel',
    postcode: '428769'
  },
  {
    name: 'Village Hotel V Katong (Located in Katong V)',
    houseNo: '30',
    street: 'East Coast Road',
    building: 'Village Hotel Katong',
    postcode: '428751'
  },
  {
    name: 'Katong Shopping Centre',
    houseNo: '865',
    street: 'Mountbatten Road',
    building: 'Katong Shopping Centre',
    postcode: '437844'
  },
  {
    name: 'Katong Point',
    houseNo: '451',
    street: 'Joo Chiat Road',
    building: 'Katong Point',
    postcode: '427664'
  },
  {
    name: 'Joo Chiat Community Club',
    houseNo: '405',
    street: 'Joo Chiat Road',
    building: 'Joo Chiat Community Club',
    postcode: '427633'
  },
  {
    name: 'Eastgate',
    houseNo: '46',
    street: 'East Coast Road',
    building: 'Eastgate',
    postcode: '428766'
  },
  {
    name: 'Katong V',
    houseNo: '30',
    street: 'East Coast Road',
    building: 'Katong V',
    postcode: '428751'
  },
  {
    name: 'Hotel Indigo Singapore Katong (Located in Katong Square)',
    houseNo: '86',
    street: 'East Coast Road',
    building: 'Hotel Indigo Singapore Katong',
    postcode: '428788'
  },
  {
    name: 'The Odeon Katong',
    houseNo: '11',
    street: 'East Coast Road',
    building: 'The Odeon Katong',
    postcode: '428722'
  },
  {
    name: 'Marine Parade Central Market and Food Centre',
    houseNo: '84',
    street: 'Marine Parade Central',
    building: 'Marine Parade Central Market and Food Centre',
    postcode: '440084'
  },
  {
    name: 'Santa Grand Hotel East Coast',
    houseNo: '171',
    street: 'East Coast Road',
    building: 'Santa Grand Hotel East Coast',
    postcode: '428877'
  },
  {
    name: 'Marine Parade Polyclinic',
    houseNo: '80',
    street: 'Marine Parade Central',
    building: 'SingHealth Polyclinics (Marine Parade Polyclinic)',
    postcode: '440080'
  }
];

// Helper function to get location by name
function getLocationByName(locationName) {
  return PROJECT_LOCATIONS.find(loc => loc.name === locationName) || null;
}

function loadProjects() {
  try {
    const projectsJson = localStorage.getItem(PROJECTS_KEY);
    
    // CRITICAL FIX: Check if projects were cleared (Android issue)
    if (!projectsJson || projectsJson === '[]' || projectsJson === 'null' || projectsJson === 'undefined') {
      // Try to restore from backup
      const backup = sessionStorage.getItem('projects_backup');
      if (backup) {
        try {
          const restoredProjects = JSON.parse(backup);
          if (Array.isArray(restoredProjects) && restoredProjects.length > 0) {
            console.warn('⚠️ Projects were cleared! Restoring from backup...');
            localStorage.setItem(PROJECTS_KEY, backup);
            return restoredProjects;
          }
        } catch (e) {
          console.error('Failed to restore projects from backup:', e);
        }
      }
    }
    
    return JSON.parse(projectsJson || '[]');
  } catch (e) {
    console.error('Error loading projects:', e);
    // Try backup
    const backup = sessionStorage.getItem('projects_backup');
    if (backup) {
      try {
        return JSON.parse(backup);
      } catch (e2) {
        console.error('Failed to restore from backup:', e2);
      }
    }
    return [];
  }
}

function saveProjects(projects) {
  try {
    // CRITICAL FIX: Always backup before saving
    const currentProjects = loadProjects();
    if (currentProjects.length > 0) {
      sessionStorage.setItem('projects_backup', JSON.stringify(currentProjects));
    }
    
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    
    // CRITICAL FIX: Also update backup after successful save
    sessionStorage.setItem('projects_backup', JSON.stringify(projects));
  } catch (error) {
    console.error('Error saving projects:', error);
    // Try to restore from backup if save fails
    const backup = sessionStorage.getItem('projects_backup');
    if (backup) {
      console.warn('⚠️ Save failed, but backup exists');
    }
    throw error;
  }
}

function getProject(id) {
  return loadProjects().find(p => p.id === id) || null;
}

function createProject(projectData) {
  const projects = loadProjects();
  
  // Generate project name: Tab/Location Name, Floor, Date, Country
  let projectName = projectData.name;
  if (!projectName) {
    const location = projectData.location || 'Untitled';
    const floor = projectData.floor || projectData.defaultAddress?.floor || '';
    const date = projectData.date || getSingaporeDate();
    const country = projectData.country || 'Singapore';
    projectName = `${location}${floor ? `, ${floor}` : ''}, ${date}, ${country}`;
  }
  
  const newProject = {
    id: 'proj-' + Date.now(),
    type: projectData.type || 'Onground Benchmarking',
    name: projectName,
    date: projectData.date || getSingaporeDate(),
    email: projectData.email || '',
    location: projectData.location || '',
    environment: projectData.environment || 'Indoor', // Indoor or Outdoor
    syncEnabled: projectData.syncEnabled !== false,
    sheetTab: projectData.sheetTab || projectData.location || 'Sheet1', // Tab name = location or custom tab name
    sheetId: projectData.sheetId || null, // Country-specific Google Sheet ID (null = use default)
    country: projectData.country || 'Singapore', // Country name for multi-country support (default to Singapore)
    // Custom tab properties (for Residential/Commercial projects)
    isCustomTab: projectData.isCustomTab || false,
    projectCategory: projectData.projectCategory || null, // 'Residential' or 'Commercial'
    defaultAddress: {
      houseNo: projectData.houseNo || '',
      street: projectData.street || '',
      floor: projectData.floor || '',
      building: projectData.building || '',
      postcode: projectData.postcode || ''
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  projects.unshift(newProject);
  saveProjects(projects);
  return newProject;
}

function updateProject(id, updates) {
  const projects = loadProjects();
  const index = projects.findIndex(p => p.id === id);
  if (index !== -1) {
    projects[index] = { ...projects[index], ...updates, updatedAt: new Date().toISOString() };
    saveProjects(projects);
    return projects[index];
  }
  return null;
}

function deleteProject(id) {
  const projects = loadProjects().filter(p => p.id !== id);
  saveProjects(projects);
  if (getActiveProjectId() === id) {
    setActiveProject(null);
  }
}

function setActiveProject(id) {
  localStorage.setItem(ACTIVE_PROJECT_KEY, id || '');
}

function getActiveProjectId() {
  return localStorage.getItem(ACTIVE_PROJECT_KEY) || null;
}

function getActiveProject() {
  const id = getActiveProjectId();
  return id ? getProject(id) : null;
}

function isProjectSyncEnabled() {
  const project = getActiveProject();
  // Default to enabled (true) if not explicitly set to false
  // This ensures backward compatibility and that sync works by default
  if (!project) return false;
  return project.syncEnabled !== false; // true if undefined, null, or true
}

function hasOpenAIProxy() {
  return typeof OPENAI_PROXY_URL === 'string' && OPENAI_PROXY_URL.length > 0;
}

async function callOpenAIProxy(endpoint, payload) {
  if (!hasOpenAIProxy()) {
    throw new Error('OpenAI proxy URL is not configured.');
  }

  const body = { endpoint, payload };
  const res = await fetch(OPENAI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errMessage = `Proxy request failed with status ${res.status}`;
    try {
      const errJson = await res.json();
      errMessage = errJson?.error ?? errMessage;
    } catch (_) {}
    throw new Error(errMessage);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

// Splash Screen Logic
const splashScreen = document.getElementById('splashScreen');
const appShell = document.getElementById('appShell');

function hideSplashScreen() {
  if (splashScreen) {
    splashScreen.classList.remove('active');
    setTimeout(() => {
      splashScreen.style.display = 'none';
    }, 500); // Wait for fade-out transition
  }
}

function showHomeScreen() {
  const homeScreen = document.getElementById('homeScreen');
  if (homeScreen) {
    homeScreen.classList.add('active');
  }
}

// Show splash for 2 seconds, then transition to home
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    hideSplashScreen();
    showHomeScreen();
  }, 2000); // 2 second splash duration
  
  // Initialize screens after DOM is loaded
  initializeScreens();
});

let screens = {};
let visionMenuBackBtn, batchBackBtn, versionHistoryBackBtn, guideBackBtn;
let guideTile;
let visionTabButtons, visionViews;

function initializeScreens() {
  screens = {
    home: document.getElementById('homeScreen'),
    projectsList: document.getElementById('projectsListScreen'),
    projectType: document.getElementById('projectTypeScreen'),
    buildingSelection: document.getElementById('buildingSelectionScreen'),
    mapSelection: document.getElementById('mapSelectionScreen'),
    projectSettings: document.getElementById('projectSettingsScreen'),
    customTabSettings: document.getElementById('customTabSettingsScreen'),
    condoScanner: document.getElementById('condoScannerScreen'),
    isolatedBulkUploadSettings: document.getElementById('isolatedBulkUploadSettingsScreen'),
    isolatedBulkUpload: document.getElementById('isolatedBulkUploadScreen'),
    isolatedBulkUploadSuccess: document.getElementById('isolatedBulkUploadSuccessScreen'),
    isolatedBulkUploadData: document.getElementById('isolatedBulkUploadDataScreen'),
    projectMenu: document.getElementById('projectMenuScreen'),
    scanTypeSelection: document.getElementById('scanTypeSelectionScreen'),
    versionHistory: document.getElementById('versionHistoryScreen'),
    guide: document.getElementById('guideScreen'),
    eloTracker: document.getElementById('eloTrackerScreen'),
    progressDashboard: document.getElementById('progressDashboardScreen'),
    visionApp: document.getElementById('visionApp'),
    batchUpload: document.getElementById('batchUploadScreen')
  };

  // Home screen project buttons
  const createProjectBtn = document.getElementById('createProjectBtn');
  const viewProjectsBtn = document.getElementById('viewProjectsBtn');
  const continueProjectBtn = document.getElementById('continueProjectBtn');
  const closeProjectBtn = document.getElementById('closeProjectBtn');
  
  // Home screen guide tile
  guideTile = document.getElementById('guideTile');
  
  // Recovery tool button
  const recoveryToolBtn = document.getElementById('recoveryToolBtn');

  // Back buttons
  visionMenuBackBtn = document.getElementById('visionMenuBackBtn');
  batchBackBtn = document.getElementById('batchBackBtn');
  versionHistoryBackBtn = document.getElementById('versionHistoryBackBtn');
  guideBackBtn = document.getElementById('guideBackBtn');

  // Vision app tabs and views
  visionTabButtons = document.querySelectorAll('#visionApp .vision-tab');
  visionViews = document.querySelectorAll('#visionApp .vision-view');
  
  // Setup event listeners
  setupNavigationListeners();
  
  // Setup project navigation
  setupProjectNavigation();
  
  // Initialize home screen with active project info
  updateHomeScreenProjectInfo();
}

let cameraInitialized = false;
let cameraInitPromise = null;
let locationInitialized = false;
let locationInitPromise = null;

function setActiveScreen(targetScreen) {
  Object.values(screens).forEach(section => {
    if (section) section.classList.remove('active');
  });
  if (targetScreen) {
    targetScreen.classList.add('active');
    
    // Initialize screens when shown
    if (targetScreen === screens.isolatedBulkUpload) {
      setupIsolatedBulkUploadScreen();
    } else if (targetScreen === screens.isolatedBulkUploadData) {
      setupIsolatedBulkUploadDataScreen();
    } else if (targetScreen === screens.batchUpload) {
      // CRITICAL FIX: Re-query batch table body when batch upload screen is shown (fixes iOS issue)
      // Use requestAnimationFrame to ensure screen is fully rendered
      requestAnimationFrame(() => {
        setTimeout(() => {
          const newBatchTableBody = document.querySelector('#batchResultsTable tbody');
          if (newBatchTableBody) {
            // Update the global reference
            batchTableBody = newBatchTableBody;
            // Re-render table to ensure it displays (fixes iOS rendering issue)
            renderBatchTable();
            // Force iOS layout recalculation after screen is shown
            setTimeout(() => {
              forceIOSLayoutRecalc();
            }, 200);
            console.log('✅ Batch table re-initialized on screen show');
          } else {
            console.warn('⚠️ Batch table body not found when screen shown');
          }
          
          // Note: Handlers are attached on initial setup and re-attached after resetBatchInput()
          // No need to re-attach here to avoid duplicate listeners
        }, 100);
      });
    }
  }
}

function setVisionView(targetView = 'data') {
  const viewName = targetView || 'data';
  
  // Add/remove camera-active class to prevent scrolling in camera view
  const visionApp = document.getElementById('visionApp');
  if (viewName === 'camera') {
    visionApp?.classList.add('camera-active');
  } else {
    visionApp?.classList.remove('camera-active');
  }
  
  // Show/hide camera settings button
  const cameraSettingsBtn = document.getElementById('cameraSettingsBtn');
  if (cameraSettingsBtn) {
    cameraSettingsBtn.style.display = viewName === 'camera' ? 'block' : 'none';
  }
  
  // Update view title
  const viewTitle = document.getElementById('currentViewTitle');
  if (viewTitle) {
    const titles = {
      'camera': 'Scanner',
      'data': 'Records',
      'map': 'Map'
    };
    viewTitle.textContent = titles[viewName] || 'Vision';
  }
  
  visionTabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  visionViews.forEach(section => {
    section.classList.toggle('active', section.dataset.view === viewName);
  });

  if (viewName === 'camera') {
    ensureCameraReady();
    // Apply saved camera settings when switching to camera view
    applyCameraSettings();
  }

  if (viewName === 'data') {
    // CRITICAL FIX: Always render table when switching to data view
    // This ensures data is displayed correctly when navigating from project menu
    setTimeout(() => {
      renderTable();
    }, 100);
  }

  if (viewName === 'map') {
    ensureLocationReady();
    // Load and display project progress when map view is opened
    setTimeout(() => {
      loadAndDisplayProjectProgress();
    }, 500);
    
    setTimeout(() => {
      if (typeof miniMap !== 'undefined' && miniMap) {
        miniMap.invalidateSize();
      }
      if (typeof fullMap !== 'undefined' && fullMap) {
        fullMap.invalidateSize();
      }
    }, 180);
  }
}


function setupNavigationListeners() {
  // Home screen guide tile
  if (guideTile) {
    guideTile.addEventListener('click', () => {
      setActiveScreen(screens.guide);
    });
  }


  // Progress Dashboard back button
  const progressDashboardBackBtn = document.getElementById('progressDashboardBackBtn');
  if (progressDashboardBackBtn) {
    progressDashboardBackBtn.addEventListener('click', () => {
      // Stop live location tracking when leaving
      stopLiveLocationTracking();
      // Go back to Project Menu (where Progress Map is accessed from)
      const project = getActiveProject();
      if (project) {
        setActiveScreen(screens.projectMenu);
      } else {
      setActiveScreen(screens.home);
      }
    });
  }

  // Live location toggle button
  const toggleLiveLocationBtn = document.getElementById('toggleLiveLocationBtn');
  if (toggleLiveLocationBtn) {
    toggleLiveLocationBtn.addEventListener('click', () => {
      if (isLiveLocationEnabled) {
        stopLiveLocationTracking();
      } else {
        startLiveLocationTracking();
      }
    });
  }

  // Close location details panel
  const closeLocationDetails = document.getElementById('closeLocationDetails');
  if (closeLocationDetails) {
    closeLocationDetails.addEventListener('click', () => {
      const panel = document.getElementById('locationDetailsPanel');
      if (panel) panel.classList.add('hidden');
    });
  }
  
  // Recovery tool button - opens in same window to access same localStorage
  if (recoveryToolBtn) {
    recoveryToolBtn.addEventListener('click', () => {
      // Open recovery tool in same window (same web app context)
      // This ensures it accesses the same localStorage as the web app
      window.location.href = './tools/recover-scans.html';
    });
  }
  
  // IndexedDB browser button
  const indexedDBBrowserBtn = document.getElementById('indexedDBBrowserBtn');
  if (indexedDBBrowserBtn) {
    indexedDBBrowserBtn.addEventListener('click', () => {
      // Open IndexedDB browser in same window (same web app context)
      window.location.href = './tools/browse-indexeddb.html';
    });
  }

  // Back buttons - go to project menu if project is active, otherwise home
  if (visionMenuBackBtn) {
    visionMenuBackBtn.addEventListener('click', () => {
      const project = getActiveProject();
      if (project) {
        openProjectMenu();
      } else {
        setActiveScreen(screens.home);
      }
    });
  }

  if (batchBackBtn) {
    batchBackBtn.addEventListener('click', () => {
      const project = getActiveProject();
      if (project) {
        openProjectMenu();
      } else {
        setActiveScreen(screens.home);
      }
    });
  }

  if (versionHistoryBackBtn) {
    versionHistoryBackBtn.addEventListener('click', () => {
      setActiveScreen(screens.home);
    });
  }

  if (guideBackBtn) {
    guideBackBtn.addEventListener('click', () => {
      setActiveScreen(screens.home);
    });
  }

  // Vision app tab navigation
  visionTabButtons.forEach(tab => {
    tab.addEventListener('click', () => {
      setVisionView(tab.dataset.view);
    });
  });

  setActiveScreen(screens.home);
}

// ---------------------------
// Project Navigation & UI
// ---------------------------

// Store selected project type (shared across functions)
let selectedProjectType = 'Onground Benchmarking';

function setupProjectNavigation() {
  // Home screen buttons
  const createProjectBtn = document.getElementById('createProjectBtn');
  const viewProjectsBtn = document.getElementById('viewProjectsBtn');
  const continueProjectBtn = document.getElementById('continueProjectBtn');
  const closeProjectBtn = document.getElementById('closeProjectBtn');
  const createFirstProjectBtn = document.getElementById('createFirstProjectBtn');
  
  // Project screens back buttons
  const projectsListBackBtn = document.getElementById('projectsListBackBtn');
  const projectTypeBackBtn = document.getElementById('projectTypeBackBtn');
  const projectSettingsBackBtn = document.getElementById('projectSettingsBackBtn');
  const projectMenuBackBtn = document.getElementById('projectMenuBackBtn');
  
  // Project type screen
  const projectTypeNextBtn = document.getElementById('projectTypeNextBtn');
  const benchmarkingTypeBtn = document.getElementById('benchmarkingTypeBtn');
  const mapCityLiteTypeBtn = document.getElementById('mapCityLiteTypeBtn');
  
  // Project settings form
  const projectSettingsForm = document.getElementById('projectSettingsForm');
  const projectLocation = document.getElementById('projectLocation');
  
  // Project menu buttons
  const projectScanBtn = document.getElementById('projectScanBtn');
  const projectDataBtn = document.getElementById('projectDataBtn');
  const projectBulkBtn = document.getElementById('projectBulkBtn');
  const projectMapBtn = document.getElementById('projectMapBtn');
  const projectSettingsBtn = document.getElementById('projectSettingsBtn');
  
  // Scan type selection screen
  const scanTypeBackBtn = document.getElementById('scanTypeBackBtn');

  // Home screen navigation
  if (createProjectBtn) {
    createProjectBtn.addEventListener('click', () => {
      setActiveScreen(screens.projectType);
    });
  }

  if (viewProjectsBtn) {
    viewProjectsBtn.addEventListener('click', () => {
      // CRITICAL FIX: Backup projects before showing list (Android safeguard)
      const projects = loadProjects();
      if (projects.length > 0) {
        sessionStorage.setItem('projects_backup', JSON.stringify(projects));
        console.log(`💾 Backed up ${projects.length} projects before showing list`);
      }
      
      // CRITICAL FIX: Reset folder filter to 'all' to ensure all projects show
      currentFolderFilter = 'all';
      
      renderProjectsList();
      setActiveScreen(screens.projectsList);
    });
  }

  if (continueProjectBtn) {
    continueProjectBtn.addEventListener('click', () => {
      openProjectMenu();
    });
  }

  if (closeProjectBtn) {
    closeProjectBtn.addEventListener('click', () => {
      setActiveProject(null);
      updateHomeScreenProjectInfo();
    });
  }

  if (createFirstProjectBtn) {
    createFirstProjectBtn.addEventListener('click', () => {
      setActiveScreen(screens.projectType);
    });
  }

  // Back buttons
  if (projectsListBackBtn) {
    projectsListBackBtn.addEventListener('click', () => {
      setActiveScreen(screens.home);
    });
  }

  // Add folder button
  const addFolderBtn = document.getElementById('addFolderBtn');
  if (addFolderBtn) {
    addFolderBtn.addEventListener('click', () => {
      openCreateFolderModal();
    });
  }
  
  // Selection mode button
  const selectModeBtn = document.getElementById('selectModeBtn');
  if (selectModeBtn) {
    selectModeBtn.addEventListener('click', () => {
      toggleSelectionMode();
    });
  }
  
  // Selection toolbar buttons
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const moveSelectedBtn = document.getElementById('moveSelectedBtn');
  const cancelSelectBtn = document.getElementById('cancelSelectBtn');
  
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const projects = loadProjects();
      const filteredProjects = currentFolderFilter !== 'all' 
        ? projects.filter(p => getProjectFolder(p.id) === currentFolderFilter)
        : projects.filter(p => !getProjectFolder(p.id));
      filteredProjects.forEach(p => selectedProjectIds.add(p.id));
      updateSelectionUI();
      renderProjectsList();
    });
  }
  
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      selectedProjectIds.clear();
      updateSelectionUI();
      renderProjectsList();
    });
  }
  
  if (moveSelectedBtn) {
    moveSelectedBtn.addEventListener('click', () => {
      if (selectedProjectIds.size === 0) {
        alert('Please select at least one project');
        return;
      }
      openMoveSelectedToFolderModal();
    });
  }
  
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', async () => {
      if (selectedProjectIds.size === 0) {
        alert('Please select at least one project');
        return;
      }
      await deleteSelectedProjects();
    });
  }
  
  if (cancelSelectBtn) {
    cancelSelectBtn.addEventListener('click', () => {
      exitSelectionMode();
    });
  }
  
  // Feedback button on home screen
  const feedbackBtnHome = document.getElementById('feedbackBtnHome');
  if (feedbackBtnHome) {
    feedbackBtnHome.addEventListener('click', () => {
      showFeedbackModal();
    });
  }
  
  // Visionary button on home screen
  const visionaryBtn = document.getElementById('visionaryBtn');
  if (visionaryBtn) {
    visionaryBtn.addEventListener('click', () => {
      setActiveScreen(screens.mapSelection);
    });
  }

  // Map selection screen handlers
  const mapSelectionBackBtn = document.getElementById('mapSelectionBackBtn');
  if (mapSelectionBackBtn) {
    mapSelectionBackBtn.addEventListener('click', () => {
      setActiveScreen(screens.home);
    });
  }

  const basementMapBtn = document.getElementById('basementMapBtn');
  if (basementMapBtn) {
    basementMapBtn.addEventListener('click', () => {
      window.open('basement-map/index.html', '_blank');
    });
  }

  const avRoutingMapBtn = document.getElementById('avRoutingMapBtn');
  if (avRoutingMapBtn) {
    avRoutingMapBtn.addEventListener('click', () => {
      window.open('av-routing-map/index.html', '_blank');
    });
  }
  
  // Setup feedback modal
  setupFeedbackModal();
  
  // Project type selection (radio behavior)
  if (benchmarkingTypeBtn) {
    benchmarkingTypeBtn.addEventListener('click', () => {
      selectedProjectType = 'Onground Benchmarking';
      benchmarkingTypeBtn.classList.add('selected');
      if (mapCityLiteTypeBtn) mapCityLiteTypeBtn.classList.remove('selected');
    });
  }
  
  if (mapCityLiteTypeBtn) {
    mapCityLiteTypeBtn.addEventListener('click', () => {
      selectedProjectType = 'Map Your City Lite';
      mapCityLiteTypeBtn.classList.add('selected');
      if (benchmarkingTypeBtn) benchmarkingTypeBtn.classList.remove('selected');
    });
  }

  if (projectTypeBackBtn) {
    projectTypeBackBtn.addEventListener('click', () => {
      setActiveScreen(screens.home);
    });
  }

  if (projectSettingsBackBtn) {
    projectSettingsBackBtn.addEventListener('click', () => {
      // Check if we're editing before resetting
      const wasEditing = isEditingProject;
      
      // Reset edit mode when going back
      isEditingProject = false;
      editingProjectId = null;
      
      // Re-enable location field if it was disabled
      const projectLocation = document.getElementById('projectLocation');
      if (projectLocation) {
        projectLocation.disabled = false;
        projectLocation.title = '';
      }
      
      // Reset button text
      const submitBtn = document.querySelector('#projectSettingsForm button[type="submit"]');
      if (submitBtn) submitBtn.textContent = 'Create Project →';
      
      // Navigate back based on context
      if (wasEditing) {
        setActiveScreen(screens.projectMenu);
      } else {
        setActiveScreen(screens.buildingSelection);
      }
    });
  }

  if (projectMenuBackBtn) {
    projectMenuBackBtn.addEventListener('click', () => {
      // Check if we came from projects list
      const cameFromProjectsList = sessionStorage.getItem('cameFromProjectsList') === 'true';
      if (cameFromProjectsList) {
        sessionStorage.removeItem('cameFromProjectsList');
        setActiveScreen(screens.projectsList);
        renderProjectsList();
      } else {
      setActiveScreen(screens.home);
      updateHomeScreenProjectInfo();
      }
    });
  }

  // Project type next button
  if (projectTypeNextBtn) {
    projectTypeNextBtn.addEventListener('click', () => {
      if (selectedProjectType === 'Map Your City Lite') {
        // Skip project settings for Map Your City Lite - create project with defaults
        createMapCityLiteProject();
      } else {
        // Show building selection screen for Onground Benchmarking
        setActiveScreen(screens.buildingSelection);
      }
    });
  }

  // Building Selection Screen handlers
  const buildingSelectionBackBtn = document.getElementById('buildingSelectionBackBtn');
  const selectExistingBuildingBtn = document.getElementById('selectExistingBuildingBtn');
  const createNewTabBtn = document.getElementById('createNewTabBtn');
  const customTabSettingsBackBtn = document.getElementById('customTabSettingsBackBtn');

  if (buildingSelectionBackBtn) {
    buildingSelectionBackBtn.addEventListener('click', () => {
      setActiveScreen(screens.projectType);
    });
  }

  if (selectExistingBuildingBtn) {
    selectExistingBuildingBtn.addEventListener('click', () => {
      // Go to existing project settings with location dropdown
      initializeProjectSettingsForm();
      setActiveScreen(screens.projectSettings);
    });
  }

  if (createNewTabBtn) {
    createNewTabBtn.addEventListener('click', () => {
      // Go to custom tab settings screen
      initializeCustomTabSettingsForm();
      setActiveScreen(screens.customTabSettings);
      // Refresh tab names when opening the screen
      populateTabNameDatalist();
    });
  }

  // Condo Scan button
  const condoScanBtn = document.getElementById('condoScanBtn');
  if (condoScanBtn) {
    condoScanBtn.addEventListener('click', () => {
      initializeCondoScanner();
      setActiveScreen(screens.condoScanner);
    });
  }

  // Isolated Bulk Upload button
  const isolatedBulkUploadBtn = document.getElementById('isolatedBulkUploadBtn');
  if (isolatedBulkUploadBtn) {
    isolatedBulkUploadBtn.addEventListener('click', () => {
      initializeIsolatedBulkUploadSettings();
      setActiveScreen(screens.isolatedBulkUploadSettings);
    });
  }

  // Condo Scanner back button
  const condoScannerBackBtn = document.getElementById('condoScannerBackBtn');
  if (condoScannerBackBtn) {
    condoScannerBackBtn.addEventListener('click', () => {
      setActiveScreen(screens.buildingSelection);
    });
  }

  if (customTabSettingsBackBtn) {
    customTabSettingsBackBtn.addEventListener('click', () => {
      setActiveScreen(screens.buildingSelection);
    });
  }

  // Custom Tab Settings form submission
  const customTabSettingsForm = document.getElementById('customTabSettingsForm');
  if (customTabSettingsForm) {
    customTabSettingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      createCustomTabProject();
    });
  }

  // Category toggle buttons
  const categoryResidentialBtn = document.getElementById('categoryResidentialBtn');
  const categoryCommercialBtn = document.getElementById('categoryCommercialBtn');
  const residentialFields = document.getElementById('residentialFields');
  const commercialFields = document.getElementById('commercialFields');

  if (categoryResidentialBtn) {
    categoryResidentialBtn.addEventListener('click', () => {
      categoryResidentialBtn.classList.add('selected');
      categoryCommercialBtn.classList.remove('selected');
      if (residentialFields) residentialFields.classList.remove('hidden');
      if (commercialFields) commercialFields.classList.add('hidden');
      // Make residential street required when Residential is selected
      if (residentialStreet) {
        residentialStreet.setAttribute('required', 'required');
      }
    });
  }

  if (categoryCommercialBtn) {
    categoryCommercialBtn.addEventListener('click', () => {
      categoryCommercialBtn.classList.add('selected');
      categoryResidentialBtn.classList.remove('selected');
      if (commercialFields) commercialFields.classList.remove('hidden');
      if (residentialFields) residentialFields.classList.add('hidden');
      // Remove required attribute when Commercial is selected
      if (residentialStreet) {
        residentialStreet.removeAttribute('required');
      }
    });
  }

  // Update tab preview when tab name changes
  const customTabName = document.getElementById('customTabName');
  const customTabPreview = document.getElementById('customTabPreview');
  if (customTabName && customTabPreview) {
    customTabName.addEventListener('input', () => {
      customTabPreview.textContent = customTabName.value || '-';
    });
  }
  
  // Scan type selection back button
  if (scanTypeBackBtn) {
    scanTypeBackBtn.addEventListener('click', () => {
      openProjectMenu();
    });
  }

  // Populate location dropdown (only if not already populated)
  if (projectLocation && projectLocation.options.length <= 1) {
    PROJECT_LOCATIONS.forEach(loc => {
      const option = document.createElement('option');
      option.value = loc.name;
      option.textContent = loc.name;
      projectLocation.appendChild(option);
    });

    // Auto-fill address when location is selected
    projectLocation.addEventListener('change', () => {
      const selectedLocationName = projectLocation.value;
      const location = getLocationByName(selectedLocationName);
      
      // Update sheet tab preview
      const sheetTabPreview = document.getElementById('sheetTabPreview');
      if (sheetTabPreview) {
        sheetTabPreview.textContent = selectedLocationName || '-';
      }
      
      // Auto-fill address fields if location has address data
      if (location) {
        const defaultHouseNo = document.getElementById('defaultHouseNo');
        const defaultStreet = document.getElementById('defaultStreet');
        const defaultBuilding = document.getElementById('defaultBuilding');
        const defaultPostcode = document.getElementById('defaultPostcode');
        // Note: Floor is NOT auto-filled - user must input manually
        
        if (defaultHouseNo && location.houseNo) {
          defaultHouseNo.value = location.houseNo;
        }
        if (defaultStreet && location.street) {
          defaultStreet.value = location.street;
        }
        if (defaultBuilding && location.building) {
          defaultBuilding.value = location.building;
        }
        if (defaultPostcode && location.postcode) {
          defaultPostcode.value = location.postcode;
        }
      }
    });
  }

  // Project settings form submission
  if (projectSettingsForm) {
    projectSettingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (isEditingProject && editingProjectId) {
        updateCurrentProject();
      } else {
      createAndActivateProject();
      }
    });
  }

  // Project menu navigation
  if (projectScanBtn) {
    projectScanBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const project = getActiveProject();
      console.log('Scan button clicked, project type:', project?.type);
      if (project && project.type === 'Map Your City Lite') {
        // Show scan type selection for Map Your City Lite
        console.log('Opening scan type selection screen');
        setActiveScreen(screens.scanTypeSelection);
      } else {
        // Show camera for Onground Benchmarking
        console.log('Opening camera view');
        setActiveScreen(screens.visionApp);
        setVisionView('camera');
      }
    });
  }

  if (projectDataBtn) {
    projectDataBtn.addEventListener('click', () => {
      setActiveScreen(screens.visionApp);
      setVisionView('data');
    });
  }

  if (projectBulkBtn) {
    projectBulkBtn.addEventListener('click', () => {
      setActiveScreen(screens.batchUpload);
    });
  }

  if (projectMapBtn) {
    projectMapBtn.addEventListener('click', () => {
      setActiveScreen(screens.progressDashboard);
      initProgressDashboard();
    });
  }

  if (projectSettingsBtn) {
    projectSettingsBtn.addEventListener('click', () => {
      editCurrentProjectSettings();
    });
  }
  
}

function initializeProjectSettingsForm() {
  // Reset edit mode when initializing form (for new projects)
  isEditingProject = false;
  editingProjectId = null;
  
  const projectDate = document.getElementById('projectDate');
  const projectEmail = document.getElementById('projectEmail');
  const projectLocation = document.getElementById('projectLocation');
  const projectEnvironment = document.getElementById('projectEnvironment');
  const projectSyncEnabled = document.getElementById('projectSyncEnabled');
  const sheetTabPreview = document.getElementById('sheetTabPreview');
  const defaultHouseNo = document.getElementById('defaultHouseNo');
  const defaultStreet = document.getElementById('defaultStreet');
  const defaultFloor = document.getElementById('defaultFloor');
  const defaultBuilding = document.getElementById('defaultBuilding');
  const defaultPostcode = document.getElementById('defaultPostcode');
  const submitBtn = document.querySelector('#projectSettingsForm button[type="submit"]');
  
  // Ensure location field is enabled for new projects
  if (projectLocation) {
    projectLocation.disabled = false;
    projectLocation.title = '';
  }
  
  // Ensure button text is correct for new projects
  if (submitBtn) submitBtn.textContent = 'Create Project →';

  // Populate location dropdown if not already populated
  if (projectLocation && projectLocation.options.length <= 1) {
    // Clear existing options except the first one
    while (projectLocation.options.length > 1) {
      projectLocation.remove(1);
    }
    // Add all locations
    PROJECT_LOCATIONS.forEach(loc => {
      const option = document.createElement('option');
      option.value = loc.name;
      option.textContent = loc.name;
      projectLocation.appendChild(option);
    });
  }

  // Set default date to today (Singapore timezone)
  if (projectDate) {
    projectDate.value = getSingaporeDate();
  }

  // Clear/reset other fields
  if (projectEmail) projectEmail.value = '';
  if (projectLocation) {
    projectLocation.value = '';
    if (sheetTabPreview) sheetTabPreview.textContent = '-';
  }
  if (projectEnvironment) projectEnvironment.value = 'Indoor';
  if (projectSyncEnabled) projectSyncEnabled.checked = true;
  if (defaultHouseNo) defaultHouseNo.value = '';
  if (defaultStreet) defaultStreet.value = '';
  if (defaultFloor) defaultFloor.value = '';
  if (defaultBuilding) defaultBuilding.value = '';
  if (defaultPostcode) defaultPostcode.value = '';
}

// Cache for tab names to avoid repeated API calls
let tabNamesCache = null;
let tabNamesCacheTime = null;
const TAB_NAMES_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Fetch tab names from Dashboard - Commercial column A
// Note: We need to fetch raw column A values to get accurate row numbers
// since the records API filters deleted rows and we need to ignore specific sheet rows
async function fetchTabNamesFromDashboard() {
  // Check cache first
  const now = Date.now();
  if (tabNamesCache && tabNamesCacheTime && (now - tabNamesCacheTime) < TAB_NAMES_CACHE_DURATION) {
    return tabNamesCache;
  }

  try {
    // Fetch raw data to get accurate row numbers
    // We'll use the same endpoint but process it differently
    const tabName = 'Dashboard - Commercial';
    const params = new URLSearchParams({ tabName, includeDeleted: 'true' }); // Include deleted to get all rows
    const url = `${SHEETS_SYNC_ENDPOINT}?${params.toString()}`;
    
    console.log('📋 Fetching tab names from Dashboard - Commercial...');
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const result = await response.json();
    
    if (result.success && result.records) {
      // Extract unique values from column A (Location field)
      // The API returns records starting from row 2 (after header row 1)
      // Sheet rows: A1=header, A2=records[0], A3=records[1], ..., A36=records[34], A57=records[55], etc.
      // Ignore rows: A1 (header, not in records), A2 (index 0), A36 (index 34), A57 (index 55), A58 (index 56), A59 (index 57), A60 (index 58)
      const ignoredIndices = [0, 34, 55, 56, 57, 58];
      const tabNamesSet = new Set();
      
      result.records.forEach((record, index) => {
        // Skip ignored rows based on their position in the records array
        // Note: This assumes records are returned in sheet row order
        if (!ignoredIndices.includes(index)) {
          const location = record.Location || record.location || record.A || record.a || '';
          if (location && location.trim()) {
            // Also filter out common non-tab-name values
            const locationLower = location.toLowerCase().trim();
            if (locationLower !== 'location' && 
                !locationLower.includes('grid') && 
                !locationLower.startsWith('total')) {
              tabNamesSet.add(location.trim());
            }
          }
        }
      });
      
      const tabNames = Array.from(tabNamesSet).sort();
      
      // Update cache
      tabNamesCache = tabNames;
      tabNamesCacheTime = now;
      
      console.log(`📋 Fetched ${tabNames.length} unique tab names from Dashboard - Commercial`);
      return tabNames;
    } else {
      console.warn('Could not fetch tab names:', result.error || result.reason);
      return [];
    }
  } catch (error) {
    console.error('Error fetching tab names:', error);
    return [];
  }
}

// Populate tab name datalist
async function populateTabNameDatalist() {
  const datalist = document.getElementById('tabNameOptions');
  if (!datalist) return;
  
  const tabNames = await fetchTabNamesFromDashboard();
  
  // Clear existing options
  datalist.innerHTML = '';
  
  // Add options
  tabNames.forEach(tabName => {
    const option = document.createElement('option');
    option.value = tabName;
    datalist.appendChild(option);
  });
  
  console.log(`✅ Populated ${tabNames.length} tab names in datalist`);
}

// Email persistence functions
function loadSavedEmails() {
  try {
    const saved = localStorage.getItem(EMAIL_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to load saved emails:', e);
  }
  return [];
}

function saveEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return; // Invalid email
  }
  
  const emailLower = email.toLowerCase().trim();
  const savedEmails = loadSavedEmails();
  
  // Add email if not already in list
  if (!savedEmails.includes(emailLower)) {
    savedEmails.unshift(emailLower); // Add to beginning
    // Keep only last 20 emails
    if (savedEmails.length > 20) {
      savedEmails.pop();
    }
    
    try {
      localStorage.setItem(EMAIL_STORAGE_KEY, JSON.stringify(savedEmails));
      console.log(`✅ Saved email: ${emailLower}`);
    } catch (e) {
      console.warn('Failed to save email:', e);
    }
  }
}

function populateEmailDatalist() {
  const datalist = document.getElementById('customTabEmailOptions');
  if (!datalist) return;
  
  const savedEmails = loadSavedEmails();
  
  // Clear existing options
  datalist.innerHTML = '';
  
  // Add saved emails as options
  savedEmails.forEach(email => {
    const option = document.createElement('option');
    option.value = email;
    datalist.appendChild(option);
  });
  
  console.log(`✅ Populated ${savedEmails.length} saved emails in datalist`);
}

function initializeCustomTabSettingsForm() {
  // Get form elements
  const customTabCountry = document.getElementById('customTabCountry');
  const customTabName = document.getElementById('customTabName');
  const customTabDate = document.getElementById('customTabDate');
  const customTabEmail = document.getElementById('customTabEmail');
  const customTabEnvironment = document.getElementById('customTabEnvironment');
  const customTabSyncEnabled = document.getElementById('customTabSyncEnabled');
  const customTabPreview = document.getElementById('customTabPreview');
  
  // Category toggle buttons
  const categoryResidentialBtn = document.getElementById('categoryResidentialBtn');
  const categoryCommercialBtn = document.getElementById('categoryCommercialBtn');
  const residentialFields = document.getElementById('residentialFields');
  const commercialFields = document.getElementById('commercialFields');
  
  // Residential fields
  const residentialStreet = document.getElementById('residentialStreet');
  const residentialBuilding = document.getElementById('residentialBuilding');
  const residentialPostcode = document.getElementById('residentialPostcode');
  
  // Commercial fields
  const commercialHouseNo = document.getElementById('commercialHouseNo');
  const commercialStreet = document.getElementById('commercialStreet');
  const commercialBuilding = document.getElementById('commercialBuilding');
  const commercialPostcode = document.getElementById('commercialPostcode');
  const commercialFloor = document.getElementById('commercialFloor');

  // Set default country to Singapore
  if (customTabCountry) {
    customTabCountry.value = 'Singapore';
  }

  // Set default date to today (Singapore timezone)
  if (customTabDate) {
    customTabDate.value = getSingaporeDate();
  }

  // Clear/reset all fields
  if (customTabName) {
    customTabName.value = '';
    if (customTabPreview) customTabPreview.textContent = '-';
  }
  
  // Populate tab name datalist
  populateTabNameDatalist();
  
  // Populate email datalist with saved emails
  populateEmailDatalist();
  if (customTabEmail) customTabEmail.value = '';
  
  if (customTabEnvironment) customTabEnvironment.value = 'Outdoor'; // Default to Outdoor for residential/commercial
  if (customTabSyncEnabled) customTabSyncEnabled.checked = true;
  
  // Reset to Commercial mode by default (as per user requirement)
  if (categoryResidentialBtn) categoryResidentialBtn.classList.remove('selected');
  if (categoryCommercialBtn) categoryCommercialBtn.classList.add('selected');
  if (residentialFields) residentialFields.classList.add('hidden');
  if (commercialFields) commercialFields.classList.remove('hidden');
  
  // Remove required attribute from residential street (default is Commercial)
  if (residentialStreet) {
    residentialStreet.removeAttribute('required');
  }
  
  // Clear residential fields
  if (residentialStreet) residentialStreet.value = '';
  if (residentialBuilding) residentialBuilding.value = '';
  if (residentialPostcode) residentialPostcode.value = '';
  
  // Clear commercial fields
  if (commercialHouseNo) commercialHouseNo.value = '';
  if (commercialStreet) commercialStreet.value = '';
  if (commercialBuilding) commercialBuilding.value = '';
  if (commercialPostcode) commercialPostcode.value = '';
  if (commercialFloor) commercialFloor.value = '';
}

function createAndActivateProject() {
  const projectDate = document.getElementById('projectDate');
  const projectEmail = document.getElementById('projectEmail');
  const projectLocation = document.getElementById('projectLocation');
  const projectEnvironment = document.getElementById('projectEnvironment');
  const projectSyncEnabled = document.getElementById('projectSyncEnabled');
  const defaultHouseNo = document.getElementById('defaultHouseNo');
  const defaultStreet = document.getElementById('defaultStreet');
  const defaultFloor = document.getElementById('defaultFloor');
  const defaultBuilding = document.getElementById('defaultBuilding');
  const defaultPostcode = document.getElementById('defaultPostcode');

  const newProject = createProject({
    type: 'Onground Benchmarking',
    date: projectDate?.value || new Date().toISOString().split('T')[0],
    email: projectEmail?.value || '',
    location: projectLocation?.value || '',
    environment: projectEnvironment?.value || 'Indoor',
    syncEnabled: projectSyncEnabled?.checked !== false,
    houseNo: defaultHouseNo?.value || '',
    street: defaultStreet?.value || '',
    floor: defaultFloor?.value || '',
    building: defaultBuilding?.value || '',
    postcode: defaultPostcode?.value || ''
  });

  // Reset edit mode
  isEditingProject = false;
  editingProjectId = null;
  
  // Reset button text
  const submitBtn = document.querySelector('#projectSettingsForm button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Create Project →';

  setActiveProject(newProject.id);
  openProjectMenu();
}

function updateCurrentProject() {
  if (!editingProjectId) return;

  const projectDate = document.getElementById('projectDate');
  const projectEmail = document.getElementById('projectEmail');
  const projectLocation = document.getElementById('projectLocation');
  const projectEnvironment = document.getElementById('projectEnvironment');
  const projectSyncEnabled = document.getElementById('projectSyncEnabled');
  const defaultHouseNo = document.getElementById('defaultHouseNo');
  const defaultStreet = document.getElementById('defaultStreet');
  const defaultFloor = document.getElementById('defaultFloor');
  const defaultBuilding = document.getElementById('defaultBuilding');
  const defaultPostcode = document.getElementById('defaultPostcode');

  // Get current project to preserve some fields
  const currentProject = getProject(editingProjectId);
  if (!currentProject) {
    alert('Project not found');
    return;
  }

  // Update project with new settings
  // IMPORTANT: Do NOT update location or sheetTab - these should remain fixed
  const updatedProject = updateProject(editingProjectId, {
    date: projectDate?.value || currentProject.date,
    email: projectEmail?.value || currentProject.email,
    // location and sheetTab are NOT updated - they remain as originally set
    location: currentProject.location, // Keep original location
    sheetTab: currentProject.sheetTab, // Keep original sheet tab
    environment: projectEnvironment?.value || currentProject.environment,
    syncEnabled: projectSyncEnabled?.checked !== false,
    defaultAddress: {
      houseNo: defaultHouseNo?.value || '',
      street: defaultStreet?.value || '',
      floor: defaultFloor?.value || '',
      building: defaultBuilding?.value || '',
      postcode: defaultPostcode?.value || ''
    }
  });

  if (updatedProject) {
    // Reset edit mode
    isEditingProject = false;
    editingProjectId = null;
    
    // Reset button text
    const submitBtn = document.querySelector('#projectSettingsForm button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Create Project →';

    // Show success message
    alert('Project settings updated successfully!\n\nNote: Future scans will use the new floor/building for photo naming. Existing scans will keep their original filenames.');
    
    // Return to project menu
    setActiveScreen(screens.projectMenu);
  } else {
    alert('Failed to update project settings');
  }
}

function createMapCityLiteProject() {
  const newProject = createProject({
    type: 'Map Your City Lite',
    date: new Date().toISOString().split('T')[0],
    email: '',
    location: 'Map Your City Lite',
    environment: 'Outdoor',
    syncEnabled: false,
    houseNo: '',
    street: '',
    floor: '',
    building: '',
    postcode: ''
  });

  setActiveProject(newProject.id);
  openProjectMenu();
}

async function createCustomTabProject() {
  // Get form elements
  const customTabCountry = document.getElementById('customTabCountry');
  const customTabName = document.getElementById('customTabName');
  const customTabDate = document.getElementById('customTabDate');
  const customTabEmail = document.getElementById('customTabEmail');
  const customTabEnvironment = document.getElementById('customTabEnvironment');
  const customTabSyncEnabled = document.getElementById('customTabSyncEnabled');
  
  // Get country selection
  const country = customTabCountry?.value || 'Singapore';
  const sheetId = COUNTRY_SHEET_IDS[country] || null; // null means use default
  
  // Validate email
  const email = customTabEmail?.value?.trim() || '';
  if (!email) {
    alert('Please enter an email address');
    if (customTabEmail) customTabEmail.focus();
    return;
  }
  
  // Save email to localStorage for future use
  saveEmail(email);
  
  // Check which category is selected
  const categoryResidentialBtn = document.getElementById('categoryResidentialBtn');
  const isResidential = categoryResidentialBtn?.classList.contains('selected');
  
  // Get appropriate fields based on category
  let houseNo = '';
  let street = '';
  let floor = '';
  let building = '';
  let postcode = '';
  
  if (isResidential) {
    const residentialStreet = document.getElementById('residentialStreet');
    const residentialBuilding = document.getElementById('residentialBuilding');
    const residentialPostcode = document.getElementById('residentialPostcode');
    
    street = residentialStreet?.value?.trim() || '';
    building = residentialBuilding?.value?.trim() || '';
    postcode = residentialPostcode?.value?.trim() || '';
    
    // Validate residential street is required
    if (!street) {
      alert('Please enter street name for Residential projects');
      if (residentialStreet) {
        residentialStreet.focus();
      }
      return;
    }
  } else {
    // Commercial category
    const commercialHouseNo = document.getElementById('commercialHouseNo');
    const commercialStreet = document.getElementById('commercialStreet');
    const commercialBuilding = document.getElementById('commercialBuilding');
    const commercialPostcode = document.getElementById('commercialPostcode');
    const commercialFloor = document.getElementById('commercialFloor');
    
    houseNo = commercialHouseNo?.value?.trim() || '';
    street = commercialStreet?.value?.trim() || '';
    building = commercialBuilding?.value?.trim() || '';
    postcode = commercialPostcode?.value?.trim() || '';
    floor = commercialFloor?.value?.trim() || '';
  }
  
  const tabName = customTabName?.value || 'New Tab';
  const syncEnabled = customTabSyncEnabled?.checked !== false;
  
  // Create the tab in Google Sheets if sync is enabled
  if (syncEnabled) {
    try {
      const result = await createSheetTab(tabName, sheetId);
      if (result.success) {
        console.log(`✅ Created/verified Google Sheets tab: ${tabName}`);
      } else if (result.error && !result.error.includes('already exists')) {
        console.warn(`⚠️ Could not create tab: ${result.error}`);
        // Continue anyway - tab might already exist from another user
      }
    } catch (err) {
      console.warn('⚠️ Could not create Google Sheets tab:', err);
      // Continue anyway - sync can still work if tab exists
    }
  }
  
  const newProject = createProject({
    type: 'Onground Benchmarking',
    date: customTabDate?.value || getSingaporeDate(),
    email: email,
    location: tabName, // Use tab name as location
    environment: customTabEnvironment?.value || 'Outdoor',
    syncEnabled: syncEnabled,
    sheetTab: tabName, // Custom tab name
    sheetId: sheetId, // Country-specific sheet ID (null = use default)
    country: country, // Store country name
    isCustomTab: true,
    projectCategory: isResidential ? 'Residential' : 'Commercial',
    houseNo: houseNo,
    street: street,
    floor: floor,
    building: building,
    postcode: postcode
  });

  setActiveProject(newProject.id);
  openProjectMenu();
}

function openProjectMenu() {
  const project = getActiveProject();
  if (!project) {
    setActiveScreen(screens.home);
    return;
  }

  // Update project menu UI
  const projectMenuTitle = document.getElementById('projectMenuTitle');
  const projectMenuSubtitle = document.getElementById('projectMenuSubtitle');
  const projectInfoDate = document.getElementById('projectInfoDate');
  const projectInfoEmail = document.getElementById('projectInfoEmail');
  const projectInfoSync = document.getElementById('projectInfoSync');
  const projectInfoFloor = document.getElementById('projectInfoFloor');
  const projectInfoRecords = document.getElementById('projectInfoRecords');
  const projectInfoStandard = document.getElementById('projectInfoStandard');
  const projectInfoVision = document.getElementById('projectInfoVision');
  
  const isMapCityLite = project.type === 'Map Your City Lite';

  if (projectMenuTitle) projectMenuTitle.textContent = project.type || 'Project';
  if (projectMenuSubtitle) {
    projectMenuSubtitle.textContent = isMapCityLite ? 'Visionise your world' : (project.location || '-');
  }
  
  // Show/hide info cards based on project type
  if (isMapCityLite) {
    // Hide standard info, show vision info
    if (projectInfoStandard) projectInfoStandard.classList.add('hidden');
    if (projectInfoVision) projectInfoVision.classList.remove('hidden');
  } else {
    // Show standard info, hide vision info
    if (projectInfoStandard) projectInfoStandard.classList.remove('hidden');
    if (projectInfoVision) projectInfoVision.classList.add('hidden');
    
    // Update standard info fields
    const projectInfoCountry = document.getElementById('projectInfoCountry');
    if (projectInfoCountry) {
      projectInfoCountry.textContent = project.country || 'Singapore';
    }
    if (projectInfoDate) projectInfoDate.textContent = project.date || '-';
    if (projectInfoEmail) projectInfoEmail.textContent = project.email || '-';
    if (projectInfoSync) {
      projectInfoSync.textContent = project.syncEnabled ? `✅ ${project.sheetTab}` : '❌ Off';
    }
    if (projectInfoFloor) {
      projectInfoFloor.textContent = project.defaultAddress?.floor || '-';
    }
    // Count records for this project
    if (projectInfoRecords) {
      const scans = JSON.parse(localStorage.getItem('scans') || '[]');
      const projectScans = scans.filter(s => s.projectId === project.id);
      projectInfoRecords.textContent = projectScans.length;
    }
  }

  // Update menu buttons based on project type
  const projectScanBtn = document.getElementById('projectScanBtn');
  const projectDataBtn = document.getElementById('projectDataBtn');
  const projectMapBtn = document.getElementById('projectMapBtn');
  const projectBulkBtn = document.getElementById('projectBulkBtn');
  const projectSettingsBtn = document.getElementById('projectSettingsBtn');
  
  // Update button text and descriptions for Map Your City Lite
  if (isMapCityLite) {
    // Update Scan button
    if (projectScanBtn) {
      const tileTitle = projectScanBtn.querySelector('.tile-title');
      const tileDesc = projectScanBtn.querySelector('.tile-desc');
      if (tileTitle) tileTitle.textContent = 'Scan with AI';
      if (tileDesc) tileDesc.textContent = 'WIP';
    }
    // Update Data button
    if (projectDataBtn) {
      const tileDesc = projectDataBtn.querySelector('.tile-desc');
      if (tileDesc) tileDesc.textContent = 'WIP';
    }
    // Update Map button
    if (projectMapBtn) {
      const tileDesc = projectMapBtn.querySelector('.tile-desc');
      if (tileDesc) tileDesc.textContent = 'WIP';
    }
    // Update Bulk Upload button
    if (projectBulkBtn) {
      const tileDesc = projectBulkBtn.querySelector('.tile-desc');
      if (tileDesc) tileDesc.textContent = 'WIP';
    }
  } else {
    // Reset to default for Onground Benchmarking
    if (projectScanBtn) {
      const tileTitle = projectScanBtn.querySelector('.tile-title');
      const tileDesc = projectScanBtn.querySelector('.tile-desc');
      if (tileTitle) tileTitle.textContent = 'Scan';
      if (tileDesc) tileDesc.textContent = 'Capture storefronts with AI';
    }
    if (projectDataBtn) {
      const tileDesc = projectDataBtn.querySelector('.tile-desc');
      if (tileDesc) tileDesc.textContent = 'View scanned records';
    }
    if (projectMapBtn) {
      const tileDesc = projectMapBtn.querySelector('.tile-desc');
      if (tileDesc) tileDesc.textContent = 'View locations on map';
    }
    if (projectBulkBtn) {
      const tileDesc = projectBulkBtn.querySelector('.tile-desc');
      if (tileDesc) tileDesc.textContent = 'Upload multiple images';
    }
  }
  
  // Disable/enable buttons based on project type
  if (isMapCityLite) {
    // Disable Data, Map, Batch Upload for Map Your City Lite
    if (projectDataBtn) {
      projectDataBtn.classList.add('disabled');
      projectDataBtn.style.opacity = '0.5';
      projectDataBtn.style.pointerEvents = 'none';
    }
    if (projectMapBtn) {
      projectMapBtn.classList.add('disabled');
      projectMapBtn.style.opacity = '0.5';
      projectMapBtn.style.pointerEvents = 'none';
    }
    if (projectBulkBtn) {
      projectBulkBtn.classList.add('disabled');
      projectBulkBtn.style.opacity = '0.5';
      projectBulkBtn.style.pointerEvents = 'none';
    }
    // Hide project settings button for Map Your City Lite
    if (projectSettingsBtn) {
      projectSettingsBtn.style.display = 'none';
    }
  } else {
    // Enable all buttons for Onground Benchmarking
    if (projectDataBtn) {
      projectDataBtn.classList.remove('disabled');
      projectDataBtn.style.opacity = '1';
      projectDataBtn.style.pointerEvents = 'auto';
    }
    if (projectMapBtn) {
      projectMapBtn.classList.remove('disabled');
      projectMapBtn.style.opacity = '1';
      projectMapBtn.style.pointerEvents = 'auto';
    }
    if (projectBulkBtn) {
      projectBulkBtn.classList.remove('disabled');
      projectBulkBtn.style.opacity = '1';
      projectBulkBtn.style.pointerEvents = 'auto';
    }
    if (projectSettingsBtn) {
      projectSettingsBtn.style.display = 'block';
    }
  }

  setActiveScreen(screens.projectMenu);
  
  // CRITICAL FIX: Re-render table when switching projects to show correct data
  // Check if we're on the data view and refresh it
  setTimeout(() => {
    const visionView = document.querySelector('.vision-view.active');
    if (visionView && visionView.dataset.view === 'data') {
      renderTable();
    }
  }, 100);
}

function updateHomeScreenProjectInfo() {
  const activeProjectCard = document.getElementById('activeProjectCard');
  const activeProjectName = document.getElementById('activeProjectName');
  const activeProjectLocation = document.getElementById('activeProjectLocation');

  const project = getActiveProject();

  if (project && activeProjectCard) {
    activeProjectCard.classList.remove('hidden');
    if (activeProjectName) {
      activeProjectName.textContent = project.type || 'Project';
    }
    if (activeProjectLocation) {
      if (project.type === 'Map Your City Lite') {
        // Map Your City Lite: Show only Date
        activeProjectLocation.textContent = project.date || '-';
      } else {
        // Onground Benchmarking: Show Location | Floor | Date | Country
        const location = project.location || '-';
        const floor = project.defaultAddress?.floor || '-';
        const date = project.date || '-';
        const country = project.country || 'Singapore';
        activeProjectLocation.textContent = `${location} | ${floor} | ${date} | ${country}`;
      }
    }
  } else if (activeProjectCard) {
    activeProjectCard.classList.add('hidden');
  }
}

// Format date from YYYY-MM-DD to DD-MM-YYYY
function formatDateDDMMYYYY(dateString) {
  if (!dateString) return '-';
  const parts = dateString.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateString;
}

// Load folders from localStorage
function loadFolders() {
  try {
    const foldersJson = localStorage.getItem('projectFolders');
    return foldersJson ? JSON.parse(foldersJson) : {};
  } catch (e) {
    return {};
  }
}

// Save folders to localStorage
function saveFolders(folders) {
  localStorage.setItem('projectFolders', JSON.stringify(folders));
}

// Get folder for a project
function getProjectFolder(projectId) {
  const folders = loadFolders();
  for (const [folderName, projectIds] of Object.entries(folders)) {
    if (projectIds.includes(projectId)) {
      return folderName;
    }
  }
  return null;
}

// Add project to folder
function addProjectToFolder(projectId, folderName) {
  const folders = loadFolders();
  if (!folders[folderName]) {
    folders[folderName] = [];
  }
  if (!folders[folderName].includes(projectId)) {
    folders[folderName].push(projectId);
    saveFolders(folders);
  }
}

// Remove project from folder
function removeProjectFromFolder(projectId) {
  const folders = loadFolders();
  for (const [folderName, projectIds] of Object.entries(folders)) {
    const index = projectIds.indexOf(projectId);
    if (index > -1) {
      projectIds.splice(index, 1);
      if (projectIds.length === 0) {
        delete folders[folderName];
      }
      saveFolders(folders);
      break;
    }
  }
}

// Get all folder names
function getAllFolders() {
  return Object.keys(loadFolders());
}

// Remove folder and all projects from it
function removeFolder(folderName) {
  const folders = loadFolders();
  if (!folders[folderName]) return;
  
  const projectIds = folders[folderName];
  const projectCount = projectIds.length;
  
  // Confirm deletion
  const message = projectCount > 0 
    ? `Delete folder "${folderName}"? This will remove ${projectCount} project${projectCount !== 1 ? 's' : ''} from the folder (projects will not be deleted).`
    : `Delete folder "${folderName}"?`;
  
  if (!confirm(message)) {
    return;
  }
  
  // Remove folder
  delete folders[folderName];
  saveFolders(folders);
  
  // If currently viewing this folder, switch to "All"
  if (currentFolderFilter === folderName) {
    currentFolderFilter = 'all';
  }
  
  // Re-render the list
  renderProjectsList();
}

let currentFolderFilter = 'all';
let isSelectionMode = false;
let selectedProjectIds = new Set();

function renderProjectsList() {
  const projectsList = document.getElementById('projectsList');
  const noProjectsMessage = document.getElementById('noProjectsMessage');
  const folderSelector = document.getElementById('folderSelector');
  
  // CRITICAL FIX: Restore projects if they were cleared (Android safeguard)
  restoreProjectsIfCleared();
  
  const projects = loadProjects();
  const activeId = getActiveProjectId();

  if (!projectsList) return;
  
  // CRITICAL FIX: Ensure currentFolderFilter is valid
  if (!currentFolderFilter || (currentFolderFilter !== 'all' && !getAllFolders().includes(currentFolderFilter))) {
    currentFolderFilter = 'all';
  }

  // Render folder selector
  if (folderSelector) {
    const folders = getAllFolders();
    // Sort folders - newest first (they're stored in order created)
    const sortedFolders = [...folders].reverse();
    folderSelector.innerHTML = `
      <button id="allFoldersBtn" class="folder-tab ${currentFolderFilter === 'all' ? 'active' : ''}" data-folder="all">All</button>
      ${sortedFolders.map(folder => `
        <div class="folder-tab-wrapper">
          <button class="folder-tab ${currentFolderFilter === folder ? 'active' : ''}" data-folder="${folder}">📁 ${folder}</button>
          <button class="folder-delete-btn" data-folder="${folder}" title="Delete folder">×</button>
        </div>
      `).join('')}
    `;

    // Add folder tab click listeners
    folderSelector.querySelectorAll('.folder-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        currentFolderFilter = tab.dataset.folder;
        renderProjectsList();
      });
    });
    
    // Add folder delete button listeners
    folderSelector.querySelectorAll('.folder-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderName = btn.dataset.folder;
        removeFolder(folderName);
      });
    });
  }

  // Filter projects by folder
  let filteredProjects = projects;
  if (currentFolderFilter !== 'all') {
    // Show only projects in the selected folder
    filteredProjects = projects.filter(p => getProjectFolder(p.id) === currentFolderFilter);
  } else {
    // Show only projects that are NOT in any folder
    filteredProjects = projects.filter(p => !getProjectFolder(p.id));
  }

  if (filteredProjects.length === 0) {
    projectsList.innerHTML = '';
    if (noProjectsMessage) noProjectsMessage.classList.remove('hidden');
    return;
  }

  if (noProjectsMessage) noProjectsMessage.classList.add('hidden');

  projectsList.innerHTML = filteredProjects.map(project => {
    const isActive = project.id === activeId;
    const scans = JSON.parse(localStorage.getItem('scans') || '[]');
    const projectScans = scans.filter(s => s.projectId === project.id);
    const isSelected = selectedProjectIds.has(project.id);
    
    // Format project name: Name, Floor, Date, Country
    // Remove date suffix from project name if it exists (format: "Name - YYYY-MM-DD")
    let projectName = project.name || project.type || 'Untitled';
    // Remove date pattern like " - 2026-02-01" from the end
    projectName = projectName.replace(/\s*-\s*\d{4}-\d{2}-\d{2}$/, '').trim();
    
    const floor = project.defaultAddress?.floor || project.floor || '-';
    const date = formatDateDDMMYYYY(project.date);
    const country = project.country || 'Singapore';
    const displayName = `${projectName}, ${floor}, ${date}, ${country}`;
    
    return `
      <div class="project-card ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${isSelectionMode ? 'selection-mode' : ''}" data-project-id="${project.id}">
        ${isSelectionMode ? `<input type="checkbox" class="project-checkbox" data-project-id="${project.id}" ${isSelected ? 'checked' : ''}>` : ''}
        <div class="project-card-icon">🏪</div>
        <div class="project-card-info">
          <span class="project-card-name" title="${displayName}">${displayName}</span>
          <div class="project-card-meta">
            <span>📍 ${project.location || '-'}</span>
            <span>📋 ${projectScans.length} records</span>
          </div>
        </div>
        <div class="project-card-actions">
          ${!isSelectionMode ? `
            <button class="project-card-btn move-to-folder" title="Move to Folder">📁</button>
            <button class="project-card-btn rename-project" title="Rename project">✏️</button>
          <button class="project-card-btn open-project" title="Open project">→</button>
          <button class="project-card-btn delete" title="Delete project">🗑️</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners
  projectsList.querySelectorAll('.project-card').forEach(card => {
    const projectId = card.dataset.projectId;
    
    if (isSelectionMode) {
      // Selection mode: checkbox click
      const checkbox = card.querySelector('.project-checkbox');
      if (checkbox) {
        checkbox.addEventListener('change', (e) => {
          if (e.target.checked) {
            selectedProjectIds.add(projectId);
          } else {
            selectedProjectIds.delete(projectId);
          }
          updateSelectionUI();
        });
      }
      
      // Card click to toggle selection
      card.addEventListener('click', (e) => {
        if (e.target.closest('.project-checkbox')) return;
        const checkbox = card.querySelector('.project-checkbox');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        }
      });
    } else {
      // Normal mode: action buttons
    card.querySelector('.open-project')?.addEventListener('click', (e) => {
      e.stopPropagation();
        // Mark that we came from projects list
        sessionStorage.setItem('cameFromProjectsList', 'true');
      setActiveProject(projectId);
      openProjectMenu();
      // CRITICAL FIX: Ensure table is refreshed when switching projects
      setTimeout(() => {
        renderTable();
      }, 200);
    });

      card.querySelector('.move-to-folder')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openMoveToFolderModal(projectId);
      });

      card.querySelector('.rename-project')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openRenameModal(projectId);
    });

    card.querySelector('.delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this project? Scan records will be preserved.')) {
        deleteProject(projectId);
          removeProjectFromFolder(projectId);
        
        // Ask if user also wants to delete associated scans and photos
        if (confirm('Also delete all scans and photos associated with this project?')) {
          await deleteScansByProjectId(projectId);
        }
        
        renderProjectsList();
      }
    });

    // Clicking the card also opens the project
    card.addEventListener('click', (e) => {
        // Don't open if clicking on buttons
        if (e.target.closest('.project-card-actions')) return;
      e.preventDefault();
      e.stopPropagation();
        // Mark that we came from projects list
        sessionStorage.setItem('cameFromProjectsList', 'true');
      setActiveProject(projectId);
      openProjectMenu();
      // CRITICAL FIX: Ensure table is refreshed when switching projects
      setTimeout(() => {
        renderTable();
      }, 200);
    });
    }
  });
}

// Open rename modal
function openRenameModal(projectId) {
  const modal = document.getElementById('renameProjectModal');
  const input = document.getElementById('renameProjectInput');
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  
  if (!modal || !input || !project) return;
  
  input.value = project.name || project.type || '';
  modal.classList.remove('hidden');
  
  // Focus input
  setTimeout(() => input.focus(), 100);
  
  // Save rename
  const saveBtn = document.getElementById('saveRenameBtn');
  const cancelBtn = document.getElementById('cancelRenameBtn');
  const closeBtn = document.getElementById('closeRenameModal');
  
  const closeModal = () => modal.classList.add('hidden');
  
  const saveRename = () => {
    const newName = input.value.trim();
    if (newName && newName !== project.name) {
      project.name = newName;
      saveProjects();
      renderProjectsList();
    }
    closeModal();
  };
  
  // Remove old listeners
  const newSaveBtn = saveBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  const newCloseBtn = closeBtn.cloneNode(true);
  
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
  
  newSaveBtn.addEventListener('click', saveRename);
  newCancelBtn.addEventListener('click', closeModal);
  newCloseBtn.addEventListener('click', closeModal);
  
  input.onkeypress = (e) => {
    if (e.key === 'Enter') saveRename();
    if (e.key === 'Escape') closeModal();
  };
}

// Open create folder modal
function openCreateFolderModal() {
  const modal = document.getElementById('createFolderModal');
  const input = document.getElementById('folderNameInput');
  
  if (!modal || !input) return;
  
  input.value = '';
  modal.classList.remove('hidden');
  
  setTimeout(() => input.focus(), 100);
  
  const saveBtn = document.getElementById('saveFolderBtn');
  const cancelBtn = document.getElementById('cancelFolderBtn');
  const closeBtn = document.getElementById('closeFolderModal');
  
  const closeModal = () => modal.classList.add('hidden');
  
  const saveFolder = () => {
    const folderName = input.value.trim();
    if (folderName) {
      // Create folder by adding an empty array
      const folders = loadFolders();
      if (!folders[folderName]) {
        folders[folderName] = [];
        saveFolders(folders);
        // Refresh the list to show new folder at top
        renderProjectsList();
      } else {
        alert(`Folder "${folderName}" already exists.`);
      }
    }
    closeModal();
  };
  
  const newSaveBtn = saveBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  const newCloseBtn = closeBtn.cloneNode(true);
  
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
  
  newSaveBtn.addEventListener('click', saveFolder);
  newCancelBtn.addEventListener('click', closeModal);
  newCloseBtn.addEventListener('click', closeModal);
  
  input.onkeypress = (e) => {
    if (e.key === 'Enter') saveFolder();
    if (e.key === 'Escape') closeModal();
  };
}

// Delete selected projects
async function deleteSelectedProjects() {
  if (selectedProjectIds.size === 0) {
    alert('Please select at least one project');
    return;
  }

  const projectCount = selectedProjectIds.size;
  const projectIdsArray = Array.from(selectedProjectIds);
  
  // Get project names for confirmation message
  const projects = loadProjects();
  const selectedProjects = projectIdsArray.map(id => projects.find(p => p.id === id)).filter(Boolean);
  const projectNames = selectedProjects.map(p => {
    let name = p.name || p.type || 'Untitled';
    name = name.replace(/\s*-\s*\d{4}-\d{2}-\d{2}$/, '').trim();
    return name;
  }).slice(0, 3); // Show first 3 names
  
  const namesList = projectNames.length > 0 
    ? `\n\nProjects: ${projectNames.join(', ')}${projectCount > 3 ? ` and ${projectCount - 3} more...` : ''}`
    : '';
  
  // Confirm deletion
  if (!confirm(`Delete ${projectCount} project${projectCount !== 1 ? 's' : ''}? Scan records will be preserved.${namesList}`)) {
    return;
  }
  
  // Ask if user also wants to delete associated scans and photos
  let deleteScans = false;
  if (confirm(`Also delete all scans and photos associated with these ${projectCount} project${projectCount !== 1 ? 's' : ''}?`)) {
    deleteScans = true;
  }
  
  // Delete each project
  const activeProjectId = getActiveProjectId();
  let deletedActiveProject = false;
  
  for (const projectId of projectIdsArray) {
    // Check if this is the active project
    if (projectId === activeProjectId) {
      deletedActiveProject = true;
      setActiveProject(null);
    }
    
    // Delete project
    deleteProject(projectId);
    removeProjectFromFolder(projectId);
    
    // Delete scans and photos if requested
    if (deleteScans) {
      await deleteScansByProjectId(projectId);
    }
  }
  
  // Exit selection mode
  exitSelectionMode();
  
  // Refresh the list
  renderProjectsList();
  
  // Show success message
  const message = `Successfully deleted ${projectCount} project${projectCount !== 1 ? 's' : ''}.${deleteScans ? ' Scans and photos were also deleted.' : ' Scan records were preserved.'}`;
  alert(message);
}

// Toggle selection mode
function toggleSelectionMode() {
  isSelectionMode = !isSelectionMode;
  if (!isSelectionMode) {
    exitSelectionMode();
  } else {
    enterSelectionMode();
  }
}

// Enter selection mode
function enterSelectionMode() {
  isSelectionMode = true;
  selectedProjectIds.clear();
  const selectModeBtn = document.getElementById('selectModeBtn');
  const selectionToolbar = document.getElementById('selectionToolbar');
  
  if (selectModeBtn) {
    selectModeBtn.textContent = '✕ Cancel';
    selectModeBtn.title = 'Cancel Selection';
  }
  
  if (selectionToolbar) {
    selectionToolbar.classList.remove('hidden');
  }
  
  updateSelectionUI();
  renderProjectsList();
}

// Exit selection mode
function exitSelectionMode() {
  isSelectionMode = false;
  selectedProjectIds.clear();
  const selectModeBtn = document.getElementById('selectModeBtn');
  const selectionToolbar = document.getElementById('selectionToolbar');
  
  if (selectModeBtn) {
    selectModeBtn.textContent = '✓ Select';
    selectModeBtn.title = 'Select Projects';
  }
  
  if (selectionToolbar) {
    selectionToolbar.classList.add('hidden');
  }
  
  renderProjectsList();
}

// Update selection UI
function updateSelectionUI() {
  const selectedCount = document.getElementById('selectedCount');
  const moveSelectedBtn = document.getElementById('moveSelectedBtn');
  
  if (selectedCount) {
    selectedCount.textContent = `${selectedProjectIds.size} selected`;
  }
  
  if (moveSelectedBtn) {
    moveSelectedBtn.disabled = selectedProjectIds.size === 0;
  }
}

// Open move selected projects to folder modal
function openMoveSelectedToFolderModal() {
  const modal = document.getElementById('moveToFolderModal');
  const select = document.getElementById('moveToFolderSelect');
  const modalTitle = modal?.querySelector('h3');
  
  if (!modal || !select) return;
  
  // Update modal title
  if (modalTitle) {
    modalTitle.textContent = `Move ${selectedProjectIds.size} Project${selectedProjectIds.size > 1 ? 's' : ''} to Folder`;
  }
  
  // Load folders
  const folders = getAllFolders();
  select.innerHTML = '<option value="">No Folder</option>';
  folders.forEach(folder => {
    const option = document.createElement('option');
    option.value = folder;
    option.textContent = `📁 ${folder}`;
    select.appendChild(option);
  });
  
  // Show modal
  modal.classList.remove('hidden');
  
  // Handle save
  const saveBtn = modal.querySelector('.btn-primary');
  const newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  
  newSaveBtn.addEventListener('click', () => {
    const folderName = select.value;
    
    // Move all selected projects to folder
    selectedProjectIds.forEach(projectId => {
      if (folderName) {
        addProjectToFolder(projectId, folderName);
      } else {
        removeProjectFromFolder(projectId);
      }
    });
    
    // Close modal and exit selection mode
    modal.classList.add('hidden');
    exitSelectionMode();
  });
  
  // Handle cancel
  const cancelBtn = modal.querySelector('.btn-secondary');
  const newCancelBtn = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  
  newCancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });
}

// Open move to folder modal
function openMoveToFolderModal(projectId) {
  const modal = document.getElementById('moveToFolderModal');
  const select = document.getElementById('moveToFolderSelect');
  const modalTitle = modal?.querySelector('h3');
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  
  if (!modal || !select || !project) return;
  
  // Reset modal title
  if (modalTitle) {
    modalTitle.textContent = 'Move to Folder';
  }
  
  // Get current folder
  const currentFolder = getProjectFolder(projectId);
  
  // Populate folder select
  const folders = getAllFolders();
  select.innerHTML = `
    <option value="">No Folder (Remove from folder)</option>
    ${folders.map(folder => `
      <option value="${folder}" ${folder === currentFolder ? 'selected' : ''}>${folder}</option>
    `).join('')}
  `;
  
  modal.classList.remove('hidden');
  
  const saveBtn = document.getElementById('saveMoveToFolderBtn');
  const cancelBtn = document.getElementById('cancelMoveToFolderBtn');
  const closeBtn = document.getElementById('closeMoveToFolderModal');
  
  const closeModal = () => modal.classList.add('hidden');
  
  const saveMove = () => {
    const selectedFolder = select.value.trim();
    
    // Remove from current folder first
    removeProjectFromFolder(projectId);
    
    // Add to new folder if selected
    if (selectedFolder) {
      addProjectToFolder(projectId, selectedFolder);
    }
    
    renderProjectsList();
    closeModal();
  };
  
  // Remove old listeners
  const newSaveBtn = saveBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  const newCloseBtn = closeBtn.cloneNode(true);
  
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
  
  newSaveBtn.addEventListener('click', saveMove);
  newCancelBtn.addEventListener('click', closeModal);
  newCloseBtn.addEventListener('click', closeModal);
  
  select.onkeypress = (e) => {
    if (e.key === 'Enter') saveMove();
    if (e.key === 'Escape') closeModal();
  };
}

// Track if we're editing an existing project
let isEditingProject = false;
let editingProjectId = null;

function editCurrentProjectSettings() {
  const project = getActiveProject();
  if (!project) {
    alert('No active project found');
    return;
  }

  // Set edit mode
  isEditingProject = true;
  editingProjectId = project.id;

  // Populate form with current project data
  const projectDate = document.getElementById('projectDate');
  const projectEmail = document.getElementById('projectEmail');
  const projectLocation = document.getElementById('projectLocation');
  const projectEnvironment = document.getElementById('projectEnvironment');
  const projectSyncEnabled = document.getElementById('projectSyncEnabled');
  const defaultHouseNo = document.getElementById('defaultHouseNo');
  const defaultStreet = document.getElementById('defaultStreet');
  const defaultFloor = document.getElementById('defaultFloor');
  const defaultBuilding = document.getElementById('defaultBuilding');
  const defaultPostcode = document.getElementById('defaultPostcode');
  const sheetTabPreview = document.getElementById('sheetTabPreview');
  const submitBtn = document.querySelector('#projectSettingsForm button[type="submit"]');

  if (projectDate) projectDate.value = project.date || '';
  if (projectEmail) projectEmail.value = project.email || '';
  if (projectLocation) {
    projectLocation.value = project.location || '';
    // Disable location field when editing - it should not be changed
    projectLocation.disabled = true;
    projectLocation.title = 'Location cannot be changed after project creation';
  }
  if (projectEnvironment) projectEnvironment.value = project.environment || 'Indoor';
  if (projectSyncEnabled) projectSyncEnabled.checked = project.syncEnabled !== false;
  if (defaultHouseNo) defaultHouseNo.value = project.defaultAddress?.houseNo || '';
  if (defaultStreet) defaultStreet.value = project.defaultAddress?.street || '';
  if (defaultFloor) defaultFloor.value = project.defaultAddress?.floor || '';
  if (defaultBuilding) defaultBuilding.value = project.defaultAddress?.building || '';
  if (defaultPostcode) defaultPostcode.value = project.defaultAddress?.postcode || '';
  if (sheetTabPreview) sheetTabPreview.textContent = project.sheetTab || project.location || '-';
  if (submitBtn) submitBtn.textContent = 'Save Changes →';

  // Show the project settings screen
  setActiveScreen(screens.projectSettings);
}

function ensureCameraReady() {
  if (cameraInitialized) return cameraInitPromise || Promise.resolve();
  if (cameraInitPromise) return cameraInitPromise;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusDiv.textContent = 'Camera not supported on this device.';
    return Promise.resolve();
  }
  cameraInitPromise = initCamera().finally(() => {
    cameraInitPromise = null;
  });
  return cameraInitPromise;
}

function ensureLocationReady() {
  if (locationInitialized) return locationInitPromise || Promise.resolve();
  if (locationInitPromise) return locationInitPromise;
  locationInitPromise = requestLocationPermission().finally(() => {
    locationInitialized = true;
    locationInitPromise = null;
  });
  return locationInitPromise;
}

// Extract structured JSON directly from an image using GPT-4o Vision
async function extractInfoVision(imageUrl) {
  if (!hasOpenAIProxy()) return null;
  try {
    const resp = await callOpenAIProxy('/v1/responses', {
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content:
            'Extract JSON with keys: storeName, storeNameSecondary, unitNumber, address, category from this storefront image. The image may contain text in any language (English, Chinese, Malay, Tamil, Japanese, Korean, etc.). Extract the information accurately regardless of the language used.\n\nLANGUAGE HANDLING RULES:\n1. If the storefront shows the SAME store name in BOTH English and another language (e.g., "Starbucks" and "星巴克"):\n   - storeName: Use the English version (primary)\n   - storeNameSecondary: Use the non-English version (secondary)\n\n2. If the storefront shows DIFFERENT names in different languages (e.g., "Coffee Shop" in English and "咖啡店" in Chinese):\n   - storeName: Use the English name (primary)\n   - storeNameSecondary: Use the non-English name (secondary)\n\n3. If the storefront contains ONLY non-English text:\n   - storeName: Use the non-English text (primary)\n   - storeNameSecondary: Leave empty or omit the key\n\n4. If the storefront contains ONLY English text:\n   - storeName: Use the English text (primary)\n   - storeNameSecondary: Leave empty or omit the key\n\nFor category, choose the most appropriate from: Art, Attractions, Auto, Beauty Services, Commercial Building, Education, Essentials, Financial, Food and Beverage, General Merchandise, Government Building, Healthcare, Home Services, Hotel, Industrial, Local Services, Mass Media, Nightlife, Physical Feature, Professional Services, Religious Organization, Residential, Sports and Fitness, Travel. Use "Not Found" if unknown.'
        },
        {
          role: 'user',
          content: [{ type: 'input_image', image_url: imageUrl }]
        }
      ]
    });
    const txt = resp?.output_text
      ?? resp?.output?.map(chunk => chunk?.content?.map?.(piece => piece?.text).filter(Boolean).join(' ')).filter(Boolean).join('\n')
      ?? '';
    const match = txt.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      // Combine storeName and storeNameSecondary if both exist
      if (parsed.storeName && parsed.storeNameSecondary) {
        parsed.storeName = `${parsed.storeName} / ${parsed.storeNameSecondary}`;
      } else if (parsed.storeNameSecondary && !parsed.storeName) {
        // If only secondary exists, make it primary
        parsed.storeName = parsed.storeNameSecondary;
      }
      // Remove storeNameSecondary as we've combined it
      delete parsed.storeNameSecondary;
      return parsed;
    }
    return null;
  } catch (err) {
    console.warn('Vision JSON extraction failed', err);
    return null;
  }
}

// Extract house number from a residential property image using GPT-4o Vision
async function extractResidentialInfoVision(imageUrl) {
  if (!hasOpenAIProxy()) return null;
  try {
    const resp = await callOpenAIProxy('/v1/responses', {
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: `You are analyzing an image of a residential property (landed house, terrace, bungalow, semi-detached, etc.).

Your task is to extract the HOUSE NUMBER from this image.

Look for the house number in these common locations:
1. On the gate or fence
2. On the mailbox
3. On the front wall or facade of the house
4. On a signpost or pillar near the entrance
5. On the door or door frame
6. On any visible address plate or number plate

The house number is typically:
- A number (e.g., "5", "123", "45A")
- May include letters (e.g., "12B", "5-1", "No. 7")
- May be displayed in various fonts, sizes, and materials

Return ONLY a JSON object with this structure:
{
  "houseNumber": "the house number found",
  "confidence": "high" or "medium" or "low",
  "location": "where you found the number (e.g., 'on gate', 'on mailbox', 'on wall')"
}

If you cannot find any house number, return:
{
  "houseNumber": null,
  "confidence": "none",
  "location": null
}

Important: Extract ONLY the house number. Do not extract street names, postal codes, or any other address components.`
        },
        {
          role: 'user',
          content: [{ type: 'input_image', image_url: imageUrl }]
        }
      ]
    });
    const txt = resp?.output_text
      ?? resp?.output?.map(chunk => chunk?.content?.map?.(piece => piece?.text).filter(Boolean).join(' ')).filter(Boolean).join('\n')
      ?? '';
    const match = txt.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      console.log('🏠 Residential extraction result:', parsed);
      return parsed;
    }
    return null;
  } catch (err) {
    console.warn('Residential vision extraction failed', err);
    return null;
  }
}

// Extract opening hours from an image using GPT-4o Vision
async function extractOpeningHours(imageUrl) {
  if (!hasOpenAIProxy()) return null;
  try {
    const resp = await callOpenAIProxy('/v1/responses', {
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: `Extract opening hours from this image and format them in a standardized 24-hour format. The image may contain text in any language (English, Chinese, Malay, Tamil, Japanese, Korean, etc.). Extract the opening hours accurately regardless of the language used.
Return a JSON object with an "openingHours" string. Format each day as: "Day (HH:MM-HH:MM)"
Examples:
- "Mon (09:00-21:00)"
- "Tues (07:00-21:00)"
- "Wed (09:00-12:00)"
- "Thu (00:00-23:59)" (for 24 hours)
- "Fri (Closed)" (if closed)

If multiple time ranges exist for a day, combine them: "Mon (09:00-12:00, 14:00-18:00)"
If the store is open 24 hours, use "00:00-23:59"
Parse common formats like "9am-9pm", "9:00 AM - 9:00 PM", "Mon-Fri 9-5", etc.
Return only valid JSON with the openingHours string. Each day should be on a new line.`
        },
        {
          role: 'user',
          content: [{ type: 'input_image', image_url: imageUrl }]
        }
      ]
    });
    const txt = resp?.output_text
      ?? resp?.output?.map(chunk => chunk?.content?.map?.(piece => piece?.text).filter(Boolean).join(' ')).filter(Boolean).join('\n')
      ?? '';
    const match = txt.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.openingHours || null;
    }
    return null;
  } catch (err) {
    console.warn('Opening hours extraction failed', err);
    return null;
  }
}

// Parse opening hours string into day objects for Google Sheets
function parseOpeningHoursForSheets(openingHoursString) {
  if (!openingHoursString || typeof openingHoursString !== 'string') {
    return {
      Mon: '',
      Tue: '',
      Wed: '',
      Thu: '',
      Fri: '',
      Sat: '',
      Sun: ''
    };
  }

  const days = {
    Mon: '',
    Tue: '',
    Wed: '',
    Thu: '',
    Fri: '',
    Sat: '',
    Sun: ''
  };

  // Split by newlines and parse each line
  const lines = openingHoursString.split('\n').filter(line => line.trim());
  
  lines.forEach(line => {
    // Match patterns like "Mon (09:00-21:00)" or "Monday (9am-9pm)"
    const dayMatch = line.match(/^(Mon|Monday|Tue|Tuesday|Tues|Wed|Wednesday|Thu|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday)\s*\((.+)\)/i);
    if (dayMatch) {
      const dayName = dayMatch[1].toLowerCase();
      const timeRange = dayMatch[2].trim();
      
      // Map day names to abbreviations
      let dayKey = '';
      if (dayName.startsWith('mon')) dayKey = 'Mon';
      else if (dayName.startsWith('tue')) dayKey = 'Tue';
      else if (dayName.startsWith('wed')) dayKey = 'Wed';
      else if (dayName.startsWith('thu')) dayKey = 'Thu';
      else if (dayName.startsWith('fri')) dayKey = 'Fri';
      else if (dayName.startsWith('sat')) dayKey = 'Sat';
      else if (dayName.startsWith('sun')) dayKey = 'Sun';
      
      if (dayKey && timeRange.toLowerCase() !== 'closed') {
        // Normalize time format to HH:MM-HH:MM
        const normalizedTime = normalizeTimeRange(timeRange);
        days[dayKey] = normalizedTime;
      } else if (dayKey) {
        days[dayKey] = 'Closed';
      }
    }
  });

  return days;
}

// Normalize time range to HH:MM-HH:MM format
function normalizeTimeRange(timeRange) {
  // Handle multiple ranges like "09:00-12:00, 14:00-18:00"
  const ranges = timeRange.split(',').map(r => r.trim());
  const normalizedRanges = ranges.map(range => {
    // Match various time formats
    const timeMatch = range.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/i);
    if (timeMatch) {
      let startHour = parseInt(timeMatch[1]);
      let startMin = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const startPeriod = timeMatch[3];
      let endHour = parseInt(timeMatch[4]);
      let endMin = timeMatch[5] ? parseInt(timeMatch[5]) : 0;
      const endPeriod = timeMatch[6];

      // Convert to 24-hour format
      if (startPeriod && startPeriod.toLowerCase() === 'pm' && startHour !== 12) startHour += 12;
      if (startPeriod && startPeriod.toLowerCase() === 'am' && startHour === 12) startHour = 0;
      if (endPeriod && endPeriod.toLowerCase() === 'pm' && endHour !== 12) endHour += 12;
      if (endPeriod && endPeriod.toLowerCase() === 'am' && endHour === 12) endHour = 0;

      return `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}-${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
    }
    
    // Already in HH:MM-HH:MM format
    if (range.match(/^\d{2}:\d{2}-\d{2}:\d{2}$/)) {
      return range;
    }
    
    return range; // Return as-is if can't parse
  });

  return normalizedRanges.join(', ');
}
const video = document.getElementById('camera');
const statusDiv = document.getElementById('status');
const tableBody = document.querySelector('#resultsTable tbody');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
// --- NEW: Scanning overlay elements ---
const scanningOverlay = document.getElementById('scanningOverlay');
const scanningText = document.querySelector('.scanning-text');
// --- NEW: Zoom control elements ---
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomResetBtn = document.getElementById('zoomReset');
const zoomLevelSpan = document.getElementById('zoomLevel');

// Batch upload elements
const batchUploadBtn = document.getElementById('batchUploadBtn');
let batchImageInput = document.getElementById('batchImageInput'); // Use let to allow re-assignment for Android reset
const batchStatusDiv = document.getElementById('batchStatus');
let batchTableBody = document.querySelector('#batchResultsTable tbody'); // Use let instead of const to allow re-assignment

// Progress indicator elements
const batchProgressContainer = document.getElementById('batchProgressContainer');
const batchProgressText = document.getElementById('batchProgressText');
const batchProgressTime = document.getElementById('batchProgressTime');
const batchProgressFill = document.getElementById('batchProgressFill');
const batchProgressPercent = document.getElementById('batchProgressPercent');
const batchProgressCurrent = document.getElementById('batchProgressCurrent');
const batchProgressTotal = document.getElementById('batchProgressTotal');

// Progress tracking
let batchProcessingStartTime = null;
let batchProcessingTimes = []; // Track processing times for estimation
const AVERAGE_PROCESSING_TIME_MS = 8000; // Average 8 seconds per photo (will be updated dynamically)

// Persistent scans storage
let scans = [];
let batchScans = [];
// --- Networking helpers and timeouts ---
const GEO_FAST_TIMEOUT_MS = 3000; // 3s fast location for scans
const REVERSE_TIMEOUT_MS = 4000;  // 4s for reverse geocode

async function fetchWithTimeout(url, { timeoutMs, ...options } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs || 5000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}


// Photo storage and deferred save utilities
const PHOTO_DB_NAME = 'bnsv_photo_db';
const PHOTO_STORE = 'photos';
const THUMBNAIL_STORE = 'thumbnails'; // Separate store for thumbnails
let saveScansScheduled = false;
let saveScansTimeout = null;

function scheduleSaveScans() {
  // Clear any pending save
  if (saveScansTimeout) {
    clearTimeout(saveScansTimeout);
    saveScansTimeout = null;
  }
  
  // If a save is already scheduled, just reschedule it (debounce)
  if (saveScansScheduled) {
    saveScansTimeout = setTimeout(() => {
      saveScansScheduled = false;
      scheduleSaveScans();
    }, 100);
    return;
  }
  
  saveScansScheduled = true;
  
  // Use immediate save with a small delay to batch rapid saves
  // This ensures we always save the latest state
  saveScansTimeout = setTimeout(() => {
    try {
      // CRITICAL FIX: Always save the current state of scans array
      // Create a fresh copy and ensure photoData is removed to save localStorage space
      const scansToSave = Array.isArray(scans) ? scans.map(scan => {
        if (!scan) return scan;
        // Remove photoData and photoDataUrl before saving
        const cleanScan = { ...scan };
        delete cleanScan.photoData;
        delete cleanScan.photoDataUrl;
        return cleanScan;
      }) : [];
      
      const scansJson = JSON.stringify(scansToSave);
      const sizeInMB = new Blob([scansJson]).size / (1024 * 1024);
      localStorage.setItem('scans', scansJson);
      console.log(`💾 Saved ${scansToSave.length} scans to localStorage (${sizeInMB.toFixed(2)}MB)`);
    } catch (error) {
      console.error('❌ Failed to save scans:', error);
      // Try to save a backup
      try {
        const backupKey = 'scans_backup_' + Date.now();
        // Also clean backup before saving
        const cleanScans = scans.map(scan => {
          if (!scan) return scan;
          const cleanScan = { ...scan };
          delete cleanScan.photoData;
          delete cleanScan.photoDataUrl;
          return cleanScan;
        });
        localStorage.setItem(backupKey, JSON.stringify(cleanScans));
        console.log(`💾 Created backup at ${backupKey}`);
      } catch (backupError) {
        console.error('❌ Failed to create backup:', backupError);
      }
    } finally {
      saveScansScheduled = false;
      saveScansTimeout = null;
    }
  }, 50); // Small delay to batch rapid saves, but still save quickly
}

// Sanitize helpers: convert placeholders like "Not Found"/"Unknown" to blanks
function sanitizeString(value) {
  const v = (value == null ? '' : String(value)).trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (lower === 'not found' || lower === 'unknown' || lower === 'n/a') return '';
  return v;
}

function sanitizeObjectStrings(obj) {
  const out = { ...obj };
  for (const key in out) {
    if (typeof out[key] === 'string') {
      out[key] = sanitizeString(out[key]);
    }
  }
  return out;
}

function openPhotoDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB_NAME, 2); // Increment version to add thumbnail store
    req.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
      }
      // Add thumbnail store if it doesn't exist
      if (!db.objectStoreNames.contains(THUMBNAIL_STORE)) {
        db.createObjectStore(THUMBNAIL_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePhotoBlob(photoId, blob, filename) {
  try {
    const db = await openPhotoDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore(PHOTO_STORE).put({ id: photoId, blob, filename });
    });
  } catch (_) { /* ignore */ }
}

async function getPhotoBlob(photoId) {
  try {
    const db = await openPhotoDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readonly');
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(PHOTO_STORE).get(photoId);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return null;
  }
}

// Save thumbnail to IndexedDB (separate from full-res photo)
async function saveThumbnail(photoId, thumbnailDataUrl) {
  try {
    if (!photoId || !thumbnailDataUrl) return;
    
    // Convert data URL to blob
    const response = await fetch(thumbnailDataUrl);
    const blob = await response.blob();
    
    const db = await openPhotoDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(THUMBNAIL_STORE, 'readwrite');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore(THUMBNAIL_STORE).put({ id: photoId, blob });
    });
    console.log(`💾 Saved thumbnail to IndexedDB: ${photoId}`);
  } catch (error) {
    console.error('❌ Failed to save thumbnail:', error);
  }
}

// Get thumbnail from IndexedDB
async function getThumbnail(photoId) {
  try {
    if (!photoId) return null;
    
    const db = await openPhotoDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(THUMBNAIL_STORE, 'readonly');
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(THUMBNAIL_STORE).get(photoId);
      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          // Convert blob to data URL
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(req.result.blob);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error('❌ Failed to get thumbnail:', error);
    return null;
  }
}

// Delete a photo and its thumbnail from IndexedDB
async function deletePhotoFromIndexedDB(photoId) {
  if (!photoId) return;
  
  try {
    const db = await openPhotoDB();
    
    // Delete from both stores
    const tx = db.transaction([PHOTO_STORE, THUMBNAIL_STORE], 'readwrite');
    
    await Promise.all([
      new Promise((resolve, reject) => {
        const photoReq = tx.objectStore(PHOTO_STORE).delete(photoId);
        photoReq.onsuccess = () => resolve();
        photoReq.onerror = () => reject(photoReq.error);
      }),
      new Promise((resolve, reject) => {
        const thumbReq = tx.objectStore(THUMBNAIL_STORE).delete(photoId);
        thumbReq.onsuccess = () => resolve();
        thumbReq.onerror = () => reject(thumbReq.error);
      })
    ]);
    
    console.log(`🗑️ Deleted photo ${photoId} from IndexedDB`);
  } catch (error) {
    console.error(`❌ Failed to delete photo ${photoId} from IndexedDB:`, error);
  }
}

// Delete all scans for a project and their associated photos from IndexedDB
async function deleteScansByProjectId(projectId) {
  if (!projectId) return;
  
  try {
    const allScans = loadScans();
    const projectScans = allScans.filter(scan => scan.projectId === projectId);
    
    // Collect all photoIds
    const photoIds = projectScans
      .map(scan => scan.photoId)
      .filter(id => id); // Remove null/undefined
    
    // Delete photos from IndexedDB
    for (const photoId of photoIds) {
      await deletePhotoFromIndexedDB(photoId);
    }
    
    // Remove scans from localStorage
    const remainingScans = allScans.filter(scan => scan.projectId !== projectId);
    saveScans(remainingScans);
    
    console.log(`🗑️ Deleted ${projectScans.length} scans and ${photoIds.length} photos for project ${projectId}`);
  } catch (error) {
    console.error(`❌ Failed to delete scans for project ${projectId}:`, error);
  }
}

function createThumbnailDataURL(sourceCanvas, maxWidth = 400, maxHeight = 400, quality = 0.6) {
  // Validate canvas has content
  if (!sourceCanvas) {
    console.error('⚠️ Cannot create thumbnail: canvas is null/undefined');
    return '';
  }
  
  if (sourceCanvas.width === 0 || sourceCanvas.height === 0) {
    console.error('⚠️ Cannot create thumbnail: canvas dimensions are 0x0');
    return '';
  }
  
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  console.log(`📐 Creating thumbnail from canvas: ${w}x${h}`);
  
  const scale = Math.min(maxWidth / w, maxHeight / h, 1);
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  
  const thumb = document.createElement('canvas');
  thumb.width = outW;
  thumb.height = outH;
  const ctx = thumb.getContext('2d');
  
  try {
    ctx.drawImage(sourceCanvas, 0, 0, outW, outH);
    const dataUrl = thumb.toDataURL('image/jpeg', quality);
    
    if (!dataUrl || dataUrl.length === 0) {
      console.error('⚠️ toDataURL returned empty string');
      return '';
    }
    
    console.log(`✅ Thumbnail created: ${outW}x${outH}, data URL length: ${dataUrl.length}`);
    return dataUrl;
  } catch (err) {
    console.error('❌ Error creating thumbnail:', err);
    return '';
  }
}

// Migrate existing data to include photo fields if missing
function migrateScansData() {
  scans = scans.map(scan => {
    // Ensure all new fields exist with default values
    // CRITICAL: Do NOT preserve photoData - it should be removed to save localStorage space
    const migratedScan = {
      ...scan,
      timestamp: scan.timestamp || new Date().toISOString(),
      photoFilename: scan.photoFilename || null,
      houseNo: scan.houseNo || '',
      street: scan.street || '', 
      building: scan.building || '',
      postcode: scan.postcode || '',
      // CRITICAL FIX: Ensure projectId exists (migrate old scans)
      // Note: Old scans without projectId will show in "no project" view
      projectId: scan.projectId || null
    };
    // Explicitly remove photoData and photoDataUrl to save space
    delete migratedScan.photoData;
    delete migratedScan.photoDataUrl;
    return migratedScan;
  });
  saveScans();
}
// --- Scanning overlay helper functions ---
function showScanningOverlay(text = 'Scanning...') {
  if (scanningOverlay && scanningText) {
    scanningText.textContent = text;
    scanningOverlay.classList.add('show');
  }
}

function hideScanningOverlay() {
  if (scanningOverlay) {
    scanningOverlay.classList.remove('show');
  }
}

function showScanComplete() {
  if (scanningText) {
    scanningText.textContent = '✓ Done!';
    // Hide the spinner when done
    const spinner = document.querySelector('.spinner');
    if (spinner) {
      spinner.style.display = 'none';
    }
    // Hide overlay after 1.5 seconds
    setTimeout(() => {
      hideScanningOverlay();
      // Reset spinner visibility for next scan
      if (spinner) {
        spinner.style.display = 'block';
      }
    }, 1500);
  }
}

function showScanCompleteBanner(scanData) {
  // Remove any existing banner
  const existingBanner = document.querySelector('.scan-complete-banner');
  if (existingBanner) {
    existingBanner.remove();
  }

  // Create review banner element
  const banner = document.createElement('div');
  banner.className = 'scan-complete-banner scan-review-banner';
  
  let currentStoreName = scanData.storeName || 'Unknown Store';
  let currentUnitNumber = scanData.unitNumber || '';
  let currentOpeningHours = scanData.openingHours || '';
  let currentPhoneNumber = scanData.phoneNumber || '';
  let currentWebsite = scanData.website || '';
  let currentRemarks = scanData.remarks || '';
  
  // Build address string from components
  const addressParts = [];
  if (scanData.houseNo) addressParts.push(scanData.houseNo);
  if (scanData.street) addressParts.push(scanData.street);
  if (scanData.floor) addressParts.push(`Floor ${scanData.floor}`);
  if (scanData.building) addressParts.push(scanData.building);
  if (scanData.postcode) addressParts.push(scanData.postcode);
  const address = addressParts.length > 0 
    ? addressParts.join(', ') 
    : (scanData.address || 'No address');
  const photoUrl = scanData.photoData || '';
  const category = scanData.category || '';
  
  // Timer variables removed - no auto-accept
  
  const updateBannerContent = () => {
    const storeNameInput = banner.querySelector('#bannerStoreNameInput');
    const unitNumberInput = banner.querySelector('#bannerUnitNumberInput');
    const openingHoursDisplay = banner.querySelector('#bannerOpeningHoursDisplay');
    const phoneInput = banner.querySelector('#bannerPhoneInput');
    const websiteInput = banner.querySelector('#bannerWebsiteInput');
    const remarksInput = banner.querySelector('#bannerRemarksInput');
    
    if (storeNameInput) currentStoreName = storeNameInput.value;
    if (unitNumberInput) currentUnitNumber = unitNumberInput.value;
    if (phoneInput) currentPhoneNumber = phoneInput.value;
    if (websiteInput) currentWebsite = websiteInput.value;
    if (remarksInput) currentRemarks = remarksInput.value;
    
    if (openingHoursDisplay) {
      if (currentOpeningHours) {
        openingHoursDisplay.innerHTML = `<div class="opening-hours-preview">${currentOpeningHours.replace(/\n/g, '<br>')}</div>`;
      } else {
        openingHoursDisplay.innerHTML = '';
      }
    }
  };
  
  const showAddFields = () => {
    const addFieldsDiv = banner.querySelector('#bannerAddFields');
    const addBtn = banner.querySelector('#bannerAddBtn');
    if (addFieldsDiv && addBtn) {
      const isVisible = addFieldsDiv.style.display !== 'none';
      addFieldsDiv.style.display = isVisible ? 'none' : 'block';
      addBtn.textContent = isVisible ? '+' : '−';
      addBtn.classList.toggle('active', !isVisible);
    }
  };
  
  const showError = (message) => {
    // Use a custom notification instead of alert to avoid camera freeze on iOS
    const errorDiv = document.createElement('div');
    errorDiv.className = 'opening-hours-error';
    errorDiv.textContent = message;
    errorDiv.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #ff4444;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      z-index: 10001;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      animation: slideDown 0.3s ease;
    `;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
      if (errorDiv.parentElement) {
        errorDiv.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => {
          if (errorDiv.parentElement) {
            document.body.removeChild(errorDiv);
          }
        }, 300);
      }
    }, 3000);
  };
  
  const scanOpeningHours = async () => {
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      showError('Camera not ready. Please wait.');
      return;
    }

    // Capture current frame
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Show loading
    const openingHoursBtn = banner.querySelector('#scanOpeningHoursBtn');
    if (openingHoursBtn) {
      openingHoursBtn.disabled = true;
      openingHoursBtn.textContent = '⏳ Reading...';
    }

    try {
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const openingHours = await extractOpeningHours(imageDataUrl);
      
      if (openingHours) {
        currentOpeningHours = openingHours;
        updateBannerContent();
        if (openingHoursBtn) {
          openingHoursBtn.textContent = '🕐 Scan Opening Hours';
          openingHoursBtn.disabled = false;
        }
      } else {
        showError('Could not read opening hours. Please try again.');
        if (openingHoursBtn) {
          openingHoursBtn.textContent = '🕐 Scan Opening Hours';
          openingHoursBtn.disabled = false;
        }
      }
    } catch (error) {
      console.error('Error capturing opening hours:', error);
      showError('Error reading opening hours.');
      if (openingHoursBtn) {
        openingHoursBtn.textContent = '🕐 Scan Opening Hours';
        openingHoursBtn.disabled = false;
      }
    } finally {
      // Always ensure camera stream continues after scanning (especially important for iOS)
      setTimeout(() => {
        if (video) {
          if (!video.srcObject && window.currentCameraStream) {
            video.srcObject = window.currentCameraStream;
          }
          // Ensure video is playing
          if (video.paused) {
            video.play().catch(() => {}); // Ignore play errors
          }
          // Force video to resume on iOS
          if (window.currentCameraStream) {
            const tracks = window.currentCameraStream.getVideoTracks();
            tracks.forEach(track => {
              if (track.readyState === 'paused') {
                track.enabled = false;
                track.enabled = true;
              }
            });
          }
        }
      }, 100); // Small delay to ensure alert/error is dismissed first
    }
  };
  
  const acceptScan = async () => {
    // Update scanData with edited values
    updateBannerContent();
    scanData.storeName = currentStoreName;
    scanData.unitNumber = currentUnitNumber;
    scanData.openingHours = currentOpeningHours;
    scanData.phoneNumber = currentPhoneNumber;
    scanData.website = currentWebsite;
    scanData.remarks = currentRemarks;
    
    // Preserve photoData from banner if it exists (the banner image proves it was there)
    const bannerImg = banner.querySelector('.banner-thumbnail img');
    if (bannerImg && bannerImg.src && !scanData.photoData) {
      console.log('📸 Recovering photoData from banner image src');
      scanData.photoData = bannerImg.src;
    }
    
    // Debug: Check scanData before saving
    console.log('✅ Accepting scan - scanData check:', {
      entryId: scanData.entryId,
      storeName: scanData.storeName,
      unitNumber: scanData.unitNumber,
      openingHours: scanData.openingHours,
      hasPhotoData: !!scanData.photoData,
      photoDataLength: scanData.photoData ? scanData.photoData.length : 0,
      hasPhotoDataUrl: !!scanData.photoDataUrl,
      photoDataUrlLength: scanData.photoDataUrl ? scanData.photoDataUrl.length : 0,
      hasPhotoId: !!scanData.photoId,
      allKeys: Object.keys(scanData)
    });
    
    // REMOVED: No longer retrieving photoData from blob storage
    // photoData should remain empty - thumbnails are loaded on-demand from IndexedDB when needed for display
    // This prevents bloating localStorage with photo data
    
    // CRITICAL FIX: Ensure projectId is set before saving
    // Double-check projectId is set (in case it wasn't set during scan)
    if (!scanData.projectId) {
      const project = getActiveProject();
      if (project) {
        scanData.projectId = project.id;
        scanData.projectName = project.name;
        scanData.projectLocation = project.location;
        scanData.projectDate = project.date;
        scanData.projectEmail = project.email;
        console.log('⚠️ projectId was missing, assigned:', project.id);
      } else {
        console.warn('⚠️ Saving scan without projectId - no active project!');
      }
    }
    
    // CRITICAL: Save thumbnail to IndexedDB before removing photoData
    // This ensures thumbnails are available for display even after removing from localStorage
    if (scanData.photoId && scanData.photoData) {
      await saveThumbnail(scanData.photoId, scanData.photoData);
    }
    
    // OPTIMIZATION: Remove photoData from scan before saving to localStorage
    // Thumbnails are now stored in IndexedDB, reducing localStorage usage by ~99%
    const scanDataWithoutPhoto = { ...scanData };
    delete scanDataWithoutPhoto.photoData; // Remove thumbnail to save space
    delete scanDataWithoutPhoto.photoDataUrl; // Also remove photoDataUrl if present
    
    // Save scan to array (without photoData)
    scans.unshift(scanDataWithoutPhoto);
    sortScansNewestFirst();
    
    // CRITICAL FIX: Force immediate save to prevent data loss
    // Don't rely on scheduled save when adding new scans
    // CRITICAL: Ensure ALL scans have photoData removed before saving
    try {
      // Clean all scans before saving to ensure no photoData remains
      const cleanScans = scans.map(scan => {
        if (!scan) return scan;
        const cleanScan = { ...scan };
        delete cleanScan.photoData;
        delete cleanScan.photoDataUrl;
        return cleanScan;
      });
      
      const scansJson = JSON.stringify(cleanScans);
      const sizeInMB = new Blob([scansJson]).size / (1024 * 1024);
      
      // Check localStorage quota (Safari iOS has ~5MB limit)
      if (sizeInMB > 4.5) {
        console.warn(`⚠️ localStorage getting full: ${sizeInMB.toFixed(2)}MB`);
        alert(`⚠️ Warning: Storage is getting full (${sizeInMB.toFixed(2)}MB). Some data may not be saved. Consider exporting and clearing old data.`);
      }
      
      localStorage.setItem('scans', scansJson);
      console.log(`💾 Immediately saved scan (without thumbnail): ${scanData.entryId || scanData.storeName} (Total: ${scans.length} scans, ${sizeInMB.toFixed(2)}MB)`);
    } catch (error) {
      console.error('❌ Failed to immediately save scan:', error);
      
      // Check if it's a quota error
      if (error.name === 'QuotaExceededError' || error.code === 22) {
        const errorMsg = `❌ Storage Full!\n\nYour device's storage is full. The scan was NOT saved.\n\nPlease:\n1. Export your data\n2. Clear old scans\n3. Try again`;
        alert(errorMsg);
      } else {
        alert(`❌ Failed to save scan: ${error.message}\n\nThe scan may be lost. Please try again.`);
      }
    }
    
    renderTable();
    
    // Sync to Google Sheets if enabled
    syncToGoogleSheets(scanData).then(result => {
      const inserted = result.details?.inserted || 0;
      const updated = result.details?.updated || 0;
      const hasErrors = result.details?.errors && result.details.errors.length > 0;
      
      if (result.success && (inserted > 0 || updated > 0) && !hasErrors) {
        console.log(`✅ Synced to Google Sheets: ${inserted} inserted, ${updated} updated`);
        scanData.syncStatus = 'synced';
        
        // Store image link if returned from Drive upload
        if (result.details?.imageLinks && scanData.entryId) {
          const uploadedLink = result.details.imageLinks[scanData.entryId];
          if (uploadedLink) {
            scanData.imageLink = uploadedLink;
            console.log('📎 Image uploaded to Drive:', uploadedLink);
          }
        }
        
        saveScans();
        renderTable();
      } else if (result.reason === 'sync_disabled') {
        // Sync is disabled - show user-friendly message
        console.warn('⚠️ Sync is disabled for this project. Enable it in project settings to sync automatically.');
        scanData.syncStatus = 'pending'; // Keep as pending so user can manually sync later
        saveScans();
        renderTable();
        
        // Show brief notification to user
        if (statusDiv) {
          const originalText = statusDiv.textContent;
          statusDiv.textContent = '⚠️ Sync disabled - enable in project settings';
          statusDiv.style.color = '#ffa500';
          setTimeout(() => {
            statusDiv.textContent = originalText;
            statusDiv.style.color = '';
          }, 3000);
        }
      } else {
        // Sync failed or no records were inserted/updated
        const errorMsg = result.error || (hasErrors ? result.details.errors.map(e => e.error).join('; ') : 'No records inserted or updated');
        console.warn('⚠️ Google Sheets sync failed:', errorMsg);
        scanData.syncStatus = 'failed';
        saveScans();
        renderTable();
        
        // Show error notification
        if (statusDiv) {
          const originalText = statusDiv.textContent;
          statusDiv.textContent = `❌ Sync failed: ${errorMsg.substring(0, 50)}`;
          statusDiv.style.color = '#ff4d4d';
          setTimeout(() => {
            statusDiv.textContent = originalText;
            statusDiv.style.color = '';
          }, 5000);
        }
      }
    }).catch(error => {
      console.error('❌ Error during sync:', error);
      scanData.syncStatus = 'failed';
      saveScans();
      renderTable();
      
      // Show error notification
      if (statusDiv) {
        const originalText = statusDiv.textContent;
        statusDiv.textContent = `❌ Sync error: ${error.message}`;
        statusDiv.style.color = '#ff4d4d';
        setTimeout(() => {
          statusDiv.textContent = originalText;
          statusDiv.style.color = '';
        }, 5000);
      }
    });
    
    // Remove banner
    banner.remove();
    
    // Show success message briefly
    if (statusDiv) {
      statusDiv.textContent = '✅ Scan saved!';
      setTimeout(() => { statusDiv.textContent = ''; }, 2000);
    }
    
  };
  
  const rejectScan = () => {
    // Discard scan - don't save anything
    console.log('❌ Scan rejected by user');
    
    // Remove banner
    banner.remove();
    
    // Show rejection message briefly
    if (statusDiv) {
      statusDiv.textContent = '❌ Scan discarded';
      setTimeout(() => { statusDiv.textContent = ''; }, 2000);
    }
  };
  
  banner.innerHTML = `
    <div class="banner-header">
      <span class="banner-icon">✓</span>
      <span class="banner-title">Review Scan</span>
    </div>
    <div class="banner-content">
      ${photoUrl ? `<img src="${photoUrl}" class="banner-thumbnail" alt="Store photo">` : '<div class="banner-thumbnail" style="background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; font-size: 20px;">📷</div>'}
      <div class="banner-details">
        <div class="banner-field">
          <label>Name:</label>
          <input type="text" id="bannerStoreNameInput" class="banner-input" value="${currentStoreName}" placeholder="Store name">
        </div>
        <div class="banner-field">
          <label>Unit Number:</label>
          <input type="text" id="bannerUnitNumberInput" class="banner-input" value="${currentUnitNumber}" placeholder="Unit number">
        </div>
        ${category ? `<div class="banner-category">${category}</div>` : ''}
        <div class="banner-address">${address}</div>
        <div id="bannerOpeningHoursDisplay"></div>
      </div>
    </div>
    <div id="bannerAddFields" style="display: none; padding: 12px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 12px;">
      <div class="banner-field">
        <label>Phone Number:</label>
        <input type="text" id="bannerPhoneInput" class="banner-input" value="${currentPhoneNumber}" placeholder="Phone number">
      </div>
      <div class="banner-field">
        <label>Website:</label>
        <input type="text" id="bannerWebsiteInput" class="banner-input" value="${currentWebsite}" placeholder="Website URL">
      </div>
      <div class="banner-field">
        <label>Remarks:</label>
        <input type="text" id="bannerRemarksInput" class="banner-input" value="${currentRemarks}" placeholder="Remarks">
      </div>
    </div>
    <div class="review-actions">
      <button class="review-btn review-reject" id="rejectScanBtn">❌ Reject</button>
      <button class="review-btn review-accept" id="acceptScanBtn">✅ Accept</button>
    </div>
    <div class="review-extra-actions">
      <button class="review-btn-secondary" id="scanOpeningHoursBtn">🕐 Scan Opening Hours</button>
    </div>
    <button class="banner-add-btn" id="bannerAddBtn" title="Add Phone, Website, Remarks">+</button>
  `;
  
  // Add to page
  document.body.appendChild(banner);
  
  // Show banner with animation
  setTimeout(() => {
    banner.classList.add('show');
  }, 100);
  
  // Initialize opening hours display
  updateBannerContent();
  
  // Set up event listeners
  const acceptBtn = banner.querySelector('#acceptScanBtn');
  const rejectBtn = banner.querySelector('#rejectScanBtn');
  const scanOpeningHoursBtn = banner.querySelector('#scanOpeningHoursBtn');
  
  if (acceptBtn) {
    acceptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      acceptScan();
    });
  }
  
  if (rejectBtn) {
    rejectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      rejectScan();
    });
  }
  
  if (scanOpeningHoursBtn) {
    scanOpeningHoursBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      scanOpeningHours();
    });
  }
  
  // Add button for additional fields
  const addBtn = banner.querySelector('#bannerAddBtn');
  if (addBtn) {
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showAddFields();
    });
  }
  
  // Progress bar disabled - no auto-accept timer
  // Timer removed - user must manually accept/reject
}
try {
  const scansJson = localStorage.getItem('scans');
  if (scansJson) {
    scans = JSON.parse(scansJson);
    if (!Array.isArray(scans)) {
      console.warn('⚠️ Scans data is not an array, resetting');
      scans = [];
    } else {
      console.log(`📥 Loaded ${scans.length} scans from localStorage`);
    }
  } else {
    scans = [];
    console.log('📥 No scans found in localStorage, starting fresh');
  }
} catch (error) {
  console.error('❌ Failed to load scans from localStorage:', error);
  scans = [];
  // Try to load backup if available
  try {
    const backupKeys = Object.keys(localStorage).filter(k => k.startsWith('scans_backup_'));
    if (backupKeys.length > 0) {
      const latestBackup = backupKeys.sort().pop();
      const backupData = localStorage.getItem(latestBackup);
      scans = JSON.parse(backupData);
      console.log(`💾 Restored ${scans.length} scans from backup: ${latestBackup}`);
    }
  } catch (backupError) {
    console.error('❌ Failed to restore from backup:', backupError);
  }
}

// Ensure newest-first ordering by timestamp
function sortScansNewestFirst() {
  try {
    scans.sort((a, b) => {
      const at = Date.parse((a && a.timestamp) ? a.timestamp : 0);
      const bt = Date.parse((b && b.timestamp) ? b.timestamp : 0);
      return bt - at;
    });
  } catch (_) {}
}

// Migrate existing data to new structure
if (scans.length > 0) {
  migrateScansData();
}

// Background migration: move full-res photos to IndexedDB and keep thumbnails in localStorage
async function migrateExistingPhotosToIndexedDB() {
  let migratedCount = 0;
  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];
    if (!scan) continue;
    const hasInlinePhoto = scan.photoData && typeof scan.photoData === 'string' && scan.photoData.startsWith('data:image/');
    const alreadyMigrated = !!scan.photoId;
    if (!hasInlinePhoto || alreadyMigrated) continue;

    try {
      const timestamp = scan.timestamp || new Date().toISOString();
      const photoId = `photo_${timestamp.replace(/[:.]/g, '-').slice(0, -5)}_${Math.random().toString(36).slice(2,8)}`;
      // Use entryId-based filename if entryId exists, otherwise use old format
      const photoFilename = scan.photoFilename || (scan.entryId ? `${scan.entryId}.jpg` : `bnsVision_${scan.storeName || 'scan'}_${timestamp.replace(/[:.]/g, '-').slice(0, -5)}.jpg`);
      // Ensure entryId exists for old scans
      if (!scan.entryId) {
        scan.entryId = 'entry-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        // Update photoFilename to use entryId if it wasn't already set
        if (!scan.photoFilename) {
          scan.photoFilename = `${scan.entryId}.jpg`;
        }
      }

      // Convert data URL to Blob
      const res = await fetch(scan.photoData);
      const blob = await res.blob();
      await savePhotoBlob(photoId, blob, photoFilename);

      // Create thumbnail from existing image
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = scan.photoData;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const thumbDataUrl = createThumbnailDataURL(canvas, 400, 400, 0.6);

      // Save thumbnail to IndexedDB
      await saveThumbnail(photoId, thumbDataUrl);

      // Remove photoData from scan to save localStorage space
      scans[i] = {
        ...scan,
        photoId,
        photoFilename
        // photoData removed - now stored in IndexedDB
      };
      migratedCount++;
      // Yield to UI occasionally
      if (migratedCount % 3 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    } catch (_) {
      // Ignore individual migration failures
    }
  }
  if (migratedCount > 0) {
    console.log(`💾 Migrated ${migratedCount} thumbnails to IndexedDB and removed from localStorage`);
    saveScans();
    renderTable();
  }
}

// Migration function to remove photoData from existing scans (one-time migration)
// CRITICAL FIX: Now removes photoData from ALL scans, regardless of photoId
async function migrateRemovePhotoDataFromScans() {
  let migratedCount = 0;
  let thumbnailSavedCount = 0;
  
  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];
    if (!scan) continue;
    
    // Skip if already migrated (no photoData)
    if (!scan.photoData) continue;
    
    try {
      // If scan has photoId, try to save thumbnail to IndexedDB first
      if (scan.photoId && scan.photoData) {
        try {
          await saveThumbnail(scan.photoId, scan.photoData);
          thumbnailSavedCount++;
        } catch (thumbError) {
          console.warn(`Failed to save thumbnail for scan ${i}:`, thumbError);
          // Continue anyway - we'll still remove photoData
        }
      }
      
      // CRITICAL: Remove photoData from scan regardless of photoId
      // This saves localStorage space even if thumbnail couldn't be saved
      delete scan.photoData;
      delete scan.photoDataUrl;
      
      migratedCount++;
      
      // Yield to UI occasionally
      if (migratedCount % 10 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    } catch (error) {
      console.error(`Failed to migrate scan ${i}:`, error);
      // Still try to remove photoData even if migration failed
      try {
        delete scan.photoData;
        delete scan.photoDataUrl;
        migratedCount++;
      } catch (deleteError) {
        console.error(`Failed to delete photoData from scan ${i}:`, deleteError);
      }
    }
  }
  
  if (migratedCount > 0) {
    console.log(`💾 Removed photoData from ${migratedCount} scans${thumbnailSavedCount > 0 ? ` (${thumbnailSavedCount} thumbnails saved to IndexedDB)` : ''}`);
    saveScans();
    const sizeInMB = new Blob([JSON.stringify(scans)]).size / (1024 * 1024);
    console.log(`📊 localStorage size after migration: ${sizeInMB.toFixed(2)}MB`);
  }
}

// Kick off migrations shortly after load
setTimeout(() => { 
  migrateExistingPhotosToIndexedDB(); 
  // Also migrate to remove photoData from scans (save localStorage space)
  migrateRemovePhotoDataFromScans();
  // CRITICAL: Aggressive cleanup - remove photoData from ALL scans immediately
  cleanupAllPhotoData();
}, 500);

// Aggressive cleanup function: Remove photoData from ALL scans immediately
// This ensures no photoData remains in localStorage, regardless of migration status
function cleanupAllPhotoData() {
  let cleanedCount = 0;
  let hadPhotoData = false;
  
  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];
    if (!scan) continue;
    
    // Check if scan has photoData
    if (scan.photoData || scan.photoDataUrl) {
      hadPhotoData = true;
      delete scan.photoData;
      delete scan.photoDataUrl;
      cleanedCount++;
    }
  }
  
  if (hadPhotoData && cleanedCount > 0) {
    // Save cleaned scans immediately
    try {
      const scansJson = JSON.stringify(scans);
      localStorage.setItem('scans', scansJson);
      const sizeInMB = new Blob([scansJson]).size / (1024 * 1024);
      console.log(`🧹 Cleaned photoData from ${cleanedCount} scans. localStorage size: ${sizeInMB.toFixed(2)}MB`);
    } catch (error) {
      console.error('❌ Failed to save cleaned scans:', error);
    }
  }
}

// Sort once on load so newest entries appear first
sortScansNewestFirst();

renderTable();

function saveScans() {
  scheduleSaveScans();
}

function renderMobileCard(scan, idx, displayIdx, container, isNew = false) {
  const remarksValue = scan.remarks || '';
  const latLong = (scan.lat && scan.lng) 
    ? `${scan.lat}, ${scan.lng}` 
    : '';
  const houseNo = scan.houseNo || '';
  const street = scan.street || '';
  const building = scan.building || '';
  const postcode = scan.postcode || '';
  const floor = scan.floor || '';
  const environment = scan.environment || '-';
  const category = scan.category || '-';
  const imageLink = scan.imageLink || '';
  
  // Sync status
  const syncStatus = scan.syncStatus || 'pending';
  let syncIcon, syncTitle;
  if (syncStatus === 'synced') {
    syncIcon = '✅';
    syncTitle = 'Synced to Google Sheets';
  } else if (syncStatus === 'failed') {
    syncIcon = '❌';
    syncTitle = 'Sync failed - Click to retry';
  } else {
    syncIcon = '⏳';
    syncTitle = 'Pending sync';
  }
  
  // Photo - load from IndexedDB if not in scan
  let photoHTML = '';
  const photoId = scan.photoId;
  const hasPhotoData = scan.photoData && scan.photoData.trim() !== '';
  
  if (hasPhotoData) {
    photoHTML = `<img src="${scan.photoData}" alt="Store photo" class="mobile-card-photo" data-index="${idx}" data-photo-id="${photoId || ''}" style="object-fit: cover;">`;
  } else if (photoId) {
    // Load thumbnail from IndexedDB
    photoHTML = `<img src="" alt="Store photo" class="mobile-card-photo lazy-thumbnail-mobile" data-index="${idx}" data-photo-id="${photoId}" style="object-fit: cover;">`;
  } else {
    photoHTML = '<div class="mobile-card-photo">📷</div>';
  }
  
  const card = document.createElement('div');
  card.className = 'mobile-card';
  card.dataset.index = idx;
  card.dataset.scanEntryId = scan.entryId || '';
  card.dataset.scanId = scan.id || '';
  
  card.innerHTML = `
    <div class="mobile-card-header" style="cursor: pointer;">
      <div class="mobile-card-photo-wrapper">
      ${photoHTML}
        ${hasPhotoData || photoId ? `<button class="mobile-photo-download-btn" data-index="${idx}" title="Download photo" onclick="event.stopPropagation();">⬇️</button>` : ''}
      </div>
      <div class="mobile-card-title">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="mobile-card-entry-number">#${displayIdx + 1}</span>
          <h3>${scan.storeName || 'Unknown Store'}</h3>
          ${isNew ? '<span class="mobile-card-new-badge">NEW</span>' : ''}
        </div>
      </div>
      <span class="mobile-card-sync" title="${syncTitle}" data-sync-status="${syncStatus}" data-scan-index="${idx}">${syncIcon}</span>
      <span class="mobile-card-expand-icon">▼</span>
    </div>
    <div class="mobile-card-details" style="display: none;">
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">In/Out</span>
        <span class="mobile-card-detail-value">${environment}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Category</span>
        <span class="mobile-card-detail-value">${category}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Lat-Long</span>
        <span class="mobile-card-detail-value">${latLong || '-'}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">House No</span>
        <span class="mobile-card-detail-value">${houseNo || '-'}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Street</span>
        <span class="mobile-card-detail-value">${street || '-'}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Unit</span>
        <span class="mobile-card-detail-value">${scan.unitNumber || '-'}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Floor</span>
        <span class="mobile-card-detail-value">${floor || '-'}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Building</span>
        <span class="mobile-card-detail-value">${building || '-'}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Postcode</span>
        <span class="mobile-card-detail-value">${postcode || '-'}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Opening Hours</span>
        <span class="mobile-card-detail-value">
          ${scan.openingHours ? `<span class="opening-hours-icon" data-index="${idx}" style="cursor: pointer; font-size: 16px;" title="Click to view/edit opening hours">🕐</span>` : '-'}
        </span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Phone</span>
        <span class="mobile-card-detail-value">${scan.phoneNumber || '-'}</span>
      </div>
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Website</span>
        <span class="mobile-card-detail-value">${scan.website || '-'}</span>
      </div>
      ${imageLink ? `
      <div class="mobile-card-detail">
        <span class="mobile-card-detail-label">Drive</span>
        <span class="mobile-card-detail-value"><a href="${imageLink}" target="_blank" style="color: var(--primary);">📎 View</a></span>
      </div>
      ` : ''}
      <div class="mobile-card-detail mobile-card-full-width">
        <span class="mobile-card-detail-label">Remarks</span>
        <span class="mobile-card-detail-value">${remarksValue || '-'}</span>
      </div>
    </div>
    <div class="mobile-card-actions">
      <button class="edit-btn-mobile btn" data-index="${idx}" title="Edit Row">✏️ Edit</button>
      <button class="delete-btn-mobile btn" data-index="${idx}" title="Delete Row">🗑️ Delete</button>
    </div>
  `;
  
  container.appendChild(card);
  
  // Load thumbnail from IndexedDB for mobile card if needed
  if (!hasPhotoData && photoId) {
    const mobileImg = card.querySelector('.lazy-thumbnail-mobile');
    if (mobileImg) {
      getThumbnail(photoId).then(thumbnailDataUrl => {
        if (thumbnailDataUrl && mobileImg.parentElement) {
          mobileImg.src = thumbnailDataUrl;
          // Also update scan object in memory for this session
          scan.photoData = thumbnailDataUrl;
        }
      }).catch(err => {
        console.error('Failed to load thumbnail for mobile card:', err);
      });
    }
  }
  
  // Add expand/collapse functionality
  const header = card.querySelector('.mobile-card-header');
  const details = card.querySelector('.mobile-card-details');
  const expandIcon = card.querySelector('.mobile-card-expand-icon');
  
  header.addEventListener('click', (e) => {
    // Don't toggle if clicking on sync icon
    if (e.target.closest('.mobile-card-sync')) {
      return;
    }
    // Don't toggle if clicking on photo
    if (e.target.closest('.mobile-card-photo')) {
      return;
    }
    
    const isExpanded = details.style.display !== 'none';
    details.style.display = isExpanded ? 'none' : 'block';
    expandIcon.textContent = isExpanded ? '▼' : '▲';
    card.classList.toggle('expanded', !isExpanded);
  });
  
  // Opening hours icon
  const openingHoursIcon = card.querySelector('.opening-hours-icon');
  if (openingHoursIcon) {
    openingHoursIcon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showOpeningHoursModal(scan);
    });
  }
  
  // Sync status click
  const syncIconEl = card.querySelector('.mobile-card-sync');
  if (syncIconEl) {
    syncIconEl.addEventListener('click', (e) => {
      const syncStatus = e.target.dataset.syncStatus;
      if (syncStatus === 'failed' || syncStatus === 'pending') {
        const index = parseInt(e.target.dataset.scanIndex);
        syncToGoogleSheets(scans[index]).then(result => {
          renderTable();
        });
      }
    });
  }
  
  // Mobile photo download button
  const mobileDownloadBtn = card.querySelector('.mobile-photo-download-btn');
  if (mobileDownloadBtn) {
    mobileDownloadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const index = parseInt(mobileDownloadBtn.dataset.index);
      downloadPhoto(scans[index], 'original');
    });
  }
  
  // Photo click
  const photoEl = card.querySelector('.mobile-card-photo');
  if (photoEl && scan.photoData) {
    photoEl.style.cursor = 'pointer';
    photoEl.addEventListener('click', () => {
      const img = document.createElement('img');
      img.src = scan.photoData;
      img.style.cssText = 'max-width: 90vw; max-height: 90vh; object-fit: contain;';
      const modal = document.createElement('div');
      modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; z-index: 10000;';
      modal.appendChild(img);
      modal.addEventListener('click', () => document.body.removeChild(modal));
      document.body.appendChild(modal);
    });
  }
  
  // Edit button
  const editBtn = card.querySelector('.edit-btn-mobile');
  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const row = e.currentTarget.closest('.mobile-card');
    const entryId = row?.dataset.scanEntryId;
    const scanId = row?.dataset.scanId;
    const index = parseInt(row?.dataset.index || '0');
    
    let scanToEdit = null;
    if (entryId) {
      scanToEdit = scans.find(s => s.entryId === entryId);
    }
    if (!scanToEdit && scanId) {
      scanToEdit = scans.find(s => s.id === scanId);
    }
    if (!scanToEdit && index >= 0 && index < scans.length) {
      scanToEdit = scans[index];
    }
    
    if (scanToEdit) {
      editRow(index);
    }
  });
  
  // Delete button
  const deleteBtn = card.querySelector('.delete-btn-mobile');
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const row = e.currentTarget.closest('.mobile-card');
    const index = parseInt(row?.dataset.index || '0');
    deleteRow(index);
  });
}

function renderTable() {
  if (!tableBody) return;
  
  // Clear any existing search highlights when re-rendering
  clearSearchHighlights();
  
  tableBody.innerHTML = '';
  
  // Get mobile cards container
  const mobileCardsContainer = document.getElementById('mobileCardsContainer');
  if (mobileCardsContainer) {
    mobileCardsContainer.innerHTML = '';
  }
  
  // CRITICAL FIX: Filter scans by active project if one is set
  // This ensures data isolation between projects
  const activeProjectId = getActiveProjectId();
  
  // Ensure scans is an array (safety check)
  if (!Array.isArray(scans)) {
    console.error('⚠️ scans is not an array:', typeof scans);
    scans = [];
  }
  
  let visibleScans = activeProjectId 
    ? scans.filter(s => s.projectId === activeProjectId)
    : scans;
  
  // Apply search filter if active
  if (currentSearchFilter) {
    visibleScans = currentSearchFilter;
  }
  
  // Debug logging to help diagnose data isolation issues (only if scans is valid)
  if (Array.isArray(scans) && scans.length > 0) {
    try {
      console.log('🔍 renderTable() - Project isolation check:', {
        activeProjectId,
        totalScans: scans.length,
        visibleScans: visibleScans.length,
        scansByProject: scans.reduce((acc, s) => {
          const pid = s.projectId || 'null';
          acc[pid] = (acc[pid] || 0) + 1;
          return acc;
        }, {})
      });
    } catch (err) {
      console.warn('⚠️ Error in debug logging:', err);
    }
  }
  
  // Sort by timestamp (latest first) - use entryId creation time or timestamp
  visibleScans = visibleScans.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : (a.entryId ? parseInt(a.entryId.split('-')[1] || '0') : 0);
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : (b.entryId ? parseInt(b.entryId.split('-')[1] || '0') : 0);
    return timeB - timeA; // Latest first
  });
  
  // Determine if entry is "NEW" (created in last 24 hours)
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  console.log('Rendering table with', visibleScans.length, 'scans (filtered from', scans.length, ')');
  visibleScans.forEach((scan, displayIdx) => {
    // Find the actual index in the original scans array using multiple methods
    let originalIdx = -1;
    if (scan.entryId) {
      originalIdx = scans.findIndex(s => s.entryId === scan.entryId);
    }
    if (originalIdx < 0 && scan.id) {
      originalIdx = scans.findIndex(s => s.id === scan.id);
    }
    if (originalIdx < 0 && scan.timestamp) {
      originalIdx = scans.findIndex(s => s.timestamp === scan.timestamp && s.storeName === scan.storeName);
    }
    // If still not found, use the scan object reference itself
    if (originalIdx < 0) {
      originalIdx = scans.indexOf(scan);
    }
    const idx = originalIdx >= 0 ? originalIdx : displayIdx;
    
    console.log(`Rendering scan ${displayIdx} (original idx: ${idx}):`, {
      storeName: scan.storeName,
      entryId: scan.entryId,
      hasPhoto: !!scan.photoData,
      keys: Object.keys(scan)
    });
    
    // Create the main table row
    const tr = document.createElement('tr');
    tr.className = 'table-row';
    tr.dataset.index = idx;
    // Store scan reference for reliable access
    tr.dataset.scanEntryId = scan.entryId || '';
    tr.dataset.scanId = scan.id || '';
    
    // Add table cells with data including remarks
    const remarksValue = scan.remarks || '';
    
    // Format Lat-Long as a single field
    const latLong = (scan.lat && scan.lng) 
      ? `${scan.lat}, ${scan.lng}` 
      : '';
    
    // Parse address components
    const houseNo = scan.houseNo || '';
    const street = scan.street || '';
    const building = scan.building || '';
    const postcode = scan.postcode || '';
    
    // Create photo cell content - load thumbnail from IndexedDB if not in scan
    // Thumbnails are now stored in IndexedDB to save localStorage space
    let photoCell;
    const photoId = scan.photoId;
    const hasPhotoData = scan.photoData && scan.photoData.trim() !== '';
    
    if (hasPhotoData) {
      // Thumbnail already in scan (legacy or just scanned)
      photoCell = `
        <div class="photo-cell">
          <img src="${scan.photoData}" alt="Store photo" class="photo-thumbnail" data-index="${idx}" data-photo-id="${photoId || ''}" title="Click to enlarge">
          <button class="photo-download-btn" data-index="${idx}" data-type="original" title="Download photo">⬇️</button>
        </div>
      `;
    } else if (photoId) {
      // No photoData in scan, but has photoId - load from IndexedDB
      photoCell = `
        <div class="photo-cell" data-photo-id="${photoId}">
          <img src="" alt="Store photo" class="photo-thumbnail lazy-thumbnail" data-index="${idx}" data-photo-id="${photoId}" title="Click to enlarge" loading="lazy">
          <button class="photo-download-btn" data-index="${idx}" data-type="original" title="Download photo">⬇️</button>
          <div class="thumbnail-loading" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 12px; color: #999;">Loading...</div>
        </div>
      `;
    } else {
      // No photo at all
      photoCell = `
        <div class="photo-cell">
          <div class="no-photo">📷</div>
          <span style="font-size: 9px; color: #999;">No photo</span>
        </div>
      `;
    }

    // Sync status indicator
    const syncStatus = scan.syncStatus || 'pending';
    let syncIcon, syncTitle;
    if (syncStatus === 'synced') {
      syncIcon = '✅';
      syncTitle = 'Synced to Google Sheets';
    } else if (syncStatus === 'failed') {
      syncIcon = '❌';
      syncTitle = 'Sync failed - Click to retry';
    } else {
      syncIcon = '⏳';
      syncTitle = 'Pending sync';
    }
    
    // Environment (Indoor/Outdoor)
    const environment = scan.environment || '-';
    
    // Category
    const category = scan.category || '-';
    
    // Floor
    const floor = scan.floor || '';

    // Image link (Google Drive)
    const imageLink = scan.imageLink || '';
    const imageLinkCell = imageLink 
      ? `<a href="${imageLink}" target="_blank" title="View in Drive">📎</a>`
      : '<span style="color:#666">-</span>';

    const rowHTML = `
      <td>${displayIdx + 1}</td>
      <td class="sync-status-cell" title="${syncTitle}" data-sync-status="${syncStatus}" data-scan-index="${idx}">${syncIcon}</td>
      <td>${photoCell}</td>
      <td>${environment}</td>
      <td>${category}</td>
      <td>${scan.storeName}</td>
      <td>${latLong}</td>
      <td>${houseNo}</td>
      <td>${street}</td>
      <td>${scan.unitNumber || ''}</td>
      <td>${floor}</td>
      <td>${building}</td>
      <td>${postcode}</td>
      <td class="opening-hours-cell">
        ${scan.openingHours ? `<span class="opening-hours-icon" data-index="${idx}" title="Click to view/edit opening hours">🕐</span>` : '<span style="color:#666">-</span>'}
      </td>
      <td class="phone-cell">
        <input type="text" class="phone-input" value="${scan.phoneNumber || ''}" 
               placeholder="Phone..." data-index="${idx}">
      </td>
      <td class="website-cell">
        <input type="text" class="website-input" value="${scan.website || ''}" 
               placeholder="Website..." data-index="${idx}">
      </td>
      <td class="remarks-cell">
        <input type="text" class="remarks-input" value="${remarksValue}" 
               placeholder="Add remarks..." data-index="${idx}">
      </td>
      <td class="drive-link-cell">${imageLinkCell}</td>
      <td class="actions-cell">
        <button class="edit-btn" data-index="${idx}" title="Edit Row">
          ✏️ Edit
        </button>
        <button class="delete-btn" data-index="${idx}" title="Delete Row">
          🗑️ Delete
        </button>
      </td>`;
    
    console.log(`Row HTML for scan ${displayIdx}:`, rowHTML.substring(0, 200) + '...');
    tr.innerHTML = rowHTML;
    
    // Append row to table
    tableBody.appendChild(tr);
    
    // Load thumbnail from IndexedDB if needed (lazy loading)
    if (!hasPhotoData && photoId) {
      const img = tr.querySelector('.lazy-thumbnail');
      const loadingDiv = tr.querySelector('.thumbnail-loading');
      if (img) {
        getThumbnail(photoId).then(thumbnailDataUrl => {
          if (thumbnailDataUrl && img.parentElement) {
            img.src = thumbnailDataUrl;
            if (loadingDiv) loadingDiv.remove();
            // Also update scan object in memory for this session
            scan.photoData = thumbnailDataUrl;
          } else if (loadingDiv) {
            loadingDiv.textContent = 'No thumbnail';
            setTimeout(() => loadingDiv.remove(), 2000);
          }
        }).catch(err => {
          console.error('Failed to load thumbnail:', err);
          if (loadingDiv) {
            loadingDiv.textContent = 'Error';
            setTimeout(() => loadingDiv.remove(), 2000);
          }
        });
      }
    }
    
    // Also render mobile card
    const mobileCardsContainer = document.getElementById('mobileCardsContainer');
    if (mobileCardsContainer) {
      // Check if entry is NEW (created in last 24 hours)
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      const scanTime = scan.timestamp ? new Date(scan.timestamp).getTime() : (scan.entryId ? parseInt(scan.entryId.split('-')[1] || '0') : 0);
      const isNew = scanTime > oneDayAgo;
      renderMobileCard(scan, idx, displayIdx, mobileCardsContainer, isNew);
    }
    
    // Add event listeners for remarks input
    const remarksInput = tr.querySelector('.remarks-input');
    remarksInput.addEventListener('blur', (e) => {
      const index = parseInt(e.target.dataset.index);
      if (scans[index].remarks !== e.target.value) {
        scans[index].remarks = e.target.value;
        scans[index].syncStatus = 'pending'; // Mark as pending when edited
        saveScans();
        renderTable(); // Re-render to show updated sync status
      }
    });
    
    remarksInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.target.blur(); // This will trigger the blur event above
      }
    });
    
    // Add event listener for opening hours icon
    const openingHoursIcon = tr.querySelector('.opening-hours-icon');
    if (openingHoursIcon) {
      openingHoursIcon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showOpeningHoursModal(scan);
      });
    }
    
    // Add event listeners for action buttons
    const editBtn = tr.querySelector('.edit-btn');
    const deleteBtn = tr.querySelector('.delete-btn');
    
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Get the row to find the scan reliably
      const row = e.currentTarget.closest('tr');
      const entryId = row?.dataset.scanEntryId;
      const scanId = row?.dataset.scanId;
      const index = parseInt(row?.dataset.index || '0');
      
      // Find scan by entryId first, then by index as fallback
      let scan = null;
      if (entryId) {
        scan = scans.find(s => s.entryId === entryId);
      }
      if (!scan && scanId) {
        scan = scans.find(s => s.id === scanId);
      }
      if (!scan && index >= 0 && index < scans.length) {
        scan = scans[index];
      }
      
      if (scan) {
        const actualIndex = scans.indexOf(scan);
        if (actualIndex >= 0) {
          editRow(actualIndex);
        } else {
          console.error('Could not find scan in array');
        }
      } else {
        console.error('Could not find scan to edit');
      }
    });
    
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Get the row to find the scan reliably
      const row = e.currentTarget.closest('tr');
      const entryId = row?.dataset.scanEntryId;
      const scanId = row?.dataset.scanId;
      const index = parseInt(row?.dataset.index || '0');
      
      // Find scan by entryId first, then by index as fallback
      let scan = null;
      if (entryId) {
        scan = scans.find(s => s.entryId === entryId);
      }
      if (!scan && scanId) {
        scan = scans.find(s => s.id === scanId);
      }
      if (!scan && index >= 0 && index < scans.length) {
        scan = scans[index];
      }
      
      if (scan) {
        const actualIndex = scans.indexOf(scan);
        if (actualIndex >= 0) {
          deleteRow(actualIndex);
        } else {
          console.error('Could not find scan in array');
        }
      } else {
        console.error('Could not find scan to delete');
      }
    });

    // Add event listeners for photo interactions
    const photoThumbnail = tr.querySelector('.photo-thumbnail');
    const photoDownloadBtn = tr.querySelector('.photo-download-btn');
    
    if (photoThumbnail) {
      photoThumbnail.addEventListener('click', async (e) => {
        e.preventDefault();
        const index = parseInt(e.target.dataset.index);
        const scan = scans[index];
        try {
          let url = scan.photoData;
          // If no photoData, try to load from IndexedDB
          if (!url && scan.photoId) {
            // Try full-res first
            const blob = await getPhotoBlob(scan.photoId);
            if (blob) {
              url = URL.createObjectURL(blob);
            } else {
              // Fallback to thumbnail
              const thumbnailDataUrl = await getThumbnail(scan.photoId);
              if (thumbnailDataUrl) {
                url = thumbnailDataUrl;
              }
            }
          } else if (scan.photoId && url) {
            // Prefer full-res if available
            const blob = await getPhotoBlob(scan.photoId);
            if (blob) {
              url = URL.createObjectURL(blob);
            }
          }
          if (url) {
            showPhotoModal(url, scan.storeName);
          } else {
            alert('Photo not available');
          }
        } catch (error) {
          console.error('Failed to load photo:', error);
          if (scan.photoData) {
            showPhotoModal(scan.photoData, scan.storeName);
          } else {
            alert('Photo not available');
          }
        }
      });
    }
    
    // Handle photo download buttons (original and annotated)
    const photoDownloadBtns = tr.querySelectorAll('.photo-download-btn');
    photoDownloadBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(btn.dataset.index);
        const downloadType = btn.dataset.type || 'original';
        downloadPhoto(scans[index], downloadType);
      });
    });
    
    // Add click handler for failed sync status to retry
    const syncStatusCell = tr.querySelector('.sync-status-cell');
    if (syncStatusCell && syncStatus === 'failed') {
      syncStatusCell.style.cursor = 'pointer';
      syncStatusCell.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(syncStatusCell.dataset.scanIndex);
        const scan = scans[index];
        if (scan) {
          // Retry sync
          syncStatusCell.textContent = '⏳';
          syncStatusCell.title = 'Retrying sync...';
          scan.syncStatus = 'pending';
          saveScans();
          
          const result = await syncToGoogleSheets(scan);
          if (result.success) {
            scan.syncStatus = 'synced';
            if (result.details?.imageLinks && scan.entryId) {
              scan.imageLink = result.details.imageLinks[scan.entryId];
            }
          } else {
            scan.syncStatus = 'failed';
          }
          saveScans();
          renderTable();
        }
      });
    }
  });
}

// Edit individual row
function editRow(index) {
  const scan = scans[index];
  if (!scan) return;
  
  // Create a simple modal for editing
  const modal = document.createElement('div');
  modal.className = 'edit-modal';
  modal.innerHTML = `
    <div class="edit-modal-content">
      <h3>Edit Scan #${index + 1}</h3>
      <div class="edit-form">
        <div class="edit-field">
          <label>POI Name:</label>
          <input type="text" id="edit-storeName" value="${scan.storeName}">
        </div>
        <div class="edit-field">
          <label>Latitude:</label>
          <input type="text" id="edit-lat" value="${scan.lat || ''}">
        </div>
        <div class="edit-field">
          <label>Longitude:</label>
          <input type="text" id="edit-lng" value="${scan.lng || ''}">
        </div>
        <div class="edit-field">
          <label>House_No:</label>
          <input type="text" id="edit-houseNo" value="${scan.houseNo || ''}">
        </div>
        <div class="edit-field">
          <label>Street:</label>
          <input type="text" id="edit-street" value="${scan.street || ''}">
        </div>
        <div class="edit-field">
          <label>Unit:</label>
          <input type="text" id="edit-unitNumber" value="${scan.unitNumber}">
        </div>
        <div class="edit-field">
          <label>Building:</label>
          <input type="text" id="edit-building" value="${scan.building || ''}">
        </div>
        <div class="edit-field">
          <label>Postcode:</label>
          <input type="text" id="edit-postcode" value="${scan.postcode || ''}">
        </div>
        <div class="edit-field">
          <label>Remarks:</label>
          <input type="text" id="edit-remarks" value="${scan.remarks || ''}">
        </div>
        ${(scan.photoData || scan.photoId) ? `
        <div class="edit-field">
          <label>Photo Preview:</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${scan.photoData || ''}" alt="Scan photo" class="edit-photo-preview" data-photo-id="${scan.photoId || ''}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 6px; border: 2px solid #e0e0e0;">
            <button type="button" class="btn edit-view-photo-btn" data-photo-id="${scan.photoId || ''}" data-photo-data="${scan.photoData || ''}">🔍 View Full Size</button>
          </div>
        </div>
        ` : '<div class="edit-field"><label>Photo:</label><span style="color: #999;">No photo captured</span></div>'}
        <div class="edit-actions">
          <button class="btn save-btn">💾 Save</button>
          <button class="btn cancel-btn">❌ Cancel</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Load thumbnail in edit modal if needed
  const editPhotoPreview = modal.querySelector('.edit-photo-preview');
  if (editPhotoPreview && !scan.photoData && scan.photoId) {
    getThumbnail(scan.photoId).then(thumbnailDataUrl => {
      if (thumbnailDataUrl && editPhotoPreview.parentElement) {
        editPhotoPreview.src = thumbnailDataUrl;
      }
    }).catch(err => {
      console.error('Failed to load thumbnail in edit modal:', err);
    });
  }
  
  // Handle view photo button in edit modal
  const editViewPhotoBtn = modal.querySelector('.edit-view-photo-btn');
  if (editViewPhotoBtn) {
    editViewPhotoBtn.addEventListener('click', async () => {
      const photoId = editViewPhotoBtn.dataset.photoId;
      const photoData = editViewPhotoBtn.dataset.photoData;
      try {
        let url = photoData;
        if (photoId) {
          const blob = await getPhotoBlob(photoId);
          if (blob) {
            url = URL.createObjectURL(blob);
          } else if (!url) {
            const thumbnailDataUrl = await getThumbnail(photoId);
            if (thumbnailDataUrl) {
              url = thumbnailDataUrl;
            }
          }
        }
        if (url) {
          showPhotoModal(url, scan.storeName);
        } else {
          alert('Photo not available');
        }
      } catch (error) {
        console.error('Failed to load photo:', error);
        if (photoData) {
          showPhotoModal(photoData, scan.storeName);
        } else {
          alert('Photo not available');
        }
      }
    });
  }
  
  // Add event listeners
  const saveBtn = modal.querySelector('.save-btn');
  const cancelBtn = modal.querySelector('.cancel-btn');
  
  const closeModal = () => {
    document.body.removeChild(modal);
  };
  
  saveBtn.addEventListener('click', () => {
    // Check if any field was changed
    const hasChanges = 
      scan.storeName !== document.getElementById('edit-storeName').value ||
      scan.lat !== document.getElementById('edit-lat').value ||
      scan.lng !== document.getElementById('edit-lng').value ||
      scan.houseNo !== document.getElementById('edit-houseNo').value ||
      scan.street !== document.getElementById('edit-street').value ||
      scan.unitNumber !== document.getElementById('edit-unitNumber').value ||
      scan.building !== document.getElementById('edit-building').value ||
      scan.postcode !== document.getElementById('edit-postcode').value ||
      scan.remarks !== document.getElementById('edit-remarks').value;
    
    // Update scan data
    scans[index] = {
      ...scan,
      storeName: document.getElementById('edit-storeName').value,
      lat: document.getElementById('edit-lat').value,
      lng: document.getElementById('edit-lng').value,
      houseNo: document.getElementById('edit-houseNo').value,
      street: document.getElementById('edit-street').value,
      unitNumber: document.getElementById('edit-unitNumber').value,
      building: document.getElementById('edit-building').value,
      postcode: document.getElementById('edit-postcode').value,
      remarks: document.getElementById('edit-remarks').value
    };
    
    // Mark as pending if any field was edited
    if (hasChanges) {
      scans[index].syncStatus = 'pending';
    }
    
    saveScans();
    renderTable();
    closeModal();
  });
  
  cancelBtn.addEventListener('click', closeModal);
  
  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  // Focus first input
  setTimeout(() => {
    document.getElementById('edit-storeName').focus();
  }, 100);
}

// Show modal for viewing/editing opening hours
function showOpeningHoursModal(scan) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Opening Hours</h3>
        <button class="modal-close" id="openingHoursModalClose">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="openingHoursText">Opening Hours:</label>
          <textarea id="openingHoursText" rows="8" style="width: 100%; padding: 8px; font-family: monospace; font-size: 13px;" placeholder="Mon (09:00-21:00)&#10;Tue (09:00-21:00)&#10;Wed (09:00-21:00)&#10;...">${scan.openingHours || ''}</textarea>
          <p style="font-size: 12px; color: #999; margin-top: 8px;">
            Format: Day (HH:MM-HH:MM)<br>
            Example: Mon (09:00-21:00)
          </p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="openingHoursModalCancel">Cancel</button>
        <button class="btn btn-primary" id="openingHoursModalSave">Save</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeModal = () => {
    if (modal.parentElement) {
      document.body.removeChild(modal);
    }
    // Ensure camera stream continues after closing modal
    if (video && !video.srcObject && window.currentCameraStream) {
      video.srcObject = window.currentCameraStream;
    }
  };
  
  const saveOpeningHours = () => {
    const textarea = modal.querySelector('#openingHoursText');
    const newOpeningHours = textarea.value.trim();
    
    // Find scan in array
    const scanIndex = scans.findIndex(s => s.entryId === scan.entryId);
    if (scanIndex >= 0) {
      scans[scanIndex].openingHours = newOpeningHours;
      scans[scanIndex].syncStatus = 'pending'; // Mark as pending when edited
      saveScans();
      renderTable();
    }
    
    closeModal();
  };
  
  modal.querySelector('#openingHoursModalClose').addEventListener('click', closeModal);
  modal.querySelector('#openingHoursModalCancel').addEventListener('click', closeModal);
  modal.querySelector('#openingHoursModalSave').addEventListener('click', saveOpeningHours);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  // Focus textarea
  setTimeout(() => {
    modal.querySelector('#openingHoursText').focus();
  }, 100);
}

// Delete individual row
async function deleteRow(index) {
  if (confirm(`Delete scan #${index + 1}?`)) {
    const deletedScan = scans[index];
    const entryId = deletedScan?.entryId;
    const photoId = deletedScan?.photoId;
    
    // Remove from scans array
    scans.splice(index, 1);
    saveScans();
    renderTable();
    
    // Delete photo from IndexedDB if it exists
    if (photoId) {
      await deletePhotoFromIndexedDB(photoId);
    }
    
    // Track deletion for sync if entryId exists
    if (entryId) {
      trackDeletion(entryId);
      // Sync deletion to Google Sheets if sync is enabled
      if (isProjectSyncEnabled() || isSheetsSyncEnabled()) {
        syncDeletionToGoogleSheets(entryId, deletedScan).catch(err => {
          console.error('Failed to sync deletion:', err);
        });
      }
    }
  }
}

// Track deleted entryIds (store in localStorage)
function trackDeletion(entryId) {
  const deletedEntries = JSON.parse(localStorage.getItem('bnsvision_deletedEntries') || '[]');
  if (!deletedEntries.includes(entryId)) {
    deletedEntries.push(entryId);
    localStorage.setItem('bnsvision_deletedEntries', JSON.stringify(deletedEntries));
  }
}

// Get all tracked deletions
function getTrackedDeletions() {
  return JSON.parse(localStorage.getItem('bnsvision_deletedEntries') || '[]');
}

// Clear tracked deletions (after successful sync)
function clearTrackedDeletions(entryIds) {
  const deletedEntries = JSON.parse(localStorage.getItem('bnsvision_deletedEntries') || '[]');
  const remaining = deletedEntries.filter(id => !entryIds.includes(id));
  localStorage.setItem('bnsvision_deletedEntries', JSON.stringify(remaining));
}

// Sync deletion to Google Sheets
async function syncDeletionToGoogleSheets(entryId, deletedScan) {
  const project = getActiveProject();
  
  if (!isProjectSyncEnabled() && !isSheetsSyncEnabled()) {
    return { success: false, reason: 'sync_disabled' };
  }

  try {
    const tabName = project?.sheetTab || project?.location || 'Sheet1';
    const payload = {
      tabName,
      entryId,
      deleted: true,
      deletedAt: new Date().toISOString(),
      // Include some metadata for reference
      projectId: deletedScan?.projectId || project?.id || '',
      projectName: deletedScan?.projectName || project?.name || ''
    };

    const response = await fetch(SHEETS_SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Deletion synced to Google Sheets:', entryId);
      // Remove from tracked deletions after successful sync
      clearTrackedDeletions([entryId]);
      return { success: true };
    } else {
      console.error('❌ Deletion sync failed:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ Deletion sync error:', error);
    return { success: false, error: error.message };
  }
}

// Sync all pending deletions (for batch sync)
async function syncPendingDeletions() {
  const deletedEntryIds = getTrackedDeletions();
  if (deletedEntryIds.length === 0) {
    return { success: true, count: 0 };
  }

  const project = getActiveProject();
  if (!isProjectSyncEnabled() && !isSheetsSyncEnabled()) {
    return { success: false, reason: 'sync_disabled' };
  }

  try {
    const tabName = project?.sheetTab || project?.location || 'Sheet1';
    const payload = {
      tabName,
      deletions: deletedEntryIds.map(entryId => ({
        entryId,
        deleted: true,
        deletedAt: new Date().toISOString()
      }))
    };

    const response = await fetch(SHEETS_SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Synced ${deletedEntryIds.length} deletions to Google Sheets`);
      // Clear tracked deletions after successful sync
      clearTrackedDeletions(deletedEntryIds);
      return { success: true, count: deletedEntryIds.length };
    } else {
      console.error('❌ Batch deletion sync failed:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ Batch deletion sync error:', error);
    return { success: false, error: error.message };
  }
}

// Show photo in enlarged modal
function showPhotoModal(photoData, storeName) {
  const modal = document.createElement('div');
  modal.className = 'photo-modal';
  modal.innerHTML = `
    <div class="photo-modal-content">
      <button class="photo-modal-close" title="Close">×</button>
      <img src="${photoData}" alt="${storeName} photo">
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeModal = () => {
    document.body.removeChild(modal);
  };
  
  // Close on button click
  modal.querySelector('.photo-modal-close').addEventListener('click', closeModal);
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  // Close on Escape key
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', handleKeyDown);
    }
  };
  document.addEventListener('keydown', handleKeyDown);
}

// Download individual photo
// downloadType: 'original' or 'annotated'
async function downloadPhoto(scan, downloadType = 'original') {
  // Check if photo exists (either in IndexedDB or as thumbnail)
  if (!scan.photoId && !scan.photoData) {
    alert('No photo available for this scan');
    return;
  }
  
  try {
    let blob = null;
    let imageDataUrl = null;
    
    // Always prefer full-res photo from IndexedDB
    if (scan.photoId) {
      blob = await getPhotoBlob(scan.photoId);
      if (blob) {
        imageDataUrl = URL.createObjectURL(blob);
      }
    }
    // Fallback to thumbnail if full-res not available
    if (!blob && scan.photoData && scan.photoData.startsWith('data:image/')) {
      imageDataUrl = scan.photoData;
      const res = await fetch(scan.photoData);
      blob = await res.blob();
    }
    // Try to get thumbnail from IndexedDB as last resort
    if (!blob && scan.photoId) {
      const thumbnailDataUrl = await getThumbnail(scan.photoId);
      if (thumbnailDataUrl && thumbnailDataUrl.startsWith('data:image/')) {
        imageDataUrl = thumbnailDataUrl;
        const res = await fetch(thumbnailDataUrl);
        blob = await res.blob();
      }
    }
    
    if (!blob || !imageDataUrl) {
      alert('Photo data not available');
      return;
    }
    
    // If annotated version requested, add annotations to image
    if (downloadType === 'annotated') {
      blob = await createAnnotatedImage(imageDataUrl, scan);
    }
    
    // Use entryId-based filename if available, otherwise fallback to old format
    let filename = scan.photoFilename || (scan.entryId ? `${scan.entryId}` : `bnsVision_${scan.storeName || 'scan'}_photo`);
    
    // Add suffix for annotated version
    if (downloadType === 'annotated') {
      filename += '_annotated';
    }
    
    // Ensure filename has image extension
    if (!filename.endsWith('.jpg') && !filename.endsWith('.jpeg') && !filename.endsWith('.png')) {
      filename = `${filename}.jpg`;
    }

    // Prefer Web Share API on mobile (iOS/Android)
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'bnsVision Photo', files: [file] });
          showPhotoSavedNotification('📤 Photo shared');
          if (imageDataUrl && imageDataUrl.startsWith('blob:')) {
            URL.revokeObjectURL(imageDataUrl);
          }
          return;
        }
      } catch (shareErr) {
        if (shareErr && shareErr.name === 'AbortError') {
          if (imageDataUrl && imageDataUrl.startsWith('blob:')) {
            URL.revokeObjectURL(imageDataUrl);
          }
          return; // user cancelled
        }
        // fall through to download
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      // iOS Safari often ignores download attribute; open in new tab for long-press save
      window.open(objectUrl, '_blank');
      showPhotoSavedNotification('📸 Tap and hold image to Save', false);
    } else {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      link.type = blob.type || 'image/jpeg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showPhotoSavedNotification(`${downloadType === 'annotated' ? 'Annotated ' : ''}Photo downloaded successfully!`, false);
    }
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      if (imageDataUrl && imageDataUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imageDataUrl);
      }
    }, 1500);
  } catch (error) {
    console.error('Download failed:', error);
    showPhotoSavedNotification('Download failed. Please try again.', true);
  }
}

// Create annotated version of image with scan details
async function createAnnotatedImage(imageDataUrl, scan) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      // Draw original image
      ctx.drawImage(img, 0, 0);
      
      // Add annotations
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, canvas.height - 120, canvas.width, 120);
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px Arial';
      ctx.fillText(scan.storeName || 'Store', 20, canvas.height - 90);
      
      ctx.font = '18px Arial';
      if (scan.houseNo && scan.street) {
        ctx.fillText(`${scan.houseNo} ${scan.street}`, 20, canvas.height - 60);
      }
      if (scan.postcode) {
        ctx.fillText(`Postcode: ${scan.postcode}`, 20, canvas.height - 35);
      }
      if (scan.lat && scan.lng) {
        ctx.fillText(`Location: ${scan.lat.toFixed(6)}, ${scan.lng.toFixed(6)}`, 20, canvas.height - 10);
      }
      
      // Convert to blob
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create annotated image'));
        }
      }, 'image/jpeg', 0.9);
    };
    
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}

// Removed old swipe functionality - now using buttons

// After renderTable definition add event listeners
// --- Toolbar actions ---
document.getElementById('clearBtn').addEventListener('click', async () => {
  if (confirm('Clear all saved scans?')) {
    // Filter scans by active project if one is selected
    const activeProjectId = getActiveProjectId();
    const scansToDelete = activeProjectId 
      ? scans.filter(scan => scan.projectId === activeProjectId)
      : scans;
    
    // Collect all photoIds before clearing
    const photoIds = scansToDelete
      .map(scan => scan.photoId)
      .filter(id => id); // Remove null/undefined
    
    // Delete photos from IndexedDB
    for (const photoId of photoIds) {
      await deletePhotoFromIndexedDB(photoId);
    }
    
    // Clear scans from localStorage
    if (activeProjectId) {
      // Remove only scans for the active project
      scans = scans.filter(scan => scan.projectId !== activeProjectId);
    } else {
      // Clear all scans
      scans = [];
    }
    
    // CRITICAL FIX: Force immediate save when clearing
    try {
      localStorage.setItem('scans', JSON.stringify(scans));
      console.log('💾 Cleared all scans');
    } catch (error) {
      console.error('❌ Failed to clear scans:', error);
    }
    renderTable();
    if (video && video.srcObject) {
      video.play().catch(()=>{});
    }
  }
});

document.getElementById('exportBtn').addEventListener('click', () => {
  if (!scans.length) {
    alert('No data to export');
    return;
  }
  const headers = ['POI Name','Lat-Long','House_No','Street','Unit','Building','Postcode','Remarks','Photo Available','Timestamp'];
  const csvRows = [headers.join(',')];
  scans.forEach(s => {
    // Format Lat-Long as a single field
    const latLong = (s.lat && s.lng) ? `${s.lat}, ${s.lng}` : '';
    
    const row = [
      s.storeName, 
      latLong,
      s.houseNo || '', 
      s.street || '', 
      s.unitNumber, 
      s.building || '', 
      s.postcode || '', 
      s.remarks || '',
      s.photoData ? 'Yes' : 'No',
      s.timestamp || 'Unknown'
    ].map(v => '"' + (v || '').replace(/"/g,'""') + '"').join(',');
    csvRows.push(row);
  });
  const blob = new Blob([csvRows.join('\n')], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'storefront_scans.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
});

// Sync All to Google Sheets
document.getElementById('syncAllSheetsBtn').addEventListener('click', async () => {
  // Filter scans by active project if one is set
  const activeProjectId = getActiveProjectId();
  const project = getActiveProject();
  const scansToSync = activeProjectId 
    ? scans.filter(s => s.projectId === activeProjectId)
    : scans;
  
  if (!scansToSync.length) {
    // Check if there are pending deletions to sync
    const pendingDeletions = getTrackedDeletions();
    if (pendingDeletions.length > 0) {
      const btn = document.getElementById('syncAllSheetsBtn');
      const originalText = btn.textContent;
      btn.textContent = '⏳ Syncing deletions...';
      btn.disabled = true;
      
      const deletionResult = await syncPendingDeletions();
      if (deletionResult.success) {
        alert(`Synced ${deletionResult.count} deletion(s) to Google Sheets`);
      }
      
      btn.textContent = originalText;
      btn.disabled = false;
      return;
    }
    alert('No data to sync');
    return;
  }
  
  // Manual sync always proceeds - the Sync to Sheets button is a manual action
  
  const btn = document.getElementById('syncAllSheetsBtn');
  const originalText = btn.textContent;
  btn.textContent = '⏳ Syncing...';
  btn.disabled = true;
  
  try {
    // First sync pending deletions if any
    const pendingDeletions = getTrackedDeletions();
    if (pendingDeletions.length > 0) {
      await syncPendingDeletions();
    }
    
    // Only sync pending records to avoid duplicates
    const pendingScans = scansToSync.filter(s => s.syncStatus === 'pending' || s.syncStatus === 'failed');
    
    if (pendingScans.length === 0) {
      btn.textContent = '✅ All synced!';
      btn.disabled = false;
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
      return;
    }
    
    // Then sync only pending records
    const result = await syncBatchToGoogleSheets(pendingScans);
    if (result.success) {
      btn.textContent = '✅ Synced!';
      
      // Update scan records with returned image links and sync status
      if (result.details?.imageLinks) {
        pendingScans.forEach(scan => {
          scan.syncStatus = 'synced';
          if (scan.entryId && result.details.imageLinks[scan.entryId]) {
            scan.imageLink = result.details.imageLinks[scan.entryId];
          }
        });
        saveScans();
        renderTable();
      }
      
      const tabInfo = project?.sheetTab ? ` to "${project.sheetTab}" tab` : '';
      const imgCount = result.details?.imagesUploaded || 0;
      const imgInfo = imgCount > 0 ? ` (${imgCount} images uploaded to Drive)` : '';
      const deletionInfo = pendingDeletions.length > 0 ? ` (${pendingDeletions.length} deletion(s) synced)` : '';
      alert(`Successfully synced ${scansToSync.length} records${tabInfo}!${imgInfo}${deletionInfo}`);
    } else {
      btn.textContent = '❌ Failed';
      // Mark failed scans
      scansToSync.forEach(scan => {
        scan.syncStatus = 'failed';
      });
      saveScans();
      renderTable();
      alert('Sync failed. Please check your connection and try again.');
    }
  } catch (error) {
    btn.textContent = '❌ Error';
    alert('An error occurred while syncing: ' + error.message);
  }
  
  setTimeout(() => {
    btn.textContent = originalText;
    btn.disabled = false;
  }, 2000);
});

// CRITICAL FIX: Add function to restore projects if they were cleared
function restoreProjectsIfCleared() {
  const currentProjects = loadProjects();
  const backup = sessionStorage.getItem('projects_backup');
  
  if (backup && (!currentProjects || currentProjects.length === 0)) {
    try {
      const restoredProjects = JSON.parse(backup);
      if (Array.isArray(restoredProjects) && restoredProjects.length > 0) {
        console.warn('⚠️ Projects were cleared! Restoring from backup...');
        localStorage.setItem(PROJECTS_KEY, backup);
        
        // Refresh projects list if we're on that screen
        if (document.getElementById('projectsListScreen')?.classList.contains('active')) {
          renderProjectsList();
        }
        
        // Show notification
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
          const originalText = statusDiv.textContent;
          statusDiv.textContent = '⚠️ Projects restored from backup';
          statusDiv.style.color = '#ffa500';
          setTimeout(() => {
            statusDiv.textContent = originalText;
            statusDiv.style.color = '';
          }, 3000);
        }
        
        return true; // Indicates restoration happened
      }
    } catch (e) {
      console.error('Failed to restore projects:', e);
    }
  }
  
  return false; // No restoration needed
}

// Download All Photos functionality - Creates a ZIP file
// Only downloads photos from the active project
document.getElementById('downloadAllPhotosBtn').addEventListener('click', async () => {
  const downloadBtn = document.getElementById('downloadAllPhotosBtn');
  
  // CRITICAL FIX: Prevent multiple simultaneous downloads
  if (downloadBtn.disabled) {
    console.log('Download already in progress, ignoring click');
    return;
  }
  
  // CRITICAL FIX: Backup projects BEFORE any download operations (Android safeguard)
  const projects = loadProjects();
  if (projects.length > 0) {
    sessionStorage.setItem('projects_backup', JSON.stringify(projects));
    console.log(`💾 Backed up ${projects.length} projects before download`);
  }
  
  // Filter scans by active project (same logic as renderTable)
  const activeProjectId = getActiveProjectId();
  const projectScans = activeProjectId 
    ? scans.filter(s => s.projectId === activeProjectId)
    : scans;
  
  // Filter to only scans with photos (either photoId or photoData)
  const photosWithData = projectScans.filter(scan => scan.photoId || scan.photoData);
  
  if (photosWithData.length === 0) {
    const project = getActiveProject();
    const projectName = project ? ` in "${project.name || project.location}"` : '';
    alert(`No photos available to download${projectName}`);
    return;
  }
  
  if (photosWithData.length === 1) {
    // If only one photo, just download it directly
    downloadPhoto(photosWithData[0]);
    
    // CRITICAL FIX: Check and restore projects after single photo download
    setTimeout(() => {
      restoreProjectsIfCleared();
    }, 500);
    
    return;
  }
  
  // For multiple photos, create a ZIP file
  // CRITICAL FIX: Store original text before any async operations
  const originalText = downloadBtn.textContent;
  
  try {
    // Show progress
    downloadBtn.textContent = '📦 Preparing...';
    downloadBtn.disabled = true;
    
    // Import JSZip dynamically
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      document.head.appendChild(script);
      
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        setTimeout(() => reject(new Error('JSZip load timeout')), 10000);
      });
    }
    
    const zip = new JSZip();
    const timestamp = new Date().toISOString().slice(0, 10);
    
    // CRITICAL FIX: Process photos in smaller batches to reduce memory pressure
    const BATCH_SIZE = 5; // Smaller batches for Android
    let processedCount = 0;
    
    for (let i = 0; i < photosWithData.length; i += BATCH_SIZE) {
      const batch = photosWithData.slice(i, i + BATCH_SIZE);
      downloadBtn.textContent = `📦 Processing ${processedCount + batch.length}/${photosWithData.length}...`;
      
      // CRITICAL FIX: Check and restore projects after each batch
      restoreProjectsIfCleared();
      
      // Process batch
      const batchPromises = batch.map(async (scan, index) => {
        const filename = scan.photoFilename || (scan.entryId ? `${scan.entryId}.jpg` : `bnsVision_${scan.storeName || `scan_${i + index + 1}`}_photo.jpg`);
        let blob = null;
        
        try {
          if (scan.photoId) {
            blob = await getPhotoBlob(scan.photoId);
          }
          if (!blob && scan.photoData && scan.photoData.startsWith('data:image/')) {
            const res = await fetch(scan.photoData);
            blob = await res.blob();
          }
          
          if (blob && blob.type && blob.type.startsWith('image/')) {
            const arrayBuffer = await blob.arrayBuffer();
            zip.file(filename, arrayBuffer);
          } else {
            console.warn(`Skipping non-image file: ${filename}`, blob?.type);
          }
        } catch (err) {
          console.error(`Error processing photo ${filename}:`, err);
        }
      });
      
      await Promise.all(batchPromises);
      processedCount += batch.length;
      
      // Small delay to let browser free memory
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Generate ZIP file
    downloadBtn.textContent = '📦 Creating ZIP...';
    const zipBlob = await zip.generateAsync({type: 'blob'});

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const zipName = `bnsVision_all_photos_${timestamp}.zip`;

    // Prefer Web Share API when possible (iOS/Android)
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([zipBlob], zipName, { type: 'application/zip' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'bnsVision Photos', files: [file] });
          showPhotoSavedNotification(`📤 Shared ${photosWithData.length} photos`, false);
          
          // CRITICAL FIX: Restore projects after share (Android may clear localStorage)
          setTimeout(() => {
            restoreProjectsIfCleared();
          }, 500);
          
          return;
        }
      } catch (shareErr) {
        if (shareErr && shareErr.name === 'AbortError') return; // user cancelled
        // fall through
      }
    }

    const zipUrl = URL.createObjectURL(zipBlob);
    if (isIOS) {
      // iOS: open in new tab so user can use "Open in..." to save to Files
      window.open(zipUrl, '_blank');
      showPhotoSavedNotification('📦 Tap Share → Save to Files', false);
    } else {
      const link = document.createElement('a');
      link.href = zipUrl;
      link.download = zipName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showPhotoSavedNotification(`Downloaded ${photosWithData.length} photos`, false);
    }
    setTimeout(() => URL.revokeObjectURL(zipUrl), 2000);
    
    showPhotoSavedNotification(`Successfully downloaded ${photosWithData.length} photos as ZIP file!`, false);
    
    // CRITICAL FIX: Final check - restore projects if they were cleared
    setTimeout(() => {
      restoreProjectsIfCleared();
    }, 1000);
    
  } catch (error) {
    console.error('Bulk download failed:', error);
    showPhotoSavedNotification('Failed to create photo archive. Try downloading photos individually.', true);
    
    // CRITICAL FIX: Restore projects on error
    restoreProjectsIfCleared();
  } finally {
    // CRITICAL FIX: Always reset button state, even on early returns
    const downloadBtn = document.getElementById('downloadAllPhotosBtn');
    if (downloadBtn) {
      downloadBtn.textContent = originalText || '📥 Download All Photos';
      downloadBtn.disabled = false;
    }
  }
});

// Removed combined Export All handler

// --- Manual store location search ---
const storeSearchInput = document.getElementById('storeSearchInput');
const searchLocationBtn = document.getElementById('searchLocationBtn');

// Debounce search function
let searchTimeout = null;
function performTableSearch() {
  const searchQuery = storeSearchInput.value.trim();
  
  // Clear previous highlights
  clearSearchHighlights();
  
  if (!searchQuery) {
    // If search is cleared, re-render table normally
    renderTable();
    statusDiv.textContent = '';
    return;
  }

  // Get visible scans (filtered by active project)
  const activeProjectId = getActiveProjectId();
  let visibleScans = activeProjectId 
    ? scans.filter(s => s.projectId === activeProjectId)
    : scans;

  if (visibleScans.length === 0) {
    statusDiv.textContent = 'No data to search through';
    setTimeout(() => {
      statusDiv.textContent = '';
    }, 2000);
    return;
  }

  // Search only in store name (as requested)
  const searchLower = searchQuery.toLowerCase();
  const filteredScans = visibleScans.filter(scan => {
    return scan.storeName && scan.storeName.toLowerCase().includes(searchLower);
  });

  // Re-render table with filtered results
  renderTableWithFilter(filteredScans);

  if (filteredScans.length > 0) {
    // Update status
    const plural = filteredScans.length === 1 ? 'result' : 'results';
    statusDiv.textContent = `Found ${filteredScans.length} ${plural} for "${searchQuery}"`;
    
    // Clear status after 5 seconds
    setTimeout(() => {
      statusDiv.textContent = '';
    }, 5000);
  } else {
    statusDiv.textContent = `No results found for "${searchQuery}"`;
    setTimeout(() => {
      statusDiv.textContent = '';
    }, 3000);
  }
}

// currentSearchFilter moved to top of file

// Render table with filtered scans
function renderTableWithFilter(filteredScans) {
  currentSearchFilter = filteredScans;
  renderTable();
  currentSearchFilter = null;
}

function clearSearchHighlights() {
  // Remove highlight class from all rows
  const allRows = document.querySelectorAll('.table-row');
  allRows.forEach(row => {
    row.classList.remove('search-highlight');
  });
}

function highlightSearchResults(indices) {
  // Add highlight class to found rows
  const allRows = document.querySelectorAll('.table-row');
  indices.forEach(index => {
    if (allRows[index]) {
      allRows[index].classList.add('search-highlight');
    }
  });
}

function scrollToSearchResult(index) {
  // Scroll to the first found result
  const allRows = document.querySelectorAll('.table-row');
  if (allRows[index]) {
    allRows[index].scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }
}

searchLocationBtn.addEventListener('click', performTableSearch);

// Allow Enter key to trigger search
storeSearchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performTableSearch();
  }
});

// Search as you type (debounced)
storeSearchInput.addEventListener('input', (e) => {
  // Clear previous timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  
  // Debounce search - wait 300ms after user stops typing
  searchTimeout = setTimeout(() => {
    performTableSearch();
  }, 300);
  
  // If input is cleared, immediately clear and re-render
  if (e.target.value.trim() === '') {
    clearSearchHighlights();
    statusDiv.textContent = '';
    renderTable();
  }
});

// ---------- Geolocation ----------
let currentLocation = { lat: '', lng: '' };

async function initLocation() {
  statusDiv.textContent = 'Requesting location…';
  currentLocation = await getCurrentLocation(true);
  if (!currentLocation.lat) {
    statusDiv.textContent = 'Location unavailable – scans will show N/A';
  } else {
    statusDiv.textContent = '';
  }
  locationInitialized = true;
}

function getCurrentLocation(initial = false) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ lat: '', lng: '' });

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        resolve({ lat: latitude.toFixed(6), lng: longitude.toFixed(6) });
      },
      err => {
        if (!initial) console.warn('Geolocation error', err.message);
        resolve({ lat: '', lng: '' });
      },
      { enableHighAccuracy: true, timeout: GEO_FAST_TIMEOUT_MS, maximumAge: 60000 }
    );
  });
}

// --- Reverse geocoding via OpenStreetMap Nominatim (Singapore) ---
// Converts lat/lon to structured address parts using Nominatim and returns
// an object with { address, houseNo, street, building, postcode }.
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&namedetails=1&zoom=18`;
    const headers = { 'Accept': 'application/json' };
    const res = await fetchWithTimeout(url, { headers, timeoutMs: REVERSE_TIMEOUT_MS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const a = data.address || {};
    const houseNo = a.house_number || a.block || '';
    const street = a.road || a.pedestrian || a.footway || a.path || a.cycleway || a.street || '';
    const postcode = a.postcode || '';
    const building = (data.namedetails && data.namedetails.name) || data.name || a.building || '';

    const parts = [houseNo, street, building, 'SINGAPORE', postcode].filter(Boolean);
    const fullAddress = data.display_name || parts.join(' ').trim();

    return { address: fullAddress, houseNo, street, building, postcode };
  } catch (err) {
    console.warn('Reverse geocode (Nominatim) failed', err);
    return { address: '', houseNo: '', street: '', building: '', postcode: '' };
  }
}

// Helper function to calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in kilometers
}
// ----------- Dictionary + spell-correction setup -----------
// Dictionary loading disabled to prevent unwanted .txt file downloads
// Spell correction will be skipped (functionality still works without it)
let englishWords = [];
// Dictionary loading removed - spell correction disabled to prevent .txt file downloads
// If spell correction is needed in the future, use an inline dictionary or load on-demand
// --- ChatGPT integration ---
async function extractInfoGPT(rawText) {
  if (!hasOpenAIProxy()) return null;
  try {
    const data = await callOpenAIProxy('/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        temperature: 0,
        messages: [
          { role: 'system', content: 'You extract structured data from storefront OCR text. The text may be in any language (English, Chinese, Malay, Tamil, Japanese, Korean, etc.). Extract information accurately regardless of the language used.' },
          { role: 'user', content: `Extract JSON with keys: storeName, storeNameSecondary, unitNumber, address, category from this OCR text.\n\nLANGUAGE HANDLING RULES:\n1. If the OCR shows the SAME store name in BOTH English and another language (e.g., "Starbucks" and "星巴克"):\n   - storeName: Use the English version (primary)\n   - storeNameSecondary: Use the non-English version (secondary)\n\n2. If the OCR shows DIFFERENT names in different languages (e.g., "Coffee Shop" in English and "咖啡店" in Chinese):\n   - storeName: Use the English name (primary)\n   - storeNameSecondary: Use the non-English name (secondary)\n\n3. If the OCR contains ONLY non-English text:\n   - storeName: Use the non-English text (primary)\n   - storeNameSecondary: Leave empty or omit the key\n\n4. If the OCR contains ONLY English text:\n   - storeName: Use the English text (primary)\n   - storeNameSecondary: Leave empty or omit the key\n\nFor category, choose the most appropriate from: Art, Attractions, Auto, Beauty Services, Commercial Building, Education, Essentials, Financial, Food and Beverage, General Merchandise, Government Building, Healthcare, Home Services, Hotel, Industrial, Local Services, Mass Media, Nightlife, Physical Feature, Professional Services, Religious Organization, Residential, Sports and Fitness, Travel. Use "Not Found" if unknown.\n\nOCR: """${rawText}"""` }
        ]
    });
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    // Combine storeName and storeNameSecondary if both exist
    if (parsed.storeName && parsed.storeNameSecondary) {
      parsed.storeName = `${parsed.storeName} / ${parsed.storeNameSecondary}`;
    } else if (parsed.storeNameSecondary && !parsed.storeName) {
      // If only secondary exists, make it primary
      parsed.storeName = parsed.storeNameSecondary;
    }
    // Remove storeNameSecondary as we've combined it
    delete parsed.storeNameSecondary;
    return parsed;
  } catch (err) {
    console.warn('ChatGPT parsing failed', err);
    return null;
  }
}

function correctStoreName(name) {
  if (!name || !englishWords.length || typeof didYouMean !== 'function') return name;

  // Break by whitespace / punctuation while preserving words
  const tokens = name.split(/(\s+)/); // keep spaces as tokens
  const corrected = tokens.map(tok => {
    if (/^\s+$/.test(tok)) return tok; // keep spaces
    const suggestion = didYouMean(tok.toLowerCase(), englishWords, { threshold: 0.4 });
    return suggestion ? capitalize(suggestion) : tok;
  });
  return corrected.join('');
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    video.srcObject = stream;
    window.currentCameraStream = stream;
    cameraInitialized = true;
    try {
      const track = stream.getVideoTracks && stream.getVideoTracks()[0];
      if (track) {
        enableAutofocus(track);
        initTrackZoom(track);
      }
    } catch (_) {}
    // After permission granted, enumerate to find ultra-wide if available
    detectAvailableCameras().catch(()=>{});
  } catch (err) {
    console.error(err);
    statusDiv.textContent = 'Camera access denied: ' + err.message;
    cameraInitialized = false;
  }
}

// --- Zoom functionality ---
const defaultZoom = 1.0;
let currentZoom = defaultZoom;
let minZoom = 0.5; // allow zooming out to 0.5x (fallback CSS)
let maxZoom = 5.0;
let zoomStep = 0.2;
// Hysteresis to avoid rapid lens switching around threshold
const lensSwitchLow = 0.55;  // switch to ultra only below this
const lensSwitchHigh = 0.65; // switch to wide only above this
let useTrackZoom = false; // prefer hardware zoom when supported
let trackCapabilities = null;

// Try to enable continuous autofocus when available
function enableAutofocus(track) {
  try {
    const caps = track.getCapabilities && track.getCapabilities();
    if (!caps) return;
    // Some browsers expose focusMode; try continuous or auto
    const modes = caps.focusMode || caps.focusModes || [];
    if (Array.isArray(modes)) {
      if (modes.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(()=>{});
      } else if (modes.includes('auto')) {
        track.applyConstraints({ advanced: [{ focusMode: 'auto' }] }).catch(()=>{});
      }
    }
  } catch (_) {}
}

// Prefer native camera zoom if supported by the track
function initTrackZoom(track) {
  try {
    const caps = track.getCapabilities && track.getCapabilities();
    if (caps && typeof caps.zoom === 'object' && typeof caps.zoom.min === 'number') {
      useTrackZoom = true;
      trackCapabilities = caps;
      // Align UI limits with hardware limits
      minZoom = typeof caps.zoom.min === 'number' ? caps.zoom.min : minZoom;
      maxZoom = typeof caps.zoom.max === 'number' ? caps.zoom.max : maxZoom;
      const range = Math.max(0.1, maxZoom - minZoom);
      zoomStep = Math.max(0.05, range / 20);
    }
  } catch (_) {}
}

// Tap-to-focus (best-effort). Uses pointsOfInterest when available.
video.addEventListener('click', (e) => {
  try {
    const stream = window.currentCameraStream;
    if (!stream) return;
    const track = stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;
    const caps = track.getCapabilities();
    const rect = video.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Visual focus indicator
    showFocusRing(e.clientX, e.clientY);

    const advanced = [];
    if (caps.pointsOfInterest) {
      advanced.push({ pointsOfInterest: [{ x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) }] });
    }
    const modes = caps.focusMode || [];
    if (Array.isArray(modes) && modes.includes('single-shot')) {
      advanced.push({ focusMode: 'single-shot' });
    }
    if (advanced.length) {
      track.applyConstraints({ advanced }).catch(()=>{});
    }
  } catch (_) {}
});

function showFocusRing(clientX, clientY) {
  try {
    const ring = document.createElement('div');
    ring.style.position = 'fixed';
    ring.style.left = (clientX - 30) + 'px';
    ring.style.top = (clientY - 30) + 'px';
    ring.style.width = '60px';
    ring.style.height = '60px';
    ring.style.border = '2px solid #00b14f';
    ring.style.borderRadius = '8px';
    ring.style.boxShadow = '0 0 8px rgba(0,0,0,0.25)';
    ring.style.pointerEvents = 'none';
    ring.style.zIndex = '9999';
    ring.style.transition = 'opacity 400ms ease, transform 400ms ease';
    document.body.appendChild(ring);
    requestAnimationFrame(() => {
      ring.style.transform = 'scale(0.9)';
      ring.style.opacity = '0.85';
    });
    setTimeout(() => {
      ring.style.opacity = '0';
      ring.style.transform = 'scale(1.1)';
      setTimeout(() => { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 300);
    }, 500);
  } catch (_) {}
}

// Device-based zoom (switching physical lenses when available)
let cameraDevices = { wide: null, ultra: null };
let currentCameraType = 'wide';
let isSwitchingCamera = false;

async function detectAvailableCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(d => d.kind === 'videoinput');
    const labelsKnown = videoInputs.some(d => d.label);
    // Try to infer wide from current track
    const currentTrack = (window.currentCameraStream && window.currentCameraStream.getVideoTracks()[0]) || null;
    if (currentTrack) {
      const settings = currentTrack.getSettings && currentTrack.getSettings();
      if (settings && settings.deviceId) cameraDevices.wide = settings.deviceId;
    }
    for (const d of videoInputs) {
      const label = (d.label || '').toLowerCase();
      if (!cameraDevices.wide) {
        // Prefer back/environment camera for wide
        if (label.includes('back') || label.includes('rear') || label.includes('environment')) {
          cameraDevices.wide = d.deviceId;
        }
      }
      if (!cameraDevices.ultra) {
        if (label.includes('ultra') || label.includes('ultra-wide') || /\b0\.5\b/.test(label) || label.includes('0.5')) {
          cameraDevices.ultra = d.deviceId;
        }
      }
    }
    // Fallback wide: first videoinput
    if (!cameraDevices.wide && videoInputs[0]) cameraDevices.wide = videoInputs[0].deviceId;
    return { ...cameraDevices, labelsKnown };
  } catch (e) {
    return cameraDevices;
  }
}

async function switchToCamera(type) {
  if (isSwitchingCamera) return;
  const targetId = type === 'ultra' ? cameraDevices.ultra : cameraDevices.wide;
  if (!targetId) return; // nothing to do
  try {
    isSwitchingCamera = true;
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: targetId } },
      audio: false
    });
    // Stop previous tracks
    const old = window.currentCameraStream;
    if (old) {
      old.getTracks().forEach(t => t.stop());
    }
    window.currentCameraStream = newStream;
    video.srcObject = newStream;
    currentCameraType = type;
    // When switching lens, reset CSS transform to 1 to reflect native FOV
    video.style.transform = 'scale(1)';
    zoomLevelSpan.textContent = type === 'ultra' ? '0.5x' : '1.0x';
  } catch (e) {
    // ignore failures
  } finally {
    isSwitchingCamera = false;
  }
}

// Zoom state management
function updateZoomLevel(newZoom) {
  currentZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));

  // Prefer hardware zoom when supported
  const stream = window.currentCameraStream;
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (isZooming) {
    // During pinch gesture: avoid hardware constraints and lens switches; use CSS only
    const cssScale = currentCameraType === 'ultra' ? Math.max(1, currentZoom / 0.5) : currentZoom;
    video.style.transform = `scale(${cssScale})`;
    video.style.transformOrigin = 'center center';
  } else {
    if (useTrackZoom && track && track.applyConstraints) {
      track.applyConstraints({ advanced: [{ zoom: currentZoom }] }).catch(()=>{});
      video.style.transform = 'scale(1)';
    } else {
      // Device-based lens switch with hysteresis to prevent flapping
      if (currentZoom <= lensSwitchLow && currentCameraType !== 'ultra' && cameraDevices.ultra) {
        switchToCamera('ultra');
        currentZoom = 0.5;
      } else if (currentZoom >= lensSwitchHigh && currentCameraType !== 'wide' && cameraDevices.wide) {
        switchToCamera('wide');
        currentZoom = Math.max(1.0, currentZoom);
      }
      const cssScale = currentCameraType === 'ultra' ? Math.max(1, currentZoom / 0.5) : currentZoom;
      video.style.transform = `scale(${cssScale})`;
      video.style.transformOrigin = 'center center';
    }
  }
  
  // Update zoom level display
  zoomLevelSpan.textContent = `${currentZoom.toFixed(1)}x`;
  
  // Update button states
  zoomOutBtn.disabled = currentZoom <= minZoom;
  zoomInBtn.disabled = currentZoom >= maxZoom;
  
  // Show/hide reset button
  zoomResetBtn.style.opacity = currentZoom > minZoom ? '1' : '0.6';
}

// Zoom control event listeners
zoomInBtn.addEventListener('click', () => {
  updateZoomLevel(currentZoom + zoomStep);
});

zoomOutBtn.addEventListener('click', () => {
  updateZoomLevel(currentZoom - zoomStep);
});

zoomResetBtn.addEventListener('click', () => {
  updateZoomLevel(defaultZoom);
});

// Mouse wheel zoom for desktop
video.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
  updateZoomLevel(currentZoom + delta);
}, { passive: false });

// Touch gesture handling for mobile devices
let initialDistance = 0;
let initialZoom = 1.0;
let isZooming = false;

// Helper function to get distance between two touch points
function getDistance(touches) {
  if (touches.length < 2) return 0;
  const touch1 = touches[0];
  const touch2 = touches[1];
  return Math.sqrt(
    Math.pow(touch2.clientX - touch1.clientX, 2) + 
    Math.pow(touch2.clientY - touch1.clientY, 2)
  );
}

// Touch start - initialize pinch-to-zoom
video.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    isZooming = true;
    initialDistance = getDistance(e.touches);
    initialZoom = currentZoom;
  }
}, { passive: false });

// Touch move - handle pinch-to-zoom
video.addEventListener('touchmove', (e) => {
  if (isZooming && e.touches.length === 2) {
    e.preventDefault();
    const currentDistance = getDistance(e.touches);
    
    if (initialDistance > 0) {
      const scale = currentDistance / initialDistance;
      const newZoom = initialZoom * scale;
      updateZoomLevel(newZoom);
    }
  }
}, { passive: false });

// Touch end - cleanup pinch-to-zoom
video.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) {
    isZooming = false;
    initialDistance = 0;
    // Commit hardware zoom / lens switch after pinch ends
    updateZoomLevel(currentZoom);
  }
}, { passive: false });

// Keyboard shortcuts for zoom (optional enhancement)
document.addEventListener('keydown', (e) => {
  // Only handle zoom shortcuts when not typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    updateZoomLevel(currentZoom + zoomStep);
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    updateZoomLevel(currentZoom - zoomStep);
  } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    updateZoomLevel(minZoom);
  }
});

// Initialize zoom controls
updateZoomLevel(currentZoom);

// --- Duplicate Detection Functions ---
function isDuplicateStore(newStore) {
  // Check if a store with the same name and address already exists
  return scans.some(existingStore => {
    // Normalize strings for comparison (trim whitespace, convert to lowercase)
    const existingName = (existingStore.storeName || '').trim().toLowerCase();
    const newName = (newStore.storeName || '').trim().toLowerCase();
    const existingAddress = (existingStore.address || '').trim().toLowerCase();
    const newAddress = (newStore.address || '').trim().toLowerCase();
    
    // Skip comparison if either name is "Not Found" or empty
    if (!existingName || !newName || existingName === 'not found' || newName === 'not found') {
      return false;
    }
    
    // Skip comparison if either address is "Not Found" or empty
    if (!existingAddress || !newAddress || existingAddress === 'not found' || newAddress === 'not found') {
      return false;
    }
    
    // Consider it a duplicate if both name and address match exactly
    const nameMatch = existingName === newName;
    const addressMatch = existingAddress === newAddress;
    
    return nameMatch && addressMatch;
  });
}

function showDuplicateDetected(storeName, address) {
  // Hide the scanning overlay first
  hideScanningOverlay();
  
  // Show duplicate detection overlay with custom styling
  if (scanningOverlay && scanningText) {
    scanningText.textContent = '⚠️ Duplicate Detected';
    scanningOverlay.classList.add('show', 'duplicate-warning');
    
    // Hide the spinner for duplicate warning
    const spinner = document.querySelector('.spinner');
    if (spinner) {
      spinner.style.display = 'none';
    }
    
    // Create detailed message
    const duplicateMessage = document.createElement('div');
    duplicateMessage.className = 'duplicate-message';
    duplicateMessage.innerHTML = `
      <div class="duplicate-details">
        <strong>${storeName}</strong><br>
        <small>${address}</small><br>
        <em>Already exists in your data</em>
      </div>
    `;
    
    // Add message to scanning content
    const scanningContent = document.querySelector('.scanning-content');
    if (scanningContent) {
      scanningContent.appendChild(duplicateMessage);
    }
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      scanningOverlay.classList.remove('show', 'duplicate-warning');
      if (duplicateMessage && duplicateMessage.parentNode) {
        duplicateMessage.parentNode.removeChild(duplicateMessage);
      }
      // Restore spinner visibility for next scan
      if (spinner) {
        spinner.style.display = 'block';
      }
    }, 3000);
  }
  
  // Also show in status div as backup
  statusDiv.textContent = `Duplicate detected: "${storeName}" already exists`;
  statusDiv.style.color = '#ff6b35';
  setTimeout(() => {
    statusDiv.textContent = '';
    statusDiv.style.color = '';
  }, 3000);
  
  console.log(`Duplicate store detected and rejected: "${storeName}" at "${address}"`);
}

async function buildScanInfo(canvas, { statusElement = statusDiv, showOverlay = true, fixedLocation = null } = {}) {
  const updateStatus = message => {
    if (statusElement) {
      statusElement.textContent = message || '';
    }
  };

  const updateProgress = percent => {
    if (showOverlay && progressBar) {
      progressBar.style.display = 'block';
      progressFill.style.width = `${percent}%`;
    }
  };

  if (showOverlay) {
    showScanningOverlay('Scanning...');
    updateProgress(0);
  }
  updateStatus('Scanning…');

  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);

  // Check if this is a Residential project (custom tab)
  const activeProject = getActiveProject();
  const isResidentialProject = activeProject?.isCustomTab && activeProject?.projectCategory === 'Residential';

  let parsed = null;
  if (hasOpenAIProxy()) {
    if (showOverlay) showScanningOverlay('Analyzing...');
    
    if (isResidentialProject) {
      // For Residential projects, extract house number only
      const street = activeProject?.defaultAddress?.street || '';
      
      // Check if a house number was pre-selected in Street Navigator
      const preSelectedHouseNumber = getSelectedHouseNumber();
      
      if (preSelectedHouseNumber) {
        // Use the pre-selected house number from Street Navigator
        console.log(`📍 Using pre-selected house number: ${preSelectedHouseNumber}`);
        updateStatus(`Using selected: #${preSelectedHouseNumber}`);
        
        // Find additional address info from streetAddresses
        const addrInfo = streetAddresses.find(a => a.houseNo === preSelectedHouseNumber);
        
        parsed = {
          storeName: street ? `${preSelectedHouseNumber} ${street}` : preSelectedHouseNumber,
          houseNo: preSelectedHouseNumber,
          unitNumber: '', // Always blank for residential
          category: 'Residential', // Fixed category
          address: addrInfo?.address || `${preSelectedHouseNumber} ${street}`.trim(),
          postcode: addrInfo?.postcode || '',
          confidence: 'user-selected',
          detectedLocation: 'Street Navigator'
        };
        console.log('🏠 Residential scan (pre-selected):', parsed);
      } else {
        // No pre-selection, use AI to detect house number
      updateStatus('Detecting house number…');
      const residentialResult = await extractResidentialInfoVision(imageDataUrl);
      if (residentialResult && residentialResult.houseNumber) {
        const houseNumber = residentialResult.houseNumber;
          
          // Check if detected number exists in our street addresses
          const addrInfo = streetAddresses.find(a => a.houseNo === houseNumber);
        
        // Compose parsed data for residential
        parsed = {
          storeName: street ? `${houseNumber} ${street}` : houseNumber,
          houseNo: houseNumber,
          unitNumber: '', // Always blank for residential
          category: 'Residential', // Fixed category
            address: addrInfo?.address || `${houseNumber} ${street}`.trim(),
            postcode: addrInfo?.postcode || '',
          confidence: residentialResult.confidence,
          detectedLocation: residentialResult.location
        };
        console.log('🏠 Residential scan result:', parsed);
      } else {
        console.warn('⚠️ Could not detect house number from image');
        // Create a placeholder for manual entry
        parsed = {
          storeName: 'House Number Not Detected',
          houseNo: '',
          unitNumber: '',
          category: 'Residential',
            address: street || ''
        };
        }
      }
    } else {
      // For Commercial and standard projects, use regular extraction
      updateStatus('Analyzing with GPT-4o…');
      parsed = await extractInfoVision(imageDataUrl);
      if (parsed) {
        console.log('Vision JSON:', parsed);
      }
    }
  } else {
    console.info('OpenAI proxy not configured; skipping GPT-4o vision extraction.');
  }

  // Use fixed location if provided (for bulk uploads), otherwise use current location or fetch new one
  let geo = fixedLocation || currentLocation;
  if (!geo || !geo.lat) {
    geo = await getCurrentLocation();
  }

  if (!parsed) {
    // Support multiple languages: English, Chinese (Simplified/Traditional), Malay, Tamil
    // Tesseract.js will automatically detect and use the appropriate language(s)
    // Falls back to English-only if multi-language data files aren't available
    let result;
    try {
      result = await Tesseract.recognize(canvas, 'eng+chi_sim+chi_tra+msa+tam', {
        logger: m => {
          if (m.progress !== undefined) {
            const percent = Math.floor(m.progress * 100);
            updateStatus(`Scanning… ${percent}%`);
            updateProgress(percent);
          }
        },
        // Remove character whitelist to allow non-English characters
        tessedit_pageseg_mode: 6
      });
    } catch (multiLangError) {
      console.warn('Multi-language OCR failed, falling back to English-only:', multiLangError);
      // Fallback to English-only if multi-language fails
      result = await Tesseract.recognize(canvas, 'eng', {
        logger: m => {
          if (m.progress !== undefined) {
            const percent = Math.floor(m.progress * 100);
            updateStatus(`Scanning… ${percent}%`);
            updateProgress(percent);
          }
        },
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:#&-.',
        tessedit_pageseg_mode: 6
      });
    }

    const { text, confidence, lines } = result.data;
    console.log('OCR confidence', confidence);

    if (showOverlay) showScanningOverlay('Processing text...');
    updateStatus('Processing…');

    parsed = await extractInfoGPT(text);
    if (!parsed) parsed = extractInfo(text, lines);
  }

  // Map category to company category, but skip for Residential projects (category is fixed)
  if (parsed && parsed.category && !isResidentialProject) {
    parsed.category = await mapToCompanyCategory(parsed.category);
  }

  let finalLat = geo.lat || '';
  let finalLng = geo.lng || '';
  let addressParts;
  if (geo.lat && geo.lng) {
    try {
      addressParts = await reverseGeocode(geo.lat, geo.lng);
    } catch (_) {
      addressParts = { address: '', houseNo: '', street: '', building: '', postcode: '' };
    }
  } else {
    addressParts = {
      address: parsed?.address || '',
      houseNo: '',
      street: '',
      building: '',
      postcode: ''
    };
  }

  const timestamp = new Date().toISOString();
  // Generate unique entry ID FIRST - this will be used for image filename
  const entryId = 'entry-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const photoId = `photo_${timestamp.replace(/[:.]/g, '-').slice(0, -5)}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Validate canvas has content before creating thumbnail
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    console.error('❌ Canvas is empty, cannot create thumbnail');
    throw new Error('Canvas is empty');
  }
  
  const fullResBlob = await new Promise(resolve => { canvas.toBlob(resolve, 'image/jpeg', 0.9); });
  // Determine file extension based on blob type (default to jpg)
  const blobType = fullResBlob?.type || 'image/jpeg';
  const extension = blobType.includes('png') ? 'png' : 'jpg';
  
  // Get floor and building from project settings (defaultAddress), with "Unknown" as fallback
  // This happens BEFORE async operations complete, so we use project defaults
  const project = getActiveProject();
  const projectFloor = project?.defaultAddress?.floor || 'Unknown';
  const projectBuilding = project?.defaultAddress?.building || 'Unknown';
  const floor = projectFloor.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const building = projectBuilding.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 30).toUpperCase();
  const floorBuilding = [floor, building].filter(Boolean).join('_');
  
  // Create filename in format: Floor_Building_EntryID (e.g., L1_ION_ORCHARD_entry12345)
  const photoFilename = floorBuilding 
    ? `${floorBuilding}_${entryId}.${extension}`
    : `${entryId}.${extension}`;
  
  const thumbDataUrl = createThumbnailDataURL(canvas, 400, 400, 0.6);
  
  // Validate thumbnail was created
  if (!thumbDataUrl || thumbDataUrl.length === 0) {
    console.error('❌ Thumbnail creation failed, thumbDataUrl is empty');
    throw new Error('Failed to create thumbnail');
  }
  
  console.log('✅ Thumbnail created successfully, length:', thumbDataUrl.length);

  // Create base info object with photoData FIRST
  // For Residential projects, use project defaults for street, building, postcode
  const baseInfo = {
    lat: finalLat,
    lng: finalLng,
    address: isResidentialProject 
      ? (parsed?.address || `${parsed?.houseNo || ''} ${activeProject?.defaultAddress?.street || ''}`.trim())
      : (addressParts?.address || parsed?.address || ''),
    houseNo: isResidentialProject 
      ? (parsed?.houseNo || '')
      : (addressParts?.houseNo || parsed?.houseNo || ''),
    street: isResidentialProject 
      ? (activeProject?.defaultAddress?.street || '')
      : (addressParts?.street || parsed?.street || ''),
    building: isResidentialProject 
      ? (activeProject?.defaultAddress?.building || '')
      : (addressParts?.building || parsed?.building || ''),
    postcode: isResidentialProject 
      ? (activeProject?.defaultAddress?.postcode || '')
      : (addressParts?.postcode || parsed?.postcode || ''),
    photoData: thumbDataUrl, // Set photoData FIRST
    timestamp,
    photoFilename,
    photoId,
    entryId // Include entryId so it's available throughout the scan process
  };
  
  // Merge parsed data, but EXCLUDE photoData from parsed (we want to keep our thumbnail)
  const parsedWithoutPhoto = { ...parsed };
  delete parsedWithoutPhoto.photoData; // Remove photoData from parsed to prevent overwrite
  delete parsedWithoutPhoto.photoDataUrl; // Also remove photoDataUrl if present
  
  const info = sanitizeObjectStrings(Object.assign(baseInfo, parsedWithoutPhoto));
  
  // Ensure photoData is preserved after sanitization
  if (!info.photoData && thumbDataUrl) {
    info.photoData = thumbDataUrl;
  }
  
  // CRITICAL FIX: Process unit number - auto-fill from floor if not found, always prefix with #
  // Skip unit number processing for Residential projects (unit number should always be blank)
  if (isResidentialProject) {
    info.unitNumber = ''; // Always blank for residential
  } else {
    // Note: project and floor are already declared above, so we reuse them
    const infoFloor = info.floor || project?.defaultAddress?.floor || '';
    
    // Extract unit number from parsed data
    let unitNumber = info.unitNumber || parsed?.unitNumber || '';
    
    // Filter out "Not Found" and other placeholder values (case-insensitive)
    const unitLower = (unitNumber || '').toLowerCase().trim();
    if (unitLower === 'not found' || unitLower === 'unknown' || unitLower === 'n/a' || unitLower === '') {
      unitNumber = '';
    }
    
    // If unit number not found, auto-fill based on floor
    if (!unitNumber && infoFloor) {
      const floorUpper = infoFloor.toUpperCase().trim();
      // Handle basement levels B1/B2/B3/B4
      if (floorUpper === 'B1' || floorUpper.startsWith('B1')) {
        unitNumber = '#B1-';
      } else if (floorUpper === 'B2' || floorUpper.startsWith('B2')) {
        unitNumber = '#B2-';
      } else if (floorUpper === 'B3' || floorUpper.startsWith('B3')) {
        unitNumber = '#B3-';
      } else if (floorUpper === 'B4' || floorUpper.startsWith('B4')) {
        unitNumber = '#B4-';
      } else {
        // Extract number from floor (e.g., L4 -> 4)
        const floorMatch = infoFloor.match(/(\d+)/);
        if (floorMatch) {
          const floorNum = floorMatch[1];
          unitNumber = `#${floorNum}-`;
        }
      }
    }
    
    // Always prefix unit number with # if it exists and doesn't already start with #
    if (unitNumber && !unitNumber.trim().startsWith('#')) {
      unitNumber = `#${unitNumber.trim()}`;
    }
    
    // Ensure unit number is set (empty string if nothing found)
    info.unitNumber = unitNumber || '';
  }

  return { info, fullResBlob };
}

// --- Helper: run OCR + processing on any canvas source (camera or uploaded) ---
async function performScanFromCanvas(canvas) {
  try {
    const analysis = await buildScanInfo(canvas, { statusElement: statusDiv, showOverlay: true });
    const info = analysis?.info;
    if (!info) {
      statusDiv.textContent = 'Unable to read this photo.';
      return;
    }

    if (isDuplicateStore(info)) {
      showDuplicateDetected(info.storeName, info.address);
      statusDiv.textContent = '';
      progressBar.style.display = 'none';
      return;
    }

    if (analysis.fullResBlob) {
      savePhotoBlob(info.photoId, analysis.fullResBlob, info.photoFilename);
    }

    // entryId is already generated in buildScanInfo and included in info
    // Ensure syncStatus is set
    info.syncStatus = 'pending'; // Track sync status: 'pending' or 'synced'
    
    // CRITICAL FIX: Inject project data and default address
    // Always get the active project at scan time to ensure correct projectId
    const project = getActiveProject();
    if (project) {
      info.projectId = project.id; // CRITICAL: Must be set for data isolation
      info.projectName = project.name;
      info.projectLocation = project.location;
      info.projectDate = project.date;
      info.projectEmail = project.email;
      info.environment = project.environment || 'Indoor'; // Indoor or Outdoor
      
      // Apply default address - OVERRIDE scan results if default is set
      if (project.defaultAddress) {
        // If default value is set, use it (override scan result)
        if (project.defaultAddress.houseNo) {
          info.houseNo = project.defaultAddress.houseNo;
        }
        if (project.defaultAddress.street) {
          info.street = project.defaultAddress.street;
        }
        if (project.defaultAddress.floor) {
          info.floor = project.defaultAddress.floor;
        }
        if (project.defaultAddress.building) {
          info.building = project.defaultAddress.building;
        }
        if (project.defaultAddress.postcode) {
          info.postcode = project.defaultAddress.postcode;
        }
      }
      
      // CRITICAL FIX: Auto-fill unit number from floor if not found
      // First, filter out "Not Found" and other placeholder values
      const unitLower = (info.unitNumber || '').toLowerCase().trim();
      if (unitLower === 'not found' || unitLower === 'unknown' || unitLower === 'n/a' || unitLower === '') {
        info.unitNumber = '';
      }
      
      const floor = info.floor || project?.defaultAddress?.floor || '';
      if (!info.unitNumber && floor) {
        // Extract number from floor (e.g., L4 -> 4, B2 -> 2)
        const floorMatch = floor.match(/(\d+)/);
        if (floorMatch) {
          const floorNum = floorMatch[1];
          info.unitNumber = `#${floorNum}-`;
        }
      }
    } else {
      // CRITICAL FIX: If no active project, warn user but still allow scan
      console.warn('⚠️ No active project set! Scan will not be associated with a project.');
      info.projectId = null; // Explicitly set to null if no project
    }
    
    // CRITICAL FIX: Always ensure unit number has # prefix if it exists
    if (info.unitNumber && !info.unitNumber.trim().startsWith('#')) {
      info.unitNumber = `#${info.unitNumber.trim()}`;
    }

    // DON'T save immediately - wait for user review
    // Scan will be saved when user clicks "Accept" in review banner

    // Debug: Verify photoData is set
    console.log('📸 Scan created - photoData check:', {
      hasPhotoData: !!info.photoData,
      photoDataLength: info.photoData ? info.photoData.length : 0,
      photoDataPreview: info.photoData ? info.photoData.substring(0, 50) + '...' : 'none',
      photoId: info.photoId
    });

    showScanComplete();
    
    // Show review banner - user can Accept or Reject
    showScanCompleteBanner(info);
  } finally {
    statusDiv.textContent = '';
    progressBar.style.display = 'none';
  }
}

// Helper function to capture and save photo to gallery
async function captureAndSavePhoto(canvas) {
  try {
    // Visual feedback only; no auto share or download
    showPhotoFlash();
    return true;
  } catch (error) {
    console.error('Error saving photo:', error);
    return false;
  }
}

// Helper function to show photo saved notification
function showPhotoSavedNotification(message = '📸 Photo saved to gallery', isError = false) {
  // Create notification element
  const notification = document.createElement('div');
  
  const backgroundColor = isError ? 'rgba(220, 38, 38, 0.95)' : 'rgba(0, 177, 79, 0.95)';
  
  notification.style.cssText = `
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: ${backgroundColor};
    color: white;
    padding: 12px 20px;
    border-radius: 25px;
    font-size: 14px;
    font-weight: 500;
    z-index: 9998;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    animation: slideInOut 4s ease-in-out;
    pointer-events: none;
    backdrop-filter: blur(10px);
    max-width: 280px;
    text-align: center;
  `;
  
  notification.innerHTML = message;
  
  // Add slide animation CSS if not already present
  if (!document.querySelector('#photoNotificationStyle')) {
    const style = document.createElement('style');
    style.id = 'photoNotificationStyle';
    style.textContent = `
      @keyframes slideInOut {
        0% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        12% { opacity: 1; transform: translateX(-50%) translateY(0); }
        88% { opacity: 1; transform: translateX(-50%) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(notification);
  
  // Remove notification after animation
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 4000);
}

// Helper function to show photo capture flash effect
function showPhotoFlash() {
  // Create flash overlay
  const flashOverlay = document.createElement('div');
  flashOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: white;
    z-index: 9999;
    pointer-events: none;
    animation: photoFlash 0.3s ease-out;
  `;
  
  // Add flash animation CSS if not already present
  if (!document.querySelector('#photoFlashStyle')) {
    const style = document.createElement('style');
    style.id = 'photoFlashStyle';
    style.textContent = `
      @keyframes photoFlash {
        0% { opacity: 0; }
        50% { opacity: 0.8; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(flashOverlay);
  
  // Remove flash overlay after animation
  setTimeout(() => {
    if (flashOverlay.parentNode) {
      flashOverlay.parentNode.removeChild(flashOverlay);
    }
  }, 300);
}

// Scan button handler
document.getElementById('scanBtn').addEventListener('click', async () => {
  if (!video.videoWidth) {
    statusDiv.textContent = 'Camera not ready yet, please wait…';
    return;
  }

  showScanningOverlay('Capturing image...');
  statusDiv.textContent = 'Scanning…';
  progressBar.style.display = 'block';
  progressFill.style.width = '0%';

  // Capture current frame
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Check if photo capture is enabled (default: true)
  const photoCaptureEnabled = localStorage.getItem('photoCaptureEnabled') !== 'false';
  
  if (photoCaptureEnabled) {
    // Capture and save photo to gallery (parallel with scanning)
    const photoSaved = await captureAndSavePhoto(canvas);
    
    if (photoSaved) {
      console.log('✅ Photo captured and saved to gallery');
    } else {
      console.warn('⚠️ Failed to save photo to gallery');
    }
  } else {
    console.log('📸 Photo capture disabled by user');
  }

  // Continue with normal scanning process
  await performScanFromCanvas(canvas);
});

// Upload image handler (legacy button, may be absent)
(function setupLegacyUploadHandler() {
  const legacyUploadBtn = document.getElementById('uploadBtn');
  const legacyImageInput = document.getElementById('imageInput');
  if (!legacyUploadBtn || !legacyImageInput) return;

  legacyUploadBtn.addEventListener('click', () => legacyImageInput.click());

  legacyImageInput.addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const total = files.length;
    const failedFiles = [];

    statusDiv.textContent = `Preparing ${total} photo${total > 1 ? 's' : ''}…`;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        await processImageFile(file, index + 1, total);
      } catch (err) {
        console.error('⚠️ Bulk upload error:', err);
        failedFiles.push(file.name || `Photo ${index + 1}`);
        hideScanningOverlay();
        progressBar.style.display = 'none';
      }
    }

    // Reset file input so the same files can be selected again later
    legacyImageInput.value = '';

    if (failedFiles.length) {
      statusDiv.textContent = `Processed ${total - failedFiles.length}/${total} photos. Failed: ${failedFiles.join(', ')}`;
    } else {
      statusDiv.textContent = `Processed ${total}/${total} photos successfully.`;
    }
  });
})();

async function processImageFile(file, currentIndex, total) {
  showScanningOverlay(`Processing photo ${currentIndex} of ${total}…`);
  statusDiv.textContent = `Processing photo ${currentIndex} of ${total}…`;

  let workingFile = file;
  const originalName = file.name || `photo_${currentIndex}`;
  const isHeic = /heic|heif/i.test(file.type) || /\.heic$|\.heif$/i.test(originalName);

  if (isHeic) {
    if (typeof window.heic2any === 'function') {
      showScanningOverlay(`Converting photo ${currentIndex} of ${total}…`);
      statusDiv.textContent = `Converting photo ${currentIndex} of ${total}…`;
      try {
        const conversionResult = await window.heic2any({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.9
        });
        const convertedBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
        if (!(convertedBlob instanceof Blob)) {
          throw new Error('Conversion did not return a valid image blob.');
        }
        const newName = originalName.replace(/\.heic$|\.heif$/i, '.jpg');
        workingFile = new File([convertedBlob], newName, { type: 'image/jpeg' });
      } catch (_) {
        throw new Error(`Could not convert HEIC photo (${originalName}).`);
      }
    } else {
      throw new Error('HEIC images are not supported in this browser.');
    }
  }

  const objectUrl = URL.createObjectURL(workingFile);
  try {
    const img = await loadImage(objectUrl, workingFile.name || originalName);
      const canvas = document.createElement('canvas');
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    if (!width || !height) {
      throw new Error('Invalid image dimensions.');
    }

    canvas.width = width;
    canvas.height = height;
      const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
      
      const photoCaptureEnabled = localStorage.getItem('photoCaptureEnabled') !== 'false';
      if (photoCaptureEnabled) {
        const photoSaved = await captureAndSavePhoto(canvas);
      if (!photoSaved) {
          console.warn('⚠️ Failed to save uploaded photo to gallery');
        }
      }
      
      await performScanFromCanvas(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src, label = 'image') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to decode ${label}`));
    img.src = src;
  });
}

// Extract GPS coordinates from photo EXIF metadata
// Returns { lat, lng } or null if no GPS data found
async function extractGPSFromPhoto(file) {
  return new Promise((resolve) => {
    try {
      // Check if EXIF library is available
      if (typeof EXIF === 'undefined') {
        console.warn('⚠️ EXIF library not loaded, cannot extract GPS from photo');
        resolve(null);
        return;
      }

      EXIF.getData(file, function() {
        try {
          const lat = EXIF.getTag(this, "GPSLatitude");
          const latRef = EXIF.getTag(this, "GPSLatitudeRef");
          const lng = EXIF.getTag(this, "GPSLongitude");
          const lngRef = EXIF.getTag(this, "GPSLongitudeRef");
          
          if (lat && lng && Array.isArray(lat) && Array.isArray(lng)) {
            // Convert EXIF format (degrees, minutes, seconds) to decimal degrees
            const latDecimal = convertDMSToDD(lat, latRef);
            const lngDecimal = convertDMSToDD(lng, lngRef);
            
            if (latDecimal !== null && lngDecimal !== null) {
              console.log(`📍 Extracted GPS from photo EXIF: ${latDecimal}, ${lngDecimal}`);
              resolve({ lat: latDecimal, lng: lngDecimal });
              return;
            }
          }
          
          // No valid GPS data found
          console.log('📍 No GPS data found in photo EXIF');
          resolve(null);
        } catch (error) {
          console.warn('⚠️ Error reading EXIF GPS data:', error);
          resolve(null);
        }
      });
    } catch (error) {
      console.warn('⚠️ Error extracting GPS from photo:', error);
      resolve(null);
    }
  });
}

// Convert Degrees, Minutes, Seconds (DMS) to Decimal Degrees (DD)
function convertDMSToDD(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) {
    return null;
  }
  
  try {
    const degrees = parseFloat(dms[0]) || 0;
    const minutes = parseFloat(dms[1]) || 0;
    const seconds = parseFloat(dms[2]) || 0;
    
    let dd = degrees + minutes / 60 + seconds / (60 * 60);
    
    // Apply reference (S = negative, W = negative)
    if (ref === "S" || ref === "W") {
      dd = dd * -1;
    }
    
    return dd;
  } catch (error) {
    console.warn('⚠️ Error converting DMS to DD:', error);
    return null;
  }
}

// Batch upload handler
// Function to set up batch upload handlers (can be called multiple times after input reset)
let batchUploadHandlersAttached = false;

function setupBatchUploadHandlers() {
  // Re-query elements in case they were replaced
  const currentBatchImageInput = document.getElementById('batchImageInput');
  if (!currentBatchImageInput) {
    console.warn('⚠️ Batch image input not found when setting up handlers');
    return;
  }
  
  // If handlers are already attached, clone the input first to remove old listeners
  // This prevents duplicate listeners when setupBatchUploadHandlers() is called multiple times
  if (batchUploadHandlersAttached) {
    console.log('🔄 Cloning input to remove old listeners before re-attaching...');
    const parent = currentBatchImageInput.parentNode;
    if (parent) {
      const newInput = currentBatchImageInput.cloneNode(true);
      parent.replaceChild(newInput, currentBatchImageInput);
      batchImageInput = newInput;
      batchUploadHandlersAttached = false; // Reset flag since we cloned
    } else {
      // If no parent, just update reference (shouldn't happen normally)
      batchImageInput = currentBatchImageInput;
      batchUploadHandlersAttached = false; // Reset flag to allow attachment
    }
  } else {
    // Update global reference
    batchImageInput = currentBatchImageInput;
  }
  
  // Set up change event handler
  batchImageInput.addEventListener('change', async e => {
    console.log('📁 File input changed event fired');
    
    // CRITICAL FIX: Store reference to input element for Android reset
    const inputElement = e.target;
    
    try {
      const files = Array.from(e.target.files || []);
      console.log(`📸 Files selected: ${files.length}`);
      
      if (!files.length) {
        console.warn('⚠️ No files selected');
        batchStatusDiv.textContent = 'No files selected';
        // Reset input to allow selecting again
        inputElement.value = '';
        return;
      }

      const total = files.length;
      const failedFiles = [];

      // Initialize progress tracking
      batchProcessingStartTime = Date.now();
      batchProcessingTimes = [];
      
      // Show progress indicator
      showBatchProgress(0, total);
      
      // Show immediate feedback
      if (batchStatusDiv) {
        batchStatusDiv.textContent = `📸 ${total} photo${total > 1 ? 's' : ''} selected. Processing...`;
        batchStatusDiv.style.color = '#4be0a8';
        batchStatusDiv.style.display = 'block';
      }
      
      // Force UI update on mobile (especially Android)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Get fallback location (current location) in case photos don't have EXIF GPS
      let fallbackLocation = currentLocation;
      if (!fallbackLocation.lat || !fallbackLocation.lng) {
        console.log('📍 Getting fallback location for batch...');
        batchStatusDiv.textContent = `📍 Getting location...`;
        try {
          fallbackLocation = await Promise.race([
            getCurrentLocation(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Location timeout')), 10000))
          ]);
        } catch (locationError) {
          console.warn('⚠️ Location timeout or error:', locationError);
          fallbackLocation = { lat: '', lng: '' };
        }
        
        if (!fallbackLocation.lat || !fallbackLocation.lng) {
          console.warn('⚠️ Could not get fallback location. Will use EXIF GPS or empty coordinates.');
          fallbackLocation = { lat: '', lng: '' };
        } else {
          console.log('✅ Fallback location obtained:', fallbackLocation);
        }
      }

      console.log(`🚀 Starting to process ${total} files...`);

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const photoStartTime = Date.now();
        console.log(`📷 Processing file ${index + 1}/${total}: ${file.name || 'unnamed'}`);
        
        // Update progress
        updateBatchProgress(index, total);
        
        try {
          // Extract GPS from photo EXIF, fallback to current location if not available
          const photoGPS = await extractGPSFromPhoto(file);
          const photoLocation = photoGPS || fallbackLocation;
          
          await processBatchImageFile(file, index + 1, total, photoLocation);
          
          // Track processing time
          const photoProcessingTime = Date.now() - photoStartTime;
          batchProcessingTimes.push(photoProcessingTime);
          
          console.log(`✅ File ${index + 1}/${total} processed successfully (${photoProcessingTime}ms)`);
        } catch (err) {
          console.error(`❌ Batch upload error for file ${index + 1}:`, err);
          failedFiles.push(file.name || `Photo ${index + 1}`);
          // Continue processing other files
        }
        
        // Update progress after each photo
        updateBatchProgress(index + 1, total);
      }
      
      // Hide progress indicator
      hideBatchProgress();

      // CRITICAL FIX: Clear input to allow selecting same files again (Android fix)
      // Use multiple strategies to ensure input is reset
      resetBatchInput(inputElement);

      // Show final status
      if (batchStatusDiv) {
        if (failedFiles.length) {
          const successCount = total - failedFiles.length;
          batchStatusDiv.textContent = `⚠️ Processed ${successCount}/${total} photos. Failed: ${failedFiles.join(', ')}`;
          batchStatusDiv.style.color = '#ff6b6b';
          console.warn(`⚠️ Batch upload completed with ${failedFiles.length} failures`);
        } else {
          batchStatusDiv.textContent = `✅ Processed ${total}/${total} photos successfully.`;
          batchStatusDiv.style.color = '#4be0a8';
          console.log(`✅ Batch upload completed successfully: ${total} photos`);
        }
      }
      
      // CRITICAL FIX: Update batch cards display
      renderBatchCards();
      
    } catch (error) {
      console.error('❌ Fatal error in batch upload handler:', error);
      if (batchStatusDiv) {
        batchStatusDiv.textContent = `❌ Error: ${error.message || 'Unknown error occurred'}`;
        batchStatusDiv.style.color = '#ff6b6b';
      }
      
      // CRITICAL FIX: Always reset input on error (Android fix)
      resetBatchInput(inputElement);
      
      // Hide progress indicator on error
      hideBatchProgress();
    }
  });
  
  // Also listen for input event (mobile browsers sometimes fire this instead)
  batchImageInput.addEventListener('input', async e => {
    console.log('📁 File input event fired (backup handler)');
    // The change event should handle it, but this ensures mobile compatibility
    // Don't process here to avoid double processing
  });
  
  batchUploadHandlersAttached = true;
  console.log('✅ Batch upload input handlers attached');
}

// Set up batch upload button handler (only needs to be done once)
if (batchUploadBtn) {
  console.log('✅ Batch upload button found, setting up click handler...');
  
  // CRITICAL FIX: Improved click handler with better error handling (Android fix)
  batchUploadBtn.addEventListener('click', function(e) {
    console.log('📷 Batch upload button clicked');
    
    // Prevent multiple rapid clicks
    if (this.disabled) {
      console.warn('⚠️ Button is disabled, ignoring click');
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    
    // Ensure input is ready (re-query in case it was replaced)
    const currentInput = document.getElementById('batchImageInput');
    if (!currentInput) {
      console.error('❌ Batch image input not found');
      if (batchStatusDiv) {
        batchStatusDiv.textContent = 'Error: File input not available';
        batchStatusDiv.style.color = '#ff6b6b';
      }
      return;
    }
    
    // Update global reference
    batchImageInput = currentInput;
    
    try {
      // Reset input value first to ensure it's ready (Android fix)
      batchImageInput.value = '';
      batchImageInput.click();
    } catch (error) {
      console.error('❌ Error triggering file input:', error);
      if (batchStatusDiv) {
        batchStatusDiv.textContent = 'Error: Could not open file picker. Please try again.';
        batchStatusDiv.style.color = '#ff6b6b';
      }
      // Reset button state on error
      setTimeout(() => {
        this.disabled = false;
      }, 500);
    }
  });
  
  console.log('✅ Batch upload button handler set up successfully');
}

// Set up batch upload handlers initially
if (batchImageInput) {
  console.log('✅ Batch upload elements found, setting up handlers...');
  setupBatchUploadHandlers();
} else {
  console.error('❌ Batch upload input not found on initial load');
}

// ===== Progress Indicator Functions =====

function showBatchProgress(current, total) {
  if (!batchProgressContainer) return;
  
  batchProgressContainer.classList.remove('hidden');
  batchProgressTotal.textContent = total;
  batchProgressCurrent.textContent = current;
  batchProgressText.textContent = 'Processing photos...';
  batchProgressTime.textContent = 'Estimating time...';
  updateBatchProgress(current, total);
}

function updateBatchProgress(current, total) {
  if (!batchProgressContainer || !batchProgressFill) return;
  
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  batchProgressFill.style.width = `${percent}%`;
  batchProgressPercent.textContent = `${percent}%`;
  batchProgressCurrent.textContent = current;
  
  // Calculate estimated time remaining
  if (current > 0 && batchProcessingStartTime) {
    const elapsed = Date.now() - batchProcessingStartTime;
    const avgTimePerPhoto = elapsed / current;
    const remaining = total - current;
    const estimatedMs = avgTimePerPhoto * remaining;
    
    if (estimatedMs > 0) {
      const estimatedSeconds = Math.ceil(estimatedMs / 1000);
      if (estimatedSeconds < 60) {
        batchProgressTime.textContent = `~${estimatedSeconds}s remaining`;
      } else {
        const minutes = Math.floor(estimatedSeconds / 60);
        const seconds = estimatedSeconds % 60;
        batchProgressTime.textContent = `~${minutes}m ${seconds}s remaining`;
      }
    } else {
      batchProgressTime.textContent = 'Calculating...';
    }
  } else if (current === 0) {
    // Use default estimate for first photo
    const estimatedMs = AVERAGE_PROCESSING_TIME_MS * total;
    const estimatedSeconds = Math.ceil(estimatedMs / 1000);
    if (estimatedSeconds < 60) {
      batchProgressTime.textContent = `~${estimatedSeconds}s estimated`;
    } else {
      const minutes = Math.floor(estimatedSeconds / 60);
      const seconds = estimatedSeconds % 60;
      batchProgressTime.textContent = `~${minutes}m ${seconds}s estimated`;
    }
  }
}

function hideBatchProgress() {
  if (batchProgressContainer) {
    batchProgressContainer.classList.add('hidden');
  }
  batchProcessingStartTime = null;
}

// ===== Android Input Reset Function =====

function resetBatchInput(inputElement) {
  if (!inputElement) return;
  
  try {
    // Strategy 1: Clear value
    inputElement.value = '';
    
    // Strategy 2: Clone and replace (more reliable on Android)
    const parent = inputElement.parentNode;
    if (parent) {
      const newInput = inputElement.cloneNode(true);
      parent.replaceChild(newInput, inputElement);
      
      // Update global reference first
      batchImageInput = newInput;
      
      // Reset flag since we cloned (new element has no listeners)
      batchUploadHandlersAttached = false;
      
      // CRITICAL FIX: Re-attach event listeners after cloning
      setupBatchUploadHandlers();
    }
    
    // Strategy 3: Re-enable button
    if (batchUploadBtn) {
      batchUploadBtn.disabled = false;
    }
    
    console.log('✅ Batch input reset successfully, handlers re-attached');
  } catch (error) {
    console.error('⚠️ Error resetting batch input:', error);
    // Fallback: just clear value and re-enable button
    try {
      inputElement.value = '';
      if (batchUploadBtn) {
        batchUploadBtn.disabled = false;
      }
      // Reset flag and try to re-attach handlers even in fallback
      batchUploadHandlersAttached = false;
      setupBatchUploadHandlers();
    } catch (fallbackError) {
      console.error('❌ Fallback reset also failed:', fallbackError);
    }
  }
}

// ===== iOS Table Rendering Fix =====

function ensureBatchTableRendered() {
  // Use card rendering instead of table
  renderBatchCards();
}

// ===== iOS Orientation Change Handler =====

// Listen for orientation changes to trigger re-render (iOS fix)
let orientationChangeTimeout;
window.addEventListener('orientationchange', () => {
  console.log('📱 Orientation change detected, re-rendering batch table...');
  
  // Clear any pending timeout
  if (orientationChangeTimeout) {
    clearTimeout(orientationChangeTimeout);
  }
  
  // Re-render table after orientation change settles
  orientationChangeTimeout = setTimeout(() => {
    if (batchScans.length > 0) {
      renderBatchTable();
    }
  }, 300);
});

// Also listen for resize events (handles both orientation and window resize)
let resizeTimeout;
window.addEventListener('resize', () => {
  // Debounce resize events
  if (resizeTimeout) {
    clearTimeout(resizeTimeout);
  }
  
  resizeTimeout = setTimeout(() => {
    // Only re-render if we're on the batch upload screen and have data
    const batchUploadScreen = document.getElementById('batchUploadScreen');
    if (batchUploadScreen && !batchUploadScreen.classList.contains('hidden') && batchScans.length > 0) {
      console.log('📱 Resize detected, forcing iOS layout recalculation...');
      forceIOSLayoutRecalc();
    }
  }, 150);
});

async function processBatchImageFile(file, currentIndex, total, batchLocation) {
  if (!batchStatusDiv) {
    console.error('❌ batchStatusDiv not found!');
  } else {
    batchStatusDiv.textContent = `Processing photo ${currentIndex} of ${total}…`;
    batchStatusDiv.style.display = 'block'; // Ensure it's visible
  }

  let workingFile = file;
  const originalName = file.name || `photo_${currentIndex}`;
  console.log(`📷 Processing file ${currentIndex}/${total}: ${originalName} (type: ${file.type}, size: ${file.size} bytes)`);
  
  const isHeic = /heic|heif/i.test(file.type) || /\.heic$|\.heif$/i.test(originalName);

  if (isHeic) {
    if (typeof window.heic2any === 'function') {
      if (batchStatusDiv) {
        batchStatusDiv.textContent = `Converting photo ${currentIndex} of ${total}…`;
      }
      try {
        const conversionResult = await window.heic2any({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.9
        });
        const convertedBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
        if (!(convertedBlob instanceof Blob)) {
          throw new Error('Conversion did not return a valid image blob.');
        }
        const newName = originalName.replace(/\.heic$|\.heif$/i, '.jpg');
        workingFile = new File([convertedBlob], newName, { type: 'image/jpeg' });
        console.log(`✅ HEIC converted to JPEG: ${newName}`);
      } catch (conversionError) {
        console.error('❌ HEIC conversion error:', conversionError);
        throw new Error(`Could not convert HEIC photo (${originalName}): ${conversionError.message}`);
      }
    } else {
      throw new Error('HEIC images are not supported in this browser.');
    }
  }

  const objectUrl = URL.createObjectURL(workingFile);
  try {
    console.log(`🖼️ Loading image from object URL...`);
    const img = await loadImage(objectUrl, workingFile.name || originalName);
    console.log(`✅ Image loaded: ${img.width}x${img.height}`);
    
    const canvas = document.createElement('canvas');
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    if (!width || !height) {
      throw new Error(`Invalid image dimensions: ${width}x${height}`);
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get canvas 2D context');
    }
    
    ctx.drawImage(img, 0, 0, width, height);
    console.log(`✅ Image drawn to canvas`);

    // Save photo to storage
    const photoDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    console.log(`✅ Photo data URL created (length: ${photoDataUrl.length})`);
    
    // Perform scan and add to batch table - pass batchLocation to use same lat/long for all images
    console.log(`🔍 Starting AI scan for photo ${currentIndex}...`);
    await performBatchScanFromCanvas(canvas, photoDataUrl, batchLocation);
    console.log(`✅ Photo ${currentIndex} processed and added to batch`);
  } catch (error) {
    console.error(`❌ Error processing file ${currentIndex}:`, error);
    throw error; // Re-throw to be caught by caller
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function performBatchScanFromCanvas(canvas, photoDataUrl, batchLocation = null) {
  // CRITICAL FIX: Pass fixedLocation to buildScanInfo so all images in batch use same lat/long
  const analysis = await buildScanInfo(canvas, { 
    statusElement: batchStatusDiv, 
    showOverlay: false,
    fixedLocation: batchLocation 
  });
  const baseInfo = analysis?.info;

  if (!baseInfo) {
    if (batchStatusDiv) batchStatusDiv.textContent = 'Unable to read one of the photos.';
    return;
  }

  // Get project data
  const project = getActiveProject();
  
  // CRITICAL FIX: Always use project defaults for floor/building to ensure consistent filename format
  // The filename is already generated in buildScanInfo using project defaults, but we ensure
  // the scan object also uses project defaults for consistency
  const useDefaultHouseNo = project?.defaultAddress?.houseNo ? project.defaultAddress.houseNo : (baseInfo.houseNo || '');
  const useDefaultStreet = project?.defaultAddress?.street ? project.defaultAddress.street : (baseInfo.street || '');
  const useDefaultFloor = project?.defaultAddress?.floor || 'Unknown'; // Always use project default, fallback to 'Unknown'
  const useDefaultBuilding = project?.defaultAddress?.building || 'Unknown'; // Always use project default, fallback to 'Unknown'
  const useDefaultPostcode = project?.defaultAddress?.postcode ? project.defaultAddress.postcode : (baseInfo.postcode || '');
  
  // Use entryId from buildScanInfo (already generated with matching photoFilename)
  // photoFilename is already correctly formatted as {Floor}_{Building}_{entryId}.jpg in buildScanInfo
  const scan = {
    id: Date.now() + Math.random(),
    entryId: baseInfo.entryId || 'entry-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    syncStatus: 'pending',
    timestamp: baseInfo.timestamp,
    photoDataUrl: photoDataUrl || baseInfo.photoData,
    photoId: baseInfo.photoId,
    photoFilename: baseInfo.photoFilename, // Already formatted as {Floor}_{Building}_{entryId}.jpg using project defaults
    storeName: baseInfo.storeName || '',
    unitNumber: baseInfo.unitNumber || '',
    address: baseInfo.address || '',
    category: baseInfo.category || '',
    environment: project?.environment || 'Indoor',
    lat: baseInfo.lat || '', // Uses batchLocation if provided
    lng: baseInfo.lng || '', // Uses batchLocation if provided
    houseNo: useDefaultHouseNo,
    street: useDefaultStreet,
    floor: useDefaultFloor, // Always use project default for consistency
    building: useDefaultBuilding, // Always use project default for consistency
    postcode: useDefaultPostcode,
    remarks: baseInfo.remarks || '',
    // CRITICAL FIX: Project metadata - projectId is REQUIRED for data isolation
    projectId: project?.id || null, // Explicitly set to null if no project
    projectName: project?.name || '',
    projectLocation: project?.location || '',
    projectDate: project?.date || '',
    projectEmail: project?.email || ''
  };
  
  // Warn if batch scan is created without a project
  if (!scan.projectId) {
    console.warn('⚠️ Batch scan created without active project!');
  }
  
  // Save full-resolution blob if available
  if (analysis?.fullResBlob && scan.photoId) {
    savePhotoBlob(scan.photoId, analysis.fullResBlob, scan.photoFilename);
  }

  batchScans.push(scan);
  saveBatchScans();
  
  // Re-query table body before rendering (fixes iOS issue where table might not be in DOM yet)
  const currentTableBody = document.querySelector('#batchResultsTable tbody');
  if (currentTableBody) {
    batchTableBody = currentTableBody;
  }
  
  renderBatchTable();

  if (batchStatusDiv) {
    batchStatusDiv.textContent = `Added ${scan.storeName || 'one photo'} to batch records.`;
  }
}

function saveBatchScans() {
  try {
    localStorage.setItem('batchScans', JSON.stringify(batchScans));
  } catch (err) {
    console.error('Failed to save batch scans:', err);
  }
}

function loadBatchScans() {
  try {
    const saved = localStorage.getItem('batchScans');
    if (saved) {
      batchScans = JSON.parse(saved);
      renderBatchTable();
    }
  } catch (err) {
    console.error('Failed to load batch scans:', err);
  }
}

function renderBatchTable() {
  // Use card-based rendering instead of table for better mobile support
  renderBatchCards();
}

function renderBatchCards() {
  const container = document.getElementById('batchCardsContainer');
  if (!container) {
    console.warn('⚠️ Batch cards container not found');
    return;
  }
  
  console.log(`📊 Rendering batch cards with ${batchScans.length} scans`);
  container.innerHTML = '';
  
  if (batchScans.length === 0) {
    console.log('📊 No batch scans to display');
    container.innerHTML = '<p class="empty-state">No photos processed yet. Select images to get started.</p>';
    return;
  }
  
  batchScans.forEach((scan, index) => {
    const card = document.createElement('div');
    card.className = 'batch-card';
    card.dataset.scanId = scan.id;
    
    // Determine status
    const hasError = scan.error || !scan.storeName;
    const statusClass = hasError ? 'batch-card-error' : 'batch-card-success';
    const statusIcon = hasError ? '❌' : '✅';
    const statusText = hasError ? 'Failed' : 'Success';
    
    // Photo thumbnail
    const photoHTML = scan.photoDataUrl 
      ? `<img src="${scan.photoDataUrl}" class="batch-card-photo" alt="Photo ${index + 1}" loading="lazy">`
      : '<div class="batch-card-photo-placeholder">📷</div>';
    
    // Store name or error message
    const storeNameHTML = scan.storeName 
      ? `<div class="batch-card-store-name">${scan.storeName}</div>`
      : `<div class="batch-card-error-message">${scan.error || 'Failed to process'}</div>`;
    
    // Additional info
    const categoryHTML = scan.category ? `<div class="batch-card-category">${scan.category}</div>` : '';
    const unitHTML = scan.unitNumber ? `<div class="batch-card-unit">Unit: ${scan.unitNumber}</div>` : '';
    const addressHTML = scan.address ? `<div class="batch-card-address">${scan.address}</div>` : '';
    
    card.innerHTML = `
      <div class="batch-card-header">
        <span class="batch-card-number">#${index + 1}</span>
        <span class="batch-card-status ${statusClass}">
          <span class="batch-card-status-icon">${statusIcon}</span>
          <span class="batch-card-status-text">${statusText}</span>
        </span>
        <button class="batch-card-delete-btn" data-scan-id="${scan.id}" title="Delete">🗑️</button>
      </div>
      <div class="batch-card-body">
        ${photoHTML}
        <div class="batch-card-info">
          ${storeNameHTML}
          ${categoryHTML}
          ${unitHTML}
          ${addressHTML}
        </div>
      </div>
    `;
    
    container.appendChild(card);
  });
  
  console.log(`✅ Batch cards rendered: ${batchScans.length} cards`);
  
  // Attach delete button listeners
  attachBatchCardListeners();
}

function attachBatchCardListeners() {
  // Delete buttons
  document.querySelectorAll('.batch-card-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const scanId = parseFloat(e.target.closest('.batch-card-delete-btn').dataset.scanId);
      const scan = batchScans.find(s => s.id === scanId);
      const storeName = scan?.storeName || 'this entry';
      
      if (confirm(`Delete ${storeName}?`)) {
        batchScans = batchScans.filter(s => s.id !== scanId);
        saveBatchScans();
        renderBatchCards();
      }
    });
  });
}

// ===== iOS Layout Recalculation Fix =====

let isRecalculatingLayout = false;

function forceIOSLayoutRecalc() {
  // Prevent recursive calls that could cause infinite loops
  if (isRecalculatingLayout) {
    console.log('⏭️ Layout recalculation already in progress, skipping...');
    return;
  }
  
  isRecalculatingLayout = true;
  
  // Multiple strategies to force iOS Safari to recalculate layout
  const tableContainer = document.querySelector('.table-container');
  const table = document.getElementById('batchResultsTable');
  
  if (!tableContainer || !table) {
    console.warn('⚠️ Table elements not found for iOS layout fix');
    isRecalculatingLayout = false;
    return;
  }
  
  // Strategy 1: Force reflow by reading layout properties
  try {
    // Trigger layout recalculation by reading offset properties
    void tableContainer.offsetHeight;
    void table.offsetHeight;
    void batchTableBody.offsetHeight;
    
    // Force repaint by toggling visibility (very brief)
    const originalDisplay = tableContainer.style.display;
    tableContainer.style.display = 'none';
    void tableContainer.offsetHeight; // Force reflow
    tableContainer.style.display = originalDisplay || '';
    void tableContainer.offsetHeight; // Force reflow again
    
    console.log('✅ iOS layout recalculation triggered (strategy 1)');
  } catch (e) {
    console.warn('⚠️ Strategy 1 failed:', e);
  }
  
  // Strategy 2: Use requestAnimationFrame to ensure repaint
  requestAnimationFrame(() => {
    try {
      // Force another reflow
      void tableContainer.offsetWidth;
      void table.offsetWidth;
      
      // Trigger a style recalculation
      table.style.transform = 'translateZ(0)';
      void table.offsetHeight;
      table.style.transform = '';
      
      console.log('✅ iOS layout recalculation triggered (strategy 2)');
    } catch (e) {
      console.warn('⚠️ Strategy 2 failed:', e);
    }
  });
  
  // Strategy 3: Force scroll event which can trigger repaint (without triggering resize loop)
  setTimeout(() => {
    try {
      // Force a scroll event which can trigger repaint without causing infinite loop
      const scrollEvent = new Event('scroll', { bubbles: true });
      tableContainer.dispatchEvent(scrollEvent);
      
      // Force another reflow by reading properties
      void tableContainer.scrollTop;
      void table.scrollTop;
      
      console.log('✅ iOS layout recalculation triggered (strategy 3)');
    } catch (e) {
      console.warn('⚠️ Strategy 3 failed:', e);
    } finally {
      // Reset flag after all strategies complete
      setTimeout(() => {
        isRecalculatingLayout = false;
      }, 100);
    }
  }, 50);
}

function attachBatchTableListeners() {
  // This function is kept for compatibility but now uses card rendering
  attachBatchCardListeners();
}

function openBatchEditModal(scan) {
  // Reuse the existing edit modal logic but for batch scans
  const modal = document.createElement('div');
  modal.className = 'edit-modal';
  modal.innerHTML = `
    <div class="edit-modal-content">
      <h3>Edit Entry</h3>
      <form class="edit-form">
        <div class="edit-field">
          <label>POI Name</label>
          <input type="text" name="storeName" value="${scan.storeName || ''}">
        </div>
        <div class="edit-field">
          <label>Unit Number</label>
          <input type="text" name="unitNumber" value="${scan.unitNumber || ''}">
        </div>
        <div class="edit-field">
          <label>House No</label>
          <input type="text" name="house_no" value="${scan.house_no || ''}">
        </div>
        <div class="edit-field">
          <label>Street</label>
          <input type="text" name="street" value="${scan.street || ''}">
        </div>
        <div class="edit-field">
          <label>Building</label>
          <input type="text" name="building" value="${scan.building || ''}">
        </div>
        <div class="edit-field">
          <label>Postcode</label>
          <input type="text" name="postcode" value="${scan.postcode || ''}">
        </div>
        <div class="edit-actions">
          <button type="button" class="save-btn">Save</button>
          <button type="button" class="cancel-btn">Cancel</button>
        </div>
      </form>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('.cancel-btn').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  modal.querySelector('.save-btn').addEventListener('click', () => {
    const form = modal.querySelector('.edit-form');
    scan.storeName = form.storeName.value;
    scan.unitNumber = form.unitNumber.value;
    scan.house_no = form.house_no.value;
    scan.street = form.street.value;
    scan.building = form.building.value;
    scan.postcode = form.postcode.value;
    saveBatchScans();
    renderBatchTable();
    document.body.removeChild(modal);
  });
  
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}

// Batch save button - saves batch scans to main scans array
const batchSaveBtn = document.getElementById('batchSaveBtn');
if (batchSaveBtn) {
  batchSaveBtn.addEventListener('click', async () => {
    if (!batchScans.length) {
      alert('No batch scans to save');
      return;
    }
    
    const originalText = batchSaveBtn.textContent;
    batchSaveBtn.disabled = true;
    batchSaveBtn.textContent = 'Saving...';
    batchStatusDiv.textContent = `Saving ${batchScans.length} scan(s) to records...`;
    
    try {
      let savedCount = 0;
      let failedCount = 0;
      
      for (const batchScan of batchScans) {
        try {
          // Create a copy without photoDataUrl (we'll use photoId to retrieve from IndexedDB)
          const scanDataWithoutPhoto = { ...batchScan };
          
          // Remove photoDataUrl to save space (full-res is in IndexedDB via photoId)
          delete scanDataWithoutPhoto.photoData;
          delete scanDataWithoutPhoto.photoDataUrl;
          
          // Add to main scans array
          scans.unshift(scanDataWithoutPhoto);
          savedCount++;
          
          // Sync to Google Sheets if enabled
          syncToGoogleSheets(batchScan).then(result => {
            if (result.success) {
              console.log('✅ Synced batch scan to Google Sheets:', batchScan.entryId);
              // Update sync status in main scans array
              const savedScan = scans.find(s => s.entryId === batchScan.entryId);
              if (savedScan) {
                savedScan.syncStatus = 'synced';
              }
            } else if (result.reason === 'sync_disabled') {
              console.warn('⚠️ Sync disabled for batch scan:', batchScan.entryId);
              const savedScan = scans.find(s => s.entryId === batchScan.entryId);
              if (savedScan) {
                savedScan.syncStatus = 'pending'; // Keep as pending for manual sync
              }
            } else {
              console.warn('⚠️ Google Sheets sync failed for batch scan:', result.error);
              const savedScan = scans.find(s => s.entryId === batchScan.entryId);
              if (savedScan) {
                savedScan.syncStatus = 'failed';
              }
            }
            saveScans();
            renderTable();
          }).catch(err => {
            console.error('Error syncing batch scan:', err);
          });
        } catch (error) {
          console.error('Failed to save batch scan:', error);
          failedCount++;
        }
      }
      
      // Save main scans array
      try {
        const scansJson = JSON.stringify(scans);
        // CRITICAL: Clean photoData before saving
        const cleanScansJson = JSON.stringify(scans.map(scan => {
          if (!scan) return scan;
          const cleanScan = { ...scan };
          delete cleanScan.photoData;
          delete cleanScan.photoDataUrl;
          return cleanScan;
        }));
        localStorage.setItem('scans', cleanScansJson);
        const sizeInMB = new Blob([cleanScansJson]).size / (1024 * 1024);
        console.log(`💾 Saved ${savedCount} batch scans to main records (${sizeInMB.toFixed(2)}MB)`);
      } catch (error) {
        console.error('❌ Failed to save scans:', error);
        alert(`Failed to save scans: ${error.message}`);
        batchSaveBtn.disabled = false;
        batchSaveBtn.textContent = originalText;
        return;
      }
      
      // Clear batch scans after successful save
      batchScans = [];
      saveBatchScans();
      renderBatchCards();
      renderTable(); // Refresh main table
      
      batchStatusDiv.textContent = `✅ Successfully saved ${savedCount} scan(s) to records${failedCount > 0 ? ` (${failedCount} failed)` : ''}`;
      batchSaveBtn.textContent = '✅ Saved!';
      
      setTimeout(() => {
        batchSaveBtn.textContent = originalText;
        batchSaveBtn.disabled = false;
        batchStatusDiv.textContent = '';
      }, 3000);
      
    } catch (error) {
      console.error('Error saving batch scans:', error);
      alert(`Failed to save batch scans: ${error.message}`);
      batchSaveBtn.disabled = false;
      batchSaveBtn.textContent = originalText;
      batchStatusDiv.textContent = '❌ Failed to save batch scans';
    }
  });
}

// Batch clear button
const batchClearBtn = document.getElementById('batchClearBtn');
if (batchClearBtn) {
  batchClearBtn.addEventListener('click', () => {
    if (confirm('Clear all batch upload data?')) {
      batchScans = [];
      saveBatchScans();
      renderBatchCards();
      batchStatusDiv.textContent = 'All data cleared.';
      // Re-enable upload button and ensure input is ready
      if (batchUploadBtn) {
        batchUploadBtn.disabled = false;
      }
      // Reset input to ensure it's ready for next upload
      if (batchImageInput) {
        batchImageInput.value = '';
      }
    }
  });
}

// Load batch scans on startup
loadBatchScans();

// ========== Camera Size Settings ==========
// Default camera settings
const DEFAULT_CAMERA_SETTINGS = {
  sizePercent: 60,
  widthPercent: 95,
  maintainAspectRatio: true
};

// Load camera settings from localStorage
function loadCameraSettings() {
  try {
    const saved = localStorage.getItem('cameraSettings');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.warn('Failed to load camera settings:', err);
  }
  return { ...DEFAULT_CAMERA_SETTINGS };
}

// Save camera settings to localStorage
function saveCameraSettings(settings) {
  try {
    localStorage.setItem('cameraSettings', JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save camera settings:', err);
  }
}

// Apply camera settings to video wrapper
function applyCameraSettings() {
  const videoWrapper = document.getElementById('videoWrapper');
  if (!videoWrapper) return;
  
  const settings = loadCameraSettings();
  
  // Apply size (height percentage)
  videoWrapper.style.maxHeight = `${settings.sizePercent}vh`;
  
  // Apply width percentage
  const widthValue = settings.widthPercent;
  videoWrapper.style.width = `calc(100% - ${(100 - widthValue) * 0.5}px)`;
  videoWrapper.style.maxWidth = `${widthValue}%`;
  
  // Apply aspect ratio
  if (settings.maintainAspectRatio) {
    videoWrapper.style.aspectRatio = '4 / 3';
  } else {
    videoWrapper.style.aspectRatio = 'auto';
  }
  
  console.log('📷 Applied camera settings:', settings);
}

// Initialize camera settings UI
function initCameraSettings() {
  const cameraSettingsBtn = document.getElementById('cameraSettingsBtn');
  const cameraSettingsModal = document.getElementById('cameraSettingsModal');
  const closeCameraSettings = document.getElementById('closeCameraSettings');
  const cameraSizeSlider = document.getElementById('cameraSizeSlider');
  const cameraSizeValue = document.getElementById('cameraSizeValue');
  const cameraWidthSlider = document.getElementById('cameraWidthSlider');
  const cameraWidthValue = document.getElementById('cameraWidthValue');
  const cameraMaintainAspectRatio = document.getElementById('cameraMaintainAspectRatio');
  const applyCameraSettingsBtn = document.getElementById('applyCameraSettings');
  const resetCameraSettingsBtn = document.getElementById('resetCameraSettings');
  const presetButtons = document.querySelectorAll('.preset-btn');
  
  if (!cameraSettingsBtn || !cameraSettingsModal) return;
  
  // Load current settings
  const settings = loadCameraSettings();
  
  // Initialize slider values
  if (cameraSizeSlider) {
    cameraSizeSlider.value = settings.sizePercent;
    if (cameraSizeValue) {
      cameraSizeValue.textContent = `${settings.sizePercent}%`;
    }
  }
  
  if (cameraWidthSlider) {
    cameraWidthSlider.value = settings.widthPercent;
    if (cameraWidthValue) {
      cameraWidthValue.textContent = `${settings.widthPercent}%`;
    }
  }
  
  if (cameraMaintainAspectRatio) {
    cameraMaintainAspectRatio.checked = settings.maintainAspectRatio !== false;
  }
  
  // Update size value display
  if (cameraSizeSlider && cameraSizeValue) {
    cameraSizeSlider.addEventListener('input', (e) => {
      cameraSizeValue.textContent = `${e.target.value}%`;
    });
  }
  
  // Update width value display
  if (cameraWidthSlider && cameraWidthValue) {
    cameraWidthSlider.addEventListener('input', (e) => {
      cameraWidthValue.textContent = `${e.target.value}%`;
    });
  }
  
  // Preset buttons
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const size = parseInt(btn.dataset.size);
      if (cameraSizeSlider) {
        cameraSizeSlider.value = size;
        if (cameraSizeValue) {
          cameraSizeValue.textContent = `${size}%`;
        }
      }
      // Update preset button states
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  // Open settings modal
  cameraSettingsBtn.addEventListener('click', () => {
    cameraSettingsModal.style.display = 'flex';
  });
  
  // Close settings modal
  if (closeCameraSettings) {
    closeCameraSettings.addEventListener('click', () => {
      cameraSettingsModal.style.display = 'none';
    });
  }
  
  // Close modal when clicking outside
  cameraSettingsModal.addEventListener('click', (e) => {
    if (e.target === cameraSettingsModal) {
      cameraSettingsModal.style.display = 'none';
    }
  });
  
  // Apply settings
  if (applyCameraSettingsBtn) {
    applyCameraSettingsBtn.addEventListener('click', () => {
      const newSettings = {
        sizePercent: parseInt(cameraSizeSlider?.value || settings.sizePercent),
        widthPercent: parseInt(cameraWidthSlider?.value || settings.widthPercent),
        maintainAspectRatio: cameraMaintainAspectRatio?.checked !== false
      };
      
      saveCameraSettings(newSettings);
      applyCameraSettings();
      cameraSettingsModal.style.display = 'none';
      
      // Show confirmation
      const statusDiv = document.getElementById('status');
      if (statusDiv) {
        statusDiv.textContent = '✅ Camera settings applied';
        setTimeout(() => { statusDiv.textContent = ''; }, 2000);
      }
    });
  }
  
  // Reset to default
  if (resetCameraSettingsBtn) {
    resetCameraSettingsBtn.addEventListener('click', () => {
      if (confirm('Reset camera settings to default?')) {
        saveCameraSettings({ ...DEFAULT_CAMERA_SETTINGS });
        
        if (cameraSizeSlider) {
          cameraSizeSlider.value = DEFAULT_CAMERA_SETTINGS.sizePercent;
          if (cameraSizeValue) {
            cameraSizeValue.textContent = `${DEFAULT_CAMERA_SETTINGS.sizePercent}%`;
          }
        }
        
        if (cameraWidthSlider) {
          cameraWidthSlider.value = DEFAULT_CAMERA_SETTINGS.widthPercent;
          if (cameraWidthValue) {
            cameraWidthValue.textContent = `${DEFAULT_CAMERA_SETTINGS.widthPercent}%`;
          }
        }
        
        if (cameraMaintainAspectRatio) {
          cameraMaintainAspectRatio.checked = DEFAULT_CAMERA_SETTINGS.maintainAspectRatio;
        }
        
        applyCameraSettings();
        
        // Update preset button states
        presetButtons.forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.size) === DEFAULT_CAMERA_SETTINGS.sizePercent);
        });
      }
    });
  }
}

// Initialize camera settings on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initCameraSettings();
    // Apply settings if camera view is already active
    setTimeout(() => {
      const cameraView = document.getElementById('cameraView');
      if (cameraView && cameraView.classList.contains('active')) {
        applyCameraSettings();
      }
    }, 100);
  });
} else {
  initCameraSettings();
  // Apply settings if camera view is already active
  setTimeout(() => {
    const cameraView = document.getElementById('cameraView');
    if (cameraView && cameraView.classList.contains('active')) {
      applyCameraSettings();
    }
  }, 100);
}

// Extract structured information from raw OCR text
function extractInfo(rawText, ocrLines = []) {
  // Normalise whitespace
  const text = rawText.replace(/\n+/g, '\n').trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ----- Patterns based on rules provided -----
  // Pick store name using multiple heuristics
  let storeName = '';
  if (ocrLines.length) {
    // Step 1: Filter lines with mostly letters (reduce gibberish)
    const letterLines = ocrLines.filter(l => {
      const txt = l.text.trim();
      const letters = txt.replace(/[^A-Za-z]/g, '');
      const ratio = letters.length / (txt.length || 1);
      return letters.length >= 3 && ratio > 0.6; // at least 60% letters
    });

    // Step 2: Choose line with highest confidence ( then longest length )
    letterLines.sort((a, b) => (b.confidence || b.conf || 0) - (a.confidence || a.conf || 0));
    if (letterLines.length) {
      storeName = letterLines[0].text.trim();
    }
  }

  // 2) Fallback: first line that is mostly uppercase (e.g., "SCAN ME")
  if (!storeName) {
    const upperCandidate = lines.find(l => {
      const letters = l.replace(/[^A-Za-z]/g, '');
      return letters.length >= 3 && letters === letters.toUpperCase();
    });
    if (upperCandidate) storeName = upperCandidate;
  }

  // 3) Ultimate fallback: first line
  if (!storeName) storeName = lines[0] || '';

  storeName = correctStoreName(storeName);

  // Unit number must be in the form #XX-XXX
  const unitMatch = text.match(/#\d{2}-\d{3}/);
  let unitNumber = unitMatch ? unitMatch[0] : '';

  // Singapore phone number: 65 XXXX XXXX, with optional '+' and optional spaces
  const phoneMatch = text.match(/\+?65\s?\d{4}\s?\d{4}/);
  let phone = phoneMatch ? phoneMatch[0] : '';
  if (phone) {
    phone = phone.replace(/\s+/g, ' '); // normalise spacing
  }

  // Website: detect domain like example.com (with or without protocol)
  const websiteMatch = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  let website = websiteMatch ? websiteMatch[0].replace(/^[^A-Za-z]+/, '') : '';

  // Opening hours: XX:XX - XX:XX (24-hour) with optional spaces
  const openingHoursMatch = text.match(/(?:[01]?\d|2[0-3]):[0-5]\d\s*[-–]\s*(?:[01]?\d|2[0-3]):[0-5]\d/);
  let openingHours = openingHoursMatch ? openingHoursMatch[0].replace(/\s+/g, ' ') : '';

  // Guess business category based on keywords using the official categories
  const categories = {
    // Food and Beverage
    'restaurant|cafe|café|bakery|food|dining|kitchen|bistro|eatery|bar|pub|fast food|takeaway|delivery': 'Food and Beverage',
    
    // Beauty Services
    'salon|spa|hair|beauty|nail|barber|massage|facial|cosmetic|makeup': 'Beauty Services',
    
    // Healthcare
    'clinic|medical|dental|pharmacy|hospital|doctor|dentist|physiotherapy|optometry': 'Healthcare',
    
    // General Merchandise / Retail
    'shop|store|retail|mart|supermarket|grocery|convenience|book|stationery|gift|toy|clothing|fashion': 'General Merchandise',
    
    // Sports and Fitness
    'gym|fitness|yoga|sport|exercise|training|martial arts|pilates|swimming': 'Sports and Fitness',
    
    // Auto
    'car|auto|mechanic|garage|petrol|gas|workshop|tire|automotive|vehicle': 'Auto',
    
    // Financial
    'bank|atm|insurance|finance|loan|money|exchange|investment|accounting': 'Financial',
    
    // Education
    'school|education|tuition|learning|academy|institute|college|university|kindergarten': 'Education',
    
    // Hotel
    'hotel|motel|inn|lodge|accommodation|hostel|resort|guesthouse': 'Hotel',
    
    // Professional Services
    'law|lawyer|legal|consultant|office|service|agency|firm|real estate': 'Professional Services',
    
    // Home Services
    'plumber|electrician|cleaning|repair|maintenance|contractor|handyman|renovation': 'Home Services',
    
    // Local Services
    'laundry|dry clean|tailor|key|locksmith|photo|printing|courier|postal': 'Local Services',
    
    // Art
    'art|gallery|studio|craft|design|creative|painting|sculpture|exhibition': 'Art',
    
    // Attractions
    'museum|zoo|park|attraction|tourist|sightseeing|entertainment|cinema|theater': 'Attractions',
    
    // Essentials
    'pharmacy|convenience|grocery|supermarket|essential|daily|necessities': 'Essentials',
    
    // Government Building
    'government|municipal|council|office|public|administration|ministry|department': 'Government Building',
    
    // Mass Media
    'media|newspaper|radio|tv|broadcasting|news|publication|printing press': 'Mass Media',
    
    // Nightlife
    'club|nightclub|lounge|disco|karaoke|ktv|night|entertainment|party': 'Nightlife',
    
    // Religious Organization
    'church|temple|mosque|synagogue|religious|worship|prayer|spiritual': 'Religious Organization',
    
    // Travel
    'travel|tour|airline|booking|ticket|vacation|holiday|cruise|flight': 'Travel',
    
    // Commercial Building
    'office|building|commercial|business|corporate|headquarters|plaza|center': 'Commercial Building',
    
    // Industrial
    'factory|warehouse|industrial|manufacturing|production|plant|facility': 'Industrial',
    
    // Residential
    'apartment|condo|residential|housing|home|villa|townhouse|flat': 'Residential'
  };

  let category = 'Unknown';
  for (const pattern in categories) {
    if (new RegExp(pattern, 'i').test(text)) {
      category = categories[pattern];
      break;
    }
  }

  // Use "Not Found" when a field could not be extracted to match strict rules
  if (!storeName) storeName = '';
  if (!unitNumber) unitNumber = '';
  if (!openingHours) openingHours = ''; // kept for future reference
  if (!phone) phone = '';              // kept for future reference
  if (!website) website = '';          // kept for future reference

  // Placeholder – address extraction will be implemented later or via geocoding
  let address = '';

  if (!address) address = '';

  return {
    storeName,
    unitNumber,
    address,
    category,
    rawText: text
  };
}

// --- Company category mapping ---
let companyCategories = [];

async function loadCompanyCategories() {
  if (companyCategories.length) return companyCategories;
  try {
    // First try pre-generated JSON (faster)
    const jsonRes = await fetch('categories.json');
    if (jsonRes.ok) {
      companyCategories = (await jsonRes.json()).map(cat => ({
        key: cat.key,
        name: (cat.name || '').toLowerCase(),
        last: (cat.key.split('::').filter(Boolean).pop() || '').toLowerCase()
      }));
      console.log(`Loaded ${companyCategories.length} categories from JSON`);
      return companyCategories;
    }
  } catch (_) {
    /* fallthrough to CSV */
  }

  try {
    // Fallback to CSV shipped alongside the app if JSON unavailable
    const csvPath = encodeURI('Geo Places - Final POI Category Tree - Q2 2024 - 2. Category Tree.csv');
    const res = await fetch(csvPath);
    const csvText = await res.text();
    const lines = csvText.split(/\r?\n/);
    lines.shift(); // drop header
    const splitter = /,(?=(?:[^"]*\"[^"]*\")*[^\"]*$)/;
    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = line.split(splitter);
      const name = (cols[3] || '').replace(/^"|"$/g, '').trim();
      const keyRaw = (cols[5] || '').replace(/^"|"$/g, '').trim();
      if (!keyRaw) continue;
      const key = keyRaw.replace(/:+$/, '');
      const lastSegment = key.split('::').filter(Boolean).pop() || '';
      companyCategories.push({ key, name: name.toLowerCase(), last: lastSegment.toLowerCase() });
    }
    console.log(`Parsed ${companyCategories.length} categories from CSV`);
  } catch (err) {
    console.warn('Failed to load categories from CSV', err);
  }
  return companyCategories;
}

async function mapToCompanyCategory(inputCategory = '') {
  if (!inputCategory || inputCategory === 'Unknown' || inputCategory === 'Not Found') {
    return inputCategory;
  }

  // Define the official business categories
  const officialCategories = [
    'Art', 'Attractions', 'Auto', 'Beauty Services', 'Commercial Building',
    'Education', 'Essentials', 'Financial', 'Food and Beverage', 'General Merchandise',
    'Government Building', 'Healthcare', 'Home Services', 'Hotel', 'Industrial',
    'Local Services', 'Mass Media', 'Nightlife', 'Physical Feature',
    'Professional Services', 'Religious Organization', 'Residential',
    'Sports and Fitness', 'Travel'
  ];

  const query = inputCategory.toLowerCase().trim();
  
  // Direct match first (case-insensitive)
  let directMatch = officialCategories.find(cat => cat.toLowerCase() === query);
  if (directMatch) {
    console.log(`Direct match: ${inputCategory} → ${directMatch}`);
    return directMatch;
  }

  // Mapping for common variations and synonyms
  const categoryMappings = {
    // Food and Beverage variations
    'f&b': 'Food and Beverage',
    'food': 'Food and Beverage',
    'restaurant': 'Food and Beverage',
    'dining': 'Food and Beverage',
    'cafe': 'Food and Beverage',
    'bakery': 'Food and Beverage',
    'eatery': 'Food and Beverage',
    
    // Beauty variations
    'beauty': 'Beauty Services',
    'salon': 'Beauty Services',
    'spa': 'Beauty Services',
    'barber': 'Beauty Services',
    
    // Retail variations
    'retail': 'General Merchandise',
    'shop': 'General Merchandise',
    'store': 'General Merchandise',
    'merchandise': 'General Merchandise',
    'mart': 'General Merchandise',
    
    // Fitness variations
    'fitness': 'Sports and Fitness',
    'gym': 'Sports and Fitness',
    'sport': 'Sports and Fitness',
    'exercise': 'Sports and Fitness',
    
    // Medical variations
    'medical': 'Healthcare',
    'clinic': 'Healthcare',
    'hospital': 'Healthcare',
    'pharmacy': 'Healthcare',
    
    // Other common variations
    'automotive': 'Auto',
    'car': 'Auto',
    'vehicle': 'Auto',
    'finance': 'Financial',
    'bank': 'Financial',
    'school': 'Education',
    'learning': 'Education',
    'accommodation': 'Hotel',
    'lodging': 'Hotel',
    'office': 'Commercial Building',
    'building': 'Commercial Building'
  };

  // Check for mapping variations
  let mappedCategory = categoryMappings[query];
  if (mappedCategory) {
    console.log(`Mapped variation: ${inputCategory} → ${mappedCategory}`);
    return mappedCategory;
  }

  // Partial matching - if input contains any official category name
  for (const category of officialCategories) {
    if (query.includes(category.toLowerCase()) || category.toLowerCase().includes(query)) {
      console.log(`Partial match: ${inputCategory} → ${category}`);
      return category;
    }
  }

  console.log(`No match found for: ${inputCategory}, keeping original`);
  return inputCategory;
}

// ===== MAP FUNCTIONALITY =====
let miniMap = null;
let fullMap = null;
let projectProgressMarkers = {}; // Store markers for project progress
let projectProgressData = {}; // Store progress data from Google Sheets
let userLocationMarker = null;
let userAccuracyCircle = null;
let routePoints = [];
let routeLine = null;
let teamMarkers = [];
let followUserLocation = true;
let lastUserLocation = null;
let annotationLayer = null; // FeatureGroup for drawn items
let drawControl = null;
const ANNOTATIONS_KEY = 'bnsv_annotations_geojson_v1';
let addRoutePointMode = false;
let currentMarkerStyle = 'cross'; // 'cross' | 'dot' | 'circle'

// Street map preview for Residential projects
let streetPreviewMap = null;
let streetBuildingMarkers = [];
let completedAddresses = new Set(); // Set of completed address strings

// Initialize street map preview
async function loadStreetMapPreview(streetName) {
  const mapContainer = document.getElementById('streetMapContainer');
  const mapElement = document.getElementById('streetMapPreview');
  const mapStatus = document.getElementById('streetMapStatus');
  
  if (!mapContainer || !mapElement) {
    console.error('Street map elements not found');
    return;
  }
  
  // Show container
  mapContainer.classList.remove('hidden');
  mapStatus.textContent = 'Searching for street...';
  
  // Search OneMap for the street
  const searchResults = await searchOneMap(streetName + ' Singapore');
  
  if (!searchResults || searchResults.length === 0) {
    mapStatus.textContent = 'Street not found. Try a different name.';
    return;
  }
  
  // Get coordinates from first result
  const firstResult = searchResults[0];
  const lat = parseFloat(firstResult.LATITUDE);
  const lng = parseFloat(firstResult.LONGITUDE);
  
  mapStatus.textContent = `Found: ${firstResult.SEARCHVAL || streetName}`;
  
  // Initialize or update map
  if (!streetPreviewMap) {
    streetPreviewMap = L.map('streetMapPreview', {
      zoomControl: true,
      attributionControl: true
    }).setView([lat, lng], 17);
    
    // Use OneMap tiles
    L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
      detectRetina: true,
      maxZoom: 19,
      minZoom: 11,
      attribution: '&copy; <a href="https://www.onemap.gov.sg">OneMap</a> &copy; <a href="https://www.sla.gov.sg">SLA</a>'
    }).addTo(streetPreviewMap);
  } else {
    streetPreviewMap.setView([lat, lng], 17);
  }
  
  // Clear existing markers
  clearStreetBuildingMarkers();
  
  // Add markers for all search results (houses along the street)
  mapStatus.textContent = 'Loading addresses...';
  
  // Fetch completed scans from Google Sheets for this street
  await loadCompletedAddressesForStreet(streetName);
  
  // Add markers for each address found
  let completedCount = 0;
  let pendingCount = 0;
  
  for (const result of searchResults) {
    const resultLat = parseFloat(result.LATITUDE);
    const resultLng = parseFloat(result.LONGITUDE);
    const address = result.ADDRESS || result.SEARCHVAL || '';
    const blkNo = result.BLK_NO || '';
    const postalCode = result.POSTAL || '';
    
    // Check if this address is completed
    const isCompleted = isAddressCompleted(address, blkNo, postalCode);
    
    if (isCompleted) {
      completedCount++;
    } else {
      pendingCount++;
    }
    
    // Create marker with appropriate color
    const markerColor = isCompleted ? '#44ff44' : '#888888';
    const markerIcon = L.divIcon({
      className: 'street-building-marker',
      html: `
        <div class="building-marker ${isCompleted ? 'completed' : 'pending'}" style="background-color: ${markerColor};">
          <span class="building-number">${blkNo || '?'}</span>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    
    const marker = L.marker([resultLat, resultLng], { icon: markerIcon })
      .addTo(streetPreviewMap)
      .bindPopup(`
        <div class="building-popup">
          <strong>${blkNo ? blkNo + ' ' : ''}${streetName}</strong><br>
          <span class="postal">${postalCode || 'No postal code'}</span><br>
          <span class="status ${isCompleted ? 'done' : 'pending'}">${isCompleted ? '✅ Completed' : '⏳ Pending'}</span>
        </div>
      `);
    
    streetBuildingMarkers.push(marker);
  }
  
  // Fit map to show all markers
  if (streetBuildingMarkers.length > 0) {
    const group = L.featureGroup(streetBuildingMarkers);
    streetPreviewMap.fitBounds(group.getBounds(), { padding: [30, 30] });
  }
  
  // Invalidate size after a delay to ensure proper rendering
  setTimeout(() => {
    if (streetPreviewMap) {
      streetPreviewMap.invalidateSize();
    }
  }, 300);
  
  mapStatus.textContent = `${searchResults.length} addresses found | ${completedCount} completed | ${pendingCount} pending`;
}

// Clear street building markers
function clearStreetBuildingMarkers() {
  streetBuildingMarkers.forEach(marker => {
    if (streetPreviewMap && marker) {
      streetPreviewMap.removeLayer(marker);
    }
  });
  streetBuildingMarkers = [];
}

// Load completed addresses for a street from Google Sheets
async function loadCompletedAddressesForStreet(streetName) {
  completedAddresses.clear();
  
  try {
    // Fetch all data from Google Sheets for the current project's tab
    const customTabName = document.getElementById('customTabName');
    const tabName = customTabName?.value?.trim();
    
    if (!tabName) {
      console.log('No tab name, cannot fetch completed addresses');
      return;
    }
    
    const result = await fetchFromGoogleSheets({ tabName });
    
    if (!result.success || !result.records) {
      console.log('No records found in sheet');
      return;
    }
    
    // Extract addresses that match this street
    const streetLower = streetName.toLowerCase();
    
    result.records.forEach(record => {
      const recordStreet = (record.Street || '').toLowerCase();
      const houseNo = record.House_No || record.houseNo || '';
      const postal = record.Postcode || record.postcode || '';
      
      if (recordStreet.includes(streetLower) || streetLower.includes(recordStreet)) {
        // Add various forms of the address to the set
        if (houseNo) {
          completedAddresses.add(`${houseNo}`.toLowerCase());
          completedAddresses.add(`${houseNo} ${streetName}`.toLowerCase());
        }
        if (postal) {
          completedAddresses.add(postal);
        }
      }
    });
    
    console.log(`📊 Loaded ${completedAddresses.size} completed addresses for "${streetName}"`);
  } catch (error) {
    console.warn('Could not load completed addresses:', error);
  }
}

// Check if an address is completed
function isAddressCompleted(address, blkNo, postalCode) {
  // Check various forms of the address
  if (blkNo && completedAddresses.has(blkNo.toLowerCase())) return true;
  if (postalCode && completedAddresses.has(postalCode)) return true;
  if (address && completedAddresses.has(address.toLowerCase())) return true;
  
  // Check if block number is part of any completed address
  if (blkNo) {
    for (const completed of completedAddresses) {
      if (completed.startsWith(blkNo.toLowerCase())) return true;
    }
  }
  
  return false;
}

// ===== PROGRESS DASHBOARD (Option B) =====
// Variables moved to top of file to avoid initialization errors

// Grid boundary definitions (traced from reference images)
const GRID_BOUNDARIES = {
  'Orchard Grid': {
    color: '#2563eb',
    // Coordinates from GeoJSON: Orchard Border Outline.geojson
    coordinates: [
      [1.303895546921169, 103.830749943640384],
      [1.303206760883259, 103.831884084940228],
      [1.300398631241839, 103.834841331880895],
      [1.302687522053229, 103.836017870986325],
      [1.301394722868774, 103.838625336030773],
      [1.300006552514891, 103.843024108361931],
      [1.30092846726257, 103.843331492452506],
      [1.301076821328438, 103.843638876543125],
      [1.301331142563912, 103.84371307270294],
      [1.302920649704441, 103.841391792846267],
      [1.304997604189765, 103.841370593943466],
      [1.306417561881553, 103.841211602172464],
      [1.307487827969628, 103.841540185165854],
      [1.307381861050561, 103.841148005464078],
      [1.306576512319511, 103.840554436185656],
      [1.305824146824339, 103.837692584307575],
      [1.307434844510653, 103.837067216674953],
      [1.307045416052881, 103.835800582232622],
      [1.306889114818151, 103.835837680312508],
      [1.306746059442245, 103.834984424474769],
      [1.307016275145449, 103.834682340109865],
      [1.306989783411126, 103.834054322614421],
      [1.307445441202538, 103.834266311642409],
      [1.307869308841228, 103.833299111702132],
      [1.305667845513635, 103.832273614779226],
      [1.303895546921169, 103.830749943640384]
    ]
  },
  'Empress Grid': {
    color: '#2563eb',
    // Coordinates from GeoJSON: Empress Border Outline.geojson
    coordinates: [
      [1.316762565191353, 103.806840231144193],
      [1.318865999803489, 103.809190659492202],
      [1.318222253631002, 103.809654385490987],
      [1.317994425727609, 103.809490093994256],
      [1.317435452527501, 103.810004167387191],
      [1.315949271987501, 103.809309903320482],
      [1.313212684114048, 103.808623588842281],
      [1.313427266620987, 103.808075067232338],
      [1.312929223243306, 103.807608691370731],
      [1.313204736613437, 103.80696212483528],
      [1.31314115660764, 103.806670639921791],
      [1.313448459954005, 103.806135367626069],
      [1.312399389753873, 103.805615994507463],
      [1.31268549985211, 103.804937629617854],
      [1.312526549801575, 103.804084373780114],
      [1.310751606884557, 103.803612698192808],
      [1.311710606049805, 103.800422263321323],
      [1.312664306512623, 103.798906541771089],
      [1.316055238543749, 103.798599157680471],
      [1.316585071257443, 103.798789947805687],
      [1.31797323243321, 103.800295069904507],
      [1.318450081513549, 103.800454061675538],
      [1.318979913717908, 103.800369266064337],
      [1.319297812986378, 103.801227821627762],
      [1.31817721788431, 103.801691547626504],
      [1.318373255834555, 103.80211552568251],
      [1.318619627831215, 103.802134074722474],
      [1.318672611053117, 103.804092323368678],
      [1.318346764220559, 103.804261914591081],
      [1.317832826853265, 103.804169169391358],
      [1.316979796555953, 103.804603746898763],
      [1.317705667075918, 103.805870381341109],
      [1.316762565191353, 103.806840231144193]
    ]
  },
  'Katong Grid': {
    color: '#2563eb',
    // Coordinates from GeoJSON: Katong Border Outline.geojson
    coordinates: [
      [1.300769516468032, 103.901779517336621],
      [1.302030525829228, 103.900942160675996],
      [1.300727129587798, 103.897539736776494],
      [1.304775073434041, 103.896394996025265],
      [1.305251925029342, 103.897836521415698],
      [1.306481142057944, 103.897401943908292],
      [1.307063960266527, 103.898790472041725],
      [1.307614988266604, 103.898546684659536],
      [1.308250789654842, 103.900104804015356],
      [1.307106347040057, 103.900920961773167],
      [1.308589883662691, 103.903019653150423],
      [1.308208402900638, 103.903284639435455],
      [1.308791220708162, 103.904121996096066],
      [1.30716992719901, 103.905245537944509],
      [1.307530214736003, 103.905690714903315],
      [1.307106347040057, 103.905987499542519],
      [1.307609689921026, 103.906718861689129],
      [1.307286490819578, 103.906941450168532],
      [1.308213701244952, 103.908584365135596],
      [1.305034692647139, 103.910221980376932],
      [1.301490093323063, 103.910630059255851],
      [1.299985359068458, 103.905383330812711],
      [1.301966945540398, 103.904121996096066],
      [1.300589372222118, 103.902224694295413],
      [1.300769516468032, 103.901779517336621]
    ]
  }
};

// Initialize the Progress Dashboard
async function initProgressDashboard() {
  console.log('📊 Initializing Progress Dashboard...');
  
  const mapElement = document.getElementById('progressDashboardMap');
  if (!mapElement) {
    console.error('Progress dashboard map element not found');
    return;
  }
  
  // Show loading indicator
  showMapLoadingIndicator();
  
  // Initialize map if not already
  if (!progressDashboardMap) {
    progressDashboardMap = L.map('progressDashboardMap', {
      zoomControl: true,
      attributionControl: true
    }).setView([1.3521, 103.8198], 12); // Singapore center
    
    // Use OneMap tiles
    L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
      detectRetina: true,
      maxZoom: 19,
      minZoom: 11,
      attribution: '&copy; <a href="https://www.onemap.gov.sg">OneMap</a>'
    }).addTo(progressDashboardMap);
  }
  
  // Invalidate size after a delay
  setTimeout(() => {
    if (progressDashboardMap) {
      progressDashboardMap.invalidateSize();
    }
  }, 300);
  
  // Draw grid boundaries
  drawGridBoundaries();
  
  // Load all project locations with their progress
  await loadDashboardProgress();
  
  // Hide loading indicator
  hideMapLoadingIndicator();
  
  // Initialize live location tracking
  initLiveLocationTracking();
}

// Show map loading indicator
function showMapLoadingIndicator() {
  const indicator = document.getElementById('mapLoadingIndicator');
  if (indicator) {
    indicator.classList.remove('hidden');
  }
}

// Hide map loading indicator
function hideMapLoadingIndicator() {
  const indicator = document.getElementById('mapLoadingIndicator');
  if (indicator) {
    indicator.classList.add('hidden');
  }
}

// Initialize live location tracking UI
function initLiveLocationTracking() {
  const indicator = document.getElementById('liveLocationIndicator');
  if (indicator) {
    indicator.classList.remove('hidden');
  }
  
  // Setup collapse button
  const collapseBtn = document.getElementById('collapseLiveLocationBtn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLiveLocationCollapse();
    });
  }
  
  // Try to start tracking automatically
  startLiveLocationTracking();
}

// Toggle live location indicator collapse
function toggleLiveLocationCollapse() {
  const indicator = document.getElementById('liveLocationIndicator');
  const content = indicator?.querySelector('.live-location-content');
  const collapseBtn = document.getElementById('collapseLiveLocationBtn');
  
  if (!indicator || !content || !collapseBtn) return;
  
  const isCollapsed = indicator.classList.contains('collapsed');
  
  if (isCollapsed) {
    indicator.classList.remove('collapsed');
    content.style.display = 'flex';
    collapseBtn.textContent = '▼';
    collapseBtn.title = 'Collapse';
  } else {
    indicator.classList.add('collapsed');
    content.style.display = 'none';
    collapseBtn.textContent = '▲';
    collapseBtn.title = 'Expand';
  }
}

// Start live location tracking
function startLiveLocationTracking() {
  if (!navigator.geolocation) {
    console.warn('Geolocation is not supported');
    updateLiveLocationIndicator(null, 'GPS not supported');
    return;
  }

  if (liveLocationWatchId !== null) {
    // Already tracking
    return;
  }

  isLiveLocationEnabled = true;
  const toggleBtn = document.getElementById('toggleLiveLocationBtn');
  if (toggleBtn) {
    toggleBtn.textContent = '⏸️';
    toggleBtn.title = 'Pause GPS';
  }

  const options = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 5000
  };

  // Reset zoom flag when starting tracking
  hasZoomedToUserLocation = false;
  
  liveLocationWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      
      // Update marker on map (zoom on first location update)
      const shouldZoom = !hasZoomedToUserLocation;
      updateLiveLocationMarker(lat, lng, shouldZoom);
      
      // Get address from OneMap
      const addressInfo = await reverseGeocodeOneMap(lat, lng);
      
      // Update indicator
      updateLiveLocationIndicator({ lat, lng }, addressInfo);
    },
    (error) => {
      console.error('GPS error:', error);
      updateLiveLocationIndicator(null, `GPS Error: ${error.message}`);
    },
    options
  );
}

// Stop live location tracking
function stopLiveLocationTracking() {
  if (liveLocationWatchId !== null) {
    navigator.geolocation.clearWatch(liveLocationWatchId);
    liveLocationWatchId = null;
  }
  
  isLiveLocationEnabled = false;
  hasZoomedToUserLocation = false; // Reset zoom flag
  const toggleBtn = document.getElementById('toggleLiveLocationBtn');
  if (toggleBtn) {
    toggleBtn.textContent = '🎯';
    toggleBtn.title = 'Start GPS';
  }
  
  // Hide marker
  if (liveLocationMarker && progressDashboardMap) {
    progressDashboardMap.removeLayer(liveLocationMarker);
    liveLocationMarker = null;
  }
}

// Update live location marker on map
function updateLiveLocationMarker(lat, lng, shouldZoom = false) {
  if (!progressDashboardMap) return;
  
  // Remove existing marker
  if (liveLocationMarker) {
    progressDashboardMap.removeLayer(liveLocationMarker);
  }
  
  // Create pulsing blue marker for user location
  const icon = L.divIcon({
    className: 'live-location-marker',
    html: `<div style="
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #4be0a8;
      border: 3px solid #fff;
      box-shadow: 0 0 0 4px rgba(75, 224, 168, 0.3);
      animation: pulse 2s infinite;
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  
  liveLocationMarker = L.marker([lat, lng], { icon })
    .addTo(progressDashboardMap)
    .bindPopup('Your Current Location');
  
  // Auto-zoom to user location when live location is first enabled
  if (shouldZoom && !hasZoomedToUserLocation) {
    progressDashboardMap.setView([lat, lng], 16, { animate: true });
    hasZoomedToUserLocation = true;
  }
}

// Update live location indicator panel
function updateLiveLocationIndicator(coords, addressInfo) {
  const houseNoEl = document.getElementById('liveLocationHouseNo');
  const streetEl = document.getElementById('liveLocationStreet');
  const postcodeEl = document.getElementById('liveLocationPostcode');
  const coordsEl = document.getElementById('liveLocationCoords');
  
  if (coords) {
    // Update coordinates
    if (coordsEl) {
      coordsEl.textContent = `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;
    }
    
    // Update address if available
    if (addressInfo) {
      const houseNo = addressInfo.BUILDINGNAME || addressInfo.BLK_NO || '-';
      const street = addressInfo.ROAD || addressInfo.ADDRESS || '-';
      const postcode = addressInfo.POSTAL || '-';
      
      if (houseNoEl) houseNoEl.textContent = houseNo;
      if (streetEl) streetEl.textContent = street;
      if (postcodeEl) postcodeEl.textContent = postcode;
    } else {
      // Address lookup failed
      if (houseNoEl) houseNoEl.textContent = 'Loading...';
      if (streetEl) streetEl.textContent = 'Loading...';
      if (postcodeEl) postcodeEl.textContent = 'Loading...';
    }
  } else {
    // No coordinates available
    if (coordsEl) coordsEl.textContent = '-';
    if (houseNoEl) houseNoEl.textContent = addressInfo || '-';
    if (streetEl) streetEl.textContent = '-';
    if (postcodeEl) postcodeEl.textContent = '-';
  }
}

// Check if a point is inside a polygon (ray casting algorithm)
function isPointInPolygon(point, polygon) {
  const x = point.lat;
  const y = point.lng;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  return inside;
}

// Determine which grid a location belongs to based on coordinates
function getLocationGrid(coords) {
  if (!coords) return null;
  
  for (const [gridName, gridData] of Object.entries(GRID_BOUNDARIES)) {
    if (isPointInPolygon({ lat: coords.lat, lng: coords.lng }, gridData.coordinates)) {
      return gridName;
    }
  }
  
  return null;
}

// Draw grid boundary polygons on the dashboard map
function drawGridBoundaries() {
  if (!progressDashboardMap) return;
  
  // Clear existing grid polygons
  Object.values(gridPolygons).forEach(polygon => {
    if (polygon) progressDashboardMap.removeLayer(polygon);
  });
  gridPolygons = {};
  
  // Draw each grid
  for (const [gridName, gridData] of Object.entries(GRID_BOUNDARIES)) {
    const polygon = L.polygon(gridData.coordinates, {
      color: gridData.color,
      weight: 3,
      opacity: 0.9,
      fillColor: gridData.color,
      fillOpacity: 0.05, // Very light fill
      dashArray: null
    }).addTo(progressDashboardMap);
    
    // Add label for the grid
    const center = polygon.getBounds().getCenter();
    const label = L.divIcon({
      className: 'grid-label',
      html: `<div class="grid-label-text">${gridName}</div>`,
      iconSize: [120, 24],
      iconAnchor: [60, 12]
    });
    
    const labelMarker = L.marker(center, { 
      icon: label, 
      interactive: false,
      zIndexOffset: -1000 
    }).addTo(progressDashboardMap);
    
    gridPolygons[gridName] = { polygon, labelMarker };
  }
  
  console.log(`📐 Drew ${Object.keys(GRID_BOUNDARIES).length} grid boundaries`);
}

// Load progress for all locations from "Dashboard - Commercial" tab
async function loadDashboardProgress() {
  console.log('📊 Loading dashboard progress from Google Sheets...');
  
  // Show loading state
  const statusEl = document.getElementById('dashboardTotalLocations');
  if (statusEl) statusEl.textContent = '...';
  
  // Clear existing markers
  Object.values(dashboardLocationMarkers).forEach(marker => {
    if (progressDashboardMap && marker) {
      progressDashboardMap.removeLayer(marker);
    }
  });
  dashboardLocationMarkers = {};
  
  // Stats counters
  let totalLocations = 0;
  let completedLocations = 0;
  let inProgressLocations = 0;
  let pendingLocations = 0;
  
  // Fetch data from "Dashboard - Commercial" tab (direct API call, bypasses sync check)
  let dashboardData = [];
  try {
    const tabName = 'Dashboard - Commercial';
    const params = new URLSearchParams({ tabName });
    const url = `${SHEETS_SYNC_ENDPOINT}?${params.toString()}`;
    
    console.log('📊 Fetching dashboard data from:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const result = await response.json();
    console.log('📊 Dashboard API response:', result);
    
    if (result.success && result.records) {
      dashboardData = result.records;
      console.log(`📊 Fetched ${dashboardData.length} locations from Dashboard - Commercial`);
    } else {
      console.warn('Could not fetch dashboard data:', result.error || result.reason);
    }
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
  }
  
  // Process locations from the sheet
  const locationProgress = [];
  const projects = loadProjects();
  
  for (const row of dashboardData) {
    // Column A = Location, Column J = Status
    const locationName = row['Location'] || row['A'] || '';
    const statusText = (row['Status'] || row['J'] || '').toLowerCase().trim();
    const address = row['Address'] || row['D'] || '';
    const dataFilled = parseInt(row['Data filled'] || row['H'] || '0') || 0;
    const totalData = parseInt(row['Total Data (Estimated)'] || row['I'] || '0') || 0;
    
    // Skip header row and grid group headers (but remember current grid)
    if (!locationName || locationName === 'Location') {
      continue;
    }
    
    // Check if this is a grid header (contains "Grid")
    if (locationName.includes('Grid')) {
      continue; // Skip grid headers, we'll determine grid by coordinates
    }
    
    // Determine status from the Status column
    let status = 'pending';
    if (statusText.includes('complet')) {
      status = 'completed';
      completedLocations++;
    } else if (statusText.includes('progress') || statusText.includes('proceed')) {
      status = 'in-progress';
      inProgressLocations++;
    } else {
      pendingLocations++;
    }
    
    // Calculate progress percentage
    const progressPercent = totalData > 0 ? Math.min(100, (dataFilled / totalData) * 100) : 0;
    
    // Find matching projects
    const locationProjects = projects.filter(p => 
      p.location?.toLowerCase() === locationName.toLowerCase()
    );
    
    // Search OneMap for coordinates
    let coords = null;
    try {
      coords = await getLocationCoordinates(locationName + ' Singapore');
    } catch (err) {
      console.warn(`Could not get coordinates for ${locationName}:`, err);
    }
    
    // Determine which grid this location belongs to
    const grid = coords ? getLocationGrid(coords) : null;
    
    locationProgress.push({
      name: locationName,
      address: address,
      collected: dataFilled,
      target: totalData,
      progressPercent,
      status,
      statusText: statusText,
      coords,
      grid,
      projects: locationProjects
    });
    
    totalLocations++;
    
    if (coords && grid) {
      console.log(`📍 ${locationName} → ${grid} (${status})`);
    }
  }
  
  // Update stats display
  document.getElementById('dashboardTotalLocations').textContent = totalLocations;
  document.getElementById('dashboardCompleted').textContent = completedLocations;
  document.getElementById('dashboardInProgress').textContent = inProgressLocations;
  document.getElementById('dashboardPending').textContent = pendingLocations;
  
  // Add markers for each location with valid coordinates
  const validLocations = locationProgress.filter(loc => loc.coords);
  console.log(`📍 Adding ${validLocations.length} markers to map (${locationProgress.length - validLocations.length} locations without coordinates)`);
  
  for (const loc of validLocations) {
    addDashboardLocationMarker(loc);
  }
  
  // Fit map to show all markers
  if (validLocations.length > 0) {
    const bounds = L.latLngBounds(validLocations.map(loc => [loc.coords.lat, loc.coords.lng]));
    progressDashboardMap.fitBounds(bounds, { padding: [50, 50] });
  }
  
  // Log locations without coordinates for debugging
  const missingCoords = locationProgress.filter(loc => !loc.coords);
  if (missingCoords.length > 0) {
    console.log('⚠️ Locations without coordinates:', missingCoords.map(l => l.name));
  }
}

// Add a location marker to the dashboard map
function addDashboardLocationMarker(location) {
  if (!progressDashboardMap || !location.coords) return;
  
  // Determine color based on status
  let color = '#888888'; // pending
  let statusIcon = '○'; // empty circle
  if (location.status === 'completed') {
    color = '#44ff44';
    statusIcon = '✓';
  } else if (location.status === 'in-progress') {
    color = '#ffaa00';
    statusIcon = '◐';
  }
  
  const icon = L.divIcon({
    className: 'dashboard-location-marker',
    html: `
      <div class="location-marker-dot" style="background-color: ${color}; border-color: ${color};">
        <span class="location-marker-icon">${statusIcon}</span>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
  
  const marker = L.marker([location.coords.lat, location.coords.lng], { icon })
    .addTo(progressDashboardMap);
  
  // Click handler to show details
  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    showLocationDetails(location);
  });
  
  // Tooltip with name and status
  const tooltipContent = `<strong>${location.name}</strong><br>${location.collected}/${location.target}`;
  marker.bindTooltip(tooltipContent, {
    permanent: false,
    direction: 'top',
    offset: [0, -15],
    className: 'dashboard-tooltip'
  });
  
  dashboardLocationMarkers[location.name] = marker;
}

// Show location details panel
function showLocationDetails(location) {
  selectedDashboardLocation = location;
  
  const panel = document.getElementById('locationDetailsPanel');
  const nameEl = document.getElementById('locationDetailName');
  const statusEl = document.getElementById('locationDetailStatus');
  const progressEl = document.getElementById('locationDetailProgress');
  const addressEl = document.getElementById('locationDetailAddress');
  
  if (!panel) return;
  
  nameEl.textContent = location.name;
  progressEl.textContent = `${location.collected} / ${location.target}`;
  addressEl.textContent = location.address || '-';
  
  // Status badge - use status from sheet
  statusEl.className = 'detail-value status-badge ' + location.status;
  if (location.status === 'completed') {
    statusEl.textContent = 'Completed';
  } else if (location.status === 'in-progress') {
    statusEl.textContent = 'In Progress';
  } else {
    statusEl.textContent = 'Pending';
  }
  
  // Show panel
  panel.classList.remove('hidden');
  
  // Setup action buttons
  const openBtn = document.getElementById('openLocationProject');
  const startBtn = document.getElementById('startLocationScan');
  
  if (openBtn) {
    openBtn.onclick = () => {
      if (location.projects && location.projects.length > 0) {
        setActiveProject(location.projects[0].id);
        openProjectMenu();
      } else {
        alert('No project found for this location. Create a new project first.');
      }
    };
  }
  
  if (startBtn) {
    startBtn.onclick = () => {
      if (location.projects && location.projects.length > 0) {
        setActiveProject(location.projects[0].id);
        setActiveScreen(screens.visionApp);
        setVisionView('camera');
      } else {
        alert('No project found for this location. Create a new project first.');
      }
    };
  }
}

// ===== FIELD NAVIGATOR (Option C) =====
let fieldNavMap = null;
let fieldNavMarkers = [];
let fieldNavUserMarker = null;
let fieldNavEnabled = false;

// Initialize field navigator for a residential project
async function initFieldNavigator() {
  const project = getActiveProject();
  
  // Only show for custom tab residential projects
  if (!project?.isCustomTab || project?.projectCategory !== 'Residential') {
    hideFieldNavigator();
    return;
  }
  
  const container = document.getElementById('fieldNavContainer');
  const mapElement = document.getElementById('fieldNavMap');
  
  if (!container || !mapElement) return;
  
  // Show the navigator
  container.classList.remove('hidden');
  fieldNavEnabled = true;
  
  // Initialize map if not already
  if (!fieldNavMap) {
    fieldNavMap = L.map('fieldNavMap', {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false
    }).setView([1.3521, 103.8198], 16);
    
    // Use OneMap tiles
    L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
      detectRetina: true,
      maxZoom: 19,
      minZoom: 11
    }).addTo(fieldNavMap);
  }
  
  // Invalidate size
  setTimeout(() => {
    if (fieldNavMap) {
      fieldNavMap.invalidateSize();
    }
  }, 300);
  
  // Load street data
  const streetName = project?.defaultAddress?.street;
  if (streetName) {
    await loadFieldNavStreet(streetName);
  }
  
  // Setup toggle button
  const toggleBtn = document.getElementById('toggleFieldNav');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      const content = document.getElementById('fieldNavContent');
      if (content) {
        content.classList.toggle('collapsed');
        toggleBtn.textContent = content.classList.contains('collapsed') ? '▲' : '▼';
      }
    };
  }
}

// Hide field navigator
function hideFieldNavigator() {
  const container = document.getElementById('fieldNavContainer');
  if (container) {
    container.classList.add('hidden');
  }
  fieldNavEnabled = false;
}

// Load street data into field navigator
async function loadFieldNavStreet(streetName) {
  if (!fieldNavMap) return;
  
  // Clear existing markers
  fieldNavMarkers.forEach(marker => {
    if (fieldNavMap) fieldNavMap.removeLayer(marker);
  });
  fieldNavMarkers = [];
  
  // Search for street addresses
  const results = await searchOneMap(streetName + ' Singapore');
  if (!results || results.length === 0) return;
  
  // Load completed addresses
  await loadCompletedAddressesForStreet(streetName);
  
  let completedCount = 0;
  let pendingCount = 0;
  let pendingAddresses = [];
  
  // Add markers for each address
  for (const result of results) {
    const lat = parseFloat(result.LATITUDE);
    const lng = parseFloat(result.LONGITUDE);
    const blkNo = result.BLK_NO || '';
    const postal = result.POSTAL || '';
    const address = result.ADDRESS || '';
    
    const isCompleted = isAddressCompleted(address, blkNo, postal);
    
    if (isCompleted) {
      completedCount++;
    } else {
      pendingCount++;
      pendingAddresses.push({ lat, lng, blkNo, address });
    }
    
    // Create small marker
    const markerColor = isCompleted ? '#44ff44' : '#888888';
    const icon = L.divIcon({
      className: 'field-nav-marker',
      html: `<div class="nav-marker-dot" style="background: ${markerColor};"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
    
    const marker = L.marker([lat, lng], { icon }).addTo(fieldNavMap);
    fieldNavMarkers.push(marker);
  }
  
  // Update stats
  document.getElementById('fieldNavCompleted').textContent = `${completedCount} done`;
  document.getElementById('fieldNavRemaining').textContent = `${pendingCount} left`;
  
  // Show next target if available
  updateNextTarget(pendingAddresses);
  
  // Fit map to markers
  if (fieldNavMarkers.length > 0) {
    const group = L.featureGroup(fieldNavMarkers);
    fieldNavMap.fitBounds(group.getBounds(), { padding: [20, 20] });
  }
}

// Update the next target display
function updateNextTarget(pendingAddresses) {
  const nextTargetDiv = document.getElementById('fieldNavNextTarget');
  const nextAddressEl = document.getElementById('nextTargetAddress');
  const nextDistanceEl = document.getElementById('nextTargetDistance');
  
  if (!nextTargetDiv || pendingAddresses.length === 0) {
    if (nextTargetDiv) nextTargetDiv.classList.add('hidden');
    return;
  }
  
  // Find nearest pending address to current location
  let nearest = pendingAddresses[0];
  let nearestDistance = Infinity;
  
  if (currentLocation && currentLocation.lat) {
    for (const addr of pendingAddresses) {
      const dist = calculateDistance(currentLocation.lat, currentLocation.lng, addr.lat, addr.lng);
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearest = addr;
      }
    }
  }
  
  nextAddressEl.textContent = nearest.blkNo || nearest.address || 'Next house';
  
  if (nearestDistance < Infinity) {
    if (nearestDistance < 1) {
      nextDistanceEl.textContent = `${Math.round(nearestDistance * 1000)}m`;
    } else {
      nextDistanceEl.textContent = `${nearestDistance.toFixed(1)}km`;
    }
  } else {
    nextDistanceEl.textContent = '';
  }
  
  nextTargetDiv.classList.remove('hidden');
}

// Update user location on field nav map
function updateFieldNavUserLocation(lat, lng) {
  if (!fieldNavMap || !fieldNavEnabled) return;
  
  if (fieldNavUserMarker) {
    fieldNavUserMarker.setLatLng([lat, lng]);
  } else {
    const icon = L.divIcon({
      className: 'field-nav-user-marker',
      html: '<div class="user-marker-dot"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    
    fieldNavUserMarker = L.marker([lat, lng], { icon }).addTo(fieldNavMap);
  }
}

// ===== ENHANCED STREET NAVIGATOR =====
let streetNavMap = null;
let streetNavMarkers = [];
let streetNavUserMarker = null;
let streetNavEnabled = false;
let streetAddresses = []; // All addresses loaded from OneMap
let selectedHouseNumber = null; // Currently selected house number for scanning
const STREET_ADDRESSES_CACHE_KEY = 'streetAddressesCache';

// Initialize Street Navigator for residential projects
async function initStreetNavigator() {
  const project = getActiveProject();
  
  // Only show for residential projects
  if (!project?.isCustomTab || project?.projectCategory !== 'Residential') {
    hideStreetNavigator();
    return;
  }
  
  // Hide the old Field Navigator when using Street Navigator
  hideFieldNavigator();
  
  const container = document.getElementById('streetNavContainer');
  const mapElement = document.getElementById('streetNavMap');
  const streetNameEl = document.getElementById('streetNavName');
  
  if (!container) return;
  
  const streetName = project?.defaultAddress?.street;
  if (!streetName) {
    console.log('No street name in project, hiding street navigator');
    hideStreetNavigator();
    return;
  }
  
  // Update street name display
  if (streetNameEl) {
    streetNameEl.textContent = streetName;
  }
  
  // Show the navigator
  container.classList.remove('hidden');
  streetNavEnabled = true;
  
  // Initialize map if element exists and map not initialized
  if (mapElement && !streetNavMap) {
    streetNavMap = L.map('streetNavMap', {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false
    }).setView([1.3521, 103.8198], 16);
    
    L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
      detectRetina: true,
      maxZoom: 19,
      minZoom: 11
    }).addTo(streetNavMap);
  }
  
  // Invalidate size after a delay
  setTimeout(() => {
    if (streetNavMap) {
      streetNavMap.invalidateSize();
    }
  }, 300);
  
  // Load street addresses
  await loadStreetAddresses(streetName);
  
  // Setup toggle button
  const toggleBtn = document.getElementById('toggleStreetNav');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      const content = document.getElementById('streetNavContent');
      if (content) {
        content.classList.toggle('collapsed');
        toggleBtn.textContent = content.classList.contains('collapsed') ? '▲' : '▼';
      }
    };
  }
  
  // Setup refresh button
  const refreshBtn = document.getElementById('refreshStreetData');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.classList.add('spinning');
      await loadStreetAddresses(streetName, true);
      refreshBtn.classList.remove('spinning');
    };
  }
}

// Hide Street Navigator
function hideStreetNavigator() {
  const container = document.getElementById('streetNavContainer');
  if (container) {
    container.classList.add('hidden');
  }
  streetNavEnabled = false;
  selectedHouseNumber = null;
}

// Load all addresses on a street from Google Sheets (primary) or OneMap (fallback)
async function loadStreetAddresses(streetName, forceRefresh = false) {
  if (!streetName) return;
  
  const project = getActiveProject();
  const cacheKey = `${STREET_ADDRESSES_CACHE_KEY}_${streetName.toLowerCase().replace(/\s+/g, '_')}`;
  
  // Check cache first (unless forcing refresh)
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        // Cache valid for 24 hours
        if (data.timestamp && (Date.now() - data.timestamp) < 24 * 60 * 60 * 1000) {
          streetAddresses = data.addresses || [];
          console.log(`📍 Loaded ${streetAddresses.length} addresses from cache for "${streetName}"`);
          await updateStreetNavigatorUI();
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to load street addresses from cache:', e);
    }
  }
  
  // Try loading from Google Sheets first (more accurate)
  console.log(`📍 Loading addresses for "${streetName}" from Google Sheets...`);
  const sheetSuccess = await loadStreetAddressesFromSheet(streetName);
  
  if (sheetSuccess && streetAddresses.length > 0) {
    console.log(`📍 Found ${streetAddresses.length} addresses from Google Sheets for "${streetName}"`);
  } else {
    // Fallback to OneMap if Google Sheets fails or returns no results
    console.log(`📍 Falling back to OneMap for "${streetName}"...`);
    await loadStreetAddressesFromOneMap(streetName);
  }
  
  if (streetAddresses.length === 0) {
    console.log(`📍 No addresses found for "${streetName}"`);
    updateStreetNavigatorUI();
    return;
  }
  
  // Sort by house number (numeric, then alphanumeric)
  streetAddresses.sort((a, b) => {
    const numA = parseInt(a.houseNo) || 0;
    const numB = parseInt(b.houseNo) || 0;
    if (numA !== numB) return numA - numB;
    return a.houseNo.localeCompare(b.houseNo);
  });
  
  console.log(`📍 Total ${streetAddresses.length} addresses loaded for "${streetName}"`);

  // Cache the results
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      source: streetAddresses.length > 0 ? 'sheets' : 'onemap',
      addresses: streetAddresses
    }));
  } catch (e) {
    console.warn('Failed to cache street addresses:', e);
  }
  
  await updateStreetNavigatorUI();
}

// Load addresses from Google Sheets "Residential" tab
async function loadStreetAddressesFromSheet(streetName) {
  try {
    // Fetch from the "Residential" master tab
    const result = await fetchFromGoogleSheets({ tabName: 'Residential' });
    
    if (!result.success || !result.records || result.records.length === 0) {
      console.log('📍 No data in Residential sheet or fetch failed');
      return false;
    }
    
    console.log(`📍 Fetched ${result.records.length} total records from Residential sheet`);
    
    // Normalize the street name for matching
    const streetLower = streetName.toLowerCase().trim();
    
    // Filter records that match the street name
    const matchingRecords = result.records.filter(record => {
      const recordStreet = (record.Street || record.street || '').toLowerCase().trim();
      // Flexible matching: contains or equals
      return recordStreet.includes(streetLower) || streetLower.includes(recordStreet);
    });
    
    console.log(`📍 Found ${matchingRecords.length} records matching "${streetName}"`);
    
    if (matchingRecords.length === 0) {
      return false;
    }
    
    // Parse records into structured addresses
    const parsedAddresses = matchingRecords.map(record => {
      // Parse Latlong - handle various formats
      let lat = 0, lng = 0;
      const latlong = record.Latlong || record.latlong || record['Lat-Long'] || record['LatLong'] || record.Coordinates || '';
      if (latlong) {
        // Handle format: "1.3018, 103.839" or "1.3018,103.839"
        const parts = latlong.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          lat = parts[0];
          lng = parts[1];
        }
      }
      
      // Get house number - try multiple column names
      const houseNo = record.House_No || record.house_no || record.HouseNo || record['House No'] || record.Block || '';
      
      // Get other fields
      const street = record.Street || record.street || streetName;
      const building = record.Building || record.building || '';
      const postcode = record.Postcode || record.postcode || '';
      const name = record.Name || record.name || `${houseNo} ${street}`;
      
      return {
        houseNo: String(houseNo).trim(),
        street: street,
        building: building,
        postcode: String(postcode).trim(),
        address: name,
        lat: lat,
        lng: lng,
        source: 'sheets'
      };
    }).filter(a => a.houseNo && a.lat && a.lng); // Only keep entries with house numbers AND valid coordinates
    
    // Remove duplicates based on house number
    const seen = new Set();
    streetAddresses = parsedAddresses.filter(addr => {
      const key = addr.houseNo.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    
    return streetAddresses.length > 0;
  } catch (error) {
    console.error('Error loading addresses from sheet:', error);
    return false;
  }
}

// Load addresses from OneMap (fallback)
async function loadStreetAddressesFromOneMap(streetName) {
  // Search OneMap for all addresses on this street - fetch ALL pages
  const results = await searchOneMap(streetName + ' Singapore', true);
  
  if (!results || results.length === 0) {
    streetAddresses = [];
    return;
  }
  
  // Parse results into structured addresses
  const parsedAddresses = results.map(r => ({
    houseNo: r.BLK_NO || '',
    street: r.ROAD_NAME || streetName,
    building: r.BUILDING || '',
    postcode: r.POSTAL || '',
    address: r.ADDRESS || '',
    lat: parseFloat(r.LATITUDE),
    lng: parseFloat(r.LONGITUDE),
    searchVal: r.SEARCHVAL || '',
    source: 'onemap'
  })).filter(a => a.houseNo);
  
  // Remove duplicates based on house number + postcode
  const seen = new Set();
  streetAddresses = parsedAddresses.filter(addr => {
    const key = `${addr.houseNo}-${addr.postcode}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  
  // Cache the results
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      addresses: streetAddresses
    }));
  } catch (e) {
    console.warn('Failed to cache street addresses:', e);
  }
  
  await updateStreetNavigatorUI();
}

// Update the Street Navigator UI with current data
async function updateStreetNavigatorUI() {
  const project = getActiveProject();
  const streetName = project?.defaultAddress?.street;
  
  // Load completed addresses from Google Sheets
  if (streetName) {
    await loadCompletedAddressesForStreet(streetName);
  }
  
  // Count completed and pending
  let completedCount = 0;
  let pendingCount = 0;
  
  streetAddresses.forEach(addr => {
    if (isAddressCompleted(addr.address, addr.houseNo, addr.postcode)) {
      completedCount++;
    } else {
      pendingCount++;
    }
  });
  
  // Update stats
  const completedEl = document.getElementById('streetNavCompleted');
  const pendingEl = document.getElementById('streetNavPending');
  const totalEl = document.getElementById('streetNavTotal');
  const progressEl = document.getElementById('streetNavProgress');
  
  if (completedEl) completedEl.textContent = completedCount;
  if (pendingEl) pendingEl.textContent = pendingCount;
  if (totalEl) totalEl.textContent = streetAddresses.length;
  if (progressEl) progressEl.textContent = `${completedCount}/${streetAddresses.length}`;
  
  // Populate house number buttons
  populateHouseNumberButtons();
  
  // Update map markers
  updateStreetNavMapMarkers();
}

// Populate the house number quick-select buttons
function populateHouseNumberButtons() {
  const container = document.getElementById('streetNavNumbersList');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (streetAddresses.length === 0) {
    container.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px; padding: 10px;">No addresses found. Try refreshing.</div>';
    return;
  }
  
  streetAddresses.forEach(addr => {
    const isCompleted = isAddressCompleted(addr.address, addr.houseNo, addr.postcode);
    const isSelected = selectedHouseNumber === addr.houseNo;
    
    const btn = document.createElement('button');
    btn.className = `number-btn${isCompleted ? ' completed' : ''}${isSelected ? ' selected' : ''}`;
    btn.textContent = addr.houseNo;
    btn.title = `${addr.houseNo} ${addr.street}${addr.postcode ? ` (${addr.postcode})` : ''}`;
    
    btn.onclick = () => {
      if (isCompleted) {
        // Allow re-selection of completed addresses
        if (!confirm(`${addr.houseNo} ${addr.street} is already scanned. Select anyway?`)) {
          return;
        }
      }
      selectHouseNumber(addr.houseNo);
    };
    
    container.appendChild(btn);
  });
}

// Select a house number for the next scan
function selectHouseNumber(houseNo) {
  selectedHouseNumber = houseNo;
  
  // Update button states
  const buttons = document.querySelectorAll('.number-btn');
  buttons.forEach(btn => {
    if (btn.textContent === houseNo) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });
  
  // Update map marker
  updateStreetNavMapMarkers();
  
  // Find the selected address and center map on it
  const addr = streetAddresses.find(a => a.houseNo === houseNo);
  if (addr && streetNavMap) {
    streetNavMap.setView([addr.lat, addr.lng], 18);
  }
  
  console.log(`📍 Selected house number: ${houseNo}`);
}

// Get the currently selected house number (for use when scanning)
function getSelectedHouseNumber() {
  return selectedHouseNumber;
}

// Clear the selected house number after successful scan
function clearSelectedHouseNumber() {
  selectedHouseNumber = null;
  const buttons = document.querySelectorAll('.number-btn');
  buttons.forEach(btn => btn.classList.remove('selected'));
}

// Update map markers in Street Navigator
function updateStreetNavMapMarkers() {
  if (!streetNavMap) return;
  
  // Clear existing markers
  streetNavMarkers.forEach(marker => {
    if (streetNavMap) streetNavMap.removeLayer(marker);
  });
  streetNavMarkers = [];
  
  // Add markers for each address
  streetAddresses.forEach(addr => {
    const isCompleted = isAddressCompleted(addr.address, addr.houseNo, addr.postcode);
    const isSelected = selectedHouseNumber === addr.houseNo;
    
    let statusClass = isCompleted ? 'completed' : 'pending';
    if (isSelected) statusClass = 'selected';
    
    const icon = L.divIcon({
      className: 'street-marker',
      html: `<div class="street-marker-dot ${statusClass}">${addr.houseNo}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    
    const marker = L.marker([addr.lat, addr.lng], { icon })
      .addTo(streetNavMap)
      .bindPopup(`
        <strong>${addr.houseNo} ${addr.street}</strong><br>
        ${addr.postcode ? `Postal: ${addr.postcode}<br>` : ''}
        <span style="color: ${isCompleted ? '#44ff44' : '#ffaa00'}">
          ${isCompleted ? '✅ Completed' : '⏳ Pending'}
        </span>
      `);
    
    marker.on('click', () => {
      if (!isCompleted) {
        selectHouseNumber(addr.houseNo);
      }
    });
    
    streetNavMarkers.push(marker);
  });
  
  // Fit map to show all markers
  if (streetNavMarkers.length > 0) {
    const group = L.featureGroup(streetNavMarkers);
    streetNavMap.fitBounds(group.getBounds(), { padding: [20, 20] });
  }
}

// Refresh Street Navigator after a successful scan
async function refreshStreetNavigator() {
  if (!streetNavEnabled) return;
  
  const project = getActiveProject();
  const streetName = project?.defaultAddress?.street;
  
  if (streetName) {
    // Reload completed addresses and update UI
    await loadCompletedAddressesForStreet(streetName);
    await updateStreetNavigatorUI();
  }
  
  // Clear selected house number
  clearSelectedHouseNumber();
}

// Update user location on street nav map
function updateStreetNavUserLocation(lat, lng) {
  if (!streetNavMap || !streetNavEnabled) return;
  
  if (streetNavUserMarker) {
    streetNavUserMarker.setLatLng([lat, lng]);
  } else {
    const icon = L.divIcon({
      className: 'field-nav-user-marker',
      html: '<div class="user-marker-dot"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    
    streetNavUserMarker = L.marker([lat, lng], { icon }).addTo(streetNavMap);
  }
}

// ===== CONDO SCANNER =====
let condoSearchResults = [];
let condoPreviewMap = null;
let condoMarkers = [];
let condoCameraStream = null;
let condoCapturedImageData = null;
let condoDetectedName = '';
let scannedCondos = []; // Store all scanned condos in session

// Initialize Condo Scanner screen
function initializeCondoScanner() {
  // Reset state for new scan
  condoSearchResults = [];
  condoCapturedImageData = null;
  condoDetectedName = '';
  
  // Show capture section, hide others
  document.getElementById('condoCaptureSection')?.classList.remove('hidden');
  document.getElementById('condoProcessingSection')?.classList.add('hidden');
  document.getElementById('condoResultsSection')?.classList.add('hidden');
  document.getElementById('condoNoResults')?.classList.add('hidden');
  document.getElementById('condoDetectBtn')?.classList.add('hidden');
  document.getElementById('condoCapturedImage')?.classList.add('hidden');
  
  // Show data section if we have scanned condos
  updateCondoDataSection();
  
  // Start camera
  startCondoCamera();
  
  // Setup event listeners
  setupCondoEventListeners();
}

// Setup event listeners for condo scanner
function setupCondoEventListeners() {
  const captureBtn = document.getElementById('condoCaptureBtn');
  if (captureBtn) {
    captureBtn.onclick = captureCondoPhoto;
  }
  
  const uploadInput = document.getElementById('condoUploadInput');
  if (uploadInput) {
    uploadInput.onchange = handleCondoUpload;
  }
  
  const retakeBtn = document.getElementById('condoRetakeBtn');
  if (retakeBtn) {
    retakeBtn.onclick = retakeCondoPhoto;
  }
  
  const detectBtn = document.getElementById('condoDetectBtn');
  if (detectBtn) {
    detectBtn.onclick = detectCondoName;
  }
  
  const saveBtn = document.getElementById('condoSaveBtn');
  if (saveBtn) {
    saveBtn.onclick = saveCondoAndContinue;
  }
  
  const tryAgainBtn = document.getElementById('condoTryAgainBtn');
  if (tryAgainBtn) {
    tryAgainBtn.onclick = () => {
      document.getElementById('condoNoResults')?.classList.add('hidden');
      document.getElementById('condoCaptureSection')?.classList.remove('hidden');
      retakeCondoPhoto();
    };
  }
  
  const manualSearchBtn = document.getElementById('condoManualSearchBtn');
  if (manualSearchBtn) {
    manualSearchBtn.onclick = () => {
      const input = document.getElementById('condoManualInput');
      if (input?.value?.trim()) {
        condoDetectedName = input.value.trim();
        searchCondoBlocks(condoDetectedName);
      }
    };
  }
}

// Start camera for condo scanning
async function startCondoCamera() {
  const video = document.getElementById('condoCameraPreview');
  if (!video) return;
  
  try {
    // Stop any existing stream
    if (condoCameraStream) {
      condoCameraStream.getTracks().forEach(track => track.stop());
    }
    
    condoCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    
    video.srcObject = condoCameraStream;
    video.style.display = 'block';
    console.log('📸 Condo camera started');
  } catch (error) {
    console.error('Error starting condo camera:', error);
  }
}

// Stop condo camera
function stopCondoCamera() {
  if (condoCameraStream) {
    condoCameraStream.getTracks().forEach(track => track.stop());
    condoCameraStream = null;
  }
}

// Capture photo of condo name
function captureCondoPhoto() {
  const video = document.getElementById('condoCameraPreview');
  const canvas = document.getElementById('condoCaptureCanvas');
  const capturedImg = document.getElementById('condoCapturedImg');
  const capturedContainer = document.getElementById('condoCapturedImage');
  
  if (!video || !canvas) return;
  
  // Set canvas size to video dimensions
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  // Draw video frame to canvas
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  
  // Get image data
  condoCapturedImageData = canvas.toDataURL('image/jpeg', 0.9);
  
  // Show captured image
  if (capturedImg) {
    capturedImg.src = condoCapturedImageData;
  }
  if (capturedContainer) {
    capturedContainer.classList.remove('hidden');
  }
  
  // Hide video, show detect button
  video.style.display = 'none';
  document.getElementById('condoDetectBtn')?.classList.remove('hidden');
  
  console.log('📸 Condo photo captured');
}

// Handle image upload
function handleCondoUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    condoCapturedImageData = e.target.result;
    
    const capturedImg = document.getElementById('condoCapturedImg');
    const capturedContainer = document.getElementById('condoCapturedImage');
    const video = document.getElementById('condoCameraPreview');
    
    if (capturedImg) {
      capturedImg.src = condoCapturedImageData;
    }
    if (capturedContainer) {
      capturedContainer.classList.remove('hidden');
    }
    if (video) {
      video.style.display = 'none';
    }
    
    document.getElementById('condoDetectBtn')?.classList.remove('hidden');
    console.log('📁 Condo image uploaded');
  };
  reader.readAsDataURL(file);
}

// Retake photo
function retakeCondoPhoto() {
  condoCapturedImageData = null;
  
  document.getElementById('condoCapturedImage')?.classList.add('hidden');
  document.getElementById('condoDetectBtn')?.classList.add('hidden');
  
  const video = document.getElementById('condoCameraPreview');
  if (video) {
    video.style.display = 'block';
  }
  
  startCondoCamera();
}

// Detect condo name using AI
async function detectCondoName() {
  if (!condoCapturedImageData) {
    alert('Please capture or upload an image first');
    return;
  }
  
  // Show processing
  document.getElementById('condoCaptureSection')?.classList.add('hidden');
  document.getElementById('condoProcessingSection')?.classList.remove('hidden');
  document.getElementById('condoProcessingText').textContent = 'Detecting condo name...';
  
  console.log('🤖 Detecting condo name with AI...');
  
  try {
    // Call OpenAI to detect condo name
    const response = await fetch('/.netlify/functions/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a condo name detector. Extract ONLY the condominium/development name from the image. Return ONLY the name, nothing else. If you cannot detect a condo name, return "NOT_FOUND".'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is the name of this condominium/development? Return ONLY the name.' },
              { type: 'image_url', image_url: { url: condoCapturedImageData } }
            ]
          }
        ],
        max_tokens: 100
      })
    });
    
    const data = await response.json();
    const detectedName = data.choices?.[0]?.message?.content?.trim();
    
    console.log(`🤖 AI detected: "${detectedName}"`);
    
    if (!detectedName || detectedName === 'NOT_FOUND' || detectedName.length < 2) {
      // No condo name detected
      document.getElementById('condoProcessingSection')?.classList.add('hidden');
      document.getElementById('condoNoResults')?.classList.remove('hidden');
      document.getElementById('condoNoResultsText').textContent = 'Could not detect condo name from image';
      return;
    }
    
    condoDetectedName = detectedName;
    
    // Search for condo blocks
    document.getElementById('condoProcessingText').textContent = `Searching for "${detectedName}" blocks...`;
    await searchCondoBlocks(detectedName);
    
  } catch (error) {
    console.error('Error detecting condo name:', error);
    document.getElementById('condoProcessingSection')?.classList.add('hidden');
    document.getElementById('condoNoResults')?.classList.remove('hidden');
    document.getElementById('condoNoResultsText').textContent = 'Error detecting condo name';
  }
}

// Search OneMap for condo blocks
async function searchCondoBlocks(condoName) {
  console.log(`🏘️ Searching OneMap for: "${condoName}"`);
  
  try {
    // Search OneMap - fetch all pages to get all blocks
    const results = await searchOneMap(condoName + ' Singapore', true);
    
    if (!results || results.length === 0) {
      document.getElementById('condoProcessingSection')?.classList.add('hidden');
      document.getElementById('condoNoResults')?.classList.remove('hidden');
      document.getElementById('condoNoResultsText').textContent = `No results found for "${condoName}"`;
      return;
    }
    
    // Parse results - group by building name
    const buildingGroups = {};
    
    results.forEach(r => {
      const building = r.BUILDING || '';
      const blkNo = r.BLK_NO || '';
      const address = r.ADDRESS || '';
      const postal = r.POSTAL || '';
      const lat = parseFloat(r.LATITUDE);
      const lng = parseFloat(r.LONGITUDE);
      const street = r.ROAD_NAME || '';
      
      if (!building) return;
      
      const buildingLower = building.toLowerCase();
      const queryLower = condoName.toLowerCase();
      
      // Check if building name contains the search query
      if (!buildingLower.includes(queryLower) && !queryLower.includes(buildingLower)) {
        return;
      }
      
      if (!buildingGroups[building]) {
        buildingGroups[building] = [];
      }
      
      // Avoid duplicates by postal code
      if (!buildingGroups[building].some(b => b.postal === postal)) {
        buildingGroups[building].push({
          building,
          blkNo,
          address,
          postal,
          lat,
          lng,
          street
        });
      }
    });
    
    // Find the building group with most blocks
    let bestMatch = null;
    let bestCount = 0;
    
    for (const [building, blocks] of Object.entries(buildingGroups)) {
      if (blocks.length > bestCount) {
        bestCount = blocks.length;
        bestMatch = building;
      }
    }
    
    if (!bestMatch || bestCount === 0) {
      document.getElementById('condoProcessingSection')?.classList.add('hidden');
      document.getElementById('condoNoResults')?.classList.remove('hidden');
      document.getElementById('condoNoResultsText').textContent = `No blocks found for "${condoName}"`;
      return;
    }
    
    // Get the blocks for the best match
    condoSearchResults = buildingGroups[bestMatch];
    condoDetectedName = bestMatch; // Use the official name from OneMap
    
    // Sort by block number
    condoSearchResults.sort((a, b) => {
      const numA = parseInt(a.blkNo) || 0;
      const numB = parseInt(b.blkNo) || 0;
      if (numA !== numB) return numA - numB;
      return a.blkNo.localeCompare(b.blkNo);
    });
    
    console.log(`🏘️ Found ${condoSearchResults.length} blocks for "${bestMatch}"`);
    
    // Show results
    showCondoResults();
    
  } catch (error) {
    console.error('Error searching condo blocks:', error);
    document.getElementById('condoProcessingSection')?.classList.add('hidden');
    document.getElementById('condoNoResults')?.classList.remove('hidden');
    document.getElementById('condoNoResultsText').textContent = 'Error searching for condo blocks';
  }
}

// Show condo results
function showCondoResults() {
  document.getElementById('condoProcessingSection')?.classList.add('hidden');
  document.getElementById('condoResultsSection')?.classList.remove('hidden');
  
  // Set parent POI info
  document.getElementById('condoParentName').textContent = condoDetectedName;
  document.getElementById('condoParentPhoto').src = condoCapturedImageData;
  
  // Get parent address from first block
  const firstBlock = condoSearchResults[0];
  if (firstBlock) {
    document.getElementById('condoParentAddress').textContent = 
      `${firstBlock.street}, Singapore ${firstBlock.postal}`;
  }
  
  // Set block count
  document.getElementById('condoBlockCount').textContent = `${condoSearchResults.length} blocks`;
  
  // Render blocks list
  renderCondoBlocks();
  
  // Initialize map
  initCondoPreviewMap();
}

// Render the blocks list (child POIs)
function renderCondoBlocks() {
  const container = document.getElementById('condoBlocksList');
  if (!container) return;
  
  container.innerHTML = '';
  
  condoSearchResults.forEach(block => {
    const item = document.createElement('div');
    item.className = 'condo-block-item';
    
    // Format: "35 Amber Gardens, The Esta"
    const blockName = `${block.blkNo} ${block.street}, ${condoDetectedName}`;
    
    item.innerHTML = `
      <div class="condo-block-icon">🏢</div>
      <div class="condo-block-info">
        <div class="condo-block-name">${blockName}</div>
        <div class="condo-block-address">${block.address} | ${block.postal}</div>
      </div>
    `;
    
    container.appendChild(item);
  });
}

// Initialize condo preview map
function initCondoPreviewMap() {
  const mapElement = document.getElementById('condoMapPreview');
  if (!mapElement) return;
  
  // Initialize map if not already
  if (!condoPreviewMap) {
    condoPreviewMap = L.map('condoMapPreview', {
      zoomControl: false,
      attributionControl: false
    }).setView([1.3521, 103.8198], 15);
    
    L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
      detectRetina: true,
      maxZoom: 19,
      minZoom: 11
    }).addTo(condoPreviewMap);
  }
  
  // Invalidate size
  setTimeout(() => {
    if (condoPreviewMap) {
      condoPreviewMap.invalidateSize();
    }
  }, 300);
  
  updateCondoMapMarkers();
}

// Update condo map markers
function updateCondoMapMarkers() {
  if (!condoPreviewMap) return;
  
  // Clear existing markers
  condoMarkers.forEach(marker => condoPreviewMap.removeLayer(marker));
  condoMarkers = [];
  
  // Add markers for each block
  condoSearchResults.forEach(block => {
    if (!block.lat || !block.lng) return;
    
    const icon = L.divIcon({
      className: 'condo-map-marker',
      html: `<div style="
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #4be0a8;
        border: 2px solid #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 700;
        color: #000;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      ">${block.blkNo || '?'}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    
    const marker = L.marker([block.lat, block.lng], { icon })
      .addTo(condoPreviewMap)
      .bindPopup(`<strong>${block.address}</strong><br>Postal: ${block.postal}`);
    
    condoMarkers.push(marker);
  });
  
  // Fit map to show all markers
  if (condoMarkers.length > 0) {
    const group = L.featureGroup(condoMarkers);
    condoPreviewMap.fitBounds(group.getBounds(), { padding: [20, 20] });
  }
}

/**
 * Convert text to title case (capitalize first letter of each word)
 */
function toTitleCase(str) {
  if (!str || typeof str !== 'string') return str;
  return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Get current date in Singapore timezone (GMT+8)
 */
function getSingaporeDate() {
  const now = new Date();
  // Convert to Singapore time (UTC+8)
  const singaporeOffset = 8 * 60; // Singapore is UTC+8 (8 hours * 60 minutes)
  const localOffset = now.getTimezoneOffset(); // Local timezone offset in minutes
  const singaporeTime = new Date(now.getTime() + (localOffset + singaporeOffset) * 60 * 1000);
  return singaporeTime.toISOString().split('T')[0];
}

// Save condo to Google Sheets and continue scanning
async function saveCondoAndContinue() {
  const firstBlock = condoSearchResults[0];
  const date = getSingaporeDate(); // Use Singapore timezone
  const project = getActiveProject();
  const email = project?.email || '';
  
  // Convert condo name to title case
  const condoNameTitleCase = toTitleCase(condoDetectedName);
  
  console.log(`💾 Saving ${condoNameTitleCase} with ${condoSearchResults.length} blocks to Condominium tab...`);
  
  // Create parent POI entry
  const parentEntry = {
    entryId: `condo-parent-${Date.now()}`,
    projectId: project?.id || '',
    projectName: project?.name || 'bnsV', // Changed from 'Condo Scanner' to 'bnsV'
    projectLocation: condoNameTitleCase,
    projectDate: date,
    projectEmail: email,
    environment: 'Outdoor',
    category: 'Condominium',
    storeName: condoNameTitleCase, // POI Name: The condo name (title case)
    lat: firstBlock?.lat || '',
    lng: firstBlock?.lng || '',
    houseNo: toTitleCase(firstBlock?.blkNo || ''),
    street: toTitleCase(firstBlock?.street || ''),
    unit: '',
    floor: '',
    building: condoNameTitleCase,
    postcode: firstBlock?.postal || '',
    poiType: 'Parent',
    photoBase64: condoCapturedImageData,
    syncStatus: 'pending'
  };
  
  // Sync parent to "Condominium" tab
  const parentResult = await syncToGoogleSheets(parentEntry, 'Condominium');
  console.log(`📤 Parent POI synced: ${parentResult.success ? 'Success' : 'Failed'}`);
  
  // Create child POI entries for each block
  for (const block of condoSearchResults) {
    const childEntry = {
      entryId: `condo-child-${block.postal}-${Date.now()}`,
      projectId: project?.id || '',
      projectName: project?.name || 'bnsV', // Changed from 'Condo Scanner' to 'bnsV'
      projectLocation: condoNameTitleCase,
      projectDate: date,
      projectEmail: email,
      environment: 'Indoor',
      category: 'Condominium',
      storeName: `${toTitleCase(block.blkNo || '')} ${toTitleCase(block.street || '')}, ${condoNameTitleCase}`, // Child name format (title case)
      lat: block.lat,
      lng: block.lng,
      houseNo: toTitleCase(block.blkNo || ''),
      street: toTitleCase(block.street || ''),
      unit: '',
      floor: '',
      building: condoNameTitleCase,
      postcode: block.postal,
      poiType: 'Child',
      parentPOI: condoNameTitleCase, // Reference to parent
      syncStatus: 'pending'
    };
    
    syncToGoogleSheets(childEntry, 'Condominium');
  }
  
  console.log(`✅ Synced ${condoSearchResults.length + 1} entries to Condominium tab`);
  
  // Add to scanned condos list
  scannedCondos.push({
    name: condoDetectedName,
    blocks: condoSearchResults.length,
    photo: condoCapturedImageData,
    timestamp: Date.now()
  });
  
  // Reset for next scan
  condoSearchResults = [];
  condoCapturedImageData = null;
  condoDetectedName = '';
  
  // Show capture section again
  document.getElementById('condoResultsSection')?.classList.add('hidden');
  document.getElementById('condoCaptureSection')?.classList.remove('hidden');
  document.getElementById('condoCapturedImage')?.classList.add('hidden');
  document.getElementById('condoDetectBtn')?.classList.add('hidden');
  
  // Update data section
  updateCondoDataSection();
  
  // Start camera for next scan
  retakeCondoPhoto();
  
  // Show success toast
  showToast(`✅ Saved ${condoDetectedName} with ${condoSearchResults.length + 1} entries`);
}

// Update the scanned condos data section
function updateCondoDataSection() {
  const section = document.getElementById('condoDataSection');
  const countEl = document.getElementById('condoDataCount');
  const list = document.getElementById('condoDataList');
  
  if (!section || !list) return;
  
  if (scannedCondos.length === 0) {
    section.classList.add('hidden');
    return;
  }
  
  section.classList.remove('hidden');
  countEl.textContent = `${scannedCondos.length} condo${scannedCondos.length !== 1 ? 's' : ''}`;
  
  list.innerHTML = '';
  
  scannedCondos.forEach(condo => {
    const item = document.createElement('div');
    item.className = 'condo-data-item';
    item.innerHTML = `
      <div class="condo-data-item-photo">
        <img src="${condo.photo}" alt="${condo.name}">
      </div>
      <div class="condo-data-item-info">
        <div class="condo-data-item-name">${condo.name}</div>
        <div class="condo-data-item-blocks">${condo.blocks} blocks</div>
      </div>
    `;
    list.appendChild(item);
  });
}

// Helper function to show toast messages
function showToast(message) {
  // Create toast element
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    color: #4be0a8;
    padding: 12px 24px;
    border-radius: 25px;
    font-size: 14px;
    z-index: 9999;
    animation: fadeInUp 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function loadAnnotations() {
  try {
    const json = localStorage.getItem(ANNOTATIONS_KEY);
    if (!json) return null;
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function saveAnnotations() {
  if (!annotationLayer) return;
  const geojson = annotationLayer.toGeoJSON();
  localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(geojson));
}

// Initialize maps with fallback tile sources
function initializeMaps() {
  console.log('Initializing maps...');
  
  // Check if Leaflet is loaded
  if (typeof L === 'undefined') {
    console.error('Leaflet library not loaded');
    setTimeout(initializeMaps, 2000); // Retry after 2 seconds
    return;
  }
  
  // Check if map containers exist
  const miniMapContainer = document.getElementById('miniMap');
  const fullMapContainer = document.getElementById('fullMap');
  
  if (!miniMapContainer) {
    console.error('Mini map container not found');
    return;
  }
  
  if (!fullMapContainer) {
    console.error('Full map container not found');
    return;
  }
  
  console.log('Map containers found, Leaflet loaded');
  
  // Initialize mini map
  if (!miniMap) {
    try {
      miniMap = L.map('miniMap', {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false
      }).setView([1.3521, 103.8198], 12); // Singapore center

      // Add tile layers with fallback
      addTileLayersToMap(miniMap);
      console.log('Mini map initialized successfully');
      
    } catch (error) {
      console.error('Error initializing mini map:', error);
      // Show error in UI
      const mapStatus = document.getElementById('mapStatus');
      if (mapStatus) mapStatus.textContent = '🗺️ Map loading error';
    }
  }

  // Initialize full map
  if (!fullMap) {
    try {
      fullMap = L.map('fullMap', {
        zoomControl: true,
        attributionControl: true,
        doubleClickZoom: false,
        tap: false
      }).setView([1.3521, 103.8198], 12);

      // Add tile layers with fallback
      addTileLayersToMap(fullMap);
      console.log('Full map initialized successfully');

      // Click-to-add route points is gated by explicit mode to avoid interference with drawing tools
      fullMap.on('click', function(e) {
        if (addRoutePointMode) {
          addRoutePoint(e.latlng);
        }
      });

      // Initialize annotations layer and controls
      annotationLayer = new L.FeatureGroup();
      fullMap.addLayer(annotationLayer);
      try {
        drawControl = new L.Control.Draw({
          position: 'topright',
          draw: {
            polyline: { shapeOptions: { color: '#ff9800', weight: 3 }, touchExtend: true, repeatMode: true, maxPoints: 1000 },
            polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#e91e63', weight: 2, fillOpacity: 0.1 } },
            rectangle: { shapeOptions: { color: '#3f51b5', weight: 2, fillOpacity: 0.1 } },
            circle: false,
            circlemarker: false,
            marker: { icon: createMarkerIcon('pending', currentMarkerStyle), repeatMode: true }
          },
          edit: {
            featureGroup: annotationLayer,
            remove: true
          }
        });
        fullMap.addControl(drawControl);
      } catch (e) {
        console.warn('Leaflet.Draw not available');
      }
      // While drawing, disable map gestures and suppress double-tap finish on iOS
      fullMap.on('draw:drawstart', function(e) {
        try {
          fullMap.dragging.disable();
          fullMap.boxZoom.disable();
        } catch(_){}
        // Monkey patch: force Polyline handler to not finish on dblclick
        try {
          const handler = e && e.layer ? e.layer : null;
        } catch(_){}
      });
      fullMap.on('draw:drawstop', function() { try { fullMap.dragging.enable(); fullMap.boxZoom.enable(); } catch(_){} });
      fullMap.on('dblclick', function(e){ if (e && e.originalEvent) e.originalEvent.preventDefault(); L.DomEvent.stop(e); });
      const fullMapEl = document.getElementById('fullMap');
      if (fullMapEl) {
        fullMapEl.addEventListener('dblclick', function(e){ e.preventDefault(); e.stopPropagation(); }, true);
      }

      // Restore saved annotations
      const saved = loadAnnotations();
      if (saved && saved.type === 'FeatureCollection') {
        L.geoJSON(saved, {
          pointToLayer: function(feature, latlng) {
            const status = feature.properties && feature.properties.status || 'pending';
            const style = feature.properties && feature.properties.markerStyle || currentMarkerStyle;
            return L.marker(latlng, { icon: createMarkerIcon(status, style) });
          },
          style: function(feature) {
            return feature.properties && feature.properties._style || {};
          },
          onEachFeature: function(feature, layer) {
            attachAnnotationHandlers(layer, feature.properties || {});
          }
        }).eachLayer(l => annotationLayer.addLayer(l));
      }

      // Handle creation/edit/delete
      fullMap.on(L.Draw.Event.CREATED, function (evt) {
        const layer = evt.layer;
        // Default properties
        layer.feature = layer.feature || { type: 'Feature', properties: {} };
        if (layer instanceof L.Marker) {
          layer.feature.properties.status = 'pending';
          layer.feature.properties.markerStyle = currentMarkerStyle;
          // Force the icon to match current selection immediately
          try { layer.setIcon(createMarkerIcon('pending', currentMarkerStyle)); } catch(_) {}
        }
        attachAnnotationHandlers(layer, layer.feature.properties);
        annotationLayer.addLayer(layer);
        saveAnnotations();
      });

      fullMap.on(L.Draw.Event.EDITED, function () {
        saveAnnotations();
      });
      fullMap.on(L.Draw.Event.DELETED, function () {
        saveAnnotations();
      });
      
    } catch (error) {
      console.error('Error initializing full map:', error);
    }
  }
  
  // Add interaction handlers after both maps are initialized
  setTimeout(() => {
    addMapInteractionHandlers();
  }, 500);
}
// Minimize/expand mini map
const toggleMiniMapBtn = document.getElementById('toggleMiniMapBtn');
if (toggleMiniMapBtn) {
  toggleMiniMapBtn.addEventListener('click', () => {
    const miniMapEl = document.getElementById('miniMap');
    if (!miniMapEl) return;
    const minimized = miniMapEl.classList.toggle('minimized');
    toggleMiniMapBtn.textContent = minimized ? '▸' : '▾';
  });
}

// Add tile layers with Carto map (replacing OpenStreetMap)
function addTileLayersToMap(map) {
  // Use Carto Positron (light theme) - free and no API key required
  const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
    errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  });
  cartoLayer.addTo(map);

  // Mark map as loaded when tiles load successfully
  cartoLayer.on('load', function() {
    const mapContainer = map.getContainer();
    if (mapContainer) {
      mapContainer.classList.add('loaded');
    }
  });

  // Force map to refresh and invalidate size
  setTimeout(() => { map.invalidateSize(); }, 100);
  setTimeout(() => { map.invalidateSize(); }, 500);
  setTimeout(() => { map.invalidateSize(); }, 1000);
}

// Load and display project progress from Google Sheets
async function loadAndDisplayProjectProgress() {
  console.log('📊 Loading project progress from Google Sheets...');
  
  const projects = loadProjects();
  if (!projects || projects.length === 0) {
    console.log('No projects found');
    return;
  }

  // Clear existing markers
  clearProjectProgressMarkers();

  // Fetch progress for each project location
  const progressPromises = PROJECT_LOCATIONS.map(async (location) => {
    try {
      // Check if there are any projects for this location
      const locationProjects = projects.filter(p => p.location === location.name);
      if (locationProjects.length === 0) {
        return null;
      }

      // Fetch data from Google Sheets for this location
      const result = await fetchFromGoogleSheets({
        tabName: location.name,
        includeDeleted: false
      });

      if (result.success && result.records) {
        const collected = result.records.length;
        // For now, we'll use a default target (you can customize this)
        // In the future, this could come from project settings or a separate config
        const target = 100; // Default target - can be made configurable
        
        return {
          location: location.name,
          collected: collected,
          remaining: Math.max(0, target - collected),
          target: target,
          progress: target > 0 ? (collected / target) * 100 : 0,
          coordinates: await geocodeLocation(location)
        };
      }
    } catch (error) {
      console.error(`Error fetching progress for ${location.name}:`, error);
      return null;
    }
  });

  const progressData = (await Promise.all(progressPromises)).filter(Boolean);
  
  // Store progress data
  projectProgressData = {};
  progressData.forEach(data => {
    projectProgressData[data.location] = data;
  });

  // Display markers on map
  displayProjectProgressMarkers(progressData);
  
  // Update progress summary
  updateProgressSummary(progressData);
}

// Geocode location address to get coordinates
async function geocodeLocation(location) {
  // Try to construct address from location data
  const addressParts = [];
  if (location.houseNo) addressParts.push(location.houseNo);
  if (location.street) addressParts.push(location.street);
  if (location.building) addressParts.push(location.building);
  if (location.postcode) addressParts.push(location.postcode);
  
  const address = addressParts.join(', ') + ', Singapore';
  
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data && data.length > 0) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
  } catch (error) {
    console.error(`Geocoding error for ${location.name}:`, error);
  }
  
  // Fallback to Singapore center if geocoding fails
  return [1.3521, 103.8198];
}

// Display progress markers on the map
function displayProjectProgressMarkers(progressData) {
  if (!fullMap) return;

  progressData.forEach(data => {
    if (!data.coordinates) return;

    const [lat, lng] = data.coordinates;
    const progressPercent = Math.min(100, data.progress);
    
    // Color based on progress: red (0-33%), yellow (34-66%), green (67-100%)
    let color = '#ff4444'; // red
    if (progressPercent >= 67) color = '#44ff44'; // green
    else if (progressPercent >= 34) color = '#ffaa00'; // yellow

    // Create custom icon with progress indicator
    const icon = L.divIcon({
      className: 'project-progress-marker',
      html: `
        <div class="progress-marker" style="background-color: ${color};">
          <div class="progress-marker-content">
            <div class="progress-marker-title">${data.location}</div>
            <div class="progress-marker-stats">
              <span>${data.collected}/${data.target}</span>
              <span class="progress-percent">${Math.round(progressPercent)}%</span>
            </div>
            <div class="progress-marker-remaining">${data.remaining} remaining</div>
          </div>
        </div>
      `,
      iconSize: [150, 80],
      iconAnchor: [75, 40]
    });

    const marker = L.marker([lat, lng], { icon: icon }).addTo(fullMap);
    
    // Add popup with detailed info
    marker.bindPopup(`
      <div class="project-progress-popup">
        <h3>${data.location}</h3>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${progressPercent}%; background-color: ${color};"></div>
        </div>
        <div class="progress-details">
          <div><strong>Collected:</strong> ${data.collected}</div>
          <div><strong>Target:</strong> ${data.target}</div>
          <div><strong>Remaining:</strong> ${data.remaining}</div>
          <div><strong>Progress:</strong> ${Math.round(progressPercent)}%</div>
        </div>
      </div>
    `);

    projectProgressMarkers[data.location] = marker;
  });

  // Fit map to show all markers
  if (progressData.length > 0) {
    const bounds = progressData
      .filter(d => d.coordinates)
      .map(d => d.coordinates);
    
    if (bounds.length > 0) {
      fullMap.fitBounds(bounds, { padding: [50, 50] });
    }
  }
}

// Clear existing progress markers
function clearProjectProgressMarkers() {
  Object.values(projectProgressMarkers).forEach(marker => {
    if (fullMap && marker) {
      fullMap.removeLayer(marker);
    }
  });
  projectProgressMarkers = {};
}

// Update progress summary in UI
function updateProgressSummary(progressData) {
  const mapStatus = document.getElementById('mapStatus');
  if (!mapStatus) return;

  if (progressData.length === 0) {
    mapStatus.textContent = '📍 No project progress data available';
    return;
  }

  const totalCollected = progressData.reduce((sum, d) => sum + d.collected, 0);
  const totalTarget = progressData.reduce((sum, d) => sum + d.target, 0);
  const totalRemaining = progressData.reduce((sum, d) => sum + d.remaining, 0);
  const avgProgress = progressData.reduce((sum, d) => sum + d.progress, 0) / progressData.length;

  mapStatus.innerHTML = `
    <span>📊 Projects: ${progressData.length} | Collected: ${totalCollected}/${totalTarget} | Remaining: ${totalRemaining} | Avg Progress: ${Math.round(avgProgress)}%</span>
  `;
}

// Update user location on both maps with smooth tracking
function updateUserLocation(lat, lng, heading = null, accuracy = null) {
  const location = [lat, lng];
  const isFirstLocation = !lastUserLocation;
  lastUserLocation = { lat, lng };

  // Create Google Maps style blue dot with accuracy circle
  if (userLocationMarker) {
    // Smooth animation to new position
    userLocationMarker.setLatLng(location);
    
    // Update heading if available
    if (heading !== null) {
      const markerElement = userLocationMarker.getElement();
      if (markerElement) {
        const dot = markerElement.querySelector('.user-dot');
        if (dot) {
          dot.style.transform = `rotate(${heading}deg)`;
        }
      }
    }
  } else {
    // Create blue location dot similar to Google Maps
    const userIcon = L.divIcon({
      className: 'user-location-marker',
      html: `
        <div class="user-location-container">
          <div class="user-dot-pulse"></div>
          <div class="user-dot" style="transform: rotate(${heading || 0}deg);">
            <div class="user-dot-inner"></div>
            <div class="user-dot-direction"></div>
          </div>
        </div>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    userLocationMarker = L.marker(location, { icon: userIcon });
    
    // Add to mini map
    if (miniMap) {
      userLocationMarker.addTo(miniMap);
    }
    
    // Add to full map only if it exists and is currently visible
    if (fullMap) {
      userLocationMarker.addTo(fullMap);
    }
  }

  // Update accuracy circle
  if (accuracy && accuracy < 100) { // Only show if accuracy is reasonable
    if (userAccuracyCircle) {
      userAccuracyCircle.setLatLng(location);
      userAccuracyCircle.setRadius(accuracy);
    } else {
      userAccuracyCircle = L.circle(location, {
        radius: accuracy,
        color: '#4285f4',
        fillColor: '#4285f4',
        fillOpacity: 0.1,
        weight: 1,
        opacity: 0.3
      });
      
      // Add to mini map
      if (miniMap) {
        userAccuracyCircle.addTo(miniMap);
      }
      
      // Add to full map if it exists
      if (fullMap) {
        userAccuracyCircle.addTo(fullMap);
      }
    }
  }

  // Follow user location (like Google Maps)
  if (followUserLocation) {
    const zoomLevel = isFirstLocation ? 16 : null; // Zoom in on first location, maintain zoom after
    
    // Smooth pan to user location on mini map
    if (miniMap) {
      if (zoomLevel) {
        miniMap.setView(location, zoomLevel, { animate: true, duration: 1.0 });
      } else {
        miniMap.panTo(location, { animate: true, duration: 0.5 });
      }
    }
    
    // Also update full map if it's open
    if (fullMap && !document.getElementById('fullMapOverlay').classList.contains('hidden')) {
      if (zoomLevel) {
        fullMap.setView(location, zoomLevel, { animate: true, duration: 1.0 });
      } else {
        fullMap.panTo(location, { animate: true, duration: 0.5 });
      }
    }
  }

  // Update status
  const mapStatus = document.getElementById('mapStatus');
  if (mapStatus) {
    const accuracyText = accuracy ? ` (±${Math.round(accuracy)}m)` : '';
    mapStatus.textContent = `📍 Location tracking${accuracyText}`;
  }
}

// Add route point for planning
function addRoutePoint(latlng) {
  const point = {
    lat: latlng.lat,
    lng: latlng.lng,
    id: Date.now(),
    marker: null
  };

  // Create marker
  const marker = L.marker([point.lat, point.lng], {
    draggable: true
  }).addTo(fullMap);

  marker.bindPopup(`Point ${routePoints.length + 1}<br><button onclick="removeRoutePoint(${point.id})">Remove</button>`);
  
  // Update marker position when dragged
  marker.on('dragend', function() {
    const pos = marker.getLatLng();
    point.lat = pos.lat;
    point.lng = pos.lng;
    updateRouteDisplay();
  });

  point.marker = marker;
  routePoints.push(point);
  
  updateRouteDisplay();
}

// Remove route point
function removeRoutePoint(pointId) {
  const index = routePoints.findIndex(p => p.id === pointId);
  if (index !== -1) {
    const point = routePoints[index];
    if (point.marker) {
      fullMap.removeLayer(point.marker);
    }
    routePoints.splice(index, 1);
    updateRouteDisplay();
  }
}

// Update route line and stats
function updateRouteDisplay() {
  // Remove existing route line
  if (routeLine) {
    fullMap.removeLayer(routeLine);
    routeLine = null;
  }

  if (routePoints.length > 1) {
    // Create route line
    const latlngs = routePoints.map(p => [p.lat, p.lng]);
    routeLine = L.polyline(latlngs, {
      color: '#00b14f',
      weight: 4,
      opacity: 0.7
    }).addTo(fullMap);

    // Calculate route statistics
    let totalDistance = 0;
    for (let i = 0; i < routePoints.length - 1; i++) {
      const p1 = routePoints[i];
      const p2 = routePoints[i + 1];
      totalDistance += getDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    }

    // Update UI
    const routeDistance = document.getElementById('routeDistance');
    const routeTime = document.getElementById('routeTime');
    const routePointsEl = document.getElementById('routePoints');

    if (routeDistance) routeDistance.textContent = `Distance: ${totalDistance.toFixed(1)} km`;
    if (routeTime) routeTime.textContent = `Time: ${Math.ceil(totalDistance * 12)} min`; // 5 km/h walking speed
    if (routePointsEl) routePointsEl.textContent = `Points: ${routePoints.length}`;

    // Update route progress
    const routeProgress = document.getElementById('routeProgress');
    if (routeProgress) {
      routeProgress.textContent = `${routePoints.length} stops planned`;
    }
  } else {
    // Clear stats
    const routeDistance = document.getElementById('routeDistance');
    const routeTime = document.getElementById('routeTime');
    const routePointsEl = document.getElementById('routePoints');
    const routeProgress = document.getElementById('routeProgress');

    if (routeDistance) routeDistance.textContent = 'Distance: 0 km';
    if (routeTime) routeTime.textContent = 'Time: 0 min';
    if (routePointsEl) routePointsEl.textContent = 'Points: 0';
    if (routeProgress) routeProgress.textContent = '';
  }
}

// Optimize route using nearest neighbor algorithm
function optimizeRoute() {
  if (routePoints.length < 3) return;

  // Get user location as starting point
  let currentLat = currentLocation.lat;
  let currentLng = currentLocation.lng;

  if (!currentLat || !currentLng) {
    alert('Current location not available for optimization');
    return;
  }

  const optimized = [];
  const remaining = [...routePoints];

  // Start from current location
  while (remaining.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    // Find nearest unvisited point
    for (let i = 0; i < remaining.length; i++) {
      const distance = getDistance(currentLat, currentLng, remaining[i].lat, remaining[i].lng);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    // Move to optimized array
    const nearest = remaining.splice(nearestIndex, 1)[0];
    optimized.push(nearest);
    currentLat = nearest.lat;
    currentLng = nearest.lng;
  }

  // Update route points array
  routePoints = optimized;
  
  // Update markers popup text
  routePoints.forEach((point, index) => {
    if (point.marker) {
      point.marker.bindPopup(`Point ${index + 1}<br><button onclick="removeRoutePoint(${point.id})">Remove</button>`);
    }
  });

  updateRouteDisplay();
  
  alert(`Route optimized! Total distance: ${document.getElementById('routeDistance').textContent.split(': ')[1]}`);
}

// Clear all route points
function clearRoute() {
  routePoints.forEach(point => {
    if (point.marker) {
      fullMap.removeLayer(point.marker);
    }
  });
  routePoints = [];
  updateRouteDisplay();
}

// Map UI event handlers
document.addEventListener('DOMContentLoaded', function() {
  // Show loading indicator
  const mapStatus = document.getElementById('mapStatus');
  if (mapStatus) mapStatus.textContent = '🗺️ Loading maps...';
  
  // Initialize maps when page loads with longer delay for mobile
  setTimeout(initializeMaps, 1000);
  
  // Also try to initialize after Leaflet is fully loaded
  if (typeof L !== 'undefined') {
    setTimeout(initializeMaps, 1500);
  }

  // Map expand button
  const mapExpandBtn = document.getElementById('mapExpandBtn');
  const fullMapOverlay = document.getElementById('fullMapOverlay');
  const mapCloseBtn = document.getElementById('mapCloseBtn');
  const requestLocationBtn = document.getElementById('requestLocationBtn');
  const followLocationBtn = document.getElementById('followLocationBtn');

  if (mapExpandBtn && fullMapOverlay) {
    mapExpandBtn.addEventListener('click', function() {
      console.log('Opening full map overlay');
      fullMapOverlay.classList.remove('hidden');
      
      // Force scroll to top and lock body scrolling
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      
      // Invalidate size after animation
      setTimeout(() => {
        if (fullMap) {
          fullMap.invalidateSize();
          // Ensure user location is visible on full map
          syncUserLocationToFullMap();
        }
        
        // Debug: Check if close button is visible
        const closeBtn = document.getElementById('mapCloseBtn');
        if (closeBtn) {
          const rect = closeBtn.getBoundingClientRect();
          console.log('Close button position:', {
            top: rect.top,
            right: rect.right,
            width: rect.width,
            height: rect.height,
            visible: rect.width > 0 && rect.height > 0
          });
        }
      }, 300);
    });
  }

  if (mapCloseBtn && fullMapOverlay) {
    mapCloseBtn.addEventListener('click', function(e) {
      console.log('Close button clicked');
      e.preventDefault();
      e.stopPropagation();
      fullMapOverlay.classList.add('hidden');
      
      // Restore body scrolling
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    });
    
    // Also add touch event for mobile
    mapCloseBtn.addEventListener('touchend', function(e) {
      console.log('Close button touched');
      e.preventDefault();
      e.stopPropagation();
      fullMapOverlay.classList.add('hidden');
      
      // Restore body scrolling
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    });
    
    console.log('Map close button event listeners added');
  } else {
    console.error('Map close button or overlay not found:', { mapCloseBtn, fullMapOverlay });
  }

  // Photo capture toggle removed

  // Add backup close methods
  if (fullMapOverlay) {
    // Close on overlay background click
    fullMapOverlay.addEventListener('click', function(e) {
      if (e.target === fullMapOverlay) {
        console.log('Overlay background clicked');
        fullMapOverlay.classList.add('hidden');
      }
    });
    
    // Close on escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !fullMapOverlay.classList.contains('hidden')) {
        console.log('Escape key pressed');
        fullMapOverlay.classList.add('hidden');
      }
    });
  }

  // Route control buttons
  const clearRouteBtn = document.getElementById('clearRouteBtn');
  const optimizeRouteBtn = document.getElementById('optimizeRouteBtn');
  const centerOnUserBtn = document.getElementById('centerOnUserBtn');
  const addRoutePointModeBtn = document.getElementById('addRoutePointModeBtn');
  const markerStyleBtn = document.getElementById('markerStyleBtn');

  if (clearRouteBtn) {
    clearRouteBtn.addEventListener('click', clearRoute);
  }

  if (optimizeRouteBtn) {
    optimizeRouteBtn.addEventListener('click', optimizeRoute);
  }

  if (centerOnUserBtn) {
    centerOnUserBtn.addEventListener('click', function() {
      if (lastUserLocation && fullMap) {
        // Ensure user location markers are on the full map
        syncUserLocationToFullMap();
        
        // Center on user location with appropriate zoom
        const currentZoom = fullMap.getZoom();
        const targetZoom = currentZoom < 16 ? 16 : currentZoom;
        fullMap.setView([lastUserLocation.lat, lastUserLocation.lng], targetZoom, { animate: true });
        
        // Enable follow mode
        followUserLocation = true;
        updateFollowButtonState();
        
        console.log('Centered full map on user location');
      } else {
        alert('User location not available. Please ensure location services are enabled.');
      }
    });
  }

  if (addRoutePointModeBtn) {
    addRoutePointModeBtn.addEventListener('click', function() {
      addRoutePointMode = !addRoutePointMode;
      addRoutePointModeBtn.classList.toggle('active', addRoutePointMode);
      addRoutePointModeBtn.textContent = addRoutePointMode ? 'Adding… (tap map)' : 'Add Point';
    });
  }

  if (markerStyleBtn) {
    // Avoid focusing issues on mobile by using pointerup
    const handler = function() {
      currentMarkerStyle = currentMarkerStyle === 'cross' ? 'dot' : currentMarkerStyle === 'dot' ? 'circle' : 'cross';
      const label = currentMarkerStyle === 'cross' ? 'Marker: Cross' : currentMarkerStyle === 'dot' ? 'Marker: Dot' : 'Marker: Circle';
      markerStyleBtn.textContent = label;
      // Rebuild draw control so new icon is used
      try {
        if (drawControl) {
          fullMap.removeControl(drawControl);
        }
        drawControl = new L.Control.Draw({
          position: 'topright',
          draw: {
            polyline: { shapeOptions: { color: '#ff9800', weight: 3 }, touchExtend: true, repeatMode: true, maxPoints: 1000 },
            polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#e91e63', weight: 2, fillOpacity: 0.1 } },
            rectangle: { shapeOptions: { color: '#3f51b5', weight: 2, fillOpacity: 0.1 } },
            circle: false,
            circlemarker: false,
            marker: { icon: createMarkerIcon('pending', currentMarkerStyle), repeatMode: true }
          },
          edit: { featureGroup: annotationLayer, remove: true }
        });
        fullMap.addControl(drawControl);
      } catch(_) {}
    };
    markerStyleBtn.addEventListener('click', handler);
    markerStyleBtn.addEventListener('touchend', function(e){ e.preventDefault(); handler(); });
  }

  // Removed freehand line button to reduce header crowding

  // Manual location request button
  if (requestLocationBtn) {
    requestLocationBtn.addEventListener('click', function() {
      requestLocationPermission();
    });
  }

  // Follow location toggle button
  if (followLocationBtn) {
    // Set initial state
    updateFollowButtonState();
    
    followLocationBtn.addEventListener('click', function() {
      followUserLocation = !followUserLocation;
      updateFollowButtonState();
      
      // If enabling follow mode and we have a location, center on it
      if (followUserLocation && lastUserLocation) {
        if (miniMap) {
          miniMap.setView([lastUserLocation.lat, lastUserLocation.lng], miniMap.getZoom(), { animate: true });
        }
        if (fullMap && !fullMapOverlay.classList.contains('hidden')) {
          fullMap.setView([lastUserLocation.lat, lastUserLocation.lng], fullMap.getZoom(), { animate: true });
        }
      }
    });
  }

});

// Request location permission and handle iOS Safari issues
async function requestLocationPermission() {
  const mapStatus = document.getElementById('mapStatus');
  
  if (!navigator.geolocation) {
    if (mapStatus) mapStatus.textContent = '📍 Geolocation not supported';
    console.log('Geolocation not supported');
    return;
  }

  // Update status to show we're requesting location
  if (mapStatus) mapStatus.textContent = '📍 Requesting location...';

  // iOS Safari requires HTTPS and user interaction for location
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
  
  if (isIOS && !isSecure) {
    if (mapStatus) mapStatus.textContent = '📍 HTTPS required for location on iOS';
    console.log('iOS requires HTTPS for geolocation');
    return;
  }

  // First try to get current position once to test permissions
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        {
          enableHighAccuracy: false, // Start with less accurate for faster response
          maximumAge: 60000, // Accept cached position up to 1 minute
          timeout: 15000 // Longer timeout for iOS
        }
      );
    });

    // Success! Update location immediately
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const heading = position.coords.heading;
    const accuracy = position.coords.accuracy;
    
    updateUserLocation(lat, lng, heading, accuracy);
    currentLocation.lat = lat;
    currentLocation.lng = lng;

    if (mapStatus) mapStatus.textContent = '📍 Location found';
    console.log('Initial location obtained:', lat, lng);

    // Now start watching position with better accuracy
    startLocationWatching();

  } catch (error) {
    console.log('Geolocation error:', error);
    handleLocationError(error);
  }
}

// Start continuous location watching after initial success
function startLocationWatching() {
  const watchId = navigator.geolocation.watchPosition(
    function(position) {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const heading = position.coords.heading;
      const accuracy = position.coords.accuracy;
      
      updateUserLocation(lat, lng, heading, accuracy);
      currentLocation.lat = lat;
      currentLocation.lng = lng;
    },
    function(error) {
      console.log('Watch position error:', error);
      handleLocationError(error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 20000 // Longer timeout for iOS
    }
  );

  // Store watch ID for potential cleanup
  window.locationWatchId = watchId;
}

// Handle different types of location errors
function handleLocationError(error) {
  const mapStatus = document.getElementById('mapStatus');
  const requestLocationBtn = document.getElementById('requestLocationBtn');
  let message = '📍 Location unavailable';

  switch(error.code) {
    case error.PERMISSION_DENIED:
      message = '📍 Tap 📍 to enable location';
      console.log('Location permission denied');
      // Show manual request button
      if (requestLocationBtn) requestLocationBtn.style.display = 'flex';
      // Show instructions for enabling location
      showLocationInstructions();
      break;
    case error.POSITION_UNAVAILABLE:
      message = '📍 Location unavailable';
      console.log('Location information unavailable');
      if (requestLocationBtn) requestLocationBtn.style.display = 'flex';
      break;
    case error.TIMEOUT:
      message = '📍 Location timeout - tap 📍 to retry';
      console.log('Location request timed out');
      if (requestLocationBtn) requestLocationBtn.style.display = 'flex';
      // Retry with less accuracy
      retryLocationWithLowerAccuracy();
      break;
    default:
      message = '📍 Location error - tap 📍 to retry';
      console.log('Unknown location error:', error);
      if (requestLocationBtn) requestLocationBtn.style.display = 'flex';
      break;
  }

  if (mapStatus) mapStatus.textContent = message;
}

// Retry location with lower accuracy settings
function retryLocationWithLowerAccuracy() {
  console.log('Retrying location with lower accuracy...');
  
  navigator.geolocation.getCurrentPosition(
    function(position) {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const heading = position.coords.heading;
      const accuracy = position.coords.accuracy;
      
      updateUserLocation(lat, lng, heading, accuracy);
      currentLocation.lat = lat;
      currentLocation.lng = lng;
      
      const mapStatus = document.getElementById('mapStatus');
      if (mapStatus) mapStatus.textContent = '📍 Location found (low accuracy)';
      
      // Start watching with lower accuracy
      startLocationWatching();
    },
    function(error) {
      console.log('Retry also failed:', error);
      const mapStatus = document.getElementById('mapStatus');
      if (mapStatus) mapStatus.textContent = '📍 Unable to get location';
    },
    {
      enableHighAccuracy: false,
      maximumAge: 300000, // 5 minutes
      timeout: 30000
    }
  );
}

// Show instructions for enabling location on iOS
function showLocationInstructions() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  
  if (isIOS) {
    // Create a temporary alert for iOS users
    setTimeout(() => {
      alert('To enable location:\n\n1. Go to Settings > Privacy & Security > Location Services\n2. Turn on Location Services\n3. Find Safari in the list\n4. Select "While Using App"\n5. Refresh this page');
    }, 1000);
  }
}

// Update follow button visual state
function updateFollowButtonState() {
  const followLocationBtn = document.getElementById('followLocationBtn');
  if (followLocationBtn) {
    if (followUserLocation) {
      followLocationBtn.classList.add('active');
      followLocationBtn.title = 'Following Location (Click to disable)';
    } else {
      followLocationBtn.classList.remove('active');
      followLocationBtn.title = 'Follow Location (Click to enable)';
    }
  }
}

// Sync user location to full map when it's opened
function syncUserLocationToFullMap() {
  console.log('syncUserLocationToFullMap called', { 
    fullMap: !!fullMap, 
    lastUserLocation: !!lastUserLocation,
    userLocationMarker: !!userLocationMarker 
  });
  
  if (!fullMap) {
    console.error('Full map not available');
    return;
  }
  
  if (!lastUserLocation) {
    console.warn('No user location available to sync');
    return;
  }
  
  try {
    // Force recreate user location marker for full map if needed
    if (lastUserLocation) {
      const location = [lastUserLocation.lat, lastUserLocation.lng];
      
      // Create a new marker specifically for full map to avoid conflicts
      const userIcon = L.divIcon({
        className: 'user-location-marker',
        html: `
          <div class="user-location-container">
            <div class="user-dot-pulse"></div>
            <div class="user-dot">
              <div class="user-dot-inner"></div>
              <div class="user-dot-direction"></div>
            </div>
          </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      
      // Remove existing marker if it exists
      fullMap.eachLayer(function(layer) {
        if (layer.options && layer.options.className === 'user-location-marker') {
          fullMap.removeLayer(layer);
        }
      });
      
      // Add new marker
      const fullMapUserMarker = L.marker(location, { icon: userIcon });
      fullMapUserMarker.addTo(fullMap);
      console.log('Added user location marker to full map at:', location);
      
      // Center the full map on user location
      const currentZoom = fullMap.getZoom();
      const targetZoom = currentZoom < 14 ? 16 : currentZoom;
      fullMap.setView(location, targetZoom, { animate: true });
      console.log('Centered full map on user location');
      
      // Enable follow mode
      followUserLocation = true;
      updateFollowButtonState();
    }
    
  } catch (error) {
    console.error('Error syncing user location to full map:', error);
  }
}

// Add map interaction handlers to disable following when user manually moves map
function addMapInteractionHandlers() {
  if (miniMap) {
    miniMap.on('dragstart', function() {
      // User is manually panning, disable follow mode
      if (followUserLocation) {
        followUserLocation = false;
        updateFollowButtonState();
      }
    });
  }
  
  if (fullMap) {
    fullMap.on('dragstart', function() {
      // User is manually panning, disable follow mode
      if (followUserLocation) {
        followUserLocation = false;
        updateFollowButtonState();
      }
    });
  }
}

// Make functions globally available
window.removeRoutePoint = removeRoutePoint; 

// Attach context menu handlers to toggle scanned/pending and set styles
function attachAnnotationHandlers(layer, props = {}) {
  // Persist style on polylines/polygons when edited
  if (layer.setStyle) {
    const style = layer.options || {};
    layer.feature = layer.feature || { type: 'Feature', properties: {} };
    layer.feature.properties._style = {
      color: style.color,
      weight: style.weight,
      fillColor: style.fillColor,
      fillOpacity: style.fillOpacity
    };
  }
  // Right-click or long-press menu
  layer.on('contextmenu', function(e) {
    if (layer instanceof L.Marker) {
      // Toggle scanned/pending
      const current = (layer.feature && layer.feature.properties && layer.feature.properties.status) || 'pending';
      const next = current === 'scanned' ? 'pending' : 'scanned';
      layer.feature = layer.feature || { type: 'Feature', properties: {} };
      layer.feature.properties.status = next;
      const style = (layer.feature.properties && layer.feature.properties.markerStyle) || currentMarkerStyle;
      const icon = createMarkerIcon(next, style);
      layer.setIcon(icon);
      saveAnnotations();
    }
  });
}

function createMarkerIcon(status = 'pending', style = currentMarkerStyle) {
  let html = '<div class="cross-marker"></div>';
  if (style === 'dot') html = '<div class="dot-marker"></div>';
  if (style === 'circle') html = '<div class="circle-marker"></div>';
  return L.divIcon({ className: `scan-status-marker ${status}`, html, iconSize: [18,18], iconAnchor: [9,9] });
}

const versionHistoryBtn = document.getElementById('versionHistoryBtn');
const appVersionLabel = document.getElementById('appVersion');
const APP_VERSION = '2.4.2';

// ===== ISOLATED BULK UPLOAD =====
let isolatedBulkUploadSettings = null;
let isolatedBulkUploadPhotos = [];
let isolatedBulkUploadSessions = [];

// Load isolated bulk upload sessions from localStorage
function loadIsolatedBulkUploadSessions() {
  try {
    const saved = localStorage.getItem('isolatedBulkUploadSessions');
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    return [];
  }
}

// Save isolated bulk upload sessions to localStorage
function saveIsolatedBulkUploadSessions() {
  localStorage.setItem('isolatedBulkUploadSessions', JSON.stringify(isolatedBulkUploadSessions));
}

// Initialize isolated bulk upload settings screen
async function initializeIsolatedBulkUploadSettings() {
  isolatedBulkUploadSettings = null;
  isolatedBulkUploadPhotos = [];
  
  // Set default date
  const dateInput = document.getElementById('isolatedBulkDate');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
  
  // Load existing tabs (we'll fetch from a known tab to get sheet metadata)
  await loadAvailableTabs();
  
  // Setup form handlers
  setupIsolatedBulkUploadForm();
  
  // Show/hide fields based on type selection
  const typeSelect = document.getElementById('isolatedBulkType');
  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      const type = typeSelect.value;
      const residentialFields = document.getElementById('isolatedBulkResidentialFields');
      const commercialFields = document.getElementById('isolatedBulkCommercialFields');
      
      if (residentialFields) {
        residentialFields.classList.toggle('hidden', type !== 'Residential');
      }
      if (commercialFields) {
        commercialFields.classList.toggle('hidden', type !== 'Commercial');
      }
    });
  }
}

// Load available tabs from Google Sheets
async function loadAvailableTabs() {
  const tabSelect = document.getElementById('isolatedBulkTabSelect');
  if (!tabSelect) return;
  
  // For now, we'll use a workaround - try to fetch from Sheet1 to get sheet metadata
  // In a real implementation, you'd call a Google Sheets API to list all tabs
  // For now, we'll populate with common tab names or let user type new one
  tabSelect.innerHTML = '<option value="">Select existing tab...</option>';
  
  // Try to get tabs from known projects
  const projects = loadProjects();
  const knownTabs = new Set();
  projects.forEach(p => {
    if (p.sheetTab) knownTabs.add(p.sheetTab);
    if (p.location) knownTabs.add(p.location);
  });
  
  // Add known tabs to dropdown
  Array.from(knownTabs).sort().forEach(tab => {
    const option = document.createElement('option');
    option.value = tab;
    option.textContent = tab;
    tabSelect.appendChild(option);
  });
}

// Setup isolated bulk upload form
function setupIsolatedBulkUploadForm() {
  const form = document.getElementById('isolatedBulkUploadForm');
  const cancelBtn = document.getElementById('isolatedBulkCancelBtn');
  const backBtn = document.getElementById('isolatedBulkUploadBackBtn');
  
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleIsolatedBulkUploadSubmit();
    });
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      setActiveScreen(screens.buildingSelection);
    });
  }
  
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      setActiveScreen(screens.buildingSelection);
    });
  }
}

// Handle isolated bulk upload form submission
async function handleIsolatedBulkUploadSubmit() {
  const tabSelect = document.getElementById('isolatedBulkTabSelect');
  const newTabInput = document.getElementById('isolatedBulkNewTabInput');
  const email = document.getElementById('isolatedBulkEmail')?.value;
  const date = document.getElementById('isolatedBulkDate')?.value;
  const type = document.getElementById('isolatedBulkType')?.value;
  const environment = document.getElementById('isolatedBulkEnvironment')?.value;
  const street = document.getElementById('isolatedBulkStreet')?.value?.trim();
  
  // Determine tab name
  let tabName = '';
  if (newTabInput?.value?.trim()) {
    tabName = newTabInput.value.trim();
  } else if (tabSelect?.value) {
    tabName = tabSelect.value;
  }
  
  if (!tabName) {
    alert('Please select an existing tab or enter a new tab name');
    return;
  }
  
  if (!email || !date || !type || !environment) {
    alert('Please fill in all required fields');
    return;
  }
  
  if (type === 'Residential' && !street) {
    alert('Please enter street name for Residential bulk upload');
    return;
  }
  
  // Create/verify tab
  const tabResult = await createSheetTab(tabName);
  if (!tabResult.success) {
    alert(`Failed to create/access tab: ${tabResult.error}`);
    return;
  }
  
  // Store settings
  isolatedBulkUploadSettings = {
    tabName,
    email,
    date,
    type,
    environment,
    street: type === 'Residential' ? street : ''
  };
  
  // Update info display
  document.getElementById('isolatedBulkCurrentTab').textContent = tabName;
  document.getElementById('isolatedBulkCurrentType').textContent = type;
  document.getElementById('isolatedBulkCurrentStreet').textContent = type === 'Residential' ? street : 'N/A';
  
  // Go to upload screen
  setActiveScreen(screens.isolatedBulkUpload);
  setupIsolatedBulkUploadScreen();
}

// Setup isolated bulk upload screen (only run once)
let isolatedBulkUploadScreenSetup = false;

function setupIsolatedBulkUploadScreen() {
  console.log('🔧 Setting up isolated bulk upload screen...');
  
  const selectBtn = document.getElementById('isolatedBulkSelectBtn');
  const imageInput = document.getElementById('isolatedBulkImageInput');
  const clearBtn = document.getElementById('isolatedBulkClearBtn');
  const processBtn = document.getElementById('isolatedBulkProcessBtn');
  const backBtn = document.getElementById('isolatedBulkUploadScreenBackBtn');
  
  console.log('📋 Elements found:', {
    selectBtn: !!selectBtn,
    imageInput: !!imageInput,
    clearBtn: !!clearBtn,
    processBtn: !!processBtn,
    backBtn: !!backBtn
  });
  
  // Only setup listeners once to prevent duplicates
  if (!isolatedBulkUploadScreenSetup) {
    if (selectBtn && imageInput) {
      selectBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('📷 Select button clicked');
        // Clear input value before opening file picker to ensure change event fires
        // even if user selects the same files again
        imageInput.value = '';
        try {
          imageInput.click();
        } catch (error) {
          console.error('❌ Error triggering file input:', error);
          alert('Error opening file picker. Please try again.');
        }
      });
    }
    
    if (imageInput) {
      imageInput.addEventListener('change', handleIsolatedBulkPhotoSelect);
      // Also listen for input event (mobile browsers sometimes fire this)
      imageInput.addEventListener('input', handleIsolatedBulkPhotoSelect);
      console.log('✅ File input listeners attached');
    }
    
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        console.log('🗑️ Clearing photos');
        isolatedBulkUploadPhotos = [];
        renderIsolatedBulkPhotoPreview();
        // Re-enable process button when clearing
        if (processBtn) {
          processBtn.disabled = false;
          processBtn.textContent = 'Process & Upload';
        }
      });
    }
    
    if (processBtn) {
      processBtn.addEventListener('click', () => {
        console.log('🚀 Process button clicked');
        processIsolatedBulkUpload();
      });
    }
    
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        setActiveScreen(screens.isolatedBulkUploadSettings);
      });
    }
    
    isolatedBulkUploadScreenSetup = true;
  }
  
  // Always reset process button state when screen is shown (in case user navigates back)
  if (processBtn) {
    processBtn.disabled = false;
    processBtn.textContent = 'Process & Upload';
  }
  
  // Always render current photos
  renderIsolatedBulkPhotoPreview();
  
  console.log('✅ Isolated bulk upload screen setup complete');
}

// Handle photo selection
async function handleIsolatedBulkPhotoSelect(e) {
  console.log('📁 Photo selection event fired');
  const files = Array.from(e.target.files || []);
  console.log(`📸 Files selected: ${files.length}`);
  
  if (files.length === 0) {
    console.warn('⚠️ No files selected');
    return;
  }
  
  // Show loading state
  const previewArea = document.getElementById('isolatedBulkPreviewArea');
  const photoGrid = document.getElementById('isolatedBulkPhotoGrid');
  if (photoGrid) {
    photoGrid.innerHTML = '<div class="loading">Loading photos...</div>';
  }
  if (previewArea) {
    previewArea.classList.remove('hidden');
  }
  
  // Convert files to data URLs and check for EXIF GPS
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`📷 Processing file ${i + 1}/${files.length}: ${file.name || 'unnamed'} (${(file.size / 1024).toFixed(2)}KB)`);
    
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      // Check for EXIF GPS data early to show status in preview
      let hasExifGPS = null;
      try {
        const exifGPS = await extractGPSFromPhoto(file);
        hasExifGPS = exifGPS !== null;
        if (hasExifGPS) {
          console.log(`📍 File ${i + 1} has EXIF GPS data`);
        } else {
          console.log(`📍 File ${i + 1} has no EXIF GPS data (will use fallback location)`);
        }
      } catch (exifError) {
        console.warn(`⚠️ Could not check EXIF for file ${i + 1}:`, exifError);
        hasExifGPS = false;
      }
      
      isolatedBulkUploadPhotos.push({
        file,
        dataUrl,
        processed: false,
        houseNumber: null,
        address: null,
        error: null,
        hasExifGPS: hasExifGPS
      });
      
      console.log(`✅ File ${i + 1} loaded successfully`);
    } catch (error) {
      console.error(`❌ Error loading file ${i + 1}:`, error);
      isolatedBulkUploadPhotos.push({
        file,
        dataUrl: null,
        processed: false,
        houseNumber: null,
        address: null,
        error: `Failed to load: ${error.message}`,
        hasExifGPS: false
      });
    }
  }
  
  console.log(`✅ Total photos loaded: ${isolatedBulkUploadPhotos.length}`);
  renderIsolatedBulkPhotoPreview();
  
  // Clear input to allow selecting same files again
  e.target.value = '';
}

// Render photo preview grid
function renderIsolatedBulkPhotoPreview() {
  const previewArea = document.getElementById('isolatedBulkPreviewArea');
  const photoGrid = document.getElementById('isolatedBulkPhotoGrid');
  const photoCount = document.getElementById('isolatedBulkPhotoCount');
  
  if (!previewArea || !photoGrid) return;
  
  if (isolatedBulkUploadPhotos.length === 0) {
    previewArea.classList.add('hidden');
    return;
  }
  
  previewArea.classList.remove('hidden');
  if (photoCount) {
    photoCount.textContent = `${isolatedBulkUploadPhotos.length} photo${isolatedBulkUploadPhotos.length !== 1 ? 's' : ''}`;
  }
  
  photoGrid.innerHTML = isolatedBulkUploadPhotos.map((photo, index) => `
    <div class="bulk-upload-photo-item">
      <img src="${photo.dataUrl || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E'}" alt="Photo ${index + 1}">
      <div class="photo-item-info">
        ${photo.error ? 
          `<span class="error" style="color: #ff6b6b;">❌ Error: ${photo.error}</span>` :
          photo.houseNumber ? 
            `<span class="house-number">House: ${photo.houseNumber}</span>` : 
            '<span class="processing">Processing...</span>'
        }
        ${photo.hasExifGPS !== null && !photo.error ? 
          (photo.hasExifGPS ? 
            '<span class="exif-status" style="color: #4be0a8; font-size: 0.85em; display: block; margin-top: 4px;">📍 Has GPS</span>' :
            '<span class="exif-status" style="color: #ffa726; font-size: 0.85em; display: block; margin-top: 4px;">⚠️ No GPS (using fallback)</span>'
          ) : ''
        }
      </div>
    </div>
  `).join('');
}

// Process isolated bulk upload
async function processIsolatedBulkUpload() {
  if (isolatedBulkUploadPhotos.length === 0) {
    alert('Please select photos first');
    return;
  }
  
  if (!isolatedBulkUploadSettings) {
    alert('Settings not found. Please go back and configure settings.');
    return;
  }
  
  const processBtn = document.getElementById('isolatedBulkProcessBtn');
  if (processBtn) {
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
  }
  
  try {
    let processedCount = 0;
    let entriesCreated = 0;
    
    if (isolatedBulkUploadSettings.type === 'Residential') {
      // Residential: Extract house numbers and combine with street
      const failedPhotos = [];
      
      for (let i = 0; i < isolatedBulkUploadPhotos.length; i++) {
        const photo = isolatedBulkUploadPhotos[i];
        try {
          // Extract house number using AI
          const houseNumber = await extractHouseNumberFromPhoto(photo.dataUrl);
          photo.houseNumber = houseNumber;
          photo.processed = true;
          processedCount++;
          
          // Create entry only if house number was successfully extracted
          if (houseNumber) {
            const address = `${houseNumber} ${isolatedBulkUploadSettings.street}`;
            await createIsolatedBulkEntry(photo, address, houseNumber);
            entriesCreated++;
          } else {
            console.warn(`⚠️ Photo ${i + 1}: No house number found`);
            failedPhotos.push(`Photo ${i + 1} (no house number)`);
          }
        } catch (error) {
          console.error(`❌ Photo ${i + 1} failed:`, error);
          photo.processed = true; // Mark as processed (attempted) but failed
          photo.error = error.message;
          failedPhotos.push(`Photo ${i + 1} (${error.message})`);
          processedCount++; // Count as processed even if failed
        }
      }
      
      // Show warning if any photos failed
      if (failedPhotos.length > 0) {
        console.warn(`⚠️ ${failedPhotos.length} photo(s) failed:`, failedPhotos);
      }
    } else {
      // Commercial: Process like existing batch upload (AI extraction)
      // Get fallback location (current location) in case photos don't have EXIF GPS
      let fallbackLocation = currentLocation;
      if (!fallbackLocation.lat || !fallbackLocation.lng) {
        fallbackLocation = await getCurrentLocation();
        if (!fallbackLocation.lat || !fallbackLocation.lng) {
          fallbackLocation = { lat: '', lng: '' };
        }
      }
      
      const failedPhotos = [];
      
      for (let i = 0; i < isolatedBulkUploadPhotos.length; i++) {
        const photo = isolatedBulkUploadPhotos[i];
        try {
          // Extract GPS from photo EXIF if available
          let photoGPS = null;
          if (photo.file) {
            photoGPS = await extractGPSFromPhoto(photo.file);
            if (photoGPS) {
              console.log(`📍 Photo ${i + 1}: Using EXIF GPS (${photoGPS.lat}, ${photoGPS.lng})`);
            } else {
              console.log(`📍 Photo ${i + 1}: No EXIF GPS, using fallback location`);
            }
          } else {
            console.log(`📍 Photo ${i + 1}: No file object available, using fallback location`);
          }
          
          const photoLocation = photoGPS || fallbackLocation;
          
          // Process photo with AI (similar to processBatchImageFile)
          const scanData = await processCommercialBulkPhoto(photo, i + 1, isolatedBulkUploadPhotos.length, photoLocation);
          if (scanData) {
            photo.processed = true;
            processedCount++;
            entriesCreated++;
          } else {
            console.warn(`⚠️ Photo ${i + 1}: No scan data returned`);
            photo.processed = true;
            photo.error = 'No scan data returned';
            failedPhotos.push(`Photo ${i + 1} (no data)`);
            processedCount++;
          }
        } catch (error) {
          console.error(`❌ Error processing commercial photo ${i + 1}:`, error);
          photo.processed = true;
          photo.error = error.message;
          failedPhotos.push(`Photo ${i + 1} (${error.message})`);
          processedCount++;
        }
      }
      
      // Show warning if any photos failed
      if (failedPhotos.length > 0) {
        console.warn(`⚠️ ${failedPhotos.length} photo(s) failed:`, failedPhotos);
      }
    }
    
    // Save session
    const session = {
      id: 'bulk-' + Date.now(),
      settings: isolatedBulkUploadSettings,
      photoCount: isolatedBulkUploadPhotos.length,
      entriesCreated,
      timestamp: Date.now()
    };
    
    isolatedBulkUploadSessions = loadIsolatedBulkUploadSessions();
    isolatedBulkUploadSessions.push(session);
    saveIsolatedBulkUploadSessions();
    
    // Show success screen with proper messaging
    const successCountEl = document.getElementById('isolatedBulkSuccessCount');
    const successEntriesEl = document.getElementById('isolatedBulkSuccessEntries');
    const successTitleEl = document.querySelector('#isolatedBulkUploadSuccessScreen h3');
    const successIconEl = document.querySelector('#isolatedBulkUploadSuccessScreen .success-icon');
    
    if (successCountEl) successCountEl.textContent = processedCount;
    if (successEntriesEl) successEntriesEl.textContent = entriesCreated;
    
    // Update title and icon based on results
    if (entriesCreated === 0) {
      // All failed - show error state
      if (successTitleEl) successTitleEl.textContent = '⚠️ Upload Failed';
      if (successIconEl) successIconEl.textContent = '❌';
      if (successTitleEl) successTitleEl.style.color = '#ff6b6b';
      
      // Show alert with details
      alert(`⚠️ No entries were created. All ${processedCount} photo(s) failed to process.\n\nThis is usually due to:\n- OpenAI API errors (check console for details)\n- Invalid image format\n- Network issues\n\nPlease check the browser console for detailed error messages.`);
    } else if (entriesCreated < processedCount) {
      // Partial success - show warning
      if (successTitleEl) successTitleEl.textContent = '⚠️ Partial Success';
      if (successIconEl) successIconEl.textContent = '⚠️';
      if (successTitleEl) successTitleEl.style.color = '#ffa500';
      
      const failedCount = processedCount - entriesCreated;
      alert(`⚠️ Only ${entriesCreated} of ${processedCount} photo(s) were successfully processed.\n\n${failedCount} photo(s) failed. Please check the browser console for details.`);
    } else {
      // Full success
      if (successTitleEl) successTitleEl.textContent = 'Bulk Upload Successful!';
      if (successIconEl) successIconEl.textContent = '✅';
      if (successTitleEl) successTitleEl.style.color = '';
    }
    
    setActiveScreen(screens.isolatedBulkUploadSuccess);
    setupIsolatedBulkUploadSuccessScreen();
    
    // Update preview to show errors
    renderIsolatedBulkPhotoPreview();
    
    // Re-enable process button in case user navigates back
    if (processBtn) {
      processBtn.disabled = false;
      processBtn.textContent = 'Process & Upload';
    }
    
  } catch (error) {
    console.error('Error processing bulk upload:', error);
    alert('Error processing photos: ' + error.message);
  } finally {
    if (processBtn) {
      processBtn.disabled = false;
      processBtn.textContent = 'Process & Upload';
    }
  }
}

// Extract house number from photo using AI
async function extractHouseNumberFromPhoto(imageDataUrl) {
  try {
    // Use callOpenAIProxy to ensure correct endpoint and error handling
    if (!hasOpenAIProxy()) {
      throw new Error('OpenAI proxy is not configured');
    }
    
    const payload = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a house number extractor. Extract ONLY the house/building number from the image. Return ONLY the number (e.g., "5", "12", "35A"). If no number is found, return "NOT_FOUND".'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is the house or building number in this image? Return ONLY the number.' },
            { type: 'image_url', image_url: { url: imageDataUrl } }
          ]
        }
      ],
      max_tokens: 50
    };
    
    console.log('🔍 Calling OpenAI to extract house number...');
    const data = await callOpenAIProxy('/v1/chat/completions', payload);
    
    // Check if response has expected structure
    if (!data || !data.choices || !data.choices[0]) {
      console.warn('⚠️ Unexpected API response structure:', data);
      return null;
    }
    
    const extracted = data.choices[0]?.message?.content?.trim();
    console.log(`📝 Extracted text: "${extracted}"`);
    
    if (!extracted || extracted === 'NOT_FOUND') {
      return null;
    }
    
    // Clean up the extracted number (remove any extra text)
    const numberMatch = extracted.match(/\d+[A-Za-z]?/);
    const houseNumber = numberMatch ? numberMatch[0] : null;
    console.log(`🏠 Extracted house number: ${houseNumber || 'null'}`);
    return houseNumber;
  } catch (error) {
    console.error('❌ Error extracting house number:', error);
    // Re-throw the error so calling code knows it failed
    throw error;
  }
}

// Process commercial bulk photo (similar to processBatchImageFile)
async function processCommercialBulkPhoto(photo, currentIndex, total, batchLocation) {
  try {
    // Convert dataUrl to canvas
    const img = await loadImage(photo.dataUrl, `photo_${currentIndex}`);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    // Use buildScanInfo to extract store information (same as batch upload)
    const analysis = await buildScanInfo(canvas, { 
      statusElement: null, 
      showOverlay: false,
      fixedLocation: batchLocation 
    });
    
    if (!analysis || !analysis.info) {
      throw new Error('Failed to analyze photo');
    }
    
    const baseInfo = analysis.info;
    const entryId = baseInfo.entryId || `bulk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const scanData = {
      entryId,
      projectId: '',
      projectName: 'Isolated Bulk Upload',
      projectLocation: isolatedBulkUploadSettings.tabName,
      projectDate: isolatedBulkUploadSettings.date,
      projectEmail: isolatedBulkUploadSettings.email,
      environment: isolatedBulkUploadSettings.environment,
      category: isolatedBulkUploadSettings.type,
      storeName: baseInfo.storeName || 'Store',
      lat: baseInfo.lat || batchLocation.lat || '',
      lng: baseInfo.lng || batchLocation.lng || '',
      houseNo: baseInfo.houseNo || '',
      street: baseInfo.street || '',
      unit: baseInfo.unitNumber || '',
      floor: baseInfo.floor || '',
      building: baseInfo.building || '',
      postcode: baseInfo.postcode || '',
      remarks: baseInfo.remarks || '',
      photoData: photo.dataUrl,
      photoId: baseInfo.photoId,
      photoFilename: baseInfo.photoFilename,
      syncStatus: 'pending',
      isIsolatedBulkUpload: true,
      bulkUploadSessionId: isolatedBulkUploadSessions[isolatedBulkUploadSessions.length - 1]?.id || 'bulk-' + Date.now()
    };
    
    // Save full-resolution blob if available
    if (analysis?.fullResBlob && scanData.photoId) {
      savePhotoBlob(scanData.photoId, analysis.fullResBlob, scanData.photoFilename);
    }
    
    // Save to scans
    scans.push(scanData);
    saveScans();
    
    // Sync to Google Sheets
    await syncToGoogleSheets(scanData, isolatedBulkUploadSettings.tabName);
    
    return scanData;
  } catch (error) {
    console.error('Error processing commercial bulk photo:', error);
    throw error;
  }
}

// Create entry for isolated bulk upload (Residential)
async function createIsolatedBulkEntry(photo, address, houseNumber) {
  // Generate unique entryId with timestamp + random to avoid duplicates
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  const entryId = `bulk-${timestamp}-${random}`;
  
  // Generate photoId and photoFilename matching entryId
  const photoId = `photo_${new Date(timestamp).toISOString().replace(/[:.]/g, '-').slice(0, -5)}_${random}`;
  const photoFilename = `${entryId}.jpg`;
  
  // Convert dataUrl to blob and save to IndexedDB
  let photoBlob = null;
  try {
    const response = await fetch(photo.dataUrl);
    photoBlob = await response.blob();
    await savePhotoBlob(photoId, photoBlob, photoFilename);
    console.log(`✅ Photo saved to IndexedDB: ${photoId} (${photoFilename})`);
  } catch (error) {
    console.error('❌ Error saving photo blob:', error);
    // Continue even if blob save fails
  }
  
  // Create thumbnail for display
  let thumbnailDataUrl = null;
  try {
    const img = await loadImage(photo.dataUrl, `photo_${entryId}`);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    thumbnailDataUrl = createThumbnailDataURL(canvas, 400, 400, 0.6);
    await saveThumbnail(photoId, thumbnailDataUrl);
    console.log(`✅ Thumbnail saved: ${photoId}`);
  } catch (error) {
    console.error('❌ Error creating thumbnail:', error);
    // Use original dataUrl as fallback
    thumbnailDataUrl = photo.dataUrl;
  }
  
  const scanData = {
    entryId,
    projectId: '', // No project for isolated bulk upload
    projectName: 'Isolated Bulk Upload',
    projectLocation: isolatedBulkUploadSettings.tabName,
    projectDate: isolatedBulkUploadSettings.date,
    projectEmail: isolatedBulkUploadSettings.email,
    environment: isolatedBulkUploadSettings.environment,
    category: isolatedBulkUploadSettings.type,
    storeName: isolatedBulkUploadSettings.type === 'Residential' ? address : 'Store',
    lat: '',
    lng: '',
    houseNo: houseNumber || '',
    street: isolatedBulkUploadSettings.street || '',
    unit: '',
    floor: '',
    building: '',
    postcode: '',
    photoData: thumbnailDataUrl, // Store thumbnail in localStorage
    photoDataUrl: photo.dataUrl, // Keep original for sync
    photoId: photoId, // Unique photo ID matching entryId
    photoFilename: photoFilename, // Filename matching entryId
    timestamp: new Date(timestamp).toISOString(),
    syncStatus: 'pending',
    isIsolatedBulkUpload: true,
    bulkUploadSessionId: isolatedBulkUploadSessions[isolatedBulkUploadSessions.length - 1]?.id
  };
  
  // Save to scans
  scans.push(scanData);
  saveScans();
  console.log(`💾 Saved scan with entryId: ${entryId}, photoId: ${photoId}`);
  
  // Sync to Google Sheets
  await syncToGoogleSheets(scanData, isolatedBulkUploadSettings.tabName);
  
  return scanData;
}

// Setup success screen
function setupIsolatedBulkUploadSuccessScreen() {
  const viewDataBtn = document.getElementById('isolatedBulkViewDataBtn');
  const uploadMoreBtn = document.getElementById('isolatedBulkUploadMoreBtn');
  const backBtn = document.getElementById('isolatedBulkSuccessBackBtn');
  
  if (viewDataBtn) {
    viewDataBtn.addEventListener('click', () => {
      renderIsolatedBulkUploadData();
      setActiveScreen(screens.isolatedBulkUploadData);
    });
  }
  
  if (uploadMoreBtn) {
    uploadMoreBtn.addEventListener('click', () => {
      isolatedBulkUploadPhotos = [];
      setActiveScreen(screens.isolatedBulkUploadSettings);
      initializeIsolatedBulkUploadSettings();
    });
  }
  
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      setActiveScreen(screens.buildingSelection);
    });
  }
}

// Render isolated bulk upload data/history
function renderIsolatedBulkUploadData() {
  isolatedBulkUploadSessions = loadIsolatedBulkUploadSessions();
  const list = document.getElementById('isolatedBulkUploadList');
  const noData = document.getElementById('isolatedBulkNoData');
  
  if (!list) return;
  
  if (isolatedBulkUploadSessions.length === 0) {
    if (noData) noData.classList.remove('hidden');
    list.innerHTML = '';
    return;
  }
  
  if (noData) noData.classList.add('hidden');
  
  list.innerHTML = isolatedBulkUploadSessions.reverse().map(session => {
    const date = new Date(session.timestamp).toLocaleDateString();
    return `
      <div class="bulk-upload-session-card">
        <div class="session-header">
          <span class="session-tab">${session.settings.tabName}</span>
          <span class="session-date">${date}</span>
        </div>
        <div class="session-info">
          <div class="session-info-item">
            <span class="info-label">Type:</span>
            <span class="info-value">${session.settings.type}</span>
          </div>
          <div class="session-info-item">
            <span class="info-label">Photos:</span>
            <span class="info-value">${session.photoCount}</span>
          </div>
          <div class="session-info-item">
            <span class="info-label">Entries:</span>
            <span class="info-value">${session.entriesCreated}</span>
          </div>
        </div>
        <div class="session-actions">
          <button class="btn-small edit-settings-btn" data-session-id="${session.id}">Edit Settings</button>
          <button class="btn-small view-entries-btn" data-session-id="${session.id}">View Entries</button>
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  list.querySelectorAll('.edit-settings-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = btn.dataset.sessionId;
      editIsolatedBulkSession(sessionId);
    });
  });
  
  list.querySelectorAll('.view-entries-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = btn.dataset.sessionId;
      viewIsolatedBulkEntries(sessionId);
    });
  });
}

// Edit isolated bulk session settings
function editIsolatedBulkSession(sessionId) {
  const session = isolatedBulkUploadSessions.find(s => s.id === sessionId);
  if (!session) return;
  
  isolatedBulkUploadSettings = session.settings;
  
  // Populate form
  document.getElementById('isolatedBulkTabSelect').value = session.settings.tabName;
  document.getElementById('isolatedBulkEmail').value = session.settings.email;
  document.getElementById('isolatedBulkDate').value = session.settings.date;
  document.getElementById('isolatedBulkType').value = session.settings.type;
  document.getElementById('isolatedBulkEnvironment').value = session.settings.environment;
  if (session.settings.street) {
    document.getElementById('isolatedBulkStreet').value = session.settings.street;
  }
  
  setActiveScreen(screens.isolatedBulkUploadSettings);
}

// View entries from a session
function viewIsolatedBulkEntries(sessionId) {
  // Filter scans by session ID and show in data view
  const sessionScans = scans.filter(s => s.bulkUploadSessionId === sessionId);
  
  // Temporarily set as visible scans
  currentSearchFilter = sessionScans;
  renderTable();
  
  // Go to data view
  setActiveScreen(screens.visionApp);
  setVisionView('data');
}

// Setup isolated bulk upload data screen
function setupIsolatedBulkUploadDataScreen() {
  const backBtn = document.getElementById('isolatedBulkDataBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      setActiveScreen(screens.buildingSelection);
    });
  }
  
  renderIsolatedBulkUploadData();
}

if (appVersionLabel) {
  appVersionLabel.textContent = APP_VERSION;
}

if (versionHistoryBtn) {
  versionHistoryBtn.addEventListener('click', () => {
    setActiveScreen(screens.versionHistory);
  });
}

// Feedback functionality
const FEEDBACK_SHEET_ID = '1JfXUAp_RZTsZc5FCsZ0YBAev4xMG5Tbng8uzIJlp0pY';
const FEEDBACK_TAB_NAME = 'Feedback Board';

function setupFeedbackModal() {
  const feedbackModal = document.getElementById('feedbackModal');
  const feedbackForm = document.getElementById('feedbackForm');
  const feedbackCloseBtn = document.getElementById('feedbackCloseBtn');
  const feedbackCancelBtn = document.getElementById('feedbackCancelBtn');
  
  if (!feedbackModal || !feedbackForm) return;
  
  // Close modal handlers
  if (feedbackCloseBtn) {
    feedbackCloseBtn.addEventListener('click', () => {
      hideFeedbackModal();
    });
  }
  
  if (feedbackCancelBtn) {
    feedbackCancelBtn.addEventListener('click', () => {
      hideFeedbackModal();
    });
  }
  
  // Close on backdrop click
  feedbackModal.addEventListener('click', (e) => {
    if (e.target === feedbackModal) {
      hideFeedbackModal();
    }
  });
  
  // Form submission
  feedbackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitFeedback();
  });
}

function showFeedbackModal() {
  const feedbackModal = document.getElementById('feedbackModal');
  const feedbackForm = document.getElementById('feedbackForm');
  
  if (!feedbackModal || !feedbackForm) return;
  
  // Reset form
  feedbackForm.reset();
  
  // Show modal
  feedbackModal.classList.remove('hidden');
  
  // Focus first field
  const firstField = feedbackForm.querySelector('select, textarea');
  if (firstField) {
    setTimeout(() => firstField.focus(), 100);
  }
}

function hideFeedbackModal() {
  const feedbackModal = document.getElementById('feedbackModal');
  if (feedbackModal) {
    feedbackModal.classList.add('hidden');
  }
}

async function submitFeedback() {
  const feedbackType = document.getElementById('feedbackType')?.value;
  const feedbackDevice = document.getElementById('feedbackDevice')?.value;
  const feedbackContact = document.getElementById('feedbackContact')?.value?.trim() || '';
  const feedbackText = document.getElementById('feedbackText')?.value;
  
  if (!feedbackType || !feedbackDevice || !feedbackText) {
    alert('Please fill in all required fields');
    return;
  }
  
  const submitBtn = document.querySelector('#feedbackForm button[type="submit"]');
  const originalText = submitBtn?.textContent;
  
  try {
    // Disable submit button
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }
    
    // Submit to Google Sheets
    const response = await fetch(SHEETS_SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sheetId: FEEDBACK_SHEET_ID,
        tabName: FEEDBACK_TAB_NAME,
        feedback: {
          type: feedbackType,
          device: feedbackDevice,
          contact: feedbackContact,
          text: feedbackText
        }
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Show success message
      showFeedbackSuccess();
    } else {
      throw new Error(result.error || 'Failed to submit feedback');
    }
  } catch (error) {
    console.error('Error submitting feedback:', error);
    alert(`Failed to submit feedback: ${error.message}\n\nPlease try again later.`);
    
    // Re-enable submit button
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

function showFeedbackSuccess() {
  const feedbackModal = document.getElementById('feedbackModal');
  const feedbackForm = document.getElementById('feedbackForm');
  
  if (!feedbackModal) return;
  
  // Hide form, show success message
  if (feedbackForm) {
    feedbackForm.style.display = 'none';
  }
  
  const successHTML = `
    <div style="padding: 40px 20px; text-align: center;">
      <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
      <h2 style="margin: 0 0 16px 0; color: var(--primary);">Thank You!</h2>
      <p style="margin: 0 0 32px 0; color: var(--text-secondary); line-height: 1.6;">
        Your feedback has been submitted successfully.<br>
        We appreciate your input!
      </p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="feedbackAddAnotherBtn" class="btn btn-secondary" style="flex: 1; max-width: 200px;">
          Add Another
        </button>
        <button id="feedbackCloseSuccessBtn" class="btn btn-primary" style="flex: 1; max-width: 200px;">
          Close
        </button>
      </div>
    </div>
  `;
  
  const modalContent = feedbackModal.querySelector('.feedback-modal');
  if (modalContent) {
    const existingSuccess = modalContent.querySelector('.feedback-success');
    if (existingSuccess) {
      existingSuccess.remove();
    }
    
    const successDiv = document.createElement('div');
    successDiv.className = 'feedback-success';
    successDiv.innerHTML = successHTML;
    modalContent.appendChild(successDiv);
    
    // Setup success button handlers
    const addAnotherBtn = document.getElementById('feedbackAddAnotherBtn');
    const closeSuccessBtn = document.getElementById('feedbackCloseSuccessBtn');
    
    if (addAnotherBtn) {
      addAnotherBtn.addEventListener('click', () => {
        // Remove success message
        successDiv.remove();
        // Show form again
        if (feedbackForm) {
          feedbackForm.style.display = 'block';
          feedbackForm.reset();
          // Focus first field
          const firstField = feedbackForm.querySelector('select, textarea');
          if (firstField) {
            setTimeout(() => firstField.focus(), 100);
          }
        }
      });
    }
    
    if (closeSuccessBtn) {
      closeSuccessBtn.addEventListener('click', () => {
        hideFeedbackModal();
        // Reset modal for next time
        setTimeout(() => {
          successDiv.remove();
          if (feedbackForm) {
            feedbackForm.style.display = 'block';
          }
        }, 300);
      });
    }
  }
}