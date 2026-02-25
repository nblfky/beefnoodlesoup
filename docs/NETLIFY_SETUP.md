# Netlify Deployment Guide

This project now expects to run on Netlify so both the static site and the OpenAI proxy live together. Follow these steps to deploy safely without exposing your OpenAI API key.

## Prerequisites

- Node.js 18+
- Netlify account
- `netlify-cli` (`npm install -g netlify-cli`)
- OpenAI API key

## 1. Authenticate the Netlify CLI

```bash
netlify login
```

## 2. Link (or create) a Netlify site

Inside the project directory:

```bash
netlify init
```

Follow the prompts to create a new site or connect to an existing one. The CLI will remember the association locally.

## 3. Store API keys as environment variables

### OpenAI API Key
```bash
netlify secrets:set OPENAI_API_KEY <your-openai-key>
```

### OneMap Credentials (for address search)
```bash
netlify secrets:set ONEMAP_EMAIL <your-onemap-email>
netlify secrets:set ONEMAP_PASSWORD <your-onemap-password>
```

### data.gov.sg API Key (for Silver Zones & School Zones)
```bash
netlify secrets:set DATAGOVSG_API_KEY <your-datagovsg-api-key>
```

You can also add these variables in the Netlify UI: **Site settings → Build & deploy → Environment**.

The functions read these values from environment variables, so the keys never ship to browsers.

## 4. Test locally

```bash
netlify dev
```

This command serves the static files and emulates Netlify Functions. Visit the printed URL (default `http://localhost:8888`) and run a scan to confirm GPT calls succeed.

## 5. Deploy

Preview deploy:

```bash
netlify deploy
```

Production deploy:

```bash
netlify deploy --prod
```

Alternatively, enable continuous deployment from the Netlify dashboard to trigger builds on every push to the linked Git repository.

## 6. Frontend configuration

`script.js` automatically falls back to the Netlify Function endpoint `/.netlify/functions/openai`. If you ever need to override the URL (for example, to use a staging function), set it before loading `script.js`:

```html
<script>
  window.OPENAI_PROXY_URL = 'https://staging-site.netlify.app/.netlify/functions/openai';
</script>
```

## 7. Rotating the API key

Run `netlify secrets:set OPENAI_API_KEY <new-key>` and redeploy. No frontend changes are required.

---

With this setup the OpenAI key stays on the server, and your GitHub-hosted repository contains only the static assets plus the Netlify function code.

