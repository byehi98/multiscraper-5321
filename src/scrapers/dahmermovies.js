// Dahmer Movies Scraper for Nuvio Local Scrapers
// Refactored to use async/await and got-scraping with node-fetch fallback to bypass Cloudflare

const fetch = require('node-fetch');
const cheerio = require('cheerio');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const TIMEOUT = 20000; // 20 seconds

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

// Quality mapping
const Qualities = {
    Unknown: 0,
    P144: 144,
    P240: 240,
    P360: 360,
    P480: 480,
    P720: 720,
    P1080: 1080,
    P1440: 1440,
    P2160: 2160
};

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
    const maxRetries = 2; // Total retries for got-scraping
    
    // Attempt with got-scraping first
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`[DahmerMovies] Fetching (got-scraping): ${url} (Attempt ${i + 1}/${maxRetries})`);
            
            const response = await gotScraping({
                url: url,
                method: options.method || 'GET',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    ...options.headers
                },
                headerGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 110 }],
                    devices: ['desktop'],
                    locales: ['en-US', 'en']
                },
                timeout: { request: 20000 },
                retry: { limit: 1 },
                ...options
            });
            
            lastDahmerRequestTime = Date.now();
            const body = response.body;
            const pageTitle = body.match(/<title>(.*?)<\/title>/i)?.[1]?.toLowerCase() || "";
            
            if (body.includes('cf-challenge') || body.includes('Just a moment') || pageTitle.includes('just a moment') || body.length < 6000) {
                console.log(`[DahmerMovies] got-scraping returned challenge or small body (${body.length})`);
                throw new Error('Cloudflare/Truncated');
            }

            return { body, status: response.statusCode };
        } catch (error) {
            lastError = error;
            console.log(`[DahmerMovies] got-scraping attempt failed: ${error.message}`);
            if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 2000));
        }
    }

    // Fallback to node-fetch (the 4khdhub.js method)
    console.log(`[DahmerMovies] Falling back to node-fetch for: ${url}`);
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                ...options.headers
            },
            timeout: 15000
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.text();
        const pageTitle = body.match(/<title>(.*?)<\/title>/i)?.[1]?.toLowerCase() || "";
        
        if (body.length > 6000 && body.toLowerCase().includes('</html>') && !pageTitle.includes('just a moment')) {
            console.log(`[DahmerMovies] node-fetch success (length: ${body.length})`);
            return { body, status: response.status };
        }
        throw new Error(`node-fetch also returned challenge or small body (${body.length})`);
    } catch (error) {
        console.log(`[DahmerMovies] node-fetch fallback failed: ${error.message}`);
        throw lastError; // Throw the original got-scraping error if fallback also fails
    }
}

// Utility functions
function getEpisodeSlug(season = null, episode = null) {
    if (season === null && episode === null) {
        return ['', ''];
    }
    const seasonSlug = season < 10 ? `0${season}` : `${season}`;
    const episodeSlug = episode < 10 ? `0${episode}` : `${episode}`;
    return [seasonSlug, episodeSlug];
}

function getIndexQuality(str) {
    if (!str) return Qualities.Unknown;
    const match = str.match(/(\d{3,4})[pP]/);
    return match ? parseInt(match[1]) : Qualities.Unknown;
}

// Extract quality with codec information
function getQualityWithCodecs(str) {
    if (!str) return 'Unknown';
    
    // Extract base quality (resolution)
    const qualityMatch = str.match(/(\d{3,4})[pP]/);
    const baseQuality = qualityMatch ? `${qualityMatch[1]}p` : 'Unknown';
    
    // Extract codec information
    const codecs = [];
    const lowerStr = str.toLowerCase();
    
    // HDR formats
    if (lowerStr.includes('dv') || lowerStr.includes('dolby vision')) codecs.push('DV');
    if (lowerStr.includes('hdr10+')) codecs.push('HDR10+');
    else if (lowerStr.includes('hdr10') || lowerStr.includes('hdr')) codecs.push('HDR');
    
    // Special formats
    if (lowerStr.includes('remux')) codecs.push('REMUX');
    if (lowerStr.includes('imax')) codecs.push('IMAX');
    
    // Combine quality with codecs
    if (codecs.length > 0) {
        return `${baseQuality} | ${codecs.join(' | ')}`;
    }
    
    return baseQuality;
}

function getIndexQualityTags(str, fullTag = false) {
    if (!str) return '';
    
    if (fullTag) {
        const match = str.match(/(.*)\.(?:mkv|mp4|avi)/i);
        return match ? match[1].trim() : str;
    } else {
        const match = str.match(/\d{3,4}[pP]\.?(.*?)\.(mkv|mp4|avi)/i);
        return match ? match[1].replace(/\./g, ' ').trim() : str;
    }
}

// Format file size from bytes to human readable format
function formatFileSize(sizeInput) {
    if (!sizeInput) return null;
    
    if (typeof sizeInput === 'string' && /\d+(\.\d+)?\s*(GB|MB|KB|TB)/i.test(sizeInput)) {
        return sizeInput;
    }
    
    const bytes = parseInt(sizeInput);
    if (isNaN(bytes) || bytes < 0) return sizeInput;
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(2);
    
    return `${parseFloat(size)} ${sizes[i]}`;
}

// Parse HTML using cheerio
function parseLinks(html) {
    const $ = cheerio.load(html);
    const links = [];

    $('tr[data-entry="true"]').each((i, el) => {
        const row = $(el);
        const link = row.find('a').first();
        const href = link.attr('href');
        const text = link.text().trim();
        
        let size = row.find('td.size').attr('data-sort');
        if (!size || size === "-1") {
            size = row.find('td.size').text().trim();
        }

        if (text && href && href !== '../' && text !== '../') {
            links.push({ text, href, size });
        }
    });
    
    if (links.length === 0) {
        $('tr').each((i, el) => {
            const row = $(el);
            const link = row.find('a').first();
            const href = link.attr('href');
            const text = link.text().trim();
            
            if (!text || href === '../' || text === '../') return;

            let size = null;
            row.find('td').each((j, td) => {
                const tdText = $(td).text().trim();
                if (/\d+(\.\d+)?\s*(GB|MB|KB|B)/i.test(tdText)) {
                    size = tdText;
                }
            });

            links.push({ text, href, size });
        });
    }
    
    return links;
}

function levenshteinDistance(s, t) {
    if (s === t) return 0;
    const n = s.length;
    const m = t.length;
    if (n === 0) return m;
    if (m === 0) return n;
    const d = [];
    for (let i = 0; i <= n; i++) {
        d[i] = [];
        d[i][0] = i;
    }
    for (let j = 0; j <= m; j++) {
        d[0][j] = j;
    }
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        }
    }
    return d[n][m];
}

// Main Dahmer Movies fetcher function
async function invokeDahmerMovies(title, year, season = null, episode = null) {
    const mediaContext = season === null ? `movie` : `tv`;
    console.log(`Step 2: Database/Provider Lookup (${mediaContext})`);
    console.log(`[DahmerMovies] Searching for: ${title} (${year})${season ? ` Season ${season}` : ''}${episode ? ` Episode ${episode}` : ''}`);
    
    // Step 2a: Find the correct directory using fuzzy matching
    const searchBaseUrl = season === null ? `${DAHMER_MOVIES_API}/movies/` : `${DAHMER_MOVIES_API}/tvs/`;
    let folderUrl;
    
    try {
        const { body: listHtml } = await makeRequest(searchBaseUrl);
        const folders = parseLinks(listHtml);
        
        const targetName = season === null 
            ? `${title} (${year})`.toLowerCase()
            : title.toLowerCase();
            
        let bestMatch = null;
        let minDistance = 10; // Threshold for fuzzy match
        
        for (const folder of folders) {
            const folderName = folder.text.replace(/\/$/, '').toLowerCase();
            const distance = levenshteinDistance(folderName, targetName);
            
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = folder;
            }
            
            // Exact match including cleanup
            const cleanFolderName = folderName.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
            const cleanTargetName = targetName.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanFolderName === cleanTargetName) {
                bestMatch = folder;
                break;
            }
        }
        
        if (!bestMatch) {
            console.log(`[DahmerMovies] No matching folder found for "${targetName}"`);
            return [];
        }
        
        console.log(`[DahmerMovies] Found best match folder: "${bestMatch.text}"`);
        
        if (season === null) {
            folderUrl = bestMatch.href.startsWith('http') ? bestMatch.href : `${DAHMER_MOVIES_API}${bestMatch.href}`;
        } else {
            const tvBaseUrl = bestMatch.href.startsWith('http') ? bestMatch.href : `${DAHMER_MOVIES_API}${bestMatch.href}`;
            folderUrl = `${tvBaseUrl.endsWith('/') ? tvBaseUrl : tvBaseUrl + '/'}Season ${season}/`;
        }
        
    } catch (error) {
        console.log(`[DahmerMovies] Error finding folder: ${error.message}`);
        return [];
    }
    
    try {
        const { body: html } = await makeRequest(folderUrl);
        
        console.log(`[DahmerMovies] Response length: ${html.length}`);
        
        const paths = parseLinks(html);
        console.log(`[DahmerMovies] Found ${paths.length} total links`);
        
        let filteredPaths;
        if (season === null) {
            filteredPaths = paths.filter(path => 
                /(1080p|2160p)/i.test(path.text)
            );
            console.log(`[DahmerMovies] Filtered to ${filteredPaths.length} movie links (1080p/2160p only)`);
        } else {
            const [seasonSlug, episodeSlug] = getEpisodeSlug(season, episode);
            const episodePattern = new RegExp(`S${seasonSlug}E${episodeSlug}`, 'i');
            filteredPaths = paths.filter(path => 
                episodePattern.test(path.text)
            );
            console.log(`[DahmerMovies] Filtered to ${filteredPaths.length} TV episode links (S${seasonSlug}E${episodeSlug})`);
        }
        
        if (filteredPaths.length === 0) {
            console.log('[DahmerMovies] No matching content found');
            return [];
        }
        
        console.log(`Step 3: Stream Resolution`);
        
        const results = filteredPaths.map(path => {
            const quality = getIndexQuality(path.text);
            const qualityWithCodecs = getQualityWithCodecs(path.text);
            const tags = getIndexQualityTags(path.text);
            
            let fullUrl;
            if (path.href.startsWith('http')) {
                fullUrl = path.href;
            } else if (path.href.startsWith('/')) {
                fullUrl = `${DAHMER_MOVIES_API}${path.href}`;
            } else {
                const baseUrl = folderUrl.endsWith('/') ? folderUrl : folderUrl + '/';
                fullUrl = baseUrl + path.href;
            }
            
            return {
                name: "DahmerMovies",
                title: `DahmerMovies ${tags || path.text}`,
                url: fullUrl,
                quality: qualityWithCodecs,
                size: formatFileSize(path.size),
                headers: { 'User-Agent': USER_AGENT },
                provider: "dahmermovies",
                filename: path.text,
                behaviorHints: {
                    bingeGroup: `DahmerMovies-${path.text.includes('2160p') ? '4K' : 'HD'}`
                }
            };
        });
        
        results.sort((a, b) => {
            const qualityA = getIndexQuality(a.filename);
            const qualityB = getIndexQuality(b.filename);
            return qualityB - qualityA;
        });
        
        console.log(`[DahmerMovies] Successfully processed ${results.length} streams`);
        return results;
    } catch (error) {
        console.log(`[DahmerMovies] Error in invokeDahmerMovies: ${error.message}`);
        return [];
    }
}

// Main function to get streams for TMDB content
async function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`Step 1: TMDB Details`);
    console.log(`[DahmerMovies] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);

    try {
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const response = await fetch(tmdbUrl);
        const tmdbData = await response.json();
        
        const title = mediaType === 'tv' ? tmdbData.name : tmdbData.title;
        const year = mediaType === 'tv' ? tmdbData.first_air_date?.substring(0, 4) : tmdbData.release_date?.substring(0, 4);

        if (!title) {
            throw new Error('Could not extract title from TMDB response');
        }

        console.log(`[DahmerMovies] TMDB Info: "${title}" (${year})`);

        return await invokeDahmerMovies(
            title,
            year ? parseInt(year) : null,
            seasonNum,
            episodeNum
        );
        
    } catch (error) {
        console.error(`[DahmerMovies] Error in getStreams: ${error.message}`);
        return [];
    }
}

module.exports = { getStreams };
