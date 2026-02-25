# Image Management Guide

## Overview

Due to security constraints with Google Workspace, images are **not uploaded directly from the app to Google Drive**. Instead, images are stored locally on your device with **entryId-based filenames** that match the unique entry ID synced to Google Sheets. This allows Google Apps Script to retrieve images from Google Drive using the same entryId.

## How It Works

### Image Storage & Naming

- **Full-resolution images**: Stored in browser's IndexedDB (local storage)
- **Thumbnails**: Stored in localStorage for quick display
- **Filename format**: `{Floor}_{Building}_{entryId}.jpg` or `{entryId}.jpg` (e.g., `L1_ION_ORCHARD_entry-1234567890-abc123def.jpg` or `entry-1234567890-abc123def.jpg`)
- **Entry ID**: Unique identifier generated for each scan, synced to Google Sheets
- **No cloud upload**: Images never leave your device unless you export them

### Google Sheets Sync

- **Entry ID**: Column A (or designated column) - Unique identifier for each scan
- **Image Filename**: Column T - The filename format is `{Floor}_{Building}_{entryId}.jpg` or `{entryId}.jpg` (e.g., `L1_ION_ORCHARD_entry-1234567890-abc123def.jpg`)
- **Image Size**: Column U - Size in bytes
- **Has Image**: Column V - "Yes" or "No" indicator

This design allows:
- **Easy matching**: Entry ID in Sheets matches image filename exactly
- **Google Apps Script integration**: Scripts can retrieve images from Drive using entryId
- **No security concerns**: Images are uploaded separately (manually or via secure process)

## Workflow

### Step 1: Scan & Sync to Google Sheets

1. **In the App**:
   - Scan storefronts using the camera or batch upload
   - Each scan gets a unique `entryId` (e.g., `entry-1234567890-abc123def`)
   - Image is saved locally with filename: `{Floor}_{Building}_{entryId}.jpg` (e.g., `L1_ION_ORCHARD_entry-1234567890-abc123def.jpg`)
   - If floor/building data is not available, filename falls back to: `{entryId}.jpg`
   - Sync to Google Sheets (entryId and image metadata are synced)

### Step 2: Export Images

1. **In the App**:
   - Click "Download Photos" button
   - This creates a ZIP file with all images
   - Images are named using format: `{Floor}_{Building}_{entryId}.jpg` (e.g., `L1_ION_ORCHARD_entry-1234567890-abc123def.jpg`)
   - If floor/building data is not available, filenames will be: `{entryId}.jpg`

### Step 3: Upload to Google Drive

1. **After Export**:
   - Extract images from the ZIP file
   - Upload images to your Google Drive folder (can be organized in subfolders)
   - **Important**: Keep the original filenames (entryId-based names)
   - Images will be named like: `L1_ION_ORCHARD_entry-1234567890-abc123def.jpg` or `entry-1234567890-abc123def.jpg`
   - **Note**: The Apps Script searches recursively through all subfolders, so you can organize images in folders like: `Storefront Images > Orchard Grid > ION Orchard > L1`

### Step 4: Link Images in Google Sheets (via Apps Script)

Use the provided Google Apps Script (see below) to automatically retrieve and display images from Google Drive in your Google Sheets using the entryId.

## Google Apps Script Integration

### Setup Instructions

1. **Open your Google Sheet**
2. **Go to Extensions → Apps Script**
3. **Paste the script** (see example below)
4. **Get your Google Drive Folder ID**:
   - Open your Google Drive folder
   - Look at the URL: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
   - Copy the `FOLDER_ID_HERE` part (it's a long string of letters and numbers)
   - Example: If URL is `https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j`, then folder ID is `1a2b3c4d5e6f7g8h9i0j`
5. **Update the configuration** in the script:
   - Replace `'YOUR_GOOGLE_DRIVE_FOLDER_ID'` with your actual folder ID (keep the quotes)
   - Set `ENTRY_ID_COLUMN` to the column containing entryIds (e.g., 'A' for column A)
   - Set `IMAGE_COLUMN` to where you want images displayed (e.g., 'W' for column W)
6. **Save the script** (Ctrl+S or Cmd+S)
7. **Authorize the script** (IMPORTANT - Required for Drive access):
   - Click "Run" button (▶) or select `validateConfig` from the function dropdown and click Run
   - You'll see an "Authorization required" dialog - click "Review Permissions"
   - Choose your Google account (the one that has access to the Drive folder)
   - You may see a warning screen - click "Advanced" → "Go to [Project Name] (unsafe)"
   - Click "Allow" to grant Drive access permissions
   - The script needs these permissions:
     - View and manage files in Google Drive
     - Connect to an external service
8. **Verify authorization**: Run `validateConfig()` again - you should see "✅ Connected to folder: [Folder Name]" in the execution log
9. **Create the menu**: The `onOpen` function will run automatically when you open the sheet, or you can run it manually
10. **Use the menu**: Click "bnsVision Images" in the menu bar to link images

**If you get "Access denied" errors:**
- The script needs to be re-authorized with Drive permissions
- Go to Apps Script → Run → `validateConfig`
- Follow the authorization prompts again
- Make sure you're using the same Google account that has access to the Drive folder

### Example Google Apps Script

```javascript
/**
 * bnsVision Image Linker for Google Sheets
 * Retrieves images from Google Drive using entryId and displays them in Sheets
 */

// CONFIGURATION - Update these values
// IMPORTANT: Replace 'YOUR_GOOGLE_DRIVE_FOLDER_ID' with your actual folder ID
// Get it from: https://drive.google.com/drive/folders/FOLDER_ID_HERE
const DRIVE_FOLDER_ID = 'YOUR_GOOGLE_DRIVE_FOLDER_ID'; // Get from Drive folder URL
const ENTRY_ID_COLUMN = 'A'; // Column containing entryIds (e.g., 'A', 'B', etc.)
const IMAGE_COLUMN = 'W'; // Column where images will be displayed
const FILENAME_COLUMN = 'T'; // Column containing image filenames (for reference)

/**
 * Validates configuration before running
 */
function validateConfig() {
  // Check if folder ID is still the placeholder
  if (!DRIVE_FOLDER_ID || DRIVE_FOLDER_ID === 'YOUR_GOOGLE_DRIVE_FOLDER_ID' || DRIVE_FOLDER_ID.trim() === '') {
    throw new Error('Please set DRIVE_FOLDER_ID in the script. Get your folder ID from the Drive folder URL.');
  }
  
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const folderName = folder.getName();
    Logger.log(`✅ Connected to folder: ${folderName}`);
    return true;
  } catch (error) {
    throw new Error(`Invalid DRIVE_FOLDER_ID or no access to folder. Error: ${error.message}\n\nMake sure:\n1. The folder ID is correct: ${DRIVE_FOLDER_ID}\n2. You have access to the folder\n3. The script has been authorized`);
  }
}

/**
 * Creates a custom menu when the sheet opens
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('bnsVision Images')
    .addItem('Link All Images', 'linkAllImages')
    .addItem('Link Selected Row', 'linkSelectedImage')
    .addItem('Clear All Images', 'clearAllImages')
    .addToUi();
}

/**
 * Links images for all rows that have an entryId
 */
function linkAllImages() {
  try {
    // Validate configuration first
    validateConfig();
  } catch (error) {
    SpreadsheetApp.getUi().alert('Configuration Error: ' + error.message);
    return;
  }
  
  const sheet = SpreadsheetApp.getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  const entryIdColIndex = columnLetterToIndex(ENTRY_ID_COLUMN);
  const imageColIndex = columnLetterToIndex(IMAGE_COLUMN);
  
  let linkedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  
  // Start from row 2 (skip header)
  for (let i = 1; i < values.length; i++) {
    const entryId = values[i][entryIdColIndex];
    
    if (!entryId || entryId.toString().trim() === '') {
      skippedCount++;
      continue;
    }
    
    // Clean entryId - remove any prefixes like "EntryID:"
    let cleanEntryId = entryId.toString().trim();
    if (cleanEntryId.includes(':')) {
      cleanEntryId = cleanEntryId.split(':').pop().trim();
    }
    
    try {
      // Check if image link already exists - skip if it does
      const existingLink = sheet.getRange(i + 1, imageColIndex + 1).getValue();
      if (existingLink && existingLink.toString().trim() !== '') {
        skippedCount++;
        continue; // Skip this row, already has a link
      }
      
      const imageUrl = findImageInDrive(cleanEntryId);
      if (imageUrl) {
        // Insert image URL as text (not as displayed image)
        sheet.getRange(i + 1, imageColIndex + 1).setValue(imageUrl);
        linkedCount++;
      } else {
        skippedCount++;
      }
    } catch (error) {
      Logger.log(`Error linking image for entryId ${cleanEntryId}: ${error.message}`);
      errorCount++;
    }
    
    // Update progress every 10 rows
    if ((i + 1) % 10 === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        `Processing... ${i + 1}/${values.length - 1} rows`,
        'Progress',
        2
      );
    }
  }
  
  const message = `Linked ${linkedCount} images. Skipped ${skippedCount} rows.${errorCount > 0 ? ` Errors: ${errorCount}` : ''}`;
  SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Complete', 5);
}

/**
 * Links image for the currently selected row
 */
function linkSelectedImage() {
  try {
    // Validate configuration first
    validateConfig();
  } catch (error) {
    SpreadsheetApp.getUi().alert('Configuration Error: ' + error.message);
    return;
  }
  
  const sheet = SpreadsheetApp.getActiveSheet();
  const activeRow = sheet.getActiveRange().getRow();
  
  if (activeRow === 1) {
    SpreadsheetApp.getUi().alert('Please select a data row (not the header).');
    return;
  }
  
  let entryId = sheet.getRange(activeRow, columnLetterToIndex(ENTRY_ID_COLUMN) + 1).getValue();
  
  if (!entryId || entryId.toString().trim() === '') {
    SpreadsheetApp.getUi().alert('No entryId found in this row.');
    return;
  }
  
  // Clean entryId - remove any prefixes like "EntryID:"
  let cleanEntryId = entryId.toString().trim();
  if (cleanEntryId.includes(':')) {
    cleanEntryId = cleanEntryId.split(':').pop().trim();
  }
  
  try {
    // Check if image link already exists
    const imageColIndex = columnLetterToIndex(IMAGE_COLUMN);
    const existingLink = sheet.getRange(activeRow, imageColIndex + 1).getValue();
    if (existingLink && existingLink.toString().trim() !== '') {
      SpreadsheetApp.getUi().alert('This row already has an image link. Clear it first if you want to update it.');
      return;
    }
    
    const imageUrl = findImageInDrive(cleanEntryId);
    if (imageUrl) {
      // Insert image URL as text (not as displayed image)
      sheet.getRange(activeRow, imageColIndex + 1).setValue(imageUrl);
      SpreadsheetApp.getUi().alert('Image link added successfully!');
    } else {
      SpreadsheetApp.getUi().alert(`Image not found in Drive for entryId: ${cleanEntryId}\n\nMake sure:\n1. The image file exists in your Drive folder\n2. The filename matches exactly: ${cleanEntryId}.jpg or ${cleanEntryId}.png`);
    }
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error: ${error.message}\n\nCheck that:\n1. DRIVE_FOLDER_ID is set correctly\n2. You have access to the folder\n3. The script has Drive permissions`);
  }
}

/**
 * Clears all images from the image column
 */
function clearAllImages() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const imageColIndex = columnLetterToIndex(IMAGE_COLUMN);
  const lastRow = sheet.getLastRow();
  
  if (lastRow > 1) {
    sheet.getRange(2, imageColIndex + 1, lastRow - 1, 1).clearContent();
    SpreadsheetApp.getActiveSpreadsheet().toast('All images cleared.', 'Complete', 3);
  }
}

/**
 * Finds an image in Google Drive by entryId
 * RECURSIVELY searches through all subfolders
 * Supports both .jpg and .png extensions
 * Supports filename formats: entryId.jpg, Floor_Building_entryId.jpg, or Building_entryId.jpg
 * Returns the shareable URL or null if not found
 */
function findImageInDrive(entryId) {
  try {
    // Validate folder ID first
    if (!DRIVE_FOLDER_ID || DRIVE_FOLDER_ID === 'YOUR_GOOGLE_DRIVE_FOLDER_ID') {
      throw new Error('DRIVE_FOLDER_ID is not configured. Please set it in the script.');
    }
    
    // Get root folder - this will trigger authorization if needed
    let rootFolder;
    try {
      rootFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    } catch (authError) {
      if (authError.message.includes('Access denied') || authError.message.includes('permission')) {
        throw new Error('Drive access denied. Please authorize the script:\n1. Run validateConfig() function\n2. Click "Review Permissions"\n3. Choose your account\n4. Click "Advanced" → "Go to [Project] (unsafe)"\n5. Click "Allow"');
      }
      throw authError;
    }
    
    // Recursively search for the file
    const result = searchFileRecursively(rootFolder, entryId);
    return result;
    
  } catch (error) {
    Logger.log(`Error finding image for entryId ${entryId}: ${error.message}`);
    throw error; // Re-throw to be caught by caller
  }
}

/**
 * Recursively searches for a file by entryId in a folder and all its subfolders
 * Supports multiple filename formats:
 * - entryId.jpg / entryId.png
 * - Floor_Building_entryId.jpg
 * - Building_entryId.jpg
 * @param {Folder} folder - The folder to search in
 * @param {string} entryId - The entryId to search for (without extension)
 * @returns {string|null} - The shareable URL or null if not found
 */
function searchFileRecursively(folder, entryId) {
  // Try exact matches first (most common case)
  let files = folder.getFilesByName(`${entryId}.jpg`);
  if (files.hasNext()) {
    const file = files.next();
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareError) {
      Logger.log(`Note: Could not set sharing for ${entryId}.jpg: ${shareError.message}`);
    }
    return `https://drive.google.com/file/d/${file.getId()}/view?usp=drive_link`;
  }
  
  // Try .png
  files = folder.getFilesByName(`${entryId}.png`);
  if (files.hasNext()) {
    const file = files.next();
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareError) {
      Logger.log(`Note: Could not set sharing for ${entryId}.png: ${shareError.message}`);
    }
    return `https://drive.google.com/file/d/${file.getId()}/view?usp=drive_link`;
  }
  
  // Search for files that end with _entryId.jpg or _entryId.png
  // We need to iterate through all files in the folder
  files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    
    // Check if filename ends with _entryId.jpg or _entryId.png
    if (fileName.endsWith(`_${entryId}.jpg`) || fileName.endsWith(`_${entryId}.png`)) {
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareError) {
        Logger.log(`Note: Could not set sharing for ${fileName}: ${shareError.message}`);
      }
      return `https://drive.google.com/file/d/${file.getId()}/view?usp=drive_link`;
    }
  }
  
  // If not found in current folder, search all subfolders recursively
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    const result = searchFileRecursively(subfolder, entryId);
    if (result) {
      return result; // Found it in a subfolder
    }
  }
  
  return null; // Not found in this folder or any subfolders
}

/**
 * Converts column letter (A, B, C...) to zero-based index
 */
function columnLetterToIndex(column) {
  let result = 0;
  for (let i = 0; i < column.length; i++) {
    result = result * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result - 1;
}

/**
 * Optional: Auto-link images when a new row is added
 * Set this as an onEdit trigger in Apps Script
 */
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const range = e.range;
  const row = range.getRow();
  
  // Skip header row
  if (row === 1) return;
  
  // Check if entryId column was edited
  const entryIdColIndex = columnLetterToIndex(ENTRY_ID_COLUMN);
  if (range.getColumn() === entryIdColIndex + 1) {
    const entryId = range.getValue();
    if (entryId && entryId.toString().trim() !== '') {
      try {
        // Check if image link already exists - skip if it does
        const imageColIndex = columnLetterToIndex(IMAGE_COLUMN);
        const existingLink = sheet.getRange(row, imageColIndex + 1).getValue();
        if (existingLink && existingLink.toString().trim() !== '') {
          return; // Skip, already has a link
        }
        
        const imageUrl = findImageInDrive(entryId.toString().trim());
        if (imageUrl) {
          // Insert image URL as text (not as displayed image)
          sheet.getRange(row, imageColIndex + 1).setValue(imageUrl);
        }
      } catch (error) {
        Logger.log('Auto-link error:', error);
      }
    }
  }
}
```

### Getting Your Google Drive Folder ID

1. Open your Google Drive folder
2. Look at the URL: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
3. Copy the `FOLDER_ID_HERE` part
4. Paste it into the `DRIVE_FOLDER_ID` constant in the script

## Best Practices

### Regular Exports
- **Export photos weekly** or after completing a project
- This ensures you have backups if device storage is cleared
- Upload to Google Drive immediately after export

### Organization
- Images are automatically named: `{Floor}_{Building}_{entryId}.jpg` or `{entryId}.jpg`
- **Keep original filenames** when uploading to Drive
- Use the entryId in Google Sheets to match images
- **Organize in subfolders**: The Apps Script searches recursively, so you can organize images in folders like: `Storefront Images > Orchard Grid > ION Orchard > L1`
- Consider creating folders by project/date in Drive

### Storage Management
- IndexedDB storage is limited per browser
- If you notice performance issues, export and clear old scans
- The app stores thumbnails separately to save space

## Security Benefits

✅ **No direct upload**: Images never leave your device automatically  
✅ **Manual control**: You decide when/where to upload images  
✅ **Secure process**: Upload via approved channels (Drive, OneDrive, etc.)  
✅ **Compliance**: Meets organization security requirements  
✅ **EntryId matching**: Easy to link images using unique identifiers  

## Troubleshooting

### Apps Script Errors

**Error: "SyntaxError: Identifier 'DRIVE_FOLDER_ID' has already been declared"**
- **Solution**: You have duplicate code in your Apps Script file
  1. Open your Apps Script editor
  2. Select ALL code (Ctrl+A or Cmd+A)
  3. Delete it completely
  4. Copy the ENTIRE script from the guide below (starting from `// CONFIGURATION`)
  5. Paste it ONCE into the editor
  6. Make sure there's only ONE declaration of `const DRIVE_FOLDER_ID` at the top
  7. Save and try running `validateConfig()` again

### Images Not Showing in Sheets
- Verify images are uploaded to the correct Drive folder
- Check that filenames match entryIds exactly (case-sensitive)
- Ensure images are shared (setSharing in script handles this)
- Verify DRIVE_FOLDER_ID is correct

### Export Not Working
- Ensure you have enough device storage
- Try exporting smaller batches
- Check browser permissions for downloads

### Missing Images After Sync
- Images are stored locally, not in Google Sheets
- Use the app's export feature to get images
- Upload to Drive, then use Apps Script to link them
- Check the "Has Image" column in Sheets to see which scans have photos

### Apps Script Errors

**Error: "Unexpected error while getting the method or property getFolderById"**
- **Solution**: The `DRIVE_FOLDER_ID` is not set correctly
  1. Open your Google Drive folder
  2. Copy the folder ID from the URL (the long string after `/folders/`)
  3. In Apps Script, replace `'YOUR_GOOGLE_DRIVE_FOLDER_ID'` with your actual folder ID
  4. Make sure to keep the quotes: `const DRIVE_FOLDER_ID = 'your-actual-folder-id-here';`
  5. Save the script and try again

**Error: "Please set DRIVE_FOLDER_ID"**
- The folder ID hasn't been configured. Follow the setup instructions above.

**Error: "Access denied: DriveApp" or "Invalid DRIVE_FOLDER_ID or no access to folder"**
- **Solution**: The script needs Drive API permissions
  1. In Apps Script, go to Run → `validateConfig`
  2. Click "Review Permissions" when prompted
  3. Choose your Google account
  4. Click "Advanced" → "Go to [Project Name] (unsafe)" if you see a warning
  5. Click "Allow" to grant permissions
  6. Make sure you're using the same Google account that has access to the Drive folder
  7. Try running `validateConfig` again - it should show "✅ Connected to folder"

**Error: "Invalid DRIVE_FOLDER_ID or no access to folder"**
- Check that the folder ID is correct (copy it directly from the Drive URL)
- Ensure you have access to the folder
- Make sure the script has been authorized (run `validateConfig` function first)
- Verify you're using the correct Google account (the one with folder access)

**Images not showing**
- Verify images are uploaded to the correct Drive folder
- Check that filenames match entryIds exactly (case-sensitive, including extension)
- Ensure images are shared (the script handles this automatically)
- Try running `validateConfig` to test folder access

**How to test your folder ID:**
1. In Apps Script, select `validateConfig` from the function dropdown
2. Click "Run" (▶)
3. If successful, you'll see "✅ Connected to folder: [Folder Name]" in the execution log
4. If it fails, check the error message and fix the folder ID
