const cheerio = require('cheerio');

// DVDPlay scraper for Nuvio
// Scrapes content from dvdplay.skin with HubCloud link extraction

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const BASE_URL = 'https://dvdplay.skin';

// Temporarily disable URL validation for faster results
global.URL_VALIDATION_ENABLED = true;

// Utility functions
function getBaseUrl(url) {
    try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.host}`;
    } catch (e) {
        return '';
    }
}

function base64Decode(str) {
    try {
        return Buffer.from(str, 'base64').toString('utf-8');
    } catch (e) {
        return '';
    }
}

function rot13(str) {
    return (str || '').replace(/[A-Za-z]/g, function (char) {
        var start = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(((char.charCodeAt(0) - start + 13) % 26) + start);
    });
}

function normalizeTitle(title) {
    return (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function calculateSimilarity(str1, str2) {
    var s1 = normalizeTitle(str1);
    var s2 = normalizeTitle(str2);
    if (s1 === s2) return 1.0;
    var len1 = s1.length;
    var len2 = s2.length;
    if (len1 === 0) return len2 === 0 ? 1.0 : 0.0;
    if (len2 === 0) return 0.0;
    var matrix = Array(len1 + 1).fill(null).map(function () { return Array(len2 + 1).fill(0); });
    for (var i = 0; i <= len1; i++) matrix[i][0] = i;
    for (var j = 0; j <= len2; j++) matrix[0][j] = j;
    for (i = 1; i <= len1; i++) {
        for (j = 1; j <= len2; j++) {
            var cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    var maxLen = Math.max(len1, len2);
    return (maxLen - matrix[len1][len2]) / maxLen;
}

async function makeRequest(gotScraping, url, options = {}) {
    try {
        const response = await gotScraping({
            url: url,
            method: options.method || 'GET',
            headers: {
                'Referer': BASE_URL,
                ...options.headers
            },
            followRedirect: options.allowRedirects !== false,
            timeout: { request: 30000 },
            retry: { limit: 2 }
        });

        if (options.parseHTML) {
            const $ = cheerio.load(response.body);
            return { $: $, body: response.body, statusCode: response.statusCode, headers: response.headers };
        }
        return { body: response.body, statusCode: response.statusCode, headers: response.headers };
    } catch (error) {
        if (options.allowRedirects === false && error.response && [301, 302, 303, 307, 308].includes(error.response.statusCode)) {
            return { statusCode: error.response.statusCode, headers: error.response.headers };
        }
        throw error;
    }
}

function getIndexQuality(str) {
    const match = (str || '').match(/(\d{3,4})[pP]/);
    return match ? parseInt(match[1]) : null;
}

function decodeFilename(filename) {
    if (!filename) return filename;
    try {
        let decoded = filename;
        if (decoded.startsWith('UTF-8')) decoded = decoded.substring(5);
        decoded = decodeURIComponent(decoded);
        return decoded;
    } catch (error) {
        return filename;
    }
}

function cleanTitle(title) {
    const decodedTitle = decodeFilename(title);
    const parts = decodedTitle.split(/[.\-_]/);
    const qualityTags = ['WEBRip', 'WEB-DL', 'WEB', 'BluRay', 'HDRip', 'DVDRip', 'HDTV', 'CAM', 'TS', 'R5', 'DVDScr', 'BRRip', 'BDRip', 'DVD', 'PDTV', 'HD'];
    const audioTags = ['AAC', 'AC3', 'DTS', 'MP3', 'FLAC', 'DD5', 'EAC3', 'Atmos'];
    const subTags = ['ESub', 'ESubs', 'Subs', 'MultiSub', 'NoSub', 'EnglishSub', 'HindiSub'];
    const codecTags = ['x264', 'x265', 'H264', 'HEVC', 'AVC'];

    const startIndex = parts.findIndex(part =>
        qualityTags.some(tag => part.toLowerCase().includes(tag.toLowerCase()))
    );

    const endIndex = parts.map((part, index) => {
        const hasTag = [...subTags, ...audioTags, ...codecTags].some(tag =>
            part.toLowerCase().includes(tag.toLowerCase())
        );
        return hasTag ? index : -1;
    }).filter(index => index !== -1).pop() || -1;

    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
        return parts.slice(startIndex, endIndex + 1).join('.');
    } else if (startIndex !== -1) {
        return parts.slice(startIndex).join('.');
    } else {
        return parts.slice(-3).join('.');
    }
}

async function getFilenameFromUrl(gotScraping, url) {
    try {
        const response = await gotScraping({
            url: url,
            method: 'HEAD',
            timeout: { request: 10000 },
            followRedirect: true
        });
        const contentDisposition = response.headers['content-disposition'];
        let filename = null;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
            if (filenameMatch && filenameMatch[1]) {
                filename = filenameMatch[1].replace(/["']/g, '');
            }
        }
        if (!filename) {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            filename = pathParts[pathParts.length - 1];
            if (filename && filename.includes('.')) {
                filename = filename.replace(/\.[^.]+$/, '');
            }
        }
        return decodeFilename(filename) || null;
    } catch (error) {
        return null;
    }
}

async function extractHubCloudLinks(gotScraping, url) {
    var origin;
    try { origin = new URL(url).origin; } catch (e) { origin = ''; }

    function toAbsolute(href, base) {
        try { return new URL(href, base).href; } catch (e) { return href; }
    }

    try {
        const response = await makeRequest(gotScraping, url, { parseHTML: true });
        const $ = response.$;
        var href;
        if (url.indexOf('hubcloud.php') !== -1) {
            href = url;
        } else {
            var tokenMatch = url.match(/\/video\/([^\/\?]+)(\?token=([^&\s]+))?/);
            if (tokenMatch) {
                var videoId = tokenMatch[1];
                var token = tokenMatch[3];
                if (!token) {
                    var tokenFromPage = $.html().match(/token=([^"'\s&]+)/);
                    if (tokenFromPage) token = tokenFromPage[1];
                }
                href = token ? `${origin}/video/${videoId}?token=${token}` : url;
            } else {
                var rawHref = $('#download').attr('href') || $('a[href*="hubcloud.php"]').attr('href') || $('.download-btn').attr('href') || $('a[href*="download"]').attr('href');
                if (!rawHref) throw new Error('Download element not found');
                href = toAbsolute(rawHref, origin);
            }
        }

        const secondResponse = await makeRequest(gotScraping, href, { parseHTML: true });
        const $$ = secondResponse.$;

        async function resolveHubCloudUrl(url) {
            if (url.includes('r2.cloudflarestorage.com')) return url;
            if (url.includes('360news4u.net/dl.php?link=')) {
                const linkMatch = url.match(/360news4u\.net\/dl\.php\?link=([^&\s]+)/);
                if (linkMatch && linkMatch[1]) return decodeURIComponent(linkMatch[1]);
            }
            if (url.includes('video-downloads.googleusercontent.com')) return url;

            try {
                const res = await gotScraping({
                    url: url,
                    method: 'GET',
                    followRedirect: false,
                    throwHttpErrors: false
                });

                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return await resolveHubCloudUrl(res.headers.location);
                }
                if (res.statusCode === 200) {
                    if (res.headers['content-type']?.includes('video/')) return url;
                    const directUrlMatch = res.body.match(/(https?:\/\/[^"'\s]+\.r2\.cloudflarestorage\.com[^"'\s]*)/);
                    if (directUrlMatch) return directUrlMatch[1];
                    const otherDirectMatch = res.body.match(/(https?:\/\/[^"'\s]+\/[^"'\s]*\.(mkv|mp4|avi|m4v)[^"'\s]*)/i);
                    if (otherDirectMatch) return otherDirectMatch[1];
                }
                return url;
            } catch (e) {
                return url;
            }
        }

        async function buildTask(buttonText, buttonLink, headerDetails, size, quality) {
            const qualityLabel = quality ? (' - ' + quality + 'p') : ' - Unknown';
            const pd = buttonLink.match(/pixeldrain\.(?:net|dev)\/u\/([a-zA-Z0-9]+)/);
            if (pd && pd[1]) buttonLink = 'https://pixeldrain.net/api/file/' + pd[1];

            let resolvedUrl = buttonLink;
            if (buttonLink.includes('.fans/?id=') || buttonLink.includes('.workers.dev/?id=') || buttonLink.includes('360news4u.net/dl.php')) {
                resolvedUrl = await resolveHubCloudUrl(buttonLink);
            }

            const actualFilename = await getFilenameFromUrl(gotScraping, resolvedUrl);
            const displayFilename = actualFilename || headerDetails || 'Unknown';
            const finalTitle = [displayFilename, size].filter(Boolean).join('\n');

            let name = 'DVDPlay - HubCloud' + qualityLabel;
            if (buttonText.includes('FSL Server')) name = 'DVDPlay - FSL Server' + qualityLabel;
            else if (buttonText.includes('S3 Server')) name = 'DVDPlay - S3 Server' + qualityLabel;
            else if (/pixeldra/i.test(buttonText) || /pixeldra/i.test(buttonLink)) name = 'DVDPlay - Pixeldrain' + qualityLabel;

            return {
                name: name,
                title: finalTitle,
                url: resolvedUrl,
                quality: quality ? quality + 'p' : 'Unknown',
                size: size || null,
                fileName: actualFilename || null,
                type: 'direct',
                behaviorHints: { bingeGroup: `DVDPlay-HubCloud` }
            };
        }

        const tasks = [];
        const cards = $$('.card');
        if (cards.length > 0) {
            for (let i = 0; i < cards.length; i++) {
                const $card = $$(cards[i]);
                const header = $card.find('div.card-header').text() || $$('div.card-header').first().text() || '';
                const size = $card.find('i#size').text() || $$('i#size').first().text() || '';
                const quality = getIndexQuality(header);
                const headerDetails = cleanTitle(header);

                let localBtns = $card.find('div.card-body h2 a.btn');
                if (localBtns.length === 0) localBtns = $card.find('a.btn, .btn, a[href]');

                for (let j = 0; j < localBtns.length; j++) {
                    const $btn = $$(localBtns[j]);
                    const text = ($btn.text() || '').trim();
                    let link = $btn.attr('href');
                    if (!link) continue;
                    link = toAbsolute(link, href);
                    if (/(hubcloud|hubdrive|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|download|api\/file)/i.test(link) || text.toLowerCase().includes('download')) {
                        tasks.push(buildTask(text, link, headerDetails, size, quality));
                    }
                }
            }
        }

        if (tasks.length === 0) {
            let buttons = $$.root().find('div.card-body h2 a.btn');
            if (buttons.length === 0) buttons = $$.root().find('a.btn, .btn, a[href]');
            const size = $$('i#size').first().text() || '';
            const header = $$('div.card-header').first().text() || '';
            const quality = getIndexQuality(header);
            const headerDetails = cleanTitle(header);

            for (let i = 0; i < buttons.length; i++) {
                const $btn = $$(buttons[i]);
                const text = ($btn.text() || '').trim();
                let link = $btn.attr('href');
                if (!link) continue;
                link = toAbsolute(link, href);
                tasks.push(buildTask(text, link, headerDetails, size, quality));
            }
        }

        return (await Promise.all(tasks)).filter(Boolean);
    } catch (error) {
        console.error(`[DVDPlay] HubCloud extraction error:`, error.message);
        return [];
    }
}

async function searchContent(gotScraping, title, year) {
    const searchQuery = title.trim();
    const encodedQuery = searchQuery.replace(/\s+/g, '+');
    const searchUrl = `${BASE_URL}/search.php?q=${encodedQuery}`;

    console.log(`[DVDPlay] Searching for: "${searchQuery}" at ${searchUrl}`);

    try {
        const response = await makeRequest(gotScraping, searchUrl, { parseHTML: true });
        const $ = response.$;
        const results = [];

        $('a:has(p.home)').each((i, el) => {
            const movieUrl = new URL($(el).attr('href'), BASE_URL).href;
            const movieTitle = $(el).text().trim();
            results.push({ title: movieTitle, url: movieUrl });
        });

        console.log(`[DVDPlay] Found ${results.length} search results`);
        if (results.length === 0) return await searchFromMainPage(gotScraping, title);
        return results;
    } catch (error) {
        return await searchFromMainPage(gotScraping, title);
    }
}

async function searchFromMainPage(gotScraping, title) {
    console.log(`[DVDPlay] Attempting fallback search on main page`);
    try {
        const response = await makeRequest(gotScraping, BASE_URL, { parseHTML: true });
        const $ = response.$;
        const results = [];
        const titleLower = title.toLowerCase();

        $('a[href*="/page-"]').each((i, el) => {
            const pageUrl = new URL($(el).attr('href'), BASE_URL).href;
            const pageTitle = $(el).text().trim();
            if (titleLower.split(' ').some(word => word.length > 2 && pageTitle.toLowerCase().includes(word))) {
                results.push({ title: pageTitle, url: pageUrl });
            }
        });
        return results;
    } catch (e) {
        return [];
    }
}

async function extractDownloadLinks(gotScraping, pageUrl) {
    console.log(`[DVDPlay] Extracting download links from: ${pageUrl}`);
    try {
        const response = await makeRequest(gotScraping, pageUrl, { parseHTML: true });
        const $ = response.$;
        const downloadPageLinks = [];

        $('a.touch[href*="/download/file/"]').each((i, el) => {
            downloadPageLinks.push(new URL($(el).attr('href'), BASE_URL).href);
        });

        console.log(`[DVDPlay] Found ${downloadPageLinks.length} download pages`);
        return downloadPageLinks;
    } catch (e) {
        return [];
    }
}

async function processDownloadLink(gotScraping, downloadPageUrl) {
    try {
        const response = await makeRequest(gotScraping, downloadPageUrl, { parseHTML: true });
        const $ = response.$;
        const hubCloudUrls = [];

        $('a[href*="hubcloud."]').each((i, el) => {
            hubCloudUrls.push($(el).attr('href'));
        });

        const finalLinks = await Promise.all(hubCloudUrls.map(url => extractHubCloudLinks(gotScraping, url)));
        return finalLinks.flat();
    } catch (e) {
        return [];
    }
}

function findBestMatch(results, query) {
    if (!results || results.length === 0) return null;
    var scored = results.map(r => ({
        item: r,
        score: (normalizeTitle(r.title) === normalizeTitle(query) ? 100 : 0) + calculateSimilarity(r.title, query) * 50
    }));
    return scored.sort((a, b) => b.score - a.score)[0].item;
}

async function getTMDBDetails(gotScraping, tmdbId, mediaType) {
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    try {
        const response = await gotScraping({ url: url }).json();
        return {
            title: response.title || response.name,
            year: (response.release_date || response.first_air_date || '').split('-')[0]
        };
    } catch (e) {
        return null;
    }
}

async function validateVideoUrl(gotScraping, url) {
    try {
        const response = await gotScraping({
            url: url,
            method: 'HEAD',
            headers: { 'Range': 'bytes=0-1' },
            timeout: { request: 8000 },
            followRedirect: true
        });
        return response.statusCode === 200 || response.statusCode === 206;
    } catch (e) {
        return false;
    }
}

async function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const { gotScraping } = await import('got-scraping');
    console.log(`Step 1: TMDB Details [DVDPlay]`);
    const tmdbType = (mediaType === 'series' ? 'tv' : mediaType);
    const tmdb = await getTMDBDetails(gotScraping, tmdbId, tmdbType);
    if (!tmdb || !tmdb.title) return [];

    console.log(`Step 2: Mapping (Search) [DVDPlay]`);
    const searchResults = await searchContent(gotScraping, tmdb.title, tmdb.year);
    if (!searchResults || searchResults.length === 0) {
        console.log(`[DVDPlay] No search results found`);
        return [];
    }

    const selectedResult = findBestMatch(searchResults, tmdb.title);
    console.log(`Step 3: Stream Resolution [DVDPlay]`);
    const downloadLinks = await extractDownloadLinks(gotScraping, selectedResult.url);
    const nestedStreams = await Promise.all(downloadLinks.map(link => processDownloadLink(gotScraping, link)));
    
    let allStreams = nestedStreams.flat().filter(s => {
        const u = s.url.toLowerCase();
        return !u.includes('cdn.ampproject.org') && !u.includes('bloggingvector.shop') && !u.includes('winexch.com');
    });

    const uniqueStreams = Array.from(new Map(allStreams.map(s => [s.url, s])).values());
    
    if (global.URL_VALIDATION_ENABLED) {
        const validated = await Promise.all(uniqueStreams.map(async s => (await validateVideoUrl(gotScraping, s.url)) ? s : null));
        allStreams = validated.filter(Boolean);
    } else {
        allStreams = uniqueStreams;
    }

    return allStreams.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
