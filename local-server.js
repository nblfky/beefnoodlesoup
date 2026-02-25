// Simple local HTTP server for testing frontend without Netlify Functions
// Usage: node local-server.js

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8888;
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

const server = http.createServer((req, res) => {
  // Handle Netlify Functions endpoints - return mock responses
  if (req.url.startsWith('/.netlify/functions/')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });

    if (req.method === 'OPTIONS') {
      res.end();
      return;
    }

    // Return mock error response
    const mockResponse = {
      error: 'Netlify Functions not available in local mode',
      message: 'This feature requires Netlify Functions. Use "netlify dev" for full functionality.',
    };
    res.end(JSON.stringify(mockResponse));
    return;
  }

  // Serve static files
  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        // 404 - File not found
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - File Not Found</h1>', 'utf-8');
      } else {
        // 500 - Server error
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n✅ Local server running at http://localhost:${PORT}`);
  console.log(`\n📱 To access from mobile device:`);
  console.log(`   1. Make sure your phone is on the same WiFi network`);
  console.log(`   2. Find your computer's IP address:`);
  console.log(`      Windows: ipconfig | findstr IPv4`);
  console.log(`   3. Open http://YOUR_IP:${PORT} on your phone`);
  console.log(`\n⚠️  Note: Netlify Functions are mocked (will return errors)`);
  console.log(`   Features that won't work:`);
  console.log(`   - AI image detection`);
  console.log(`   - Google Sheets sync`);
  console.log(`   - OneMap address search/reverse geocoding`);
  console.log(`\n✅ Features that WILL work:`);
  console.log(`   - Camera capture`);
  console.log(`   - Photo storage (IndexedDB)`);
  console.log(`   - Project management (localStorage)`);
  console.log(`   - Folder management`);
  console.log(`   - Progress Map (without address lookup)`);
  console.log(`   - GPS location tracking`);
  console.log(`   - UI/UX testing`);
  console.log(`\nPress Ctrl+C to stop the server\n`);
});
