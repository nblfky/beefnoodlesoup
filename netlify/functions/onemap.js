/**
 * Netlify Function: OneMap API Proxy
 * Handles OneMap API calls with automatic token refresh
 * Also handles data.gov.sg API calls for Silver Zones and School Zones
 * 
 * Environment variables required:
 * - ONEMAP_EMAIL: Your OneMap account email
 * - ONEMAP_PASSWORD: Your OneMap account password
 * - DATAGOVSG_API_KEY: Your data.gov.sg API key (for Silver/School Zones)
 */

const ONEMAP_API_BASE = 'https://www.onemap.gov.sg/api';

// In-memory token cache (persists across warm function invocations)
let cachedToken = null;
let tokenExpiry = null;

export async function handler(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
    };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    // Parse request
    let action, params;
    
    if (event.httpMethod === 'GET') {
      params = event.queryStringParameters || {};
      action = params.action;
    } else {
      const body = JSON.parse(event.body || '{}');
      action = body.action;
      params = body;
    }

    if (!action) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Missing action parameter' }),
      };
    }

    // Handle different actions
    switch (action) {
      case 'search':
        return await handleSearch(params);
      
      case 'reverseGeocode':
        return await handleReverseGeocode(params);
      
      case 'getBuildings':
        return await handleGetBuildings(params);
      
      case 'getSilverZones':
        return await handleGetSilverZones(params);
      
      case 'getSchoolZones':
        return await handleGetSchoolZones(params);
      
      case 'checkToken':
        // Just verify token is available (for debugging)
        const token = await getValidToken();
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({ 
            success: !!token,
            hasToken: !!token,
            tokenExpiry: tokenExpiry ? new Date(tokenExpiry).toISOString() : null
          }),
        };
      
      case 'test':
        // Test endpoint to verify function is working
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({ 
            success: true,
            message: 'OneMap proxy function is working',
            availableActions: ['search', 'reverseGeocode', 'getBuildings', 'getSilverZones', 'getSchoolZones', 'checkToken'],
            hasDataGovApiKey: !!process.env.DATAGOVSG_API_KEY,
            hasOneMapCredentials: !!(process.env.ONEMAP_EMAIL && process.env.ONEMAP_PASSWORD)
          }),
        };
      
      default:
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: `Unknown action: ${action}` }),
        };
    }
  } catch (error) {
    console.error('OneMap function error:', error);
    console.error('Error stack:', error.stack);
    console.error('Action attempted:', action);
    console.error('Request method:', event.httpMethod);
    console.error('Request body:', event.body);
    
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ 
        error: error.message,
        action: action || 'unknown',
        message: 'An error occurred processing the request. Check function logs for details.'
      }),
    };
  }
}

/**
 * Get a valid OneMap token, refreshing if necessary
 */
async function getValidToken() {
  // Check if we have a valid cached token
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 3600000) {
    console.log('Using cached OneMap token');
    return cachedToken;
  }

  // Need to get a new token
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;

  if (!email || !password) {
    console.error('OneMap credentials not configured');
    return null;
  }

  try {
    console.log('Refreshing OneMap token...');
    
    const response = await fetch(`${ONEMAP_API_BASE}/auth/post/getToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (data.access_token) {
      cachedToken = data.access_token;
      // Token is valid for 3 days, but we'll refresh 1 hour early
      tokenExpiry = Date.now() + (3 * 24 * 60 * 60 * 1000);
      console.log('OneMap token refreshed successfully');
      return cachedToken;
    } else {
      console.error('Failed to get OneMap token:', data);
      return null;
    }
  } catch (error) {
    console.error('Error refreshing OneMap token:', error);
    return null;
  }
}

/**
 * Handle search requests (no auth required for basic search)
 */
async function handleSearch(params) {
  const { searchVal, returnGeom = 'Y', getAddrDetails = 'Y', pageNum = '1' } = params;

  if (!searchVal) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Missing searchVal parameter' }),
    };
  }

  try {
    const queryParams = new URLSearchParams({
      searchVal,
      returnGeom,
      getAddrDetails,
      pageNum,
    });

    const response = await fetch(`${ONEMAP_API_BASE}/common/elastic/search?${queryParams}`);
    const data = await response.json();

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('OneMap search error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message }),
    };
  }
}

/**
 * Handle reverse geocode requests (requires auth)
 */
async function handleReverseGeocode(params) {
  const { lat, lng, buffer = 50 } = params;

  if (!lat || !lng) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Missing lat/lng parameters' }),
    };
  }

  const token = await getValidToken();
  if (!token) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'OneMap authentication failed. Check ONEMAP_EMAIL and ONEMAP_PASSWORD environment variables.' }),
    };
  }

  try {
    const response = await fetch(
      `${ONEMAP_API_BASE}/public/revgeocode?location=${lat},${lng}&buffer=${buffer}&addressType=All&otherFeatures=Y`,
      {
        headers: {
          'Authorization': token,
        },
      }
    );

    const data = await response.json();

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('OneMap reverse geocode error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message }),
    };
  }
}

/**
 * Handle get buildings requests (requires auth)
 */
async function handleGetBuildings(params) {
  const { extents } = params;

  if (!extents) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Missing extents parameter (bounding box)' }),
    };
  }

  const token = await getValidToken();
  if (!token) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'OneMap authentication failed' }),
    };
  }

  try {
    const response = await fetch(
      `${ONEMAP_API_BASE}/public/themesvc/retrieveTheme?queryName=buildings&extents=${extents}`,
      {
        headers: {
          'Authorization': token,
        },
      }
    );

    const data = await response.json();

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('OneMap buildings error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message }),
    };
  }
}

/**
 * Handle get Silver Zones requests (from data.gov.sg)
 */
async function handleGetSilverZones(params) {
  const apiKey = process.env.DATAGOVSG_API_KEY;
  
  try {
    // Try data.gov.sg Collection API - Collection ID 330 for Silver Zones
    const headers = {
      'Accept': 'application/json',
    };
    
    // Add API key to headers if available
    // data.gov.sg uses lowercase 'x-api-key' header
    // API key format: "v2:xxxxx..." - use as-is
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }
    
    const metadataResponse = await fetch('https://api-production.data.gov.sg/v2/public/api/collections/330/metadata', {
      headers: headers,
    });
    
    if (metadataResponse.ok) {
      const metadata = await metadataResponse.json();
      
      // Check different possible structures for download URLs
      let geojsonUrl = null;
      
      // Try metadata.data.downloads array
      if (metadata.data && metadata.data.downloads && Array.isArray(metadata.data.downloads)) {
        const geojsonDownload = metadata.data.downloads.find(d => 
          d.format && d.format.toLowerCase() === 'geojson'
        );
        if (geojsonDownload && geojsonDownload.url) {
          geojsonUrl = geojsonDownload.url;
        }
      }
      
      // Try metadata.downloads array (alternative structure)
      if (!geojsonUrl && metadata.downloads && Array.isArray(metadata.downloads)) {
        const geojsonDownload = metadata.downloads.find(d => 
          d.format && d.format.toLowerCase() === 'geojson'
        );
        if (geojsonDownload && geojsonDownload.url) {
          geojsonUrl = geojsonDownload.url;
        }
      }
      
      // Try direct download link from metadata
      if (!geojsonUrl && metadata.data && metadata.data.downloadUrl) {
        geojsonUrl = metadata.data.downloadUrl;
      }
      
      if (geojsonUrl) {
        const geojsonResponse = await fetch(geojsonUrl, {
          headers: {
            'Accept': 'application/json',
          },
        });
        
        if (geojsonResponse.ok) {
          const geojson = await geojsonResponse.json();
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify(geojson),
          };
        } else {
          console.warn(`Failed to fetch GeoJSON from ${geojsonUrl}: ${geojsonResponse.status}`);
        }
      } else {
        console.warn('No GeoJSON download URL found in metadata:', JSON.stringify(metadata).substring(0, 500));
      }
    } else {
      console.warn(`Metadata API returned ${metadataResponse.status}: ${metadataResponse.statusText}`);
      if (metadataResponse.status === 401 || metadataResponse.status === 403) {
        return {
          statusCode: 401,
          headers: corsHeaders(),
          body: JSON.stringify({ 
            error: 'Authentication failed',
            message: apiKey ? 'Invalid API key' : 'API key not configured. Please set DATAGOVSG_API_KEY environment variable.'
          }),
        };
      }
    }
    
    // If we reach here, data wasn't found
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ 
        error: 'Silver Zones data not available',
        message: apiKey ? 'Data not found. Please check data.gov.sg/collections/330' : 'API key required. Please set DATAGOVSG_API_KEY environment variable.'
      }),
    };
  } catch (error) {
    console.error('Silver Zones error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message }),
    };
  }
}

/**
 * Handle get School Zones requests (from data.gov.sg)
 */
async function handleGetSchoolZones(params) {
  const apiKey = process.env.DATAGOVSG_API_KEY;
  
  try {
    // Try data.gov.sg Collection API - Collection ID 329 for School Zones
    const headers = {
      'Accept': 'application/json',
    };
    
    // Add API key to headers if available
    // data.gov.sg uses lowercase 'x-api-key' header
    // API key format: "v2:xxxxx..." - use as-is
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }
    
    const metadataResponse = await fetch('https://api-production.data.gov.sg/v2/public/api/collections/329/metadata', {
      headers: headers,
    });
    
    if (metadataResponse.ok) {
      const metadata = await metadataResponse.json();
      
      // Check different possible structures for download URLs
      let geojsonUrl = null;
      
      // Try metadata.data.downloads array
      if (metadata.data && metadata.data.downloads && Array.isArray(metadata.data.downloads)) {
        const geojsonDownload = metadata.data.downloads.find(d => 
          d.format && d.format.toLowerCase() === 'geojson'
        );
        if (geojsonDownload && geojsonDownload.url) {
          geojsonUrl = geojsonDownload.url;
        }
      }
      
      // Try metadata.downloads array (alternative structure)
      if (!geojsonUrl && metadata.downloads && Array.isArray(metadata.downloads)) {
        const geojsonDownload = metadata.downloads.find(d => 
          d.format && d.format.toLowerCase() === 'geojson'
        );
        if (geojsonDownload && geojsonDownload.url) {
          geojsonUrl = geojsonDownload.url;
        }
      }
      
      // Try direct download link from metadata
      if (!geojsonUrl && metadata.data && metadata.data.downloadUrl) {
        geojsonUrl = metadata.data.downloadUrl;
      }
      
      if (geojsonUrl) {
        const geojsonHeaders = {
          'Accept': 'application/json',
        };
        
        // Add API key to headers if available
        // data.gov.sg uses lowercase 'x-api-key' header
        // API key format: "v2:xxxxx..." - use as-is
        if (apiKey) {
          geojsonHeaders['x-api-key'] = apiKey;
        }
        
        const geojsonResponse = await fetch(geojsonUrl, {
          headers: geojsonHeaders,
        });
        
        if (geojsonResponse.ok) {
          const geojson = await geojsonResponse.json();
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify(geojson),
          };
        } else {
          console.warn(`Failed to fetch GeoJSON from ${geojsonUrl}: ${geojsonResponse.status}`);
        }
      } else {
        console.warn('No GeoJSON download URL found in metadata:', JSON.stringify(metadata).substring(0, 500));
      }
    } else {
      console.warn(`Metadata API returned ${metadataResponse.status}: ${metadataResponse.statusText}`);
      if (metadataResponse.status === 401 || metadataResponse.status === 403) {
        return {
          statusCode: 401,
          headers: corsHeaders(),
          body: JSON.stringify({ 
            error: 'Authentication failed',
            message: apiKey ? 'Invalid API key' : 'API key not configured. Please set DATAGOVSG_API_KEY environment variable.'
          }),
        };
      }
    }
    
    // If we reach here, data wasn't found
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ 
        error: 'School Zones data not available',
        message: apiKey ? 'Data not found. Please check data.gov.sg/collections/329' : 'API key required. Please set DATAGOVSG_API_KEY environment variable.'
      }),
    };
  } catch (error) {
    console.error('School Zones error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message }),
    };
  }
}

/**
 * CORS headers
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
