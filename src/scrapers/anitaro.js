const cheerio = require('cheerio');

// Anitaro 4K Scraper for MultiScraper
// Extracted from api.anitaro.live

const BASE_URL = 'https://api.anitaro.live';

// Debug helpers
function log(msg, rid, extra) {
    const prefix = `[Anitaro]${rid ? `[rid:${rid}]` : ''}`;
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
        headers: options.headers || {},
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

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const rid = Math.random().toString(36).slice(2, 8);
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    log(`Starting getStreams for TMDB:${tmdbId} ${type} S${seasonNum}E${episodeNum}`, rid);

    try {
        let watchUrl = `${BASE_URL}/cdn/${type}/${tmdbId}`;
        if (mediaType === 'tv') {
            watchUrl += `/${seasonNum}/${episodeNum}`;
        }

        log(`Fetching watch page: ${watchUrl}`, rid);
        const response = await request(watchUrl);
        const html = response.body;

        // Extract jwSources from the script tag
        // Example: const jwSources = [{"file":"...","label":"360p"},...];
        const sourcesMatch = html.match(/const jwSources = (\[.*?\]);/);
        if (!sourcesMatch) {
            log(`No sources found in HTML`, rid);
            return [];
        }

        let jwSources;
        try {
            jwSources = JSON.parse(sourcesMatch[1]);
        } catch (e) {
            log(`Error parsing jwSources JSON: ${e.message}`, rid);
            return [];
        }

        if (!jwSources || jwSources.length === 0) {
            log(`Empty jwSources array`, rid);
            return [];
        }

        log(`Step 1: Found ${jwSources.length} source(s) from Anitaro`, rid);

        const results = jwSources.map(s => {
            let quality = s.label || 'Unknown';
            if (quality.includes('ORG')) quality = 'Original';

            return {
                name: `ANITARO 4K - ${quality}`,
                title: `Anitaro 4K Stream (${quality})`,
                url: s.file,
                quality: quality,
                behaviorHints: {
                    bingeGroup: `anitaro-4k`,
                    notWebReady: true
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
