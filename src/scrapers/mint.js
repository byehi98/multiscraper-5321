const cheerio = require('cheerio');

/**
 * Mint Scraper for MultiScraper
 * Source: https://a.111477.xyz/
 * nature: Large file index with proxy bypass
 */

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const BASE_URL = 'https://a.111477.xyz';
const PROXY_URL = 'https://p.111477.xyz/bulk?u=';
const FALLBACK_PROXY = 'https://simple-proxy-5321.netlify.app/?destination=';

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
    
    const requestOptions = {
        url: url,
        method: options.method || 'GET',
        headers: options.headers || {},
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
        
        // Trigger fallback if blocked (403), small body, or non-200 (except for TMDB)
        const isSuspicious = response.statusCode === 403 || (response.body && response.body.length < 10000);
        
        if (isSuspicious && !url.includes('api.themoviedb.org')) {
            log(`Direct request suspicious (${response.statusCode}, ${response.body?.length || 0} bytes), trying fallback proxy...`, options.rid);
            const proxyUrl = `${FALLBACK_PROXY}${encodeURIComponent(url)}`;
            const proxyResponse = await gotScraping({
                ...requestOptions,
                url: proxyUrl,
                timeout: { request: 20000 }
            });
            if (proxyResponse.body && proxyResponse.body.length > (response.body?.length || 0)) {
                log(`Fallback proxy success: ${proxyResponse.body.length} bytes`, options.rid);
                return proxyResponse;
            }
        }
        return response;
    } catch (err) {
        if (!url.includes('api.themoviedb.org')) {
            log(`Direct request failed (${err.message}), trying fallback proxy...`, options.rid);
            const proxyUrl = `${FALLBACK_PROXY}${encodeURIComponent(url)}`;
            try {
                const proxyResponse = await gotScraping({
                    ...requestOptions,
                    url: proxyUrl,
                    timeout: { request: 20000 }
                });
                return proxyResponse;
            } catch (proxyErr) {
                log(`Fallback proxy also failed: ${proxyErr.message}`, options.rid);
                throw err; // Throw original error
            }
        }
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
        // Step 1: Get Metadata
        const meta = await getTMDBInfo(tmdbId, type === 'tv' ? 'tv' : 'movie', rid);
        if (!meta) throw new Error("Could not get TMDB metadata");
        log(`Step 1: Found title "${meta.title}" (${meta.year})`, rid);

        const targetTitle = cleanTitle(meta.title);
        const targetYear = meta.year;

        // Step 2: Determine search categories
        let categories = [];
        if (type === 'movie') {
            categories = ['/movies/'];
        } else {
            categories = ['/tvs/', '/asiandrama/', '/kdrama/'];
        }

        const streams = [];

        for (const cat of categories) {
            log(`Searching in category: ${cat}`, rid);
            try {
                const res = await request(`${BASE_URL}${cat}`, { rid });
                log(`Response from ${cat}: ${res.statusCode} | Length: ${res.body?.length || 0}`, rid);
                
                const $ = cheerio.load(res.body);
                
                const matches = [];
                $('tr[data-entry="true"]').each((_, el) => {
                    const name = $(el).attr('data-name');
                    const url = $(el).attr('data-url');
                    if (!name || !url) return;

                    const cleanName = cleanTitle(name);
                    
                    // Improved matching logic using word boundaries
                    let isMatch = false;
                    if (cleanName === targetTitle) {
                        isMatch = true;
                    } else if (targetTitle.length > 5) {
                        const targetWords = targetTitle.split(' ');
                        const nameWords = cleanName.split(' ');
                        
                        // Check if all words in target title exist in the folder name
                        isMatch = targetWords.every(word => nameWords.includes(word));
                    }

                    if (isMatch) {
                        // For movies, check year if possible
                        if (type === 'movie') {
                            if (name.includes(targetYear) || !targetYear) {
                                matches.push({ name, url, score: cleanName === targetTitle ? 100 : 50 });
                            }
                        } else {
                            matches.push({ name, url, score: cleanName === targetTitle ? 100 : 50 });
                        }
                    }
                });

                // Sort matches by score
                matches.sort((a, b) => b.score - a.score);

                // Step 3: Deep dive into folders
                for (const match of matches.slice(0, 3)) { // Limit to top 3 matches
                    log(`Deep diving into: ${match.name}`, rid);
                    let targetFolderUrl = match.url;

                    // For TV Shows, try to find a season folder first
                    if (type === 'tv') {
                        try {
                            const showRes = await request(`${BASE_URL}${match.url}`, { rid });
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
                            if (seasonMatch) {
                                log(`Found season folder: ${seasonMatch}`, rid);
                                targetFolderUrl = seasonMatch;
                            }
                        } catch (e) {
                            log(`Error finding season folder: ${e.message}`, rid);
                        }
                    }

                    const folderRes = await request(`${BASE_URL}${targetFolderUrl}`, { rid });
                    const $f = cheerio.load(folderRes.body);
                    
                    const files = [];
                    $f('tr[data-entry="true"]').each((_, el) => {
                        const fileName = $(el).attr('data-name');
                        const fileUrl = $(el).attr('data-url');
                        const typeLabel = $(el).find('.type-label').text().trim();
                        
                        if (typeLabel === 'Directory') return;

                        // Check if it's a video file
                        if (fileName.match(/\.(mkv|mp4|m4v|avi|flv|webm|m3u8)$/i)) {
                            files.push({ name: fileName, url: fileUrl });
                        }
                    });

                    // For TV Shows, find the correct episode
                    if (type === 'tv') {
                        // More robust episode matching: E01, Ep01, - 01, etc.
                        const epPattern = new RegExp(`[ex]0*${episodeNum}(?![0-9])|\\s0*${episodeNum}(?![0-9])|\\-${episodeNum}(?![0-9])`, 'i');
                        const filteredFiles = files.filter(f => f.name.match(epPattern));
                        
                        for (const f of filteredFiles) {
                            streams.push({
                                name: `MINT | ${match.name.slice(0, 15)}... | S${seasonNum}E${episodeNum}`,
                                title: f.name,
                                url: `${PROXY_URL}${encodeURIComponent(BASE_URL + f.url)}`,
                                quality: f.name.includes('2160p') ? '4K' : (f.name.includes('1080p') ? '1080p' : '720p'),
                                behaviorHints: {
                                    bingeGroup: `mint-${match.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
                                }
                            });
                        }
                    } else {
                        // For Movies, take all video files found
                        for (const f of files) {
                            streams.push({
                                name: `MINT | ${match.name.slice(0, 20)}...`,
                                title: f.name,
                                url: `${PROXY_URL}${encodeURIComponent(BASE_URL + f.url)}`,
                                quality: f.name.includes('2160p') ? '4K' : (f.name.includes('1080p') ? '1080p' : '720p'),
                                behaviorHints: {
                                    bingeGroup: `mint-${match.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
                                }
                            });
                        }
                    }
                }

                if (streams.length > 0) break; // Found something in this category

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
