const fetch = require('node-fetch');

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

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

async function scrapeProvider(provider, title, episodeNum, providerName) {
    try {
        console.log(`[Consumet | ${providerName}] Searching: ${title}`);
        const search = await provider.search(title);
        
        if (!search.results || search.results.length === 0) {
            console.log(`[Consumet | ${providerName}] No search results found.`);
            return [];
        }
        
        const matchId = search.results[0].id;
        
        const info = provider.fetchAnimeInfo 
            ? await provider.fetchAnimeInfo(matchId) 
            : await provider.fetchMediaInfo(matchId);

        if (!info.episodes || info.episodes.length === 0) {
            console.log(`[Consumet | ${providerName}] No episodes found for this match.`);
            return [];
        }

        const targetEp = info.episodes.find(e => parseInt(e.number) === parseInt(episodeNum));
        if (!targetEp) {
            console.log(`[Consumet | ${providerName}] Episode ${episodeNum} not found in their list.`);
            return [];
        }

        console.log(`[Consumet | ${providerName}] Extracting streams...`);
        const sources = await provider.fetchEpisodeSources(targetEp.id);
        
        const streams = [];
        if (sources.sources) {
            sources.sources.forEach(src => {
                streams.push({
                    name: providerName,
                    title: `${title}\n${src.quality || 'Auto'}`,
                    url: src.url,
                    behaviorHints: { notWebReady: true }
                });
            });
        }
        return streams;
    } catch (e) {
        console.log(`[Consumet | ${providerName}] Error: ${e.message}`);
        return [];
    }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        const ext = await import('@consumet/extensions');
        const ANIME = ext.ANIME || ext.default.ANIME;
        const MOVIES = ext.MOVIES || ext.default.MOVIES;

        const title = await getTMDBTitle(tmdbId, mediaType);
        if (!title) return [];

        console.log(`[Consumet] Waterfall Search Triggered for: ${title}`);

        const allStreams = [];

        // Helper function to safely find the exact capitalization of the provider
        const getKey = (obj, name) => Object.keys(obj).find(k => k.toLowerCase() === name.toLowerCase());

        // --- 1. THE ANIME WATERFALL ---
        const animeTargets = ['AnimePahe', 'KickAssAnime', 'Hianime', 'AnimeSama'];
        for (const target of animeTargets) {
            const key = getKey(ANIME, target);
            if (key) {
                const provider = new ANIME[key]();
                const streams = await scrapeProvider(provider, title, episodeNum, target);
                
                if (streams.length > 0) {
                    console.log(`[Consumet] Success with ${target}! Skipping backup anime providers.`);
                    allStreams.push(...streams);
                    break; // Stop searching once we have streams!
                }
            }
        }

        // --- 2. THE DRAMA/MOVIE WATERFALL ---
        const movieTargets = ['DramaCool', 'FlixHQ', 'SFlix'];
        for (const target of movieTargets) {
            const key = getKey(MOVIES, target);
            if (key) {
                const provider = new MOVIES[key]();
                const streams = await scrapeProvider(provider, title, episodeNum, target);
                
                if (streams.length > 0) {
                    console.log(`[Consumet] Success with ${target}! Skipping backup movie providers.`);
                    allStreams.push(...streams);
                    break; // Stop searching once we have streams!
                }
            }
        }

        return allStreams;
        
    } catch (err) {
        console.error(`[Consumet] Master Error: ${err.message}`);
        return [];
    }
}

module.exports = { getStreams };
