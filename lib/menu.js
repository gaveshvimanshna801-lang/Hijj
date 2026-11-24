/**
 * Menu: a registry of the bot's REAL commands + builders for the menu text.
 *
 * Rules (so the menu never lists a fake command):
 *  - every name here must exist as a `case '<name>':` in pair.js (checked by test/menu.test.js)
 *  - only names the bot will actually answer right now are shown:
 *      MB-only mode, banned commands, Owner/Sudo-only commands and
 *      missing optional dependencies (puppeteer) are all taken into account.
 */

const { t, LANGS, DEFAULT_LANG } = require('./lang');

// names[0] = main name, the rest are aliases. `key` -> lang string "cmd.<key>".
const CATEGORIES = [
    {
        id: 'movies', icon: '🎬',
        commands: [
            { key: 'mb', names: ['mb', 'moviebox'], args: '<name>' },
            { key: 'cz', names: ['cz', 'cinesubz'], args: '<name>' },
            { key: 'cartoon', names: ['cartoon', 'cartoons', 'ct'], args: '<name>' },
            { key: 'movie', names: ['movie', 'kmmovies', 'km'], args: '<name>' },
            { key: 'ss', names: ['ss', 'sinhalasub'], args: '<name>' },
            { key: 'ss2', names: ['ss2'], args: '<name>', requires: 'puppeteer' }
        ]
    },
    {
        id: 'download', icon: '⬇️',
        commands: [
            { key: 'song', names: ['song', 'ytmp3', 'yta'], args: '<name | link>' },
            { key: 'video', names: ['video', 'ytmp4', 'ytv'], args: '<name | link>' },
            { key: 'fb', names: ['fb', 'facebook', 'fbdownload'], args: '<link>' },
            { key: 'tiktok', names: ['tiktok', 'tt'], args: '<link>' }
        ]
    },
    {
        id: 'study', icon: '📚',
        commands: [
            { key: 'pastpaper', names: ['pastpaper', 'pp'], args: '<grade subject>' },
            { key: 'pastdl', names: ['pastdl'], args: '<link>' }
        ]
    },
    {
        id: 'tools', icon: '🧰',
        commands: [
            { key: 'ping', names: ['ping'] },
            { key: 'alive', names: ['alive'] },
            { key: 'runtime', names: ['runtime'] },
            { key: 'time', names: ['time'] },
            { key: 'date', names: ['date'] },
            { key: 'id', names: ['id'] },
            { key: 'jid', names: ['jid'], adminOnly: true },
            { key: 'owner', names: ['owner'] },
            { key: 'repeat', names: ['repeat'], args: '<text>' },
            { key: 'calc', names: ['calc'], args: '<2+2*3>' },
            { key: 'flip', names: ['flip'] },
            { key: 'dice', names: ['dice'] },
            { key: 'group', names: ['group'] },
            { key: 'forward', names: ['forward', 'forword', 'fwd'], args: '<jid>', adminOnly: true },
            { key: 'pair', names: ['pair'], args: '<number>' }
        ]
    },
    {
        id: 'settings', icon: '⚙️',
        commands: [
            { key: 'settings', names: ['settings', 'set', 'setting', 'panel', 'control'], adminOnly: true },
            { key: 'lang', names: ['lang', 'language'], args: '<en | si>', adminOnly: true }
        ]
    }
];

/** Every command name the menu can mention (used by the test). */
const allMenuNames = () => CATEGORIES.flatMap(c => c.commands.flatMap(x => x.names));

/**
 * ctx: {
 *   lang, prefix, canAdmin,
 *   mbOnly, allowed[]      - MB-only mode and its allow-list
 *   banned[]               - banned commands (Owner/Sudo can still use them)
 *   hasPuppeteer           - optional dependency present?
 *   mbLimit, mbRequestJid  - for the movie notes
 * }
 */
function usableNames(cmd, ctx) {
    if (cmd.adminOnly && !ctx.canAdmin) return [];
    if (cmd.requires === 'puppeteer' && !ctx.hasPuppeteer) return [];
    return cmd.names.filter(n => {
        if (ctx.mbOnly && !ctx.allowed.includes(n)) return false;
        if (!ctx.canAdmin && ctx.banned.includes(n)) return false;
        return true;
    });
}

/** Categories that have at least one usable command, with the usable names filled in. */
function getCategories(ctx) {
    const out = [];
    for (const cat of CATEGORIES) {
        const cmds = [];
        for (const cmd of cat.commands) {
            const names = usableNames(cmd, ctx);
            if (names.length) cmds.push({ ...cmd, names });
        }
        if (cmds.length) out.push({ id: cat.id, icon: cat.icon, cmds });
    }
    return out;
}

/** Find a category from "2" / "movies" / "movie commands" typed by the user. */
function findCategory(cats, input) {
    const v = String(input || '').trim().toLowerCase();
    if (!v) return null;
    if (/^\d+$/.test(v)) return cats[parseInt(v, 10) - 1] || null;
    return cats.find(c => c.id === v) || null;
}

function buildMainMenu(ctx, info, cats = getCategories(ctx)) {
    const L = (k, v) => t(ctx.lang, k, v);
    const lg = LANGS[ctx.lang] || LANGS[DEFAULT_LANG];
    const lines = [];

    lines.push(`*${info.botName}*`);
    lines.push('');
    lines.push(L('menu.hi', { name: info.name }));
    lines.push('');
    lines.push(`╭──「 *${L('menu.botMenu')}* 」`);
    lines.push(`│ 🤖 ${L('menu.bot')} : ${info.botName}`);
    lines.push(`│ 👤 ${L('menu.user')} : ${info.name}`);
    lines.push(`│ ☎️ ${L('menu.owner')} : wa.me/${info.owner}`);
    lines.push(`│ ⏰ ${L('menu.uptime')} : ${info.uptime}`);
    lines.push(`│ 📂 ${L('menu.ram')} : ${info.ramMb} MB`);
    lines.push(`│ ✏️ ${L('menu.prefix')} : ${ctx.prefix}`);
    lines.push(`│ 🌐 ${L('menu.language')} : ${lg.flag} ${lg.native}`);
    lines.push('╰──────────────●●▸');
    lines.push('');

    if (!cats.length) {
        lines.push(L('menu.empty'));
        return lines.join('\n');
    }

    lines.push(`*${L('menu.select')}*`);
    lines.push('');
    cats.forEach((c, i) => lines.push(`*${i + 1}* | ${c.icon} ${L('cat.' + c.id)}`));
    lines.push('');
    lines.push(L('menu.replyHint', { max: cats.length }));
    return lines.join('\n');
}

function buildCategory(ctx, cat) {
    const L = (k, v) => t(ctx.lang, k, v);
    const P = ctx.prefix;
    const lines = [];

    lines.push(`╭──「 ${cat.icon} *${L('cat.' + cat.id)}* 」`);
    for (const c of cat.cmds) {
        const [main, ...aliases] = c.names;
        lines.push('│');
        lines.push(`│ *${P}${main}*${c.args ? ' ' + c.args : ''}`);
        lines.push(`│   ${L('cmd.' + c.key)}`);
        if (aliases.length) lines.push(`│   _(${L('menu.also')}: ${aliases.map(a => P + a).join(', ')})_`);
    }
    lines.push('│');
    lines.push('╰──────────────●●▸');

    if (cat.id === 'movies' && cat.cmds.some(c => ['mb', 'cz', 'cartoon'].includes(c.key))) {
        lines.push('');
        lines.push(ctx.mbLimit > 0 ? L('note.limit', { n: ctx.mbLimit }) : L('note.unlimited'));
        if (ctx.mbRequestJid && !ctx.canAdmin && cat.cmds.some(c => c.key === 'mb')) lines.push(L('note.reqGroup'));
    }

    lines.push('');
    lines.push(L('menu.back', { prefix: P }));
    return lines.join('\n');
}

module.exports = {
    CATEGORIES,
    allMenuNames,
    usableNames,
    getCategories,
    findCategory,
    buildMainMenu,
    buildCategory
};
