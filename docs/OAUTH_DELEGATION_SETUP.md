# OAuth Delegation (Domain-Wide Delegation) Setup Guide

This guide explains how to set up OAuth delegation so your service account can upload files to Google Drive on behalf of a user account.

## Prerequisites

- **Google Workspace account** (not a personal Gmail account)
- **Super Administrator access** to your Google Workspace domain
- Your service account already created in Google Cloud Console

## Step 1: Get Your Service Account Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **IAM & Admin** > **Service Accounts**
3. Click on your service account (the one you're using for bnsVision)
4. Scroll down to **Advanced settings** section
5. Find **Domain-wide delegation** section
6. Copy the **Client ID** (it's a long number like `123456789012345678901`)

## Step 2: Configure Domain-Wide Delegation in Google Workspace Admin Console

1. Go to [Google Admin Console](https://admin.google.com/)
2. Sign in with a **Super Administrator** account
3. Navigate to **Security** > **Access and data control** > **API controls**
4. Scroll down to **Domain-wide delegation** section
5. Click **Manage Domain Wide Delegation**
6. Click **Add new**
7. Fill in the form:
   - **Client ID**: Paste the Client ID you copied in Step 1
   - **OAuth Scopes**: Enter the following scopes (comma-separated):
     ```
     https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive.file
     ```
8. Click **Authorize**

**Important Notes:**
- It may take a few minutes (up to 24 hours) for the delegation to take effect
- The user email you'll impersonate must belong to your Google Workspace domain
- You can only impersonate users in your own domain

## Step 3: Choose a User to Impersonate

Choose a Google Workspace user account that:
- Belongs to your Google Workspace domain
- Has access to the Google Drive folder where you want to upload files
- Has appropriate permissions for Google Sheets (if syncing)

**Recommended:** Create a dedicated service user account (e.g., `bnsvision-service@yourdomain.com`) for this purpose.

## Step 4: Add Environment Variable to Netlify

1. Go to your Netlify dashboard
2. Navigate to **Site settings** > **Environment variables**
3. Add a new environment variable:
   - **Key**: `GOOGLE_IMPERSONATE_USER`
   - **Value**: The email address of the user to impersonate (e.g., `bnsvision-service@yourdomain.com`)
4. Click **Save**

## Step 5: Share the Drive Folder with the Impersonated User

1. Go to Google Drive
2. Open the folder where you want to upload images
3. Click **Share**
4. Add the user email you're impersonating (from Step 3)
5. Give them **Editor** access
6. Click **Share**

## Step 6: Deploy and Test

After setting up delegation, deploy your updated code and test the image upload functionality.

## Troubleshooting

### "Invalid Grant" Error
- Make sure domain-wide delegation was authorized in Admin Console
- Wait a few minutes and try again (delegation can take time to propagate)
- Verify the user email belongs to your Google Workspace domain

### "Access Denied" Error
- Ensure the impersonated user has access to the Drive folder
- Check that the OAuth scopes match exactly what you entered in Admin Console

### Still Getting Storage Quota Error
- Make sure you're using `GOOGLE_IMPERSONATE_USER` environment variable
- Verify the code was deployed with the updated authentication logic

## Alternative: Use Shared Drive (Easier)

If you have Google Workspace, using a **Shared Drive** is often easier than OAuth delegation:

1. Create a Shared Drive in Google Drive
2. Add your service account email as a member with "Content Manager" role
3. Use the Shared Drive folder ID in `GOOGLE_DRIVE_FOLDER_ID`
4. No OAuth delegation needed!

## Security Considerations

- Domain-wide delegation gives the service account significant power
- Only grant the minimum scopes needed
- Use a dedicated service user account for impersonation
- Regularly review and audit delegation settings
