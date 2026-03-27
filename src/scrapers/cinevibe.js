// Cinevibe Scraper for MultiScraper
// Refactored to use async/await and got-scraping for stealth API access

const fetch = require('node-fetch');

// Constants
const BASE_URL = 'https://cinevibe.asia';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const BROWSER_FINGERPRINT = "eyJzY3JlZW4iOiIzNjB4ODA2eDI0Iiwi";
const SESSION_ENTROPY = "pjght152dw2rb.ssst4bzleDI0Iiwibv78";

// Debug helper
function log(msg, rid, extra) {
    const prefix = `[Cinevibe]${rid ? `[rid:${rid}]` : ''}`;
    if (extra !== undefined) {
        console.log(`${prefix} ${msg}`, extra);
    } else {
        console.log(`${prefix} ${msg}`);
    }
}

// Utility Functions

/**
 * A 32-bit FNV-1a Hash Function
 */
function fnv1a32(s) {
    let hash = 2166136261;
    for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) & 0xffffffff;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * ROT13 encoding function
 */
function rot13(str) {
    return str.replace(/[A-Za-z]/g, function(char) {
        const code = char.charCodeAt(0);
        if (code >= 65 && code <= 90) {
            return String.fromCharCode(((code - 65 + 13) % 26) + 65);
        } else if (code >= 97 && code <= 122) {
            return String.fromCharCode(((code - 97 + 13) % 26) + 97);
        }
        return char;
    });
}

function base64Encode(str) {
    return Buffer.from(str, 'utf8').toString('base64');
}

/**
 * Deterministic string obfuscator using layered reversible encodings
 */
function customEncode(e) {
    let encoded = base64Encode(e);
    encoded = encoded.split('').reverse().join('');
    encoded = rot13(encoded);
    encoded = base64Encode(encoded);
    encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return encoded;
}

/**
 * Get movie/TV show details from TMDB
 */
async function getTMDBDetails(tmdbId, mediaType, rid) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status}`);
        }
        const data = await response.json();
        const title = mediaType === 'tv' ? data.name : data.title;
        const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
        const releaseYear = releaseDate ? releaseDate.split('-')[0] : null;
        
        return {
            title: title,
            releaseYear: releaseYear
        };
    } catch (error) {
        log(`TMDB fetch error: ${error.message}`, rid);
        return null;
    }
}

/**
 * Generate token for Cinevibe API
 */
function generateToken(tmdbId, title, releaseYear) {
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const timeWindow = Math.floor(Date.now() / 300000);
    const timeBasedKey = `${timeWindow}_${BROWSER_FINGERPRINT}_cinevibe_2025`;
    const hashedKey = fnv1a32(timeBasedKey);
    const timeStamp = Math.floor(Date.now() / 1000 / 600);
    const tokenString = `${SESSION_ENTROPY}|${tmdbId}|${cleanTitle}|${releaseYear}||${hashedKey}|${timeStamp}|${BROWSER_FINGERPRINT}`;
    return customEncode(tokenString);
}

/**
 * Detect stream quality via HEAD request
 */
async function detectStreamQuality(url, rid) {
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            timeout: 5000
        });
        
        const contentType = response.headers.get('content-type');
        const contentLength = response.headers.get('content-length');
        
        if (contentLength && !isNaN(contentLength)) {
            const sizeMB = parseInt(contentLength) / (1024 * 1024);
            if (sizeMB >= 4000) return '4K';
            if (sizeMB >= 2000) return '1440p';
            if (sizeMB >= 1000) return '1080p';
            if (sizeMB >= 500) return '720p';
            if (sizeMB >= 200) return '480p';
        }
        
        if (contentType && contentType.includes('application/vnd.apple.mpegurl')) return 'Adaptive';
        
        return 'Auto';
    } catch (error) {
        return 'Auto';
    }
}

/**
 * Main scraping function
 */
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const rid = Math.random().toString(36).slice(2, 8);
    log(`Starting getStreams for TMDB:${tmdbId} Type:${mediaType}`, rid);
    
    // Only movies supported by current Cinevibe API structure
    if (mediaType === 'tv') {
        log('TV Series currently not supported', rid);
        return [];
    }
    
    try {
        // Step 1: TMDB Details
        const mediaInfo = await getTMDBDetails(tmdbId, mediaType, rid);
        if (!mediaInfo || !mediaInfo.title) {
            throw new Error('Could not extract title from TMDB');
        }
        log(`Step 1: Found title "${mediaInfo.title}" (${mediaInfo.releaseYear})`, rid);
        
        // Step 2: Token Generation
        const token = generateToken(tmdbId, mediaInfo.title, mediaInfo.releaseYear);
        const timestamp = Date.now();
        
        // Step 3: Fetch Streams via Stealth
        const apiUrl = `${BASE_URL}/api/stream/fetch?server=cinebox-1&type=${mediaType}&mediaId=${tmdbId}&title=${encodeURIComponent(mediaInfo.title)}&releaseYear=${mediaInfo.releaseYear}&_token=${token}&_ts=${timestamp}`;
        
        log(`Step 3: Fetching streams from API via stealth`, rid);
        
        const { gotScraping } = await import('got-scraping');
        const response = await gotScraping({
            url: apiUrl,
            headers: {
                'Referer': BASE_URL + '/',
                'X-CV-Fingerprint': BROWSER_FINGERPRINT,
                'X-CV-Session': SESSION_ENTROPY,
                'X-Requested-With': 'XMLHttpRequest'
            },
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120 }],
                devices: ['desktop']
            },
            timeout: { request: 15000 }
        });

        if (response.statusCode !== 200) {
            throw new Error(`Cinevibe API error: ${response.statusCode}`);
        }

        const data = JSON.parse(response.body);
        if (!data || !data.sources || !Array.isArray(data.sources)) {
            throw new Error('No sources found in API response');
        }

        // Step 4: Stream Resolution
        const streamPromises = data.sources.map(async (source) => {
            if (!source || !source.url) return null;
            
            const quality = await detectStreamQuality(source.url, rid);
            
            return {
                name: `Cinevibe - ${quality}`,
                title: `${mediaInfo.title} (${mediaInfo.releaseYear})`,
                url: source.url,
                quality: quality,
                behaviorHints: {
                    bingeGroup: `cinevibe-cinebox`
                },
                provider: 'cinevibe'
            };
        });

        const streams = (await Promise.all(streamPromises)).filter(Boolean);
        
        // Sort by quality
        const order = { '4K': 7, '2160p': 7, '1440p': 6, '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1, 'Auto': 0, 'Unknown': 0 };
        streams.sort((a, b) => (order[b.quality] || 0) - (order[a.quality] || 0));

        log(`🎉 COMPLETE: Returning ${streams.length} stream(s)`, rid);
        return streams;

    } catch (error) {
        log(`❌ Scraping error: ${error.message}`, rid);
        return [];
    }
}

module.exports = { getStreams };
