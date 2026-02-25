/**
 * Netlify Function: Google Sheets Sync with Drive Image Upload
 * Syncs bnsVision scan data to Google Sheets and uploads images to Google Drive
 * Supports upsert: updates existing rows by entryId, or appends new rows
 */

import { GoogleAuth, JWT } from 'google-auth-library';
import { google } from 'googleapis';

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
    // Get environment variables
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const impersonateUser = process.env.GOOGLE_IMPERSONATE_USER; // For OAuth delegation
    
    // Log for debugging
    if (!driveFolderId) {
      console.warn('⚠️ GOOGLE_DRIVE_FOLDER_ID not configured. Image uploads will be skipped.');
      console.warn('   To enable Drive uploads, add GOOGLE_DRIVE_FOLDER_ID to Netlify environment variables.');
    } else {
      console.log('✅ Drive folder ID configured');
    }
    
    if (impersonateUser) {
      console.log(`✅ OAuth delegation enabled - impersonating user: ${impersonateUser}`);
    }
    
    // Handle private key
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;
    if (privateKey) {
      if (!privateKey.startsWith('-----')) {
        privateKey = Buffer.from(privateKey, 'base64').toString('utf-8');
      } else {
        privateKey = privateKey.split('\\n').join('\n');
      }
      privateKey = privateKey.trim();
    }

    if (!serviceAccountEmail || !privateKey || !sheetId) {
      const missing = [];
      if (!serviceAccountEmail) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
      if (!privateKey) missing.push('GOOGLE_PRIVATE_KEY');
      if (!sheetId) missing.push('GOOGLE_SHEET_ID');
      throw new Error(`Missing configuration: ${missing.join(', ')}`);
    }

    // Create auth client
    // If OAuth delegation is configured, use JWT with subject for impersonation
    let auth;
    if (impersonateUser) {
      console.log(`🔐 Using domain-wide delegation to impersonate: ${impersonateUser}`);
      // Use JWT client with subject for domain-wide delegation
      auth = new JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.file'
        ],
        subject: impersonateUser, // Impersonate this user
      });
    } else {
      // Standard service account auth
      auth = new GoogleAuth({
        credentials: {
          client_email: serviceAccountEmail,
          private_key: privateKey,
        },
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.file'
        ],
      });
    }

    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    // Handle GET requests (read from Sheets)
    if (event.httpMethod === 'GET') {
      return await handleGetRequest(event, sheets, sheetId);
    }

    // Handle POST requests (write to Sheets)
    const body = JSON.parse(event.body || '{}');
    
    // Determine which sheet to use (allow custom sheetId for feedback, etc.)
    let targetSheetId = sheetId; // Default to environment variable
    if (body.sheetId && typeof body.sheetId === 'string') {
      targetSheetId = body.sheetId;
      console.log(`📋 Using custom sheetId: ${targetSheetId.substring(0, 20)}...`);
    }
    
    // Determine which sheet tab to use
    const tabName = body.tabName || 'Sheet1';
    
    // Handle feedback submission (simple append, no upsert logic)
    if (body.feedback) {
      return await handleFeedbackSubmission(sheets, targetSheetId, tabName, body.feedback);
    }
    
    // Handle ELO match submission
    if (body.eloMatch) {
      return await handleELOMatchSubmission(sheets, targetSheetId, tabName, body);
    }
    
    // Handle tab creation request
    if (body.createTab && body.tabName) {
      return await handleCreateTab(sheets, targetSheetId, body.tabName);
    }
    
    // Check if this is a batch deletion request (check this first as it's more specific)
    if (body.deletions && Array.isArray(body.deletions) && body.deletions.length > 0) {
      const deletionResults = {
        marked: 0,
        notFound: 0,
        errors: []
      };
      
      for (const deletion of body.deletions) {
        try {
          const result = await markRecordAsDeleted(sheets, sheetId, tabName, deletion.entryId, deletion.deletedAt);
          if (result.found) {
            deletionResults.marked++;
          } else {
            deletionResults.notFound++;
          }
        } catch (err) {
          deletionResults.errors.push({ entryId: deletion.entryId, error: err.message });
        }
      }
      
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: true,
          message: `Processed ${body.deletions.length} deletion(s)`,
          details: deletionResults
        }),
      };
    }
    
    // Check if this is a single deletion request (must have deleted=true AND entryId, but NOT records/deletions arrays)
    if (body.deleted === true && body.entryId && !body.records && !body.deletions) {
      // Handle single deletion
      const deletionResult = await markRecordAsDeleted(sheets, sheetId, tabName, body.entryId, body.deletedAt);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: true,
          message: `Marked entry ${body.entryId} as deleted`,
          details: deletionResult
        }),
      };
    }
    
    // Get records to sync (regular sync, not deletion)
    let records = [];
    if (body.records && Array.isArray(body.records)) {
      records = body.records;
    } else {
      // Single record - make sure it's not a deletion request
      if (body.deleted !== true) {
        records = [body];
      } else {
        // This is a deletion request but missing entryId, return error
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({
            success: false,
            error: 'Deletion request missing entryId'
          }),
        };
      }
    }

    console.log('📥 Received records to sync:', {
      recordCount: records.length,
      firstRecordKeys: records[0] ? Object.keys(records[0]) : [],
      firstRecordHasImageData: records[0] ? !!records[0].imageData : false,
      firstRecordImageDataLength: records[0] && records[0].imageData ? records[0].imageData.length : 0,
      driveFolderId: driveFolderId ? 'configured' : 'missing'
    });

    // Process each record with upsert logic
    const results = {
      inserted: 0,
      updated: 0,
      imagesUploaded: 0,
      imageLinks: {}, // Map entryId -> imageLink
      errors: []
    };

    for (const record of records) {
      try {
        // Skip if this is a deletion marker
        if (record.deleted === true) {
          continue;
        }
        
        // Log image metadata (images are stored locally, not uploaded to Drive)
        console.log(`🔍 Processing record ${record.entryId}:`, {
          hasPhotoFilename: !!record.photoFilename,
          photoFilename: record.photoFilename || 'none',
          imageSize: record.imageSize || 0,
          hasImage: !!(record.photoFilename || record.imageSize)
        });
        
        // Note: Images are stored locally in IndexedDB on the device
        // Only metadata (filename, size) is synced to Google Sheets
        
        const upsertResult = await upsertRecord(sheets, targetSheetId, tabName, record);
        if (upsertResult.action === 'inserted') {
          results.inserted++;
        } else if (upsertResult.action === 'updated') {
          results.updated++;
        }
      } catch (err) {
        console.error(`❌ Error syncing record ${record.entryId}:`, err.message);
        results.errors.push({ entryId: record.entryId, error: err.message });
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        message: `Synced ${records.length} record(s) to Google Sheets`,
        details: results
      }),
    };

  } catch (err) {
    console.error('Sheets sync error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ 
        success: false,
        error: err.message 
      }),
    };
  }
}

/**
 * Upload image to Google Drive and return shareable link
 */
async function uploadImageToDrive(drive, folderId, record) {
  // Extract base64 data from data URL
  const imageData = record.imageData;
  if (!imageData) {
    throw new Error('No image data provided');
  }
  
  if (!imageData.startsWith('data:')) {
    throw new Error(`Invalid image data format. Expected data URL, got: ${imageData.substring(0, 50)}...`);
  }

  const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches || matches.length < 3) {
    throw new Error(`Could not parse image data URL. Format: ${imageData.substring(0, 50)}...`);
  }

  const mimeType = matches[1] || 'image/jpeg';
  const base64Data = matches[2];
  
  if (!base64Data || base64Data.length === 0) {
    throw new Error('Empty base64 data');
  }
  
  let buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch (err) {
    throw new Error(`Failed to decode base64: ${err.message}`);
  }
  
  if (buffer.length === 0) {
    throw new Error('Decoded buffer is empty');
  }

  // Create filename in format: Floor_Building_EntryID (e.g., L1_ION_ORCHARD_entry12345)
  // Use "Unknown" as default if floor/building not provided
  const floor = (record.floor || 'Unknown').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const building = (record.building || 'Unknown').replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 30).toUpperCase();
  const entryId = record.entryId || Date.now().toString();
  const extension = mimeType.includes('png') ? 'png' : 'jpg';
  const floorBuilding = [floor, building].filter(Boolean).join('_');
  const fileName = floorBuilding 
    ? `${floorBuilding}_${entryId}.${extension}`
    : `${entryId}.${extension}`;

  const media = {
    mimeType: mimeType,
    body: bufferToStream(buffer)
  };

  let uploadResponse;
  let fileId;
  
  // Try uploading directly to the folder first
  try {
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };
    
    uploadResponse = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
      supportsAllDrives: true,
      supportsTeamDrives: true
    });
    
    fileId = uploadResponse.data.id;
    console.log('✅ Successfully uploaded directly to folder');
  } catch (err) {
    // If direct upload fails due to storage quota, service account cannot upload
    if (err.message && err.message.includes('storage quota')) {
      console.error('❌ Service account storage quota error - cannot upload files');
      console.error('📋 IMPORTANT: Service accounts cannot upload to regular folders, even if shared.');
      console.error('📋 Solutions:');
      console.error('   1. Use a Shared Drive (requires Google Workspace account)');
      console.error('      - Create a Shared Drive in Google Drive');
      console.error('      - Add service account as member with "Content Manager" role');
      console.error('      - Use the Shared Drive folder ID in GOOGLE_DRIVE_FOLDER_ID');
      console.error('   2. Use OAuth delegation (more complex setup)');
      console.error('   See: https://developers.google.com/workspace/drive/api/guides/about-shareddrives');
      throw new Error(`Drive upload failed: Service accounts cannot upload files to regular folders. You need a Shared Drive (Google Workspace) or OAuth delegation. Current folder ID: ${folderId}`);
    } else {
      console.error('Drive API error:', err.message);
      console.error('Drive API error details:', err.response?.data || err);
      throw new Error(`Drive upload failed: ${err.message}`);
    }
  }

  if (!fileId) {
    throw new Error('No file ID returned from Drive');
  }

  // Make file publicly viewable (anyone with link)
  try {
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      },
      supportsAllDrives: true, // Required for shared drives
      supportsTeamDrives: true // Legacy support for team drives
    });
  } catch (permErr) {
    console.warn('Failed to set public permissions:', permErr.message);
    // Continue anyway - file is still uploaded
  }

  // Return the web view link
  const link = uploadResponse.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
  console.log('Successfully uploaded to Drive:', link);
  return link;
}

/**
 * Convert buffer to readable stream for upload
 */
function bufferToStream(buffer) {
  // Use Node.js built-in stream module
  const stream = require('stream');
  const readable = new stream.Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
}

/**
 * Upsert a record: find by entryId and update, or append if not found
 */
async function upsertRecord(sheets, sheetId, tabName, record) {
  const entryId = record.entryId;
  const row = formatRow(record);
  const range = `'${tabName}'!A:AF`; // Extended range to include Phone, Website, and Deleted columns
  
  // Ensure header row includes Opening Hours and Deleted columns
  await ensureOpeningHoursColumns(sheets, sheetId, tabName);
  await ensureDeletedColumns(sheets, sheetId, tabName);
  
  if (!entryId) {
    // No entryId, just append
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
    return { action: 'inserted' };
  }

  // Search for existing row with this entryId (Column B)
  const searchResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!B:B`
  });

  const values = searchResponse.data.values || [];
  let rowIndex = -1;
  
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === entryId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex > 0) {
    // Update existing row (including Opening Hours and Deleted columns)
    const updateRange = `'${tabName}'!A${rowIndex}:AE${rowIndex}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: updateRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
    return { action: 'updated', rowIndex };
  } else {
    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
    return { action: 'inserted' };
  }
}

/**
 * Mark a record as deleted in Google Sheets
 * Finds the row by entryId and sets the "Deleted" column (W) to "Yes" and adds deletion timestamp
 */
async function markRecordAsDeleted(sheets, sheetId, tabName, entryId, deletedAt) {
  if (!entryId) {
    return { found: false, error: 'No entryId provided' };
  }

  // Search for existing row with this entryId (Column B)
  const searchResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!B:B`
  });

  const values = searchResponse.data.values || [];
  let rowIndex = -1;
  
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === entryId) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex > 0) {
    // Ensure header row includes Opening Hours and Deleted columns
    await ensureOpeningHoursColumns(sheets, sheetId, tabName);
    await ensureDeletedColumns(sheets, sheetId, tabName);
    
    // Update the Deleted column (AD) and Deleted At column (AE)
    const deletedAtValue = deletedAt || new Date().toISOString();
    const updateRange = `'${tabName}'!AD${rowIndex}:AE${rowIndex}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: updateRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { 
        values: [['Yes', deletedAtValue]]
      }
    });
    
    return { found: true, rowIndex };
  } else {
    return { found: false, message: `Entry ${entryId} not found in sheet` };
  }
}

/**
 * Ensure Opening Hours columns exist in the header row
 */
async function ensureOpeningHoursColumns(sheets, sheetId, tabName) {
  try {
    // Get header row
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!1:1`
    });

    const headers = headerResponse.data.values?.[0] || [];
    
    // Check if opening hours columns exist (should be columns S-Y)
    const expectedHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const headerStartIndex = 18; // Column S (0-indexed: 18)
    
    let needsUpdate = false;
    const updatedHeaders = [...headers];
    
    // Ensure we have enough columns
    while (updatedHeaders.length < headerStartIndex + expectedHeaders.length) {
      updatedHeaders.push('');
      needsUpdate = true;
    }
    
    // Check and add opening hours headers if missing
    for (let i = 0; i < expectedHeaders.length; i++) {
      const colIndex = headerStartIndex + i;
      if (!updatedHeaders[colIndex] || updatedHeaders[colIndex].trim() === '') {
        updatedHeaders[colIndex] = expectedHeaders[i];
        needsUpdate = true;
      }
    }
    
    if (needsUpdate) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${tabName}'!1:1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updatedHeaders] }
      });
      console.log('✅ Opening Hours columns ensured in header row');
    }
  } catch (err) {
    console.warn('Could not ensure opening hours columns:', err.message);
  }
}

/**
 * Ensure Deleted columns exist in the header row
 */
async function ensureDeletedColumns(sheets, sheetId, tabName) {
  try {
    // Check if header row exists
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A1:AF1`
    });

    const headers = headerResponse.data.values?.[0] || [];
    
    // Add headers if they don't exist (Deleted columns are now AE and AF, which is indices 30 and 31)
    if (headers.length < 32 || headers[30] !== 'Deleted') {
      // Update header row to include Deleted columns
      const headerRange = `'${tabName}'!AE1:AF1`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: headerRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['Deleted', 'Deleted At']]
        }
      });
    }
  } catch (err) {
    console.warn('Could not ensure deleted columns:', err.message);
  }
}

/**
 * Format a scan record into a row array
 * Columns (31 total, A-AE):
 * A: Timestamp
 * B: EntryId (unique identifier for upsert)
 * C: ProjectId
 * D: ProjectName
 * E: Email
 * F: Date
 * G: Location
 * H: Environment (Indoor/Outdoor)
 * I: Category
 * J: POI Name
 * K: Lat
 * L: Lng
 * M: House_No
 * N: Street
 * O: Unit
 * P: Floor
 * Q: Building
 * R: Postcode
 * S: Mon (Opening Hours)
 * T: Tue (Opening Hours)
 * U: Wed (Opening Hours)
 * V: Thu (Opening Hours)
 * W: Fri (Opening Hours)
 * X: Sat (Opening Hours)
 * Y: Sun (Opening Hours)
 * Z: Remarks
 * AA: Image Filename (images stored locally in app)
 * AB: Image Size (bytes)
 * AC: Has Image (Yes/No)
 * AD: Deleted (Yes/No)
 * AE: Deleted At (ISO timestamp)
 */
/**
 * Get current time in Singapore timezone (GMT+8)
 */
function getSingaporeTime() {
  const now = new Date();
  // Convert to Singapore time (UTC+8)
  // Format: YYYY-MM-DDTHH:mm:ss.sss+08:00
  const singaporeOffset = 8 * 60; // Singapore is UTC+8 (8 hours * 60 minutes)
  const localOffset = now.getTimezoneOffset(); // Local timezone offset in minutes
  const singaporeTime = new Date(now.getTime() + (localOffset + singaporeOffset) * 60 * 1000);
  return singaporeTime.toISOString().replace('Z', '+08:00');
}

/**
 * Convert text to title case (capitalize first letter of each word)
 */
function toTitleCase(str) {
  if (!str || typeof str !== 'string') return str;
  return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

function formatRow(record) {
  const timestamp = getSingaporeTime();
  
  // Convert text fields to title case (not all caps)
  const titleCaseFields = {
    storeName: toTitleCase(record.storeName || record.poiName || ''),
    street: toTitleCase(record.street || ''),
    building: toTitleCase(record.building || ''),
    location: toTitleCase(record.location || ''),
    houseNo: toTitleCase(record.houseNo || ''),
    unit: toTitleCase(record.unit || ''),
    floor: toTitleCase(record.floor || ''),
    category: toTitleCase(record.category || ''),
    environment: toTitleCase(record.environment || 'Indoor'),
    projectName: toTitleCase(record.projectName || '')
  };
  
  return [
    timestamp,                                    // A: Timestamp
    record.entryId || '',                         // B: EntryId
    record.projectId || '',                       // C: Project ID
    titleCaseFields.projectName,                  // D: Project Name
    record.email || '',                           // E: Email
    record.date || '',                            // F: Date
    titleCaseFields.location,                     // G: Location
    titleCaseFields.environment,                  // H: Environment
    titleCaseFields.category,                     // I: Category
    titleCaseFields.storeName,                    // J: POI Name
    (record.lat && record.lng) ? `${record.lat}, ${record.lng}` : '',  // K: Lat-Long (merged)
    titleCaseFields.houseNo,                      // L: House_No
    titleCaseFields.street,                       // M: Street
    titleCaseFields.unit,                        // N: Unit
    titleCaseFields.floor,                       // O: Floor
    titleCaseFields.building,                    // P: Building
    record.postcode || '',                        // Q: Postcode
    record.openingHoursMon || '',                 // R: Mon
    record.openingHoursTue || '',                 // S: Tue
    record.openingHoursWed || '',                 // T: Wed
    record.openingHoursThu || '',                 // U: Thu
    record.openingHoursFri || '',                 // V: Fri
    record.openingHoursSat || '',                 // W: Sat
    record.openingHoursSun || '',                 // X: Sun
    record.phoneNumber || '',                     // Y: Phone Number
    record.website || '',                         // Z: Website
    record.remarks || '',                         // AA: Remarks
    record.photoFilename || '',                   // AB: Image Filename (images stored locally)
    record.imageSize || '',                       // AC: Image Size (bytes)
    (record.photoFilename || record.imageSize) ? 'Yes' : 'No',  // AD: Has Image
    record.deleted === true ? 'Yes' : 'No',      // AE: Deleted
    record.deletedAt || ''                        // AF: Deleted At
  ];
}

/**
 * Handle GET requests - Read data from Google Sheets
 */
async function handleGetRequest(event, sheets, sheetId) {
  try {
    // Parse query parameters
    const params = event.queryStringParameters || {};
    const tabName = params.tabName || 'Sheet1';
    const entryId = params.entryId; // Optional: filter by specific entryId
    const includeDeleted = params.includeDeleted === 'true'; // Default: exclude deleted entries
    
    // Allow custom sheetId in query params for feedback sheet, etc.
    let targetSheetId = sheetId;
    if (params.sheetId && typeof params.sheetId === 'string') {
      targetSheetId = params.sheetId;
    }
    
    // Get all data from the sheet tab
    // For ELO tracker tab, we need columns A-P (16 columns)
    // For other tabs, use A:AE (includes opening hours and deleted columns)
    const range = tabName === 'ELO_Tracker' ? `'${tabName}'!A:P` : `'${tabName}'!A:AE`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: targetSheetId,
      range: range,
    });

    const rows = response.data.values || [];
    
    if (rows.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: true,
          records: [],
          count: 0
        }),
      };
    }

    // First row is headers
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Map rows to objects
    const records = dataRows
      .map((row, index) => {
        const record = {};
        headers.forEach((header, colIndex) => {
          record[header] = row[colIndex] || '';
        });
        return record;
      })
      .filter(record => {
        // Filter by entryId if specified
        if (entryId && record['Entry ID'] !== entryId && record['EntryID'] !== entryId) {
          return false;
        }
        // Filter deleted entries unless includeDeleted is true
        if (!includeDeleted) {
          const deleted = record['Deleted'] || record['Deleted?'] || '';
          if (deleted === 'Yes' || deleted === 'TRUE' || deleted === true) {
            return false;
          }
        }
        return true;
      });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        records: records,
        count: records.length,
        tabName: tabName
      }),
    };
  } catch (error) {
    console.error('❌ Error reading from Google Sheets:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: error.message
      }),
    };
  }
}

/**
 * Handle tab creation request - Create a new tab in Google Sheets
 * If tab already exists, returns success (allows multiple users to sync to same tab)
 */
async function handleCreateTab(sheets, sheetId, tabName) {
  try {
    console.log(`📋 Creating new tab: ${tabName}`);
    
    // Try to create the tab
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: tabName
              }
            }
          }]
        }
      });
      console.log(`✅ Created tab: ${tabName}`);
      
      // Add headers to the new tab
      await ensureScanHeaders(sheets, sheetId, tabName);
      
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: true,
          message: `Created new tab: ${tabName}`,
          tabName: tabName,
          created: true
        }),
      };
    } catch (createError) {
      // Check if tab already exists (error code 400 with "already exists" message)
      if (createError.message && createError.message.includes('already exists')) {
        console.log(`✅ Tab already exists: ${tabName} (this is OK)`);
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            success: true,
            message: `Tab already exists: ${tabName}`,
            tabName: tabName,
            created: false,
            alreadyExists: true
          }),
        };
      }
      throw createError;
    }
  } catch (error) {
    console.error('❌ Tab creation error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: error.message
      }),
    };
  }
}

/**
 * Ensure scan data sheet has proper headers
 */
async function ensureScanHeaders(sheets, sheetId, tabName) {
  try {
    const headers = [
      'Timestamp',
      'EntryId',
      'ProjectId',
      'ProjectName',
      'Email',
      'Date',
      'Location',
      'Environment',
      'Category',
      'POI Name',
      'Lat-Long',
      'House_No',
      'Street',
      'Unit',
      'Floor',
      'Building',
      'Postcode',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
      'Phone',
      'Website',
      'Remarks',
      'Image Filename',
      'Image Size',
      'Has Image',
      'Deleted',
      'Deleted At'
    ];
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!1:1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers]
      }
    });
    console.log(`✅ Added headers to tab: ${tabName}`);
  } catch (error) {
    console.warn(`Could not add headers to tab ${tabName}:`, error.message);
  }
}

/**
 * Handle feedback submission - Simple append to feedback sheet
 */
async function handleFeedbackSubmission(sheets, sheetId, tabName, feedbackData) {
  try {
    // Ensure headers exist
    await ensureFeedbackHeaders(sheets, sheetId, tabName);
    
    // Format feedback row: Date, Feedback type, Device, Contact (Email/Slack ID), Feedback
    const row = [
      new Date().toISOString().split('T')[0], // Date (auto)
      feedbackData.type || '', // Feedback type
      feedbackData.device || '', // Device
      feedbackData.contact || '', // Email/Slack ID
      feedbackData.text || '' // Feedback text
    ];
    
    // Append to sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A:E`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
    
    console.log('✅ Feedback submitted successfully');
    
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        message: 'Feedback submitted successfully'
      }),
    };
  } catch (error) {
    console.error('❌ Feedback submission error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: error.message
      }),
    };
  }
}

/**
 * Ensure feedback sheet has headers
 */
async function ensureFeedbackHeaders(sheets, sheetId, tabName) {
  try {
    // Check if header row exists
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!1:1`
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    
    if (headers.length === 0 || headers.length < 5) {
      // Create headers if they don't exist
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${tabName}'!1:1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['Date', 'Feedback type', 'Device', 'Email/Slack ID', 'Feedback']]
        }
      });
      console.log('✅ Created feedback headers');
    }
  } catch (error) {
    console.error('Error ensuring feedback headers:', error);
    // Try to create tab if it doesn't exist
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: tabName
              }
            }
          }]
        }
      });
      // Add headers after creating tab
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${tabName}'!1:1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['Date', 'Feedback type', 'Device', 'Email/Slack ID', 'Feedback']]
        }
      });
    } catch (createError) {
      console.error('Failed to create feedback tab:', createError);
    }
  }
}

/**
 * Handle ELO match submission - Append match data to ELO tracker sheet
 */
async function handleELOMatchSubmission(sheets, sheetId, tabName, matchData) {
  try {
    console.log('📥 ELO match submission received:', {
      sheetId: sheetId ? sheetId.substring(0, 20) + '...' : 'missing',
      tabName,
      matchType: matchData.matchType,
      hasPlayer1: !!matchData.player1,
      hasPlayer2: !!matchData.player2,
      hasPlayer3: !!matchData.player3,
      hasPlayer4: !!matchData.player4,
      player1ELO: matchData.player1ELO,
      player2ELO: matchData.player2ELO,
      player3ELO: matchData.player3ELO,
      player4ELO: matchData.player4ELO
    });
    
    // Ensure headers exist
    await ensureELOHeaders(sheets, sheetId, tabName);
    
    // Format ELO match row
    const row = formatELOMatchRow(matchData);
    console.log('📋 Formatted row:', row);
    
    // Validate row has correct number of elements (16 columns: A-P)
    if (!Array.isArray(row) || row.length !== 16) {
      throw new Error(`Invalid row format: expected 16 columns, got ${row ? row.length : 'null'}`);
    }
    
    // Append to sheet
    // Format date/time as text strings to prevent Google Sheets auto-conversion
    const formattedRow = row.map((value, index) => {
      // Columns E (index 4) = Date, F (index 5) = Time
      if (index === 4 && value) {
        // Date column - prefix with apostrophe to force text format
        return value.toString().startsWith("'") ? value : `'${value}`;
      } else if (index === 5 && value) {
        // Time column - prefix with apostrophe to force text format  
        return value.toString().startsWith("'") ? value : `'${value}`;
      }
      return value;
    });
    
    console.log('📝 Formatted row for Sheets:', formattedRow);
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A:P`, // A-P covers all 16 columns (including change columns)
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [formattedRow] }
    });
    
    console.log('✅ ELO match submitted successfully');
    
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        message: 'ELO match recorded successfully'
      }),
    };
  } catch (error) {
    console.error('❌ ELO match submission error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
      matchData: {
        matchType: matchData?.matchType,
        hasPlayer1: !!matchData?.player1,
        hasPlayer2: !!matchData?.player2,
        hasPlayer3: !!matchData?.player3,
        hasPlayer4: !!matchData?.player4,
        hasChanges: {
          player1: matchData?.player1Change !== undefined,
          player2: matchData?.player2Change !== undefined,
          player3: matchData?.player3Change !== undefined,
          player4: matchData?.player4Change !== undefined
        }
      }
    });
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: error.response?.data || error.stack
      }),
    };
  }
}

/**
 * Format ELO match data into a row array
 * Columns: Player1 Name, Player2 Name, Player3 Name, Player4 Name, Date, Time, Match Type, Winning Team, Player1 ELO, Player2 ELO, Player3 ELO, Player4 ELO
 */
function formatELOMatchRow(matchData) {
  // Format date as YYYY-MM-DD string (ensure it's a string, not a number)
  const dateStr = matchData.date || '';
  // Format time as HH:MM:SS string (ensure it's a string, not a decimal)
  const timeStr = matchData.time || '';
  
  // Ensure ELO scores are numbers (not strings or empty)
  const formatELO = (elo) => {
    // Handle null, undefined, empty string
    if (elo === null || elo === undefined || elo === '') {
      return '';
    }
    // Convert to number
    const num = typeof elo === 'number' ? elo : parseFloat(elo);
    // Return empty string if NaN, otherwise return the number
    return isNaN(num) ? '' : num;
  };
  
  // Format ELO change (can be negative)
  const formatChange = (change) => {
    if (change === null || change === undefined || change === '') {
      return '';
    }
    const num = typeof change === 'number' ? change : parseFloat(change);
    return isNaN(num) ? '' : num;
  };
  
  if (matchData.matchType === '1v1') {
    // IMPORTANT: Columns always represent fixed players:
    // Column A = Nabil (index 0), Column B = Ikmal (index 1), Column C = Finn (index 2), Column D = Syazwan (index 3)
    // matchData.player1/player2/player3/player4 contain the actual player names based on their column positions
    // matchData.player1ELO/player2ELO/player3ELO/player4ELO contain the ELO scores for those columns
    return [
      matchData.player1 || '',           // Column A: Player1 Name (Nabil if he played, empty otherwise)
      matchData.player2 || '',           // Column B: Player2 Name (Ikmal if he played, empty otherwise)
      matchData.player3 || '',           // Column C: Player3 Name (Finn if he played, empty otherwise)
      matchData.player4 || '',           // Column D: Player4 Name (Syazwan if he played, empty otherwise)
      dateStr,                            // Column E: Date (as string)
      timeStr,                            // Column F: Time (as string)
      '1v1',                              // Column G: Match Type
      matchData.winner || '',            // Column H: Winning Team/Player
      formatELO(matchData.player1ELO),   // Column I: Player1 ELO (Nabil's ELO if he played)
      formatELO(matchData.player2ELO),   // Column J: Player2 ELO (Ikmal's ELO if he played)
      formatELO(matchData.player3ELO),   // Column K: Player3 ELO (Finn's ELO if he played)
      formatELO(matchData.player4ELO),   // Column L: Player4 ELO (Syazwan's ELO if he played)
      formatChange(matchData.player1Change), // Column M: Player1 Change
      formatChange(matchData.player2Change), // Column N: Player2 Change
      formatChange(matchData.player3Change), // Column O: Player3 Change
      formatChange(matchData.player4Change)  // Column P: Player4 Change
    ];
  } else {
    // 2v2 match
    // IMPORTANT: Column order must match exactly:
    // Column 1: Player1 Name (Team A, Player 1)
    // Column 2: Player2 Name (Team A, Player 2)
    // Column 3: Player3 Name (Team B, Player 1)
    // Column 4: Player4 Name (Team B, Player 2)
    // Column 9: Player1 ELO (for Player1 Name)
    // Column 10: Player2 ELO (for Player2 Name)
    // Column 11: Player3 ELO (for Player3 Name)
    // Column 12: Player4 ELO (for Player4 Name)
    // Column 13-16: Player1-4 Change
    return [
      matchData.player1 || '',           // Column 1: Player1 Name (Team A, Player 1)
      matchData.player2 || '',           // Column 2: Player2 Name (Team A, Player 2)
      matchData.player3 || '',           // Column 3: Player3 Name (Team B, Player 1)
      matchData.player4 || '',           // Column 4: Player4 Name (Team B, Player 2)
      dateStr,                            // Column 5: Date (as string)
      timeStr,                            // Column 6: Time (as string)
      '2v2',                              // Column 7: Match Type
      matchData.winningTeam || '',       // Column 8: Winning Team
      formatELO(matchData.player1ELO),    // Column 9: Player1 ELO (for player1)
      formatELO(matchData.player2ELO),    // Column 10: Player2 ELO (for player2)
      formatELO(matchData.player3ELO),    // Column 11: Player3 ELO (for player3)
      formatELO(matchData.player4ELO),    // Column 12: Player4 ELO (for player4)
      formatChange(matchData.player1Change), // Column M: Player1 Change
      formatChange(matchData.player2Change), // Column N: Player2 Change
      formatChange(matchData.player3Change), // Column O: Player3 Change
      formatChange(matchData.player4Change)  // Column P: Player4 Change
    ];
  }
}

/**
 * Ensure ELO tracker sheet has headers
 */
async function ensureELOHeaders(sheets, sheetId, tabName) {
  try {
    // Check if header row exists
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!1:1`
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    
    if (headers.length === 0 || headers.length < 16) {
      // Create headers if they don't exist or if change columns are missing
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `'${tabName}'!1:1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            'Player1 Name',
            'Player2 Name',
            'Player3 Name',
            'Player4 Name',
            'Date',
            'Time',
            'Match Type',
            'Winning Team',
            'Player1 ELO',
            'Player2 ELO',
            'Player3 ELO',
            'Player4 ELO',
            'Player1 Change',
            'Player2 Change',
            'Player3 Change',
            'Player4 Change'
          ]]
        }
      });
      console.log('✅ Created/Updated ELO tracker headers');
    } else {
      // Check if change columns exist, add them if missing
      const expectedHeaders = [
        'Player1 Name', 'Player2 Name', 'Player3 Name', 'Player4 Name',
        'Date', 'Time', 'Match Type', 'Winning Team',
        'Player1 ELO', 'Player2 ELO', 'Player3 ELO', 'Player4 ELO',
        'Player1 Change', 'Player2 Change', 'Player3 Change', 'Player4 Change'
      ];
      
      let needsUpdate = false;
      const updatedHeaders = [...headers];
      
      // Ensure we have at least 16 columns
      while (updatedHeaders.length < 16) {
        updatedHeaders.push('');
        needsUpdate = true;
      }
      
      // Check if change columns exist (columns M-P, indices 12-15)
      for (let i = 12; i < 16; i++) {
        if (!updatedHeaders[i] || updatedHeaders[i].trim() === '') {
          updatedHeaders[i] = expectedHeaders[i];
          needsUpdate = true;
        }
      }
      
      if (needsUpdate) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `'${tabName}'!1:1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [updatedHeaders]
          }
        });
        console.log('✅ Added ELO change columns to headers');
      } else {
        console.log('✅ ELO tracker headers already exist');
      }
    }
  } catch (error) {
    console.error('Error ensuring ELO headers:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      response: error.response?.data
    });
    
    // Check if error is due to tab not existing
    if (error.message && (error.message.includes('Unable to parse range') || error.message.includes('does not exist'))) {
      console.log('📋 Tab does not exist, attempting to create it...');
      // Try to create tab if it doesn't exist
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: tabName
                }
              }
            }]
          }
        });
        console.log(`✅ Created tab: ${tabName}`);
        
        // Add headers after creating tab
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `'${tabName}'!1:1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[
              'Player1 Name',
              'Player2 Name',
              'Player3 Name',
              'Player4 Name',
              'Date',
              'Time',
              'Match Type',
              'Winning Team',
              'Player1 ELO',
              'Player2 ELO',
              'Player3 ELO',
              'Player4 ELO',
              'Player1 Change',
              'Player2 Change',
              'Player3 Change',
              'Player4 Change'
            ]]
          }
        });
        console.log('✅ Created ELO tracker headers in new tab');
      } catch (createError) {
        console.error('❌ Failed to create ELO tracker tab:', createError);
        console.error('Create error details:', {
          message: createError.message,
          code: createError.code,
          response: createError.response?.data
        });
        throw new Error(`Failed to create or access tab "${tabName}": ${createError.message}`);
      }
    } else {
      // Re-throw if it's a different error
      throw error;
    }
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
