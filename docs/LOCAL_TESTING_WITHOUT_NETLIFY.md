# Local Testing Without Netlify Functions

This guide shows how to test the frontend UI/UX features locally without needing Netlify Dev or Functions.

## Quick Start

### Option 1: Using Node.js HTTP Server (Recommended)

1. **Start the local server:**
   ```bash
   node local-server.js
   ```

2. **Access on your computer:**
   - Open `http://localhost:8888` in your browser

3. **Access on mobile device (same WiFi):**
   - Find your computer's IP address:
     ```bash
     # Windows PowerShell
     ipconfig | Select-String IPv4
     ```
   - Open `http://YOUR_IP:8888` on your phone
   - Example: `http://192.168.1.100:8888`

### Option 2: Using Python HTTP Server

If you have Python installed:

```bash
# Python 3
python -m http.server 8888

# Python 2
python -m SimpleHTTPServer 8888
```

### Option 3: Using http-server (npm package)

```bash
# Install globally
npm install -g http-server

# Run
http-server -p 8888
```

## What Works Without Netlify Functions

✅ **These features work fully:**
- Camera capture and photo storage (IndexedDB)
- Project creation and management (localStorage)
- Folder management (create, rename, delete, move projects)
- Multi-select projects
- Project settings editing (UI only)
- Progress Map display (without address lookup)
- GPS location tracking and live location indicator
- Photo browser with sorting
- All UI/UX features and navigation
- Form validation
- Tab name autocomplete (cached data)

## What Won't Work

❌ **These features require Netlify Functions:**
- **AI Image Detection** - Requires `/netlify/functions/openai`
- **Google Sheets Sync** - Requires `/netlify/functions/sheets-sync`
- **OneMap Address Search** - Requires `/netlify/functions/onemap`
- **Reverse Geocoding** - Requires `/netlify/functions/onemap`
- **Tab Name Fetching** - Requires Google Sheets API (via sheets-sync)

## Mock Responses

The `local-server.js` script automatically mocks Netlify Function endpoints:
- Returns JSON error: `{ error: "Netlify Functions not available in local mode" }`
- Prevents console errors from failed fetch requests
- Allows UI to load without breaking

## Testing HTTPS Features (Camera, GPS)

For camera and GPS to work, you need HTTPS. Options:

### Option A: Use localtunnel (Easiest)

1. **Start local server:**
   ```bash
   node local-server.js
   ```

2. **In another terminal, start localtunnel:**
   ```bash
   lt --port 8888
   ```

3. **Use the HTTPS URL** from localtunnel on your mobile device

### Option B: Use ngrok

1. **Start local server:**
   ```bash
   node local-server.js
   ```

2. **In another terminal:**
   ```bash
   ngrok http 8888
   ```

3. **Use the HTTPS URL** from ngrok

### Option C: Use mkcert (Local HTTPS)

1. **Install mkcert:**
   ```bash
   choco install mkcert
   # or
   scoop install mkcert
   ```

2. **Create local certificate:**
   ```bash
   mkcert -install
   mkcert localhost 127.0.0.1 ::1
   ```

3. **Use a server that supports HTTPS** (like `http-server` with SSL)

## Comparison: Local Server vs Netlify Dev

| Feature | Local Server | Netlify Dev |
|---------|-------------|-------------|
| Static files | ✅ | ✅ |
| Camera/GPS | ✅ (with HTTPS tunnel) | ✅ |
| Project management | ✅ | ✅ |
| Folder management | ✅ | ✅ |
| AI detection | ❌ | ✅ |
| Sheets sync | ❌ | ✅ |
| OneMap API | ❌ | ✅ |
| Setup complexity | ⭐ Simple | ⭐⭐ Medium |
| Speed | ⭐⭐⭐ Fast | ⭐⭐ Slower |

## When to Use Each Method

**Use Local Server (`local-server.js`):**
- Testing UI/UX changes
- Testing project/folder management
- Testing camera capture (without AI)
- Quick iteration on frontend code
- When Netlify Dev has issues

**Use Netlify Dev:**
- Testing full functionality
- Testing AI features
- Testing Google Sheets integration
- Pre-deployment testing
- When you need all features working

## Troubleshooting

### "Cannot GET /" Error
- Make sure `index.html` exists in the project root
- Check that the server is running in the correct directory

### Camera/GPS Not Working
- These require HTTPS
- Use localtunnel or ngrok to get HTTPS URL
- Or use Netlify Dev which provides HTTPS automatically

### Functions Return Errors
- This is expected! Functions are mocked
- Check console for mock error messages
- Use Netlify Dev if you need real function responses

### Mobile Device Can't Connect
- Ensure both devices are on same WiFi network
- Check Windows Firewall isn't blocking port 8888
- Try disabling firewall temporarily for testing
- Verify IP address is correct (use `ipconfig`)
