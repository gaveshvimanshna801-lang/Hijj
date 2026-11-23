/**
 * Run: npm test
 * Guards the "no fake commands" rule and the language system. No network / WhatsApp needed.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const menu = require('../lib/menu');
const { LANGS, STR, t, resolveLang } = require('../lib/lang');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✔', name); };

const pairSrc = fs.readFileSync(path.join(__dirname, '..', 'pair.js'), 'utf8');
const realCases = new Set([...pairSrc.matchAll(/case '([a-z0-9]+)':/g)].map(m => m[1]));
const allowedMatch = pairSrc.match(/const MB_ALLOWED_COMMANDS = \[([^\]]+)\]/);
const MB_ALLOWED = [...allowedMatch[1].matchAll(/'([a-z0-9]+)'/g)].map(m => m[1]);

const baseCtx = (o = {}) => ({
    lang: 'en', prefix: '.', canAdmin: true, mbOnly: false, allowed: MB_ALLOWED,
    banned: [], hasPuppeteer: true, mbLimit: 3, mbRequestJid: '1@g.us', ...o
});
const info = { botName: 'TEST BOT', name: 'Gavesh', owner: '94742549935', uptime: '0d 1h 39m 40s', ramMb: '141' };

test('every command in the menu exists as a case in pair.js', () => {
    const fake = menu.allMenuNames().filter(n => !realCases.has(n));
    assert.deepStrictEqual(fake, [], `Fake commands in menu: ${fake.join(', ')}`);
});

test('no duplicate command names in the menu', () => {
    const names = menu.allMenuNames();
    assert.strictEqual(new Set(names).size, names.length);
});

test('every language has every string (no missing translations)', () => {
    for (const code of Object.keys(LANGS)) {
        const missing = Object.keys(STR.en).filter(k => !(k in STR[code]));
        assert.deepStrictEqual(missing, [], `${code} is missing: ${missing.join(', ')}`);
    }
});

test('every menu command has a description in every language', () => {
    for (const code of Object.keys(LANGS))
        for (const cat of menu.CATEGORIES) {
            assert.ok(STR[code]['cat.' + cat.id], `${code} cat.${cat.id}`);
            for (const c of cat.commands) assert.ok(STR[code]['cmd.' + c.key], `${code} cmd.${c.key}`);
        }
});

test('MB-only mode shows only commands the bot will answer', () => {
    const ctx = baseCtx({ mbOnly: true, canAdmin: false });
    const shown = menu.getCategories(ctx).flatMap(c => c.cmds.flatMap(x => x.names));
    assert.deepStrictEqual(shown.sort(), ['alive', 'cz', 'cinesubz', 'mb', 'moviebox', 'pair', 'ping'].sort());
    for (const n of shown) assert.ok(MB_ALLOWED.includes(n));
});

test('MB-only mode: owner also sees settings + lang, nothing else extra', () => {
    const ctx = baseCtx({ mbOnly: true, canAdmin: true });
    const shown = menu.getCategories(ctx).flatMap(c => c.cmds.flatMap(x => x.names));
    for (const n of shown) assert.ok(MB_ALLOWED.includes(n), `${n} would be ignored by the bot`);
    assert.ok(shown.includes('lang') && shown.includes('settings'));
});

test('everything shown is allowed when MB-only is off', () => {
    const cats = menu.getCategories(baseCtx());
    assert.ok(cats.length >= 4);
});

test('owner-only commands are hidden from normal users', () => {
    const shown = menu.getCategories(baseCtx({ canAdmin: false })).flatMap(c => c.cmds.flatMap(x => x.names));
    assert.ok(!shown.includes('settings') && !shown.includes('lang'));
});

test('banned commands are hidden from users but not from owner', () => {
    const user = menu.getCategories(baseCtx({ canAdmin: false, banned: ['ping', 'tt'] })).flatMap(c => c.cmds.flatMap(x => x.names));
    assert.ok(!user.includes('ping') && !user.includes('tt') && user.includes('tiktok'));
    const owner = menu.getCategories(baseCtx({ banned: ['ping'] })).flatMap(c => c.cmds.flatMap(x => x.names));
    assert.ok(owner.includes('ping'));
});

test('ss2 is hidden when puppeteer is not installed', () => {
    const shown = menu.getCategories(baseCtx({ hasPuppeteer: false })).flatMap(c => c.cmds.flatMap(x => x.names));
    assert.ok(!shown.includes('ss2'));
});

test('empty category is dropped and numbers stay 1..n', () => {
    const ctx = baseCtx({ mbOnly: true, canAdmin: false });
    const cats = menu.getCategories(ctx);
    assert.deepStrictEqual(cats.map(c => c.id), ['movies', 'tools']);
    const text = menu.buildMainMenu(ctx, info, cats);
    assert.ok(text.includes('*1* |') && text.includes('*2* |') && !text.includes('*3* |'));
});

test('main menu renders in English and Sinhala', () => {
    const en = menu.buildMainMenu(baseCtx(), info);
    const si = menu.buildMainMenu(baseCtx({ lang: 'si' }), info);
    assert.ok(en.includes('Movie Commands') && en.includes('English'));
    assert.ok(si.includes('චිත්‍රපට විධාන') && si.includes('සිංහල'));
    assert.ok(!/\{\w+\}/.test(en) && !/\{\w+\}/.test(si), 'unfilled {placeholder}');
});

test('category page lists real names + aliases with the prefix', () => {
    const ctx = baseCtx({ prefix: '!' });
    const cats = menu.getCategories(ctx);
    const text = menu.buildCategory(ctx, menu.findCategory(cats, 'download'));
    assert.ok(text.includes('*!song*') && text.includes('!ytmp3') && text.includes('*!tiktok*'));
});

test('findCategory works with number and id', () => {
    const cats = menu.getCategories(baseCtx());
    assert.strictEqual(menu.findCategory(cats, '1').id, cats[0].id);
    assert.strictEqual(menu.findCategory(cats, 'tools').id, 'tools');
    assert.strictEqual(menu.findCategory(cats, '99'), null);
    assert.strictEqual(menu.findCategory(cats, 'abc'), null);
});

test('resolveLang understands codes, names and Sinhala', () => {
    assert.strictEqual(resolveLang('si'), 'si');
    assert.strictEqual(resolveLang('SINHALA'), 'si');
    assert.strictEqual(resolveLang('සිංහල'), 'si');
    assert.strictEqual(resolveLang('english'), 'en');
    assert.strictEqual(resolveLang('xx'), null);
});

test('t() falls back to English for unknown language / key', () => {
    assert.strictEqual(t('zz', 'cat.movies'), 'Movie Commands');
    assert.strictEqual(t('en', 'no.such.key'), 'no.such.key');
});

test('.cz is not tied to the request/upload group in pair.js', () => {
    assert.ok(/isMb && !isCz && cfg\.MB_REQUEST_JID/.test(pairSrc));
    assert.ok(/const toGroup = isMb && !isCz && !!cfg\.MB_UPLOAD_JID/.test(pairSrc));
});

test('request-group note is shown only when .mb is listed', () => {
    const ctx = baseCtx({ canAdmin: false, mbOnly: true });
    const cats = menu.getCategories(ctx);
    assert.ok(menu.buildCategory(ctx, cats[0]).includes('.mb works only'));
    const noMb = { ...cats[0], cmds: cats[0].cmds.filter(c => c.key === 'cz') };
    assert.ok(!menu.buildCategory(ctx, noMb).includes('.mb works only'));
});

test('mb/cz/ss pick lists stay open for more picks (no stop() before onPick)', () => {
    const start = pairSrc.indexOf('const awaitPick = (listId, max, onPick, opts = {}) => {');
    const block = pairSrc.slice(start, pairSrc.indexOf("await reply(`🔍 Searching ${srcName}"));
    assert.ok(block.includes('inFlight') && block.includes('resetTimer'));
    assert.ok(!/\n\s*stop\(\);\s*\n\s*try \{\s*\n\s*await onPick/.test(block));
});

const { cleanTitle, tmdbLookup, tmdbCard, tmdbListCard } = require('../lib/tmdb');

test('TMDB: title cleaning', () => {
    assert.deepStrictEqual(cleanTitle('The Third Murder (2026) Sinhala Subtitles | සිංහල උපසිරැසි සමඟ'), { title: 'The Third Murder', year: 2026 });
    assert.deepStrictEqual(cleanTitle('Anbil Avan'), { title: 'Anbil Avan', year: null });
    assert.deepStrictEqual(cleanTitle('Avatar 2009 [Dual Audio] 1080p BluRay'), { title: 'Avatar', year: 2009 });
});

const fakeHttp = (searchResults, detail) => ({
    calls: [],
    async get(url, o) {
        this.calls.push({ url, o });
        if (url.endsWith('/search/movie')) return { data: { results: searchResults } };
        return { data: detail };
    }
});
const DETAIL = {
    id: 7, title: 'Anbil Avan', release_date: '2026-10-02', runtime: 158, vote_average: 7.04,
    genres: [{ name: 'Romance' }, { name: 'Thriller' }], overview: 'A married couple attempts to start a good life together. '.repeat(12),
    poster_path: '/p.jpg', backdrop_path: '/b.jpg',
    credits: { crew: [{ job: 'Director', name: 'R. Kaarthikeyan' }, { job: 'Writer', name: 'X' }], cast: [{ name: 'A' }, { name: 'B' }] }
};

test('TMDB: no key -> null, nothing requested', async () => {
    const http = fakeHttp([], {});
    assert.strictEqual(await tmdbLookup('Anbil Avan', 2026, { key: '', http }), null);
    assert.strictEqual(http.calls.length, 0);
});

const asyncTests = [];
const atest = (name, fn) => asyncTests.push([name, fn]);

atest('TMDB: lookup builds poster, runtime, director, genres', async () => {
    const http = fakeHttp([{ id: 7, title: 'Anbil Avan', release_date: '2026-10-02' }], DETAIL);
    const r = await tmdbLookup('Anbil Avan (2026) Sinhala Subtitles | සිංහල', null, { key: 'abc123', http });
    assert.strictEqual(r.image, 'https://image.tmdb.org/t/p/w780/p.jpg');
    assert.strictEqual(r.runtime, '2h 38m');
    assert.strictEqual(r.rating, '7.0');
    assert.deepStrictEqual(r.directors, ['R. Kaarthikeyan']);
    assert.strictEqual(http.calls[0].o.params.api_key, 'abc123');
    assert.strictEqual(http.calls[0].o.params.query, 'Anbil Avan');
});

atest('TMDB: v4 token is sent as a Bearer header', async () => {
    const http = fakeHttp([{ id: 7, release_date: '2026-10-02' }], DETAIL);
    await tmdbLookup('Anbil Avan', 2026, { key: 'eyJhbGciOi.fake.token', http });
    assert.strictEqual(http.calls[0].o.headers.Authorization, 'Bearer eyJhbGciOi.fake.token');
    assert.strictEqual(http.calls[0].o.params.api_key, undefined);
});

atest('TMDB: year is sent to TMDB and a retry without year still rejects wrong years', async () => {
    const http = fakeHttp([{ id: 1, release_date: '2017-09-09' }], DETAIL);
    assert.strictEqual(await tmdbLookup('The Third Murder (2026)', null, { key: 'k', http }), null);
    const searches = http.calls.filter(c => c.url.endsWith('/search/movie'));
    assert.strictEqual(searches.length, 2);
    assert.strictEqual(searches[0].o.params.year, 2026);
    assert.strictEqual(searches[1].o.params.year, undefined);
});

atest('TMDB: backdrop image option', async () => {
    const http = fakeHttp([{ id: 7, release_date: '2026-10-02' }], DETAIL);
    const r = await tmdbLookup('Anbil Avan', 2026, { key: 'k', http, imageType: 'backdrop' });
    assert.ok(r.image.endsWith('/b.jpg'));
});

atest('TMDB: wrong-year match is rejected (no wrong movie on the card)', async () => {
    const http = fakeHttp([{ id: 1, title: 'The Third Murder', release_date: '2017-09-09' }], DETAIL);
    assert.strictEqual(await tmdbLookup('The Third Murder (2026)', null, { key: 'k', http }), null);
});

atest('TMDB: network error -> null (bot falls back to the old card)', async () => {
    const http = { get: async () => { throw new Error('boom'); } };
    assert.strictEqual(await tmdbLookup('Anbil Avan', 2026, { key: 'k', http }), null);
});

atest('TMDB: list card (boxed style) stays under 1000 chars and lists numbered qualities', async () => {
    const http = fakeHttp([{ id: 7, release_date: '2026-10-02' }], DETAIL);
    const info = await tmdbLookup('Anbil Avan', 2026, { key: 'k', http });
    const footer = '🌸 Powered by MIZUKI MD\n✦Created by ᴹᴵᶻᵁᴷᴵ ᴹᴰ TEAM';
    const card = tmdbListCard(info, { name: 'MIZUKI MD', footer, qualities: ['WEB-DL 480p • 800 MB', 'WEB-DL 720p • 1.6 GB', 'WEB-DL 1080p • 3.3 GB'] });
    assert.ok(card.length <= 1000, `caption is ${card.length} chars`);
    assert.ok(card.startsWith('╭━━〔 🌸 MIZUKI MD 〕━━╮'));
    assert.ok(card.includes('〔 1 〕 WEB-DL 480p • 800 MB') && card.includes('〔 3 〕 WEB-DL 1080p • 3.3 GB'));
    assert.ok(card.includes('🎥 Director : R. Kaarthikeyan') && card.includes('⏳ Runtime : 2h 38m') && card.includes('📆 Release : 02 October 2026'));
    assert.ok(card.includes('🎭 Genre : Romance | Thriller') && card.includes('⭐ Rating : 7.0/10'));
    assert.ok(card.includes('MOVIE SYNOPSIS') && card.includes('Reply 0 for Movie Details Card') && card.includes('Reply 1*'));
    // details card (reply "0"): no quality list, has cast, can show who requested
    const det = tmdbCard(info, { name: 'MIZUKI MD', requestedBy: '@9477' });
    assert.ok(!det.includes('AVAILABLE QUALITIES') && det.includes('🌟 Cast : A, B') && det.includes('Requested by:* @9477'));
});

(async () => {
    for (const [name, fn] of asyncTests) { await fn(); passed++; console.log('✔', name); }
    console.log(`\n${passed} tests passed`);
})().catch(e => { console.error('✖ FAILED:', e.message); process.exit(1); });

test('.cz quality list accepts "0" and "N*" (extras)', () => {
    assert.ok(pairSrc.includes('tmdbListCard(tmdb'));
    assert.ok(pairSrc.includes('{ extras: !!tmdb }'));
});

const panel = require('../lib/panel');
test('panel: only Language, Mode and Prefix; mode/prefix/lang apply and validate', () => {
    assert.deepStrictEqual(Object.keys(panel.ITEMS), ['1.1', '1.2', '1.3']);
    const cfg = panel.makeDefaults({ PREFIX: '.' });
    assert.strictEqual(cfg.MODE, 'public');
    for (const [v, m] of [['private', 'private'], ['inbox', 'inbox'], ['dm', 'inbox'], ['groups', 'group'], ['reset', 'public']]) {
        assert.ok(panel.applySetting(cfg, '1.2', v).ok); assert.strictEqual(cfg.MODE, m);
    }
    assert.ok(!panel.applySetting(cfg, '1.2', 'banana').ok);
    assert.ok(panel.applySetting(cfg, '1.3', '!').ok); assert.strictEqual(cfg.PREFIX, '!');
    assert.ok(!panel.applySetting(cfg, '1.3', 'abcd').ok);
    assert.ok(panel.applySetting(cfg, '1.1', 'si').ok); assert.strictEqual(cfg.LANG, 'si');
    assert.ok(!panel.applySetting(cfg, '2.1', 'x').ok);
    assert.strictEqual(panel.normalize({ MODE: 'inbox' }).MODE, 'inbox');
    assert.strictEqual(panel.normalize({ MODE: 'zzz' }).MODE, 'public');
    const text = panel.buildPanel(cfg);
    assert.ok(text.includes('1.1') && text.includes('1.2') && text.includes('1.3') && !text.includes('4.1'));
});
