# Netlify Dev Troubleshooting - Deno/Edge Functions Error

If you're getting the Deno/Edge Functions error, here are solutions:

## Solution 1: Disable Edge Functions (Recommended)

Since your functions run in Lambda mode, you don't need Edge Functions:

```bash
netlify dev --no-edge-functions
```

For live tunnel:
```bash
netlify dev --live --no-edge-functions
```

## Solution 2: Clear Deno Cache

The error suggests clearing the Deno cache. Do this manually:

1. **Close all Netlify processes** (check Task Manager)
2. **Delete the Deno cache folder:**
   ```
   C:\Users\fikri.nabil\AppData\Roaming\netlify\Config\deno-cli
   ```
3. **Try again:**
   ```bash
   netlify dev --live --no-edge-functions
   ```

## Solution 3: Use Alternative Tunnel (if --live doesn't work)

If `--live` still fails, use ngrok or localtunnel:

### Option A: Using ngrok

1. **Install ngrok:**
   ```bash
   npm install -g ngrok
   ```

2. **Start Netlify Dev (without --live):**
   ```bash
   netlify dev --no-edge-functions
   ```

3. **In another terminal, start ngrok:**
   ```bash
   ngrok http 8888
   ```

4. **Use the HTTPS URL from ngrok** on your mobile device

### Option B: Using localtunnel

1. **Install localtunnel:**
   ```bash
   npm install -g localtunnel
   ```

2. **Start Netlify Dev:**
   ```bash
   netlify dev --no-edge-functions
   ```

3. **In another terminal:**
   ```bash
   lt --port 8888
   ```

4. **Use the HTTPS URL from localtunnel** on your mobile device

## Solution 4: Update Netlify CLI

Sometimes updating helps:

```bash
npm install -g netlify-cli@latest
```

## Solution 5: Check for Running Processes

The EBUSY error might mean Deno is already running:

1. **Open Task Manager** (Ctrl+Shift+Esc)
2. **Look for `deno.exe` processes**
3. **End them if found**
4. **Try again**

## Quick Test Without Tunnel

To test if the basic server works (same WiFi only):

```bash
netlify dev --no-edge-functions
```

Then find your IP:
```bash
ipconfig
```

Access from mobile: `http://YOUR_IP:8888`

⚠️ Note: Camera/geolocation won't work without HTTPS, but you can test UI.

## Recommended Workflow

1. First try: `netlify dev --live --no-edge-functions`
2. If that fails, use ngrok: `netlify dev --no-edge-functions` + `ngrok http 8888`
3. If still issues, clear Deno cache and retry
