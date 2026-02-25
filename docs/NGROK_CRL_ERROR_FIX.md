# Fixing ngrok "failed to fetch CRL" Error

The "failed to fetch CRL" (Certificate Revocation List) error usually means ngrok can't verify SSL certificates due to network/firewall restrictions.

## Solution 1: Disable CRL Checking (Quick Fix)

Add this to your ngrok config file (`%USERPROFILE%\.ngrok2\ngrok.yml` or `%LOCALAPPDATA%\ngrok\ngrok.yml`):

```yaml
version: "2"
authtoken: 39ERdQuJQKr5ZDLSvOr8XTSXKsD_5oe9CUN5voonkv7EUKVfu
tunnels:
  default:
    proto: http
    addr: 8888
    inspect: true
    # Disable CRL checking
    crl_check: false
```

Then run: `ngrok start default`

## Solution 2: Use Localtunnel (No Auth Required)

Since you already have localtunnel installed:

```bash
lt --port 8888
```

This will give you an HTTPS URL like `https://random-name.loca.lt` - use this on your mobile device.

## Solution 3: Check Firewall/Antivirus

1. Temporarily disable Windows Firewall
2. Check if antivirus is blocking ngrok
3. Try from a different network (mobile hotspot)

## Solution 4: Use ngrok with Different Region

```bash
ngrok http 8888 --region us
# or
ngrok http 8888 --region eu
```

## Recommended: Use Localtunnel

For local development, localtunnel is simpler and doesn't require authentication:

```bash
# Terminal 1: Start Netlify Dev
netlify dev

# Terminal 2: Start Localtunnel
lt --port 8888
```

Then use the HTTPS URL from localtunnel on your mobile device.
