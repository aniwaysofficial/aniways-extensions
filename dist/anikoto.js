/**
 * Anikoto Extension for Aniways
 * Native direct HLS extraction with MegaPlay support and candidate scoring.
 * Pure JavaScript using native Aniways crypto bridges.
 */
(function() {
  const ANIKOTO = "https://anikototv.bz";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": ANIKOTO + "/",
  };

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

  function scoreCandidate(cand, primaryEn, primaryRom, synonyms) {
    let score = 0;
    const synList = synonyms || [];
    const candNameNorm = normalize(cand.name);
    const candJpNorm = normalize(cand.jp);
    const candSlugNorm = normalize(cand.slug);

    const normEn = normalize(primaryEn || "");
    const normRom = normalize(primaryRom || "");

    if (normEn && candNameNorm === normEn) score += 1000;
    if (normRom && candNameNorm === normRom) score += 900;
    if (normRom && candJpNorm === normRom) score += 800;

    const targetText = ((primaryEn || "") + " " + (primaryRom || "") + " " + synList.join(" ")).toLowerCase();

    const modifiers = [
      "season 2",
      "season 3",
      "season 4",
      "season 5",
      "2nd season",
      "3rd season",
      "4th season",
      "5th season",
      "movie",
      "ova",
      "special",
      "specials",
    ];

    for (const mod of modifiers) {
      const modNorm = normalize(mod);
      const candHasMod = candNameNorm.includes(modNorm) || candSlugNorm.includes(modNorm);
      const targetHasMod = targetText.includes(mod);
      if (candHasMod && targetHasMod) score += 500;
      if (candHasMod && !targetHasMod) score -= 400;
      if (!candHasMod && targetHasMod) score -= 400;
    }

    const allTitles = [primaryEn, primaryRom].concat(synList);
    for (const t of allTitles) {
      const normT = normalize(t || "");
      if (!normT || normT.length < 3) continue;
      if (candNameNorm.includes(normT) || normT.includes(candNameNorm)) score += 60;
      if (candJpNorm && candJpNorm.includes(normT)) score += 60;
    }

    return score;
  }

  /* ── MegaPlay Direct HLS Extractor (Native Aniways Crypto) ────────── */

  async function extractMegaPlay(embedUrl, audio) {
    const originMatch = embedUrl.match(/^(https?:\/\/[^/]+)/);
    const origin = originMatch ? originMatch[1] : "https://megaplay.buzz";

    const pageRes = await fetch(embedUrl, {
      headers: { Referer: "https://hianimes.re/" },
    });
    const pageHtml = await pageRes.text();
    const fileId = (pageHtml.match(/data-id=["']([^"']+)["']/i) || [])[1];
    if (!fileId) throw new Error("MegaPlay fileId not found");

    const scriptUrls = [];
    const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
    let sm;
    while ((sm = scriptRegex.exec(pageHtml)) !== null) {
      const sUrl = sm[1].startsWith("http") ? sm[1] : origin + (sm[1].startsWith("/") ? "" : "/") + sm[1];
      scriptUrls.push(sUrl);
    }

    let encKey = "i?LMTAx0Q6,:}50U";
    let encIv = "W0;27ToaUpl_P%'c";
    let tokenSecret = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";

    for (const u of scriptUrls) {
      if (u.includes("e1-player") || u.includes("newclient") || u.includes("app.main")) {
        try {
          const res = await fetch(u, { headers: { Referer: embedUrl } });
          const s = await res.text();
          const mKey = s.match(/SOURCE_ENC_KEY\s*=\s*"([^"]+)"|SOURCE_ENC_KEY\s*=\s*'([^']+)'/);
          if (mKey) encKey = mKey[1] || mKey[2];
          const mIv = s.match(/SOURCE_ENC_IV\s*=\s*"([^"]+)"|SOURCE_ENC_IV\s*=\s*'([^']+)'/);
          if (mIv) encIv = mIv[1] || mIv[2];
          const mSec = s.match(/CDN_TOKEN_SECRET\s*=\s*"([^"]+)"|CDN_TOKEN_SECRET\s*=\s*'([^']+)'/);
          if (mSec) tokenSecret = mSec[1] || mSec[2];
        } catch (_) {}
      }
    }

    let data = null;
    for (const path of ["stream/getSourcesNew", "stream/getSources"]) {
      try {
        const sRes = await fetch(origin + "/" + path + "?id=" + fileId + "&id=" + fileId, {
          headers: {
            Referer: embedUrl,
            "X-Requested-With": "XMLHttpRequest",
          },
        });
        const json = await sRes.json();
        if (json && (json.enc || json.sources)) {
          data = json;
          break;
        }
      } catch (_) {}
    }

    if (!data || !data.enc) {
      throw new Error("MegaPlay returned no source data");
    }

    // 1. Decrypt AES-256-CBC using Aniways native Crypto bridge
    const encB64 = base64urlToBase64(data.enc);
    const decryptedStr = await aniways.crypto.aesDecryptCbc(encB64, encKey, encIv);
    if (!decryptedStr) {
      throw new Error("MegaPlay native AES-CBC decryption returned empty");
    }

    const decryptedObj = JSON.parse(decryptedStr);
    let masterUrl = decryptedObj?.file || decryptedObj?.url ||
      (Array.isArray(decryptedObj?.sources) ? decryptedObj.sources[0]?.file : decryptedObj?.sources?.file);

    // 2. Token signing using native HMAC-SHA256 and Base64Url
    if (masterUrl) {
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
            headers: { Referer: origin + "/" },
          });
        }
      }
    }

    return {
      masterUrl: masterUrl,
      subtitles: subtitles,
      intro: data.intro ? { start: data.intro.start || 0, end: data.intro.end || 0 } : null,
      outro: data.outro ? { start: data.outro.start || 0, end: data.outro.end || 0 } : null,
    };
  }

  /* ── Extension Definition ─────────────────────────────────────────── */

  const AnikotoExtension = {
    id: "anikoto",
    name: "Anikoto",
    version: "1.0.0",
    versionCode: 1,
    author: "Aniways Community",
    audio: ["sub", "dub"],
    baseUrl: ANIKOTO,
    description: "Fast high-quality direct HLS video streams with soft subtitles from Anikoto.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles && meta.titles.english,
        meta.titles && meta.titles.romaji,
        ...((meta.titles && meta.titles.synonyms) || []),
      ].filter(Boolean);

      let targetSlug = null;
      let candidates = [];

      // 1. Search candidate anime across title variants
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = ANIKOTO + "/filter?keyword=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const linkRegex =
            /<a\s+class="name d-title"\s+href="(?:https?:\/\/[^"/]+)?\/watch\/([^"/]+)(?:\/ep-\d+)?"[^>]*data-jp="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          while ((match = linkRegex.exec(html)) !== null) {
            const cand = {
              slug: match[1],
              jp: match[2],
              name: cleanTitle(match[3]),
              score: scoreCandidate(
                { slug: match[1], jp: match[2], name: cleanTitle(match[3]) },
                meta.titles && meta.titles.english,
                meta.titles && meta.titles.romaji,
                meta.titles && meta.titles.synonyms
              ),
            };
            candidates.push(cand);
          }

          if (candidates.length) break;
        } catch (e) {
          console.warn("Anikoto search error:", (e && e.message) || e);
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 0) {
        targetSlug = candidates[0].slug;
      }

      if (!targetSlug) {
        const fallback = (meta.titles && (meta.titles.romaji || meta.titles.english)) || "";
        targetSlug = fallback
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      }

      // 2. Fetch anime watch page to get showId
      const episodes = [];
      try {
        const watchUrl = ANIKOTO + "/watch/" + targetSlug;
        const res = await fetch(watchUrl, { headers: HEADERS });
        const html = await res.text();

        const showIdMatch = html.match(/data-id="(\d+)"/);
        const showId = showIdMatch ? showIdMatch[1] : null;

        if (showId) {
          const epListUrl = ANIKOTO + "/ajax/episode/list/" + showId;
          const listRes = await fetch(epListUrl, {
            headers: Object.assign({}, HEADERS, {
              "X-Requested-With": "XMLHttpRequest",
              Referer: watchUrl,
            }),
          });
          const listData = await listRes.json();
          const listHtml = listData && listData.result ? listData.result : "";

          const epRegex = /<a\s+[^>]*data-id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
          let epMatch;
          while ((epMatch = epRegex.exec(listHtml)) !== null) {
            const tag = epMatch[0];
            const getAttr = function(name) {
              const m = tag.match(new RegExp("data-" + name + '="([^"]*)"'));
              return m ? m[1] : "";
            };

            const num = parseInt(getAttr("num"), 10);
            if (isNaN(num)) continue;

            const titleMatch = epMatch[2]
              ? epMatch[2].match(/<span\s+class="d-title"[^>]*>([\s\S]*?)<\/span>/i)
              : null;
            const title = titleMatch ? cleanTitle(titleMatch[1]) : "Episode " + num;

            episodes.push({
              number: num,
              title: title,
              ref: getAttr("ids") || getAttr("id") || String(num),
              sub: getAttr("sub") === "1",
              dub: getAttr("dub") === "1",
            });
          }
        }
      } catch (e) {
        console.warn("Anikoto parse episodes error:", (e && e.message) || e);
      }

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const streams = [];
      let intro = null;
      let outro = null;

      try {
        const serverListUrl = ANIKOTO + "/ajax/server/list?servers=" + encodeURIComponent(episodeRef);
        const res = await fetch(serverListUrl, {
          headers: Object.assign({}, HEADERS, {
            "X-Requested-With": "XMLHttpRequest",
            Referer: ANIKOTO + "/",
          }),
        });
        const data = await res.json();
        const serverHtml = data && data.result ? data.result : "";

        const typeRegex = /<div\s+class="type"\s+data-type="([^"]+)">([\s\S]*?)<\/ul>\s*<\/div>/gi;
        let typeMatch;
        const linkIds = [];
        while ((typeMatch = typeRegex.exec(serverHtml)) !== null) {
          const typeName = typeMatch[1];
          if (typeName !== audio && !(audio === "sub" && typeName === "hsub")) {
            continue;
          }

          const liRegex = /<li\s+[^>]*data-link-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi;
          let liMatch;
          while ((liMatch = liRegex.exec(typeMatch[2])) !== null) {
            linkIds.push({
              linkId: liMatch[1],
              name: cleanTitle(liMatch[2]) || "Server",
            });
          }
        }

        for (const s of linkIds) {
          try {
            const sRes = await fetch(ANIKOTO + "/ajax/server?get=" + encodeURIComponent(s.linkId), {
              headers: Object.assign({}, HEADERS, {
                "X-Requested-With": "XMLHttpRequest",
                Referer: ANIKOTO + "/",
              }),
            });
            const sData = await sRes.json();
            const embedUrl = sData && sData.result ? sData.result.url : null;

            if (embedUrl) {
              if (sData.result.skip_data) {
                if (!intro && Array.isArray(sData.result.skip_data.intro) && sData.result.skip_data.intro.length === 2) {
                  intro = { start: sData.result.skip_data.intro[0], end: sData.result.skip_data.intro[1] };
                }
                if (!outro && Array.isArray(sData.result.skip_data.outro) && sData.result.skip_data.outro.length === 2) {
                  outro = { start: sData.result.skip_data.outro[0], end: sData.result.skip_data.outro[1] };
                }
              }

              // Extract MegaPlay direct HLS
              if (/megaplay\.[^/]+\/stream\//i.test(embedUrl)) {
                try {
                  const details = await extractMegaPlay(embedUrl, audio);
                  if (details.masterUrl) {
                    streams.push({
                      url: details.masterUrl,
                      type: "hls",
                      server: s.name,
                      headers: { Referer: "https://megaplay.buzz/" },
                      subtitles: details.subtitles,
                    });
                    if (!intro && details.intro) intro = details.intro;
                    if (!outro && details.outro) outro = details.outro;
                  }
                } catch (e) {
                  console.warn("MegaPlay extraction failed:", (e && e.message) || e);
                }
              } else if (embedUrl.includes(".m3u8")) {
                streams.push({
                  url: embedUrl,
                  type: "hls",
                  server: s.name,
                  headers: { Referer: ANIKOTO + "/" },
                });
              }
            }
          } catch (err) {
            console.warn("Server fetch error:", (err && err.message) || err);
          }
        }
      } catch (e) {
        console.warn("Anikoto getStreams error:", (e && e.message) || e);
      }

      return {
        streams: streams,
        intro: intro,
        outro: outro,
      };
    },
  };

  (globalThis.registerExtension || registerExtension)(AnikotoExtension);
})();
