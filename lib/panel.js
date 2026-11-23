/**
 * MIZUKI MD - Control Panel
 * Per-number settings: defaults, panel text, validation and apply logic.
 */

const { DEFAULT_LANG, LANGS, resolveLang, isLang } = require('./lang');

const PROTECTED_COMMANDS = ['settings', 'setting', 'panel', 'control', 'set'];
const DEFAULT_NAME = 'MIZUKI MD';
const DEFAULT_FOOTER = '🌸 Powered by MIZUKI MD\n✦Created by ᴹᴵᶻᵁᴷᴵ ᴹᴰ TEAM';
const DEFAULT_MB_REQUEST_JID = '120363432797199893@g.us';
const DEFAULT_MB_UPLOAD_JID = '120363430077737893@g.us';
const DEFAULT_MB_LIMIT = 3;

/** Footer block for the bottom of a message: boxed (multi-line) footers go in as they are. */
function footerBlock(f) {
    const t = String(f || '');
    return t.includes('\n') ? t : `>    ${t}`;
}

/** Who can use the bot: public = everyone, private = Owner/Sudo only, inbox = private chats only, group = groups only */
const MODES = ['public', 'private', 'inbox', 'group'];

const DEFAULT_ALIVE = '✅ Bot online & working!\n\n⏱️ Runtime: {runtime}\n🔰 Prefix: {prefix}';

function makeDefaults(base = {}) {
    return {
        BOT_NAME: base.BOT_NAME || DEFAULT_NAME,
        BOT_FOOTER: base.BOT_FOOTER || DEFAULT_FOOTER,
        RCD_IMAGE_PATH: base.RCD_IMAGE_PATH || '',
        ALIVE_MSG: DEFAULT_ALIVE,
        WELCOME_MSG: '',
        PREFIX: base.PREFIX || '.',
        LANG: isLang(base.LANG) ? base.LANG : DEFAULT_LANG,
        MODE: MODES.includes(base.MODE) ? base.MODE : 'public',
        SUDO: [],
        ANTILINK: { mode: 'off', warns: 3 },
        BANNED_GROUPS: [],
        BANNED_COMMANDS: [],
        MB_DAILY_LIMIT: Number.isInteger(base.MB_DAILY_LIMIT) ? base.MB_DAILY_LIMIT : DEFAULT_MB_LIMIT,
        MB_REQUEST_JID: typeof base.MB_REQUEST_JID === 'string' ? base.MB_REQUEST_JID : DEFAULT_MB_REQUEST_JID,
        MB_UPLOAD_JID: typeof base.MB_UPLOAD_JID === 'string' ? base.MB_UPLOAD_JID : DEFAULT_MB_UPLOAD_JID
    };
}

const PANEL_KEYS = Object.keys(makeDefaults());

const toArray = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    if (v && typeof v === 'object') return Object.values(v).filter(Boolean).map(String);
    return [];
};

/** Merge saved (Firebase) data over defaults, accepting only valid values. */
function normalize(saved, base) {
    const cfg = makeDefaults(base);
    if (!saved || typeof saved !== 'object') return cfg;

    for (const k of ['BOT_NAME', 'BOT_FOOTER', 'RCD_IMAGE_PATH', 'ALIVE_MSG', 'WELCOME_MSG']) {
        if (typeof saved[k] === 'string' && (saved[k] || k === 'WELCOME_MSG')) cfg[k] = saved[k];
    }
    if (typeof saved.PREFIX === 'string' && saved.PREFIX.length >= 1 && saved.PREFIX.length <= 3) {
        cfg.PREFIX = saved.PREFIX;
    }
    if (isLang(saved.LANG)) cfg.LANG = saved.LANG;
    if (MODES.includes(saved.MODE)) cfg.MODE = saved.MODE;
    cfg.SUDO = toArray(saved.SUDO);
    cfg.BANNED_GROUPS = toArray(saved.BANNED_GROUPS);
    cfg.BANNED_COMMANDS = toArray(saved.BANNED_COMMANDS);

    const lim = parseInt(saved.MB_DAILY_LIMIT, 10);
    if (lim >= 0 && lim <= 100) cfg.MB_DAILY_LIMIT = lim;
    for (const k of ['MB_REQUEST_JID', 'MB_UPLOAD_JID']) {
        if (typeof saved[k] === 'string' && (saved[k] === '' || /^\d[\d-]*@g\.us$/.test(saved[k]))) cfg[k] = saved[k];
    }

    const al = saved.ANTILINK;
    if (al && typeof al === 'object' && ['off', 'delete', 'warn', 'kick'].includes(al.mode)) {
        const w = parseInt(al.warns, 10);
        cfg.ANTILINK = { mode: al.mode, warns: w >= 1 && w <= 10 ? w : 3 };
    }
    return cfg;
}

function pickPanel(cfg) {
    const out = {};
    for (const k of PANEL_KEYS) out[k] = cfg[k];
    return out;
}

/** Replace {placeholders} in a template. Unknown placeholders are left untouched. */
function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Baileys media source for the logo: URL or an uploaded image stored as a data URI. */
function logoSource(cfg) {
    const v = cfg.RCD_IMAGE_PATH || '';
    if (v.startsWith('data:')) return Buffer.from(v.split(',')[1] || '', 'base64');
    return { url: v };
}

const short = (s, n = 38) => {
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/* ------------------------------------------------------------------ */
/*  Menu items                                                         */
/* ------------------------------------------------------------------ */

const ITEMS = {
    '1.1': { label: 'Language Change' },
    '1.2': { label: 'Mode (Public / Private / Inbox / Group)' },
    '1.3': { label: 'Prefix Change' }
};

const SECTIONS = [
    { title: '🛠️ SETTINGS', ids: ['1.1', '1.2', '1.3'] }
];

const MODE_LABEL = {
    public: '🌍 Public (everyone)',
    private: '🔒 Private (Owner / Sudo only)',
    inbox: '📩 Inbox only (private chats)',
    group: '👥 Group only'
};

function currentValue(id, cfg) {
    switch (id) {
        case '1.1': return `${LANGS[cfg.LANG].flag} ${LANGS[cfg.LANG].native}`;
        case '1.2': return MODE_LABEL[cfg.MODE] || MODE_LABEL.public;
        case '1.3': return cfg.PREFIX;
        default: return '';
    }
}

function buildPanel(cfg) {
    const lines = [];
    lines.push('╭━━━━━━━━━━━━━━━━━━━━╮');
    lines.push('┃ ⚙️ *Mizuki MD Control Panel*');
    lines.push('╰━━━━━━━━━━━━━━━━━━━━╯');

    for (const sec of SECTIONS) {
        lines.push('');
        lines.push('`' + sec.title + '`');
        for (const id of sec.ids) {
            lines.push(`*${id} | ${ITEMS[id].label}*`);
            lines.push(`   ◦ _${currentValue(id, cfg)}_`);
        }
    }

    lines.push('');
    lines.push('📩 *Reply with a number* (eg: *1.1*) to change that setting.');
    lines.push(`⚡ Quick: *${cfg.PREFIX}set 1.2 private*  |  *${cfg.PREFIX}set 1.3 !*`);
    lines.push('');
    lines.push(footerBlock(cfg.BOT_FOOTER));
    return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Prompts shown after the user picks a number                        */
/* ------------------------------------------------------------------ */

function buildPrompt(id, cfg) {
    const head = `⚙️ *${id} | ${ITEMS[id].label}*\n◦ Current: _${currentValue(id, cfg)}_\n\n`;
    const tail = '\n\n✖️ Send *cancel* to abort.';
    switch (id) {
        case '1.1':
            return head + `🌐 Send the language code:\n\n${Object.entries(LANGS).map(([c, l]) => `• \`${c}\` – ${l.flag} ${l.native}`).join('\n')}\n\nSend *reset* for English.` + tail;
        case '1.2':
            return head + '🔀 Who can use the bot? Send one of:\n\n• `public` – everyone (default)\n• `private` – only Owner / Sudo\n• `inbox` – only private chats (inbox)\n• `group` – only groups\n\nOwner / Sudo can always use the bot.' + tail;
        case '1.3':
            return head + `✏️ Send the *new prefix* (1–3 characters, no spaces).\nEg: \`!\` or \`/\` or \`#\`\nSend *reset* for \`.\`` + tail;
        default:
            return head + 'Send the new value.' + tail;
    }
}

/* ------------------------------------------------------------------ */
/*  Apply                                                              */
/* ------------------------------------------------------------------ */

const ok = (text) => ({ ok: true, text });
const fail = (text) => ({ ok: false, text: `❌ ${text}` });

const isReset = (v) => /^(reset|default)$/i.test(v);

/**
 * Apply one setting. Mutates cfg in place.
 * Returns { ok, text }
 */
function applySetting(cfg, id, rawInput) {
    const raw = String(rawInput || '').trim();
    if (!ITEMS[id]) return fail('Unknown setting number.');
    if (!raw) return fail('Value missing.');

    const defaults = makeDefaults();

    switch (id) {
        case '1.1': {
            const code = isReset(raw) ? DEFAULT_LANG : resolveLang(raw);
            if (!code) return fail(`Unknown language. Use: ${Object.keys(LANGS).join(', ')}`);
            cfg.LANG = code;
            return ok(`✅ Language changed to ${LANGS[code].flag} ${LANGS[code].native}\n💡 Try ${cfg.PREFIX}menu`);
        }
        case '1.2': {
            const v = raw.toLowerCase();
            const mode = isReset(v) || ['public', 'all', 'everyone'].includes(v) ? 'public'
                : ['private', 'owner', 'self'].includes(v) ? 'private'
                : ['inbox', 'dm', 'pm', 'private chat', 'chat'].includes(v) ? 'inbox'
                : ['group', 'groups'].includes(v) ? 'group'
                : null;
            if (!mode) return fail('Use: public / private / inbox / group');
            cfg.MODE = mode;
            return ok(`✅ Mode changed\n◦ ${MODE_LABEL[mode]}`);
        }
        case '1.3': {
            const pr = isReset(raw) ? defaults.PREFIX : raw;
            if (/\s/.test(pr) || pr.length < 1 || pr.length > 3) {
                return fail('Prefix must be 1–3 characters with no spaces.');
            }
            cfg.PREFIX = pr;
            return ok(`✅ Prefix changed to *${pr}*\n💡 Now use: ${pr}menu`);
        }
    }
    return fail('Unknown setting number.');
}

module.exports = {
    PANEL_KEYS,
    PROTECTED_COMMANDS,
    ITEMS,
    MODES,
    makeDefaults,
    normalize,
    pickPanel,
    fill,
    logoSource,
    buildPanel,
    buildPrompt,
    applySetting,
    footerBlock
};
