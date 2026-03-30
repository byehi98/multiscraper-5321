const cheerio = require('cheerio');

// WebStreamr Scraper for MultiScraper
// Integrated as a meta-scraper using the ElfHosted instance

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const BASE_URL = 'https://webstreamr.hayd.uk';

// Debug helpers
function log(msg, rid, extra) {
    const prefix = `[WebStreamr]${rid ? `[rid:${rid}]` : ''}`;
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
            'Accept': 'application/json, text/plain, */*',
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

// Get IMDb ID from TMDB
async function getImdbId(tmdbId, type, rid) {
    try {
        const url = `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
        const res = await request(url, { responseType: 'json' });
        return res.body.imdb_id;
    } catch (e) {
        log(`Error getting IMDb ID: ${e.message}`, rid);
        return null;
    }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const rid = Math.random().toString(36).slice(2, 8);
    const type = mediaType === 'tv' ? 'series' : 'movie';
    log(`Starting getStreams for TMDB:${tmdbId} ${type} S${seasonNum}E${episodeNum}`, rid);

    try {
        // WebStreamr prefers IMDb IDs for accuracy
        const imdbId = await getImdbId(tmdbId, mediaType === 'tv' ? 'tv' : 'movie', rid);
        if (!imdbId) throw new Error("Could not resolve IMDb ID");
        
        let id = imdbId;
        if (mediaType === 'tv') {
            id = `${imdbId}:${seasonNum}:${episodeNum}`;
        }

        const streamUrl = `${BASE_URL}/stream/${type}/${id}.json`;
        log(`Fetching streams from: ${streamUrl}`, rid);

        const response = await request(streamUrl, { responseType: 'json' });
        const data = response.body;

        if (!data || !data.streams || data.streams.length === 0) {
            log(`No streams found from WebStreamr`, rid);
            return [];
        }

        log(`Step 1: Found ${data.streams.length} stream(s) from WebStreamr`, rid);

        const results = data.streams.map(s => {
            // WebStreamr titles usually look like: "Filename\n💾 Size 🔗 Provider from Source"
            const titleParts = s.title.split('\n');
            const fileName = titleParts[0] || 'Unknown File';
            const metadataLine = titleParts[1] || '';
            
            // Extract Size
            const sizeMatch = metadataLine.match(/💾\s*([\d.]+\s*[GM]B)/i);
            const size = sizeMatch ? sizeMatch[1] : '';

            // Extract Provider (the part after 🔗)
            let provider = 'Unknown';
            if (metadataLine.includes('🔗')) {
                provider = metadataLine.split('🔗')[1].trim();
            } else if (s.title.includes('VixSrc')) {
                provider = 'VixSrc';
            }

            // Normalize quality label
            let quality = 'Unknown';
            if (s.title.includes('2160p') || s.title.includes('4K')) quality = '4K';
            else if (s.title.includes('1080p')) quality = '1080p';
            else if (s.title.includes('720p')) quality = '720p';
            else if (s.title.includes('480p')) quality = '480p';

            // Extract flags from the original name if present
            const flags = s.name.match(/[🌐🇺🇸🇮🇳🇬🇧🇫🇷🇩🇪🇮🇹🇪🇸]+/g)?.join(' ') || '';

            // Format Name: [WS] Provider - Quality
            // Keep it short so it fits on one line in most UI views
            const cleanProvider = provider.split(' from ')[0].trim().replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
            const displayName = `WS | ${cleanProvider} ${flags} - ${quality}`.trim();

            // Format Title (Description):
            // Quality | Size | Provider
            // Filename
            const displayTitle = [
                `${quality}${size ? ` | ${size}` : ''} | ${provider}`,
                fileName
            ].join('\n');

            return {
                name: displayName,
                title: displayTitle,
                url: s.url,
                quality: quality,
                behaviorHints: {
                    bingeGroup: `webstreamr-${cleanProvider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                    notWebReady: s.behaviorHints?.notWebReady || false,
                    proxyHeaders: s.behaviorHints?.proxyHeaders || null
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
