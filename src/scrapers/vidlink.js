const cheerio = require('cheerio');

// VidLink Scraper for MultiScraper
// Adapted from community reverse-engineering efforts

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const API = 'https://enc-dec.app/api';
const BASE_URL = 'https://vidlink.pro';

// Debug helpers
function log(msg, rid, extra) {
    const prefix = `[VidLink]${rid ? `[rid:${rid}]` : ''}`;
    if (extra !== undefined) {
        console.log(`${prefix} ${msg}`, extra);
    } else {
        console.log(`${prefix} ${msg}`);
    }
}

// Stealth request helper
async function request(url, options = {}) {
    const { gotScraping } = await import('got-scraping');
    
    const requestOptions = {
        url: url,
        method: options.method || 'GET',
        headers: {
            'Accept': '*/*',
            ...options.headers
        },
        timeout: { request: 15000 },
        retry: { limit: 2 },
        headerGeneratorOptions: {
            browsers: [{ name: 'chrome', minVersion: 120 }],
            devices: ['desktop'],
            locales: ['en-US']
        }
    };

    if (options.body) {
        if (typeof options.body === 'object') {
            requestOptions.json = options.body;
        } else {
            requestOptions.body = options.body;
        }
    }

    if (options.responseType) {
        requestOptions.responseType = options.responseType;
    }

    const response = await gotScraping(requestOptions);
    return response;
}

// Decryption helper using enc-dec.app
async function encryptId(tmdbId, rid) {
    try {
        log(`Encrypting ID via API: ${tmdbId}`, rid);
        const url = `${API}/enc-vidlink?text=${tmdbId}`;
        const res = await request(url, { responseType: 'json' });
        return res.body.result;
    } catch (e) {
        log(`Encryption error: ${e.message}`, rid);
        return null;
    }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const rid = Math.random().toString(36).slice(2, 8);
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    log(`Starting getStreams for TMDB:${tmdbId} ${type} S${seasonNum}E${episodeNum}`, rid);

    try {
        // Step 1: Encrypt TMDB ID (VidLink API needs it)
        const encryptedId = await encryptId(tmdbId, rid);
        if (!encryptedId) throw new Error("Could not encrypt ID");

        // Step 2: Call VidLink internal API
        // Pattern: https://vidlink.pro/api/b/{type}/{id}/{season}/{episode}?multiLang=0
        let apiUrl = `${BASE_URL}/api/b/${type}/${encryptedId}`;
        if (type === 'tv') {
            apiUrl += `/${seasonNum}/${episodeNum}`;
        }
        apiUrl += '?multiLang=0';

        const embedUrl = `${BASE_URL}/embed/${type}/${tmdbId}${type === 'tv' ? `/${seasonNum}/${episodeNum}` : ''}`;
        
        log(`Fetching sources from: ${apiUrl}`, rid);
        const response = await request(apiUrl, {
            headers: {
                'Referer': embedUrl,
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        const data = response.body;
        log(`Step 3: Parsing VidLink API response`, rid);

        const allSources = [];
        const allSubtitles = [];
        
        const streamData = data.stream || {};
        const captions = data.captions || streamData.captions || [];
        
        // Extract subtitles
        if (Array.isArray(captions)) {
            captions.forEach(c => {
                const subUrl = c.url || c.file || (c.id && c.id.startsWith('http') ? c.id : null);
                if (subUrl) {
                    allSubtitles.push({
                        url: subUrl,
                        label: c.label || c.language || 'Unknown',
                        kind: c.kind || 'captions'
                    });
                }
            });
        }

        // Handle single stream response
        if (data.stream && data.stream.playlist) {
            allSources.push({
                url: data.stream.playlist,
                quality: 'Auto',
                name: data.sourceId || 'Primary'
            });
        }

        // Handle legacy/multiple sources if present
        if (data.sources && Array.isArray(data.sources)) {
            data.sources.forEach(s => {
                allSources.push({
                    url: s.file,
                    quality: s.quality || 'Auto',
                    name: s.name || 'Server'
                });
            });
        }

        if (allSources.length === 0) {
            log(`No sources found in API response`, rid);
            return [];
        }

        const results = allSources.map(s => {
            return {
                name: `VIDLINK ${s.name.toUpperCase()} - ${s.quality}`,
                title: `VidLink ${s.name} stream`,
                url: s.url,
                quality: s.quality,
                subtitles: allSubtitles,
                behaviorHints: {
                    bingeGroup: `vidlink-${s.name.toLowerCase()}`,
                    notWebReady: true,
                    proxyHeaders: {
                        request: {
                            'Referer': BASE_URL,
                            'User-Agent': response.request.options.headers['user-agent']
                        }
                    }
                }
            };
        });

        log(`🎉 COMPLETE: Returning ${results.length} stream(s)`, rid);
        return results;

    } catch (e) {
        log(`❌ ERROR: ${e.message}`, rid);
        return [];
    }
}

module.exports = { getStreams };
