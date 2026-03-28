// Dahmer Movies Scraper for MultiScraper
// Optimized for stealth and efficiency using modern got-scraping patterns

const fetch = require('node-fetch');
const cheerio = require('cheerio');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const TIMEOUT = 20000; // 20 seconds
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Global to track request time for throttling
let lastDahmerRequestTime = 0;

// Helper function to make HTTP requests using got-scraping with advanced stealth
async function makeRequest(url, options = {}) {
    const { gotScraping } = await import('got-scraping');
    
    // Throttling: 1000ms delay between calls (GEMINI.md mandate)
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
                http2: true, // Force HTTP/2 for better stealth
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'max-age=0',
                    'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1',
                    ...options.headers
                },
                headerGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 124 }],
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
            
            // Validation: Check for challenge pages or truncated responses
            if (body.includes('cf-challenge') || body.includes('challenge-platform') || 
                body.includes('Just a moment') || pageTitle.includes('just a moment') || 
                pageTitle.includes('cloudflare')) {
                throw new Error('Cloudflare challenge detected');
            }
            
            if (body.length < 5000 || !body.toLowerCase().includes('</html>')) {
                throw new Error(`Response incomplete (length: ${body.length})`);
            }

            return { body, status: response.statusCode, headers: response.headers };
        } catch (error) {
            lastError = error;
            console.log(`[DahmerMovies] Request attempt failed: ${error.message}`);
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }
    
    // Last resort fallback: node-fetch (HTTP/1.1)
    console.log(`[DahmerMovies] Final fallback (node-fetch): ${url}`);
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 15000
        });
        const body = await response.text();
        const pageTitle = body.match(/<title>(.*?)<\/title>/i)?.[1]?.toLowerCase() || "";
        
        if (response.ok && body.length > 6000 && body.toLowerCase().includes('</html>') && !pageTitle.includes('just a moment')) {
            console.log(`[DahmerMovies] Fallback success (length: ${body.length})`);
            return { body, status: response.status };
        }
        throw new Error(`Fallback also failed or returned challenge (status: ${response.status}, length: ${body.length})`);
    } catch (error) {
        console.log(`[DahmerMovies] Fallback failed: ${error.message}`);
        throw lastError; // Throw the original got-scraping error
    }
}

// Utility functions
function getEpisodeSlug(season = null, episode = null) {
    if (season === null || episode === null) return ['', ''];
    const s = season < 10 ? `0${season}` : `${season}`;
    const e = episode < 10 ? `0${episode}` : `${episode}`;
    return [s, e];
}

function getQualityWithCodecs(str) {
    if (!str) return 'Unknown';
    const resMatch = str.match(/(\d{3,4})[pP]/);
    const base = resMatch ? `${resMatch[1]}p` : 'Unknown';
    const codecs = [];
    const lower = str.toLowerCase();
    if (lower.includes('dv') || lower.includes('dolby vision')) codecs.push('DV');
    if (lower.includes('hdr10+')) codecs.push('HDR10+');
    else if (lower.includes('hdr10') || lower.includes('hdr')) codecs.push('HDR');
    if (lower.includes('remux')) codecs.push('REMUX');
    if (lower.includes('imax')) codecs.push('IMAX');
    return codecs.length > 0 ? `${base} | ${codecs.join(' | ')}` : base;
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
        let minDistance = 15;

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
    
    // Strategy: Try direct URL first, then fuzzy match directory
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
        console.log(`[DahmerMovies] Direct URL hit failed, trying fuzzy directory match...`);
        const searchBase = season === null ? `${DAHMER_MOVIES_API}/movies/` : `${DAHMER_MOVIES_API}/tvs/`;
        const folder = await findFolderFuzzy(searchBase, title + (season === null ? ` (${year})` : ''));
        if (!folder) return [];
        
        console.log(`[DahmerMovies] Best match: "${folder.text}"`);
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
    return filteredPaths.map(path => {
        const url = path.href.startsWith('http') ? path.href : (path.href.startsWith('/') ? `${DAHMER_MOVIES_API}${path.href}` : `${folderUrl.endsWith('/') ? folderUrl : folderUrl + '/'}${path.href}`);
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
    }).sort((a, b) => {
        const qA = parseInt(a.quality) || 0;
        const qB = parseInt(b.quality) || 0;
        return qB - qA;
    });
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
        console.error(`[DahmerMovies] Error: ${e.message}`);
        return [];
    }
}

module.exports = { getStreams };
