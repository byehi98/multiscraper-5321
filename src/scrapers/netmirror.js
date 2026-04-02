/**
 * NetMirror Scraper for MultiScraper
 * Adapted from: https://github.com/yoruix/nuvio-providers/blob/main/providers/netmirror.js
 */
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const NETMIRROR_BASE = "https://net22.cc";
const NETMIRROR_PLAY = "https://net52.cc";

const BASE_HEADERS = {
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive"
};

let globalCookie = "";
let cookieTimestamp = 0;
const COOKIE_EXPIRY = 54e6; // 15 hours

// Debug helper
function log(msg, rid, extra) {
    const prefix = `[NetMirror]${rid ? `[rid:${rid}]` : ''}`;
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
        headers: {
            ...BASE_HEADERS,
            ...options.headers
        },
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

    const response = await gotScraping(requestOptions);
    return response;
}

function getUnixTime() {
    return Math.floor(Date.now() / 1000);
}

async function bypass(rid) {
    const now = Date.now();
    if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
        log("Using cached authentication cookie", rid);
        return globalCookie;
    }

    log("Bypassing authentication...", rid);

    for (let attempts = 0; attempts < 5; attempts++) {
        try {
            const response = await request(`${NETMIRROR_PLAY}/tv/p.php`, {
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
            if (!responseText.includes('"r":"n"')) {
                log(`Bypass attempt ${attempts + 1} failed, retrying...`, rid);
                continue;
            }

            if (extractedCookie) {
                globalCookie = extractedCookie;
                cookieTimestamp = Date.now();
                log("Authentication successful", rid);
                return globalCookie;
            }
        } catch (e) {
            log(`Bypass attempt ${attempts + 1} error: ${e.message}`, rid);
        }
    }
    throw new Error("Max bypass attempts reached");
}

async function getVideoToken(id, cookie, ott, rid) {
    const cookies = {
        "t_hash_t": cookie,
        "ott": ott || "nf",
        "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");

    const playRes = await request(`${NETMIRROR_BASE}/play.php`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": `${NETMIRROR_BASE}/`,
            "Cookie": cookieString
        },
        body: `id=${id}`,
        responseType: 'json'
    });

    const h = playRes.body.h;
    
    const play2Res = await request(`${NETMIRROR_PLAY}/play.php?id=${id}&${h}`, {
        headers: {
            "Referer": `${NETMIRROR_BASE}/`,
            "Cookie": cookieString
        }
    });

    const tokenMatch = play2Res.body.match(/data-h="([^"]+)"/);
    return tokenMatch ? tokenMatch[1] : null;
}

async function searchContent(query, platform, rid) {
    log(`Searching for "${query}" on ${platform}...`, rid);
    const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
    const ott = ottMap[platform.toLowerCase()] || "nf";

    const cookie = await bypass(rid);
    const cookieString = `t_hash_t=${cookie}; user_token=233123f803cf02184bf6c67e149cdd50; hd=on; ott=${ott}`;

    const searchEndpoints = {
        "netflix": `${NETMIRROR_BASE}/search.php`,
        "primevideo": `${NETMIRROR_BASE}/pv/search.php`,
        "disney": `${NETMIRROR_BASE}/mobile/hs/search.php`
    };
    const searchUrl = searchEndpoints[platform.toLowerCase()] || searchEndpoints["netflix"];

    const response = await request(`${searchUrl}?s=${encodeURIComponent(query)}&t=${getUnixTime()}`, {
        headers: {
            "Cookie": cookieString,
            "Referer": `${NETMIRROR_BASE}/tv/home`
        },
        responseType: 'json'
    });

    const searchData = response.body;
    if (searchData.searchResult && searchData.searchResult.length > 0) {
        log(`Found ${searchData.searchResult.length} results`, rid);
        return searchData.searchResult.map((item) => ({
            id: item.id,
            title: item.t,
            posterUrl: `https://imgcdn.media/poster/v/${item.id}.jpg`
        }));
    }
    return [];
}

async function getEpisodesFromSeason(seriesId, seasonId, platform, page, rid) {
    const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
    const ott = ottMap[platform.toLowerCase()] || "nf";
    const cookie = await bypass(rid);
    const cookieString = `t_hash_t=${cookie}; user_token=233123f803cf02184bf6c67e149cdd50; ott=${ott}; hd=on`;

    const episodesEndpoints = {
        "netflix": `${NETMIRROR_BASE}/episodes.php`,
        "primevideo": `${NETMIRROR_BASE}/pv/episodes.php`,
        "disney": `${NETMIRROR_BASE}/mobile/hs/episodes.php`
    };
    const episodesUrl = episodesEndpoints[platform.toLowerCase()] || episodesEndpoints["netflix"];

    const episodes = [];
    let currentPage = page || 1;

    while (true) {
        try {
            const response = await request(`${episodesUrl}?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${currentPage}`, {
                headers: {
                    "Cookie": cookieString,
                    "Referer": `${NETMIRROR_BASE}/tv/home`
                },
                responseType: 'json'
            });

            const episodeData = response.body;
            if (episodeData.episodes) {
                episodes.push(...episodeData.episodes);
            }

            if (episodeData.nextPageShow === 0) break;
            currentPage++;
        } catch (error) {
            log(`Failed to load episodes from season ${seasonId}, page ${currentPage}`, rid);
            break;
        }
    }
    return episodes;
}

async function loadContent(contentId, platform, rid) {
    log(`Loading content details for ID: ${contentId}`, rid);
    const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
    const ott = ottMap[platform.toLowerCase()] || "nf";
    const cookie = await bypass(rid);
    const cookieString = `t_hash_t=${cookie}; user_token=233123f803cf02184bf6c67e149cdd50; ott=${ott}; hd=on`;

    const postEndpoints = {
        "netflix": `${NETMIRROR_BASE}/post.php`,
        "primevideo": `${NETMIRROR_BASE}/pv/post.php`,
        "disney": `${NETMIRROR_BASE}/mobile/hs/post.php`
    };
    const postUrl = postEndpoints[platform.toLowerCase()] || postEndpoints["netflix"];

    const response = await request(`${postUrl}?id=${contentId}&t=${getUnixTime()}`, {
        headers: {
            "Cookie": cookieString,
            "Referer": `${NETMIRROR_BASE}/tv/home`
        },
        responseType: 'json'
    });

    const postData = response.body;
    log(`Loaded: ${postData.title}`, rid);

    let allEpisodes = postData.episodes || [];
    if (allEpisodes.length > 0 && allEpisodes[0] !== null) {
        if (postData.nextPageShow === 1 && postData.nextPageSeason) {
            const extra = await getEpisodesFromSeason(contentId, postData.nextPageSeason, platform, 2, rid);
            allEpisodes.push(...extra);
        }
        if (postData.season && postData.season.length > 1) {
            const otherSeasons = postData.season.slice(0, -1);
            for (const season of otherSeasons) {
                const extra = await getEpisodesFromSeason(contentId, season.id, platform, 1, rid);
                allEpisodes.push(...extra);
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
}

async function getStreamingLinks(contentId, title, platform, rid) {
    log(`Getting streaming links for: ${title}`, rid);
    const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
    const ott = ottMap[platform.toLowerCase()] || "nf";

    const cookie = await bypass(rid);
    const token = await getVideoToken(contentId, cookie, ott, rid);
    const cookieString = `t_hash_t=${cookie}; ott=${ott}; hd=on`;

    const playlistEndpoints = {
        "netflix": `${NETMIRROR_PLAY}/playlist.php`,
        "primevideo": `${NETMIRROR_PLAY}/pv/playlist.php`,
        "disney": `${NETMIRROR_PLAY}/mobile/hs/playlist.php`
    };
    const playlistUrl = playlistEndpoints[platform.toLowerCase()] || playlistEndpoints["netflix"];

    const response = await request(`${playlistUrl}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}&h=${token}`, {
        headers: {
            "Cookie": cookieString,
            "Referer": `${NETMIRROR_PLAY}/`
        },
        responseType: 'json'
    });

    const playlist = response.body;
    if (!Array.isArray(playlist) || playlist.length === 0) {
        return { sources: [], subtitles: [] };
    }

    const sources = [];
    const subtitles = [];
    playlist.forEach((item) => {
        if (item.sources) {
            item.sources.forEach((source) => {
                let fullUrl = source.file.replace("/tv/", "/");
                if (!fullUrl.startsWith("/")) fullUrl = "/" + fullUrl;
                fullUrl = NETMIRROR_PLAY + fullUrl;
                sources.push({
                    url: fullUrl,
                    quality: source.label,
                    type: source.type || "application/x-mpegURL"
                });
            });
        }
        if (item.tracks) {
            item.tracks.filter((track) => track.kind === "captions").forEach((track) => {
                let fullSubUrl = track.file;
                if (track.file.startsWith("/") && !track.file.startsWith("//")) {
                    fullSubUrl = NETMIRROR_PLAY + track.file;
                } else if (track.file.startsWith("//")) {
                    fullSubUrl = "https:" + track.file;
                }
                subtitles.push({ url: fullSubUrl, language: track.label });
            });
        }
    });
    return { sources, subtitles };
}

function calculateSimilarity(str1, str2) {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    if (s1 === s2) return 1;
    const words1 = s1.split(/\s+/).filter((w) => w.length > 0);
    const words2 = s2.split(/\s+/).filter((w) => w.length > 0);
    if (words2.length <= words1.length) {
        let exactMatches = 0;
        for (const queryWord of words2) {
            if (words1.includes(queryWord)) exactMatches++;
        }
        if (exactMatches === words2.length) return 0.95 * (exactMatches / words1.length);
    }
    return s1.startsWith(s2) ? 0.9 : 0;
}

async function getTMDBDetails(tmdbId, mediaType, rid) {
    const url = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await request(url, { responseType: 'json' });
    const data = response.body;
    return {
        title: mediaType === "tv" ? data.name : data.title,
        year: (mediaType === "tv" ? data.first_air_date : data.release_date)?.substring(0, 4)
    };
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const rid = Math.random().toString(36).slice(2, 8);
    log(`Starting getStreams for TMDB:${tmdbId} type=${mediaType}${seasonNum ? ` S${seasonNum}E${episodeNum}` : ""}`, rid);

    try {
        const tmdbData = await getTMDBDetails(tmdbId, mediaType, rid);
        const { title, year } = tmdbData;
        log(`Step 1: Found title "${title}" (${year})`, rid);

        let platforms = ["netflix", "primevideo", "disney"];
        if (title.toLowerCase().includes("boys") || title.toLowerCase().includes("prime")) {
            platforms = ["primevideo", "netflix", "disney"];
        }

        for (const platform of platforms) {
            log(`Step 2: Trying platform ${platform}`, rid);
            const queries = [title, `${title} ${year}`];
            
            for (const query of queries) {
                const searchResults = await searchContent(query, platform, rid);
                const relevantResults = searchResults.filter(r => calculateSimilarity(r.title, title) >= 0.7)
                    .sort((a, b) => calculateSimilarity(b.title, title) - calculateSimilarity(a.title, title));

                if (relevantResults.length === 0) continue;

                const selectedContent = relevantResults[0];
                log(`Step 3: Selected "${selectedContent.title}" (ID: ${selectedContent.id})`, rid);

                const contentData = await loadContent(selectedContent.id, platform, rid);
                let targetId = selectedContent.id;
                let episodeInfo = null;

                if (mediaType === "tv" && !contentData.isMovie) {
                    const s = parseInt(seasonNum || 1);
                    const e = parseInt(episodeNum || 1);
                    episodeInfo = contentData.episodes.find(ep => {
                        if (!ep) return false;
                        let es, en;
                        if (ep.s && ep.ep) {
                            es = parseInt(ep.s.replace("S", ""));
                            en = parseInt(ep.ep.replace("E", ""));
                        } else {
                            es = parseInt(ep.season || ep.season_number);
                            en = parseInt(ep.episode || ep.episode_number);
                        }
                        return es === s && en === e;
                    });

                    if (episodeInfo) {
                        targetId = episodeInfo.id;
                        log(`Step 4: Found episode ID: ${targetId}`, rid);
                    } else {
                        log(`Step 4: Episode S${s}E${e} not found`, rid);
                        continue;
                    }
                }

                const streamData = await getStreamingLinks(targetId, title, platform, rid);
                if (!streamData.sources || streamData.sources.length === 0) continue;

                const results = streamData.sources.map(source => {
                    let quality = source.quality || "HD";
                    if (source.url.includes("1080p")) quality = "1080p";
                    else if (source.url.includes("720p")) quality = "720p";
                    else if (source.url.includes("480p")) quality = "480p";

                    return {
                        name: `NetMirror | ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
                        title: `${title} ${quality}${mediaType === 'tv' ? ` S${seasonNum}E${episodeNum}` : ''}`,
                        url: source.url,
                        quality,
                        behaviorHints: {
                            bingeGroup: `netmirror-${platform}`,
                            proxyHeaders: {
                                request: {
                                    "User-Agent": "Mozilla/5.0 (Android) ExoPlayer",
                                    "Referer": `${NETMIRROR_PLAY}/`,
                                    "Cookie": "hd=on"
                                }
                            }
                        }
                    };
                });

                log(`🎉 COMPLETE: Returning ${results.length} stream(s)`, rid);
                return results;
            }
        }
        return [];
    } catch (error) {
        log(`❌ ERROR: ${error.message}`, rid);
        return [];
    }
}

module.exports = { getStreams };
