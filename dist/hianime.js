/**
 * HiAnime Extension for Aniways
 *  * Direct HLS/MP4 extraction from ZokoAnime, MegaCloud, MegaPlay, and StreamTape.
 * Version: 1.0.0
 * Audio: Sub & Dub
 */
(function() {
  const BASE = "https://hianimes.se";
  const BACKENDS = [
    "https://animehot.cc/api",
    "https://anitv.cfd/api",
  ];

  const HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Referer": BASE + "/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  /* ── String and URL Helpers ────────────────────────────────────────── */

  function cleanTitle(str) {
    return (str || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/<[^>]+>/g, "")
      .trim();
  }

  function normalize(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function base64urlToBase64(str) {
    let b64 = (str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return b64;
  }

  function base64Decode(b64) {
    if (typeof atob === "function") {
      try {
        return atob(b64);
      } catch (_) {}
    }
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let str = "";
    let i = 0;
    b64 = (b64 || "").replace(/[^A-Za-z0-9\+\/\=]/g, "");
    while (i < b64.length) {
      const enc1 = chars.indexOf(b64.charAt(i++));
      const enc2 = chars.indexOf(b64.charAt(i++));
      const enc3 = chars.indexOf(b64.charAt(i++));
      const enc4 = chars.indexOf(b64.charAt(i++));
      const chr1 = (enc1 << 2) | (enc2 >> 4);
      const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const chr3 = ((enc3 & 3) << 6) | enc4;
      str += String.fromCharCode(chr1);
      if (enc3 !== 64 && enc3 !== -1) str += String.fromCharCode(chr2);
      if (enc4 !== 64 && enc4 !== -1) str += String.fromCharCode(chr3);
    }
    return str;
  }

  function decodeUtf8(str) {
    try {
      return decodeURIComponent(escape(str));
    } catch (_) {
      return str;
    }
  }

  function parseUrlParts(urlStr) {
    const origin = (urlStr || "").split("/").slice(0, 3).join("/");
    const withoutOrigin = (urlStr || "").slice(origin.length);
    const pathname = withoutOrigin.split("?")[0].split("#")[0] || "/";
    return {
      origin: origin,
      pathname: pathname,
    };
  }

  /* ── Candidate Scoring ─────────────────────────────────────────────── */

  function scoreCandidate(cand, meta) {
    // 1. Direct MAL ID match from AniList
    if (cand.mal_id && meta.malId && Number(cand.mal_id) === Number(meta.malId)) {
      return 10000;
    }

    let score = 0;
    const normEn = normalize(meta.titles && meta.titles.english);
    const normRom = normalize(meta.titles && meta.titles.romaji);
    const synonyms = (meta.titles && meta.titles.synonyms) || [];

    const candTitles = [cand.title, cand.English, cand.Japanese].filter(Boolean);

    for (const raw of candTitles) {
      const normCand = normalize(raw);
      if (normEn && normCand === normEn) score = Math.max(score, 1000);
      if (normRom && normCand === normRom) score = Math.max(score, 900);
      for (const syn of synonyms) {
        const normSyn = normalize(syn);
        if (normSyn && normCand === normSyn) score = Math.max(score, 850);
      }
    }

    // Match year or season if available
    const candTitleLower = (cand.title || "").toLowerCase();
    const targetText = ((meta.titles && meta.titles.english || "") + " " + (meta.titles && meta.titles.romaji || "") + " " + synonyms.join(" ")).toLowerCase();

    const modifiers = [
      "season 2", "season 3", "season 4", "season 5",
      "2nd season", "3rd season", "4th season", "5th season",
      "movie", "ova", "special", "specials", "part 2", "part 3",
    ];

    for (const mod of modifiers) {
      const candHasMod = candTitleLower.includes(mod);
      const targetHasMod = targetText.includes(mod);
      if (candHasMod && targetHasMod) score += 400;
      if (candHasMod && !targetHasMod) score -= 300;
    }

    return score;
  }

  function extractShowId(anime) {
    if (!anime) return null;
    if (anime._id && /^[0-9a-f]{24}$/i.test(anime._id)) return anime._id;
    const match =
      (anime.imageStorageKey && anime.imageStorageKey.match(/([0-9a-f]{24})/i)) ||
      (anime.image && anime.image.match(/([0-9a-f]{24})/i)) ||
      (anime.landScapeImageStorageKey && anime.landScapeImageStorageKey.match(/([0-9a-f]{24})/i)) ||
      (anime.landScapeImage && anime.landScapeImage.match(/([0-9a-f]{24})/i));
    return match ? match[1] : null;
  }

  /* ── Backend API Helper ────────────────────────────────────────────── */

  async function apiRequest(path, method, body) {
    const cleanPath = path.startsWith("/") ? path : ("/" + path);
    for (const backend of BACKENDS) {
      const url = backend.replace(/\/$/, "") + cleanPath;
      try {
        const headers = Object.assign({}, HEADERS);
        if (method === "POST") headers["Content-Type"] = "application/json";

        const res = await fetch(url, {
          method: method,
          headers: headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        if (res.ok) {
          return await res.json();
        }
      } catch (err) {
        console.warn("HiAnime backend error for " + url + ":", (err && err.message) || err);
      }
    }
    return null;
  }

  /* ── Extractors ────────────────────────────────────────────────────── */

  // 1. ZokoAnime Extractor (Direct HLS & Soft Subtitles via XOR Deobfuscation)
  const ZOKO_KEY = "otaku-embed-v1";

  async function extractZokoAnime(embedUrl) {
    try {
      const pageRes = await fetch(embedUrl, {
        headers: { "Referer": BASE + "/" },
      });
      if (!pageRes.ok) return null;

      const html = await pageRes.text();
      const m = html.match(/window\.__P\s*=\s*["']([^"']+)["']/);
      if (!m) return null;

      const bin = base64Decode(m[1]);
      let out = "";
      for (let i = 0; i < bin.length; i++) {
        out += String.fromCharCode(bin.charCodeAt(i) ^ ZOKO_KEY.charCodeAt(i % ZOKO_KEY.length));
      }

      const payload = JSON.parse(decodeUtf8(out));
      if (!payload || !payload.src) return null;

      const urlParts = parseUrlParts(embedUrl);
      const isHls = /\.m3u8(\?|$)/i.test(payload.src);

      const subtitles = [];
      if (Array.isArray(payload.subtitles)) {
        for (const s of payload.subtitles) {
          if (s && s.src) {
            subtitles.push({
              url: s.src,
              label: s.label || s.lang || "English",
              srclang: (s.lang || s.label || "en").toLowerCase().slice(0, 2),
              default: Boolean(s.default),
            });
          }
        }
      }

      const intro = (payload.skip && typeof payload.skip.intro_start === "number")
        ? { start: payload.skip.intro_start, end: payload.skip.intro_end || 0 }
        : null;
      const outro = (payload.skip && typeof payload.skip.outro_start === "number")
        ? { start: payload.skip.outro_start, end: payload.skip.outro_end || 0 }
        : null;

      return {
        stream: {
          url: payload.src,
          type: isHls ? "hls" : "mp4",
          server: "ZokoAnime",
          headers: { "Referer": urlParts.origin + "/" },
          subtitles: subtitles.length ? subtitles : undefined,
        },
        intro: intro,
        outro: outro,
      };
    } catch (e) {
      console.warn("ZokoAnime extraction error:", (e && e.message) || e);
      return null;
    }
  }

  // 2. MegaPlay Extractor (Decryption via native Aniways crypto bridge)
  async function extractMegaPlay(embedUrl, audio) {
    try {
      const urlParts = parseUrlParts(embedUrl);
      const origin = urlParts.origin;
      const fileId = urlParts.pathname.split("/").filter(Boolean).pop();
      if (!fileId) return null;

      let encKey = "e1c2d3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2";
      let encIv = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
      let tokenSecret = "megaplay_secret_default";

      // Probe page for custom dynamic keys if present
      try {
        const pageRes = await fetch(embedUrl, {
          headers: { "Referer": BASE + "/" },
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const mKey = html.match(/var\s+(?:_k|_key|key)\s*=\s*['"]([a-f0-9]{64})['"]/i);
          if (mKey) encKey = mKey[1];
          const mIv = html.match(/var\s+(?:_iv|iv)\s*=\s*['"]([a-f0-9]{32})['"]/i);
          if (mIv) encIv = mIv[1];
          const mSec = html.match(/var\s+(?:_s|_sec|secret)\s*=\s*['"]([^'"]+)['"]/i);
          if (mSec) tokenSecret = mSec[1];
        }
      } catch (_) {}

      let data = null;
      for (const path of ["stream/getSourcesNew", "stream/getSources"]) {
        try {
          const sRes = await fetch(origin + "/" + path + "?id=" + encodeURIComponent(fileId), {
            headers: {
              "Referer": embedUrl,
              "X-Requested-With": "XMLHttpRequest",
            },
          });
          if (sRes.ok) {
            const json = await sRes.json();
            if (json && (json.enc || json.sources)) {
              data = json;
              break;
            }
          }
        } catch (_) {}
      }

      if (!data) return null;

      let masterUrl = null;

      // Handle encrypted source
      if (data.enc && typeof aniways !== "undefined" && aniways.crypto) {
        const encB64 = base64urlToBase64(data.enc);
        const decryptedStr = await aniways.crypto.aesDecryptCbc(encB64, encKey, encIv);
        if (decryptedStr) {
          const decryptedObj = JSON.parse(decryptedStr);
          masterUrl = decryptedObj.file || decryptedObj.url ||
            (Array.isArray(decryptedObj.sources) ? decryptedObj.sources[0]?.file : decryptedObj.sources?.file);
        }
      } else if (Array.isArray(data.sources) && data.sources.length > 0) {
        masterUrl = data.sources[0].file || data.sources[0].url;
      }

      if (!masterUrl) return null;

      // HMAC signing if needed
      if (masterUrl && typeof aniways !== "undefined" && aniways.crypto) {
        const pathMatch = String(masterUrl).match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
        if (pathMatch) {
          const pathKey = (pathMatch[1] + "/" + pathMatch[2]).toLowerCase();
          const expires = Math.floor(Date.now() / 1000) + 90;
          const payload = expires + "|" + pathKey;
          const signature = await aniways.crypto.hmacSha256(payload, tokenSecret, "base64url");
          const encodedPayload = await aniways.crypto.base64UrlEncode(payload);
          const token = encodedPayload + "." + signature;
          const sep = masterUrl.includes("?") ? "&" : "?";
          masterUrl = masterUrl + sep + "token=" + encodeURIComponent(token) + "&t=" + (audio || "sub");
        }
      }

      const subtitles = [];
      if (Array.isArray(data.tracks)) {
        for (const t of data.tracks) {
          if (t.file && t.kind !== "thumbnails") {
            subtitles.push({
              url: t.file,
              label: t.label || "English",
              srclang: (t.label || "en").toLowerCase().slice(0, 2),
              default: Boolean(t.default),
              headers: { "Referer": origin + "/" },
            });
          }
        }
      }

      return {
        stream: {
          url: masterUrl,
          type: "hls",
          server: "MegaPlay",
          headers: { "Referer": origin + "/" },
          subtitles: subtitles.length ? subtitles : undefined,
        },
        intro: (data.intro && data.intro.start) ? { start: data.intro.start, end: data.intro.end || 0 } : null,
        outro: (data.outro && data.outro.start) ? { start: data.outro.start, end: data.outro.end || 0 } : null,
      };
    } catch (e) {
      console.warn("MegaPlay extraction error:", (e && e.message) || e);
      return null;
    }
  }

  // 3. MegaCloud Extractor (Direct HLS & soft subtitles via getSources endpoint)
  async function extractMegaCloud(embedUrl) {
    try {
      const urlParts = parseUrlParts(embedUrl);
      const origin = urlParts.origin;
      const idMatch = urlParts.pathname.match(/\/e-1\/([a-zA-Z0-9_-]+)/);
      const id = idMatch ? idMatch[1] : (embedUrl.split("id=")[1] || "").split("&")[0];
      if (!id) return null;

      const getSourcesUrl = origin + urlParts.pathname.replace(/\/e-1\/[a-zA-Z0-9_-]+.*$/, "/ajax/e-1/getSources") + "?id=" + encodeURIComponent(id);

      const res = await fetch(getSourcesUrl, {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Referer": embedUrl,
          "User-Agent": HEADERS["User-Agent"],
        },
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.sources)) return null;

      const subtitles = [];
      if (Array.isArray(data.tracks)) {
        for (const t of data.tracks) {
          if (t.file && t.kind !== "thumbnails") {
            const label = cleanTitle(t.label) || "English";
            subtitles.push({
              url: t.file,
              label: label,
              srclang: label.toLowerCase().slice(0, 2),
              default: Boolean(t.default),
              headers: { "Referer": origin + "/" },
            });
          }
        }
      }

      const streams = [];
      for (const s of data.sources) {
        if (s && s.file) {
          streams.push({
            url: s.file,
            type: s.file.includes(".m3u8") ? "hls" : "mp4",
            server: "MegaCloud",
            headers: { "Referer": origin + "/" },
            subtitles: subtitles.length ? subtitles : undefined,
          });
        }
      }

      const intro = (data.intro && typeof data.intro.start === "number")
        ? { start: data.intro.start, end: data.intro.end || 0 }
        : null;
      const outro = (data.outro && typeof data.outro.start === "number")
        ? { start: data.outro.start, end: data.outro.end || 0 }
        : null;

      return {
        streams: streams,
        intro: intro,
        outro: outro,
      };
    } catch (e) {
      console.warn("MegaCloud extraction error:", (e && e.message) || e);
      return null;
    }
  }

  // 4. StreamTape Extractor (Direct MP4 URL extraction)
  async function extractStreamTape(embedUrl) {
    try {
      const urlParts = parseUrlParts(embedUrl);
      const res = await fetch(embedUrl, {
        headers: { "Referer": BASE + "/" },
      });
      if (!res.ok) return null;

      const html = await res.text();
      const m = html.match(/document\.getElementById\(['"](?:ideoooolink|robotlink|norobotlink)['"]\)\.innerHTML\s*=\s*([^;]+);/i);
      if (!m) return null;

      let directUrl = null;
      try {
        const expr = m[1].trim();
        const evaluated = Function("return (" + expr + ")")();
        if (typeof evaluated === "string" && evaluated) {
          directUrl = evaluated.startsWith("//") ? ("https:" + evaluated) : evaluated;
        }
      } catch (_) {}

      if (!directUrl) return null;

      return {
        url: directUrl,
        type: "mp4",
        quality: "HD",
        server: "StreamTape",
        headers: { "Referer": urlParts.origin + "/" },
      };
    } catch (e) {
      console.warn("StreamTape extraction error:", (e && e.message) || e);
      return null;
    }
  }

  /* ── Extension Definition ─────────────────────────────────────────── */

  const HiAnimeExtension = {
    id: "hianime",
    name: "HiAnime",
    version: "1.0.0",
    versionCode: 1,
    author: "Aniways Community",
    audio: ["sub", "dub"],
    baseUrl: BASE,
    description: "Stream sub and dub anime with direct MegaCloud, MegaPlay, ZokoAnime HLS streams and soft subtitles from HiAnime.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles && meta.titles.english,
        meta.titles && meta.titles.romaji,
        ...((meta.titles && meta.titles.synonyms) || []),
      ].filter(Boolean);

      let bestAnime = null;
      let highestScore = -1;

      // 1. Search candidate anime across title variants
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const results = await apiRequest("/search", "POST", { title: query });
          if (!Array.isArray(results) || results.length === 0) continue;

          for (const item of results) {
            const score = scoreCandidate(item, meta);
            if (score > highestScore) {
              highestScore = score;
              bestAnime = item;
              if (score >= 10000) break; // Exact MAL ID match
            }
          }

          if (highestScore >= 10000) break;
        } catch (err) {
          console.warn("HiAnime search error for query '" + query + "':", (err && err.message) || err);
        }
      }

      if (!bestAnime) {
        throw new Error("HiAnime: No confident match found for " + (meta.titles && (meta.titles.english || meta.titles.romaji)));
      }

      const showId = extractShowId(bestAnime);
      const totalEpisodes = Number(bestAnime.totalEpisodes) || Number(meta.episodesCount) || 0;
      let episodes = [];

      // 2. Fetch full episode list
      if (showId) {
        try {
          const epData = await apiRequest(
            "/episodes/" + showId + "?start=1&end=" + Math.max(totalEpisodes, 100),
            "GET"
          );

          if (epData && Array.isArray(epData.episodes) && epData.episodes.length > 0) {
            episodes = epData.episodes.map(function(ep) {
              const epNum = Number(ep.episodeNumber) || 1;
              const refData = {
                showId: showId,
                malId: bestAnime.mal_id || meta.malId,
                epId: ep._id,
                epNumber: epNum,
                epSlug: ep.slug || (Array.isArray(ep.slugs) ? ep.slugs[0] : null),
                subLinks: (ep.link && ep.link.sub) || [],
                dubLinks: (ep.link && ep.link.dub) || [],
              };

              return {
                number: epNum,
                title: ep.title || ("Episode " + epNum),
                ref: JSON.stringify(refData),
                sub: Boolean(ep.link && ep.link.sub && ep.link.sub.length > 0),
                dub: Boolean(ep.link && ep.link.dub && ep.link.dub.length > 0),
              };
            });
          }
        } catch (epErr) {
          console.warn("HiAnime episode list fetch error:", (epErr && epErr.message) || epErr);
        }
      }

      // 3. Fallback: Synthesize episodes if API returned no list but count > 0
      if (episodes.length === 0 && totalEpisodes > 0) {
        const slugs = bestAnime.slugs || [];
        for (let i = 1; i <= totalEpisodes; i++) {
          const refData = {
            showId: showId,
            malId: bestAnime.mal_id || meta.malId,
            epNumber: i,
            epSlug: slugs[i - 1] || null,
          };
          episodes.push({
            number: i,
            title: "Episode " + i,
            ref: JSON.stringify(refData),
            sub: true,
            dub: Boolean(bestAnime.totalDubbed && bestAnime.totalDubbed > 0),
          });
        }
      }

      if (episodes.length === 0) {
        throw new Error("HiAnime: Show found but no episodes listed.");
      }

      return episodes;
    },

    async getStreams(refStr, audio) {
      let ref;
      try {
        ref = JSON.parse(refStr);
      } catch (_) {
        ref = { epNumber: Number(refStr) || 1 };
      }

      let links = (audio === "dub" ? ref.dubLinks : ref.subLinks) || [];

      // 1. If links missing, fetch from episodes endpoint
      if (links.length === 0 && ref.showId) {
        try {
          const epData = await apiRequest(
            "/episodes/" + ref.showId + "?start=" + ref.epNumber + "&end=" + ref.epNumber,
            "GET"
          );
          if (epData && Array.isArray(epData.episodes)) {
            const matched = epData.episodes.find(function(e) {
              return Number(e.episodeNumber) === ref.epNumber;
            });
            if (matched && matched.link) {
              links = (audio === "dub" ? matched.link.dub : matched.link.sub) || [];
            }
          }
        } catch (_) {}
      }

      // 2. If still missing and slug available, fetch from /episode/:slug
      if (links.length === 0 && ref.epSlug) {
        try {
          const epDetail = await apiRequest("/episode/" + encodeURIComponent(ref.epSlug), "GET");
          if (epDetail && epDetail.episode && epDetail.episode.link) {
            links = (audio === "dub" ? epDetail.episode.link.dub : epDetail.episode.link.sub) || [];
          }
        } catch (_) {}
      }

      // 3. Fallback: Synthesize standard ZokoAnime stream link from MAL ID
      if (links.length === 0 && ref.malId) {
        links.push("https://zokoanime.video/stream/mal/" + ref.malId + "/" + ref.epNumber + "/" + audio);
      }

      if (links.length === 0) {
        throw new Error("HiAnime: No " + audio + " stream links available for episode " + ref.epNumber);
      }

      const directStreams = [];
      const fallbackStreams = [];
      let detectedIntro = null;
      let detectedOutro = null;

      // Extract each server
      for (const linkUrl of links) {
        try {
          // A. ZokoAnime
          if (/zokoanime\.[^/]+\/stream\//i.test(linkUrl)) {
            const zoko = await extractZokoAnime(linkUrl);
            if (zoko && zoko.stream) {
              directStreams.push(zoko.stream);
              if (!detectedIntro && zoko.intro) detectedIntro = zoko.intro;
              if (!detectedOutro && zoko.outro) detectedOutro = zoko.outro;
            }
            fallbackStreams.push({
              url: linkUrl,
              type: "embed",
              server: "ZokoAnime (Embed)",
            });
            continue;
          }

          // B. MegaPlay
          if (/megaplay\.[^/]+\/stream\//i.test(linkUrl)) {
            const mega = await extractMegaPlay(linkUrl, audio);
            if (mega && mega.stream) {
              directStreams.push(mega.stream);
              if (!detectedIntro && mega.intro) detectedIntro = mega.intro;
              if (!detectedOutro && mega.outro) detectedOutro = mega.outro;
            }
            fallbackStreams.push({
              url: linkUrl,
              type: "embed",
              server: "MegaPlay (Embed)",
            });
            continue;
          }

          // C. MegaCloud / RapidCloud / VidCloud
          if (/(?:megacloud|rapid-cloud|vidcloud)\.[^/]+\/embed-2\//i.test(linkUrl)) {
            const cloud = await extractMegaCloud(linkUrl);
            if (cloud && Array.isArray(cloud.streams) && cloud.streams.length > 0) {
              for (const s of cloud.streams) {
                directStreams.push(s);
              }
              if (!detectedIntro && cloud.intro) detectedIntro = cloud.intro;
              if (!detectedOutro && cloud.outro) detectedOutro = cloud.outro;
            }
            fallbackStreams.push({
              url: linkUrl,
              type: "embed",
              server: "MegaCloud (Embed)",
            });
            continue;
          }

          // D. StreamTape
          if (/streamtape\.(?:com|to|net|pe|xyz)\/(?:e|v)\//i.test(linkUrl)) {
            const tape = await extractStreamTape(linkUrl);
            if (tape && tape.url) {
              directStreams.push(tape);
            }
            fallbackStreams.push({
              url: linkUrl,
              type: "embed",
              server: "StreamTape (Embed)",
            });
            continue;
          }

          // E. Direct HLS
          if (linkUrl.includes(".m3u8")) {
            directStreams.push({
              url: linkUrl,
              type: "hls",
              server: "HiAnime (Direct HLS)",
              headers: { "Referer": BASE + "/" },
            });
            continue;
          }

          // F. Generic Embed Fallback
          fallbackStreams.push({
            url: linkUrl,
            type: "embed",
            server: "HiAnime (Embed)",
          });
        } catch (serverErr) {
          console.warn("HiAnime link extraction failed for " + linkUrl + ":", (serverErr && serverErr.message) || serverErr);
        }
      }

      const allStreams = directStreams.concat(fallbackStreams);
      if (allStreams.length === 0) {
        throw new Error("HiAnime: Failed to extract playable streams for episode " + ref.epNumber);
      }

      // Deduplicate streams by URL
      const seen = new Set();
      const uniqueStreams = [];
      for (const s of allStreams) {
        if (!seen.has(s.url)) {
          seen.add(s.url);
          uniqueStreams.push(s);
        }
      }

      // Prioritize HLS (0) -> MP4 (1) -> Embed (2)
      uniqueStreams.sort(function(a, b) {
        const aScore = a.type === "hls" ? 0 : (a.type === "mp4" ? 1 : 2);
        const bScore = b.type === "hls" ? 0 : (b.type === "mp4" ? 1 : 2);
        return aScore - bScore;
      });

      return {
        streams: uniqueStreams,
        intro: detectedIntro,
        outro: detectedOutro,
      };
    },
  };

  (globalThis.registerExtension || registerExtension)(HiAnimeExtension);
})();

