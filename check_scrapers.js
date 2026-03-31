const files = [
  "./src/scrapers/4khdhub",
  "./src/scrapers/animekai",
  // "./src/scrapers/anitaro",
  "./src/scrapers/castle",
  // "./src/scrapers/cinevibe",
  // "./src/scrapers/dahmermovies",
  // "./src/scrapers/dvdplay",
  // "./src/scrapers/hdhub4u",
  // "./src/scrapers/hdrezka",
  // "./src/scrapers/mallumv",
  "./src/scrapers/mint",
  // "./src/scrapers/mapple",
  // "./src/scrapers/moviebox",
  // "./src/scrapers/moviesmod",
  // "./src/scrapers/myflixer-extractor",
  // "./src/scrapers/netmirror",
  // "./src/scrapers/showbox",
  "./src/scrapers/streamflix",
  // "./src/scrapers/uhdmovies",
  // "./src/scrapers/videasy",
  // "./src/scrapers/vidlink",
  // "./src/scrapers/vidnest",
  // "./src/scrapers/vidnest-anime",
  // "./src/scrapers/vidrock",
  // "./src/scrapers/vidsrc",
  "./src/scrapers/vixsrc",
  // "./src/scrapers/watch32",
  "./src/scrapers/webstreamr",
  // "./src/scrapers/xprime",
  "./src/scrapers/yflix",
];

files.forEach((file) => {
  try {
    const module = require(file);
    if (typeof module.getStreams !== "function") {
      console.log(`${file}: getStreams is ${typeof module.getStreams}`);
      console.log(`   Exports:`, Object.keys(module));
    } else {
      console.log(`${file}: OK`);
    }
  } catch (e) {
    console.log(`${file}: Error requiring - ${e.message}`);
  }
});
