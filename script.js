// Initialize camera feed
const video = document.getElementById('camera');
const statusDiv = document.getElementById('status');
const tableBody = document.querySelector('#resultsTable tbody');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');

// Persistent scans storage
let scans = [];
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
      <td>${scan.storeName}</td>
      <td>${scan.unitNumber}</td>
      <td>${scan.openingHours}</td>
      <td>${scan.phone}</td>
      <td>${scan.website}</td>
      <td>${scan.lat}</td>
      <td>${scan.lng}</td>
      <td>${scan.businessType}</td>`;
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
  const headers = ['Store Name','Unit','Opening Hours','Phone','Website','Lat','Lng','Type'];
  const csvRows = [headers.join(',')];
  scans.forEach(s => {
    const row = [s.storeName, s.unitNumber, s.openingHours, s.phone, s.website, s.lat, s.lng, s.businessType]
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

  // (Optional) Image preprocessing has been disabled as aggressive thresholding
  // reduced accuracy on some signs. Keeping original frame for OCR.

  // Run OCR with additional parameters for better accuracy
  const result = await Tesseract.recognize(canvas, 'eng', {
    logger: m => {
      if (m.progress !== undefined) {
        const percent = Math.floor(m.progress * 100);
        statusDiv.textContent = `Scanning… ${percent}%`;
        progressFill.style.width = percent + '%';
      }
    },
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:#&-.',
    tessedit_pageseg_mode: 6 // Assume a single uniform block of text
  });

  const { text, confidence, lines } = result.data;
  console.log('OCR confidence', confidence);

  statusDiv.textContent = 'Processing…';

  let geo = currentLocation;
  if (!geo.lat) {
    // attempt quick fetch
    geo = await getCurrentLocation();
  }
  const info = Object.assign({ lat: geo.lat || 'Not Found', lng: geo.lng || 'Not Found' }, extractInfo(text, lines));
  scans.push(info);
  saveScans();
  renderTable();
  statusDiv.textContent = '';
  progressBar.style.display = 'none';
});

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
    'restaurant|cafe|café|bakery|food': 'F&B',
    'salon|spa|hair|beauty|nail': 'Beauty',
    'clinic|medical|dental|pharmacy': 'Healthcare',
    'book|stationery|gift|toy': 'Retail',
    'gym|fitness|yoga': 'Fitness'
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
  if (!openingHours) openingHours = 'Not Found';
  if (!phone) phone = 'Not Found';
  if (!website) website = 'Not Found';

  return {
    storeName,
    unitNumber,
    openingHours,
    phone,
    website,
    businessType,
    rawText: text
  };
} 