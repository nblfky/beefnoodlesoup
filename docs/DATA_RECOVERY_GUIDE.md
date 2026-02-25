# Data Recovery Guide

## Issues Fixed

### 1. Data Loss Issue (CRITICAL FIX)

**Problem:** When creating multiple scans rapidly, especially when switching between projects, scans were being lost. The app would show scans in the data tab, but after refresh, the count would drop (e.g., from 86 to 27).

**Root Cause:** 
- The `scheduleSaveScans()` function used `requestIdleCallback` which could delay saves
- When scans were added rapidly, the scheduled save might execute with stale data
- Race conditions between adding scans and saving them

**Fix Applied:**
1. **Immediate Save on Scan Accept**: When a scan is accepted, it's now saved immediately to localStorage instead of relying on scheduled saves
2. **Improved Save Scheduling**: The save function now properly debounces rapid saves and always saves the latest state of the scans array
3. **Better Error Handling**: Added error handling with automatic backup creation if saves fail
4. **Enhanced Logging**: Added console logging to track when scans are saved

### 2. Download Photos Button Stuck Issue

**Problem:** The "Download All Photos" button would get stuck in "Creating..." state after first use, preventing downloads from other projects until app refresh.

**Root Cause:**
- Button state wasn't properly reset in all code paths
- Early returns (like single photo download) didn't reset button state
- Multiple simultaneous clicks could cause state conflicts

**Fix Applied:**
1. **Prevent Multiple Clicks**: Added check to prevent multiple simultaneous downloads
2. **Always Reset Button**: Ensured button state is always reset in the `finally` block, even on early returns
3. **Store Original Text**: Store button text before any async operations to ensure proper restoration

## Recovery Tool

A recovery tool has been created to help restore lost scans: `tools/recover-scans.html`

### How to Use the Recovery Tool

1. **Open the recovery tool** in your browser (same browser where you use the app)
2. **Click "Analyze Scans"** - This will:
   - Load all scans from localStorage
   - Identify scans without projectId
   - Find duplicate entryIds
   - Show statistics by project
   - Display recent scans

3. **Review the Results**:
   - **Scans Without Project ID**: These are likely the lost scans
   - **Duplicate Entry IDs**: Scans that might be duplicates
   - **Recent Scans**: Last 50 scans with their project assignments

4. **Recover Scans**:
   - **Manual Assignment**: Use the dropdown to assign orphaned scans to projects
   - **Auto-Recovery**: Click "Recover Lost Scans" to automatically match orphaned scans to projects based on location/timestamp

5. **Export Report**: Click "Export Report" to save a JSON report of the analysis

### Recovery Process

The recovery tool will:
1. Load all scans from localStorage (including ones that might not be showing in the app)
2. Identify scans missing `projectId`
3. Try to match them to projects based on:
   - Location match (`projectLocation` or `location` field)
   - Date match (timestamp starts with project date)
4. Assign project data to matched scans
5. Save the recovered scans back to localStorage

### After Recovery

1. **Refresh the app** - The recovered scans should now appear
2. **Verify the data** - Check that scans are showing in the correct projects
3. **Sync to Google Sheets** - If needed, sync the recovered scans to Google Sheets

## Prevention

The fixes ensure that:
- Scans are saved immediately when accepted (no delay)
- Save operations are properly queued and debounced
- Errors during save create automatic backups
- Button states are always properly reset

## Technical Details

### Save Function Changes

**Before:**
```javascript
function scheduleSaveScans() {
  if (saveScansScheduled) return; // Could skip saves
  saveScansScheduled = true;
  requestIdleCallback(() => {
    localStorage.setItem('scans', JSON.stringify(scans)); // Might save stale data
    saveScansScheduled = false;
  });
}
```

**After:**
```javascript
function scheduleSaveScans() {
  // Clear pending saves and reschedule
  // Always saves latest state
  // Creates backups on error
}
```

### Immediate Save on Accept

**Before:**
```javascript
scans.unshift(scanData);
saveScans(); // Scheduled, might be delayed
```

**After:**
```javascript
scans.unshift(scanData);
// Immediate save to prevent data loss
localStorage.setItem('scans', JSON.stringify(scans));
```

## Backup System

If a save fails, the system now:
1. Logs the error
2. Creates a backup with timestamp: `scans_backup_<timestamp>`
3. On next load, tries to restore from backup if main data is corrupted

## Monitoring

Check browser console for:
- `💾 Saved X scans to localStorage` - Successful saves
- `💾 Immediately saved scan: <entryId>` - Immediate saves on accept
- `❌ Failed to save scans` - Save errors (backup will be created)
- `📥 Loaded X scans from localStorage` - Successful loads
- `💾 Restored X scans from backup` - Backup restoration

## Support

If you continue to experience data loss:
1. Use the recovery tool immediately
2. Check browser console for errors
3. Check localStorage for backup files
4. Export data regularly as a safety measure
