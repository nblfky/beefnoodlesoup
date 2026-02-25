# bnsVision Project Structure

This document explains the organization and structure of the bnsVision project.

## 📁 Directory Structure

```
bnsV revamp/
├── index.html                 # Main application entry point
├── script.js                  # Main application JavaScript (7500+ lines)
├── styles.css                 # Main application styles
├── package.json               # Node.js dependencies
├── package-lock.json          # Dependency lock file
├── netlify.toml              # Netlify deployment configuration
├── README.md                  # Main project README
│
├── assets/                    # Static assets
│   └── images/               # Image files
│       ├── bns_logo.png      # Main application logo
│       └── grab_logo.png     # Grab logo
│
├── docs/                      # Documentation
│   ├── README.md             # This file - structure documentation
│   ├── DATA_RECOVERY_GUIDE.md    # Guide for recovering lost scan data
│   ├── IMAGE_MANAGEMENT_GUIDE.md  # Guide for managing images and Google Drive integration
│   ├── OAUTH_DELEGATION_SETUP.md  # OAuth delegation setup instructions
│   └── NETLIFY_SETUP.md      # Netlify deployment setup guide
│
├── tools/                     # Utility tools
│   ├── browse-indexeddb.html # Tool to browse IndexedDB photo storage
│   └── recover-scans.html    # Tool to recover lost scans from backups
│
├── features/                  # Feature modules
│   └── elo-tracker/          # ELO Score Tracker feature
│       ├── elo-tracker.js    # ELO tracker JavaScript
│       └── elo-tracker.css   # ELO tracker styles
│
├── basement-map/             # Basement map feature
│   ├── index.html            # Basement map HTML
│   ├── basement-map.js       # Basement map JavaScript
│   ├── basement-map.css      # Basement map styles
│   ├── images/               # Map images
│   └── *.geojson             # GeoJSON map data files
│
├── netlify/                   # Netlify serverless functions
│   └── functions/
│       ├── openai.js         # OpenAI API proxy function
│       └── sheets-sync.js    # Google Sheets sync function
│
└── node_modules/              # Node.js dependencies (gitignored)

```

## 📋 File Descriptions

### Core Application Files

- **index.html** - Main HTML file containing the application structure
- **script.js** - Main JavaScript file with all application logic (camera, OCR, data management, etc.)
- **styles.css** - Main stylesheet with all application styling

### Documentation (`docs/`)

- **DATA_RECOVERY_GUIDE.md** - Instructions for recovering lost scan data using the recovery tool
- **IMAGE_MANAGEMENT_GUIDE.md** - Comprehensive guide for image management, Google Drive integration, and Apps Script setup
- **OAUTH_DELEGATION_SETUP.md** - Setup instructions for OAuth delegation (alternative to service account)
- **NETLIFY_SETUP.md** - Guide for setting up Netlify deployment

### Utility Tools (`tools/`)

- **browse-indexeddb.html** - Standalone tool to browse and manage photos stored in IndexedDB
- **recover-scans.html** - Standalone tool to recover lost scans from localStorage backups

### Features (`features/`)

- **elo-tracker/** - ELO Score Tracker feature module (separate from main app)

### Other Directories

- **basement-map/** - Basement/car park mapping feature with GeoJSON data
- **netlify/** - Serverless functions for backend API calls
- **assets/** - Static assets like logos and images

## 🔧 Development Notes

### Path References

When referencing files in code, use these paths:

- **Assets**: `assets/images/filename.png`
- **Tools**: `tools/tool-name.html`
- **Features**: `features/feature-name/file.js`
- **Docs**: `docs/guide-name.md`

### Git Ignore

The `.gitignore` file excludes:
- `node_modules/` - Dependencies (should be installed via `npm install`)
- `.netlify/` - Local Netlify build files
- OS files (`.DS_Store`, `Thumbs.db`)
- IDE files (`.vscode/`, `.idea/`)
- Log files (`*.log`)
- Temporary files (`*.tmp`, `*.temp`)
- Test data (`Store Photos/`)

## 🚀 Getting Started

1. **Install Dependencies**: `npm install`
2. **Open Application**: Open `index.html` in a browser (requires HTTPS for camera access)
3. **Deploy**: Use Netlify CLI or connect to Netlify for deployment

## 📝 Notes

- The main `script.js` file is quite large (7500+ lines). Consider modularizing in the future.
- All documentation is in the `docs/` folder for easy access.
- Utility tools are standalone HTML files that can be opened directly.
- Features are organized in their own folders for better separation of concerns.
