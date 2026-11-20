/**
 * AniZone Extension for Aniways
 * Version: 1.0.0
 * Audio: Sub
 */
(function() {
  const BASE = "https://anizone.to";
  const HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  };

  const marker = "\x01U\x01";

  function decodeJsonArgument(raw) {
    if (!raw) return null;
    const value = raw
      .replace(/\\'/g, "'")
      .replace(/\\\\u([0-9a-fA-F]{4})/g, marker + "$1")
      .replace(/\\u([0-9a-fA-F]{4})/g, function(_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      })
      .replace(/\x01U\x01([0-9a-fA-F]{4})/g, "\\u$1");
    try {
      return JSON.parse(value);
    } catch (_) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }
  }

  function jsonArgument(html, name) {
    const re = new RegExp(name + "\\s*:\\s*JSON\\.parse\\((['\"])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1\\)", "is");
    const m = html.match(re);
    return decodeJsonArgument(m ? m[2] : null);
  }

  function normalizeUrl(v) {
    return String(v || "").replace(/\\+\//g, "/");
  }

  function decodeEntities(str) {
    if (!str) return "";
    return str
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function pickTitle(t) {
    if (!t) return "";
    return t["1"] || t["5"] || t["8"] || Object.values(t)[0] || "";
  }

    function buildSearchQueries(meta) {
    const list = [
      meta.titles && meta.titles.english,
      meta.titles && meta.titles.romaji,
    ].filter(Boolean);

    const queries = [];
    for (const t of list) {
      const clean = t.replace(/\s+/g, " ").trim();
      if (clean && !queries.includes(clean)) queries.push(clean);
      const stripped = clean
        .replace(/\b(?:season|part|cour|stage)\s*\d+\b/gi, "")
        .replace(/\b\d+(?:st|nd|rd|th)\s*(?:season|part)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped && stripped !== clean && !queries.includes(stripped)) {
        queries.push(stripped);
      }
    }
    return queries;
  }

  function scoreMatch(candidate, meta) {
    const candTitles = [
      candidate.main_title,
      ...(candidate.title_list ? Object.values(candidate.title_list) : []),
      candidate.slug ? candidate.slug.replace(/-/g, " ") : ""
    ].filter(Boolean);

    const targetTitles = [
      meta.titles && meta.titles.english,
      meta.titles && meta.titles.romaji,
      ...(meta.titles && meta.titles.synonyms || [])
    ].filter(Boolean);

    let maxScore = 0;
    function norm(s) {
      return (s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    }
    const targetNorms = targetTitles.map(norm);

    for (const cTitle of candTitles) {
      const cNorm = norm(cTitle);
      if (!cNorm) continue;
      for (const tNorm of targetNorms) {
        if (!tNorm) continue;
        if (cNorm === tNorm) {
          maxScore = Math.max(maxScore, 1.0);
        } else if (cNorm.includes(tNorm) || tNorm.includes(cNorm)) {
          const ratio = Math.min(cNorm.length, tNorm.length) / Math.max(cNorm.length, tNorm.length);
          maxScore = Math.max(maxScore, 0.7 + ratio * 0.25);
        } else {
          const cWords = cNorm.split(" ").filter(w => w.length > 2);
          const tWords = tNorm.split(" ").filter(w => w.length > 2);
          if (cWords.length > 0 && tWords.length > 0) {
            const common = cWords.filter(w => tWords.includes(w)).length;
            const sim = (2 * common) / (cWords.length + tWords.length);
            maxScore = Math.max(maxScore, sim * 0.7);
          }
        }
      }
    }

    if (meta.year && candidate.start_year) {
      if (Number(meta.year) === Number(candidate.start_year)) {
        maxScore += 0.35;
      } else if (Math.abs(Number(meta.year) - Number(candidate.start_year)) > 1) {
        maxScore -= 0.35;
      }
    }

    return maxScore;
  }

  const AnizoneExtension = {
    id: "anizone",
    name: "AniZone",
    version: "1.0.0",
    versionCode: 1,
    author: "Aniways Community",
    audio: ["sub"],
    baseUrl: BASE,
    description: "Direct HLS streams with integrated soft subtitles from AniZone.",

    async getEpisodes(meta) {
      const queries = buildSearchQueries(meta);
      let targetSlug = null;
      let bestCandidate = null;
      let bestScore = 0;

      for (const query of queries) {
        try {
          const searchUrl = BASE + "/anime?search=" + encodeURIComponent(query);
          const res = await fetch(searchUrl, { headers: HEADERS });
          const html = await res.text();

          const items = jsonArgument(html, "items");
          if (Array.isArray(items) && items.length > 0) {
            for (const item of items) {
              if (!item.slug) continue;
              const sc = scoreMatch(item, meta);
              if (sc > bestScore && sc >= 0.5) {
                bestScore = sc;
                bestCandidate = item;
                targetSlug = item.slug;
              }
            }
            if (bestScore >= 0.7) break;
          }
        } catch (e) {
          console.warn("AniZone search error:", e.message);
        }
      }

      if (!targetSlug) {
        const fallback = (meta.titles && (meta.titles.romaji || meta.titles.english)) || "";
        targetSlug = fallback.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }

      if (!targetSlug) return [];

      const episodes = [];
      try {
        const pageUrl = BASE + "/anime/" + targetSlug;
        const res = await fetch(pageUrl, { headers: HEADERS });
        const html = await res.text();

        const initialItems = jsonArgument(html, "items");
        const allItems = Array.isArray(initialItems) ? [...initialItems] : [];

        const snapshotRaw = (html.match(/wire:snapshot="([^"]*)"/i) || [])[1];
        const csrf = (html.match(/csrf-token"\s+content="([^"]+)"/i) || [])[1];
        let cursor = (html.match(/nextCursor:\s*'([^']+)'/i) || [])[1] || null;
        let hasMore = /hasMore:\s*true/i.test(html);

        if (hasMore && cursor && snapshotRaw && csrf) {
          let snapshot = decodeEntities(snapshotRaw);
          let page = 1;
          const maxPages = 20;

          while (hasMore && cursor && page < maxPages) {
            try {
              const updateRes = await fetch(BASE + "/livewire/update", {
                method: "POST",
                headers: {
                  "Accept": "application/json, text/plain, */*",
                  "Content-Type": "application/json",
                  "X-Livewire": "",
                  "X-CSRF-TOKEN": csrf,
                  "X-Requested-With": "XMLHttpRequest",
                  "Origin": BASE,
                  "Referer": BASE + "/anime/" + targetSlug
                },
                body: JSON.stringify({
                  components: [{
                    snapshot: snapshot,
                    updates: {},
                    calls: [{ path: "", method: "loadPage", params: [cursor] }]
                  }]
                })
              });
              const payload = await updateRes.json();
              const comp = payload && payload.components && payload.components[0];
              const dispatch = comp && comp.effects && comp.effects.dispatches &&
                comp.effects.dispatches.find(function(d) { return d.name === "items-loaded"; });

              if (!dispatch || !dispatch.params || !Array.isArray(dispatch.params.items)) {
                break;
              }
              allItems.push(...dispatch.params.items);
              snapshot = comp.snapshot;
              cursor = dispatch.params.nextCursor || null;
              hasMore = Boolean(dispatch.params.hasMore);
              page++;
            } catch (err) {
              break;
            }
          }
        }

        const seen = new Set();
        for (let i = 0; i < allItems.length; i++) {
          const item = allItems[i];
          const direct = Number(item.slug);
          const parsedFromUrl = Number(normalizeUrl(item.url).match(/\/(\d+)\/?$/)?.[1]);
          const num = (Number.isFinite(direct) && direct > 0)
            ? direct
            : (Number.isFinite(parsedFromUrl) && parsedFromUrl > 0 ? parsedFromUrl : (i + 1));

          if (seen.has(num)) continue;
          seen.add(num);

          const epTitle = pickTitle(item.title_list) || item.title || ("Episode " + num);
          const hasSub = item.videos_count !== undefined ? Number(item.videos_count) > 0 : true;

          episodes.push({
            number: num,
            title: epTitle,
            ref: targetSlug + "/" + num,
            sub: hasSub,
            dub: false
          });
        }

        episodes.sort(function(a, b) { return a.number - b.number; });
      } catch (e) {
        console.warn("AniZone getEpisodes error:", e.message);
      }

      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const streams = [];

      try {
        const epUrl = BASE + "/anime/" + episodeRef;
        const res = await fetch(epUrl, { headers: HEADERS });
        const html = await res.text();

        const playerMatch = html.match(/vidstackPlayer\s*\(\s*JSON\.parse\((['"])([\s\S]*?)\1\)\s*\)/i);
        const data = playerMatch ? decodeJsonArgument(playerMatch[2]) : null;

        if (data && data.src) {
          const streamUrl = normalizeUrl(data.src);
          const subs = [];

          if (Array.isArray(data.subtitles)) {
            for (const s of data.subtitles) {
              if (s.file) {
                subs.push({
                  url: normalizeUrl(s.file),
                  label: s.title || s.language || "English",
                  srclang: s.language || "en",
                  default: Boolean(s.default)
                });
              }
            }
          }

          streams.push({
            url: streamUrl,
            type: "hls",
            server: "AniZone HLS",
            quality: "1080p",
            headers: { "Referer": BASE + "/" },
            subtitles: subs
          });
        }
      } catch (e) {
        console.warn("AniZone getStreams error:", e.message);
      }

      return {
        streams: streams
      };
    }
  };

  registerExtension(AnizoneExtension);
})();
