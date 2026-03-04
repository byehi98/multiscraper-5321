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
        const search = await provider.search(title);
        
        if (!search.results || search.results.length === 0) return [];
        
        const matchId = search.results[0].id;
        
        const info = provider.fetchAnimeInfo 
            ? await provider.fetchAnimeInfo(matchId) 
            : await provider.fetchMediaInfo(matchId);

        if (!info.episodes || info.episodes.length === 0) return [];

        const targetEp = info.episodes.find(e => parseInt(e.number) === parseInt(episodeNum));
        if (!targetEp) return [];

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

        // Auto-detect HiAnime and DramaCool
        const animeKey = Object.keys(ANIME).find(k => k.toLowerCase().includes('hianime'));
        const dramaKey = Object.keys(MOVIES).find(k => k.toLowerCase().includes('drama'));

        if (!animeKey || !dramaKey) {
            console.log("[Debug] ANIME:", Object.keys(ANIME));
            console.log("[Debug] MOVIES:", Object.keys(MOVIES));
            throw new Error("Could not find providers in the library.");
        }

        console.log(`[Consumet] Auto-detected classes: ${animeKey} & ${dramaKey}`);

        const animeProvider = new ANIME[animeKey]();
        const dramacool = new MOVIES[dramaKey]();

        const title = await getTMDBTitle(tmdbId, mediaType);
        if (!title) return [];

        console.log(`[Consumet] Searching: ${title}`);

        const [animeStreams, dramaStreams] = await Promise.all([
            scrapeProvider(animeProvider, title, episodeNum, "HiAnime"),
            scrapeProvider(dramacool, title, episodeNum, "DramaCool")
        ]);

        return [...animeStreams, ...dramaStreams];
        
    } catch (err) {
        console.error(`[Consumet] Master Error: ${err.message}`);
        return [];
    }
}

module.exports = { getStreams };
