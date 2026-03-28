const cheerio = require('cheerio');

// Mapple Scraper for Nuvio Local Scrapers
// Uses mapple.uk internal API for stream extraction

// Constants
const MAPLE_BASE = "https://mapple.uk";
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Available sources
const SOURCES = ["mapple", "sakura", "alfa", "oak", "wiggles"];

// Utility functions
function getQualityFromStream(stream) {
    if (stream.resolution) {
        const height = parseInt(stream.resolution.split('x')[1]);
        if (height >= 2160) return '4K';
        if (height >= 1440) return '1440p';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        if (height >= 480) return '480p';
        if (height >= 360) return '360p';
        return '240p';
    }
    if (stream.bandwidth) {
        const mbps = stream.bandwidth / 1000000;
        if (mbps >= 15) return '4K';
        if (mbps >= 8) return '1440p';
        if (mbps >= 5) return '1080p';
        if (mbps >= 3) return '720p';
        if (mbps >= 1.5) return '480p';
        if (mbps >= 0.8) return '360p';
        return '240p';
    }
    return 'Unknown';
}

function parseM3U8(content) {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    const streams = [];
    let currentStream = null;

    for (const line of lines) {
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            currentStream = { bandwidth: null, resolution: null, codecs: null, url: null };
            const bw = line.match(/BANDWIDTH=(\d+)/);
            if (bw) currentStream.bandwidth = parseInt(bw[1]);
            const res = line.match(/RESOLUTION=(\d+x\d+)/);
            if (res) currentStream.resolution = res[1];
            const cod = line.match(/CODECS="([^"]+)"/);
            if (cod) currentStream.codecs = cod[1];
        } else if (currentStream && !line.startsWith('#')) {
            currentStream.url = line;
            streams.push(currentStream);
            currentStream = null;
        }
    }
    return streams;
}

// Core functions
async function resolveM3U8(gotScraping, url, sourceName, referer, cookies) {
    if (sourceName === 'sakura') {
        return [{
            name: `Mapple Sakura - Auto`,
            url: url,
            quality: 'Auto',
            size: "Unknown",
            headers: { 'Referer': referer, 'Cookie': cookies },
            provider: "mapple"
        }];
    }

    try {
        const response = await gotScraping(url, { headers: { 'Referer': referer, 'Cookie': cookies } });
        const content = response.body;

        if (content.includes('#EXT-X-STREAM-INF:')) {
            const streams = parseM3U8(content);
            return streams.map(stream => ({
                name: `Mapple ${sourceName.charAt(0).toUpperCase() + sourceName.slice(1)} - ${getQualityFromStream(stream)}`,
                url: stream.url,
                quality: getQualityFromStream(stream),
                size: "Unknown",
                headers: { 'Referer': referer, 'Cookie': cookies },
                provider: "mapple"
            }));
        }
        
        return [{
            name: `Mapple ${sourceName.charAt(0).toUpperCase() + sourceName.slice(1)} - Unknown`,
            url: url,
            quality: 'Unknown',
            size: "Unknown",
            headers: { 'Referer': referer, 'Cookie': cookies },
            provider: "mapple"
        }];
    } catch (error) {
        return [{
            name: `Mapple ${sourceName.charAt(0).toUpperCase() + sourceName.slice(1)} - Master`,
            url: url,
            quality: 'Unknown',
            size: "Unknown",
            headers: { 'Referer': referer, 'Cookie': cookies },
            provider: "mapple"
        }];
    }
}

async function fetchStreamsForSource(gotScraping, tmdbId, mediaType, seasonNum, episodeNum, source, referer, cookies) {
    try {
        // Step A: Encrypt the request
        const encryptRes = await gotScraping({
            url: `${MAPLE_BASE}/api/encrypt`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Referer': referer,
                'Cookie': cookies
            },
            body: JSON.stringify({
                endpoint: "stream-encrypted",
                data: {
                    mediaId: tmdbId.toString(),
                    mediaType: mediaType,
                    tv_slug: mediaType === 'tv' ? `${seasonNum}-${episodeNum}` : "",
                    source: source
                }
            })
        });

        if (encryptRes.statusCode !== 200) return [];
        const { url: encryptedUrl } = JSON.parse(encryptRes.body);
        if (!encryptedUrl) return [];

        // Step B: Fetch the encrypted stream data
        const fullEncryptedUrl = encryptedUrl.startsWith('http') ? encryptedUrl : `${MAPLE_BASE}${encryptedUrl}`;
        const streamRes = await gotScraping({
            url: fullEncryptedUrl,
            headers: {
                'Referer': referer,
                'Cookie': cookies
            }
        });

        if (streamRes.statusCode !== 200) return [];
        const streamData = JSON.parse(streamRes.body);

        if (!streamData.success || !streamData.data?.stream_url) return [];

        const streamUrl = streamData.data.stream_url.trim();
        if (streamUrl.includes('Content not found')) return [];

        return await resolveM3U8(gotScraping, streamUrl, source, referer, cookies);
    } catch (error) {
        console.error(`[Mapple] Error fetching ${source}: ${error.message}`);
        return [];
    }
}

async function getTMDBDetails(gotScraping, tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;

    try {
        const response = await gotScraping(url).json();
        return {
            title: response.name || response.title,
            year: (response.first_air_date || response.release_date || '').split('-')[0]
        };
    } catch (error) {
        return { title: 'Unknown Title', year: null };
    }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const { gotScraping } = await import('got-scraping');
    
    console.log(`Step 1: TMDB Details [Mapple]`);
    const tmdbType = (mediaType === 'series' ? 'tv' : mediaType);
    const mediaInfo = await getTMDBDetails(gotScraping, tmdbId, tmdbType);
    
    console.log(`Step 2: Mapping (Initial Session) [Mapple]`);
    const watchUrl = tmdbType === 'tv' 
        ? `${MAPLE_BASE}/watch/tv/${tmdbId}/${seasonNum}-${episodeNum}`
        : `${MAPLE_BASE}/watch/movie/${tmdbId}`;
    
    const initialRes = await gotScraping(watchUrl);
    const cookies = initialRes.headers['set-cookie']?.join('; ') || '';
    
    console.log(`Step 3: Database/Provider Lookup [Mapple]`);
    const titleWithYear = mediaInfo.year ? `${mediaInfo.title} (${mediaInfo.year})` : mediaInfo.title;
    const finalTitle = tmdbType === 'tv' 
        ? `${mediaInfo.title} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`
        : titleWithYear;

    const sourcePromises = SOURCES.map(source => 
        fetchStreamsForSource(gotScraping, tmdbId, tmdbType, seasonNum, episodeNum, source, watchUrl, cookies)
    );

    const results = await Promise.allSettled(sourcePromises);
    const allStreams = [];

    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            result.value.forEach(stream => {
                stream.title = finalTitle;
                allStreams.push(stream);
            });
        }
    });

    console.log(`Step 4: Stream Resolution [Mapple]`);
    const qualityOrder = ['Auto', '4K', '1440p', '1080p', '720p', '480p', '360p', '240p', 'Unknown'];
    return allStreams.sort((a, b) => {
        const aIndex = qualityOrder.indexOf(a.quality);
        const bIndex = qualityOrder.indexOf(b.quality);
        return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
