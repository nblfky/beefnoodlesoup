# Local Mobile Device Testing Guide

This guide shows you how to test the app on your mobile device without deploying to Netlify every time.

## Option 1: Netlify Dev with Tunnel (Recommended)

Netlify Dev can create a secure tunnel that allows HTTPS access from any device, including mobile.

### Steps:

1. **Start Netlify Dev with tunnel:**
   ```bash
   netlify dev --live
   ```
   
   This will:
   - Start a local server (usually on `http://localhost:8888`)
   - Create a secure tunnel URL (e.g., `https://random-name.netlify.live`)
   - Make your app accessible from anywhere via HTTPS

2. **Access from your mobile device:**
   - Open the tunnel URL shown in the terminal on your mobile browser
   - The URL will look like: `https://random-name.netlify.live`
   - This works on any network (WiFi, mobile data, etc.)

3. **Benefits:**
   - ✅ HTTPS enabled (required for camera/geolocation)
   - ✅ Works from anywhere (not just same WiFi)
   - ✅ Netlify Functions work locally
   - ✅ No port forwarding needed

### Alternative: Without tunnel (same WiFi only)

If you're on the same WiFi network:

1. **Start Netlify Dev:**
   ```bash
   netlify dev
   ```

2. **Find your computer's local IP address:**
   - Windows: Open Command Prompt and run `ipconfig`
   - Look for "IPv4 Address" (e.g., `192.168.1.100`)
   - Mac/Linux: Run `ifconfig` or `ip addr`

3. **Access from mobile:**
   - Make sure your mobile device is on the same WiFi network
   - Open browser on mobile and go to: `http://YOUR_IP:8888`
   - Example: `http://192.168.1.100:8888`

   ⚠️ **Note:** This won't work for camera/geolocation features because they require HTTPS. Use the tunnel method above instead.

## Option 2: Simple HTTP Server (Limited)

If you just need to test UI without camera/geolocation:

1. **Install a simple HTTP server:**
   ```bash
   npm install -g http-server
   ```

2. **Start the server:**
   ```bash
   http-server -p 8080
   ```

3. **Access from mobile (same WiFi):**
   - Find your IP address (see above)
   - Open `http://YOUR_IP:8080` on mobile

   ⚠️ **Limitations:**
   - No HTTPS (camera/geolocation won't work)
   - Netlify Functions won't work
   - Only works on same WiFi network

## Quick Start (Recommended)

Just run this command:

```bash
netlify dev --live
```

Then open the HTTPS URL shown in the terminal on your mobile device. That's it! 🎉

## Troubleshooting

### "Port already in use"
If port 8888 is busy:
```bash
netlify dev --live --port 3000
```

### "Tunnel connection failed"
- Check your internet connection
- Try again (tunnel creation can sometimes fail)
- Make sure Netlify CLI is up to date: `npm install -g netlify-cli@latest`

### Camera/Geolocation not working
- Make sure you're using HTTPS (use `--live` flag)
- Check browser permissions on mobile device
- Some browsers require user interaction before requesting camera permission

### Netlify Functions not working
- Make sure you've set environment variables: `netlify secrets:set OPENAI_API_KEY <your-key>`
- Check the terminal for function errors
- Verify `netlify.toml` is configured correctly

## Tips

1. **Keep the terminal open** - The tunnel stays active as long as `netlify dev` is running
2. **Auto-reload** - Changes to files will automatically reload in the browser
3. **Check console** - Use mobile browser's developer tools or remote debugging to see errors
4. **Test on different devices** - The tunnel URL works on any device, anywhere

## Mobile Browser Developer Tools

To debug on mobile:

- **Chrome (Android):** Connect via USB, open `chrome://inspect` on desktop
- **Safari (iOS):** Enable Web Inspector in Settings → Safari → Advanced, connect via USB, use Safari on Mac
- **Firefox:** Use Firefox Remote Debugging
