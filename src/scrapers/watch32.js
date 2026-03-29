const fetch = require('node-fetch');
const cheerio = require('cheerio');

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

const DOMAINS = [
    "https://themoviesflix.one/",
    "https://vegamovies.hot",
    "https://vegamovies.vodka/"
];

async function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return {
            title: mediaType === 'tv' ? data.name : data.title,
            originalTitle: mediaType === 'tv' ? data.original_name : data.original_title,
            year: (data.release_date || data.first_air_date || '').split('-')[0]
        };
    } catch (err) {
        return null;
    }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        const details = await getTMDBDetails(tmdbId, mediaType);
        if (!details || !details.title) return [];
        const { title, originalTitle, year } = details;

        const { gotScraping } = await import('got-scraping');
        
        for (const domain of DOMAINS) {
            console.log(`[Vegamovies] Trying domain: ${domain} for "${title}"`);
            
            try {
                // Use title + year for better search precision
                const searchFormat = encodeURIComponent(`${title} ${year}`);
                const searchUrl = `${domain}/?s=${searchFormat}`;
                
                const response = await gotScraping({
                    url: searchUrl,
                    responseType: 'text',
                    timeout: { request: 15000 },
                    headerGeneratorOptions: {
                        browsers: [{name: 'chrome', minVersion: 110, maxVersion: 120}],
                        devices: ['desktop']
                    }
                });

                const $ = cheerio.load(response.body);
                const pageTitle = $('title').text().toLowerCase();
                
                if (pageTitle.includes('just a moment') || pageTitle.includes('cloudflare')) {
                    continue; 
                }

                const postLinks = [];
                const uniquePosts = new Set();
                const slugTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const slugOriginal = (originalTitle || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

                $('a').each((i, element) => {
                    let postLink = $(element).attr('href');
                    let linkText = $(element).text().trim().toLowerCase();
                    
                    if (!postLink || !postLink.startsWith('http')) return;
                    if (postLink.includes('/page/') || postLink.includes('/author/') || postLink.includes('/category/')) return;
                    if (postLink === domain || postLink === domain + '/' || postLink.includes('cdn-cgi')) return;

                    const isMatch = linkText.includes(title.toLowerCase()) || 
                                  (originalTitle && linkText.includes(originalTitle.toLowerCase())) ||
                                  postLink.includes(slugTitle) ||
                                  (slugOriginal && postLink.includes(slugOriginal));

                    if (isMatch && postLink.startsWith(domain)) {
                        if (!uniquePosts.has(postLink)) {
                            uniquePosts.add(postLink);
                            postLinks.push(postLink);
                        }
                    }
                });

                if (postLinks.length === 0) continue;

                const streams = [];
                // Process only relevant posts
                for (const postLink of postLinks.slice(0, 2)) {
                    console.log(`[Vegamovies] Extracting from: ${postLink}`);
                    try {
                        const postRes = await gotScraping({
                            url: postLink,
                            responseType: 'text',
                            timeout: { request: 15000 },
                            headerGeneratorOptions: {
                                browsers: [{name: 'chrome', minVersion: 110, maxVersion: 120}],
                                devices: ['desktop']
                            }
                        });
                        const $post = cheerio.load(postRes.body);
                        
                        $post('a').each((i, el) => {
                            const href = $post(el).attr('href');
                            let text = $post(el).text().trim();
                            
                            if (!href || !href.startsWith('http')) return;
                            if (href.includes(domain.replace('https://', '')) || href.includes('facebook.com') || href.includes('twitter.com') || href.includes('telegram.dog')) return;

                            const isDownloadLink = href.includes('mobilejsr.lol') || 
                                                 href.includes('v-cloud') || 
                                                 href.includes('hubcloud') || 
                                                 href.includes('gdflix') || 
                                                 href.includes('fastsub') ||
                                                 href.includes('sharer') ||
                                                 href.includes('drive') ||
                                                 href.includes('link');

                            if (isDownloadLink) {
                                let quality = 'HD';
                                const fullContext = (text + ' ' + ($post(el).closest('p, div').text() || '')).toLowerCase();
                                
                                if (fullContext.includes('2160p') || fullContext.includes('4k')) quality = '4K';
                                else if (fullContext.includes('1080p')) quality = '1080p';
                                else if (fullContext.includes('720p')) quality = '720p';
                                else if (fullContext.includes('480p')) quality = '480p';

                                let size = '';
                                const sizeMatch = fullContext.match(/(\d+(?:\.\d+)?\s*[mgt]b)/);
                                if (sizeMatch) size = sizeMatch[1].toUpperCase();

                                streams.push({
                                    name: "Vegamovies",
                                    title: `[Direct] ${quality}${size ? ` - ${size}` : ''}\n${text.length > 2 ? text : title}`,
                                    url: href,
                                    behaviorHints: { 
                                        notWebReady: true,
                                        bingeGroup: `vegamovies-${quality}`
                                    }
                                });
                            }
                        });

                        if (streams.length === 0) {
                            streams.push({
                                name: "Vegamovies",
                                title: `[Web View]\n${$post('title').text().split('|')[0].trim()}`,
                                url: postLink,
                                behaviorHints: { notWebReady: false }
                            });
                        }

                    } catch (err) {
                        console.log(`[Vegamovies] Failed post: ${postLink}`);
                    }
                }

                if (streams.length > 0) return streams;

            } catch (fetchError) {
                console.log(`[Vegamovies] Domain ${domain} error.`);
            }
        }

        return []; 

    } catch (err) {
        console.error(`[Vegamovies] Master Error: ${err.message}`);
        return [];
    }
}

module.exports = { getStreams };
