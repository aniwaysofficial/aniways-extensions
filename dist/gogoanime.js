/**
 * Gogoanime Extension for Aniways
 *  * Version: 1.0.0
 * Audio: Sub & Dub
 */
(function() {
  const BASE = "https://gogoanime.or.at";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  };

  function decodeEntities(str) {
    return (str || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/<[^>]+>/g, "")
      .trim();
  }

  function titleText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  const STOP_WORDS = new Set([
    "a", "an", "and", "of", "the", "to", "in", "on", "for", "no", "wa", "season", "part", "stage", "cour",
    "chapter", "chapters", "episode", "episodes", "movie", "film", "tv", "ova", "ona", "special", "specials",
    "final", "finale", "arc",
  ]);

  const SMALL_NUMBERS = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
  };

  function titleWords(value) {
    return new Set(
      titleText(value)
        .split(/\s+/)
        .filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+(?:st|nd|rd|th)?$/.test(w))
    );
  }

  const SEASONISH = ["season", "part", "stage", "cour"];

  function markerValues(value) {
    const normalized = titleText(value);
    const text = normalized.replace(/\s+/g, "");
    const markers = new Map();
    const words = {
      ...Object.fromEntries(Object.entries(SMALL_NUMBERS).map(([k, v]) => [k, String(v)])),
      first: "1", second: "2", third: "3", fourth: "4", fifth: "5"
    };

    for (const marker of SEASONISH) {
      const values = new Set();
      for (const m of text.matchAll(new RegExp(`${marker}(\\d+)`, "g"))) values.add(m[1]);
      for (const m of text.matchAll(new RegExp(`(\\d+)(?:st|nd|rd|th)${marker}`, "g"))) values.add(m[1]);
      for (const [word, number] of Object.entries(words)) {
        if (text.includes(`${marker}${word}`) || text.includes(`${word}${marker}`)) values.add(number);
      }
      if (values.size) markers.set(marker, values);
    }

    const finals = new Set();
    for (const m of text.matchAll(/final(season|chapters?|part|arc)/g)) {
      finals.add(m[1].startsWith("chapter") ? "chapters" : m[1]);
    }
    if (finals.size) markers.set("final", finals);

    if (/movie|film|gekijouban/.test(text)) markers.set("format", new Set(["movie"]));
    const typeMarker = normalized.match(/\b(ova|ona|special)\b/)?.[1];
    if (typeMarker) markers.set("format", new Set([typeMarker]));

    const endingParts = normalized.split(/\s+/);
    const ending = (endingParts.length > 0 ? endingParts[endingParts.length - 1] : "") || "";
    const number = ending.match(/^(\d{1,2})(?:st|nd|rd|th)?$/)?.[1] ?? text.match(/([a-z])(\d{1,2})$/)?.[2];
    const roman = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" }[ending];
    const endingValue = number || roman;
    const alreadyMarked = endingValue && SEASONISH.some((m) => markers.get(m)?.has(endingValue));
    if (endingValue && !alreadyMarked) markers.set("numbered", new Set([endingValue]));

    return markers;
  }

  function dice(a, b) {
    const left = titleText(a).replace(/\s+/g, "");
    const right = titleText(b).replace(/\s+/g, "");
    if (left === right) return 1;
    if (left.length < 2 || right.length < 2) return 0;
    const grams = new Map();
    for (let i = 0; i < left.length - 1; i++) {
      const g = left.slice(i, i + 2);
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
    let hits = 0;
    for (let i = 0; i < right.length - 1; i++) {
      const g = right.slice(i, i + 2);
      const n = grams.get(g) ?? 0;
      if (n) { hits++; grams.set(g, n - 1); }
    }
    return (2 * hits) / (left.length + right.length - 2);
  }

  function titleIdentityScore(titles, candidates) {
    const targets = titles.filter(Boolean);
    const cands = candidates.filter(Boolean);
    const targetMarkers = new Map();
    for (const title of targets.slice(0, 3)) {
      for (const [marker, values] of markerValues(title)) {
        if (!targetMarkers.has(marker)) targetMarkers.set(marker, new Set());
        for (const v of values) targetMarkers.get(marker).add(v);
      }
    }

    let best = 0;
    for (const title of targets) {
      const queryWords = titleWords(title);
      for (const candidate of cands) {
        const candidateWords = titleWords(candidate);
        const lexical = dice([...queryWords].join(" ") || title, [...candidateWords].join(" ") || candidate);
        if ((!queryWords.size || !candidateWords.size) && lexical < 0.86) continue;

        const candidateMarkers = markerValues(candidate);
        let conflict = false;
        let penalty = 0;
        for (const [marker, queryValues] of targetMarkers) {
          const values = candidateMarkers.get(marker);
          if (values && ![...queryValues].some((v) => values.has(v))) {
            conflict = true;
            break;
          }
          if (!values && !(marker === "season" && candidateMarkers.has("final"))) penalty += SEASONISH.includes(marker) ? 0.22 : 0.16;
        }
        if (conflict) continue;
        for (const marker of candidateMarkers.keys()) {
          if (!targetMarkers.has(marker)) penalty += SEASONISH.includes(marker) ? 0.18 : 0.12;
        }
        penalty = Math.min(0.48, penalty);

        let shared = 0;
        for (const w of queryWords) if (candidateWords.has(w)) shared++;
        const coverage = queryWords.size && candidateWords.size ? Math.min(shared / queryWords.size, shared / candidateWords.size) : lexical;
        if (Math.min(queryWords.size, candidateWords.size) < 3) {
          if (lexical < 0.76) continue;
        } else if (coverage < 0.5) continue;

        best = Math.max(best, Math.max(0, lexical * 0.7 + coverage * 0.3 - penalty));
      }
    }
    return best;
  }

  function scoreCandidate(cand, meta, titles, expected) {
    const titleScore = titleIdentityScore(titles, cand.titles);
    const kind = String(meta.format || "").toLowerCase();
    const year = meta.year;

    if (titleScore < 0.60) return null;
    if (year && cand.year && Math.abs(year - cand.year) > 1) return null;

    let cov = 0.5;
    if (expected && expected > 0 && cand.episodeCount > 0) {
      cov = Math.min(1, cand.episodeCount / expected);
      if (expected >= 6 && cov < 0.7) return null;
    }

    const score =
      titleScore * 0.70 +
      (year && cand.year === year ? 0.18 : 0.05) +
      cov * 0.12;

    return {
      candidate: cand,
      titleScore: titleScore,
      score: score,
      exactCount: Boolean(expected && cand.episodeCount === expected)
    };
  }

  function pickBest(scored) {
    const sorted = [...scored].sort((a, b) => b.score - a.score || Number(b.exactCount) - Number(a.exactCount));
    return sorted.length > 0 ? sorted[0] : null;
  }

  async function fetchAnimePage(slug) {
    try {
      const url = `${BASE}/anime/${slug}/`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) return null;
      const html = await res.text();

      const alterMatch = html.match(/<span class="alter">([\s\S]*?)<\/span>/i);
      const alterText = alterMatch ? decodeEntities(alterMatch[1].replace(/<[^>]+>/g, "").trim()) : "";
      const alternateTitles = alterText ? alterText.split(/[,;/]/).map((t) => t.trim()).filter(Boolean) : [];

      const yearMatch = html.match(/<b>Released:<\/b>\s*(\d{4})/i);
      const year = yearMatch ? Number(yearMatch[1]) : null;

      const episodes = [];
      const lis = [...html.matchAll(/<li[^>]*data-index="[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];
      for (const li of lis) {
        const text = li[1];
        const linkMatch = text.match(/<a\s+href="([^"]+)"/i);
        const numMatch = text.match(/<div class="epl-num">([^<]+)<\/div>/i);
        if (!linkMatch || !numMatch) continue;
        const url = linkMatch[1];
        const num = Number(numMatch[1].trim());
        if (!Number.isFinite(num) || num < 1) continue;

        const titleMatch = text.match(/<div class="epl-title">([\s\S]*?)<\/div>/i);
        const epTitle = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, "").trim()) : `Episode ${num}`;
        const dateMatch = text.match(/<div class="epl-date">([^<]+)<\/div>/i);
        const date = dateMatch ? dateMatch[1].trim() : null;

        episodes.push({ number: num, url: url, title: epTitle, date: date });
      }
      episodes.sort((a, b) => a.number - b.number);
      return { alternateTitles: alternateTitles, year: year, episodes: episodes };
    } catch (_) {
      return null;
    }
  }

  function base64urlToBase64(str) {
    let b64 = (str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return b64;
  }

  /* ── MegaPlay Direct HLS Extractor ─────────────────────────────────── */
  async function extractMegaPlay(embedUrl, audio) {
    const originMatch = embedUrl.match(/^(https?:\/\/[^/]+)/);
    const origin = originMatch ? originMatch[1] : "https://megaplay.buzz";

    const pageRes = await fetch(embedUrl, {
      headers: { Referer: "https://hianimes.re/" }
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
            "X-Requested-With": "XMLHttpRequest"
          }
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

    const encB64 = base64urlToBase64(data.enc);
    const decryptedStr = await aniways.crypto.aesDecryptCbc(encB64, encKey, encIv);
    if (!decryptedStr) {
      throw new Error("MegaPlay AES decryption returned empty");
    }

    const decryptedObj = JSON.parse(decryptedStr);
    let masterUrl = decryptedObj?.file || decryptedObj?.url ||
      (Array.isArray(decryptedObj?.sources) ? decryptedObj.sources[0]?.file : decryptedObj?.sources?.file);

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
            headers: { Referer: origin + "/" }
          });
        }
      }
    }

    return {
      masterUrl: masterUrl,
      subtitles: subtitles,
      intro: data.intro ? { start: data.intro.start || 0, end: data.intro.end || 0 } : null,
      outro: data.outro ? { start: data.outro.start || 0, end: data.outro.end || 0 } : null
    };
  }

  /* ── Gogoanime Extension Object ───────────────────────────────────── */
  const GogoanimeExtension = {
    id: "gogoanime",
    name: "Gogoanime",
    version: "1.0.0",
    versionCode: 1,
    author: "Aniways Community",
    audio: ["sub", "dub"],
    baseUrl: BASE,
    description: "Stream sub and dub anime with high availability from Gogoanime.",

    async getEpisodes(meta) {
      const englishTitle = meta.titles && meta.titles.english;
      const romajiTitle = meta.titles && meta.titles.romaji;
      const synonyms = (meta.titles && meta.titles.synonyms) || [];
      const titles = [englishTitle, romajiTitle, ...synonyms].filter(Boolean);
      const expected = meta.episodesCount || null;

      const queries = [];
      if (englishTitle) queries.push(englishTitle);
      if (romajiTitle && romajiTitle !== englishTitle) queries.push(romajiTitle);
      for (const s of synonyms.slice(0, 2)) {
        if (!queries.includes(s)) queries.push(s);
      }

      const groupMap = new Map();

      for (const q of queries.slice(0, 3)) {
        try {
          const searchUrl = `${BASE}/?s=${encodeURIComponent(q)}`;
          const res = await fetch(searchUrl, { headers: HEADERS });
          if (!res.ok) continue;
          const html = await res.text();

          const articles = [...html.matchAll(/<article\s+class="bs"[\s\S]*?<\/article>/gi)];
          for (const a of articles) {
            const content = a[0];
            const linkMatch = content.match(/<a\s+href="https:\/\/gogoanime\.or\.at\/anime\/([^"/]+)\/?"[^>]*title="([^"]*)"/i);
            if (!linkMatch) continue;
            const slug = linkMatch[1];
            const rawTitle = decodeEntities(linkMatch[2].trim());
            const isDub = /\(Dub\)$/i.test(rawTitle) || /class="sb Dub"/i.test(content) || slug.endsWith("-dub");
            const cleanT = rawTitle.replace(/\s*\((?:dub|sub)\)\s*$/i, "").trim();
            const baseSlug = slug.replace(/-(?:dub|sub)$/i, "");

            let g = groupMap.get(baseSlug);
            if (!g) {
              g = { baseSlug: baseSlug, cleanTitle: cleanT, subSlug: undefined, dubSlug: undefined };
              groupMap.set(baseSlug, g);
            }
            if (isDub) g.dubSlug = slug;
            else g.subSlug = slug;
          }

          if (groupMap.size > 0) break;
        } catch (e) {
          console.warn("Gogoanime search error:", (e && e.message) || e);
        }
      }

      if (groupMap.size === 0) {
        return [];
      }

      // Inspect candidates to fetch detail & episode count (up to 6 candidates)
      const candidatesToInspect = Array.from(groupMap.values()).slice(0, 6);
      const scoredCandidates = [];

      for (const g of candidatesToInspect) {
        const primarySlug = g.subSlug || g.dubSlug || g.baseSlug;
        const detail = await fetchAnimePage(primarySlug);
        if (!detail || !detail.episodes.length) continue;

        const cand = {
          id: g.baseSlug,
          titles: [...new Set([g.cleanTitle, ...detail.alternateTitles, g.baseSlug.replace(/-/g, " ")].filter(Boolean))],
          year: detail.year,
          episodeCount: detail.episodes.length,
          group: g,
          detail: detail,
        };

        const sc = scoreCandidate(cand, meta, titles, expected);
        if (sc) {
          scoredCandidates.push(sc);
        }
      }

      const best = pickBest(scoredCandidates);
      if (!best) {
        return [];
      }

      const chosenGroup = best.candidate.group;
      let subEpisodes = [];
      let dubEpisodes = [];

      // Fetch sub & dub strictly for the chosenGroup's baseSlug
      if (chosenGroup.subSlug && !chosenGroup.dubSlug) {
        subEpisodes = best.candidate.detail.episodes;
      } else if (chosenGroup.dubSlug && !chosenGroup.subSlug) {
        dubEpisodes = best.candidate.detail.episodes;
      } else {
        const subSlug = chosenGroup.subSlug || chosenGroup.baseSlug;
        const dubSlug = chosenGroup.dubSlug || `${chosenGroup.baseSlug}-dub`;

        const [subDetail, dubDetail] = await Promise.all([
          fetchAnimePage(subSlug),
          fetchAnimePage(dubSlug)
        ]);

        if (subDetail && subDetail.episodes && subDetail.episodes.length) subEpisodes = subDetail.episodes;
        if (dubDetail && dubDetail.episodes && dubDetail.episodes.length) dubEpisodes = dubDetail.episodes;
      }

      // Only probe the counterpart if it belongs to the EXACT same baseSlug
      if (subEpisodes.length && !dubEpisodes.length) {
        const probeDub = await fetchAnimePage(`${chosenGroup.baseSlug}-dub`);
        if (probeDub && probeDub.episodes && probeDub.episodes.length) dubEpisodes = probeDub.episodes;
      } else if (dubEpisodes.length && !subEpisodes.length) {
        const probeSub = await fetchAnimePage(chosenGroup.baseSlug);
        if (probeSub && probeSub.episodes && probeSub.episodes.length) subEpisodes = probeSub.episodes;
      }

      // Merge sub and dub episodes by episode number
      const epMap = new Map();

      for (const e of subEpisodes) {
        epMap.set(e.number, {
          number: e.number,
          title: e.title,
          date: e.date,
          subUrl: e.url,
          dubUrl: undefined
        });
      }

      for (const e of dubEpisodes) {
        const existing = epMap.get(e.number);
        if (existing) {
          existing.dubUrl = e.url;
        } else {
          epMap.set(e.number, {
            number: e.number,
            title: e.title,
            date: e.date,
            subUrl: undefined,
            dubUrl: e.url
          });
        }
      }

      const mergedEpisodes = Array.from(epMap.values())
        .sort((a, b) => a.number - b.number)
        .map((e) => ({
          number: e.number,
          ref: JSON.stringify({ subUrl: e.subUrl, dubUrl: e.dubUrl }),
          title: e.title || `Episode ${e.number}`,
          airDate: e.date || null,
          sub: Boolean(e.subUrl),
          dub: Boolean(e.dubUrl)
        }));

      return mergedEpisodes;
    },

    async getStreams(episodeRef, audio) {
      let targetUrl = null;
      try {
        const parsed = JSON.parse(episodeRef);
        targetUrl = audio === "dub" ? parsed.dubUrl : parsed.subUrl;
        if (!targetUrl) {
          targetUrl = audio === "dub" ? parsed.subUrl : parsed.dubUrl;
        }
      } catch (_) {
        targetUrl = episodeRef;
      }

      if (!targetUrl) {
        throw new Error(`Gogoanime: No ${audio} stream URL available for this episode.`);
      }

      const res = await fetch(targetUrl, { headers: HEADERS });
      const html = await res.text();

      const streams = [];
      const origin = function(u) {
        try {
          const parts = u.split("/");
          return parts[0] + "//" + parts[2];
        } catch (_) {
          return BASE;
        }
      };

      // 1. Direct player iframe with player.php?m3u8=
      const m3u8Match = html.match(/player\.php\?m3u8=([^"&'\s]+)/i);
      if (m3u8Match) {
        const m3u8Url = decodeURIComponent(m3u8Match[1]);
        const subMatch = html.match(/subtitle=([^"&'\s]+)/i);
        const subs = [];
        if (subMatch) {
          subs.push({
            url: decodeURIComponent(subMatch[1]),
            label: "English",
            srclang: "en",
            default: true
          });
        }
        streams.push({
          url: m3u8Url,
          type: "hls",
          server: "Gogo Server",
          quality: "1080p",
          headers: { "Referer": origin(targetUrl) + "/" },
          subtitles: subs
        });
      }

      // 2. Extract player embed and mirror servers
      const embedUrls = [];
      const pembedMatch = html.match(/<div class="player-embed" id="pembed"><iframe src="([^"]+)"/i);
      if (pembedMatch) embedUrls.push(pembedMatch[1]);

      const mirrorMatches = [...html.matchAll(/<option value="([^"]+)"[^>]*>\s*([^<\s]+)/gi)];
      for (const m of mirrorMatches) {
        try {
          const b64 = m[1];
          let decoded = "";
          if (typeof atob === "function") {
            decoded = atob(b64);
          } else {
            decoded = base64urlToBase64(b64);
          }
          const srcMatch = decoded.match(/src="([^"]+)"/i);
          if (srcMatch && !embedUrls.includes(srcMatch[1])) {
            embedUrls.push(srcMatch[1]);
          }
        } catch (_) {}
      }

      // Legacy server elements
      const serverRegex = /<li[^>]*class="server"[^>]*data-video="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi;
      let sMatch;
      while ((sMatch = serverRegex.exec(html)) !== null) {
        let embed = sMatch[1];
        if (embed.startsWith("//")) embed = "https:" + embed;
        if (!embedUrls.includes(embed)) embedUrls.push(embed);
      }

      for (let i = 0; i < embedUrls.length; i++) {
        let embed = embedUrls[i];
        if (embed.startsWith("//")) embed = "https:" + embed;
        const serverName = "Server " + (i + 1);

        if (embed.includes("newplayer.php")) {
          try {
            const pRes = await fetch(embed, { headers: { "Referer": targetUrl } });
            const pHtml = await pRes.text();
            const innerMatch = pHtml.match(/<iframe[^>]+src=["']?([^"'\s>]+)/i);
            if (innerMatch && innerMatch[1]) {
              const innerSrc = innerMatch[1];
              if (innerSrc.includes("megaplay.buzz") && typeof aniways !== "undefined" && aniways.crypto) {
                try {
                  const details = await extractMegaPlay(innerSrc, audio);
                  if (details && details.masterUrl) {
                    streams.push({
                      url: details.masterUrl,
                      type: "hls",
                      server: "MegaPlay " + serverName,
                      quality: "1080p",
                      headers: { "Referer": "https://megaplay.buzz/" },
                      subtitles: details.subtitles,
                      intro: details.intro,
                      outro: details.outro
                    });
                  }
                } catch (e) {
                  console.warn("Gogoanime MegaPlay extraction error:", (e && e.message) || e);
                }
              }

              streams.push({
                url: innerSrc,
                type: "embed",
                server: serverName + " (Embed)",
                headers: { "Referer": origin(innerSrc) + "/" }
              });
            }
          } catch (_) {
            streams.push({
              url: embed,
              type: "embed",
              server: serverName,
              headers: { "Referer": origin(targetUrl) + "/" }
            });
          }
        } else if (embed.includes("player.php?m3u8=")) {
          const uMatch = embed.match(/m3u8=([^&]+)/);
          if (uMatch) {
            streams.push({
              url: decodeURIComponent(uMatch[1]),
              type: "hls",
              server: serverName,
              headers: { "Referer": origin(embed) + "/" }
            });
          }
        } else {
          streams.push({
            url: embed,
            type: "embed",
            server: serverName,
            headers: { "Referer": origin(targetUrl) + "/" }
          });
        }
      }

      if (streams.length === 0) {
        streams.push({
          url: targetUrl,
          type: "embed",
          server: "Gogo Web",
          headers: { "Referer": BASE + "/" }
        });
      }

      return {
        streams: streams
      };
    }
  };

  registerExtension(GogoanimeExtension);
})();
