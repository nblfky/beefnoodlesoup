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