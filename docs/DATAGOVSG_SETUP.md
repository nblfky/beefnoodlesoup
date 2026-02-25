# data.gov.sg API Setup for Silver Zones & School Zones

This guide explains how to set up the data.gov.sg API key for Silver Zones and School Zones in the AV Routing Map.

## Prerequisites

- Netlify account with site deployed
- data.gov.sg API key (format: `v2:xxxxx...`)

## Step 1: Get Your data.gov.sg API Key

1. Visit [data.gov.sg API Dashboard](https://data.gov.sg/developers)
2. Sign up or log in
3. Generate an API key
4. Copy your API key (it will start with `v2:`)

## Step 2: Set Environment Variable in Netlify

### Option A: Using Netlify CLI

```bash
netlify secrets:set DATAGOVSG_API_KEY "v2:your-api-key-here"
```

### Option B: Using Netlify Dashboard

1. Go to your Netlify site dashboard
2. Navigate to **Site settings → Build & deploy → Environment**
3. Click **Add a variable**
4. Set:
   - **Key**: `DATAGOVSG_API_KEY`
   - **Value**: `v2:your-api-key-here` (include the `v2:` prefix)
5. Click **Save**

## Step 3: Deploy the Updated Function

The `netlify/functions/onemap.js` file has been updated with handlers for Silver Zones and School Zones. You need to deploy it:

### Option A: Automatic Deployment (if Git is connected)

1. Make sure `netlify/functions/onemap.js` is tracked by git:
   ```bash
   git status netlify/functions/onemap.js
   ```
   If it shows as untracked or modified, add it:
   ```bash
   git add netlify/functions/onemap.js
   git commit -m "Add Silver Zones and School Zones handlers"
   git push
   ```
2. Netlify will automatically deploy

### Option B: Manual Deployment

```bash
netlify deploy --prod
```

**Important**: After deployment, wait a few minutes for the function to be available, then test it using Step 4.

## Step 4: Verify Function is Working

After deployment, test the function:

### Method 1: Browser Console Test

1. Open your deployed site
2. Open browser console (F12)
3. Run this test:
   ```javascript
   fetch('/.netlify/functions/onemap', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ action: 'test' })
   })
   .then(r => {
     console.log('Status:', r.status);
     return r.json();
   })
   .then(console.log)
   .catch(err => console.error('Error:', err));
   ```

You should see:
```json
{
  "success": true,
  "message": "OneMap proxy function is working",
  "availableActions": ["search", "reverseGeocode", "getBuildings", "getSilverZones", "getSchoolZones", "checkToken"],
  "hasDataGovApiKey": true,
  "hasOneMapCredentials": true
}
```

### Method 2: Direct URL Test

Visit: `https://your-site.netlify.app/.netlify/functions/onemap`

You should see an error message about "Missing action parameter" - this confirms the function is deployed and accessible.

### Troubleshooting 404 Errors

If you get a 404 error:

1. **Check function file exists**: Verify `netlify/functions/onemap.js` exists in your repository
2. **Check deployment logs**: In Netlify dashboard, go to **Deploys** → Click latest deploy → Check **Functions** tab
3. **Verify function path**: The function should be accessible at `/.netlify/functions/onemap`
4. **Check build settings**: In Netlify dashboard → **Site settings → Build & deploy → Functions**, ensure functions directory is set to `netlify/functions`
5. **Redeploy**: Try triggering a new deployment

If `hasDataGovApiKey` is `false`, the environment variable isn't set correctly. Make sure:
- Variable name is exactly `DATAGOVSG_API_KEY` (case-sensitive)
- Value includes the `v2:` prefix
- Variable is set in the correct environment (Production vs Preview)

## Step 5: Test Silver/School Zones

1. Open the AV Routing Map
2. Check the "Silver Zones" checkbox
3. Check the "School Zones" checkbox
4. Zones should load and display on the map

## Troubleshooting

### Error: "Netlify function not found (404)"

**Solution**: The function needs to be deployed. Run `netlify deploy --prod` or push your changes to trigger automatic deployment.

### Error: "API key not configured"

**Solution**: 
1. Verify `DATAGOVSG_API_KEY` is set in Netlify environment variables
2. Make sure you included the `v2:` prefix
3. Redeploy after setting the variable

### Error: "Authentication failed" or "Invalid API key"

**Solution**:
1. Verify your API key is correct
2. Check that the API key includes the `v2:` prefix
3. Ensure there are no extra spaces or quotes

### Error: "Rate limit exceeded"

**Solution**: Wait a few moments and try again. data.gov.sg has rate limits on API calls.

## API Endpoints Used

- **Silver Zones**: Collection ID 330
  - Metadata: `https://api-production.data.gov.sg/v2/public/api/collections/330/metadata`
  - Direct link: `https://data.gov.sg/collections/330`

- **School Zones**: Collection ID 329
  - Metadata: `https://api-production.data.gov.sg/v2/public/api/collections/329/metadata`
  - Direct link: `https://data.gov.sg/collections/329`

## Notes

- The API key is stored securely in Netlify environment variables and never exposed to the client
- All API calls go through the Netlify function proxy for security
- The function handles authentication automatically using the `x-api-key` header
