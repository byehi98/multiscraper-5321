const fetch = require('node-fetch');
const cheerio = require('cheerio');

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// Updated with the latest active domains from global web traffic data
const DOMAINS = [
    "https://vegamovies.hot",
    "https://vegamovies.uz",
    "https://vegamovies.video",
    "https://vegamovies.name",
    "https://vegamoviese.biz",
    "https://vegamovies.do",
    "https://vegamovies.yt",
    "https://vegamovies.is"
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
                // THE FIX: Use SEO-friendly search routing to bypass the blocked /?s= parameter
                const searchFormat = title.replace(/\s+/g, '+');
                const searchUrl = `${domain}/search/${searchFormat}/`;
                
                const response = await gotScraping({
                    url: searchUrl,
                    responseType: 'text',
                    timeout: { request: 8000 }
                });

                const $ = cheerio.load(response.body);
                const pageTitle = $('title').text().toLowerCase();
                
                if (pageTitle.includes('just a moment') || pageTitle.includes('cloudflare') || pageTitle.length < 15) {
                    console.log(`[Vegamovies] Hit Cloudflare or Parked Domain on ${domain}. Moving to next...`);
                    continue; 
                }

                // If the title doesn't include our movie or the word "search", it likely redirected to the homepage again
                if (!pageTitle.includes('search') && !pageTitle.includes(title.toLowerCase())) {
                    console.log(`[Vegamovies] Search blocked on ${domain} (Redirected to Homepage). Moving to next...`);
                    continue;
                }

                const streams = [];
                const uniqueLinks = new Set(); 

                $('a').each((i, element) => {
                    const linkText = $(element).text().trim();
                    const linkTitleAttr = $(element).attr('title') || "";
                    const imgAlt = $(element).find('img').attr('alt') || ""; 
                    let postLink = $(element).attr('href');
                    
                    if (!postLink || postLink === '#' || postLink.startsWith('javascript:')) return;

                    if (postLink.startsWith('/')) {
                        postLink = domain + postLink;
                    }
                    
                    const allText = `${linkText} ${linkTitleAttr} ${imgAlt} ${postLink}`.toLowerCase();
                    
                    if (postLink.startsWith(domain) && allText.includes(title.toLowerCase())) {
                        
                        if (!uniqueLinks.has(postLink) && !postLink.includes('/page/') && !postLink.includes('/author/')) {
                            uniqueLinks.add(postLink);
                            
                            const displayTitle = linkText.length > 3 ? linkText : imgAlt || title;

                            streams.push({
                                name: "Vegamovies",
                                title: `[Web View]\n${displayTitle.trim()}`,
                                url: postLink,
                                behaviorHints: { notWebReady: false } 
                            });
                        }
                    }
                });

                if (streams.length > 0) {
                    console.log(`[Vegamovies] BINGO! Found ${streams.length} matches on ${domain}.`);
                    return streams; 
                } else {
                    console.log(`[Vegamovies] 0 matches on ${domain}.`);
                    continue; 
                }

            } catch (fetchError) {
                console.log(`[Vegamovies] Domain ${domain} failed to load. Moving to next...`);
            }
        }

        return []; 

    } catch (err) {
        console.error(`[Vegamovies] Master Error: ${err.message}`);
        return [];
    }
}

module.exports = { getStreams };
