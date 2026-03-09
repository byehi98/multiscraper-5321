const fetch = require('node-fetch');
const cheerio = require('cheerio');

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// The Ultimate Arsenal of Vegamovies Domains (with the working .hot domain at the top!)
const DOMAINS = [
    "https://vegamovies.hot", // <-- The current champion
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
        
        // Loop through the domains relentlessly
        for (const domain of DOMAINS) {
            console.log(`[Vegamovies] Trying domain: ${domain} for "${title}"`);
            
            try {
                const searchUrl = `${domain}/?s=${encodeURIComponent(title)}`;
                const response = await gotScraping({
                    url: searchUrl,
                    responseType: 'text',
                    timeout: { request: 6000 } // Give it 6 seconds to respond
                });

                const $ = cheerio.load(response.body);
                const pageTitle = $('title').text().toLowerCase();
                
                // If the title is suspiciously short (like just "vegamovies.nl") or blocked by Cloudflare, it's a dead/fake domain
                if (pageTitle.includes('just a moment') || pageTitle.includes('cloudflare') || pageTitle.length < 20) {
                    console.log(`[Vegamovies] Hit Cloudflare or Parked Domain on ${domain}. Moving to next...`);
                    continue; 
                }

                const streams = [];

                $('.post-item, article, .blog-item').each((i, element) => {
                    const titleElement = $(element).find('h2 a, h3 a, .title a').first();
                    const postTitle = titleElement.text().trim();
                    const postLink = titleElement.attr('href');
                    
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
                    return streams; // Return the streams and stop searching
                } else {
                    console.log(`[Vegamovies] No matching movies found on ${domain}. Assuming domain layout changed. Moving to next...`);
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
