const cheerio = require('cheerio');

// AllMovieLand Scraper for MultiScraper
// Adapted from provided source, refactored to Gold Standards

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const PRIMARY_URL = 'https://allmovieland.you';
const MIRROR_URLS = [
    'https://allmovieland.io',
    'https://allmovieland.one',
    'https://allmovieland.yt'
];

// Debug helpers
function log(msg, rid, extra) {
    const prefix = `[AllMovieLand]${rid ? `[rid:${rid}]` : ''}`;
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

    if (options.followRedirect === false) {
        requestOptions.followRedirect = false;
    }

    const response = await gotScraping(requestOptions);
    return response;
}

async function getTMDBDetails(tmdbId, mediaType, rid) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    
    for (let i = 0; i < 3; i++) {
        try {
            const response = await request(url, { responseType: 'json' });
            const data = response.body;
            const title = mediaType === 'tv' ? data.name : data.title;
            const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
            const year = releaseDate ? parseInt(releaseDate.split('-')[0]) : null;
            return { title, year, imdbId: data.external_ids?.imdb_id || null };
        } catch (e) {
            log(`TMDB error (attempt ${i + 1}): ${e.message}`, rid);
            if (i === 2) return null;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return null;
}

function normalizeTitle(title) {
    if (!title) return "";
    return title.toLowerCase().replace(/\b(the|a|an)\b/g, "").replace(/[:\-_]/g, " ").replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}

function calculateTitleSimilarity(title1, title2) {
    const norm1 = normalizeTitle(title1);
    const norm2 = normalizeTitle(title2);
    if (norm1 === norm2) return 1;
    const words1 = norm1.split(/\s+/).filter((w) => w.length > 0);
    const words2 = norm2.split(/\s+/).filter((w) => w.length > 0);
    if (words1.length === 0 || words2.length === 0) return 0;
    const set2 = new Set(words2);
    const intersection = words1.filter((w) => set2.has(w));
    const union = new Set([...words1, ...words2]);
    let score = intersection.length / union.size;
    if (words1.length > 0 && words1.every((w) => set2.has(w))) {
        score += 0.2;
    }
    return score;
}

function findBestTitleMatch(mediaInfo, searchResults) {
    if (!searchResults || searchResults.length === 0) return null;
    let bestMatch = null;
    let bestScore = 0;
    for (const result of searchResults) {
        let score = calculateTitleSimilarity(mediaInfo.title, result.title);
        if (mediaInfo.year && result.year) {
            const yearDiff = Math.abs(mediaInfo.year - result.year);
            if (yearDiff === 0) score += 0.2;
            else if (yearDiff <= 1) score += 0.1;
            else if (yearDiff > 5) score -= 0.3;
        }
        if (score > bestScore && score > 0.3) {
            bestScore = score;
            bestMatch = result;
        }
    }
    return bestMatch;
}

async function getStreamsFromDomain(domain, mediaInfo, mediaType, season, episode, rid) {
    try {
        log(`Step 2: Searching on ${domain}`, rid);
        const query = mediaInfo.title;
        const searchUrl = `${domain}/index.php?story=${encodeURIComponent(query)}&do=search&subaction=search`;
        const res = await request(searchUrl);
        const $ = cheerio.load(res.body);
        const searchResults = [];
        
        $("article.short-mid").each((i, el) => {
            const title = $(el).find("a > h3").text().trim();
            const href = $(el).find("a").attr("href");
            const yearMatch = title.match(/\((\d{4})\)/);
            const year = yearMatch ? parseInt(yearMatch[1]) : null;
            searchResults.push({ title, href, year });
        });

        if (searchResults.length === 0) {
            log("No search results found.", rid);
            return [];
        }

        const bestMatch = findBestTitleMatch(mediaInfo, searchResults);
        if (!bestMatch) {
            log("No confident match found.", rid);
            return [];
        }

        log(`Step 3: Selected: "${bestMatch.title}" (${bestMatch.href})`, rid);
        const docRes = await request(bestMatch.href);
        const doc$ = cheerio.load(docRes.body);
        const tabsContent = doc$("div.tabs__content script").html() || "";
        const playerScriptMatch = tabsContent.match(/const AwsIndStreamDomain\s*=\s*'([^']+)'/);
        const playerDomain = playerScriptMatch ? playerScriptMatch[1].replace(/\/$/, "") : null;
        const idMatch = tabsContent.match(/src:\s*'([^']+)'/);
        const id = idMatch ? idMatch[1] : null;

        if (!playerDomain || !id) {
            log("Could not find player domain or ID.", rid);
            return [];
        }

        const embedLink = `${playerDomain}/play/${id}`;
        log(`Step 4: Fetching embed: ${embedLink}`, rid);
        const embedRes = await request(embedLink, { headers: { Referer: bestMatch.href } });
        const embed$ = cheerio.load(embedRes.body);
        const lastScript = embed$("body > script").last().html() || "";
        const p3Match = lastScript.match(/let\s+p3\s*=\s*(\{.*\});/);
        if (!p3Match) {
            log("No p3 JSON found in embed.", rid);
            return [];
        }

        const json = JSON.parse(p3Match[1]);
        let fileUrl = json.file.replace(/\\\//g, "/");
        if (!fileUrl.startsWith("http")) fileUrl = `${playerDomain}${fileUrl}`;

        log(`Step 5: Fetching sources from: ${fileUrl}`, rid);
        const fileRes = await request(fileUrl, {
            method: "POST",
            headers: { 
                "X-CSRF-TOKEN": json.key, 
                "Referer": embedLink,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });
        
        const fileText = fileRes.body;
        let targetFiles = [];
        const parsedData = JSON.parse(fileText.replace(/,\]/g, "]"));

        if (mediaType === "movie") {
            targetFiles = parsedData.filter((s) => s && s.file);
        } else if (mediaType === "tv") {
            const seasonData = parsedData.find((s) => {
                const sTitle = s.title || "";
                const sNumMatch = sTitle.match(/Season\s*(\d+)/i) || sTitle.match(/(\d+)\s*Season/i);
                const sNum = sNumMatch ? parseInt(sNumMatch[1]) : null;
                return sNum === parseInt(season) || s.id == season;
            });
            if (seasonData && seasonData.folder) {
                const episodeData = seasonData.folder.find((e) => {
                    const eTitle = e.title || "";
                    const eNumMatch = eTitle.match(/Episode\s*(\d+)/i) || eTitle.match(/(\d+)\s*Episode/i);
                    const eNum = eNumMatch ? parseInt(eNumMatch[1]) : null;
                    return eNum === parseInt(episode) || e.episode == episode;
                });
                if (episodeData && episodeData.folder) {
                    targetFiles = episodeData.folder.filter((s) => s && s.file);
                }
            }
        }

        if (targetFiles.length === 0) {
            log("No streams found for the requested media.", rid);
            return [];
        }

        log(`Step 6: Found ${targetFiles.length} file candidate(s)`, rid);
        const streams = [];
        const playlistPromises = targetFiles.map(async (fileObj) => {
            try {
                const playlistFile = fileObj.file.replace(/^~/, "");
                const playlistUrl = `${playerDomain}/playlist/${playlistFile}.txt`;
                const postRes = await request(playlistUrl, {
                    method: "POST",
                    headers: { 
                        "X-CSRF-TOKEN": json.key, 
                        "Referer": embedLink,
                        "Content-Type": "application/x-www-form-urlencoded"
                    }
                });
                const m3u8Url = postRes.body.trim();
                if (m3u8Url && m3u8Url.startsWith("http")) {
                    const qualityStr = fileObj.title || "Unknown";
                    streams.push({
                        name: `AML | ${qualityStr}`,
                        title: `${mediaInfo.title} - ${qualityStr}`,
                        url: m3u8Url,
                        quality: qualityStr,
                        behaviorHints: {
                            bingeGroup: `allmovieland-${qualityStr.toLowerCase()}`
                        }
                    });
                }
            } catch (e) {
                log(`Playlist extraction failed: ${e.message}`, rid);
            }
        });

        await Promise.all(playlistPromises);
        return streams;

    } catch (error) {
        log(`Error on domain ${domain}: ${error.message}`, rid);
        return [];
    }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const rid = Math.random().toString(36).slice(2, 8);
    log(`Starting getStreams for TMDB:${tmdbId} ${mediaType} S${seasonNum}E${episodeNum}`, rid);

    try {
        // Step 1: TMDB Details
        const mediaInfo = await getTMDBDetails(tmdbId, mediaType, rid);
        if (!mediaInfo) throw new Error("Could not get TMDB info");
        log(`Step 1: Found title "${mediaInfo.title}" (${mediaInfo.year})`, rid);

        // Try Primary Domain
        let streams = await getStreamsFromDomain(PRIMARY_URL, mediaInfo, mediaType, seasonNum, episodeNum, rid);
        
        // Try Mirror Domains if no streams found
        if (streams.length === 0) {
            for (const mirror of MIRROR_URLS) {
                log(`No streams found on primary, trying mirror: ${mirror}...`, rid);
                streams = await getStreamsFromDomain(mirror, mediaInfo, mediaType, seasonNum, episodeNum, rid);
                if (streams.length > 0) break;
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
