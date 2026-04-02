# MultiScraper Engineering Standards

This document defines the mandatory patterns and architectural standards for all scrapers within this project. These instructions take precedence over general defaults.

## Core Scraper Architecture

### 1. Modern Asynchronous Flow
- **Mandate:** All scrapers must use `async/await` syntax. Legacy `.then()` chains should be refactored when encountered.
- **Error Handling:** Every major step must be wrapped in structured try/catch blocks with surgical logging.
- **Request Identification:** Generate a random Request ID (`rid`) for each `getStreams` call (e.g., `Math.random().toString(36).slice(2, 8)`) to trace logs effectively across concurrent requests.

### 2. Stealth & Anti-Bot Protection
- **Library:** Use `got-scraping` for all requests to video players, embed pages, or metadata endpoints (e.g., MegaUp, Vidsrc, RapidCloud).
- **Emulation:** Always use `headerGeneratorOptions` in `got-scraping` to emulate desktop Chrome (min version 120).
- **Synchronization:** If a decryption API (like `enc-dec.app`) is used after a fetch, you **MUST** pass the exact `User-Agent` captured from the `got-scraping` response to the decryption call. This is critical for bypasses that are UA-bound.

### 3. Parsing Standards
- **Local Parsing:** Always use `cheerio` locally for HTML extraction. **NEVER** use remote HTML-to-JSON parsing APIs as they introduce latency and are single points of failure.
- **HLS/M3U8 Resolution:** For adaptive streams, parse the master playlist to extract individual quality variants (1080p, 720p, etc.) to provide Stremio with explicit quality options.
- **Robust Selectors:** Use attribute-based selectors (e.g., `[data-lid]`) where available, as they are less likely to change than CSS class names.

### 4. API Interaction (enc-dec.app)
- **Reference:** Use `enc_dec_endpoints.json` as the primary reference for all encryption/decryption and database endpoints.
- **Throttling:** Implement a small delay (min 200ms) between rapid consecutive calls to `enc-dec.app` to avoid `500 Internal Server Error` rate limits.
- **Centralized Keys:** Use the project-wide `TMDB_API_KEY` (439c478a771f35c05022f9feabcca01c) for all metadata lookups.
- **Database Lookup:** Prefer using the `enc-dec.app` database endpoints (`/db/kai/find`, `/db/flix/find`) over manual searching when a direct TMDB/MAL mapping is available.

### 5. Meta-Aggregators & External APIs
- **IMDb Mapping:** When integrating meta-aggregators (like WebStreamr), always resolve the IMDb ID from TMDB first, as most aggregators use IMDb as their primary key for accuracy.
- **AniList Integration:** For anime scrapers, use the AniList GraphQL API to map TMDB titles to AniList IDs to access specialized anime providers.
- **Clean Presentation:** Scrapers that aggregate multiple sources must surgically clean the `name` and `title` fields to prevent UI clutter in Stremio. Use concise prefixes (e.g., `WS |` for WebStreamr).

### 6. Stremio Compatibility
- **Result Format:** Ensure all returned streams include `name`, `title`, `url`, and `quality`.
- **Binge Grouping:** Always provide `behaviorHints.bingeGroup` using the format `providerName-serverType` (e.g., `animekai-sub`) to ensure Stremio groups streams correctly.
- **Normalization:** Map incoming `series` types to `tv` for internal scraper logic to match TMDB standards.

## Vercel Deployment & Runtime
- **Safe Loading:** Scrapers MUST be loaded via the `safeLoad` pattern in `src/index.js` to ensure they are detected and bundled correctly by Vercel's build process.
- **Base URL:** Always use the `BASE_URL` helper (which checks `process.env.VERCEL_URL`) for static assets and manifest URLs.
- **IMDb-to-TMDB Helper:** Use the shared `imdbToTmdb` helper in `src/index.js` to handle ID conversions consistently.

## Scraper-Specific Configurations
- **CastleTV:** Requires a valid `CASTLE_SUFFIX` (found in CNCVerse build files) for AES decryption. If this key is rotated, decryption will fail globally.
- **StreamFlix:** Uses a WebSocket-based approach for episode metadata retrieval; ensure the `ws` dependency is available for non-browser environments.

## Established Logging Pattern
Scrapers should follow the established "Step" logging pattern for rapid debugging:
- `Step 1: TMDB Details` (Extracting title/year)
- `Step 2: Mapping` (AniList/Search/Database lookup)
- `Step 3: Database/Provider Lookup` (Finding the entry on the provider site)
- `Step 4: Token/ID Extraction` (Getting the unique ID for the episode/movie)
- `Step 5: Stream Resolution` (Decrypting links and resolving M3U8 variants)

## Legacy Scrapers & Refactoring
- **Context:** Many scrapers (e.g., `vixsrc.js`, `4khdhub.js`) are adapted from `nuvio-providers` and use legacy `fetch` or regex-based extraction.
- **Refactoring Mandate:** When modifying a legacy scraper, prioritize refactoring it to use `got-scraping`, `cheerio`, and the `rid` logging pattern.
- **Gold Standards:** 
    - **Anime/Decryption:** `src/scrapers/animekai.js`
    - **Database/HTML Parsing:** `src/scrapers/yflix.js`
    - **Meta-Aggregators:** `src/scrapers/webstreamr.js`
