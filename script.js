// Initialize camera feed
const video = document.getElementById('camera');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
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

  // Run OCR
  const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
    logger: m => {
      if (m.progress !== undefined) {
        statusDiv.textContent = `Scanning… ${Math.floor(m.progress * 100)}%`;
      }
    }
  });

  statusDiv.textContent = 'Processing…';

  const info = extractInfo(text);
  resultsDiv.textContent = JSON.stringify(info, null, 2);
  statusDiv.textContent = '';
});

// Extract structured information from raw OCR text
function extractInfo(rawText) {
  // Normalise whitespace
  const text = rawText.replace(/\n+/g, '\n').trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Simple heuristics — these can be improved!
  const storeName = lines[0] || '';
  const unitNumber = lines.find(l => /#?\d{1,3}-\d{1,4}/.test(l)) || '';

  const phoneMatch = text.match(/(\+?\d[\d\s\-]{6,}\d)/);
  const phone = phoneMatch ? phoneMatch[0] : '';

  const websiteMatch = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  const website = websiteMatch ? websiteMatch[0] : '';

  // Look for opening hours (very naive)
  const openingHoursLine = lines.find(l => /(mon|tue|wed|thu|fri|sat|sun|am|pm)/i.test(l)) || '';

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

  return {
    storeName,
    unitNumber,
    openingHours: openingHoursLine,
    phone,
    website,
    businessType,
    rawText: text
  };
} 