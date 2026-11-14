/**
 * MINSOO MD - Control Panel
 * Per-number settings: defaults, panel text, validation and apply logic.
 */

const PROTECTED_COMMANDS = ['settings', 'setting', 'panel', 'control', 'set'];
const DEFAULT_ALIVE = '✅ Bot online & working!\n\n⏱️ Runtime: {runtime}\n🔰 Prefix: {prefix}';

function makeDefaults(base = {}) {
    return {
        BOT_NAME: base.BOT_NAME || 'MINSOO MD🇯🇵',
        BOT_FOOTER: base.BOT_FOOTER || 'Powerd By Minsoo Md V1🇯🇵',
        RCD_IMAGE_PATH: base.RCD_IMAGE_PATH || '',
        ALIVE_MSG: DEFAULT_ALIVE,
        WELCOME_MSG: '',
        PREFIX: base.PREFIX || '.',
        SUDO: [],
        ANTILINK: { mode: 'off', warns: 3 },
        BANNED_GROUPS: [],
        BANNED_COMMANDS: []
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
    cfg.SUDO = toArray(saved.SUDO);
    cfg.BANNED_GROUPS = toArray(saved.BANNED_GROUPS);
    cfg.BANNED_COMMANDS = toArray(saved.BANNED_COMMANDS);

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
    '1.1': { label: 'Set Bot Name' },
    '1.2': { label: 'Set Bot Logo' },
    '1.3': { label: 'Set Bot Footer' },
    '1.4': { label: 'Set Alive Message' },
    '1.5': { label: 'Set Group Welcome Msg' },
    '2.1': { label: 'Set Command Prefix' },
    '3.1': { label: 'Set Sudo Number' },
    '3.2': { label: 'Set Anti-Link Values' },
    '3.3': { label: 'Set Banned Groups' },
    '3.4': { label: 'Set Banned Commands' }
};

const SECTIONS = [
    { title: '🆔 BOT IDENTITY & APPEARANCE', ids: ['1.1', '1.2', '1.3', '1.4', '1.5'] },
    { title: '🛠️ CORE FUNCTIONALITY', ids: ['2.1'] },
    { title: '🛡️ SECURITY & ADMIN', ids: ['3.1', '3.2', '3.3', '3.4'] }
];

function currentValue(id, cfg) {
    switch (id) {
        case '1.1': return cfg.BOT_NAME;
        case '1.2': return cfg.RCD_IMAGE_PATH.startsWith('data:') ? 'Custom image (uploaded)' : short(cfg.RCD_IMAGE_PATH, 34);
        case '1.3': return cfg.BOT_FOOTER;
        case '1.4': return cfg.ALIVE_MSG === DEFAULT_ALIVE ? 'Default' : short(cfg.ALIVE_MSG);
        case '1.5': return cfg.WELCOME_MSG ? short(cfg.WELCOME_MSG) : 'OFF';
        case '2.1': return cfg.PREFIX;
        case '3.1': return cfg.SUDO.length ? `${cfg.SUDO.length} number(s)` : 'None';
        case '3.2': {
            const a = cfg.ANTILINK;
            if (a.mode === 'off') return 'OFF';
            return a.mode === 'warn' ? `ON • warn (${a.warns} warns → kick)` : `ON • ${a.mode}`;
        }
        case '3.3': return cfg.BANNED_GROUPS.length ? `${cfg.BANNED_GROUPS.length} group(s)` : 'None';
        case '3.4': return cfg.BANNED_COMMANDS.length ? short(cfg.BANNED_COMMANDS.join(', ')) : 'None';
        default: return '';
    }
}

function buildPanel(cfg) {
    const lines = [];
    lines.push('╭━━━━━━━━━━━━━━━━━━━━╮');
    lines.push('┃ ⚙️ *Minsoo MD Control Panel*');
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
    lines.push(`⚡ Quick: *${cfg.PREFIX}set 1.1 New Name*`);
    lines.push('');
    lines.push(`>    ${cfg.BOT_FOOTER}`);
    return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Prompts shown after the user picks a number                        */
/* ------------------------------------------------------------------ */

function buildPrompt(id, cfg) {
    const P = cfg.PREFIX;
    const head = `⚙️ *${id} | ${ITEMS[id].label}*\n◦ Current: _${currentValue(id, cfg)}_\n\n`;
    const tail = '\n\n✖️ Send *cancel* to abort.';
    switch (id) {
        case '1.1':
            return head + '✏️ Send the *new bot name*.\nEg: `MINSOO MD🇯🇵`\nSend *reset* for default.' + tail;
        case '1.2':
            return head + '🖼️ Send an *image* (photo) or an *image link* (https://...).\nSend *reset* to use the default logo.' + tail;
        case '1.3':
            return head + '✏️ Send the *new footer text*.\nEg: `Powerd By Minsoo Md V1🇯🇵`\nSend *reset* for default.' + tail;
        case '1.4':
            return head + '✏️ Send the *new alive message*.\n\nVariables:\n• {name} – bot name\n• {runtime} – uptime\n• {time} – Sri Lanka time\n• {date} – today date\n• {prefix} – prefix\n\nSend *reset* for default.' + tail;
        case '1.5':
            return head + '✏️ Send the *group welcome message*.\n\nVariables:\n• {user} – new member (tag)\n• {group} – group name\n• {count} – member count\n• {desc} – group description\n• {time} – time\n\nSend *off* to disable welcome.' + tail;
        case '2.1':
            return head + `✏️ Send the *new prefix* (1–3 characters, no spaces).\nEg: \`!\` or \`/\` or \`#\`\nSend *reset* for \`.\`` + tail;
        case '3.1':
            return head + `👑 Sudo users can use this panel too.\n\n• \`add 94771234567\`\n• \`remove 94771234567\`\n• \`list\`\n• \`clear\`\n\n(Sending just a number = add)` + tail;
        case '3.2':
            return head + '🔗 Send one of:\n\n• `off` – disable\n• `delete` – delete the link message\n• `warn 3` – delete + warn, kick after 3 warns\n• `kick` – delete + remove sender\n\n⚠️ Bot must be *group admin*. Admins / sudo are ignored.' + tail;
        case '3.3':
            return head + `🚫 Bot ignores everyone in banned groups.\n\n• \`add here\` – ban the current group\n• \`add 1203630...@g.us\`\n• \`remove here\` / \`remove <id>\`\n• \`list\`\n• \`clear\`\n\n(Use ${P}id inside a group to get its ID)` + tail;
        case '3.4':
            return head + `🚫 Disabled commands only work for Owner/Sudo.\n\n• \`add ping\`\n• \`remove ping\`\n• \`list\`\n• \`clear\`\n\n(Sending just a command name = add)` + tail;
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

function listCommand(raw) {
    const m = raw.trim().match(/^(add|remove|rm|del|delete|list|clear)\b\s*([\s\S]*)$/i);
    if (!m) return { action: 'add', arg: raw.trim() };
    let action = m[1].toLowerCase();
    if (['rm', 'del', 'delete'].includes(action)) action = 'remove';
    return { action, arg: m[2].trim() };
}

function applyList(cfg, field, label, raw, normalizeItem, display) {
    const { action, arg } = listCommand(raw);
    const list = cfg[field];

    if (action === 'list') {
        return ok(list.length
            ? `📋 *${label}* (${list.length})\n\n${list.map((x, i) => `${i + 1}. ${display(x)}`).join('\n')}`
            : `📋 *${label}*\n\nList is empty.`);
    }
    if (action === 'clear') {
        cfg[field] = [];
        return ok(`🧹 *${label}* cleared.`);
    }
    if (!arg) return fail('Value missing.');

    const r = normalizeItem(arg);
    if (r.error) return fail(r.error);

    if (action === 'add') {
        if (list.includes(r.value)) return fail(`${display(r.value)} is already in the list.`);
        list.push(r.value);
        return ok(`✅ Added: ${display(r.value)}\n📋 Total: ${list.length}`);
    }
    const idx = list.indexOf(r.value);
    if (idx === -1) return fail(`${display(r.value)} is not in the list.`);
    list.splice(idx, 1);
    return ok(`🗑️ Removed: ${display(r.value)}\n📋 Total: ${list.length}`);
}

/**
 * Apply one setting. Mutates cfg in place.
 * ctx: { from, isGroup }
 * Returns { ok, text }
 */
function applySetting(cfg, id, rawInput, ctx = {}) {
    const raw = String(rawInput || '').trim();
    if (!ITEMS[id]) return fail('Unknown setting number.');
    if (!raw) return fail('Value missing.');

    const defaults = makeDefaults();

    switch (id) {
        case '1.1': {
            if (isReset(raw)) cfg.BOT_NAME = defaults.BOT_NAME;
            else if (raw.length > 40) return fail('Name is too long (max 40 characters).');
            else cfg.BOT_NAME = raw;
            return ok(`✅ Bot name updated\n◦ ${cfg.BOT_NAME}`);
        }
        case '1.2': {
            if (isReset(raw)) {
                cfg.RCD_IMAGE_PATH = ctx.defaultLogo || '';
                return ok('✅ Logo reset to default.');
            }
            if (!/^https?:\/\/\S+$/i.test(raw) && !/^data:image\//i.test(raw)) {
                return fail('Send an image or a valid https link.');
            }
            cfg.RCD_IMAGE_PATH = raw;
            return ok('✅ Bot logo updated.');
        }
        case '1.3': {
            if (isReset(raw)) cfg.BOT_FOOTER = defaults.BOT_FOOTER;
            else if (raw.length > 80) return fail('Footer is too long (max 80 characters).');
            else cfg.BOT_FOOTER = raw;
            return ok(`✅ Footer updated\n◦ ${cfg.BOT_FOOTER}`);
        }
        case '1.4': {
            if (isReset(raw)) cfg.ALIVE_MSG = DEFAULT_ALIVE;
            else if (raw.length > 1000) return fail('Message is too long (max 1000 characters).');
            else cfg.ALIVE_MSG = raw;
            return ok(`✅ Alive message updated\n\n${cfg.ALIVE_MSG}\n\n💡 Test it with ${cfg.PREFIX}alive`);
        }
        case '1.5': {
            if (/^(off|disable|reset|none)$/i.test(raw)) {
                cfg.WELCOME_MSG = '';
                return ok('✅ Group welcome message *disabled*.');
            }
            if (raw.length > 1000) return fail('Message is too long (max 1000 characters).');
            cfg.WELCOME_MSG = raw;
            return ok(`✅ Group welcome message updated\n\n${cfg.WELCOME_MSG}`);
        }
        case '2.1': {
            const p = isReset(raw) ? defaults.PREFIX : raw;
            if (/\s/.test(p) || p.length < 1 || p.length > 3) {
                return fail('Prefix must be 1–3 characters with no spaces.');
            }
            cfg.PREFIX = p;
            return ok(`✅ Prefix changed to *${p}*\n💡 Now use: ${p}menu`);
        }
        case '3.1': {
            return applyList(cfg, 'SUDO', 'Sudo Numbers', raw, (a) => {
                const n = a.replace(/[^0-9]/g, '');
                if (n.length < 7 || n.length > 15) return { error: 'Invalid number. Use full number with country code (eg: 94771234567).' };
                return { value: n };
            }, (n) => `wa.me/${n}`);
        }
        case '3.2': {
            const t = raw.toLowerCase().split(/\s+/);
            const mode = t[0];
            if (mode === 'off' || mode === 'disable') {
                cfg.ANTILINK = { mode: 'off', warns: cfg.ANTILINK.warns };
                return ok('✅ Anti-Link *disabled*.');
            }
            if (!['on', 'delete', 'warn', 'kick'].includes(mode)) {
                return fail('Use: off / delete / warn 3 / kick');
            }
            const m = mode === 'on' ? 'delete' : mode;
            let warns = cfg.ANTILINK.warns || 3;
            if (m === 'warn' && t[1]) {
                const w = parseInt(t[1], 10);
                if (!(w >= 1 && w <= 10)) return fail('Warn limit must be 1–10.');
                warns = w;
            }
            cfg.ANTILINK = { mode: m, warns };
            const desc = m === 'delete' ? 'Link messages will be deleted.'
                : m === 'kick' ? 'Sender will be deleted + removed.'
                : `Link deleted + warning. Kick after *${warns}* warns.`;
            return ok(`✅ Anti-Link *ON* (${m})\n◦ ${desc}\n⚠️ Bot must be group admin.`);
        }
        case '3.3': {
            return applyList(cfg, 'BANNED_GROUPS', 'Banned Groups', raw, (a) => {
                if (/^here$/i.test(a)) {
                    if (!ctx.isGroup) return { error: 'Use "here" inside a group, or send a group ID.' };
                    return { value: ctx.from };
                }
                if (/^\d[\d-]*@g\.us$/.test(a)) return { value: a };
                if (/^\d[\d-]{8,}$/.test(a)) return { value: `${a}@g.us` };
                return { error: 'Invalid group ID. Use "here" or an ID like 1203630...@g.us' };
            }, (g) => g);
        }
        case '3.4': {
            return applyList(cfg, 'BANNED_COMMANDS', 'Banned Commands', raw, (a) => {
                const c = a.replace(new RegExp('^' + escapeRegExp(cfg.PREFIX)), '').toLowerCase();
                if (!/^[a-z0-9]+$/.test(c)) return { error: 'Invalid command name.' };
                if (PROTECTED_COMMANDS.includes(c)) return { error: `"${c}" cannot be banned.` };
                return { value: c };
            }, (c) => `${cfg.PREFIX}${c}`);
        }
    }
    return fail('Unknown setting number.');
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    PANEL_KEYS,
    PROTECTED_COMMANDS,
    ITEMS,
    makeDefaults,
    normalize,
    pickPanel,
    fill,
    logoSource,
    buildPanel,
    buildPrompt,
    applySetting
};
