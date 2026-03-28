// Dahmer Movies Scraper for MultiScraper
// Optimized to bypass Cloudflare and handle large directory listings efficiently

const fetch = require('node-fetch');
const cheerio = require('cheerio');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const TIMEOUT = 20000; // 20 seconds

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Global to track request time for throttling
let lastDahmerRequestTime = 0;

// Helper function to make HTTP requests using got-scraping with node-fetch fallback
async function makeRequest(url, options = {}) {
    const { gotScraping } = await import('got-scraping');
    
    // Throttling: Implement a delay between rapid consecutive calls (GEMINI.md mandate)
    const now = Date.now();
    const diff = now - lastDahmerRequestTime;
    if (diff < 1000) {
        await new Promise(resolve => setTimeout(resolve, 1000 - diff));
    }

    let lastError;
    const maxRetries = 2;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`[DahmerMovies] Fetching: ${url} (Attempt ${i + 1}/${maxRetries})`);
            
            const response = await gotScraping({
                url: url,
                method: options.method || 'GET',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Referer': `${DAHMER_MOVIES_API}/`,
                    ...options.headers
                },
                headerGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 110 }],
                    devices: ['desktop'],
                    locales: ['en-US']
                },
                timeout: { request: TIMEOUT },
                retry: { limit: 0 },
                ...options
            });
            
            lastDahmerRequestTime = Date.now();
            const body = response.body;
            const pageTitle = body.match(/<title>(.*?)<\/title>/i)?.[1]?.toLowerCase() || "";
            
            if (body.includes('cf-challenge') || body.includes('Just a moment') || pageTitle.includes('just a moment') || body.length < 5000) {
                if (body.length < 5000 && !body.includes('</html>')) {
                     throw new Error('Truncated response');
                }
                if (body.includes('cf-challenge') || pageTitle.includes('just a moment')) {
                     throw new Error('Cloudflare challenge detected');
                }
            }

            return { body, status: response.statusCode };
        } catch (error) {
            lastError = error;
            console.log(`[DahmerMovies] attempt failed: ${error.message}`);
            if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 2000));
        }
    }

    // Last resort: simple node-fetch
    console.log(`[DahmerMovies] node-fetch fallback: ${url}`);
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': `${DAHMER_MOVIES_API}/`
            },
            timeout: 15000
        });
        const body = await response.text();
        if (response.ok && body.length > 5000) {
            return { body, status: response.status };
        }
        throw new Error(`node-fetch failed with status ${response.status} or small body (${body.length})`);
    } catch (error) {
        console.log(`[DahmerMovies] fallback failed: ${error.message}`);
        throw lastError;
    }
}

// Utility functions
function getEpisodeSlug(season = null, episode = null) {
    if (season === null && episode === null) return ['', ''];
    const s = season < 10 ? `0${season}` : `${season}`;
    const e = episode < 10 ? `0${episode}` : `${episode}`;
    return [s, e];
}

function getIndexQuality(str) {
    if (!str) return 0;
    const match = str.match(/(\d{3,4})[pP]/);
    return match ? parseInt(match[1]) : 0;
}

function getQualityWithCodecs(str) {
    if (!str) return 'Unknown';
    const qualityMatch = str.match(/(\d{3,4})[pP]/);
    const baseQuality = qualityMatch ? `${qualityMatch[1]}p` : 'Unknown';
    const codecs = [];
    const lowerStr = str.toLowerCase();
    if (lowerStr.includes('dv') || lowerStr.includes('dolby vision')) codecs.push('DV');
    if (lowerStr.includes('hdr10+')) codecs.push('HDR10+');
    else if (lowerStr.includes('hdr10') || lowerStr.includes('hdr')) codecs.push('HDR');
    if (lowerStr.includes('remux')) codecs.push('REMUX');
    if (lowerStr.includes('imax')) codecs.push('IMAX');
    return codecs.length > 0 ? `${baseQuality} | ${codecs.join(' | ')}` : baseQuality;
}

function formatFileSize(sizeInput) {
    if (!sizeInput) return null;
    if (typeof sizeInput === 'string' && /\d+(\.\d+)?\s*(GB|MB|KB|TB)/i.test(sizeInput)) return sizeInput;
    const bytes = parseInt(sizeInput);
    if (isNaN(bytes) || bytes < 0) return sizeInput;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}

function parseLinks(html) {
    const $ = cheerio.load(html);
    const links = [];
    $('tr[data-entry="true"]').each((i, el) => {
        const row = $(el);
        const link = row.find('a').first();
        const href = link.attr('href');
        const text = link.text().trim();
        let size = row.find('td.size').attr('data-sort');
        if (!size || size === "-1") size = row.find('td.size').text().trim();
        if (text && href && href !== '../') links.push({ text, href, size });
    });
    return links;
}

function levenshteinDistance(s, t) {
    if (s === t) return 0;
    const n = s.length, m = t.length;
    if (n === 0) return m; if (m === 0) return n;
    const d = [];
    for (let i = 0; i <= n; i++) { d[i] = []; d[i][0] = i; }
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        }
    }
    return d[n][m];
}

async function findFolderFuzzy(baseUrl, targetName) {
    try {
        const { body } = await makeRequest(baseUrl);
        const folders = parseLinks(body);
        const cleanTarget = targetName.toLowerCase().replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        
        let bestMatch = null;
        let minDistance = 10;

        for (const folder of folders) {
            const folderName = folder.text.replace(/\/$/, '').toLowerCase();
            const cleanFolder = folderName.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
            
            if (cleanFolder === cleanTarget) return folder;
            
            const distance = levenshteinDistance(cleanFolder, cleanTarget);
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = folder;
            }
        }
        return bestMatch;
    } catch (e) {
        console.log(`[DahmerMovies] Fuzzy search failed: ${e.message}`);
        return null;
    }
}

async function invokeDahmerMovies(title, year, season = null, episode = null) {
    console.log(`Step 2: Database/Provider Lookup`);
    
    // Pattern 1: Direct URL
    let folderUrl;
    if (season === null) {
        folderUrl = `${DAHMER_MOVIES_API}/movies/${encodeURIComponent(title)}%20%28${year}%29/`;
    } else {
        folderUrl = `${DAHMER_MOVIES_API}/tvs/${encodeURIComponent(title)}/Season%20${season}/`;
    }

    let html;
    try {
        const response = await makeRequest(folderUrl);
        html = response.body;
    } catch (e) {
        console.log(`[DahmerMovies] Direct URL failed, trying fuzzy matching...`);
        const searchBase = season === null ? `${DAHMER_MOVIES_API}/movies/` : `${DAHMER_MOVIES_API}/tvs/`;
        const folder = await findFolderFuzzy(searchBase, title + (season === null ? ` (${year})` : ''));
        if (!folder) return [];
        
        console.log(`[DahmerMovies] Fuzzy match found: ${folder.text}`);
        const tvBaseUrl = folder.href.startsWith('http') ? folder.href : `${DAHMER_MOVIES_API}${folder.href}`;
        folderUrl = season === null ? tvBaseUrl : `${tvBaseUrl.endsWith('/') ? tvBaseUrl : tvBaseUrl + '/'}Season ${season}/`;
        
        try {
            const response = await makeRequest(folderUrl);
            html = response.body;
        } catch (e2) {
            return [];
        }
    }

    const paths = parseLinks(html);
    let filteredPaths = season === null 
        ? paths.filter(p => /(1080p|2160p)/i.test(p.text))
        : paths.filter(p => new RegExp(`S${getEpisodeSlug(season, episode)[0]}E${getEpisodeSlug(season, episode)[1]}`, 'i').test(p.text));

    if (filteredPaths.length === 0) return [];

    console.log(`Step 3: Stream Resolution`);
    const results = filteredPaths.map(path => {
        let url = path.href.startsWith('http') ? path.href : (path.href.startsWith('/') ? `${DAHMER_MOVIES_API}${path.href}` : `${folderUrl.endsWith('/') ? folderUrl : folderUrl + '/'}${path.href}`);
        return {
            name: "DahmerMovies",
            title: `DahmerMovies ${path.text}`,
            url: url,
            quality: getQualityWithCodecs(path.text),
            size: formatFileSize(path.size),
            headers: { 'User-Agent': USER_AGENT, 'Referer': folderUrl },
            provider: "dahmermovies",
            behaviorHints: { bingeGroup: `DahmerMovies-${path.text.includes('2160p') ? '4K' : 'HD'}` }
        };
    });

    return results.sort((a, b) => getIndexQuality(b.title) - getIndexQuality(a.title));
}

async function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`Step 1: TMDB Details`);
    try {
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const response = await fetch(tmdbUrl);
        const data = await response.json();
        const title = mediaType === 'tv' ? data.name : data.title;
        const year = (mediaType === 'tv' ? data.first_air_date : data.release_date)?.substring(0, 4);
        if (!title) return [];
        console.log(`[DahmerMovies] TMDB: "${title}" (${year})`);
        return await invokeDahmerMovies(title, year ? parseInt(year) : null, seasonNum, episodeNum);
    } catch (e) {
        console.error(`[DahmerMovies] Error in getStreams: ${e.message}`);
        return [];
    }
}

module.exports = { getStreams };
