const cheerio = require('cheerio');

/**
 * Mint Scraper for MultiScraper
 * Source: https://a.111477.xyz/
 */

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const BASE_URL = 'https://a.111477.xyz';
const PROXY_URL = 'https://p.111477.xyz/bulk?u=';

// Debug helpers
function log(msg, rid, extra) {
    const prefix = `[Mint]${rid ? `[rid:${rid}]` : ''}`;
    if (extra !== undefined) {
        console.log(`${prefix} ${msg}`, extra);
    } else {
        console.log(`${prefix} ${msg}`);
    }
}

// Stealth request helper
async function request(url, options = {}) {
    const { gotScraping } = await import('got-scraping');
    
    // Add small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));

    const browserHeaders = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'max-age=0',
        'Referer': options.referer || BASE_URL + '/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    const requestOptions = {
        url: url,
        method: options.method || 'GET',
        headers: browserHeaders,
        timeout: { request: 30000 },
        retry: { limit: 2 },
        headerGeneratorOptions: {
            browsers: [{ name: 'chrome', minVersion: 120 }],
            devices: ['desktop'],
            locales: ['en-US']
        }
    };

    if (options.responseType) {
        requestOptions.responseType = options.responseType;
    }

    try {
        let response = await gotScraping(requestOptions);
        
        // Block detection
        if (response.statusCode === 403 || response.statusCode === 429 || 
            (typeof response.body === 'string' && (response.body.includes('Just a moment...') || response.body.length < 10000))) {
            throw new Error(`Access blocked (Status: ${response.statusCode})`);
        }

        return response;
    } catch (err) {
        log(`Request to ${url} failed: ${err.message}`, options.rid);
        throw err;
    }
}

async function getTMDBInfo(tmdbId, mediaType, rid) {
    for (let i = 0; i < 3; i++) {
        try {
            const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
            const res = await request(url, { responseType: 'json', rid });
            const data = res.body;
            return {
                title: data.name || data.title,
                year: (data.first_air_date || data.release_date || '').split('-')[0],
                original_title: data.original_name || data.original_title
            };
        } catch (e) {
            log(`TMDB error (attempt ${i+1}): ${e.message}`, rid);
            if (i === 2) return null;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return null;
}

function cleanTitle(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const rid = Math.random().toString(36).slice(2, 8);
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    log(`Starting getStreams for TMDB:${tmdbId} ${type} S${seasonNum}E${episodeNum}`, rid);

    try {
        const meta = await getTMDBInfo(tmdbId, type === 'tv' ? 'tv' : 'movie', rid);
        if (!meta) throw new Error("Could not get TMDB metadata");
        log(`Step 1: Found title "${meta.title}" (${meta.year})`, rid);

        const targetTitle = cleanTitle(meta.title);
        const targetYear = meta.year;

        let categories = type === 'movie' ? ['/movies/'] : ['/tvs/', '/asiandrama/', '/kdrama/'];
        const streams = [];

        for (const cat of categories) {
            const catUrl = `${BASE_URL}${cat}`;
            log(`Searching in category: ${cat}`, rid);
            try {
                const res = await request(catUrl, { rid });
                const $ = cheerio.load(res.body);
                
                const matches = [];
                $('tr[data-entry="true"]').each((_, el) => {
                    const name = $(el).attr('data-name');
                    const url = $(el).attr('data-url');
                    if (!name || !url) return;

                    const cleanName = cleanTitle(name);
                    let isMatch = false;
                    if (cleanName === targetTitle) {
                        isMatch = true;
                    } else if (targetTitle.length > 5) {
                        const targetWords = targetTitle.split(' ');
                        const nameWords = cleanName.split(' ');
                        isMatch = targetWords.every(word => nameWords.includes(word));
                    }

                    if (isMatch) {
                        if (type === 'movie') {
                            if (name.includes(targetYear) || !targetYear) {
                                matches.push({ name, url, score: cleanName === targetTitle ? 100 : 50 });
                            }
                        } else {
                            matches.push({ name, url, score: cleanName === targetTitle ? 100 : 50 });
                        }
                    }
                });

                matches.sort((a, b) => b.score - a.score);

                for (const match of matches.slice(0, 3)) {
                    log(`Deep diving into: ${match.name}`, rid);
                    let targetFolderUrl = match.url;
                    const matchFullUrl = `${BASE_URL}${match.url}`;

                    if (type === 'tv') {
                        try {
                            const showRes = await request(matchFullUrl, { rid, referer: catUrl });
                            const $s = cheerio.load(showRes.body);
                            let seasonMatch = null;
                            $s('tr[data-entry="true"]').each((_, el) => {
                                const folderName = $(el).attr('data-name');
                                const folderUrl = $(el).attr('data-url');
                                if (folderName.match(new RegExp(`Season\\s*0*${seasonNum}|S0*${seasonNum}`, 'i'))) {
                                    seasonMatch = folderUrl;
                                    return false;
                                }
                            });
                            if (seasonMatch) targetFolderUrl = seasonMatch;
                        } catch (e) {
                            log(`Error finding season folder: ${e.message}`, rid);
                        }
                    }

                    const folderFullUrl = `${BASE_URL}${targetFolderUrl}`;
                    const folderRes = await request(folderFullUrl, { rid, referer: matchFullUrl });
                    const $f = cheerio.load(folderRes.body);
                    
                    const files = [];
                    $f('tr[data-entry="true"]').each((_, el) => {
                        const fileName = $(el).attr('data-name');
                        const fileUrl = $(el).attr('data-url');
                        if (fileName.match(/\.(mkv|mp4|m4v|avi|flv|webm|m3u8)$/i)) {
                            files.push({ name: fileName, url: fileUrl });
                        }
                    });

                    if (type === 'tv') {
                        const epPattern = new RegExp(`[ex]0*${episodeNum}(?![0-9])|\\s0*${episodeNum}(?![0-9])|\\-${episodeNum}(?![0-9])`, 'i');
                        const filteredFiles = files.filter(f => f.name.match(epPattern));
                        for (const f of filteredFiles) {
                            streams.push({
                                name: `MINT | ${match.name.slice(0, 15)}... | S${seasonNum}E${episodeNum}`,
                                title: f.name,
                                url: `${PROXY_URL}${encodeURIComponent(BASE_URL + f.url)}`,
                                quality: f.name.includes('2160p') ? '4K' : (f.name.includes('1080p') ? '1080p' : '720p'),
                                behaviorHints: { bingeGroup: `mint-${match.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }
                            });
                        }
                    } else {
                        for (const f of files) {
                            streams.push({
                                name: `MINT | ${match.name.slice(0, 20)}...`,
                                title: f.name,
                                url: `${PROXY_URL}${encodeURIComponent(BASE_URL + f.url)}`,
                                quality: f.name.includes('2160p') ? '4K' : (f.name.includes('1080p') ? '1080p' : '720p'),
                                behaviorHints: { bingeGroup: `mint-${match.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }
                            });
                        }
                    }
                }
                if (streams.length > 0) break;
            } catch (err) {
                log(`Error searching in ${cat}: ${err.message}`, rid);
            }
        }
        log(`🎉 COMPLETE: Returning ${streams.length} stream(s)`, rid);
        return streams;
    } catch (e) {
        log(`❌ ERROR: ${e.message}`, rid);
        return [];
    }
}

module.exports = { getStreams };
