# Fix: "The caller does not have permission" Error

## What This Error Means

The error **"the caller does not have permission"** means your Google Service Account doesn't have access to the Google Sheet. The service account needs to be explicitly shared with the sheet, just like you would share it with a person.

## Quick Fix: Share the Sheet with Service Account

### Step 1: Get Your Service Account Email

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **IAM & Admin** > **Service Accounts**
3. Find your service account (the one configured in Netlify)
4. Copy the **Email** address (it looks like: `your-service-account@your-project.iam.gserviceaccount.com`)

### Step 2: Share Your Google Sheet

1. Open your Google Sheet (the one specified in `GOOGLE_SHEET_ID`)
2. Click the **Share** button (top right)
3. In the "Add people and groups" field, paste your **service account email**
4. Set permission to **Editor** (not Viewer - it needs to write data)
5. **Uncheck** "Notify people" (service accounts don't have email)
6. Click **Share**

### Step 3: Verify Access

After sharing, wait a few seconds and try syncing again. The error should be resolved.

## Common Issues

### Issue 1: Wrong Service Account Email

**Problem:** Using the wrong service account email

**Solution:** 
- Double-check the email in Google Cloud Console matches what you shared
- Verify `GOOGLE_SERVICE_ACCOUNT_EMAIL` in Netlify matches the shared email

### Issue 2: Sheet ID Mismatch

**Problem:** The sheet ID in Netlify doesn't match the actual sheet

**Solution:**
- Get the correct Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`
- Update `GOOGLE_SHEET_ID` in Netlify environment variables
- Make sure you're sharing the correct sheet

### Issue 3: Permission Level Too Low

**Problem:** Service account has "Viewer" permission instead of "Editor"

**Solution:**
- Change the permission to **Editor** in the Share dialog
- Service accounts need Editor access to write data

### Issue 4: Multiple Sheets in One Spreadsheet

**Problem:** You're trying to sync to a specific tab, but the service account doesn't have access

**Solution:**
- Share the entire spreadsheet (not just individual tabs)
- The service account needs access to the whole spreadsheet to create/access tabs

## Step-by-Step Visual Guide

1. **Open Google Sheets**
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit
   ```

2. **Click "Share" button** (top right corner)

3. **Add Service Account Email**
   - Paste: `your-service-account@project.iam.gserviceaccount.com`
   - Select: **Editor** role
   - Uncheck: "Notify people"
   - Click: **Share**

4. **Verify in Netlify**
   - Go to Netlify Dashboard → Site Settings → Environment Variables
   - Check that `GOOGLE_SERVICE_ACCOUNT_EMAIL` matches the email you shared

5. **Test Sync**
   - Try syncing a scan again
   - Check console logs for success message

## Troubleshooting

### Still Getting Permission Error?

1. **Wait a few minutes** - Sharing changes can take time to propagate
2. **Check the email** - Make sure there are no typos in the service account email
3. **Check the sheet ID** - Verify `GOOGLE_SHEET_ID` is correct
4. **Try a different sheet** - Create a test sheet and share it to isolate the issue
5. **Check Netlify logs** - Look for more detailed error messages in Netlify function logs

### Check Netlify Function Logs

1. Go to Netlify Dashboard
2. Navigate to **Functions** tab
3. Click on `sheets-sync` function
4. Check the **Logs** tab for detailed error messages

### Verify Service Account Configuration

Make sure these environment variables are set correctly in Netlify:

- ✅ `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email
- ✅ `GOOGLE_PRIVATE_KEY` - Service account private key
- ✅ `GOOGLE_SHEET_ID` - Google Sheet ID

## Alternative: Use OAuth Delegation

If you're using Google Workspace and still having issues, you can use OAuth delegation:

1. See `docs/OAUTH_DELEGATION_SETUP.md` for detailed instructions
2. Set `GOOGLE_IMPERSONATE_USER` environment variable
3. This allows the service account to act as a user account

## Still Need Help?

If you're still getting permission errors after following these steps:

1. Check the exact error message in the console
2. Verify all environment variables are set correctly
3. Make sure the service account has the correct IAM roles in Google Cloud Console
4. Try creating a new test sheet and sharing it to verify the setup works
