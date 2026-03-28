let gotScraping;

console.log("[NetMirror] Initializing NetMirror provider");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const NETMIRROR_BASE = "https://net51.cc";

const BASE_HEADERS = {
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive"
};

let globalCookie = "";
let lastUA = "";
let cookieTimestamp = 0;
const COOKIE_EXPIRY = 54e6; // 15 hours

const headerOptions = {
    browsers: [{ name: 'chrome', minVersion: 120 }],
    devices: ['desktop'],
    locales: ['en-US'],
    operatingSystems: ['windows', 'macos'],
};

/**
 * Throttles requests to avoid 500 errors.
 */
async function delay(ms = 250) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standard request helper using got-scraping.
 */
async function makeRequest(url, options = {}) {
    await delay();
    
    if (!gotScraping) {
        const mod = await import('got-scraping');
        gotScraping = mod.gotScraping;
    }

    const response = await gotScraping({
        url,
        ...options,
        http2: false,
        headers: {
            ...BASE_HEADERS,
            ...options.headers
        },
        headerGeneratorOptions: headerOptions,
        timeout: { request: 10000 }
    });
    
    // Synchronize User-Agent for decryption/playback later
    lastUA = response.request.options.headers['user-agent'];
    
    return response;
}

function getUnixTime() {
    return Math.floor(Date.now() / 1e3);
}

/**
 * Step 4: Token/ID Extraction (Authentication Bypass)
 */
async function bypass() {
    const now = Date.now();
    if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
        console.log("[NetMirror] Using cached authentication cookie");
        return globalCookie;
    }

    console.log("[NetMirror] Bypassing authentication...");
    
    for (let attempts = 0; attempts < 5; attempts++) {
        try {
            const response = await makeRequest(`${NETMIRROR_BASE}/tv/p.php`, {
                method: "POST"
            });

            const setCookieHeader = response.headers["set-cookie"];
            let extractedCookie = null;
            if (setCookieHeader) {
                const cookieString = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader;
                const cookieMatch = cookieString.match(/t_hash_t=([^;]+)/);
                if (cookieMatch) {
                    extractedCookie = cookieMatch[1];
                }
            }

            const responseText = response.body;
            if (responseText.includes('"r":"n"')) {
                if (extractedCookie) {
                    globalCookie = extractedCookie;
                    cookieTimestamp = Date.now();
                    console.log("[NetMirror] Authentication successful");
                    return globalCookie;
                }
            }
            console.log(`[NetMirror] Bypass attempt ${attempts + 1} failed, retrying...`);
        } catch (error) {
            console.log(`[NetMirror] Bypass attempt ${attempts + 1} error: ${error.message}`);
        }
    }
    throw new Error("Max bypass attempts reached for authentication");
}

/**
 * Step 2: Mapping (Search)
 */
async function searchContent(query, platform) {
    console.log(`[NetMirror] Step 2: Mapping - Searching for "${query}" on ${platform}...`);
    
    const ottMap = {
        "netflix": "nf",
        "primevideo": "pv",
        "disney": "hs"
    };
    const ott = ottMap[platform.toLowerCase()] || "nf";
    
    const cookie = await bypass();
    const cookies = {
        "t_hash_t": cookie,
        "user_token": "233123f803cf02184bf6c67e149cdd50",
        "hd": "on",
        "ott": ott
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const searchEndpoints = {
        "netflix": `${NETMIRROR_BASE}/search.php`,
        "primevideo": `${NETMIRROR_BASE}/pv/search.php`,
        "disney": `${NETMIRROR_BASE}/mobile/hs/search.php`
    };
    const searchUrl = searchEndpoints[platform.toLowerCase()] || searchEndpoints["netflix"];
    
    try {
        const response = await makeRequest(
            `${searchUrl}?s=${encodeURIComponent(query)}&t=${getUnixTime()}`,
            {
                headers: {
                    "Cookie": cookieString,
                    "Referer": `${NETMIRROR_BASE}/tv/home`
                }
            }
        );
        
        const searchData = JSON.parse(response.body);
        if (searchData.searchResult && searchData.searchResult.length > 0) {
            console.log(`[NetMirror] Found ${searchData.searchResult.length} results`);
            return searchData.searchResult.map((item) => ({
                id: item.id,
                title: item.t,
                posterUrl: `https://imgcdn.media/poster/v/${item.id}.jpg`
            }));
        }
    } catch (error) {
        console.error(`[NetMirror] Search failed: ${error.message}`);
    }
    
    console.log("[NetMirror] No results found");
    return [];
}

async function getEpisodesFromSeason(seriesId, seasonId, platform, page) {
    const ottMap = {
        "netflix": "nf",
        "primevideo": "pv",
        "disney": "hs"
    };
    const ott = ottMap[platform.toLowerCase()] || "nf";
    const cookie = await bypass();
    
    const cookies = {
        "t_hash_t": cookie,
        "user_token": "233123f803cf02184bf6c67e149cdd50",
        "ott": ott,
        "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const episodes = [];
    let currentPage = page || 1;
    const episodesEndpoints = {
        "netflix": `${NETMIRROR_BASE}/episodes.php`,
        "primevideo": `${NETMIRROR_BASE}/pv/episodes.php`,
        "disney": `${NETMIRROR_BASE}/mobile/hs/episodes.php`
    };
    const episodesUrl = episodesEndpoints[platform.toLowerCase()] || episodesEndpoints["netflix"];
    
    async function fetchPage(pageNum) {
        try {
            const response = await makeRequest(
                `${episodesUrl}?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${pageNum}`,
                {
                    headers: {
                        "Cookie": cookieString,
                        "Referer": `${NETMIRROR_BASE}/tv/home`
                    }
                }
            );
            
            const episodeData = JSON.parse(response.body);
            if (episodeData.episodes) {
                episodes.push(...episodeData.episodes);
            }
            
            if (episodeData.nextPageShow === 1) {
                return fetchPage(pageNum + 1);
            }
            return episodes;
        } catch (error) {
            console.log(`[NetMirror] Failed to load episodes from season ${seasonId}, page ${pageNum}`);
            return episodes;
        }
    }
    
    return fetchPage(currentPage);
}

/**
 * Step 3: Database/Provider Lookup
 */
async function loadContent(contentId, platform) {
    console.log(`[NetMirror] Step 3: Database Lookup - Loading details for ID: ${contentId}`);
    
    const ottMap = {
        "netflix": "nf",
        "primevideo": "pv",
        "disney": "hs"
    };
    const ott = ottMap[platform.toLowerCase()] || "nf";
    
    const cookie = await bypass();
    const cookies = {
        "t_hash_t": cookie,
        "user_token": "233123f803cf02184bf6c67e149cdd50",
        "ott": ott,
        "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const postEndpoints = {
        "netflix": `${NETMIRROR_BASE}/post.php`,
        "primevideo": `${NETMIRROR_BASE}/pv/post.php`,
        "disney": `${NETMIRROR_BASE}/mobile/hs/post.php`
    };
    const postUrl = postEndpoints[platform.toLowerCase()] || postEndpoints["netflix"];
    
    try {
        const response = await makeRequest(
            `${postUrl}?id=${contentId}&t=${getUnixTime()}`,
            {
                headers: {
                    "Cookie": cookieString,
                    "Referer": `${NETMIRROR_BASE}/tv/home`
                }
            }
        );
        
        let postData = JSON.parse(response.body);
        
        // Fix for "Loaded: undefined" - some NetMirror clones nest data or use different keys
        if (!postData.title && postData.data) {
            postData = postData.data;
        }
        
        console.log(`[NetMirror] Loaded: ${postData.title || postData.t || "Unknown Title"}`);
        
        let allEpisodes = postData.episodes || postData.eps || [];
        if (allEpisodes.length > 0 && allEpisodes[0] !== null) {
            console.log("[NetMirror] Loading episodes from all seasons...");
            
            if (postData.nextPageShow === 1 && postData.nextPageSeason) {
                const additionalEpisodes = await getEpisodesFromSeason(contentId, postData.nextPageSeason, platform, 2);
                allEpisodes.push(...additionalEpisodes);
            }
            
            if (postData.season && postData.season.length > 1) {
                const otherSeasons = postData.season.slice(0, -1);
                for (const season of otherSeasons) {
                    const seasonEpisodes = await getEpisodesFromSeason(contentId, season.id, platform, 1);
                    allEpisodes.push(...seasonEpisodes);
                }
            }
        }
        
        return {
            id: contentId,
            title: postData.title,
            description: postData.desc,
            year: postData.year,
            episodes: allEpisodes,
            seasons: postData.season || [],
            isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null
        };
    } catch (error) {
        console.error(`[NetMirror] loadContent failed: ${error.message}`);
        return null;
    }
}

/**
 * Step 5: Stream Resolution
 */
async function getStreamingLinks(contentId, title, platform) {
    console.log(`[NetMirror] Step 5: Stream Resolution - Getting links for: ${title}`);
    
    const ottMap = {
        "netflix": "nf",
        "primevideo": "pv",
        "disney": "hs"
    };
    const ott = ottMap[platform.toLowerCase()] || "nf";
    
    const cookie = await bypass();
    const cookies = {
        "t_hash_t": cookie,
        "user_token": "233123f803cf02184bf6c67e149cdd50",
        "ott": ott,
        "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const playlistUrl = `${NETMIRROR_BASE}/tv/playlist.php`;
    
    try {
        const response = await makeRequest(
            `${playlistUrl}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`,
            {
                headers: {
                    "Cookie": cookieString,
                    "Referer": `${NETMIRROR_BASE}/tv/home`
                }
            }
        );
        
        const playlist = JSON.parse(response.body);
        if (!Array.isArray(playlist) || playlist.length === 0) {
            console.log("[NetMirror] No streaming links found");
            return { sources: [], subtitles: [] };
        }
        
        const sources = [];
        const subtitles = [];
        
        playlist.forEach((item) => {
            if (item.sources) {
                item.sources.forEach((source) => {
                    let fullUrl = source.file;
                    if (fullUrl.includes("/tv/")) {
                        fullUrl = fullUrl.replace("/tv/", "/");
                    }
                    if (!fullUrl.startsWith("http")) {
                        if (!fullUrl.startsWith("/")) fullUrl = "/" + fullUrl;
                        fullUrl = NETMIRROR_BASE + fullUrl;
                    }
                    
                    sources.push({
                        url: fullUrl,
                        quality: source.label,
                        type: source.type || "application/x-mpegURL"
                    });
                });
            }
            if (item.tracks) {
                item.tracks.filter((track) => track.kind === "captions" || track.kind === "subtitles").forEach((track) => {
                    let fullSubUrl = track.file;
                    if (fullSubUrl.startsWith("/") && !fullSubUrl.startsWith("//")) {
                        fullSubUrl = NETMIRROR_BASE + fullSubUrl;
                    } else if (fullSubUrl.startsWith("//")) {
                        fullSubUrl = "https:" + fullSubUrl;
                    }
                    subtitles.push({
                        url: fullSubUrl,
                        language: track.label
                    });
                });
            }
        });
        
        console.log(`[NetMirror] Found ${sources.length} sources and ${subtitles.length} subtitles`);
        return { sources, subtitles, sessionCookies: cookies };
    } catch (error) {
        console.error(`[NetMirror] getStreamingLinks failed: ${error.message}`);
        return { sources: [], subtitles: [] };
    }
}

/**
 * Step 1: TMDB Details
 */
async function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
    console.log(`[NetMirror] Step 1: TMDB Details - ID: ${tmdbId}, Type: ${mediaType}`);
    
    try {
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResponse = await makeRequest(tmdbUrl);
        const tmdbData = JSON.parse(tmdbResponse.body);
        
        const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
        const year = (mediaType === "tv" ? tmdbData.first_air_date : tmdbData.release_date)?.substring(0, 4);
        
        if (!title) throw new Error("Could not extract title from TMDB");
        
        console.log(`[NetMirror] TMDB Info: "${title}" (${year})`);
        
        const platforms = ["netflix", "primevideo", "disney"];
        const queries = [title, `${title} ${year}`];
        
        for (const platform of platforms) {
            console.log(`[NetMirror] Trying platform: ${platform}`);
            for (const query of queries) {
                const searchResults = await searchContent(query, platform);
                if (searchResults.length === 0) continue;
                
                // Similarity check (simplified)
                const selectedContent = searchResults.find(r => 
                    r.title.toLowerCase().includes(title.toLowerCase()) || 
                    title.toLowerCase().includes(r.title.toLowerCase())
                ) || searchResults[0];
                
                console.log(`[NetMirror] Selected: ${selectedContent.title} (ID: ${selectedContent.id})`);
                
                const contentData = await loadContent(selectedContent.id, platform);
                if (!contentData) continue;
                
                let targetId = selectedContent.id;
                let episodeInfo = null;
                
                if (mediaType === "tv" && !contentData.isMovie) {
                    episodeInfo = contentData.episodes.find(ep => {
                        if (!ep) return false;
                        const s = parseInt(ep.s?.replace("S", "") || ep.season || ep.season_number);
                        const e = parseInt(ep.ep?.replace("E", "") || ep.episode || ep.episode_number);
                        return s === (seasonNum || 1) && e === (episodeNum || 1);
                    });
                    
                    if (episodeInfo) {
                        targetId = episodeInfo.id;
                        console.log(`[NetMirror] Found episode ID: ${targetId}`);
                    } else {
                        console.log(`[NetMirror] Episode S${seasonNum}E${episodeNum} not found`);
                        continue;
                    }
                }
                
                const { sources, sessionCookies } = await getStreamingLinks(targetId, title, platform);
                if (sources.length === 0) continue;
                
                const streams = sources.map(source => {
                    let quality = source.quality || "HD";
                    const lowerQuality = quality.toLowerCase();
                    if (lowerQuality.includes("1080") || lowerQuality.includes("full hd")) quality = "1080p";
                    else if (lowerQuality.includes("720") || lowerQuality.includes("mid hd")) quality = "720p";
                    else if (lowerQuality.includes("480") || lowerQuality.includes("low hd")) quality = "480p";
                    else if (lowerQuality.includes("ultra hd") || lowerQuality.includes("2160") || lowerQuality.includes("4k")) quality = "2160p";
                    
                    const streamUrl = source.url;
                    const isHLS = streamUrl.includes(".m3u8") || source.type.includes("mpegURL") || source.type.includes("hls");
                    
                    // Improved headers for playback
                    const streamHeaders = {
                        "User-Agent": lastUA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Referer": `${NETMIRROR_BASE}/`,
                        "Origin": NETMIRROR_BASE,
                        "Cookie": `t_hash_t=${sessionCookies.t_hash_t}; user_token=${sessionCookies.user_token}; hd=on; ott=${sessionCookies.ott}`,
                        "Accept": "*/*",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Connection": "keep-alive"
                    };
                    
                    return {
                        name: `NetMirror (${platform.charAt(0).toUpperCase() + platform.slice(1)})`,
                        title: `${title} ${year ? `(${year})` : ""} ${quality}${mediaType === 'tv' ? ` S${seasonNum}E${episodeNum}` : ""}`,
                        url: streamUrl,
                        quality,
                        type: isHLS ? "hls" : "direct",
                        headers: streamHeaders,
                        behaviorHints: {
                            bingeGroup: `netmirror-${platform}`
                        }
                    };
                });
                
                console.log(`[NetMirror] Successfully processed ${streams.length} streams from ${platform}`);
                return streams;
            }
        }
        
        return [];
    } catch (error) {
        console.error(`[NetMirror] Error in getStreams: ${error.message}`);
        return [];
    }
}

module.exports = { getStreams };
