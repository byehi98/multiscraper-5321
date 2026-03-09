const fetch = require('node-fetch');
const cheerio = require('cheerio');

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

const DOMAINS = [
    "https://vegamovies.hot",
    "https://vegamovies.yt",
    "https://vegamovies.pe",
    "https://vegamovies.am",
    "https://vegamovies.la",
    "https://vegamovies.vg",
    "https://vegamovies.to",
    "https://vegamovies.is",
    "https://vegamovies.nl",
    "https://vegamovies.rsvp"
];

async function getTMDBTitle(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return mediaType === 'tv' ? data.name : data.title;
    } catch (err) {
        return null;
    }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        const title = await getTMDBTitle(tmdbId, mediaType);
        if (!title) return [];

        const { gotScraping } = await import('got-scraping');
        
        for (const domain of DOMAINS) {
            console.log(`[Vegamovies] Trying domain: ${domain} for "${title}"`);
            
            try {
                const searchUrl = `${domain}/?s=${encodeURIComponent(title)}`;
                const response = await gotScraping({
                    url: searchUrl,
                    responseType: 'text',
                    timeout: { request: 8000 } // Bumped up slightly for heavier pages
                });

                const $ = cheerio.load(response.body);
                const pageTitle = $('title').text().toLowerCase();
                
                // Cloudflare/Fake Domain check
                if (pageTitle.includes('just a moment') || pageTitle.includes('cloudflare') || pageTitle.length < 15) {
                    console.log(`[Vegamovies] Hit Cloudflare or Parked Domain on ${domain}. Moving to next...`);
                    continue; 
                }

                const streams = [];

                // 🚀 The Expanded Net: Checks for almost every common movie layout structure
                const searchResults = $('.post-item, article, .blog-item, .post, .item, .movies-list .ml-item, .result-item, .thumb');

                searchResults.each((i, element) => {
                    // Try finding the title through multiple methods (h2, h3, or a direct title attribute)
                    const titleElement = $(element).find('h2 a, h3 a, .title a, a[title]').first();
                    const fallbackTitle = $(element).find('a').attr('title'); 
                    
                    const postTitle = titleElement.text().trim() || fallbackTitle || "";
                    const postLink = titleElement.attr('href') || $(element).find('a').first().attr('href');
                    
                    if (postTitle && postLink && postTitle.toLowerCase().includes(title.toLowerCase())) {
                        streams.push({
                            name: "Vegamovies",
                            title: `[Web View]\n${postTitle}`,
                            url: postLink,
                            behaviorHints: { notWebReady: false } 
                        });
                    }
                });

                if (streams.length > 0) {
                    console.log(`[Vegamovies] BINGO! Found ${streams.length} matches on ${domain}.`);
                    return streams; 
                } else {
                    // 🔍 SPYGLASS 2.0: Print exactly what text the website actually sent us!
                    const bodySnippet = $('body').text().substring(0, 150).replace(/\s+/g, ' ').trim();
                    console.log(`[Vegamovies] 0 matches. Site Title: "${$('title').text()}" | Body Snippet: "${bodySnippet}"`);
                    continue; 
                }

            } catch (fetchError) {
                console.log(`[Vegamovies] Domain ${domain} failed to load (Timeout/Offline). Moving to next...`);
            }
        }

        return []; 

    } catch (err) {
        console.error(`[Vegamovies] Master Error: ${err.message}`);
        return [];
    }
}

module.exports = { getStreams };
