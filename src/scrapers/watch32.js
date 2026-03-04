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
        
        if (!search.results || search.results.length === 0) return [];
        
        const matchId = search.results[0].id;
        
        const info = provider.fetchAnimeInfo 
            ? await provider.fetchAnimeInfo(matchId) 
            : await provider.fetchMediaInfo(matchId);

        if (!info.episodes || info.episodes.length === 0) return [];

        const targetEp = info.episodes.find(e => parseInt(e.number) === parseInt(episodeNum));
        if (!targetEp) return [];

        console.log(`[Consumet | ${providerName}] Extracting streams for Episode ${episodeNum}...`);
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
    console.log(`[Consumet] Booting up dynamic extensions...`);
    
    try {
        const ext = await import('@consumet/extensions');
        
        // Grab them directly from the top level based on our debug log!
        const ANIME = ext.ANIME || ext.default.ANIME;
        const MOVIES = ext.MOVIES || ext.default.MOVIES;

        const gogoanime = new ANIME.Gogoanime();
        const dramacool = new MOVIES.Dramacool();

        const title = await getTMDBTitle(tmdbId, mediaType);
        if (!title) return [];

        console.log(`[Consumet] Firing up scrapers for: ${title}`);

        const [animeStreams, dramaStreams] = await Promise.all([
            scrapeProvider(gogoanime, title, episodeNum, "GogoAnime"),
            scrapeProvider(dramacool, title, episodeNum, "DramaCool")
        ]);

        const allStreams = [...animeStreams, ...dramaStreams];
        console.log(`[Consumet] Total streams extracted: ${allStreams.length}`);
        
        return allStreams;
        
    } catch (err) {
        console.error(`[Consumet] Master Error: ${err.message}`);
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
}
