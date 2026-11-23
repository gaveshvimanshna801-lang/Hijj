/**
 * TMDB (themoviedb.org) details for the movie card.
 * The movie FILES still come from the normal download API; TMDB is only used for the
 * nice poster + details (rating, release date, runtime, director, genres, story).
 *
 * Needs a free TMDB key in the env var TMDB_API_KEY
 * (either the "API Key" (v3) or the long "API Read Access Token" (v4) - both work).
 * Without a key, or if the movie isn't found, the bot falls back to the old card.
 */

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

/** "The Third Murder (2026) Sinhala Subtitles | සිංහල උපසිරැසි සමඟ" -> { title: "The Third Murder", year: 2026 } */
function cleanTitle(raw) {
    let s = String(raw || '');
    s = s.split('|')[0];                                   // everything after "|" is Sinhala text
    s = s.replace(/[\u0D80-\u0DFF]/g, ' ');                // any Sinhala letters
    s = s.replace(/\[[^\]]*\]/g, ' ');                     // [Dual Audio] etc.
    let year = null;
    s = s.replace(/\(?\b((?:19|20)\d{2})\b\)?/, (m, y) => { year = parseInt(y, 10); return ' '; });
    s = s.replace(/\b(sinhala|sinhalen|subtitles?|subs?|dubbed|dual audio|bluray|blu-ray|web-?dl|webrip|hdrip|hdtv|hd|x264|x265|480p|720p|1080p|2160p)\b/gi, ' ');
    s = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    return { title: s, year };
}

const authFor = (key) => {
    const k = String(key || '').trim();
    return k.length > 60 || k.startsWith('eyJ')
        ? { headers: { Authorization: `Bearer ${k}` }, params: {} }   // v4 token
        : { headers: {}, params: { api_key: k } };                    // v3 key
};

const releaseYear = (r) => parseInt(String(r?.release_date || '').slice(0, 4), 10) || null;

const fmtRuntime = (min) => {
    const m = parseInt(min, 10);
    if (!m) return '';
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/**
 * Looks the movie up. Never throws: returns null when there's no key, no match, or TMDB fails.
 * opts: { key, http (axios-like), imageType: 'poster' | 'backdrop' }
 */
async function tmdbLookup(rawTitle, yearHint, opts = {}) {
    const { key, http = require('axios'), imageType = 'poster' } = opts;
    if (!key) return null;
    try {
        const cleaned = cleanTitle(rawTitle);
        const year = cleaned.year || parseInt(yearHint, 10) || null;
        if (!cleaned.title) return null;
        const auth = authFor(key);

        const search = async (withYear) => {
            const { data } = await http.get(`${BASE}/search/movie`, {
                headers: auth.headers,
                params: { ...auth.params, query: cleaned.title, include_adult: false, language: 'en-US', ...(withYear && year ? { year } : {}) },
                timeout: 12000
            });
            return data?.results || [];
        };
        // With a known year only accept that year (±1): a wrong film is worse than the old card.
        const okYear = (r) => Math.abs((releaseYear(r) || 0) - year) <= 1;
        let results = await search(true);                       // narrowed by year first (finds new / common titles)
        let pick = year ? results.find(okYear) : results[0];
        if (!pick && year) pick = (await search(false)).find(okYear);
        if (!pick) {
            console.log(`TMDB: no match for "${cleaned.title}"${year ? ` (${year})` : ''} - using the download API's details`);
            return null;
        }

        const { data: d } = await http.get(`${BASE}/movie/${pick.id}`, {
            headers: auth.headers,
            params: { ...auth.params, language: 'en-US', append_to_response: 'credits' },
            timeout: 12000
        });

        const directors = (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
        const cast = (d.credits?.cast || []).slice(0, 3).map(c => c.name);
        const path = imageType === 'backdrop' ? (d.backdrop_path || d.poster_path) : (d.poster_path || d.backdrop_path);

        return {
            id: d.id,
            title: d.title || pick.title,
            year: releaseYear(d),
            rating: d.vote_average ? Number(d.vote_average).toFixed(1) : '',
            release: d.release_date || '',
            runtime: fmtRuntime(d.runtime),
            genres: (d.genres || []).map(g => g.name),
            overview: d.overview || '',
            directors,
            cast,
            image: path ? `${IMG}/w780${path}` : ''
        };
    } catch (e) {
        console.warn('TMDB lookup failed:', e.message);
        return null;
    }
}

const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '…' : s);

/** "2012-12-07" -> "07 December 2012" */
function fmtDate(d) {
    const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(d || '');
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Card in the boxed style:
 *   ╭━━〔 🌸 NAME 〕━━╮ ... ╰━━〔 MOVIE SYNOPSIS 〕━━╯ ... qualities ... movie information box
 * opts: name (header), footer, qualities (array of "BluRay 480p • 800 MB" labels -> list card),
 *       requestedBy, maxLen (captions are kept under ~1000 chars: the synopsis is shortened to fit)
 */
function buildCard(info, { name = 'MOVIE', footer = '', qualities = null, requestedBy = '', maxLen = 1000 } = {}) {
    const isList = Array.isArray(qualities);
    const heading = info.year ? `${info.title} (${info.year})` : info.title;

    const head = [`╭━━〔 🌸 ${name} 〕━━╮`, '', `🎬 *${heading}*`, ''];
    if (info.rating) head.push(`⭐ Rating : ${info.rating}/10`);
    if (info.release) head.push(`📆 Release : ${fmtDate(info.release)}`);
    if (info.runtime) head.push(`⏳ Runtime : ${info.runtime}`);
    if (info.genres.length) head.push(`🎭 Genre : ${info.genres.join(' | ')}`);
    if (info.directors.length) head.push(`🎥 Director : ${info.directors.slice(0, 2).join(', ')}`);
    if (!isList && info.cast.length) head.push(`🌟 Cast : ${info.cast.join(', ')}`);
    head.push('╰━━〔 MOVIE SYNOPSIS 〕━━╯');

    const tail = [];
    if (isList) {
        tail.push('', '📥 *AVAILABLE QUALITIES*🔥', '');
        qualities.forEach((q, i) => tail.push(`〔 ${i + 1} 〕 ${q}`));
        tail.push('', '╭━━〔 ❕ MOVIE INFORMATION 〕', '┃ Reply 0 for Movie Details Card', '┃ Reply 1* (number + *) for Card + File', '╰━━━━━━━━━━━━━━━━');
    }
    if (requestedBy) tail.push('', `👤 *Requested by:* ${requestedBy}`);
    if (footer) tail.push('', footer);

    const fixed = head.join('\n').length + tail.join('\n').length + 4;
    const budget = Math.max(0, maxLen - fixed);
    const story = info.overview && budget > 60 ? [clip(info.overview, budget)] : [];
    return [...head, ...story, ...tail].join('\n');
}

/** Full details card (reply "0"). */
const tmdbCard = (info, o = {}) => buildCard(info, { ...o, qualities: o.qualities || null });

/** Quality-list card: details + numbered qualities + "Reply 0 / N*" box. */
const tmdbListCard = (info, o = {}) => buildCard(info, { ...o, qualities: o.qualities || [] });

module.exports = { cleanTitle, tmdbLookup, tmdbCard, tmdbListCard, fmtRuntime, fmtDate };
