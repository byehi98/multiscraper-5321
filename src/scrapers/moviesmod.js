const cheerio = require('cheerio');

// MoviesMod scraper for Nuvio
// Extracts direct download links from moviesmod.blue and associated redirection blogs

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const FALLBACK_DOMAIN = "https://moviesmod.blue";
const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1e3;

let moviesModDomain = FALLBACK_DOMAIN;
let domainCacheTimestamp = 0;

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1"
};

// Utility functions
async function getMoviesModDomain(gotScraping) {
    const now = Date.now();
    if (now - domainCacheTimestamp < DOMAIN_CACHE_TTL) return moviesModDomain;
    try {
        const response = await gotScraping(DOMAINS_URL).json();
        if (response?.moviesmod) {
            moviesModDomain = response.moviesmod;
            domainCacheTimestamp = now;
        }
    } catch (error) {
        console.error(`[MoviesMod] Domain fetch failed: ${error.message}`);
    }
    return moviesModDomain;
}

function extractQuality(text) {
    if (!text) return "Unknown";
    const qualityMatch = text.match(/(480p|720p|1080p|2160p|4k)/i);
    return qualityMatch ? qualityMatch[1] : "Unknown";
}

function getTechDetails(qualityString) {
    if (!qualityString) return [];
    const details = [];
    const lowerText = qualityString.toLowerCase();
    if (lowerText.includes("10bit")) details.push("10-bit");
    if (lowerText.includes("hevc") || lowerText.includes("x265")) details.push("HEVC");
    if (lowerText.includes("hdr")) details.push("HDR");
    return details;
}

function normalizeTitle(title) {
    return (title || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function calculateSimilarity(str1, str2) {
    const s1 = normalizeTitle(str1);
    const s2 = normalizeTitle(str2);
    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;
    return 0;
}

async function validateVideoUrl(gotScraping, url) {
    try {
        const response = await gotScraping({
            url: url,
            method: 'GET',
            headers: { 
                'Range': 'bytes=0-1', 
                'User-Agent': HEADERS["User-Agent"],
                'Referer': 'https://driveseed.org/'
            },
            timeout: { request: 8000 },
            followRedirect: false,
            throwHttpErrors: false
        });
        return response.statusCode === 200 || response.statusCode === 206 || response.statusCode === 302;
    } catch (e) {
        return false;
    }
}

async function resolveDriveseedLink(gotScraping, driveseedUrl) {
    try {
        const response = await gotScraping(driveseedUrl, { 
            headers: { "Referer": "https://links.modpro.blog/" },
            followRedirect: true
        });
        const redirectMatch = response.body.match(/window\.location\.replace\("([^"]+)"\)/);
        if (!redirectMatch) return null;

        const finalUrl = `https://driveseed.org${redirectMatch[1]}`;
        const finalResponse = await gotScraping(finalUrl, { headers: { "Referer": driveseedUrl } });
        const $ = cheerio.load(finalResponse.body);
        
        let size = null, fileName = null;
        $("ul.list-group li").each((i, el) => {
            const text = $(el).text();
            if (text.includes("Size :")) size = text.split(":")[1].trim();
            else if (text.includes("Name :")) fileName = text.split(":")[1].trim();
        });

        // 1. Try Cloud Download (R2) - fastest and most direct
        const cloudDownload = $('a:contains("Cloud Download")').attr("href");
        if (cloudDownload && cloudDownload.includes('.r2.dev')) {
            return { url: cloudDownload, size, fileName };
        }

        // 2. Try Resume Cloud
        const resumeCloudLink = $('a:contains("Resume Cloud")').attr("href");
        if (resumeCloudLink) {
            const resumeRes = await gotScraping(`https://driveseed.org${resumeCloudLink}`, { headers: { "Referer": finalUrl } });
            const $$ = cheerio.load(resumeRes.body);
            const directUrl = $$('a:contains("Cloud Resume Download")').attr("href");
            if (directUrl) return { url: directUrl, size, fileName };
        }

        // 3. Try Instant Download
        const instantLink = $('a:contains("Instant Download")').attr("href");
        if (instantLink) {
            const instantUrl = instantLink.startsWith('http') ? instantLink : `https://driveseed.org${instantLink}`;
            try {
                const urlParams = new URL(instantUrl).searchParams;
                const keys = urlParams.get('url');
                if (keys) {
                    const apiRes = await gotScraping({
                        url: `${new URL(instantUrl).origin}/api`,
                        method: 'POST',
                        form: { keys: keys },
                        headers: { 'x-token': new URL(instantUrl).hostname }
                    }).json();
                    if (apiRes.url) return { url: apiRes.url, size, fileName };
                }
            } catch (e) {}
        }

        return null;
    } catch (error) {
        return null;
    }
}

async function resolveTechUnblocked(gotScraping, sidUrl) {
    try {
        const res1 = await gotScraping(sidUrl);
        const $1 = cheerio.load(res1.body);
        const form1 = $1("#landing");
        const wp_http = form1.find('input[name="_wp_http"]').val();
        const action1 = form1.attr("action");
        if (!wp_http || !action1) return null;

        const res2 = await gotScraping({
            url: action1,
            method: 'POST',
            headers: { "Referer": sidUrl, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ "_wp_http": wp_http }).toString(),
            followRedirect: true
        });

        const $2 = cheerio.load(res2.body);
        const form2 = $2("#landing");
        const action2 = form2.attr("action");
        const wp_http2 = form2.find('input[name="_wp_http2"]').val();
        const token = form2.find('input[name="token"]').val();
        if (!action2) return null;

        const res3 = await gotScraping({
            url: action2,
            method: 'POST',
            headers: { "Referer": res2.url, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ "_wp_http2": wp_http2, "token": token }).toString(),
            followRedirect: true
        });

        const finalHtml = res3.body;
        const cookieMatch = finalHtml.match(/s_343\('([^']+)',\s*'([^']+)'/);
        const linkMatch = finalHtml.match(/c\.setAttribute\("href",\s*"([^"]+)"\)/);
        if (!cookieMatch || !linkMatch) return null;

        const finalUrl = new URL(linkMatch[1], new URL(sidUrl).origin).href;
        const finalRes = await gotScraping(finalUrl, {
            headers: { "Referer": res3.url, "Cookie": `${cookieMatch[1]}=${cookieMatch[2]}` }
        });

        const $3 = cheerio.load(finalRes.body);
        const metaRefresh = $3('meta[http-equiv="refresh"]').attr("content");
        const driveleechUrl = metaRefresh?.match(/url=(.*)/i)?.[1].replace(/["']/g, "");
        return driveleechUrl || null;
    } catch (e) {
        return null;
    }
}

async function resolveIntermediate(gotScraping, url, referer) {
    try {
        const response = await gotScraping(url, { headers: { "Referer": referer } });
        const $ = cheerio.load(response.body);
        const links = [];

        if (url.includes('modrefer.in')) {
            const encoded = new URL(url).searchParams.get('url');
            if (encoded) {
                const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
                return await resolveIntermediate(gotScraping, decoded, url);
            }
        }

        const linkElements = $('a[href*="driveseed.org"], a[href*="tech.unblockedgames.world"], a[href*="tech.examzculture.in"], a[href*="tech.creativeexpressionsblog.com"], a[href*="modrefer.in"]');
        
        for (const el of linkElements.get()) {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            if (href && !text.toLowerCase().includes('batch')) {
                links.push({ server: text || "Download", url: href });
            }
        }

        if (url.includes('modpro.blog')) {
            $("h3, h4").each((i, h) => {
                const hText = $(h).text();
                const epLink = $(h).find('a').attr('href');
                if (epLink) links.push({ server: hText, url: epLink });
            });
        }

        return links;
    } catch (e) {
        return [];
    }
}

async function search(gotScraping, query) {
    const baseUrl = await getMoviesModDomain(gotScraping);
    try {
        const response = await gotScraping(`${baseUrl}/?s=${encodeURIComponent(query)}`);
        const $ = cheerio.load(response.body);
        const results = [];
        $(".latestPost").each((i, el) => {
            const link = $(el).find("a");
            if (link.attr("title") && link.attr("href")) {
                results.push({ title: link.attr("title"), url: link.attr("href") });
            }
        });
        return results;
    } catch (e) {
        return [];
    }
}

async function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
    const { gotScraping } = await import('got-scraping');
    console.log(`Step 1: TMDB Details [MoviesMod]`);
    const tmdbType = (mediaType === 'series' ? 'tv' : mediaType);
    const tmdbUrl = `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    let tmdbData;
    try {
        tmdbData = await gotScraping(tmdbUrl).json();
    } catch (e) {
        return [];
    }

    const title = tmdbType === "tv" ? tmdbData.name : tmdbData.title;
    const year = (tmdbType === "tv" ? tmdbData.first_air_date : tmdbData.release_date || "").split("-")[0];
    console.log(`[MoviesMod] TMDB Info: "${title}" (${year})`);

    console.log(`Step 2: Mapping (Search) [MoviesMod]`);
    const searchResults = await search(gotScraping, title);
    if (searchResults.length === 0) return [];

    let selected = searchResults.find(r => calculateSimilarity(title, r.title) > 0.7 && (!year || r.title.includes(year)));
    if (!selected) selected = searchResults[0];
    console.log(`[MoviesMod] Selected: ${selected.title}`);

    console.log(`Step 3: Database/Provider Lookup [MoviesMod]`);
    const moviePage = await gotScraping(selected.url);
    const $ = cheerio.load(moviePage.body);
    
    const downloadLinks = $(".thecontent a").filter((i, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().toLowerCase();
        return (href.includes('modpro') || href.includes('modrefer') || href.includes('links')) && 
               !text.includes('batch') && !text.includes('zip');
    }).get();

    const streams = [];
    for (const el of downloadLinks) {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        
        let context = "Unknown";
        let prev = $(el).parent();
        for (let j = 0; j < 15; j++) {
            const header = prev.prevAll('h3, h4').first();
            if (header.length > 0) { context = header.text().trim(); break; }
            prev = prev.parent();
            if (prev.hasClass('thecontent')) break;
        }

        if (context.toLowerCase().includes('480p')) continue;
        
        const seasonMatch = context.toLowerCase().match(/s(?:eason)?\s*(\d+)/i);
        const extractedSeason = seasonMatch ? parseInt(seasonMatch[1]) : null;
        if (tmdbType === "tv" && seasonNum && extractedSeason !== null && extractedSeason !== seasonNum) continue;

        console.log(`Step 4: Stream Resolution [MoviesMod] - ${context}`);
        const intermediateLinks = await resolveIntermediate(gotScraping, href, selected.url);
        
        let targetLinks = intermediateLinks;
        if (tmdbType === "tv" && episodeNum) {
            targetLinks = intermediateLinks.filter(l => {
                const s = l.server.toLowerCase();
                return s.includes(`episode ${episodeNum}`) || s.includes(`e${episodeNum}`) || s.includes(` ${episodeNum} `) || s.includes(`${episodeNum}`);
            });
        }

        for (const target of targetLinks) {
            let streamUrl = target.url;
            if (streamUrl.includes('tech.') || streamUrl.includes('unblocked') || streamUrl.includes('creativeexpressions') || streamUrl.includes('examzculture')) {
                streamUrl = await resolveTechUnblocked(gotScraping, streamUrl);
            }
            
            if (streamUrl?.includes('driveseed.org')) {
                const final = await resolveDriveseedLink(gotScraping, streamUrl);
                if (final && await validateVideoUrl(gotScraping, final.url)) {
                    streams.push({
                        name: `MoviesMod`,
                        title: `${final.fileName || title}
${final.size || ""} • ${getTechDetails(context).join(' • ')}`,
                        url: final.url,
                        quality: extractQuality(context),
                        type: "direct"
                    });
                    break; 
                }
            }
        }
    }

    return streams.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
