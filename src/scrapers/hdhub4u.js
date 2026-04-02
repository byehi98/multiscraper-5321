/**
 * hdhub4u Scraper for MultiScraper
 * Adapted from: https://github.com/yoruix/nuvio-providers/blob/main/providers/hdhub4u.js
 */
"use strict";

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
let MAIN_URL = "https://new3.hdhub4u.fo";
const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000;
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Cookie": "xla=s4t",
    "Referer": `${MAIN_URL}/`
};

function updateMainUrl(url) {
    MAIN_URL = url;
    HEADERS.Referer = `${url}/`;
}

// Utils
let domainCacheTimestamp = 0;

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "Unknown";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function extractServerName(source) {
    if (!source) return "Unknown";
    if (source.startsWith("HubCloud")) {
        const serverMatch = source.match(/HubCloud(?:\s*-\s*([^[\]]+))?/);
        return serverMatch ? serverMatch[1] || "Download" : "HubCloud";
    }
    if (source.startsWith("Pixeldrain")) return "Pixeldrain";
    if (source.startsWith("StreamTape")) return "StreamTape";
    if (source.startsWith("HubCdn")) return "HubCdn";
    if (source.startsWith("HbLinks")) return "HbLinks";
    if (source.startsWith("Hubstream")) return "Hubstream";
    return source.replace(/^www\./, "").split(".")[0];
}

function rot13(value) {
    return value.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

function atob(value) {
    if (!value) return "";
    let input = String(value).replace(/=+$/, "");
    let output = "";
    let bc = 0, bs, buffer, idx = 0;
    while (buffer = input.charAt(idx++)) {
        buffer = BASE64_CHARS.indexOf(buffer);
        if (~buffer) {
            bs = bc % 4 ? bs * 64 + buffer : buffer;
            if (bc++ % 4) {
                output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
            }
        }
    }
    return output;
}

function cleanTitle(title) {
    let name = title.replace(/\.[a-zA-Z0-9]{2,4}$/, "");
    const normalized = name.replace(/WEB[-_.\s]?DL/gi, "WEB-DL").replace(/WEB[-_.\s]?RIP/gi, "WEBRIP").replace(/H[ .]?265/gi, "H265").replace(/H[ .]?264/gi, "H264").replace(/DDP[ .]?([0-9]\.[0-9])/gi, "DDP$1");
    const parts = normalized.split(/[\s_.]/);
    const sourceTags = new Set(["WEB-DL", "WEBRIP", "BLURAY", "HDRIP", "DVDRIP", "HDTV", "CAM", "TS", "BRRIP", "BDRIP"]);
    const codecTags = new Set(["H264", "H265", "X264", "X265", "HEVC", "AVC"]);
    const audioTags = ["AAC", "AC3", "DTS", "MP3", "FLAC", "DD", "DDP", "EAC3"];
    const audioExtras = new Set(["ATMOS"]);
    const hdrTags = new Set(["SDR", "HDR", "HDR10", "HDR10+", "DV", "DOLBYVISION"]);
    const filtered = parts.map((part) => {
        const p = part.toUpperCase();
        if (sourceTags.has(p)) return p;
        if (codecTags.has(p)) return p;
        if (audioTags.some((tag) => p.startsWith(tag))) return p;
        if (audioExtras.has(p)) return p;
        if (hdrTags.has(p)) return p === "DOLBYVISION" || p === "DV" ? "DOLBYVISION" : p;
        if (p === "NF" || p === "CR") return p;
        return null;
    }).filter(Boolean);
    return [...new Set(filtered)].join(" ");
}

async function fetchAndUpdateDomain() {
    const now = Date.now();
    if (now - domainCacheTimestamp < DOMAIN_CACHE_TTL) return;
    console.log("[HDHub4u] Fetching latest domain...");
    try {
        const response = await fetch(DOMAINS_URL, {
            method: "GET",
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
        if (response.ok) {
            const data = await response.json();
            if (data && data.HDHUB4u) {
                const newDomain = data.HDHUB4u;
                if (newDomain !== MAIN_URL) {
                    console.log(`[HDHub4u] Updating domain from ${MAIN_URL} to ${newDomain}`);
                    updateMainUrl(newDomain);
                    domainCacheTimestamp = now;
                }
            }
        }
    } catch (error) {
        console.error(`[HDHub4u] Failed to fetch latest domains: ${error.message}`);
    }
}

async function getCurrentDomain() {
    await fetchAndUpdateDomain();
    return MAIN_URL;
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
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = words1.filter((w) => set2.has(w));
    const union = new Set([...words1, ...words2]);
    const jaccard = intersection.length / union.size;
    const extraWordsCount = words2.filter((w) => !set1.has(w)).length;
    let score = jaccard - extraWordsCount * 0.05;
    if (words1.length > 0 && words1.every((w) => set2.has(w))) {
        score += 0.2;
    }
    return score;
}

function findBestTitleMatch(mediaInfo, searchResults, mediaType, season) {
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
        if (mediaType === "tv" && season) {
            const titleLower = result.title.toLowerCase();
            const seasonPatterns = [
                `season ${season}`,
                `s${season}`,
                `season ${season.toString().padStart(2, "0")}`,
                `s${season.toString().padStart(2, "0")}`
            ];
            const hasSeason = seasonPatterns.some((p) => titleLower.includes(p));
            const otherSeasonMatch = titleLower.match(/season\s*(\d+)|s(\d+)/i);
            if (otherSeasonMatch) {
                const foundSeason = parseInt(otherSeasonMatch[1] || otherSeasonMatch[2]);
                if (foundSeason !== season) {
                    score -= 0.8;
                }
            }
            if (hasSeason) score += 0.5;
            else score -= 0.3;
        }
        if (result.title.toLowerCase().includes("2160p") || result.title.toLowerCase().includes("4k")) {
            score += 0.05;
        }
        if (score > bestScore && score > 0.3) {
            bestScore = score;
            bestMatch = result;
        }
    }
    if (bestMatch) console.log(`[HDHub4u] Best title match: "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);
    return bestMatch;
}

async function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
    });
    if (!response.ok) throw new Error(`TMDB API error: ${response.status}`);
    const data = await response.json();
    const title = mediaType === "tv" ? data.name : data.title;
    const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
    const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
    return { title, year, imdbId: data.external_ids?.imdb_id || null };
}

// Extractors
async function getRedirectLinks(url) {
    try {
        const response = await fetch(url, { headers: HEADERS });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const doc = await response.text();
        const regex = /s\s*\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]|ck\s*\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g;
        let combinedString = "";
        let match;
        while ((match = regex.exec(doc)) !== null) {
            const extractedValue = match[1] || match[2];
            if (extractedValue) combinedString += extractedValue;
        }
        if (!combinedString) {
            const redirectMatch = doc.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (redirectMatch && redirectMatch[1]) {
                const newUrl = redirectMatch[1];
                if (newUrl !== url && !newUrl.includes(url)) {
                    return await getRedirectLinks(newUrl);
                }
            }
            return null;
        }
        const decodedString = atob(rot13(atob(atob(combinedString))));
        const jsonObject = JSON.parse(decodedString);
        const encodedUrl = atob(jsonObject.o || "").trim();
        if (encodedUrl) return encodedUrl;
        const data = atob(jsonObject.data || "").trim();
        const wpHttp = (jsonObject.blog_url || "").trim();
        if (wpHttp && data) {
            const directLinkResponse = await fetch(`${wpHttp}?re=${data}`, { headers: HEADERS });
            const html = await directLinkResponse.text();
            const $ = cheerio.load(html);
            return ($("body").text() || html).trim();
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function vidStackExtractor(url) {
    try {
        const hash = url.split("#").pop().split("/").pop();
        const baseUrl = new URL(url).origin;
        const apiUrl = `${baseUrl}/api/v1/video?id=${hash}`;
        const response = await fetch(apiUrl, { headers: { ...HEADERS, Referer: url } });
        const encoded = (await response.text()).trim();
        const key = CryptoJS.enc.Utf8.parse("kiemtienmua911ca");
        const ivs = ["1234567890oiuytr", "0123456789abcdef"];
        for (const ivStr of ivs) {
            try {
                const iv = CryptoJS.enc.Utf8.parse(ivStr);
                const decrypted = CryptoJS.AES.decrypt(
                    { ciphertext: CryptoJS.enc.Hex.parse(encoded) },
                    key,
                    { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
                );
                const decryptedText = decrypted.toString(CryptoJS.enc.Utf8);
                if (decryptedText && decryptedText.includes("source")) {
                    const m3u8 = decryptedText.match(/"source":"(.*?)"/)?.[1]?.replace(/\\/g, "");
                    const subtitles = [];
                    const subtitleSection = decryptedText.match(/"subtitle":\{(.*?)\}/)?.[1];
                    if (subtitleSection) {
                        const subtitlePattern = /"([^"]+)":\s*"([^"]+)"/g;
                        let subMatch;
                        while ((subMatch = subtitlePattern.exec(subtitleSection)) !== null) {
                            const lang = subMatch[1];
                            const subPath = subMatch[2].split("#")[0].replace(/\\/g, "");
                            if (subPath) {
                                subtitles.push({
                                    language: lang,
                                    url: subPath.startsWith("http") ? subPath : `${baseUrl}${subPath}`
                                });
                            }
                        }
                    }
                    if (m3u8) {
                        return [{
                            source: "Vidstack Hubstream",
                            quality: "M3U8",
                            url: m3u8.replace("https:", "http:"),
                            headers: {
                                "Referer": url,
                                "Origin": url.split("/").pop()
                            },
                            subtitles
                        }];
                    }
                }
            } catch (e) { }
        }
        return [];
    } catch (e) {
        return [];
    }
}

async function hbLinksExtractor(url) {
    try {
        const response = await fetch(url, { headers: { ...HEADERS, Referer: url } });
        const data = await response.text();
        const $ = cheerio.load(data);
        const links = $("h3 a, h5 a, div.entry-content p a").map((i, el) => $(el).attr("href")).get();
        const results = await Promise.all(links.map((l) => loadExtractor(l, url)));
        return results.flat().map((link) => ({
            ...link,
            source: `${link.source} Hblinks`
        }));
    } catch (e) {
        return [];
    }
}

async function pixelDrainExtractor(link) {
    try {
        const urlObj = new URL(link);
        const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
        const fileId = link.match(/(?:file|u)\/([A-Za-z0-9]+)/)?.[1] || link.split("/").pop();
        if (!fileId) return [{ source: "Pixeldrain", quality: 0, url: link }];
        const finalUrl = link.includes("?download") ? link : `${baseUrl}/api/file/${fileId}?download`;
        return [{ source: "Pixeldrain", quality: 0, url: finalUrl }];
    } catch (e) {
        return [{ source: "Pixeldrain", quality: 0, url: link }];
    }
}

async function streamTapeExtractor(link) {
    try {
        const url = new URL(link);
        url.hostname = "streamtape.com";
        const res = await fetch(url.toString(), { headers: HEADERS });
        const data = await res.text();
        let videoSrc = data.match(/document\.getElementById\('videolink'\)\.innerHTML = (.*?);/)?.[1]?.match(/'(\/\/streamtape\.com\/get_video[^']+)'/)?.[1];
        if (!videoSrc) {
            videoSrc = data.match(/'(\/\/streamtape\.com\/get_video[^']+)'/)?.[1];
        }
        return videoSrc ? [{ source: "StreamTape", quality: 720, url: "https:" + videoSrc }] : [];
    } catch (e) {
        return [];
    }
}

async function hubCloudExtractor(url, referer) {
    try {
        let currentUrl = url.replace("hubcloud.ink", "hubcloud.dad");
        const pageResponse = await fetch(currentUrl, { headers: { ...HEADERS, Referer: referer } });
        let pageData = await pageResponse.text();
        let finalUrl = currentUrl;
        if (!currentUrl.includes("hubcloud.php")) {
            let nextHref = "";
            const $first = cheerio.load(pageData);
            const downloadBtn = $first("#download");
            if (downloadBtn.length) {
                nextHref = downloadBtn.attr("href");
            } else {
                const scriptUrlMatch = pageData.match(/var url = '([^']*)'/);
                if (scriptUrlMatch) nextHref = scriptUrlMatch[1];
            }
            if (nextHref) {
                if (!nextHref.startsWith("http")) {
                    const urlObj = new URL(currentUrl);
                    nextHref = `${urlObj.protocol}//${urlObj.hostname}/${nextHref.replace(/^\//, "")}`;
                }
                finalUrl = nextHref;
                const secondResponse = await fetch(finalUrl, { headers: { ...HEADERS, Referer: currentUrl } });
                pageData = await secondResponse.text();
            }
        }
        const $ = cheerio.load(pageData);
        const size = $("i#size").text().trim();
        const header = $("div.card-header").text().trim();
        const qualityStr = header.match(/(\d{3,4})[pP]/)?.[1];
        const quality = qualityStr ? parseInt(qualityStr) : 1080;
        const headerDetails = cleanTitle(header);
        const labelExtras = (headerDetails ? `[${headerDetails}]` : "") + (size ? `[${size}]` : "");
        const sizeInBytes = (() => {
            const sizeMatch = size.match(/([\d.]+)\s*(GB|MB|KB)/i);
            if (!sizeMatch) return 0;
            const multipliers = { GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 };
            return parseFloat(sizeMatch[1]) * (multipliers[sizeMatch[2].toUpperCase()] || 0);
        })();
        const links = [];
        const elements = $("a.btn").get();
        for (const element of elements) {
            const link = $(element).attr("href");
            const text = $(element).text().toLowerCase();
            const fileName = header || headerDetails || "Unknown";
            if (text.includes("download file") || text.includes("fsl server") || text.includes("s3 server") || text.includes("fslv2") || text.includes("mega server")) {
                let label = "HubCloud";
                if (text.includes("fsl server")) label = "HubCloud - FSL";
                else if (text.includes("s3 server")) label = "HubCloud - S3";
                else if (text.includes("fslv2")) label = "HubCloud - FSLv2";
                else if (text.includes("mega server")) label = "HubCloud - Mega";
                links.push({ source: `${label} ${labelExtras}`, quality, url: link, size: sizeInBytes, fileName });
            } else if (text.includes("buzzserver")) {
                try {
                    const buzzResp = await fetch(`${link}/download`, { method: "GET", headers: { ...HEADERS, Referer: link }, redirect: "manual" });
                    let dlink = buzzResp.headers.get("hx-redirect") || buzzResp.headers.get("HX-Redirect");
                    if (!dlink && buzzResp.url && buzzResp.url !== `${link}/download`) {
                        dlink = buzzResp.url;
                    }
                    if (dlink) {
                        links.push({ source: `HubCloud - BuzzServer ${labelExtras}`, quality, url: dlink, size: sizeInBytes, fileName });
                    }
                } catch (e) { }
            } else if (text.includes("10gbps")) {
                try {
                    const resp = await fetch(link, { method: "GET", redirect: "manual" });
                    const loc = resp.headers.get("location");
                    if (loc && loc.includes("link=")) {
                        const dlink = loc.substring(loc.indexOf("link=") + 5);
                        links.push({ source: `HubCloud - 10Gbps ${labelExtras}`, quality, url: dlink, size: sizeInBytes, fileName });
                    }
                } catch (e) { }
            } else if (link && link.includes("pixeldra")) {
                const results = await pixelDrainExtractor(link);
                links.push(...results.map((l) => ({ ...l, source: `${l.source} ${labelExtras}`, size: sizeInBytes, fileName })));
            } else if (link && !link.includes("magnet:") && link.startsWith("http")) {
                const extracted = await loadExtractor(link, finalUrl);
                links.push(...extracted.map((l) => ({ ...l, quality: l.quality || quality })));
            }
        }
        return links;
    } catch (e) {
        return [];
    }
}

async function hubCdnExtractor(url, referer) {
    try {
        const response = await fetch(url, { headers: { ...HEADERS, Referer: referer } });
        const data = await response.text();
        const encoded = data.match(/r=([A-Za-z0-9+/=]+)/)?.[1];
        if (encoded) {
            const m3u8Link = atob(encoded).substring(atob(encoded).lastIndexOf("link=") + 5);
            return [{ source: "HubCdn", quality: 1080, url: m3u8Link }];
        }
        const scriptEncoded = data.match(/reurl\s*=\s*["']([^"']+)["']/)?.[1];
        if (scriptEncoded) {
            const queryPart = scriptEncoded.split("?r=").pop();
            const m3u8Link = atob(queryPart).substring(atob(queryPart).lastIndexOf("link=") + 5);
            return [{ source: "HubCdn", quality: 1080, url: m3u8Link }];
        }
        return [];
    } catch (e) {
        return [];
    }
}

async function loadExtractor(url, referer = MAIN_URL) {
    try {
        const hostname = new URL(url).hostname;
        const isRedirect = url.includes("?id=") || hostname.includes("techyboy4u") || hostname.includes("gadgetsweb.xyz") || hostname.includes("cryptoinsights.site") || hostname.includes("bloggingvector") || hostname.includes("ampproject.org");
        if (isRedirect) {
            const finalLink = await getRedirectLinks(url);
            if (finalLink && finalLink !== url) return await loadExtractor(finalLink, url);
            return [];
        }
        if (hostname.includes("hubcloud")) return await hubCloudExtractor(url, referer);
        if (hostname.includes("hubcdn")) return await hubCdnExtractor(url, referer);
        if (hostname.includes("hblinks") || hostname.includes("hubstream.dad")) return await hbLinksExtractor(url);
        if (hostname.includes("hubstream") || hostname.includes("vidstack")) return await vidStackExtractor(url);
        if (hostname.includes("pixeldrain")) return await pixelDrainExtractor(url);
        if (hostname.includes("streamtape")) return await streamTapeExtractor(url);
        if (hostname.includes("hdstream4u")) return [{ source: "HdStream4u", quality: 1080, url }];
        if (hostname.includes("hubdrive")) {
            const res = await fetch(url, { headers: { ...HEADERS, Referer: referer } });
            const data = await res.text();
            const href = cheerio.load(data)(".btn.btn-primary.btn-user.btn-success1.m-1").attr("href");
            if (href) return await loadExtractor(href, url);
        }
        return [];
    } catch (e) {
        return [];
    }
}

async function search(query) {
    const today = (new Date()).toISOString().split("T")[0];
    const searchUrl = `https://search.pingora.fyi/collections/post/documents/search?q=${encodeURIComponent(query)}&query_by=post_title,category&query_by_weights=4,2&sort_by=sort_by_date:desc&limit=15&highlight_fields=none&use_cache=true&page=1&analytics_tag=${today}`;
    const response = await fetch(searchUrl, { headers: HEADERS });
    const data = await response.json();
    if (!data || !data.hits) return [];
    return data.hits.map((hit) => {
        const doc = hit.document;
        const title = doc.post_title;
        const yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
        const year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;
        let url = doc.permalink;
        if (url && url.startsWith("/")) {
            url = `${MAIN_URL}${url}`;
        }
        return { title, url, poster: doc.post_thumbnail, year };
    });
}

async function getDownloadLinks(mediaUrl) {
    const domain = await getCurrentDomain();
    const response = await fetch(mediaUrl, { headers: { ...HEADERS, Referer: `${domain}/` } });
    const data = await response.text();
    const $ = cheerio.load(data);
    const typeRaw = $("h1.page-title span").text();
    const isMovie = typeRaw.toLowerCase().includes("movie");
    if (isMovie) {
        const qualityLinks = $("h3 a, h4 a").filter((i, el) => $(el).text().match(/480|720|1080|2160|4K/i));
        const bodyLinks = $(".page-body > div a").filter((i, el) => {
            const href = $(el).attr("href");
            return href && (href.includes("hdstream4u") || href.includes("hubstream"));
        });
        const initialLinks = [...new Set([
            ...qualityLinks.map((i, el) => $(el).attr("href")).get(),
            ...bodyLinks.map((i, el) => $(el).attr("href")).get()
        ])];
        const results = await Promise.all(initialLinks.map((url) => loadExtractor(url, mediaUrl)));
        const allFinalLinks = results.flat();
        const seenUrls = new Set();
        const uniqueFinalLinks = allFinalLinks.filter((link) => {
            if (!link.url || link.url.includes(".zip") || link.name?.toLowerCase().includes(".zip")) return false;
            if (seenUrls.has(link.url)) return false;
            seenUrls.add(link.url);
            return true;
        });
        return { finalLinks: uniqueFinalLinks, isMovie };
    } else {
        const episodeLinksMap = new Map();
        const directLinkBlocks = [];
        $("h3, h4").each((i, element) => {
            const $el = $(element);
            const text = $el.text();
            const anchors = $el.find("a");
            const links = anchors.map((i2, a) => $(a).attr("href")).get();
            const isDirectLinkBlock = anchors.get().some((a) => $(a).text().match(/1080|720|4K|2160/i));
            if (isDirectLinkBlock) {
                directLinkBlocks.push(...links);
                return;
            }
            const episodeMatch = text.match(/(?:EPiSODE\s*(\d+)|E(\d+))/i);
            if (episodeMatch) {
                const epNum = parseInt(episodeMatch[1] || episodeMatch[2]);
                if (!episodeLinksMap.has(epNum)) episodeLinksMap.set(epNum, []);
                episodeLinksMap.get(epNum).push(...links);
                let nextElement = $el.next();
                while (nextElement.length && nextElement.get(0).tagName !== "hr") {
                    const siblingLinks = nextElement.find("a[href]").map((i2, a) => $(a).attr("href")).get();
                    episodeLinksMap.get(epNum).push(...siblingLinks);
                    nextElement = nextElement.next();
                }
            }
        });
        if (directLinkBlocks.length > 0) {
            await Promise.all(directLinkBlocks.map(async (blockUrl) => {
                try {
                    const resolvedUrl = await getRedirectLinks(blockUrl);
                    if (!resolvedUrl) return;
                    const blockRes = await fetch(resolvedUrl, { headers: HEADERS });
                    const blockData = await blockRes.text();
                    const $$ = cheerio.load(blockData);
                    $$("h5 a, h4 a, h3 a").each((i, el) => {
                        const linkText = $$(el).text();
                        const linkHref = $$(el).attr("href");
                        const epMatch = linkText.match(/Episode\s*(\d+)/i);
                        if (epMatch && linkHref) {
                            const epNum = parseInt(epMatch[1]);
                            if (!episodeLinksMap.has(epNum)) episodeLinksMap.set(epNum, []);
                            episodeLinksMap.get(epNum).push(linkHref);
                        }
                    });
                } catch (e) { }
            }));
        }
        const initialLinks = [];
        episodeLinksMap.forEach((links, epNum) => {
            const uniqueLinks = [...new Set(links)];
            initialLinks.push(...uniqueLinks.map((link) => ({ url: link, episode: epNum })));
        });
        const results = await Promise.all(initialLinks.map(async (linkInfo) => {
            try {
                const extracted = await loadExtractor(linkInfo.url, mediaUrl);
                return extracted.map((ext) => ({ ...ext, episode: linkInfo.episode }));
            } catch (e) {
                return [];
            }
        }));
        const allFinalLinks = results.flat();
        const seenUrls = new Set();
        const uniqueFinalLinks = allFinalLinks.filter((link) => {
            if (!link.url || link.url.includes(".zip")) return false;
            if (seenUrls.has(link.url)) return false;
            seenUrls.add(link.url);
            return true;
        });
        return { finalLinks: uniqueFinalLinks, isMovie };
    }
}

async function getStreams(tmdbId, mediaType = "movie", season = null, episode = null) {
    const rid = Math.random().toString(36).slice(2, 8);
    console.log(`[HDHub4u][rid:${rid}] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    try {
        const mediaInfo = await getTMDBDetails(tmdbId, mediaType);
        console.log(`[HDHub4u][rid:${rid}] TMDB Info: "${mediaInfo.title}" (${mediaInfo.year || "N/A"})`);
        const searchQuery = mediaType === "tv" && season ? `${mediaInfo.title} Season ${season}` : mediaInfo.title;
        const searchResults = await search(searchQuery);
        if (searchResults.length === 0) return [];
        const bestMatch = findBestTitleMatch(mediaInfo, searchResults, mediaType, season);
        const selectedMedia = bestMatch || searchResults[0];
        console.log(`[HDHub4u][rid:${rid}] Selected: "${selectedMedia.title}" (${selectedMedia.url})`);
        const result = await getDownloadLinks(selectedMedia.url);
        const finalLinks = result.finalLinks;
        let filteredLinks = finalLinks;
        if (mediaType === "tv" && episode !== null) {
            filteredLinks = finalLinks.filter((link) => link.episode === episode);
        }
        const streams = filteredLinks.map((link) => {
            let mediaTitle = link.fileName && link.fileName !== "Unknown" ? link.fileName : mediaInfo.title;
            if (mediaType === "tv" && season && episode) {
                mediaTitle = `${mediaInfo.title} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
            }
            const serverName = extractServerName(link.source);
            let qualityStr = "Unknown";
            if (typeof link.quality === "number" && link.quality > 0) {
                if (link.quality >= 2160) qualityStr = "4K";
                else if (link.quality >= 1080) qualityStr = "1080p";
                else if (link.quality >= 720) qualityStr = "720p";
                else if (link.quality >= 480) qualityStr = "480p";
            } else if (typeof link.quality === "string") {
                qualityStr = link.quality;
            }
            return {
                name: `HDHub4u | ${serverName}`,
                title: `${mediaTitle}\n${formatBytes(link.size)}`,
                url: link.url,
                quality: qualityStr,
                behaviorHints: {
                    bingeGroup: `hdhub4u-${serverName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
                }
            };
        });
        const qualityOrder = { "4K": 4, "1080p": 2, "720p": 1, "480p": 0, "Unknown": -2 };
        const sorted = streams.sort((a, b) => (qualityOrder[b.quality] || -3) - (qualityOrder[a.quality] || -3));
        console.log(`[HDHub4u][rid:${rid}] COMPLETE: Returning ${sorted.length} stream(s)`);
        return sorted;
    } catch (error) {
        console.error(`[HDHub4u][rid:${rid}] Scraping error: ${error.message}`);
        return [];
    }
}

module.exports = { getStreams };
