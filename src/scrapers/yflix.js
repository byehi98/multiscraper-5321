const fetch = require('node-fetch');
const cheerio = require('cheerio');

// YFlix Scraper for MultiScraper
// Refactored to follow project standards: async/await, got-scraping, and stealth headers

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const API = 'https://enc-dec.app/api';
const DB_API = 'https://enc-dec.app/db/flix';
const YFLIX_AJAX = 'https://yflix.to/ajax';

// Debug helpers
function log(msg, rid, extra) {
    const prefix = `[YFlix]${rid ? `[rid:${rid}]` : ''}`;
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

    const response = await gotScraping(requestOptions);
    return response;
}

// Enc/Dec helpers
async function encrypt(text, rid) {
    try {
        const res = await request(`${API}/enc-movies-flix?text=${encodeURIComponent(text)}`, { responseType: 'json' });
        return res.body.result;
    } catch (e) {
        log(`Encryption failed: ${e.message}`, rid);
        throw e;
    }
}

async function decrypt(text, rid) {
    try {
        const res = await request(`${API}/dec-movies-flix`, {
            method: 'POST',
            body: { text: text },
            responseType: 'json'
        });
        return res.body.result;
    } catch (e) {
        log(`Decryption failed: ${e.message}`, rid);
        throw e;
    }
}

async function decryptRapidMedia(embedUrl, rid) {
    try {
        const mediaUrl = embedUrl.replace('/e/', '/media/').replace('/e2/', '/media/');
        log(`Fetching media metadata via stealth: ${mediaUrl}`, rid);
        
        const response = await request(mediaUrl, { 
            headers: { 'Referer': embedUrl },
            responseType: 'json'
        });
        
        const userAgent = response.request.options.headers['user-agent'];
        const mediaResp = response.body;
        
        if (!mediaResp || !mediaResp.result) {
            log(`No result from media metadata: ${mediaUrl}`, rid, mediaResp);
            return null;
        }

        const encrypted = mediaResp.result;
        log(`Decrypting media sources via API using agent: ${userAgent.slice(0, 30)}...`, rid);
        
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 200));

        const decRes = await request(`${API}/dec-rapid`, {
            method: 'POST',
            body: { text: encrypted, agent: userAgent },
            responseType: 'json'
        });
        
        return decRes.body.result;
    } catch (e) {
        log(`Error in decryptRapidMedia: ${e.message}`, rid);
        return null;
    }
}

async function parseHtml(html, rid) {
    try {
        const res = await request(`${API}/parse-html`, {
            method: 'POST',
            body: { text: html },
            responseType: 'json'
        });
        return res.body.result;
    } catch (e) {
        log(`HTML parsing failed: ${e.message}`, rid);
        return null;
    }
}

// Database lookup
async function findInDatabase(tmdbId, mediaType, rid) {
    try {
        const type = mediaType === 'movie' ? 'movie' : 'tv';
        const url = `${DB_API}/find?tmdb_id=${tmdbId}&type=${type}`;
        const res = await request(url, { responseType: 'json' });
        if (Array.isArray(res.body) && res.body.length > 0) {
            return res.body[0];
        }
    } catch (e) {
        log(`DB error: ${e.message}`, rid);
    }
    return null;
}

// HLS helpers
function parseQualityFromM3u8(m3u8Text, baseUrl = '') {
    const streams = [];
    const lines = m3u8Text.split(/\r?\n/);
    let currentInfo = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
            const bwMatch = line.match(/BANDWIDTH=\s*(\d+)/i);
            const resMatch = line.match(/RESOLUTION=\s*(\d+)x(\d+)/i);

            currentInfo = {
                bandwidth: bwMatch ? parseInt(bwMatch[1]) : null,
                width: resMatch ? parseInt(resMatch[1]) : null,
                height: resMatch ? parseInt(resMatch[2]) : null,
                quality: null
            };

            if (currentInfo.height) {
                currentInfo.quality = `${currentInfo.height}p`;
            } else if (currentInfo.bandwidth) {
                const bps = currentInfo.bandwidth;
                if (bps >= 6_000_000) currentInfo.quality = '2160p';
                else if (bps >= 4_000_000) currentInfo.quality = '1440p';
                else if (bps >= 2_500_000) currentInfo.quality = '1080p';
                else if (bps >= 1_500_000) currentInfo.quality = '720p';
                else if (bps >= 800_000) currentInfo.quality = '480p';
                else if (bps >= 400_000) currentInfo.quality = '360p';
                else currentInfo.quality = '240p';
            }
        } else if (line && !line.startsWith('#') && currentInfo) {
            let streamUrl = line;
            if (!streamUrl.startsWith('http') && baseUrl) {
                try {
                    const url = new URL(streamUrl, baseUrl);
                    streamUrl = url.href;
                } catch (e) {}
            }

            streams.push({
                url: streamUrl,
                quality: currentInfo.quality || 'unknown',
                bandwidth: currentInfo.bandwidth,
                width: currentInfo.width,
                height: currentInfo.height,
                type: 'hls'
            });

            currentInfo = null;
        }
    }

    return {
        isMaster: m3u8Text.includes('#EXT-X-STREAM-INF'),
        streams: streams.sort((a, b) => (b.height || 0) - (a.height || 0))
    };
}

async function enhanceStreamsWithQuality(streams, rid) {
    const enhancedStreams = [];
    const tasks = streams.map(async (s) => {
        if (s && s.url && s.url.includes('.m3u8')) {
            try {
                const res = await request(s.url);
                const text = res.body;
                const info = parseQualityFromM3u8(text, s.url);
                if (info.isMaster && info.streams.length > 0) {
                    info.streams.forEach(qualityStream => {
                        enhancedStreams.push({
                            ...s,
                            ...qualityStream,
                            masterUrl: s.url
                        });
                    });
                } else {
                    enhancedStreams.push({ ...s, quality: s.quality || 'unknown' });
                }
            } catch (e) {
                enhancedStreams.push({ ...s, quality: s.quality || 'Adaptive' });
            }
        } else {
            enhancedStreams.push(s);
        }
    });

    await Promise.all(tasks);
    return enhancedStreams;
}

// Main getStreams function
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    const rid = Math.random().toString(36).slice(2, 8);
    log(`getStreams start tmdbId=${tmdbId} type=${mediaType} S=${seasonNum || ''} E=${episodeNum || ''}`, rid);

    try {
        const dbResult = await findInDatabase(tmdbId, mediaType, rid);
        if (!dbResult) {
            log('no match found in database', rid);
            return [];
        }

        const info = dbResult.info;
        const episodes = dbResult.episodes;
        log(`database match found: ${info.title_en}`, rid);

        let eid = null;
        const s = String(seasonNum || 1);
        const e = String(episodeNum || 1);

        if (episodes && episodes[s] && episodes[s][e]) {
            eid = episodes[s][e].eid;
        } else {
            const seasons = Object.keys(episodes || {});
            if (seasons.length > 0) {
                const firstSeason = seasons[0];
                const episodesInSeason = Object.keys(episodes[firstSeason] || {});
                if (episodesInSeason.length > 0) {
                    eid = episodes[firstSeason][episodesInSeason[0]].eid;
                }
            }
        }

        if (!eid) {
            log('no episode ID found', rid);
            return [];
        }

        const encEid = await encrypt(eid, rid);
        const serversRes = await request(`${YFLIX_AJAX}/links/list?eid=${eid}&_=${encEid}`, { responseType: 'json' });
        const servers = await parseHtml(serversRes.body.result, rid);
        
        if (!servers) return [];

        const allStreams = [];
        const lidPromises = [];

        Object.keys(servers).forEach(serverType => {
            Object.keys(servers[serverType]).forEach(serverKey => {
                const lid = servers[serverType][serverKey].lid;
                lidPromises.push((async () => {
                    try {
                        const encLid = await encrypt(lid, rid);
                        const embedRes = await request(`${YFLIX_AJAX}/links/view?id=${lid}&_=${encLid}`, { responseType: 'json' });
                        const decrypted = await decrypt(embedRes.body.result, rid);
                        
                        if (decrypted && decrypted.url && decrypted.url.includes('rapidshare.')) {
                            const rapidData = await decryptRapidMedia(decrypted.url, rid);
                            if (rapidData && rapidData.sources) {
                                const sources = [];
                                rapidData.sources.forEach(src => {
                                    if (src.file) {
                                        sources.push({
                                            url: src.file,
                                            quality: src.file.includes('.m3u8') ? 'Adaptive' : 'unknown',
                                            type: src.file.includes('.m3u8') ? 'hls' : 'file',
                                            provider: 'rapidshare',
                                            serverType: serverType
                                        });
                                    }
                                });
                                const enhanced = await enhanceStreamsWithQuality(sources, rid);
                                enhanced.forEach(s => allStreams.push(s));
                            }
                        }
                    } catch (err) {
                        log(`Error processing lid ${lid}: ${err.message}`, rid);
                    }
                })());
            });
        });

        await Promise.all(lidPromises);

        const seen = new Set();
        const deduped = allStreams.filter(s => {
            if (!s || !s.url || seen.has(s.url)) return false;
            seen.add(s.url);
            return true;
        });

        const results = deduped.map(stream => ({
            name: `YFlix ${stream.serverType.toUpperCase()} - ${stream.quality}`,
            title: `${info.title_en}${mediaType === 'tv' ? ` S${seasonNum}E${episodeNum}` : ''}`,
            url: stream.url,
            quality: stream.quality,
            behaviorHints: {
                bingeGroup: `yflix-${stream.serverType}`
            }
        }));

        log(`🎉 COMPLETE: Returning ${results.length} stream(s)`, rid);
        return results;

    } catch (error) {
        log(`❌ ERROR: ${error.message}`, rid);
        return [];
    }
}

module.exports = { getStreams };
