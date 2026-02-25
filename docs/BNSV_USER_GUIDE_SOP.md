# bnsV User Guide & Standard Operating Procedures

**Version:** 2.4.2  
**Last Updated:** 2025  
**Document Purpose:** Comprehensive guide for new and existing users of the bnsV mobile scanning application

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Getting Started](#2-getting-started)
3. [Understanding Project Types](#3-understanding-project-types)
4. [Creating Projects](#4-creating-projects)
5. [Scanning Process](#5-scanning-process)
6. [Bulk Upload Features](#6-bulk-upload-features)
7. [Data Management](#7-data-management)
8. [Multi-Country Support](#8-multi-country-support)
9. [Advanced Features](#9-advanced-features)
10. [Troubleshooting](#10-troubleshooting)
11. [Best Practices](#11-best-practices)

---

## 1. Introduction

### 1.1 What is bnsV?

bnsV is a mobile-first application designed for on-ground data collection and scanning. It uses AI-powered vision recognition to extract information from photos of storefronts, buildings, and locations. The app automatically syncs data to Google Sheets and supports multi-country operations.

### 1.2 Key Features

- **AI-Powered Scanning:** Automatically extracts store names, addresses, contact information, and more from photos
- **Real-Time GPS Tracking:** Captures location coordinates for each scan
- **Google Sheets Integration:** Automatic synchronization to Google Sheets for data analysis
- **Multi-Country Support:** Configure projects for different countries with country-specific Google Sheets
- **Bulk Upload:** Process multiple photos at once with automatic GPS extraction from photo metadata
- **Project Management:** Organize scans into projects with folders and custom settings
- **Offline Capable:** Works offline and syncs when connection is restored

### 1.3 System Requirements

- **Browser:** Modern mobile browser (Chrome, Safari, Firefox) with camera access
- **Device:** Smartphone or tablet with camera
- **Permissions:** Camera and location permissions required
- **Internet:** Required for AI processing and Google Sheets sync (works offline for scanning)

---

## 2. Getting Started

### 2.1 First-Time Setup

1. **Open the Application**
   - Navigate to the bnsV application URL on your mobile device
   - The app will load automatically

2. **Grant Permissions**
   - **Camera Permission:** Required for taking photos
   - **Location Permission:** Required for GPS coordinates
   - Allow permissions when prompted by your browser

3. **Home Screen Overview**
   - **Create New Project:** Start a new scanning project
   - **See All Projects:** View and manage existing projects
   - **Continue Project:** Resume your active project
   - **Send Feedback:** Submit feedback or report issues
   - **Visionary - Singapore:** Access specialized mapping tools

### 2.2 Navigation Basics

- **Back Button (⟵):** Returns to the previous screen
- **Home Button:** Returns to the main home screen
- **Project Menu:** Access project-specific features (Scan, Data, Bulk Upload, Progress Map, Settings)

---

## 3. Understanding Project Types

### 3.1 Onground Benchmarking (Default)

**Purpose:** Standard commercial and residential scanning projects

**When to Use:**
- Scanning storefronts in malls or commercial areas
- Collecting residential property data
- Standard data collection with address details

**Features:**
- AI extraction of store names, addresses, contact info
- Automatic address parsing
- Category detection (Commercial/Residential)
- Google Sheets synchronization

### 3.2 Map Your City Lite

**Purpose:** Simplified city mapping and data collection

**When to Use:**
- Quick data collection without detailed project settings
- Mapping POIs (Points of Interest)
- Collecting motorist or public transport data

**Features:**
- No project settings required
- Simplified scan type selection
- Dedicated data type categories

---

## 4. Creating Projects

### 4.1 Project Type Selection

After clicking "Create New Project," you'll see two options:

1. **Onground Benchmarking** (Default)
   - Full-featured project with customizable settings
   - Supports Commercial and Residential categories

2. **Map Your City Lite**
   - Simplified project creation
   - No settings required

### 4.2 Onground Benchmarking Projects

#### Step 1: Choose Project Setup Method

You'll see four options:

**A. Create a New Tab** ⭐ Recommended for Multi-Country
- **Best for:** Custom locations, multi-country projects, new locations
- **Features:**
  - Country selection (Singapore, Thailand, Malaysia, etc.)
  - Custom tab name (syncs to Google Sheets)
  - Category selection (Commercial/Residential)
  - Default address fields

**B. Select from Existing Building - Singapore**
- **Best for:** Pre-configured Singapore locations
- **Features:**
  - Pre-filled address details
  - Quick setup for known locations
  - Auto-populated building information

**C. Scan with OneMap - Singapore**
- **Best for:** Searching for condos, hotels, schools, other buildings
- **Features:**
  - OneMap integration for building search
  - Automatic address lookup
  - Real-time location search

**D. Bulk Upload - WIP**
- **Best for:** Uploading multiple pre-taken photos
- **Features:**
  - Standalone bulk upload (not tied to a project)
  - Custom settings per upload session
  - EXIF GPS extraction from photos

#### Step 2: Configure Project Settings

**For "Create a New Tab":**

1. **Country Selection**
   - Select country from dropdown
   - Available: Singapore, Thailand, Malaysia, Indonesia, Vietnam, Philippines, Cambodia, Myanmar
   - **Note:** Each country syncs to its own Google Sheet

2. **Tab Name**
   - Enter or select from existing tabs
   - This becomes the Google Sheets tab name
   - Autocomplete shows existing tabs

3. **Category**
   - **Commercial** (Default): For stores, shops, commercial spaces
   - **Residential**: For houses, residential properties
   - Toggle between categories as needed

4. **Project Details**
   - **Date:** Auto-filled with today's date (Singapore timezone)
   - **Email:** Enter email address (saved for future use)
     - Previously used emails appear as suggestions
     - Email is saved automatically

5. **Environment**
   - **Indoor:** For indoor locations (malls, buildings)
   - **Outdoor:** For outdoor locations (streets, open areas)

6. **Commercial Details** (if Commercial selected)
   - **Floor:** Select or type floor level (B4 to L20)
   - **House No., Street, Building, Postcode:** Optional fields for default address

7. **Residential Details** (if Residential selected)
   - **Street Name:** Required field
   - **Building:** Optional estate/building name
   - **Postcode:** Optional

8. **Sync Settings**
   - **Sync to Google Sheets:** Toggle ON/OFF
   - Shows preview of tab name

**For "Select from Existing Building":**

1. **Date:** Select project date
2. **Email:** Select from dropdown or enter manually
3. **Location:** Select from pre-configured locations
4. **Environment:** Indoor/Outdoor
5. **Default Address:** Pre-filled based on location selection
6. **Sync Settings:** Enable/disable Google Sheets sync

#### Step 3: Create Project

- Click "Create Project →"
- Project is created and activated
- You'll be taken to the Project Menu

---

## 5. Scanning Process

### 5.1 Starting a Scan

1. **Open Project Menu**
   - From home screen, select your active project
   - Or click "Continue Project" if you have an active project

2. **Access Scanner**
   - Click **"Scan"** button in Project Menu
   - Camera view will open

3. **Take Photo**
   - Position camera to capture storefront/building clearly
   - Ensure good lighting
   - Tap the **Scan** button to capture

4. **AI Processing**
   - App analyzes photo using AI
   - Extracts: Store name, address, phone, website, opening hours
   - Shows progress indicator

5. **Review Results**
   - Check extracted information
   - Data is automatically saved
   - GPS coordinates are captured automatically

### 5.2 Scan Results

Each scan includes:
- **Store Name:** Extracted from photo
- **Address:** Parsed into components (House No., Street, Building, Postcode)
- **Unit Number:** Shop/unit number if visible
- **Floor:** Floor level
- **Category:** Detected category type
- **Contact Info:** Phone number, website
- **Opening Hours:** Extracted hours if visible
- **GPS Coordinates:** Latitude and longitude
- **Photo:** Stored with scan entry

### 5.3 Viewing Scanned Data

1. **From Project Menu:**
   - Click **"Data"** button
   - View all scans in table format
   - Filter and search functionality available

2. **Data Table Features:**
   - Sort by date/time
   - Search by store name
   - View individual scan details
   - Download photos
   - Delete entries

---

## 6. Bulk Upload Features

### 6.1 Project-Based Bulk Upload

**Access:** From Project Menu → **"Bulk Upload"** button

**Process:**
1. Click "Bulk Upload" button
2. Select multiple photos from your device
3. Photos are processed automatically
4. Each photo uses its **original GPS coordinates** from EXIF metadata
5. If no GPS in photo, uses current location as fallback
6. Results appear in batch table
7. Sync to Google Sheets automatically

**Best Practices:**
- Ensure photos have GPS metadata (enable location services when taking photos)
- Process photos in batches of 10-20 for best performance
- Check batch table for any failed uploads

### 6.2 Standalone Bulk Upload (Isolated)

**Access:** Project Type Screen → **"Bulk Upload - WIP"**

**Use Case:** Upload photos without creating a project first

**Process:**
1. Select "Bulk Upload - WIP"
2. Configure settings:
   - **Google Sheets Tab:** Select existing or create new
   - **Email:** Enter email address
   - **Date:** Select date
   - **Type:** Residential or Commercial
   - **Environment:** Indoor/Outdoor
   - **Street:** Required for Residential type
3. Select photos from device
4. Click "Process & Upload"
5. Photos are processed with AI
6. Data syncs to specified Google Sheets tab

**GPS Handling:**
- **Residential:** Uses project street + extracted house number
- **Commercial:** Extracts GPS from photo EXIF metadata
- Falls back to current location if no EXIF GPS available

### 6.3 GPS Extraction from Photos

**How It Works:**
- App reads GPS coordinates from photo EXIF metadata
- If photo was taken with location services enabled, original location is used
- If no GPS in photo, uses current upload location
- Each photo can have different coordinates

**To Ensure GPS in Photos:**
- Enable location services on your device
- Allow camera app to access location
- Take photos with location services enabled
- GPS coordinates are embedded in photo metadata

---

## 7. Data Management

### 7.1 Viewing All Projects

**Access:** Home Screen → **"See All Projects"**

**Features:**
- List of all projects
- Project name format: "Location, Floor, Date, Country"
- Active project indicator
- Filter by folder
- Search functionality

### 7.2 Project Organization

**Folders:**
- Create folders to organize projects
- Move projects to folders
- Filter projects by folder
- Projects in folders don't appear in "All" view

**Creating Folders:**
1. Go to "See All Projects"
2. Click folder icon
3. Enter folder name
4. Click "Add Folder"

**Moving Projects:**
1. Select project(s) using selection mode
2. Click "Move to Folder"
3. Choose destination folder

### 7.3 Project Settings

**Access:** Project Menu → **"⚙️ Project Settings"**

**Editable Settings:**
- Date
- Email
- Environment (Indoor/Outdoor)
- Default Address (Floor, Building, etc.)
- Sync to Google Sheets toggle

**Note:** Location and Sheet Tab cannot be changed after project creation

### 7.4 Exporting Data

**From Data View:**
- View all scans in table
- Data automatically syncs to Google Sheets
- Access Google Sheets for advanced analysis

**From Project Menu:**
- All scans are visible in Data view
- Can download individual photos
- Bulk download available

---

## 8. Multi-Country Support

### 8.1 Country Selection

**Available Countries:**
- Singapore (default)
- Thailand
- Malaysia
- Indonesia
- Vietnam
- Philippines
- Cambodia
- Myanmar

### 8.2 Setting Up Multi-Country Projects

**Step-by-Step:**
1. Create New Project → Onground Benchmarking
2. Select "Create a new tab"
3. **Select Country** from dropdown
4. Enter Tab Name
5. Configure other settings
6. Create project

**Country-Specific Sheets:**
- **Singapore:** Uses default Google Sheet (from environment)
- **Thailand:** Uses dedicated sheet (ID: 1eyXm4DUNxmvK5ngutQJKq1QsKdSxiCYGSwGuZ-zdwjw)
- **Other Countries:** Placeholder (will be configured as needed)

### 8.3 Project Display

Projects show country information:
- **Project Name:** Includes country (e.g., "Mall A, L1, 01-02-2025, Thailand")
- **Project Info:** Country field displayed in project menu
- **Home Screen:** Shows country in project info

### 8.4 Data Synchronization

- Each country syncs to its own Google Sheet
- Data is isolated by country
- No cross-country data mixing
- Country-specific sheet IDs configured automatically

---

## 9. Advanced Features

### 9.1 Progress Map

**Access:** Project Menu → **"Progress Map"**

**Features:**
- Visual map of all scan locations
- Color-coded markers
- Click markers to view scan details
- Live GPS tracking option
- Shows completion status

**Live GPS Tracking:**
- Enable/disable live location pin
- Shows current location on map
- Displays address information
- Auto-zoom to location

### 9.2 Email Persistence

**How It Works:**
- Email addresses are saved automatically
- Last 20 emails are stored
- Appears as autocomplete suggestions
- Works across all projects

**Managing Emails:**
- Simply type email address
- Previously used emails appear in dropdown
- No manual management needed

### 9.3 Recovery Tool

**Access:** Home Screen → **"🔧 Recovery Tool"**

**Purpose:** Recover lost scans or projects

**Features:**
- Analyze localStorage for scan data
- Recreate projects from scan data
- Assign scans to projects
- Export recovery data

**When to Use:**
- Projects disappeared unexpectedly
- Scans not showing in project
- Data loss on device
- Android localStorage issues

### 9.4 Image Database

**Access:** Home Screen → **"📸 Image Database"**

**Features:**
- Browse all stored photos
- Sort by date (Latest First / Oldest First)
- View full-resolution images
- Download individual photos
- Search by photo ID

### 9.5 Visionary Tools

**Access:** Home Screen → **"Visionary - Singapore"**

**Features:**
- Basement Carpark LiDAR Map
- GeoJSON polygon visualization
- Site management
- Map-based data viewing

---

## 10. Troubleshooting

### 10.1 Common Issues

**Issue: Camera Not Working**
- **Solution:** Grant camera permission in browser settings
- Check browser supports camera access
- Try refreshing the page

**Issue: Location Not Captured**
- **Solution:** Enable location services on device
- Grant location permission to browser
- Check GPS is enabled on device
- Location may show as empty if permission denied

**Issue: Photos Not Syncing to Google Sheets**
- **Solution:** Check "Sync to Google Sheets" is enabled in project settings
- Verify internet connection
- Check project has valid tab name
- Review sync status in Data view

**Issue: Projects Disappeared**
- **Solution:** Use Recovery Tool to restore projects
- Check "See All Projects" screen
- Projects may be in a folder
- Clear browser cache may cause data loss

**Issue: Bulk Upload Using Wrong Location**
- **Solution:** Ensure photos were taken with location services enabled
- Photos without GPS metadata use current upload location
- Check photo EXIF data contains GPS coordinates
- Re-take photos with location enabled if needed

**Issue: AI Not Extracting Information**
- **Solution:** Ensure good lighting in photos
- Photo should be clear and in focus
- Storefront/building should be clearly visible
- Try retaking photo if extraction fails

### 10.2 Android-Specific Issues

**Issue: localStorage Returns "undefined"**
- **Solution:** Known Android browser issue
- Recovery Tool handles this automatically
- Data is backed up to sessionStorage

**Issue: Projects Disappear During Bulk Download**
- **Solution:** App automatically restores projects
- Projects are backed up before operations
- Check "See All Projects" if projects seem missing

**Issue: Select Dropdowns Too Small**
- **Solution:** App includes mobile-responsive sizing
- Dropdowns are touch-friendly (44px minimum height)
- Scroll if needed on smaller screens

### 10.3 Getting Help

**Send Feedback:**
- Home Screen → "Send Feedback"
- Select feedback type (Feature request, Bug report, Performance, Others)
- Select device (iOS/Android)
- Enter email/Slack ID (optional)
- Describe issue or suggestion
- Submit feedback

**Version History:**
- Home Screen → "Version History"
- View changelog and updates
- Check current version number

---

## 11. Best Practices

### 11.1 Photo Quality

**Do:**
- ✅ Use good lighting
- ✅ Keep camera steady
- ✅ Capture full storefront/building
- ✅ Ensure text is readable
- ✅ Enable location services when taking photos

**Don't:**
- ❌ Take blurry photos
- ❌ Use extreme angles
- ❌ Block storefront with objects
- ❌ Take photos in very dark conditions

### 11.2 Project Organization

**Do:**
- ✅ Use descriptive tab names
- ✅ Organize projects into folders
- ✅ Set correct country for each project
- ✅ Use consistent naming conventions
- ✅ Set appropriate default addresses

**Don't:**
- ❌ Use generic names like "Project 1"
- ❌ Mix countries in same project
- ❌ Create duplicate projects
- ❌ Leave projects without proper settings

### 11.3 Bulk Upload

**Do:**
- ✅ Take photos with location services enabled
- ✅ Process photos in batches (10-20 at a time)
- ✅ Verify GPS coordinates are correct
- ✅ Check batch table for errors
- ✅ Use appropriate project settings

**Don't:**
- ❌ Upload hundreds of photos at once
- ❌ Upload photos without GPS metadata
- ❌ Mix different locations in same batch
- ❌ Skip reviewing extracted data

### 11.4 Data Management

**Do:**
- ✅ Review extracted data before syncing
- ✅ Verify addresses are correct
- ✅ Check GPS coordinates accuracy
- ✅ Organize projects regularly
- ✅ Use folders for project management

**Don't:**
- ❌ Skip data verification
- ❌ Create projects without proper settings
- ❌ Mix different project types
- ❌ Delete projects without backing up data

### 11.5 Multi-Country Operations

**Do:**
- ✅ Select correct country for each project
- ✅ Use country-specific email addresses if needed
- ✅ Verify data syncs to correct Google Sheet
- ✅ Check project country display is correct

**Don't:**
- ❌ Mix countries in same project
- ❌ Use wrong country selection
- ❌ Assume all countries use same sheet

### 11.6 Performance Tips

**Do:**
- ✅ Process photos in smaller batches
- ✅ Clear old projects periodically
- ✅ Use folders to organize projects
- ✅ Close unused browser tabs

**Don't:**
- ❌ Upload 100+ photos at once
- ❌ Keep hundreds of projects active
- ❌ Use app on very old devices
- ❌ Run multiple instances simultaneously

---

## Appendix A: Quick Reference

### Project Creation Flow

```
Home Screen
  ↓
Create New Project
  ↓
Select Project Type (Onground Benchmarking / Map Your City Lite)
  ↓
Choose Setup Method:
  - Create a new tab
  - Select from existing building
  - Scan with OneMap
  - Bulk Upload
  ↓
Configure Settings
  ↓
Create Project
  ↓
Project Menu
```

### Scanning Flow

```
Project Menu
  ↓
Scan Button
  ↓
Camera View
  ↓
Take Photo
  ↓
AI Processing
  ↓
Review Results
  ↓
Auto-Save & Sync
```

### Bulk Upload Flow

```
Option 1: Project-Based
  Project Menu → Bulk Upload → Select Photos → Process → Sync

Option 2: Standalone
  Project Type → Bulk Upload → Configure Settings → Select Photos → Process & Upload
```

---

## Appendix B: Field Definitions

### Commercial Project Fields

- **House No.:** Building/house number
- **Street:** Street name
- **Building:** Building name (e.g., mall name)
- **Postcode:** Postal code
- **Floor:** Floor level (B4 to L20)
- **Unit:** Shop/unit number
- **Category:** Commercial category type

### Residential Project Fields

- **Street Name:** Street name (required)
- **Building:** Estate/building name (optional)
- **Postcode:** Postal code (optional)
- **House No.:** Extracted from photo
- **Category:** Always "Residential"

### Project Metadata

- **Country:** Project country
- **Date:** Project date
- **Email:** Contact email
- **Environment:** Indoor/Outdoor
- **Sync Status:** Google Sheets sync status
- **Records:** Number of scans in project

---

## Appendix C: Keyboard Shortcuts

*Note: Mobile-focused app, keyboard shortcuts are limited*

- **Back Navigation:** Browser back button or app back button (⟵)
- **Home:** Home button in app header
- **Search:** Tap search field in data view

---

## Document Control

**Version:** 1.0  
**Date:** 2025  
**Author:** bnsV Development Team  
**Review Frequency:** Quarterly or after major updates  
**Next Review:** After next major release

---

**End of Document**
