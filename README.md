# Aniways Extensions

Repository of community-maintained source extensions

---

## Disclaimer

This repository contains community-contributed scrapers and metadata resolvers designed for personal research and interoperability.

- **No Media Stored**: This repository does not host, store, cache, upload, or transmit any video files, media streams, or copyrighted content.
- **Link Resolution Only**: Extensions are client-side JavaScript scripts that parse publicly accessible web pages and extract hyperlinks already available on the open Internet.
- **Third-Party Sources**: Maintainers and contributors of this repository do not own, control, or endorse any third-party websites, providers, or services accessed by extensions.
- **Compliance**: Users are responsible for ensuring that their use of these extensions complies with all applicable local laws, regulations, and third-party terms of service.

---

## Adding this Repository in Aniways

1. Open **Aniways** on your device.
2. Navigate to **Settings** > **Extensions** > **Repositories**.
3. Tap **Add Custom Repository**.
4. Enter the Catalog URL:
   ```
   https://raw.githubusercontent.com/aniwaysofficial/aniways-extensions/main/index.json
   ```
5. Switch to the **Browse** tab to install extensions.

---

## Available Extensions

| Extension      | Audio     | Format        | Language | Description                                                  |
| -------------- | --------- | ------------- | -------- | ------------------------------------------------------------ |
| **HiAnime**    | Sub & Dub | Direct HLS    | English  | Multi-server HLS streams with multi-language soft subtitles. |
| **Gogoanime**  | Sub & Dub | HLS / Embed   | English  | High availability multi-server streaming source.             |
| **Anikoto**    | Sub & Dub | Direct HLS    | English  | Fast direct HLS streams with soft subtitles.                 |
| **AniZone**    | Sub       | Direct HLS    | English  | Clean direct HLS streams with soft subtitles.                |
| **AniWaves**   | Sub & Dub | Multi-server  | English  | Multi-server embed resolution and soft subtitle tracks.      |
| **AnimeOnsen** | Sub       | DASH / Direct | English  | Direct DASH/MP4 streams with multi-language soft subtitles.  |
| **AnimeGG**    | Sub & Dub | Direct MP4    | English  | Direct MP4 video stream extractors.                          |

---

## Creating an Extension

Aniways extensions are self-contained JavaScript files that run inside an isolated QuickJS runtime on the device.

### Repository Layout

When adding a new extension, place files in the following structure:

```
aniways-extensions/
├── dist/
│   └── myextension.js    # Self-contained JavaScript bundle
├── icons/
│   └── myextension.png   # 128x128 or 256x256 PNG icon
├── index.json            # Repository extension catalog
└── README.md
```

---

### Extension Specification

An extension file must be wrapped in an IIFE (Immediately Invoked Function Expression) and call `registerExtension(extensionObject)`.

```javascript
/**
 * Example Extension for Aniways
 * Version: 1.0.0
 */
(function () {
  const MyExtension = {
    // Unique lowercase alphanumeric identifier
    id: "myextension",

    // Human-readable display name
    name: "My Source",

    // Semantic version string
    version: "1.0.0",

    // Monotonically increasing integer for update detection
    versionCode: 1,

    // Extension author or organization
    author: "Community",

    // Base domain of the source website
    baseUrl: "https://example.com",

    // Supported audio types: "sub", "dub", or both
    audio: ["sub", "dub"],

    // ISO 639-1 language code
    lang: "en",

    // Short description shown in extension browser
    description: "High quality streaming from My Source.",

    /**
     * Resolves episodes for the given anime media metadata.
     *
     * @param {Object} meta Media information from AniList
     * @param {number} meta.anilistId AniList ID
     * @param {number} [meta.malId] MyAnimeList ID
     * @param {Object} meta.titles Title variations
     * @param {string} [meta.titles.english] English title
     * @param {string} [meta.titles.romaji] Romaji title
     * @param {string} [meta.titles.native] Japanese/Native title
     * @param {string[]} [meta.titles.synonyms] Alternative synonyms
     * @param {number} [meta.year] Release year
     * @param {string} [meta.format] "TV", "MOVIE", "OVA", "ONA", "SPECIAL"
     * @param {string} [meta.season] "WINTER", "SPRING", "SUMMER", "FALL"
     * @param {boolean} [meta.isAdult] Whether media is NSFW
     * @returns {Promise<Array<EpisodeItem>>}
     */
    async getEpisodes(meta) {
      // 1. Search the target website using title variations
      // 2. Select the matching anime entry
      // 3. Return an array of episode items
      return [
        {
          number: 1,
          title: "Episode 1",
          ref: "anime-slug/ep-1", // Unique identifier passed to getStreams
          image: "https://...", // Optional thumbnail URL
          duration: 1440, // Optional runtime in seconds
          sub: true, // Whether subbed stream exists
          dub: false, // Whether dubbed stream exists
          filler: false, // Optional filler tag
          recap: false, // Optional recap tag
        },
      ];
    },

    /**
     * Resolves playable video stream URLs and subtitles for a specific episode.
     *
     * @param {string} episodeRef The 'ref' string returned in getEpisodes
     * @param {"sub"|"dub"} audio Requested audio track
     * @returns {Promise<{ streams: Array<StreamSource> }>}
     */
    async getStreams(episodeRef, audio) {
      // Fetch stream URLs, decrypt tokens if needed, and return stream list
      return {
        streams: [
          {
            url: "https://example.com/master.m3u8",
            type: "hls", // "hls" | "mp4" | "embed"
            server: "HD-1", // Server name shown to user
            quality: "1080p", // "1080p" | "720p" | "auto"
            headers: {
              // Optional HTTP headers required for playback
              Referer: "https://example.com/",
              "User-Agent": "Mozilla/5.0 ...",
            },
            subtitles: [
              // Optional soft subtitle tracks
              {
                url: "https://example.com/sub.vtt",
                lang: "en",
                label: "English",
                default: true,
              },
            ],
          },
        ],
      };
    },
  };

  registerExtension(MyExtension);
})();
```

---

### Injected Host APIs

Extensions execute in a sandboxed JavaScript runtime with the following global host utilities:

#### 1. Network Requests (`fetch` and `aniways.http`)

Bypasses browser CORS restrictions natively on the host:

```javascript
// Standard fetch API
const response = await fetch("https://api.example.com/data", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Referer: "https://example.com/",
  },
  body: JSON.stringify({ query: "example-title" }),
});
const text = await response.text();
const json = await response.json();

// Or helper methods
const html = await aniways.http.get(
  "https://example.com/search?q=example-title",
  {
    headers: { "User-Agent": "..." },
  },
);
```

#### 2. Cryptographic Bridge (`aniways.crypto`)

Hardware-accelerated cryptography for sources using AES or HMAC token obfuscation:

```javascript
// AES-256-CBC Decryption
const decrypted = await aniways.crypto.aesDecryptCbc(
  ciphertextBase64,
  keyUtf8OrHex,
  ivUtf8OrHex,
);

// AES-256-CBC Encryption
const ciphertext = await aniways.crypto.aesEncryptCbc(
  plaintext,
  keyUtf8OrHex,
  ivUtf8OrHex,
);

// HMAC-SHA256
const signature = await aniways.crypto.hmacSha256(
  payloadString,
  secretKey,
  "base64url", // "base64" | "base64url" | "hex"
);

// Base64URL Encoding & Decoding
const encoded = await aniways.crypto.base64UrlEncode("string");
const decoded = await aniways.crypto.base64UrlDecode("base64url_string");
```

#### 3. Logging & Debugging

```javascript
console.log("[MyExtension] Debug information:", data);
console.warn("[MyExtension] Unexpected response layout");
console.error("[MyExtension] Extraction failed:", error);
```

---

### Registering in `index.json`

Add an entry for your new extension in `index.json`:

```json
{
  "id": "myextension",
  "name": "My Source",
  "version": "1.0.0",
  "versionCode": 1,
  "author": "Community",
  "icon": "icons/myextension.png",
  "audio": ["sub", "dub"],
  "lang": "en",
  "baseUrl": "https://example.com",
  "description": "High quality streaming from My Source.",
  "pkgUrl": "dist/myextension.js"
}
```

---

### Local Testing

To test your extension before submitting:

1. **Local HTTP Server**:
   Start a simple web server in your cloned repository directory:
   ```bash
   python3 -m http.server 8080
   ```
2. **Add Local Repository in Aniways**:
   In Aniways Settings > Extensions > Repositories, add:
   ```
   http://<YOUR_LOCAL_IP>:8080/index.json
   ```
3. **Verify Functionality**:
   - Install the extension from the Browse tab.
   - Test search matching with various anime titles (single-word, long titles, non-English titles).
   - Test episode extraction and playback verification for both Sub and Dub (if supported).
   - Verify that soft subtitles and stream headers work as expected.

---

### Submitting a Pull Request

We welcome new source extensions and fixes. When opening a Pull Request:

1. **Self-Contained**: Ensure the extension JavaScript bundle in `dist/` is pure, self-contained JavaScript with no unbundled external dependencies.
2. **Error Resilient**: Handle network failures or structural changes gracefully. When no matching episodes or streams are found, return an empty array instead of throwing uncaught exceptions.
3. **Icons**: Include a clean 128x128 or 256x256 PNG icon in `icons/<id>.png`.
4. **Catalog Update**: Ensure `index.json` is updated with matching metadata and an incremented `versionCode`.
5. **No Personal or Sensitive Keys**: Do not commit private API credentials, personal tokens, or hardcoded secrets.
6. **PR Title**: Use standard semantic conventions:
   - `feat: add <name> extension`
   - `fix: update stream extraction for <name>`

---

## License

This repository is licensed under the [MIT License](LICENSE).
