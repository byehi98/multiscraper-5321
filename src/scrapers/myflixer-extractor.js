const cheerio = require("cheerio");

// MyFlixer Scraper for Nuvio
// Uses watch32.sx and videostr.net (MegaCloud)

class MyFlixerExtractor {
  constructor() {
    this.mainUrl = "https://watch32.sx";
    this.videostrUrl = "https://videostr.net";
    this.encDecApi = "https://enc-dec.app/api";
  }

  async search(gotScraping, query) {
    try {
      const searchUrl = `${this.mainUrl}/search/${query.replace(/\s+/g, "-")}`;
      console.log(`[MyFlixer] Searching: ${searchUrl}`);
      const response = await gotScraping(searchUrl);
      const $ = cheerio.load(response.body);
      const results = [];
      $(".flw-item").each((i, element) => {
        const title = $(element).find("h2.film-name > a").attr("title");
        const link = $(element).find("h2.film-name > a").attr("href");
        const poster = $(element).find("img.film-poster-img").attr("data-src");
        if (title && link) {
          results.push({
            title,
            url: link.startsWith("http") ? link : `${this.mainUrl}${link}`,
            poster
          });
        }
      });
      console.log(`[MyFlixer] Found ${results.length} results`);
      return results;
    } catch (error) {
      console.error("[MyFlixer] Search error:", error.message);
      return [];
    }
  }

  async getContentDetails(gotScraping, url) {
    try {
      console.log(`[MyFlixer] Getting content details: ${url}`);
      const response = await gotScraping(url);
      const $ = cheerio.load(response.body);
      const contentId = $(".detail_page-watch").attr("data-id");
      const name = $(".detail_page-infor h2.heading-name > a").text();
      const isMovie = url.includes("/movie/");
      
      if (isMovie) {
        return {
          type: "movie",
          name,
          data: `list/${contentId}`
        };
      } else {
        const episodes = [];
        const seasonsResponse = await gotScraping(`${this.mainUrl}/ajax/season/list/${contentId}`);
        const $seasons = cheerio.load(seasonsResponse.body);
        
        const seasonItems = $seasons("a.ss-item").toArray();
        for (const season of seasonItems) {
          const seasonId = $(season).attr("data-id");
          const seasonText = $(season).text().trim();
          const seasonNum = parseInt(seasonText.replace(/Season|Series/i, "").trim()) || 1;
          
          const episodesResponse = await gotScraping(`${this.mainUrl}/ajax/season/episodes/${seasonId}`);
          const $episodes = cheerio.load(episodesResponse.body);
          
          $episodes("a.eps-item").each((i, episode) => {
            const epId = $(episode).attr("data-id");
            const title = $(episode).attr("title");
            const match = title.match(/Eps (\d+): (.+)/i);
            if (match) {
              episodes.push({
                id: epId,
                episode: parseInt(match[1]),
                name: match[2],
                season: seasonNum,
                data: `servers/${epId}`
              });
            } else {
                // Fallback for simple numbering
                const simpleMatch = title.match(/Eps (\d+)/i);
                episodes.push({
                    id: epId,
                    episode: simpleMatch ? parseInt(simpleMatch[1]) : (i + 1),
                    name: title,
                    season: seasonNum,
                    data: `servers/${epId}`
                });
            }
          });
        }
        return {
          type: "series",
          name,
          episodes
        };
      }
    } catch (error) {
      console.error("[MyFlixer] Content details error:", error.message);
      return null;
    }
  }

  async getServerLinks(gotScraping, data) {
    try {
      console.log(`[MyFlixer] Getting server links: ${data}`);
      const response = await gotScraping(`${this.mainUrl}/ajax/episode/${data}`);
      const $ = cheerio.load(response.body);
      const servers = [];
      $("a.link-item").each((i, element) => {
        const linkId = $(element).attr("data-linkid") || $(element).attr("data-id");
        if (linkId) {
          servers.push(linkId);
        }
      });
      return servers;
    } catch (error) {
      console.error("[MyFlixer] Server links error:", error.message);
      return [];
    }
  }

  async getSourceUrl(gotScraping, linkId) {
    try {
      const response = await gotScraping(`${this.mainUrl}/ajax/episode/sources/${linkId}`).json();
      return response.link;
    } catch (error) {
      console.error("[MyFlixer] Source URL error:", error.message);
      return null;
    }
  }

  async extractVideostrM3u8(gotScraping, url) {
    try {
      console.log(`[MyFlixer] Extracting from Videostr: ${url}`);
      const id = url.split("/").pop().split("?")[0];
      
      const embedResponse = await gotScraping(url, {
        headers: {
          "Referer": this.mainUrl,
        }
      });
      const embedHtml = embedResponse.body;
      const userAgent = embedResponse.request.options.headers['user-agent'];
      
      let nonce = embedHtml.match(/\b[a-zA-Z0-9]{48}\b/);
      if (nonce) {
        nonce = nonce[0];
      } else {
        const matches = embedHtml.match(/\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/);
        if (matches) {
          nonce = matches[1] + matches[2] + matches[3];
        }
      }
      
      if (!nonce) throw new Error("Could not extract nonce");

      const apiUrl = `${this.videostrUrl}/embed-1/v3/e-1/getSources?id=${id}&_k=${nonce}`;
      const sourcesResponse = await gotScraping(apiUrl, {
        headers: {
          "Accept": "*/*",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": url,
        }
      });
      
      const sourcesData = JSON.parse(sourcesResponse.body);
      if (!sourcesData.sources) throw new Error("No sources found in response");

      let m3u8Url = "";
      if (Array.isArray(sourcesData.sources)) {
          m3u8Url = sourcesData.sources[0].file;
      } else if (typeof sourcesData.sources === 'string') {
          console.log("[MyFlixer] Sources are encrypted, attempting to decrypt via enc-dec.app...");
          
          // Throttling as per GEMINI.md
          await new Promise(r => setTimeout(r, 200));
          
          const decResponse = await gotScraping({
              url: `${this.encDecApi}/dec-mega`,
              method: 'POST',
              json: {
                  text: sourcesData.sources,
                  agent: userAgent
              }
          }).json();
          
          if (decResponse && decResponse.result) {
              const decrypted = typeof decResponse.result === 'string' ? JSON.parse(decResponse.result) : decResponse.result;
              m3u8Url = decrypted[0].file;
          } else {
              throw new Error("Decryption failed: " + (decResponse.error || "Unknown error"));
          }
      }

      if (!m3u8Url) throw new Error("Could not find M3U8 URL");
      
      console.log(`[MyFlixer] Final M3U8 URL: ${m3u8Url.substring(0, 60)}...`);
      const qualities = await this.parseM3U8Qualities(gotScraping, m3u8Url);
      
      return {
        m3u8Url,
        qualities,
        headers: {
          "Referer": this.videostrUrl + "/",
          "Origin": this.videostrUrl,
          "User-Agent": userAgent
        }
      };
    } catch (error) {
      console.error("[MyFlixer] Videostr extraction error:", error.message);
      return null;
    }
  }

  async parseM3U8Qualities(gotScraping, masterUrl) {
    try {
      const response = await gotScraping(masterUrl, {
        headers: {
          "Referer": this.videostrUrl + "/",
          "Origin": this.videostrUrl
        }
      });
      const playlist = response.body;
      const qualities = [];
      const lines = playlist.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          const nextLine = lines[i + 1]?.trim();
          if (nextLine && !nextLine.startsWith("#")) {
            const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
            const resolution = resolutionMatch ? resolutionMatch[1] : "Unknown";
            const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
            let quality = "Unknown";
            if (resolution.includes("1920x1080")) quality = "1080p";
            else if (resolution.includes("1280x720")) quality = "720p";
            else if (resolution.includes("640x360")) quality = "360p";
            else if (resolution.includes("854x480")) quality = "480p";
            
            qualities.push({
              quality,
              resolution,
              bandwidth,
              url: nextLine.startsWith("http") ? nextLine : new URL(nextLine, masterUrl).href
            });
          }
        }
      }
      qualities.sort((a, b) => b.bandwidth - a.bandwidth);
      return qualities;
    } catch (error) {
      console.error("[MyFlixer] Error parsing M3U8 qualities:", error.message);
      return [];
    }
  }

  async extractM3u8Links(gotScraping, query, episodeNumber = null, seasonNumber = null) {
    try {
      const searchResults = await this.search(gotScraping, query);
      if (searchResults.length === 0) return [];

      let selectedResult = searchResults.find(
        (result) => result.title.toLowerCase() === query.toLowerCase()
      );
      if (!selectedResult) {
        const queryWords = query.toLowerCase().split(" ");
        selectedResult = searchResults.find((result) => {
          const titleLower = result.title.toLowerCase();
          return queryWords.every((word) => titleLower.includes(word));
        });
      }
      if (!selectedResult) selectedResult = searchResults[0];
      
      console.log(`[MyFlixer] Selected: ${selectedResult.title}`);
      const contentDetails = await this.getContentDetails(gotScraping, selectedResult.url);
      if (!contentDetails) return [];

      let dataToProcess = [];
      if (contentDetails.type === "movie") {
        dataToProcess.push(contentDetails.data);
      } else {
        let episodes = contentDetails.episodes;
        if (seasonNumber) episodes = episodes.filter((ep) => ep.season === seasonNumber);
        if (episodeNumber) episodes = episodes.filter((ep) => ep.episode === episodeNumber);
        
        if (episodes.length === 0) {
          console.log("[MyFlixer] No matching episodes found");
          return [];
        }
        const targetEpisode = episodes[0];
        console.log(`[MyFlixer] Selected episode: S${targetEpisode.season}E${targetEpisode.episode}`);
        dataToProcess.push(targetEpisode.data);
      }

      const allM3u8Links = [];
      for (const data of dataToProcess) {
        const serverLinks = await this.getServerLinks(gotScraping, data);
        console.log(`[MyFlixer] Found ${serverLinks.length} servers`);
        
        for (const linkId of serverLinks) {
          try {
            const sourceUrl = await this.getSourceUrl(gotScraping, linkId);
            if (sourceUrl && sourceUrl.includes("videostr.net")) {
              const result = await this.extractVideostrM3u8(gotScraping, sourceUrl);
              if (result) {
                allM3u8Links.push({
                  source: "videostr",
                  m3u8Url: result.m3u8Url,
                  qualities: result.qualities,
                  headers: result.headers
                });
              }
            }
          } catch (error) {
            console.error(`[MyFlixer] Error processing link ${linkId}:`, error.message);
          }
        }
      }
      return allM3u8Links;
    } catch (error) {
      console.error("[MyFlixer] Extraction error:", error.message);
      return [];
    }
  }
}

// Stremio Addon Adapter
async function getStreams(tmdbId, type, season, episode) {
  const { gotScraping } = await import('got-scraping');
  const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

  try {
    const tmdbType = type === 'series' ? 'tv' : type;
    const tmdbUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const tmdbRes = await gotScraping(tmdbUrl).json();
    const title = tmdbType === 'movie' ? tmdbRes.title : tmdbRes.name;
    const year = (tmdbType === 'movie' ? tmdbRes.release_date : tmdbRes.first_air_date)?.split('-')[0];

    if (!title) throw new Error("Could not get title from TMDB");
    console.log(`[MyFlixer] Fetching streams for: ${title} (${year})`);

    const extractor = new MyFlixerExtractor();
    const links = await extractor.extractM3u8Links(gotScraping, title, episode, season);

    return links.map(link => {
      if (link.qualities && link.qualities.length > 0) {
        return link.qualities.map(q => ({
          name: `MyFlixer - ${q.quality}`,
          title: `${title} (${year})\n${q.resolution || ''}`,
          url: q.url,
          quality: q.quality,
          headers: link.headers || {},
          behaviorHints: { bingeGroup: `myflixer-${link.source}` }
        }));
      } else {
        return [{
          name: `MyFlixer - Auto`,
          title: `${title} (${year})`,
          url: link.m3u8Url,
          quality: 'Auto',
          headers: link.headers || {},
          behaviorHints: { bingeGroup: `myflixer-${link.source}` }
        }];
      }
    }).flat();
  } catch (e) {
    console.error(`[MyFlixer] Adapter error: ${e.message}`);
    return [];
  }
}

module.exports = { getStreams, MyFlixerExtractor };
