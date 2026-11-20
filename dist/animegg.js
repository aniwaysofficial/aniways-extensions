/**
 * AnimeGG Extension for Aniways
 * Native direct MP4 extraction with robust multi-attribute scraping and candidate scoring.
 */
(function() {
  const BASE = "https://www.animegg.org";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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

  function getAttr(tag, name) {
    var m = tag.match(new RegExp(name + "\\s*=\\s*['\"]([^'\"]*)['\"]", "i"));
    return m ? m[1] : null;
  }

  function scoreCandidate(cand, primaryEn, primaryRom, synonyms) {
    let score = 0;
    const synList = synonyms || [];
    const candNameNorm = normalize(cand.name);
    const candSlugNorm = normalize(cand.slug);

    const normEn = normalize(primaryEn || "");
    const normRom = normalize(primaryRom || "");

    if (normEn && candNameNorm === normEn) score += 1000;
    if (normRom && candNameNorm === normRom) score += 900;

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
    }

    return score;
  }

  const AnimeggExtension = {
    id: "animegg",
    name: "AnimeGG",
    version: "1.0.0",
    versionCode: 1,
    author: "Aniways Community",
    audio: ["sub", "dub"],
    baseUrl: BASE,
    description: "Fast direct MP4 video streams from AnimeGG.",

    async getEpisodes(meta) {
      const titles = [
        meta.titles && meta.titles.english,
        meta.titles && meta.titles.romaji,
        ...((meta.titles && meta.titles.synonyms) || []),
      ].filter(Boolean);

      let targetSlug = null;
      let candidates = [];

      // 1. Search AnimeGG across titles
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = BASE + "/search/?q=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const linkRegex = /<a\s+[^>]*href=["']\/series\/([^/?#'"]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          while ((match = linkRegex.exec(html)) !== null) {
            const tag = match[0];
            if (!tag.includes("mse")) continue;
            const slug = match[1];
            const name = cleanTitle(match[2]);
            const score = scoreCandidate(
              { slug: slug, name: name },
              meta.titles && meta.titles.english,
              meta.titles && meta.titles.romaji,
              meta.titles && meta.titles.synonyms
            );
            candidates.push({ slug: slug, name: name, score: score });
          }

          if (candidates.length) break;
        } catch (e) {
          console.warn("AnimeGG search error:", (e && e.message) || e);
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 0) {
        targetSlug = candidates[0].slug;
      }

      if (!targetSlug) return [];

      // 2. Scrape series episodes
      const episodes = [];
      try {
        const seriesUrl = BASE + "/series/" + targetSlug;
        const res = await fetch(seriesUrl, { headers: HEADERS });
        const html = await res.text();

        const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
        let liMatch;
        const seen = new Set();

        while ((liMatch = liRegex.exec(html)) !== null) {
          const content = liMatch[1];
          if (!content.includes("anm_det_pop")) continue;

          const hrefMatch = content.match(/href=["']\/?([^"'#]+)/);
          const strongMatch = content.match(/<strong>([\s\S]*?)<\/strong>/);
          if (!hrefMatch || !strongMatch) continue;

          const href = hrefMatch[1];
          const strongText = cleanTitle(strongMatch[1]);
          const numMatch = strongText.match(/(\d+)\s*$/);
          if (!numMatch) continue;

          const num = parseInt(numMatch[1], 10);
          if (isNaN(num) || seen.has(num)) continue;
          seen.add(num);

          const titleMatch = content.match(/class=["'][^"']*anititle[^"']*["'][^>]*>([\s\S]*?)<\/i>/i);
          const title = titleMatch ? cleanTitle(titleMatch[1]) : ("Episode " + num);

          const isSub = content.includes("btn-subbed");
          const isDub = content.includes("btn-dubbed");

          episodes.push({
            number: num,
            title: title,
            ref: href,
            sub: isSub || !isDub,
            dub: isDub,
          });
        }
      } catch (e) {
        console.warn("AnimeGG parse episodes error:", (e && e.message) || e);
      }

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const streams = [];

      try {
        const epUrl = BASE + "/" + episodeRef;
        const res = await fetch(epUrl, { headers: HEADERS });
        const html = await res.text();

        const aRegex = /<a\b[^>]*data-toggle=["']tab["'][^>]*>/gi;
        let match;
        const embeds = [];

        while ((match = aRegex.exec(html)) !== null) {
          const tag = match[0];
          const embedId = getAttr(tag, "data-id");
          const mirror = getAttr(tag, "data-mirror") || "AnimeGG";
          const version = (getAttr(tag, "data-version") || "subbed").toLowerCase();

          if (!embedId) continue;
          if (audio === "dub" && !version.startsWith("dub")) continue;
          if (audio === "sub" && version.startsWith("dub")) continue;

          embeds.push({ id: embedId, server: mirror });
        }

        for (const e of embeds.slice(0, 3)) {
          try {
            const embedUrl = BASE + "/embed/" + e.id;
            const eRes = await fetch(embedUrl, {
              headers: Object.assign({}, HEADERS, { "Referer": BASE + "/" }),
            });
            const eHtml = await eRes.text();

            const rawMatch = eHtml.match(/var\s+videoSources\s*=\s*(\[[\s\S]*?\]);/);
            if (rawMatch) {
              const itemRegex = /file:\s*["']([^"']+)["'](?:,\s*label:\s*["']([^"']+)["'])?/gi;
              let sm;
              while ((sm = itemRegex.exec(rawMatch[1])) !== null) {
                const filePath = sm[1];
                const label = sm[2] || "720p";
                const videoUrl = filePath.startsWith("http") ? filePath : (BASE + (filePath.startsWith("/") ? "" : "/") + filePath);

                streams.push({
                  url: videoUrl,
                  type: videoUrl.includes(".m3u8") ? "hls" : "mp4",
                  server: e.server + (label ? " · " + label : ""),
                  quality: label,
                  headers: { "Referer": BASE + "/" },
                });
              }
            }
          } catch (err) {
            console.warn("AnimeGG embed fetch error:", (err && err.message) || err);
          }
        }
      } catch (e) {
        console.warn("AnimeGG getStreams error:", (e && e.message) || e);
      }

      return {
        streams: streams,
      };
    },
  };

  (globalThis.registerExtension || registerExtension)(AnimeggExtension);
})();
