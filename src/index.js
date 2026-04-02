const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const express = require("express");
const path = require("path");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// Helper function to convert IMDB ID to TMDB ID
async function imdbToTmdb(imdbId, type) {
  try {
    const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const response = await fetch(url);
    const data = await response.json();

    // TMDB returns different keys for movies and TV shows
    if (
      type === "movie" &&
      data.movie_results &&
      data.movie_results.length > 0
    ) {
      return data.movie_results[0].id.toString();
    } else if (
      type === "series" &&
      data.tv_results &&
      data.tv_results.length > 0
    ) {
      return data.tv_results[0].id.toString();
    }

    return null;
  } catch (error) {
    console.error(`Error converting IMDB ID ${imdbId} to TMDB:`, error.message);
    return null;
  }
}

// Helper to safely load scrapers and ensure Vercel bundles them
const allScrapers = [];
function safeLoad(name, loader) {
  try {
    const module = loader();
    if (module && typeof module.getStreams === "function") {
      allScrapers.push({ name, getStreams: module.getStreams });
    } else {
      console.warn(
        `[WARNING] Scraper ${name} does not export getStreams function. Skipping.`,
      );
    }
  } catch (e) {
    console.error(`[ERROR] Failed to load scraper ${name}: ${e.message}`);
  }
}

// Static requires to ensure bundler detection
safeLoad("4KHDHub", () => require("./scrapers/4khdhub"));
safeLoad("AnimeKai", () => require("./scrapers/animekai"));
safeLoad("Castle", () => require("./scrapers/castle"));
// safeLoad("CineVibe", () => require("./scrapers/cinevibe"));
// safeLoad("DahmerMovies", () => require("./scrapers/dahmermovies"));
// safeLoad("DVDPlay", () => require("./scrapers/dvdplay"));
safeLoad("HDHub4u", () => require("./scrapers/hdhub4u"));
// safeLoad("HDRezka", () => require("./scrapers/hdrezka"));
// safeLoad("MalluMV", () => require("./scrapers/mallumv"));
// safeLoad("Mint", () => require("./scrapers/mint"));
// safeLoad("MovieBox", () => require("./scrapers/moviebox"));
// safeLoad("MovieBox", () => require("./scrapers/moviebox"));
// safeLoad("MoviesMod", () => require("./scrapers/moviesmod"));
// safeLoad("MyFlixer", () => require("./scrapers/myflixer-extractor"));
safeLoad("NetMirror", () => require("./scrapers/netmirror"));
// safeLoad("ShowBox", () => require("./scrapers/showbox"));
safeLoad("StreamFlix", () => require("./scrapers/streamflix"));
// safeLoad("UHDMovies", () => require("./scrapers/uhdmovies"));
// safeLoad("Videasy", () => require("./scrapers/videasy"));
// safeLoad("VidLink", () => require("./scrapers/vidlink"));
// safeLoad("VidNest", () => require("./scrapers/vidnest"));
// safeLoad("VidNest-Anime", () => require("./scrapers/vidnest-anime"));
// safeLoad("VidRock", () => require("./scrapers/vidrock"));
// safeLoad("VidSrc", () => require("./scrapers/vidsrc"));
safeLoad("VixSrc", () => require("./scrapers/vixsrc"));
safeLoad("WebStreamr", () => require("./scrapers/webstreamr"));
// safeLoad("Watch32", () => require("./scrapers/watch32"));
// safeLoad("XPrime", () => require("./scrapers/xprime"));
safeLoad("YFlix", () => require("./scrapers/yflix"));

// List of available scrapers (derived from loaded ones)
const scrapersList = allScrapers.map((s) => ({ name: s.name }));

console.log(`Loaded ${allScrapers.length} scrapers successfully.`);

// Helper function to parse configuration from URL
function parseConfig(configString) {
  if (!configString || configString === "configure") {
    return null;
  }

  try {
    const decoded = Buffer.from(configString, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch (e) {
    console.error("Invalid configuration:", e.message);
    return null;
  }
}

// Create the stream handler function
async function handleStream(scrapers, type, id) {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" INCOMING STREAM REQUEST");
  console.log(`   Type: ${type}`);
  console.log(`   ID: ${id}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Stremio ID format: imdbId:season:episode (for series) or just imdbId (for movies)
  const parts = id.split(":");
  const inputId = parts[0];
  const season = type === "series" ? parseInt(parts[1] || "1") : null;
  const episode = type === "series" ? parseInt(parts[2] || "1") : null;

  console.log(`📺 Parsed Request:`);
  console.log(`   Input ID: ${inputId}`);
  if (type === "series") {
    console.log(`   Season: ${season}`);
    console.log(`   Episode: ${episode}`);
  }

  // Check if the ID is an IMDB ID (starts with 'tt') and convert to TMDB
  let tmdbId = inputId;
  if (inputId.startsWith("tt")) {
    console.log(`Converting IMDB ID to TMDB ID...`);
    tmdbId = await imdbToTmdb(inputId, type);

    if (!tmdbId) {
      console.log(`Failed to convert IMDB ID ${inputId} to TMDB ID\n`);
      return { streams: [] };
    }

    console.log(`Converted to TMDB ID: ${tmdbId}`);
  }
  console.log("");

  try {
    let allStreams = [];
    console.log(
      `${type === "movie" ? "Movie" : "Series"} detected - Using ${scrapers.length} scrapers\n`,
    );

    // Normalize type for scrapers: Stremio uses 'series', but scrapers expect 'tv'
    const scraperType = type === "series" ? "tv" : type;

    const results = await Promise.allSettled(
      scrapers.map((scraper) =>
        scraper.getStreams(tmdbId, scraperType, season, episode),
      ),
    );

    results.forEach((result, index) => {
      const scraper = scrapers[index];
      if (result.status === "fulfilled") {
        const streams = result.value || [];
        console.log(`${scraper.name}: Found ${streams.length} stream(s)`);
        allStreams = allStreams.concat(streams);
      } else {
        console.log(
          `${scraper.name}: Failed - ${result.reason?.message || "Unknown error"}`,
        );
      }
    });

    console.log("");

    // Log final results
    if (allStreams.length > 0) {
      console.log(`TOTAL: Returning ${allStreams.length} stream(s)`);
      allStreams.forEach((s, i) => {
        console.log(`   [${i + 1}] ${s.name || "Unknown"}`);
      });
      console.log("");
    } else {
      console.log("No streams found from any scraper\n");
    }

    return { streams: allStreams };
  } catch (e) {
    console.log(" ERROR in stream handler:");
    console.log(`   Message: ${e.message}`);
    console.log(`   Stack: ${e.stack}\n`);
    return { streams: [] };
  }
}

// Function to create addon manifest with configuration
function createAddonManifest(config) {
  let scrapers = allScrapers;
  let description = `All ${scrapersList.length} Scrapers: ${scrapersList.map((s) => s.name).join(", ")}`;

  // Filter scrapers based on configuration
  if (config && config.scrapers && Array.isArray(config.scrapers)) {
    scrapers = allScrapers.filter((s) => config.scrapers.includes(s.name));
    description = `${scrapers.length} Selected Scrapers: ${scrapers.map((s) => s.name).join(", ")}`;
  }

  return {
    id: "multiscraper.sagarchaulagai.github.io",
    version: "1.0.0",
    name: "MultiScraper",
    description: description,
    logo: `${BASE_URL}/assets/icon.png`,
    resources: ["stream"],
    types: ["movie", "series"],
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
  };
}

// Get scrapers based on config
function getScrapers(config) {
  if (config && config.scrapers && Array.isArray(config.scrapers)) {
    const filtered = allScrapers.filter((s) =>
      config.scrapers.includes(s.name),
    );
    console.log(
      `\n🔧 Configuration loaded: ${filtered.length}/${allScrapers.length} scrapers enabled`,
    );
    return filtered;
  }
  return allScrapers;
}

// Express app setup
const app = express();

// Serve static files (configuration page)
app.use(express.static(path.join(__dirname, "../public")));
app.use("/assets", express.static(path.join(__dirname, "../assets")));

// Helper to get base URL
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : `http://localhost:${process.env.PORT || 7000}`;

// Landing page - redirect to configure.html
app.get("/", (req, res) => {
  res.redirect("/configure.html");
});

// Manifest without configuration (default - all scrapers)
app.get("/manifest.json", (req, res) => {
  const manifest = createAddonManifest(null);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");
  res.send(manifest);
});

// Manifest with configuration
app.get("/:config/manifest.json", (req, res) => {
  const config = parseConfig(req.params.config);
  const manifest = createAddonManifest(config);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");
  res.send(manifest);
});

// Stream handler without configuration
app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const scrapers = getScrapers(null);
    const result = await handleStream(scrapers, req.params.type, req.params.id);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Content-Type", "application/json");
    res.send(result);
  } catch (err) {
    console.error("Stream handler error:", err);
    res.status(500).send({ streams: [] });
  }
});

// Stream handler with configuration
app.get("/:config/stream/:type/:id.json", async (req, res) => {
  try {
    const config = parseConfig(req.params.config);
    const scrapers = getScrapers(config);
    const result = await handleStream(scrapers, req.params.type, req.params.id);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Content-Type", "application/json");
    res.send(result);
  } catch (err) {
    console.error("Stream handler error:", err);
    res.status(500).send({ streams: [] });
  }
});

// Start server if main module
if (require.main === module) {
  const PORT = process.env.PORT || 7000;
  app.listen(PORT, () => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`MultiScraper Streams+ Stremio Addon`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Server running on ${BASE_URL}`);
    console.log(`Configure at: ${BASE_URL}/configure.html`);
    console.log(`Install URL: ${BASE_URL}/manifest.json`);
    console.log(`${"=".repeat(60)}\n`);
  });
}

module.exports = app;
