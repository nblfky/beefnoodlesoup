// Initialize camera feed
const video = document.getElementById('camera');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');

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
  resultsDiv.textContent = '';

  // Capture current frame
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Simple contrast enhancement to aid OCR
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const dataArr = imageData.data;
  for (let i = 0; i < dataArr.length; i += 4) {
    // convert to grayscale
    const avg = (dataArr[i] + dataArr[i + 1] + dataArr[i + 2]) / 3;
    const contrasted = avg > 128 ? 255 : 0; // simple threshold
    dataArr[i] = dataArr[i + 1] = dataArr[i + 2] = contrasted;
  }
  ctx.putImageData(imageData, 0, 0);

  // Run OCR with additional parameters for better accuracy
  const result = await Tesseract.recognize(canvas, 'eng', {
    logger: m => {
      if (m.progress !== undefined) {
        statusDiv.textContent = `Scanning… ${Math.floor(m.progress * 100)}%`;
      }
    },
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:#&-.',
    tessedit_pageseg_mode: 6 // Assume a single uniform block of text
  });

  const { text, confidence, lines } = result.data;
  console.log('OCR confidence', confidence);

  statusDiv.textContent = 'Processing…';

  const info = extractInfo(text, lines);
  resultsDiv.textContent = JSON.stringify(info, null, 2);
  statusDiv.textContent = '';
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
    // 1) Highest text line (by bbox height -> font size)
    let maxHeight = 0;
    ocrLines.forEach(l => {
      const h = l.bbox ? (l.bbox.y1 - l.bbox.y0) : 0;
      if (h > maxHeight) {
        maxHeight = h;
        storeName = l.text.trim();
      }
    });
  }

  // 2) Fallback: first line that is mostly uppercase (likely a sign like "SCAN ME")
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