/**
 * AnimeOnsen Extension for Aniways
 * Native DASH extraction with soft subtitles and tokenized guest session bootstrap.
 */
(function() {
  const SITE = "https://www.animeonsen.xyz";

  let session = null;
  let sessionPromise = null;

  function base64Decode(str) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var out = "";
    var strClean = String(str || "").replace(/=+$/, "");
    for (var bc = 0, bs, buffer, idx = 0; buffer = strClean.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? out += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
      buffer = chars.indexOf(buffer);
    }
    return out;
  }

  function decodeSessionToken(cookie) {
    var decoded = base64Decode(decodeURIComponent(cookie));
    var token = "";
    for (var i = 0; i < decoded.length; i++) {
      token += String.fromCharCode(decoded.charCodeAt(i) + 1);
    }
    return token;
  }

  function normalize(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function scoreCandidate(cand, primaryEn, primaryRom, synonyms) {
    let score = 0;
    const synList = synonyms || [];
    const candNameNorm = normalize(cand.content_title_en || cand.content_title || "");
    const candJpNorm = normalize(cand.content_title_jp || "");

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
      const candHasMod = candNameNorm.includes(modNorm);
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

  async function createSession() {
    try {
      const res = await fetch(SITE + "/", {
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });
      const html = await res.text();

      function metaContent(name) {
        const re = new RegExp('<meta[^>]*name=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', "i");
        const m = html.match(re);
        if (m) return m[1];
        const reRev = new RegExp('<meta[^>]*content=["\']([^"\']*)["\'][^>]*name=["\']' + name + '["\']', "i");
        const mRev = html.match(reRev);
        return mRev ? mRev[1] : "";
      }

      const apiOrigin = metaContent("ao-api-origin") || "https://api.animeonsen.xyz";
      const searchOrigin = metaContent("ao-search-origin") || "https://search.animeonsen.xyz";
      const searchToken = metaContent("ao-search-token");

      const setCookie = res.headers.get("set-cookie") || "";
      const cookieMatch = setCookie.match(/(?:^|;\s*|,\s*)ao\.session=([^;]+)/);
      let token = "";
      if (cookieMatch) {
        token = decodeSessionToken(cookieMatch[1]);
      }

      session = {
        token: token,
        apiOrigin: apiOrigin,
        searchOrigin: searchOrigin,
        searchToken: searchToken,
      };
      return session;
    } catch (e) {
      console.warn("AnimeOnsen session init error:", (e && e.message) || e);
      return {
        token: "",
        apiOrigin: "https://api.animeonsen.xyz",
        searchOrigin: "https://search.animeonsen.xyz",
        searchToken: "",
      };
    }
  }

  function getSession(force) {
    if (force) session = null;
    if (session) return Promise.resolve(session);
    if (!sessionPromise) {
      sessionPromise = createSession().then((s) => {
        session = s;
        sessionPromise = null;
        return s;
      }).catch((err) => {
        sessionPromise = null;
        throw err;
      });
    }
    return sessionPromise;
  }

  const AnimeOnsenExtension = {
    id: "animeonsen",
    name: "AnimeOnsen",
    version: "1.0.0",
    versionCode: 1,
    author: "Aniways Community",
    audio: ["sub"],
    baseUrl: SITE,
    description: "High quality DASH streaming with multi-language soft subtitles from AnimeOnsen.",

    async getEpisodes(meta) {
      const sess = await getSession();
      const titles = [
        meta.titles && meta.titles.english,
        meta.titles && meta.titles.romaji,
        ...((meta.titles && meta.titles.synonyms) || []),
      ].filter(Boolean);

      let targetId = null;
      let candidates = [];

      // 1. Search Meilisearch across titles
      for (const query of titles.slice(0, 3)) {
        if (!query) continue;
        try {
          const searchUrl = sess.searchOrigin + "/multi-search";
          const res = await fetch(searchUrl, {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + sess.searchToken,
              "Content-Type": "application/json",
              "Accept": "application/json",
              "Origin": SITE,
              "Referer": SITE + "/",
            },
            body: JSON.stringify({
              queries: [{ indexUid: "content", q: query, limit: 10 }],
            }),
          });
          const data = await res.json();
          const hits = (data && data.results && data.results[0] && data.results[0].hits) || [];

          for (const hit of hits) {
            if (!hit || !hit.content_id) continue;
            const score = scoreCandidate(
              hit,
              meta.titles && meta.titles.english,
              meta.titles && meta.titles.romaji,
              meta.titles && meta.titles.synonyms
            );
            candidates.push({ id: hit.content_id, hit: hit, score: score });
          }

          if (candidates.length) break;
        } catch (e) {
          console.warn("AnimeOnsen search error:", (e && e.message) || e);
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 0) {
        targetId = candidates[0].id;
      }

      if (!targetId) return [];

      // 2. Fetch episodes list with Bearer token
      const episodes = [];
      try {
        const epUrl = sess.apiOrigin + "/v4/content/" + encodeURIComponent(targetId) + "/episodes";
        let res = await fetch(epUrl, {
          headers: {
            "Authorization": "Bearer " + sess.token,
            "Origin": SITE,
            "Referer": SITE + "/",
          },
        });

        // If 401, refresh session and retry once
        if (res.status === 401 || res.status === 403) {
          const freshSess = await getSession(true);
          res = await fetch(epUrl, {
            headers: {
              "Authorization": "Bearer " + freshSess.token,
              "Origin": SITE,
              "Referer": SITE + "/",
            },
          });
        }

        const data = await res.json();
        if (data && typeof data === "object") {
          const keys = Object.keys(data);
          keys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

          for (const key of keys) {
            const num = parseInt(key, 10);
            if (isNaN(num)) continue;
            const epData = data[key];
            const title = (epData && (epData.contentTitle_episode_en || epData.contentTitle_episode_jp)) || ("Episode " + num);

            episodes.push({
              number: num,
              title: title,
              ref: targetId + ":" + key,
              sub: true,
              dub: false,
            });
          }
        }
      } catch (e) {
        console.warn("AnimeOnsen parse episodes error:", (e && e.message) || e);
      }

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    },

    async getStreams(episodeRef, audio) {
      const sess = await getSession();
      const parts = episodeRef.split(":");
      const contentId = parts[0];
      const epNum = parts[1] || parts[0];

      const streams = [];
      let intro = null;
      let outro = null;

      try {
        const videoUrl = sess.apiOrigin + "/v4/content/" + encodeURIComponent(contentId) + "/video/" + encodeURIComponent(epNum);
        let res = await fetch(videoUrl, {
          headers: {
            "Authorization": "Bearer " + sess.token,
            "Origin": SITE,
            "Referer": SITE + "/",
          },
        });

        if (res.status === 401 || res.status === 403) {
          const freshSess = await getSession(true);
          res = await fetch(videoUrl, {
            headers: {
              "Authorization": "Bearer " + freshSess.token,
              "Origin": SITE,
              "Referer": SITE + "/",
            },
          });
        }

        const data = await res.json();
        if (data && data.uri && data.uri.stream) {
          const streamUrl = data.uri.stream;
          const subs = [];

          const authHeaders = {
            "Authorization": "Bearer " + sess.token,
            "Origin": SITE,
            "Referer": SITE + "/",
          };

          if (data.uri.subtitles && typeof data.uri.subtitles === "object") {
            const labels = (data.metadata && data.metadata.subtitles) || {};
            for (const lang in data.uri.subtitles) {
              subs.push({
                url: data.uri.subtitles[lang],
                label: labels[lang] || lang,
                srclang: lang,
                default: lang === "en-US" || lang.startsWith("en"),
                headers: authHeaders,
              });
            }
          }

          // Check intro/outro skip data
          if (Array.isArray(data.metadata && data.metadata.episode)) {
            const skipObj = data.metadata.episode.find(function(i) {
              return i && typeof i === "object" && ("skipIntro_s" in i || "skipIntro_e" in i);
            });
            if (skipObj) {
              intro = { start: skipObj.skipIntro_s || 0, end: skipObj.skipIntro_e || 0 };
            }
          }

          const streamType = streamUrl.includes(".m3u8") ? "hls" : (streamUrl.includes(".mpd") ? "dash" : "mp4");

          streams.push({
            url: streamUrl,
            type: streamType,
            server: "AnimeOnsen",
            quality: "1080p",
            headers: authHeaders,
            subtitles: subs,
          });
        }
      } catch (e) {
        console.warn("AnimeOnsen getStreams error:", (e && e.message) || e);
      }

      return {
        streams: streams,
        intro: intro,
        outro: outro,
      };
    },
  };

  (globalThis.registerExtension || registerExtension)(AnimeOnsenExtension);
})();
