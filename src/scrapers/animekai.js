// AnimeKai Scraper for MultiScraper
// Refactored to use async/await and robust error handling similar to 4khdhub.js

const fetch = require('node-fetch');
const cheerio = require('cheerio');

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const ANILIST_URL = 'https://graphql.anilist.co';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Connection': 'keep-alive',
    'Accept': 'application/json, text/plain, */*'
};

const API = 'https://enc-dec.app/api';
const DB_API = 'https://enc-dec.app/db/kai';
const KAI_AJAX = 'https://animekai.to/ajax';

// Debug helper
function log(msg, rid, extra) {
    const prefix = `[AnimeKai]${rid ? `[rid:${rid}]` : ''}`;
    if (extra !== undefined) {
        console.log(`${prefix} ${msg}`, extra);
    } else {
        console.log(`${prefix} ${msg}`);
    }
}

// Request helper
async function request(url, options = {}) {
    const mergedHeaders = Object.assign({}, HEADERS, options.headers || {});
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: mergedHeaders,
        body: options.body,
        timeout: options.timeout || 10000
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
}

// Encryption helpers using enc-dec.app
async function encryptKai(text) {
    try {
        const res = await request(`${API}/enc-kai?text=${encodeURIComponent(text)}`);
        const json = await res.json();
        return json.result;
    } catch (e) {
        throw new Error(`Encryption failed: ${e.message}`);
    }
}

async function decryptKai(text) {
    try {
        const res = await request(`${API}/dec-kai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });
        const json = await res.json();
        return json.result;
    } catch (e) {
        throw new Error(`Decryption failed: ${e.message}`);
    }
}

async function decryptMegaMedia(embedUrl, rid) {
    try {
        const mediaUrl = embedUrl.replace('/e/', '/media/');
        log(`Fetching media metadata: ${mediaUrl}`, rid);
        
        const res = await request(mediaUrl, { headers: { 'Referer': embedUrl } });
        const mediaResp = await res.json();
        
        if (!mediaResp || !mediaResp.result) {
            log(`No result from media metadata: ${mediaUrl}`, rid, mediaResp);
            return null;
        }

        const encrypted = mediaResp.result;
        log(`Decrypting media sources via API`, rid);
        
        const decRes = await request(`${API}/dec-mega`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: encrypted, agent: HEADERS['User-Agent'] })
        });
        const decJson = await decRes.json();
        
        if (!decJson || !decJson.result) {
            log(`Failed to decrypt media sources`, rid, decJson);
            return null;
        }
        
        return decJson.result;
    } catch (e) {
        log(`Error in decryptMegaMedia: ${e.message}`, rid);
        return null;
    }
}

// TMDB Info
async function getTMDBInfo(tmdbId, rid) {
    try {
        const url = `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const res = await request(url);
        const data = await res.json();
        return {
            title: data.name || data.original_name,
            originalTitle: data.original_name,
            year: data.first_air_date ? parseInt(data.first_air_date.split('-')[0]) : null
        };
    } catch (e) {
        log(`TMDB error: ${e.message}`, rid);
        return null;
    }
}

// AniList search
async function searchAniList(title, year, rid) {
    const query = `
        query ($search: String, $year: Int) {
            Media(search: $search, type: ANIME, seasonYear: $year) {
                id
                idMal
                title { english romaji native }
                startDate { year }
            }
        }
    `;

    try {
        const res = await fetch(ANILIST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables: { search: title, year } })
        });
        const json = await res.json();
        if (json.data && json.data.Media) {
            return {
                anilistId: json.data.Media.id,
                malId: json.data.Media.idMal
            };
        }
    } catch (e) {
        log(`AniList error: ${e.message}`, rid);
    }
    return null;
}

// Database lookup
async function findInDatabase(malId, rid) {
    try {
        const url = `${DB_API}/find?mal_id=${malId}`;
        const res = await request(url);
        const results = await res.json();
        if (Array.isArray(results) && results.length > 0) {
            return results[0];
        }
    } catch (e) {
        log(`DB error: ${e.message}`, rid);
    }
    return null;
}

// Quality helpers
function extractQuality(url) {
    if (!url) return 'Unknown';
    const m = url.match(/(\d{3,4})[pPkK]/);
    if (m) return m[1] + 'p';
    if (url.includes('1080')) return '1080p';
    if (url.includes('720')) return '720p';
    if (url.includes('480')) return '480p';
    if (url.includes('360')) return '360p';
    return 'Unknown';
}

function qualityFromResolution(res) {
    if (!res) return 'Unknown';
    const h = parseInt(res.split('x')[1]);
    if (h >= 2160) return '4K';
    if (h >= 1440) return '1440p';
    if (h >= 1080) return '1080p';
    if (h >= 720) return '720p';
    if (h >= 480) return '480p';
    if (h >= 360) return '360p';
    return h + 'p';
}

async function resolveM3U8(url, serverType, rid) {
    try {
        const res = await request(url, {
            headers: { 'Accept': 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*' }
        });
        const content = await res.text();
        const baseUrl = url.split('?')[0].split('/').slice(0, -1).join('/') + '/';
        
        if (content.includes('#EXT-X-STREAM-INF')) {
            const lines = content.split('\n');
            const variants = [];
            let currentRes = null;
            
            for (const line of lines) {
                if (line.includes('RESOLUTION=')) {
                    const m = line.match(/RESOLUTION=(\d+x\d+)/);
                    if (m) currentRes = m[1];
                } else if (line.trim() && !line.startsWith('#')) {
                    const variantUrl = line.startsWith('http') ? line.trim() : baseUrl + line.trim();
                    variants.push({
                        url: variantUrl,
                        quality: qualityFromResolution(currentRes),
                        serverType
                    });
                    currentRes = null;
                }
            }
            return variants;
        }
        return [{ url, quality: 'Unknown', serverType }];
    } catch (e) {
        log(`M3U8 resolution failed for ${url}: ${e.message}`, rid);
        return [{ url, quality: 'Unknown', serverType }];
    }
}

// Main getStreams
async function getStreams(tmdbId, type, season, episode) {
    if (type !== 'tv') return [];

    const rid = Math.random().toString(36).slice(2, 8);
    log(`Starting getStreams for TMDB:${tmdbId} S${season}E${episode}`, rid);

    try {
        // Step 1: TMDB
        const tmdbInfo = await getTMDBInfo(tmdbId, rid);
        if (!tmdbInfo) throw new Error("Could not get TMDB info");
        log(`Step 1: Found title "${tmdbInfo.title}"`, rid);

        // Step 2: AniList -> MAL ID
        let alData = await searchAniList(tmdbInfo.originalTitle || tmdbInfo.title, tmdbInfo.year, rid);
        if (!alData && tmdbInfo.originalTitle !== tmdbInfo.title) {
            alData = await searchAniList(tmdbInfo.title, tmdbInfo.year, rid);
        }
        if (!alData) {
            alData = await searchAniList(tmdbInfo.title, null, rid);
        }
        if (!alData || !alData.malId) throw new Error("Could not find MAL ID");
        log(`Step 2: Found MAL ID ${alData.malId}`, rid);

        // Step 3: Database lookup
        const dbResult = await findInDatabase(alData.malId, rid);
        if (!dbResult) throw new Error("No match in database");
        log(`Step 3: Found in database: ${dbResult.info.title_en}`, rid);

        // Step 4: Episode Token
        const episodes = dbResult.episodes || {};
        const s = String(season || 1);
        const e = String(episode || 1);
        const epData = (episodes[s] && episodes[s][e]) ? episodes[s][e] : null;
        if (!epData || !epData.token) {
            throw new Error(`Episode S${s}E${e} not found in database`);
        }
        const token = epData.token;
        log(`Step 4: Found episode token`, rid);

        // Step 5: Fetch Streams
        const encToken = await encryptKai(token);
        const serversRes = await request(`${KAI_AJAX}/links/list?token=${token}&_=${encToken}`);
        const serversJson = await serversRes.json();
        
        // Parse servers HTML locally using cheerio
        const $ = cheerio.load(serversJson.result);
        const lidPromises = [];

        $('.server').each((_, el) => {
            const lid = $(el).attr('data-lid');
            const serverType = $(el).closest('.server-items').attr('data-id') || 'sub';
            
            if (lid) {
                lidPromises.push((async () => {
                    try {
                        const encLid = await encryptKai(lid);
                        const viewRes = await request(`${KAI_AJAX}/links/view?id=${lid}&_=${encLid}`);
                        const viewJson = await viewRes.json();
                        const decrypted = await decryptKai(viewJson.result);
                        
                        if (decrypted && decrypted.url) {
                            const mediaData = await decryptMegaMedia(decrypted.url, rid);
                            if (mediaData && mediaData.sources) {
                                const sources = [];
                                for (const src of mediaData.sources) {
                                    if (src.file && src.file.includes('.m3u8')) {
                                        const resolved = await resolveM3U8(src.file, serverType, rid);
                                        sources.push(...resolved);
                                    } else if (src.file) {
                                        sources.push({
                                            url: src.file,
                                            quality: extractQuality(src.file),
                                            serverType: serverType
                                        });
                                    }
                                }
                                return sources;
                            }
                        }
                    } catch (err) {
                        log(`Error processing lid ${lid}: ${err.message}`, rid);
                    }
                    return [];
                })());
            }
        });

        const nestedResults = await Promise.all(lidPromises);
        const allSources = nestedResults.flat();
        log(`Step 5: Found ${allSources.length} source candidates`, rid);

        const streams = allSources.map(src => ({
            name: `ANIMEKAI ${src.serverType.toUpperCase()} - ${src.quality}`,
            title: `${tmdbInfo.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
            url: src.url,
            quality: src.quality,
            behaviorHints: {
                bingeGroup: `animekai-${src.serverType}`
            }
        }));

        // Sort by quality
        const order = { '4K': 7, '2160p': 7, '1440p': 6, '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1, 'Unknown': 0 };
        streams.sort((a, b) => (order[b.quality] || 0) - (order[a.quality] || 0));

        log(`🎉 COMPLETE: Returning ${streams.length} stream(s)`, rid);
        return streams;

    } catch (e) {
        log(`❌ ERROR: ${e.message}`, rid);
        return [];
    }
}

module.exports = { getStreams };
