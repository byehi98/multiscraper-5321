const fetch = require('node-fetch');

// Vidrock Scraper for Nuvio Local Scrapers
// Refactored to use async/await and got-scraping for stealth retrieval
// Extracts streaming links using TMDB ID for Vidrock servers with AES-CBC encryption

// TMDB API Configuration
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Vidrock Configuration
const VIDROCK_BASE_URL = 'https://vidrock.net';
const PASSPHRASE = 'x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9';

// Default headers for playback (will be supplemented by got-scraping UA)
let playbackHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://vidrock.net/',
    'Origin': 'https://vidrock.net'
};

// React Native-safe Base64 utilities (no Buffer dependency)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function bytesToBase64(bytes) {
    if (!bytes || bytes.length === 0) return '';
    let output = '';
    let i = 0;
    const len = bytes.length;
    while (i < len) {
        const a = bytes[i++];
        const b = i < len ? bytes[i++] : 0;
        const c = i < len ? bytes[i++] : 0;
        const bitmap = (a << 16) | (b << 8) | c;
        output += BASE64_CHARS.charAt((bitmap >> 18) & 63);
        output += BASE64_CHARS.charAt((bitmap >> 12) & 63);
        output += i - 2 < len ? BASE64_CHARS.charAt((bitmap >> 6) & 63) : '=';
        output += i - 1 < len ? BASE64_CHARS.charAt(bitmap & 63) : '=';
    }
    return output;
}

// AES-CBC Encryption using server (React Native compatible)
async function encryptAesCbc(text, passphrase) {
    console.log('[Vidrock] Starting AES-CBC encryption via server...');
    try {
        const response = await fetch('https://aesdec.nuvioapp.space/encrypt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                passphrase: passphrase,
                method: 'cbc'
            })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        console.log('[Vidrock] Server encryption successful');
        return data.encrypted;
    } catch (error) {
        console.error(`[Vidrock] Server encryption failed: ${error.message}`);
        console.log('[Vidrock] Using fallback encoding...');
        const textBytes = new TextEncoder().encode(text);
        return bytesToBase64(textBytes);
    }
}

// Get movie/TV show details from TMDB
async function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
        const data = await response.json();
        const title = mediaType === 'tv' ? data.name : data.title;
        const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
        const year = releaseDate ? parseInt(releaseDate.split('-')[0]) : null;
        
        return {
            title: title,
            year: year,
            imdbId: data.external_ids?.imdb_id || null
        };
    } catch (error) {
        console.error(`[Vidrock] Error fetching TMDB details: ${error.message}`);
        return { title: 'Unknown', year: null, imdbId: null };
    }
}

// Extract quality from URL
function extractQuality(url) {
    if (!url) return 'Unknown';
    const qualityPatterns = [
        /(\d{3,4})p/i,
        /(\d{3,4})k/i,
        /quality[_-]?(\d{3,4})/i,
        /res[_-]?(\d{3,4})/i,
        /(\d{3,4})x\d{3,4}/i,
    ];
    for (const pattern of qualityPatterns) {
        const match = url.match(pattern);
        if (match) {
            const qualityNum = parseInt(match[1]);
            if (qualityNum >= 240 && qualityNum <= 4320) return `${qualityNum}p`;
        }
    }
    if (url.includes('1080')) return '1080p';
    if (url.includes('720')) return '720p';
    if (url.includes('480')) return '480p';
    return 'Unknown';
}

// Determine if a stream needs headers
function needsHeaders(serverName, url) {
    if (serverName === 'Astra' || serverName === 'Atlas' || serverName === 'Luna') return true;
    if (url.includes('vidrock.store') || url.includes('vdrk.site') || url.includes('niggaflix.xyz')) return true;
    return false;
}

// Fetch and parse JSON playlists (Astra, Atlas, etc.) to extract actual streaming links
async function parseJsonPlaylist(playlistUrl, serverName, mediaInfo, seasonNum, episodeNum) {
    console.log(`[Vidrock] Fetching JSON playlist from ${serverName}: ${playlistUrl}`);
    try {
        const response = await fetch(playlistUrl, { headers: playbackHeaders });
        const text = await response.text();
        
        // Ensure it's JSON
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.log(`[Vidrock] ${serverName} playlist is not JSON, treating as direct link`);
            return []; // Fall back to direct link if needed, but handled in loop
        }

        const streams = [];
        if (Array.isArray(data)) {
            data.forEach(item => {
                if (item.url && item.resolution) {
                    const quality = `${item.resolution}p`.replace('pp', 'p'); // Fix potential '1080pp'
                    let mediaTitle = mediaInfo.title || 'Unknown';
                    if (mediaInfo.year) mediaTitle += ` (${mediaInfo.year})`;
                    if (seasonNum && episodeNum) mediaTitle = `${mediaInfo.title} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
                    
                    streams.push({
                        name: `Vidrock ${serverName} - ${quality}`,
                        title: mediaTitle,
                        url: item.url,
                        quality: quality,
                        headers: playbackHeaders,
                        behaviorHints: { bingeGroup: `vidrock-${serverName}` },
                        provider: 'vidrock'
                    });
                }
            });
        }
        return streams;
    } catch (error) {
        console.error(`[Vidrock] Error parsing JSON playlist from ${serverName}: ${error.message}`);
        return [];
    }
}

// Process Vidrock API response
async function processVidrockResponse(data, mediaInfo, seasonNum, episodeNum) {
    const streams = [];
    const playlistPromises = [];
    
    if (!data || typeof data !== 'object') return streams;
    
    for (const serverName of Object.keys(data)) {
        const source = data[serverName];
        if (!source || !source.url || source.url === 'error') continue;
        
        const videoUrl = source.url;
        
        // Handle JSON playlists (contain /playlist/ and NOT .m3u8)
        if (videoUrl.includes('/playlist/') && !videoUrl.toLowerCase().endsWith('.m3u8')) {
            playlistPromises.push(parseJsonPlaylist(videoUrl, serverName, mediaInfo, seasonNum, episodeNum));
            continue;
        }
        
        let quality = extractQuality(videoUrl);
        const languageInfo = source.language ? ` [${source.language}]` : '';
        
        if ((source.type === 'hls' || videoUrl.includes('.m3u8') || videoUrl.includes('/playlist/')) && quality === 'Unknown') {
            quality = 'Adaptive';
        }
        
        let mediaTitle = mediaInfo.title || 'Unknown';
        if (mediaInfo.year) mediaTitle += ` (${mediaInfo.year})`;
        if (seasonNum && episodeNum) mediaTitle = `${mediaInfo.title} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
        
        const streamHeaders = needsHeaders(serverName, videoUrl) ? playbackHeaders : undefined;
        
        streams.push({
            name: `Vidrock ${serverName}${languageInfo} - ${quality}`,
            title: mediaTitle,
            url: videoUrl,
            quality: quality,
            headers: streamHeaders,
            behaviorHints: { bingeGroup: `vidrock-${serverName}` },
            provider: 'vidrock'
        });
    }
    
    if (playlistPromises.length > 0) {
        const playlistResults = await Promise.all(playlistPromises);
        playlistResults.forEach(res => streams.push(...res));
    }
    
    return streams;
}

// Fetch streams from Vidrock API
async function fetchFromVidrock(mediaType, tmdbId, mediaInfo, seasonNum, episodeNum) {
    console.log(`Step 2: API Call (Encrypted ID)`);
    
    const itemId = (mediaType === 'tv' && seasonNum && episodeNum) 
        ? `${tmdbId}_${seasonNum}_${episodeNum}` 
        : tmdbId.toString();
    
    try {
        const encryptedId = await encryptAesCbc(itemId, PASSPHRASE);
        
        // Convert to URL-safe base64 to avoid 404/403 errors with slashes/plus signs
        const urlSafeId = encryptedId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        
        const apiUrl = `${VIDROCK_BASE_URL}/api/${mediaType}/${urlSafeId}`;
        
        console.log(`[Vidrock] API URL: ${apiUrl}`);
        
        // Import got-scraping for stealth
        const { gotScraping } = await import('got-scraping');
        const response = await gotScraping({
            url: apiUrl,
            headers: {
                'Referer': 'https://vidrock.net/',
                'Origin': 'https://vidrock.net',
            },
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120 }],
                devices: ['desktop'],
                locales: ['en-US']
            },
            timeout: { request: 15000 }
        });
        
        // Update playback headers with the captured User-Agent for better compatibility
        if (response.headers['user-agent']) {
            playbackHeaders['User-Agent'] = response.headers['user-agent'];
        }
        
        const data = JSON.parse(response.body);
        console.log(`Step 3: Processing Streams`);
        return await processVidrockResponse(data, mediaInfo, seasonNum, episodeNum);
    } catch (error) {
        console.error(`[Vidrock] Error fetching from API: ${error.message}`);
        return [];
    }
}

// Main function to extract streaming links
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log(`[Vidrock] Starting extraction for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    
    try {
        console.log(`Step 1: TMDB Details`);
        const mediaInfo = await getTMDBDetails(tmdbId, mediaType);
        console.log(`[Vidrock] TMDB Info: "${mediaInfo.title}" (${mediaInfo.year || 'N/A'})`);
        
        const streams = await fetchFromVidrock(mediaType, tmdbId, mediaInfo, seasonNum, episodeNum);
        
        // Remove duplicate streams
        const uniqueStreams = [];
        const seenUrls = new Set();
        streams.forEach(stream => {
            if (!seenUrls.has(stream.url)) {
                seenUrls.add(stream.url);
                uniqueStreams.push(stream);
            }
        });
        
        // Sort streams by quality
        const getQualityValue = (q) => {
            q = q.toLowerCase().replace(/p$/, '');
            if (q === '4k' || q === '2160') return 2160;
            if (q === '1080') return 1080;
            if (q === '720') return 720;
            if (q === '480') return 480;
            if (q === 'adaptive') return 500; // Place adaptive above 480 but below 720
            const n = parseInt(q);
            return isNaN(n) ? 0 : n;
        };
        
        uniqueStreams.sort((a, b) => getQualityValue(b.quality) - getQualityValue(a.quality));
        
        console.log(`[Vidrock] Total streams found: ${uniqueStreams.length}`);
        return uniqueStreams;
    } catch (error) {
        console.error(`[Vidrock] Fatal error: ${error.message}`);
        return [];
    }
}

module.exports = { getStreams };
