/**
 * AniWaves Extension for Aniways
 * Version: 1.0.0
 * Audio: Sub & Dub
 */
(function() {
  const BASE = "https://aniwaves.ru";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
  const AJAX_HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": BASE + "/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  function cleanTitle(str) {
    return (str || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/<[^>]+>/g, "")
      .trim();
  }

  function base64urlToBase64(str) {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) {
      b64 += "=";
    }
    return b64;
  }

  function parseServers(html) {
    const typeRegex = /<div\s+[^>]*class="[^"]*type[^"]*"[^>]*data-type="([^"]*)"[^>]*>([\s\S]*?)(?=(?:<div\s+[^>]*class="[^"]*type[^"]*"|$))/gi;
    const servers = [];
    let tMatch;
    while ((tMatch = typeRegex.exec(html)) !== null) {
      const rawType = (tMatch[1] || "").toLowerCase();
      const segment = tMatch[2];
      // "sub" and "ssub" are sub, "dub" is dub
      const audioType = (rawType === "dub") ? "dub" : "sub";

      const liRegex = /<li\s+[^>]*data-link-id="([^"]*)"[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(segment)) !== null) {
        servers.push({
          audio: audioType,
          id: liMatch[1],
          name: cleanTitle(liMatch[2]) || "Server"
        });
      }
    }
    return servers;
  }

  function parseUrlParts(urlStr) {
    const origin = (urlStr || "").split("/").slice(0, 3).join("/");
    const withoutOrigin = (urlStr || "").slice(origin.length);
    const pathname = withoutOrigin.split("?")[0].split("#")[0] || "/";
    const pathParts = pathname.split("/").filter(Boolean);
    const lastId = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "";
    return {
      origin: origin,
      pathname: pathname,
      pathId: lastId
    };
  }

  async function extractGetSources(embedUrl, serverName) {
    const streams = [];
    try {
      const urlParts = parseUrlParts(embedUrl);
      let pathId = urlParts.pathId;

      // Fallback: if pathId is absent or looks invalid, attempt extracting from page
      let getSourcesUrl = urlParts.origin + urlParts.pathname.replace(/\/[^/]*\/?$/, "/getSources") + "?id=" + encodeURIComponent(pathId || "");
      let res = await fetch(getSourcesUrl, {
        headers: {
          "Referer": embedUrl,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
      });

      if (!res.ok) {
        const pageRes = await fetch(embedUrl, {
          headers: {
            "Referer": urlParts.origin + "/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
          }
        });
        const pageHtml = await pageRes.text();
        const dataIdMatch = pageHtml.match(/data-id=["']([^"']+)["']/i);
        if (dataIdMatch) {
          pathId = dataIdMatch[1];
          getSourcesUrl = urlParts.origin + urlParts.pathname.replace(/\/[^/]*\/?$/, "/getSources") + "?id=" + encodeURIComponent(pathId);
          res = await fetch(getSourcesUrl, {
            headers: {
              "Referer": embedUrl,
              "X-Requested-With": "XMLHttpRequest",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
          });
        }
      }

      if (!res.ok) return [];

      const data = await res.json();
      if (!data) return [];

      const subtitles = [];
      if (Array.isArray(data.tracks)) {
        for (const t of data.tracks) {
          if (!t || !t.file || typeof t.file !== "string" || !/^https?:\/\//i.test(t.file)) continue;
          if (t.kind === "thumbnails") continue;
          const label = (t.label || "English").trim();
          subtitles.push({
            url: t.file,
            label: label,
            srclang: label.toLowerCase().slice(0, 3),
            default: Boolean(t.default),
            headers: { "Referer": urlParts.origin + "/" }
          });
        }
      }

      const rawSources = [];
      if (typeof data.sources === "string") {
        rawSources.push({ url: data.sources, quality: "1080p" });
      } else if (Array.isArray(data.sources)) {
        for (const item of data.sources) {
          if (typeof item === "string") {
            rawSources.push({ url: item, quality: "1080p" });
          } else if (item && typeof item === "object") {
            const u = item.file || item.url;
            if (u) rawSources.push({ url: u, quality: item.quality || item.label || "1080p" });
          }
        }
      } else if (data.sources && typeof data.sources === "object") {
        for (const [qKey, val] of Object.entries(data.sources)) {
          const arr = Array.isArray(val) ? val : [val];
          for (const item of arr) {
            const u = typeof item === "string" ? item : (item && (item.file || item.url));
            if (u) rawSources.push({ url: u, quality: qKey });
          }
        }
      }

      for (const src of rawSources) {
        if (!src.url || !/^https?:\/\//i.test(src.url)) continue;
        const isHls = /\.m3u8(\?|$)/i.test(src.url);
        streams.push({
          url: src.url,
          type: isHls ? "hls" : "mp4",
          quality: src.quality || (isHls ? "1080p" : "default"),
          server: serverName + (src.quality ? " (" + src.quality + ")" : ""),
          headers: { "Referer": urlParts.origin + "/" },
          subtitles: subtitles.length ? subtitles : undefined
        });
      }
    } catch (e) {
      console.warn("extractGetSources failed:", (e && e.message) || e);
    }
    return streams;
  }

  async function extractMegaPlay(embedUrl, serverName, audio) {
    try {
      const origin = embedUrl.split("/").slice(0, 3).join("/");
      const res = await fetch(embedUrl, {
        headers: {
          "Referer": BASE + "/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
      });
      const html = await res.text();
      const idMatch = html.match(/data-id=["']([^"']+)["']/i);
      const fileId = idMatch ? idMatch[1] : (embedUrl.split("/").filter(Boolean).pop() || "");
      if (!fileId) return null;

      let encKey = null;
      let encIv = null;
      let tokenSecret = null;

      const scriptSrcMatches = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)];
      for (const sm of scriptSrcMatches) {
        const sUrl = sm[1].startsWith("http") ? sm[1] : (origin + (sm[1].startsWith("/") ? "" : "/") + sm[1]);
        try {
          const scRes = await fetch(sUrl, { headers: { "Referer": embedUrl } });
          const scText = await scRes.text();
          if (scText.includes("getSources") || scText.includes("AES-CBC")) {
            const mKey = scText.match(/(?:key|secret)\s*:\s*["']([^"']+)["']/i) || scText.match(/["']([a-f0-9]{32,64})["']/i);
            const mIv = scText.match(/iv\s*:\s*["']([^"']+)["']/i) || scText.match(/["']([a-f0-9]{16,32})["']/i);
            if (mKey) encKey = mKey[1];
            if (mIv) encIv = mIv[1];
          }
          if (scText.includes("[a-f0-9]{32}") && scText.includes("token=")) {
            const mSec = scText.match(/tokenSecret\s*=\s*["']([^"']+)["']/i) || scText.match(/["']([a-zA-Z0-9_-]{16,})["']/);
            if (mSec) tokenSecret = mSec[1] || mSec[2];
          }
        } catch (_) {}
      }

      let data = null;
      for (const path of ["stream/getSourcesNew", "stream/getSources"]) {
        try {
          const sRes = await fetch(origin + "/" + path + "?id=" + fileId + "&id=" + fileId, {
            headers: {
              "Referer": embedUrl,
              "X-Requested-With": "XMLHttpRequest",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
          });
          const json = await sRes.json();
          if (json && (json.enc || json.sources)) {
            data = json;
            break;
          }
        } catch (_) {}
      }

      if (!data) return null;

      let masterUrl = null;
      const crypto = (typeof aniways !== "undefined" && aniways.crypto);
      if (data.enc && crypto && crypto.aesDecryptCbc && encKey && encIv) {
        const encB64 = base64urlToBase64(data.enc);
        const decryptedStr = await crypto.aesDecryptCbc(encB64, encKey, encIv);
        if (decryptedStr) {
          const decryptedObj = JSON.parse(decryptedStr);
          masterUrl = decryptedObj?.file || decryptedObj?.url ||
            (Array.isArray(decryptedObj?.sources) ? decryptedObj.sources[0]?.file : decryptedObj?.sources?.file);
        }
      } else if (data.sources) {
        masterUrl = typeof data.sources === "string" ? data.sources :
          (Array.isArray(data.sources) ? (data.sources[0]?.file || data.sources[0]) : (data.sources?.file || data.sources?.url));
      }

      if (masterUrl && tokenSecret && crypto && crypto.hmacSha256) {
        const pathMatch = String(masterUrl).match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
        if (pathMatch) {
          const pathKey = (pathMatch[1] + "/" + pathMatch[2]).toLowerCase();
          const expires = Math.floor(Date.now() / 1000) + 90;
          const payload = expires + "|" + pathKey;
          const signature = await crypto.hmacSha256(payload, tokenSecret, "base64url");
          const encodedPayload = await crypto.base64UrlEncode(payload);
          const token = encodedPayload + "." + signature;
          const sep = masterUrl.includes("?") ? "&" : "?";
          masterUrl = masterUrl + sep + "token=" + encodeURIComponent(token) + "&t=" + (audio || "sub");
        }
      }

      if (!masterUrl) return null;

      const subtitles = [];
      if (Array.isArray(data.tracks)) {
        for (const t of data.tracks) {
          if (t.file && t.kind !== "thumbnails") {
            subtitles.push({
              url: t.file,
              label: t.label || "English",
              srclang: (t.label || "en").toLowerCase().slice(0, 3),
              default: Boolean(t.default),
              headers: { "Referer": origin + "/" }
            });
          }
        }
      }

      return {
        stream: {
          url: masterUrl,
          type: "hls",
          server: serverName + " (MegaPlay)",
          headers: { "Referer": origin + "/" },
          subtitles: subtitles.length ? subtitles : undefined
        },
        intro: data.intro ? { start: data.intro.start || 0, end: data.intro.end || 0 } : null,
        outro: data.outro ? { start: data.outro.start || 0, end: data.outro.end || 0 } : null
      };
    } catch (e) {
      console.warn("MegaPlay extraction failed:", (e && e.message) || e);
      return null;
    }
  }

  const AniwavesExtension = {
    id: "aniwaves",
    name: "AniWaves",
    version: "1.0.0",
    versionCode: 1,
    author: "Aniways Community",
    audio: ["sub", "dub"],
    baseUrl: BASE,
    description: "Stream anime from AniWaves with direct multi-server HLS/MP4 streams and soft subs.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles.english,
        meta.titles.romaji,
        ...(meta.titles.synonyms || [])
      ].filter(Boolean);

      let targetSlug = null;
      let siteId = null;

      // 1. Search candidate across title variants
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = BASE + "/filter?keyword=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const linkRegex = /<a\s+[^>]*class="[^"]*name\s+d-title[^"]*"[^>]*href="\/watch\/([a-z0-9-]+)"/gi;
          let match;
          while ((match = linkRegex.exec(html)) !== null) {
            targetSlug = match[1];
            const idMatch = targetSlug.match(/-(\d+)$/);
            if (idMatch) {
              siteId = idMatch[1];
              break;
            }
          }

          if (targetSlug && siteId) break;
        } catch (e) {
          console.warn("AniWaves search error:", (e && e.message) || e);
        }
      }

      if (!siteId) return [];

      // 2. Fetch episode list via AJAX
      const episodes = [];
      try {
        const epListUrl = BASE + "/ajax/episode/list/" + siteId + "?vrf=";
        const res = await fetch(epListUrl, {
          headers: Object.assign({}, AJAX_HEADERS, { "Referer": BASE + "/watch/" + targetSlug })
        });
        const data = await res.json();
        const html = data && data.result ? data.result : "";

        const aRegex = /<a\s+[^>]*data-ids="([^"]*)"[^>]*data-num="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let epMatch;
        while ((epMatch = aRegex.exec(html)) !== null) {
          const tag = epMatch[0];
          const num = parseInt(epMatch[2], 10);
          if (isNaN(num)) continue;

          const slugMatch = tag.match(/data-slug="([^"]*)"/);
          const epSlug = slugMatch ? slugMatch[1] : String(num);
          const title = cleanTitle(epMatch[3]).replace(/^\d+\s*/, "") || "Episode " + num;

          const hasSub = tag.includes('data-sub="1"');
          const hasDub = tag.includes('data-dub="1"');

          episodes.push({
            number: num,
            title: title,
            ref: siteId + ":" + epSlug + ":" + targetSlug,
            sub: hasSub,
            dub: hasDub
          });
        }
      } catch (e) {
        console.warn("AniWaves parse episodes error:", (e && e.message) || e);
      }

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const parts = episodeRef.split(":");
      const siteId = parts[0];
      const epSlug = parts[1] || parts[0];
      const targetSlug = parts[2] || ("anime-" + siteId);

      const directStreams = [];
      const fallbackStreams = [];
      let intro = null;
      let outro = null;

      const referer = BASE + "/watch/" + targetSlug + "/ep-" + epSlug;

      try {
        const serverListUrl = BASE + "/ajax/server/list?servers=" + siteId + "&eps=" + encodeURIComponent(epSlug);
        const res = await fetch(serverListUrl, {
          headers: Object.assign({}, AJAX_HEADERS, { "Referer": referer })
        });
        const data = await res.json();
        const html = data && data.result ? data.result : "";

        // Parse servers separated by audio stream types
        const allServers = parseServers(html);
        const targetAudio = (audio || "sub").toLowerCase();
        let servers = allServers.filter(s => s.audio === targetAudio);
        if (!servers.length) servers = allServers;

        // Resolve top servers for direct media links
        for (const s of servers.slice(0, 4)) {
          try {
            const sourceUrl = BASE + "/ajax/sources?id=" + encodeURIComponent(s.id) + "&asi=0&autoPlay=0";
            const sRes = await fetch(sourceUrl, {
              headers: Object.assign({}, AJAX_HEADERS, { "Referer": referer })
            });
            const sData = await sRes.json();
            const result = sData && sData.result ? sData.result : null;
            const embedUrl = result ? result.url : null;

            if (!embedUrl) continue;

            // Extract intro/outro skip intervals
            if (result.skip_data) {
              if (!intro && Array.isArray(result.skip_data.intro)) {
                const [start, end] = result.skip_data.intro;
                if (start || end) intro = { start, end };
              }
              if (!outro && Array.isArray(result.skip_data.outro)) {
                const [start, end] = result.skip_data.outro;
                if (start || end) outro = { start, end };
              }
            }

            // 1. Check for VHSCDN / EchoVideo getSources embeds
            if (/(?:echovideo|vhscdn)\.[a-z.]+\/embed-\d+\/|\/embed-\d+\/[a-f0-9]{16,}/i.test(embedUrl)) {
              const extracted = await extractGetSources(embedUrl, s.name);
              if (extracted && extracted.length > 0) {
                for (const item of extracted) {
                  directStreams.push(item);
                }
              } else {
                fallbackStreams.push({
                  url: embedUrl,
                  type: "embed",
                  server: s.name,
                  headers: { "Referer": referer }
                });
              }
            }
            // 2. Check for MegaPlay embeds
            else if (/megaplay/i.test(embedUrl)) {
              const megaResult = await extractMegaPlay(embedUrl, s.name, targetAudio);
              if (megaResult && megaResult.stream) {
                directStreams.push(megaResult.stream);
                if (!intro && megaResult.intro) intro = megaResult.intro;
                if (!outro && megaResult.outro) outro = megaResult.outro;
              } else {
                fallbackStreams.push({
                  url: embedUrl,
                  type: "embed",
                  server: s.name,
                  headers: { "Referer": referer }
                });
              }
            }
            // 3. Direct HLS link
            else if (embedUrl.includes(".m3u8")) {
              directStreams.push({
                url: embedUrl,
                type: "hls",
                server: s.name,
                headers: { "Referer": referer }
              });
            }
            // 4. Default fallback embed
            else {
              fallbackStreams.push({
                url: embedUrl,
                type: "embed",
                server: s.name,
                headers: { "Referer": referer }
              });
            }
          } catch (serverErr) {
            console.warn("AniWaves server resolution error:", (serverErr && serverErr.message) || serverErr);
          }
        }
      } catch (e) {
        console.warn("AniWaves getStreams error:", (e && e.message) || e);
      }

      return {
        streams: [...directStreams, ...fallbackStreams],
        intro: intro,
        outro: outro
      };
    }
  };

  (globalThis.registerExtension || registerExtension)(AniwavesExtension);
})();
