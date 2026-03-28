let gotScraping;

console.log("[VideoEasy] Initializing VideoEasy provider");

const API = 'https://enc-dec.app/api';
const TMDB_API_KEY = 'd131017ccc6e5462a81c9304d21476de';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const BASE_HEADERS = {
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive"
};

let lastUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const headerOptions = {
    browsers: [{ name: 'chrome', minVersion: 120 }],
    devices: ['desktop'],
    locales: ['en-US'],
    operatingSystems: ['windows', 'macos'],
};

const SERVERS = {
    'Neon': {
        url: 'https://api.videasy.net/myflixerzupcloud/sources-with-title',
        language: 'Original'
    },
    'Sage': {
        url: 'https://api.videasy.net/1movies/sources-with-title',
        language: 'Original'
    },
    'Cypher': {
        url: 'https://api.videasy.net/moviebox/sources-with-title',
        language: 'Original'
    },
    'Yoru': {
        url: 'https://api.videasy.net/cdn/sources-with-title',
        language: 'Original',
        moviesOnly: true
    },
    'Reyna': {
        url: 'https://api2.videasy.net/primewire/sources-with-title',
        language: 'Original'
    },
    'Omen': {
        url: 'https://api.videasy.net/onionplay/sources-with-title',
        language: 'Original'
    },
    'Breach': {
        url: 'https://api.videasy.net/m4uhd/sources-with-title',
        language: 'Original'
    },
    'Vyse': {
        url: 'https://api.videasy.net/hdmovie/sources-with-title',
        language: 'Original'
    },
    'Killjoy': {
        url: 'https://api.videasy.net/meine/sources-with-title',
        language: 'German',
        params: { language: 'german' }
    },
    'Harbor': {
        url: 'https://api.videasy.net/meine/sources-with-title',
        language: 'Italian',
        params: { language: 'italian' }
    },
    'Chamber': {
        url: 'https://api.videasy.net/meine/sources-with-title',
        language: 'French',
        params: { language: 'french' },
        moviesOnly: true
    },
    'Fade': {
        url: 'https://api.videasy.net/hdmovie/sources-with-title',
        language: 'Hindi'
    },
    'Gekko': {
        url: 'https://api2.videasy.net/cuevana-latino/sources-with-title',
        language: 'Latin'
    },
    'Kayo': {
        url: 'https://api2.videasy.net/cuevana-spanish/sources-with-title',
        language: 'Spanish'
    },
    'Raze': {
        url: 'https://api.videasy.net/superflix/sources-with-title',
        language: 'Portuguese'
    },
    'Phoenix': {
        url: 'https://api2.videasy.net/overflix/sources-with-title',
        language: 'Portuguese'
    },
    'Astra': {
        url: 'https://api.videasy.net/visioncine/sources-with-title',
        language: 'Portuguese'
    }
};

async function delay(ms = 250) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(url, options = {}) {
    await delay();
    
    if (!gotScraping) {
        const mod = await import('got-scraping');
        gotScraping = mod.gotScraping;
    }

    const response = await gotScraping({
        url,
        ...options,
        http2: false,
        headers: {
            ...BASE_HEADERS,
            ...options.headers
        },
        headerGeneratorOptions: headerOptions,
        timeout: { request: 15000 }
    });
    
    lastUA = response.request.options.headers['user-agent'];
    return response;
}

/**
 * Step 1: TMDB Details
 */
async function fetchMediaDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    
    try {
        const response = await makeRequest(url);
        const data = JSON.parse(response.body);
        
        return {
            id: data.id,
            title: mediaType === 'tv' ? data.name : data.title,
            year: (mediaType === 'tv' ? data.first_air_date : data.release_date)?.split('-')[0] || '',
            imdbId: data.external_ids?.imdb_id || '',
            mediaType: mediaType
        };
    } catch (error) {
        console.error(`[VideoEasy] Step 1: TMDB Details failed: ${error.message}`);
        return null;
    }
}

/**
 * Step 4: Token/ID Extraction (Decryption)
 */
async function decryptVideoEasy(encryptedText, tmdbId) {
    console.log(`[VideoEasy] Step 4: Token Extraction - Decrypting for ID: ${tmdbId}`);
    
    try {
        const response = await makeRequest(`${API}/dec-videasy`, {
            method: 'POST',
            json: { 
                text: encryptedText, 
                id: tmdbId,
                agent: lastUA 
            }
        });
        
        const data = JSON.parse(response.body);
        return data.result;
    } catch (error) {
        console.error(`[VideoEasy] Step 4: Decryption failed: ${error.message}`);
        return null;
    }
}

async function fetchFromServer(serverName, serverConfig, mediaType, title, year, tmdbId, imdbId, seasonId, episodeId) {
    console.log(`[VideoEasy] Step 3: Provider Lookup - Fetching from ${serverName} (${serverConfig.language})...`);

    if (mediaType === 'tv' && serverConfig.moviesOnly) {
        return [];
    }

    const params = {
        title,
        mediaType,
        year,
        tmdbId,
        imdbId
    };

    if (serverConfig.params) {
        Object.assign(params, serverConfig.params);
    }

    if (mediaType === 'tv' && seasonId && episodeId) {
        params.seasonId = seasonId;
        params.episodeId = episodeId;
    }

    const queryString = Object.keys(params)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
        .join('&');

    const url = `${serverConfig.url}?${queryString}`;

    try {
        const response = await makeRequest(url);
        const encryptedData = response.body;
        
        if (!encryptedData || encryptedData.trim() === '') {
            throw new Error('No encrypted data received');
        }

        const decryptedData = await decryptVideoEasy(encryptedData, tmdbId);
        if (!decryptedData) return [];

        const streams = formatStreamsForNuvio(decryptedData, serverName, serverConfig, { title, year });
        console.log(`[VideoEasy] ✅ Found ${streams.length} stream(s) from ${serverName}`);
        return streams;
    } catch (error) {
        console.log(`[VideoEasy] ❌ Error from ${serverName}: ${error.message}`);
        return [];
    }
}

function formatStreamsForNuvio(mediaData, serverName, serverConfig, mediaDetails) {
    if (!mediaData || typeof mediaData !== 'object' || !mediaData.sources) {
        return [];
    }

    const streams = [];

    mediaData.sources.forEach((source) => {
        if (source.url) {
            let quality = source.quality || extractQualityFromUrl(source.url);
            
            // Handle common quality terms
            const lowerQuality = quality.toLowerCase();
            if (lowerQuality.includes('1080')) quality = '1080p';
            else if (lowerQuality.includes('720')) quality = '720p';
            else if (lowerQuality.includes('480')) quality = '480p';
            else if (lowerQuality.includes('2160') || lowerQuality.includes('4k')) quality = '2160p';

            const isHLS = source.url.includes('.m3u8');
            const streamHeaders = {
                ...BASE_HEADERS,
                "User-Agent": lastUA,
                "Referer": "https://videasy.net/"
            };

            streams.push({
                name: `VideoEasy ${serverName} (${serverConfig.language}) - ${quality}`,
                title: `${mediaDetails.title} (${mediaDetails.year}) ${quality}`,
                url: source.url,
                quality: quality,
                type: isHLS ? 'hls' : 'direct',
                headers: streamHeaders,
                behaviorHints: {
                    bingeGroup: `videasy-${serverName.toLowerCase()}`
                }
            });
        }
    });

    return streams;
}

function extractQualityFromUrl(url) {
    if (url.includes('1080')) return '1080p';
    if (url.includes('720')) return '720p';
    if (url.includes('480')) return '480p';
    if (url.includes('2160') || url.includes('4k')) return '2160p';
    return 'HD';
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log(`[VideoEasy] Step 1: TMDB Details - ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const mediaDetails = await fetchMediaDetails(tmdbId, mediaType);
        if (!mediaDetails) return [];

        console.log(`[VideoEasy] TMDB Info: "${mediaDetails.title}" (${mediaDetails.year})`);

        const serverPromises = Object.keys(SERVERS).map(serverName => {
            return fetchFromServer(
                serverName,
                SERVERS[serverName],
                mediaDetails.mediaType,
                mediaDetails.title,
                mediaDetails.year,
                tmdbId,
                mediaDetails.imdbId,
                seasonNum,
                episodeNum
            );
        });

        const results = await Promise.all(serverPromises);
        const allStreams = results.flat();

        // Unique by URL
        const uniqueStreams = [];
        const seenUrls = new Set();
        allStreams.forEach(stream => {
            if (!seenUrls.has(stream.url)) {
                seenUrls.add(stream.url);
                uniqueStreams.push(stream);
            }
        });

        console.log(`[VideoEasy] Step 5: Stream Resolution - Total streams found: ${uniqueStreams.length}`);
        return uniqueStreams;
    } catch (error) {
        console.error(`[VideoEasy] Error in getStreams: ${error.message}`);
        return [];
    }
}

module.exports = { getStreams };
