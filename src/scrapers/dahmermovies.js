// Dahmer Movies Scraper for Nuvio Local Scrapers
// Refactored to use async/await and got-scraping for stealth metadata retrieval

const cheerio = require('cheerio');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const TIMEOUT = 60000; // 60 seconds

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

// Helper function to make HTTP requests using got-scraping
async function makeRequest(url, options = {}) {
    const { gotScraping } = await import('got-scraping');
    
    let lastError;
    const maxRetries = 3;
    
    // Throttling: Implement a small delay between rapid consecutive calls to avoid rate limits (GEMINI.md mandate)
    if (global.lastDahmerRequestTime) {
        const now = Date.now();
        const diff = now - global.lastDahmerRequestTime;
        if (diff < 200) {
            await new Promise(resolve => setTimeout(resolve, 200 - diff));
        }
    }
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await gotScraping({
                url: url,
                method: options.method || 'GET',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Connection': 'keep-alive',
                    ...options.headers
                },
                headerGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 120 }],
                    devices: ['desktop'],
                    locales: ['en-US']
                },
                timeout: { request: TIMEOUT },
                retry: { limit: 2 },
                ...options
            });
            
            global.lastDahmerRequestTime = Date.now();

            // Check for truncated responses (common on this server)
            const body = response.body;
            if (typeof body === 'string' && body.length > 0) {
                const isHtml = body.trim().startsWith('<!DOCTYPE') || body.trim().startsWith('<html');
                if (isHtml) {
                    const isTruncated = !body.toLowerCase().includes('</html>');
                    if (isTruncated) {
                        throw new Error(`Response truncated (length: ${body.length})`);
                    }
                }
            }

            return response;
        } catch (error) {
            lastError = error;
            console.log(`[DahmerMovies] Request failed (attempt ${i + 1}/${maxRetries}): ${error.message}`);
            if (i < maxRetries - 1) {
                const delay = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    if (lastError.response) {
        throw new Error(`HTTP ${lastError.response.statusCode}: ${lastError.response.statusMessage}`);
    }
    throw lastError;
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
    
    // Extract codec information (excluding HEVC and bit depth)
    const codecs = [];
    const lowerStr = str.toLowerCase();
    
    // HDR formats
    if (lowerStr.includes('dv') || lowerStr.includes('dolby vision')) codecs.push('DV');
    if (lowerStr.includes('hdr10+')) codecs.push('HDR10+');
    else if (lowerStr.includes('hdr10') || lowerStr.includes('hdr')) codecs.push('HDR');
    
    // Special formats
    if (lowerStr.includes('remux')) codecs.push('REMUX');
    if (lowerStr.includes('imax')) codecs.push('IMAX');
    
    // Combine quality with codecs using pipeline separator
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
    
    // If it's already formatted (contains GB, MB, etc.), return as is
    if (typeof sizeInput === 'string' && /\d+(\.\d+)?\s*(GB|MB|KB|TB)/i.test(sizeInput)) {
        return sizeInput;
    }
    
    // If it's a number (bytes), convert to human readable
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
        
        // Extract size from data-sort or text
        let size = row.find('td.size').attr('data-sort');
        if (!size || size === "-1") {
            size = row.find('td.size').text().trim();
        }

        if (text && href && href !== '../' && text !== '../') {
            links.push({ text, href, size });
        }
    });
    
    // Fallback if no data-entry rows found
    if (links.length === 0) {
        $('tr').each((i, el) => {
            const row = $(el);
            const link = row.find('a').first();
            const href = link.attr('href');
            const text = link.text().trim();
            
            if (!text || href === '../' || text === '../') return;

            // Try to find size in the same row
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

// Main Dahmer Movies fetcher function
async function invokeDahmerMovies(title, year, season = null, episode = null) {
    const mediaContext = season === null ? `movie` : `tv`;
    console.log(`Step 2: Database/Provider Lookup (${mediaContext})`);
    console.log(`[DahmerMovies] Searching for: ${title} (${year})${season ? ` Season ${season}` : ''}${episode ? ` Episode ${episode}` : ''}`);
    
    // Construct URL based on content type (with proper encoding)
    const encodedUrl = season === null 
        ? `${DAHMER_MOVIES_API}/movies/${encodeURIComponent(title.replace(/:/g, '') + ' (' + year + ')')}/`
        : `${DAHMER_MOVIES_API}/tvs/${encodeURIComponent(title.replace(/:/g, ' -'))}/Season ${season}/`;
    
    console.log(`[DahmerMovies] Fetching from: ${encodedUrl}`);
    
    try {
        const response = await makeRequest(encodedUrl);
        const html = response.body;
        
        console.log(`[DahmerMovies] Response length: ${html.length}`);
        
        // Parse HTML to extract links
        const paths = parseLinks(html);
        console.log(`[DahmerMovies] Found ${paths.length} total links`);
        
        // Filter based on content type
        let filteredPaths;
        if (season === null) {
            // For movies, filter by quality (1080p or 2160p)
            filteredPaths = paths.filter(path => 
                /(1080p|2160p)/i.test(path.text)
            );
            console.log(`[DahmerMovies] Filtered to ${filteredPaths.length} movie links (1080p/2160p only)`);
        } else {
            // For TV shows, filter by season and episode
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
        
        // Process and return results
        const results = filteredPaths.map(path => {
            const quality = getIndexQuality(path.text);
            const qualityWithCodecs = getQualityWithCodecs(path.text);
            const tags = getIndexQualityTags(path.text);
            
            // Construct proper URL - handle relative and absolute paths correctly
            let fullUrl;
            if (path.href.startsWith('http')) {
                fullUrl = path.href;
            } else if (path.href.startsWith('/')) {
                // Absolute path from root
                fullUrl = `${DAHMER_MOVIES_API}${path.href}`;
            } else {
                // Relative path
                const baseUrl = encodedUrl.endsWith('/') ? encodedUrl : encodedUrl + '/';
                fullUrl = baseUrl + path.href;
            }
            
            return {
                name: "DahmerMovies",
                title: `DahmerMovies ${tags || path.text}`,
                url: fullUrl,
                quality: qualityWithCodecs, // Use enhanced quality with codecs
                size: formatFileSize(path.size), // Format file size
                headers: {}, // No special headers needed for direct downloads
                provider: "dahmermovies", // Provider identifier
                filename: path.text,
                behaviorHints: {
                    bingeGroup: `DahmerMovies-${path.text.includes('2160p') ? '4K' : 'HD'}`
                }
            };
        });
        
        // Sort by quality (highest first)
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
        // Get TMDB info
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResponse = await makeRequest(tmdbUrl, { responseType: 'json' });
        const tmdbData = tmdbResponse.body;
        
        const title = mediaType === 'tv' ? tmdbData.name : tmdbData.title;
        const year = mediaType === 'tv' ? tmdbData.first_air_date?.substring(0, 4) : tmdbData.release_date?.substring(0, 4);

        if (!title) {
            throw new Error('Could not extract title from TMDB response');
        }

        console.log(`[DahmerMovies] TMDB Info: "${title}" (${year})`);

        // Call the main scraper function
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

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    // For environment where module is not defined (if applicable)
    if (typeof global !== 'undefined') {
        global.getStreams = getStreams;
    }
}
