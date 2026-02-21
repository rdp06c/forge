#!/usr/bin/env node
// One-time script to get a Google OAuth2 refresh token for Drive access.
// Run: node drive/get-refresh-token.js
// Then add the refresh token to your .env as GOOGLE_REFRESH_TOKEN

import 'dotenv/config';
import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';

const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}`;

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
    console.error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
    process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
});

console.log('\n1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Sign in and authorize FORGE');
console.log('3. You will be redirected — the token will be captured automatically\n');

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const code = url.searchParams.get('code');

    if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h2>No authorization code received.</h2>');
        return;
    }

    try {
        const { tokens } = await oauth2.getToken(code);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>FORGE authorized! You can close this tab.</h2>');

        console.log('Authorization successful!\n');
        console.log('Add this to your .env:\n');
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('');
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>Error: ${err.message}</h2>`);
        console.error('Token exchange failed:', err.message);
    }

    server.close();
});

server.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT} for OAuth callback...`);
});
