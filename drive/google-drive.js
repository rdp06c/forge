// Google Drive integration via OAuth2 refresh token — headless after initial auth
import { google } from 'googleapis';

let driveClient = null;

function getDriveClient() {
    if (driveClient) return driveClient;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!clientId || !clientSecret || !refreshToken || !folderId) {
        console.warn('  Google Drive not configured — skipping upload');
        return null;
    }

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });

    driveClient = google.drive({ version: 'v3', auth: oauth2 });
    return driveClient;
}

/**
 * Upload or update a JSON file in Google Drive
 */
export async function uploadToGoogleDrive(filename, data) {
    const drive = getDriveClient();
    if (!drive) return null;

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const content = JSON.stringify(data, null, 2);

    try {
        // Check if file already exists
        const existing = await drive.files.list({
            q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
            fields: 'files(id, name)',
        });

        if (existing.data.files.length > 0) {
            // Update existing file
            const fileId = existing.data.files[0].id;
            await drive.files.update({
                fileId,
                media: { mimeType: 'application/json', body: content },
            });
            console.log(`  Drive: Updated ${filename}`);
            return fileId;
        } else {
            // Create new file
            const res = await drive.files.create({
                requestBody: {
                    name: filename,
                    parents: [folderId],
                    mimeType: 'application/json',
                },
                media: { mimeType: 'application/json', body: content },
                fields: 'id',
            });
            console.log(`  Drive: Created ${filename}`);
            return res.data.id;
        }
    } catch (err) {
        console.warn(`  Drive upload failed for ${filename}:`, err.message);
        return null;
    }
}

/**
 * Upload portfolio for an agent
 */
export async function uploadPortfolio(agentName, portfolio) {
    return uploadToGoogleDrive(`FORGE_${agentName}_Portfolio.json`, portfolio);
}

/**
 * Upload cycle log
 */
export async function uploadCycleLog(agentName, logData) {
    const dateStr = new Date().toISOString().split('T')[0];
    return uploadToGoogleDrive(`FORGE_${agentName}_Research_Log_${dateStr}.json`, logData);
}
