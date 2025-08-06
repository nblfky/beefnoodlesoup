// Initialize camera feed
import OpenAI from 'https://esm.sh/openai?bundle';

// --- OpenAI Vision setup ---
let openaiClient = null;
function getOpenAIClient() {
  if (!openaiApiKey) return null;
  if (openaiClient) return openaiClient;
  openaiClient = new OpenAI({ apiKey: openaiApiKey, dangerouslyAllowBrowser: true });
  return openaiClient;
}

// Analyse an image with GPT-4o Vision style prompt. Accepts a question and a data-URL or remote image URL.
async function askImageQuestion(question, imageUrl) {
  const client = getOpenAIClient();
  if (!client) return null;
  try {
    const resp = await client.responses.create({
      model: 'gpt-4o',
      input: [
        { role: 'user', content: question },
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: imageUrl }
          ]
        }
      ]
    });
    return resp.output_text || '';
  } catch (err) {
    console.warn('OpenAI Vision request failed', err);
    return null;
  }
}

// Extract structured JSON directly from an image using GPT-4o Vision
async function extractInfoVision(imageUrl) {
  const client = getOpenAIClient();
  if (!client) return null;
  try {
    const resp = await client.responses.create({
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content:
            'Extract JSON with keys: storeName, unitNumber, address, businessType. For businessType, choose one of: art, attractions, auto, beauty services, commercial building, education, essentials, financial, food and beverage, general merchandise, government building, healthcare, home services, hotel, industrial, local services, mass media, nightlife, physical feature, professional services, religious organization, residential, sports and fitness, travel. Use "Not Found" if unknown.'
        },
        {
          role: 'user',
          content: [{ type: 'input_image', image_url: imageUrl }]
        }
      ]
    });
    const txt = resp.output_text || '';
    const match = txt.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (err) {
    console.warn('Vision JSON extraction failed', err);
    return null;
  }
}
const video = document.getElementById('camera');
const statusDiv = document.getElementById('status');
const tableBody = document.querySelector('#resultsTable tbody');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
// --- NEW: Image upload elements ---
const uploadBtn = document.getElementById('uploadBtn');
const imageInput = document.getElementById('imageInput');

// Persistent scans storage
let scans = [];
// Note: openaiApiKey is defined later, but we need it before using getOpenAIClient().
// We will forward-declare it here and assign when loaded below.
let openaiApiKey;
openaiApiKey = localStorage.getItem('openaiApiKey') || '';
try {
  scans = JSON.parse(localStorage.getItem('scans') || '[]');
} catch (_) { scans = []; }

renderTable();

function saveScans() {
  localStorage.setItem('scans', JSON.stringify(scans));
}

function renderTable() {
  if (!tableBody) return;
  tableBody.innerHTML = '';

  scans.forEach((scan, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${scan.storeName || 'Not Found'}</td>
      <td>${scan.unitNumber || 'Not Found'}</td>
      <td>${scan.address ?? 'Not Found'}</td>
      <td>${scan.lat ?? 'Not Found'}</td>
      <td>${scan.lng ?? 'Not Found'}</td>
      <td>${scan.businessType || 'Not Found'}</td>
      <td style="text-align:center;">
        <button class="row-remark" aria-label="Add or view remark">📝</button>
      </td>
      <td style="display:flex; gap:6px; justify-content:center;">
        <button class="row-edit" aria-label="Edit row">✎</button>
        <button class="row-delete" aria-label="Delete row">🗑︎</button>
      </td>`;

        // attach remark handler
    tr.querySelector('.row-remark').addEventListener('click', () => {
      const s = scans[idx];
      const r = prompt('Remark:', s.remark || '');
      if (r !== null) {
        s.remark = r;
        saveScans();
        renderTable();
      }
    });

    // attach edit handler
    tr.querySelector('.row-edit').addEventListener('click', () => {
      const s = scans[idx];
      s.storeName = prompt('Store name:', s.storeName) ?? s.storeName;
      s.unitNumber = prompt('Unit number:', s.unitNumber) ?? s.unitNumber;
      s.address = prompt('Address:', s.address) ?? s.address;
      const lat = prompt('Latitude:', s.lat);
      const lng = prompt('Longitude:', s.lng);
      if (lat !== null && lng !== null) {
        s.lat = lat;
        s.lng = lng;
      }
      s.businessType = prompt('Category:', s.businessType) ?? s.businessType;
      saveScans();
      renderTable();
    });

    // attach delete handler
    tr.querySelector('.row-delete').addEventListener('click', () => {
      scans.splice(idx, 1);
      saveScans();
      renderTable();
    });

    tableBody.appendChild(tr);
  });
}

// After renderTable definition add event listeners
// --- Toolbar actions ---
document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('Clear all saved scans?')) {
    scans = [];
    saveScans();
    renderTable();
    if (video && video.srcObject) {
      video.play().catch(()=>{});
    }
  }
});

document.getElementById('exportBtn').addEventListener('click', () => {
  if (!scans.length) {
    alert('No data to export');
    return;
  }
  const headers = ['Store Name','Unit','Address','Lat','Lng','Category','Remarks'];
  const csvRows = [headers.join(',')];
  scans.forEach(s => {
    const row = [s.storeName, s.unitNumber, s.address, s.lat, s.lng, s.businessType, s.remark || '']
      .map(v => '"' + (v || '').replace(/"/g,'""') + '"').join(',');
    csvRows.push(row);
  });
  const blob = new Blob([csvRows.join('\n')], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'storefront_scans.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
});

// ---------- Geolocation ----------
let currentLocation = { lat: '', lng: '' };

async function initLocation() {
  statusDiv.textContent = 'Requesting location…';
  currentLocation = await getCurrentLocation(true);
  if (!currentLocation.lat) {
    statusDiv.textContent = 'Location unavailable – scans will show N/A';
  } else {
    statusDiv.textContent = '';
  }
}

// call immediately
initLocation();

function getCurrentLocation(initial = false) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ lat: '', lng: '' });

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        resolve({ lat: latitude.toFixed(6), lng: longitude.toFixed(6) });
      },
      err => {
        if (!initial) console.warn('Geolocation error', err.message);
        resolve({ lat: '', lng: '' });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

// --- OneMap (Singapore) reverse-geocoding helper ---
// Note: OneMap’s JSON schema has changed over time. Newer responses
// use a `results` array with camel-/snake-case keys (e.g. `BLK_NO`,
// `ROAD_NAME`, `POSTAL`). The original version of this file only
// handled the older `GeocodeInfo` shape, which is why it silently
// returned "" and the UI showed "Not Found".
//
// This implementation now:
// 1. Accepts either `GeocodeInfo` or `results`.
// 2. Normalises the field names so we can build a readable address
//    without having to worry about the exact schema version.
// 3. Falls back to the `ADDRESS` field when it is already formatted.
async function reverseGeocode(lat, lng) {
  try {
    // Newer API version expects separate lat & lon query params (see https://docs.onemap.sg/#revgeocode)
    const url = `https://developers.onemap.sg/commonapi/revgeocode?lat=${lat}&lon=${lng}&returnGeom=N&getAddrDetails=Y`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Handle both possible response shapes
    const result = (data.GeocodeInfo || data.results || data.ReverseGeocodeInfo)?.[0];
    if (!result) return '';

    // Normalise keys so we can treat both schemas uniformly
    const blk   = result.BLOCK      || result.BLK_NO      || result.block      || result.blk_no;
    const road  = result.ROAD       || result.ROAD_NAME   || result.road       || result.road_name;
    const bldg  = result.BUILDING   || result.BUILDINGNAME|| result.building   || result.buildingname;
    const postal= result.POSTAL     || result.POSTALCODE  || result.postal     || result.postalcode;
    const addr  = result.ADDRESS    || result.address;

    // Prefer a pre-formatted ADDRESS string if provided
    if (addr) return addr.trim();

    // Otherwise stitch together what we have
    const parts = [blk, road, bldg, 'SINGAPORE', postal].filter(Boolean);
    return parts.join(' ').trim();
  } catch (err) {
    console.warn('Reverse geocode failed', err);
    return '';
  }
}
// ----------- Dictionary + spell-correction setup -----------
let englishWords = [];
async function loadDictionary() {
  try {
    const res = await fetch('https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt');
    const text = await res.text();
    englishWords = text.split('\n');
    console.log(`Dictionary loaded: ${englishWords.length} words`);
  } catch (err) {
    console.warn('Failed to load dictionary – spell correction disabled', err);
  }
}

loadDictionary();
// --- ChatGPT integration ---

function setOpenAIApiKey(key) {
  openaiApiKey = key;
  openaiClient = null; // reset so fresh client picks up new key
  if (key) {
    localStorage.setItem('openaiApiKey', key);
  } else {
    localStorage.removeItem('openaiApiKey');
  }
}

async function extractInfoGPT(rawText) {
  if (!openaiApiKey) return null;
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + openaiApiKey
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        temperature: 0,
        messages: [
          { role: 'system', content: 'You extract structured data from storefront OCR.' },
          { role: 'user', content: `Extract JSON with keys: storeName, unitNumber, address, businessType. For businessType, choose one of: art, attractions, auto, beauty services, commercial building, education, essentials, financial, food and beverage, general merchandise, government building, healthcare, home services, hotel, industrial, local services, mass media, nightlife, physical feature, professional services, religious organization, residential, sports and fitness, travel. Use "Not Found" if unknown. OCR: """${rawText}"""` }
        ]
      })
    });
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    console.warn('ChatGPT parsing failed', err);
    return null;
  }
}

// Prompt user to set API key if not already stored
if (!openaiApiKey) {
  setTimeout(() => {
    if (confirm('Enter your OpenAI API key to enable ChatGPT parsing?')) {
      const key = prompt('OpenAI API key (sk-...)');
      if (key) setOpenAIApiKey(key.trim());
    }
  }, 500);
}

function correctStoreName(name) {
  if (!name || !englishWords.length || typeof didYouMean !== 'function') return name;

  // Break by whitespace / punctuation while preserving words
  const tokens = name.split(/(\s+)/); // keep spaces as tokens
  const corrected = tokens.map(tok => {
    if (/^\s+$/.test(tok)) return tok; // keep spaces
    const suggestion = didYouMean(tok.toLowerCase(), englishWords, { threshold: 0.4 });
    return suggestion ? capitalize(suggestion) : tok;
  });
  return corrected.join('');
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    video.srcObject = stream;
  } catch (err) {
    console.error(err);
    statusDiv.textContent = 'Camera access denied: ' + err.message;
  }
}

initCamera();

// --- Helper: run OCR + processing on any canvas source (camera or uploaded) ---
async function performScanFromCanvas(canvas) {
  statusDiv.textContent = 'Scanning…';
  progressBar.style.display = 'block';
  progressFill.style.width = '0%';

  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);

  // Try Vision JSON extraction first
  let parsed = null;
  if (openaiApiKey) {
    statusDiv.textContent = 'Scanning…';
    parsed = await extractInfoVision(imageDataUrl);
    if (parsed) {
      console.log('Vision JSON:', parsed);
    }
  }

  let geo = currentLocation;
  if (!geo.lat) {
    geo = await getCurrentLocation();
  }

  if (!parsed) {
    // Vision failed → run OCR fallback
    const result = await Tesseract.recognize(canvas, 'eng', {
      logger: m => {
        if (m.progress !== undefined) {
          const percent = Math.floor(m.progress * 100);
          statusDiv.textContent = `Scanning… ${percent}%`;
          progressFill.style.width = percent + '%';
        }
      },
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:#&-.',
      tessedit_pageseg_mode: 6
    });

    const { text, confidence, lines } = result.data;
    console.log('OCR confidence', confidence);

    statusDiv.textContent = 'Processing…';

    parsed = await extractInfoGPT(text);
    if (!parsed) parsed = extractInfo(text, lines);
  }

  // Map extracted business type to canonical category (applies to Vision or OCR)
  if (parsed && parsed.businessType) {
    parsed.businessType = await mapToCompanyCategory(parsed.businessType);
  }

  let address = '';
  if (geo.lat && geo.lng) {
    address = await reverseGeocode(geo.lat, geo.lng);
  }
  if (address) {
    parsed.address = address;
  } else if (!parsed.address) {
    parsed.address = 'Not Found';
  }

  const info = Object.assign(
    { lat: geo.lat || 'Not Found', lng: geo.lng || 'Not Found' },
    parsed
  );
  scans.push(info);
  saveScans();
  renderTable();
  statusDiv.textContent = info.storeName && info.storeName !== 'Not Found'
    ? 'Scanning is successful'
    : 'Scanning failed, please try again';
  progressBar.style.display = 'none';
}

// Scan button handler
document.getElementById('scanBtn').addEventListener('click', async () => {
  if (!video.videoWidth) {
    statusDiv.textContent = 'Camera not ready yet, please wait…';
    return;
  }

  statusDiv.textContent = 'Scanning…';
  progressBar.style.display = 'block';
  progressFill.style.width = '0%';

  // Capture current frame
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  await performScanFromCanvas(canvas);
});

// Upload image handler
if (uploadBtn && imageInput) {
  uploadBtn.addEventListener('click', () => imageInput.click());

  imageInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      await performScanFromCanvas(canvas);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    imageInput.value = '';
  });
}

// Extract structured information from raw OCR text
function extractInfo(rawText, ocrLines = []) {
  // Normalise whitespace
  const text = rawText.replace(/\n+/g, '\n').trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ----- Patterns based on rules provided -----
  // Pick store name using multiple heuristics
  let storeName = '';
  if (ocrLines.length) {
    // Step 1: Filter lines with mostly letters (reduce gibberish)
    const letterLines = ocrLines.filter(l => {
      const txt = l.text.trim();
      const letters = txt.replace(/[^A-Za-z]/g, '');
      const ratio = letters.length / (txt.length || 1);
      return letters.length >= 3 && ratio > 0.6; // at least 60% letters
    });

    // Step 2: Choose line with highest confidence ( then longest length )
    letterLines.sort((a, b) => (b.confidence || b.conf || 0) - (a.confidence || a.conf || 0));
    if (letterLines.length) {
      storeName = letterLines[0].text.trim();
    }
  }

  // 2) Fallback: first line that is mostly uppercase (e.g., "SCAN ME")
  if (!storeName) {
    const upperCandidate = lines.find(l => {
      const letters = l.replace(/[^A-Za-z]/g, '');
      return letters.length >= 3 && letters === letters.toUpperCase();
    });
    if (upperCandidate) storeName = upperCandidate;
  }

  // 3) Ultimate fallback: first line
  if (!storeName) storeName = lines[0] || '';

  storeName = correctStoreName(storeName);

  // Unit number must be in the form #XX-XXX
  const unitMatch = text.match(/#\d{2}-\d{3}/);
  let unitNumber = unitMatch ? unitMatch[0] : '';

  // Singapore phone number: 65 XXXX XXXX, with optional '+' and optional spaces
  const phoneMatch = text.match(/\+?65\s?\d{4}\s?\d{4}/);
  let phone = phoneMatch ? phoneMatch[0] : '';
  if (phone) {
    phone = phone.replace(/\s+/g, ' '); // normalise spacing
  }

  // Website: detect domain like example.com (with or without protocol)
  const websiteMatch = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  let website = websiteMatch ? websiteMatch[0].replace(/^[^A-Za-z]+/, '') : '';

  // Opening hours: XX:XX - XX:XX (24-hour) with optional spaces
  const openingHoursMatch = text.match(/(?:[01]?\d|2[0-3]):[0-5]\d\s*[-–]\s*(?:[01]?\d|2[0-3]):[0-5]\d/);
  let openingHours = openingHoursMatch ? openingHoursMatch[0].replace(/\s+/g, ' ') : '';

  // Guess business category based on keywords
  const categories = {
    'restaurant|restaurants|cafe|café|bakery|eatery|food|diner': 'food and beverage',
    'salon|spa|hair|beauty|nail': 'beauty services',
    'clinic|medical|dental|pharmacy|hospital': 'healthcare',
    'book|stationery|gift|toy|retail|shop': 'general merchandise',
    'gym|fitness|yoga|sport': 'sports and fitness',
    'school|college|university|academy|learning': 'education',
    'bank|atm|finance|financial': 'financial',
    'hotel|motel|inn|resort': 'hotel',
    'bar|pub|club|nightlife': 'nightlife',
    'car|auto|automotive|vehicle|garage': 'auto'
  };

  let businessType = 'Unknown';
  for (const pattern in categories) {
    if (new RegExp(pattern, 'i').test(text)) {
      businessType = categories[pattern];
      break;
    }
  }

  // Use "Not Found" when a field could not be extracted to match strict rules
  if (!storeName) storeName = 'Not Found';
  if (!unitNumber) unitNumber = 'Not Found';
  if (!openingHours) openingHours = 'Not Found'; // kept for future reference
  if (!phone) phone = 'Not Found';              // kept for future reference
  if (!website) website = 'Not Found';          // kept for future reference

  // Placeholder – address extraction will be implemented later or via geocoding
  let address = '';

  if (!address) address = 'Not Found';

  return {
    storeName,
    unitNumber,
    address,
    businessType,
    rawText: text
  };
}

// --- Company category mapping ---
let companyCategories = [];

async function loadCompanyCategories() {
  if (companyCategories.length) return companyCategories;
  try {
    // First try pre-generated JSON (faster)
    const jsonRes = await fetch('categories.json');
    if (jsonRes.ok) {
      companyCategories = (await jsonRes.json()).map(cat => ({
        key: cat.key,
        name: (cat.name || '').toLowerCase(),
        last: (cat.key.split('::').filter(Boolean).pop() || '').toLowerCase()
      }));
      console.log(`Loaded ${companyCategories.length} categories from JSON`);
      return companyCategories;
    }
  } catch (_) {
    /* fallthrough to CSV */
  }

  try {
    // Fallback to CSV shipped alongside the app if JSON unavailable
    const csvPath = encodeURI('Geo Places - Final POI Category Tree - Q2 2024 - 2. Category Tree.csv');
    const res = await fetch(csvPath);
    const csvText = await res.text();
    const lines = csvText.split(/\r?\n/);
    lines.shift(); // drop header
    const splitter = /,(?=(?:[^"]*\"[^"]*\")*[^\"]*$)/;
    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = line.split(splitter);
      const name = (cols[3] || '').replace(/^"|"$/g, '').trim();
      const keyRaw = (cols[5] || '').replace(/^"|"$/g, '').trim();
      if (!keyRaw) continue;
      const key = keyRaw.replace(/:+$/, '');
      const lastSegment = key.split('::').filter(Boolean).pop() || '';
      companyCategories.push({ key, name: name.toLowerCase(), last: lastSegment.toLowerCase() });
    }
    console.log(`Parsed ${companyCategories.length} categories from CSV`);
  } catch (err) {
    console.warn('Failed to load categories from CSV', err);
  }
  return companyCategories;
}

async function mapToCompanyCategory(freeText = '') {
  if (!freeText || freeText === 'Unknown' || freeText === 'Not Found') return freeText;
  const txt = freeText.toLowerCase().trim();
  // If value already matches one of our high-level categories, return as-is
  const allowed = ['art','attractions','auto','beauty services','commercial building','education','essentials','financial','food and beverage','general merchandise','government building','healthcare','home services','hotel','industrial','local services','mass media','nightlife','physical feature','professional services','religious organization','residential','sports and fitness','travel'];
  if (allowed.includes(txt)) return allowed.find(cat => cat === txt);
  await loadCompanyCategories();
  if (!companyCategories.length) return freeText;

  // Exact match against name or last segment
  let match = companyCategories.find(cat => cat.name === txt || cat.last === txt);
  if (match) return match.key;

  // Sub-string containment
  match = companyCategories.find(cat => txt.includes(cat.name) || cat.name.includes(txt) || txt.includes(cat.last));
  return match ? match.key : freeText;
} 