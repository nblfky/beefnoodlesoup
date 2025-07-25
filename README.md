# Storefront Scanner Web App

This is a lightweight, purely client-side web page that uses your phone’s camera and in-browser OCR to scan storefronts and extract structured information such as:

* Store name
* Unit number
* Opening hours
* Phone number / website
* A heuristic business category guess.

It relies on the browser’s `getUserMedia` API to access the camera and [Tesseract.js](https://github.com/naptha/tesseract.js) (WebAssembly port of Tesseract-OCR) to read the text.

## How to run

1. **Download / clone** this folder onto any computer (or phone).
2. Open `index.html` in a modern mobile browser (Chrome, Safari, Edge, Firefox) that supports camera access.
   * If you host it somewhere (GitHub Pages, Netlify, etc.) make sure to use HTTPS – browsers only allow camera access on secure origins.
3. Grant camera permission when prompted.
4. Point your camera at the storefront sign and tap **Scan**.
5. The recognised text will be parsed and the extracted fields shown JSON-formatted beneath the button.

## Improving accuracy

* Lighting and focus matter – get as close as possible and avoid glare.
* The extraction heuristics in `script.js` are intentionally simple so they run offline. You can beef them up by:
  * Adding better regexes / additional patterns.
  * Sending the raw OCR text to an API such as OpenAI for parsing and classification (replace `extractInfo()` with an async fetch call).

## Browser support

* Works on most modern mobile browsers that support `getUserMedia` and WebAssembly.
* iOS 15+ Safari and Android Chrome 89+ have been tested.

---

Feel free to tweak UI, styles and parsing rules to suit your specific data-collection workflow. 

## New Features & Improvements (June 2025)

The page was upgraded from the original MVP with the following additions:

### 1. Modern UI
* Full-screen camera preview with floating **Scan** button.
* Grab-branded green accent ( `#00b14f` ) and official logo in the header.
* Responsive card containing results beneath the preview.

### 2. Structured results table
* Each scan appends a new row to a live table (store name, unit, hours, phone, website, latitude, longitude, type).
* Data is **persisted in `localStorage`** so it survives page reloads on the same device.

### 3. Toolbar actions
* **Export CSV** – downloads all rows in a standards-compliant CSV (UTF-8, quoted).  
* **Clear** – empties the table and storage (camera restarts automatically).

### 4. GPS capture
* On first load the browser asks for location permission.  
* If granted, latitude & longitude (6-decimal precision) are stored with each scan.  
* Graceful fallback: displays “Not Found” when unavailable.

### 5. Accuracy tweaks
* HD camera request (1920×1080) and smarter line-picking logic for store names.
* Character-whitelist & page-segmentation settings passed to Tesseract.
* Simple spell-correction layer (`didyoumean2` +  English dictionary).

### 6. Quality-of-life
* Progress bar during OCR.
* Strict regex extraction with “Not Found” placeholders.

---

#### Known Quirks
* Clearing the table triggers a browser confirm dialog that may pause the camera on some iOS versions. The script now calls `video.play()` immediately after to resume.
* Location permission must be HTTPS and user-approved; otherwise coordinates remain blank.

Feel free to fork and continue tailoring the heuristics, styles or export formats! 