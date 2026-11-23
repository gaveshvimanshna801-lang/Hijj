/**
 * Language support (menu + language command).
 * To add a language: add an entry to LANGS and a matching block in STR
 * (any missing key falls back to English).
 */

const DEFAULT_LANG = 'en';

const LANGS = {
    en: { name: 'English', native: 'English', flag: '🇬🇧', aliases: ['en', 'eng', 'english'] },
    si: { name: 'Sinhala', native: 'සිංහල', flag: '🇱🇰', aliases: ['si', 'sin', 'sinhala', 'සිංහල'] }
};

const STR = {
    en: {
        'menu.botMenu': "BOT'S MENU",
        'menu.hi': '👋 Hi {name}',
        'menu.bot': 'Bot',
        'menu.user': 'User',
        'menu.owner': 'Owner',
        'menu.uptime': 'Uptime',
        'menu.ram': 'RAM',
        'menu.prefix': 'Prefix',
        'menu.language': 'Language',
        'menu.select': '🎀 Select a category:',
        'menu.replyHint': '↩️ Reply to this message with a number (1-{max}).',
        'menu.back': '↩️ Send {prefix}menu to go back.',
        'menu.invalid': '⚠️ Invalid choice! Send a number from 1 to {max}.',
        'menu.empty': 'No commands are available right now.',
        'menu.also': 'also',
        'menu.adminOnly': 'Owner / Sudo only',

        'cat.movies': 'Movie Commands',
        'cat.download': 'Download Commands',
        'cat.study': 'Study Commands',
        'cat.tools': 'Tools & Info',
        'cat.settings': 'Settings (Owner)',

        'note.limit': '📊 Daily limit: {n} requests per user',
        'note.unlimited': '📊 Daily limit: unlimited',
        'note.reqGroup': '📌 .mb works only in the movie request group.',

        'cmd.mb': 'Request a movie / series (MovieBox)',
        'cmd.forward': 'Reply to a message to forward it to a jid (Owner / Sudo)',
        'cmd.cz': 'Get a movie / series in your own chat (CineSubz)',
        'cmd.movie': 'Search movies and get download links (KM Movies)',
        'cmd.ss': 'Search SinhalaSub movies and get download links',
        'cmd.ss2': 'Search SinhalaSub.lk (browser scraper)',
        'cmd.song': 'Download a song as audio (name or YouTube link)',
        'cmd.video': 'Download a YouTube video (name or link)',
        'cmd.fb': 'Download a Facebook video',
        'cmd.tiktok': 'Download a TikTok video',
        'cmd.pastpaper': 'Search past papers',
        'cmd.pastdl': 'Get the PDF of a past paper link',
        'cmd.ping': 'Check the bot speed',
        'cmd.alive': 'Check that the bot is online',
        'cmd.runtime': 'Show how long the bot has been running',
        'cmd.time': 'Current time (Sri Lanka)',
        'cmd.date': 'Today\'s date (Sri Lanka)',
        'cmd.id': 'Show the chat and user ID',
        'cmd.jid': 'Show the chat JID (group / private) to use with forward (Owner / Sudo)',
        'cmd.owner': 'Owner contact',
        'cmd.repeat': 'Repeat your text',
        'cmd.calc': 'Calculator',
        'cmd.flip': 'Flip a coin',
        'cmd.dice': 'Roll a dice',
        'cmd.group': 'Group invite link',
        'cmd.pair': 'Get a pairing code for a number',
        'cmd.settings': 'Open the control panel',
        'cmd.lang': 'Change the bot language',

        'lang.title': '🌐 LANGUAGE',
        'lang.current': 'Current: {flag} {native}',
        'lang.list': 'Available:',
        'lang.how': 'Change with: {prefix}lang <code>   (eg: {prefix}lang si)',
        'lang.changed': '✅ Language changed to {flag} {native}',
        'lang.invalid': '❌ Unknown language. Use: {codes}',
        'lang.ownerOnly': '⛔ Only the Owner / Sudo can change the language.',
        'lang.saveFailed': '⚠️ Changed for now, but cloud save failed (will reset after restart).'
    },

    si: {
        'menu.botMenu': 'බොට් මෙනුව',
        'menu.hi': '👋 ආයුබෝවන් {name}',
        'menu.bot': 'බොට්',
        'menu.user': 'පරිශීලකයා',
        'menu.owner': 'හිමිකරු',
        'menu.uptime': 'ක්‍රියාත්මක කාලය',
        'menu.ram': 'RAM',
        'menu.prefix': 'Prefix',
        'menu.language': 'භාෂාව',
        'menu.select': '🎀 කාණ්ඩයක් තෝරන්න:',
        'menu.replyHint': '↩️ මේ පණිවිඩයට අංකයක් (1-{max}) reply කරන්න.',
        'menu.back': '↩️ ආපසු යන්න {prefix}menu යවන්න.',
        'menu.invalid': '⚠️ වැරදි තේරීමක්! 1 සිට {max} දක්වා අංකයක් යවන්න.',
        'menu.empty': 'දැනට භාවිතා කළ හැකි විධාන නැත.',
        'menu.also': 'තවත් නම්',
        'menu.adminOnly': 'හිමිකරු / Sudo පමණි',

        'cat.movies': 'චිත්‍රපට විධාන',
        'cat.download': 'බාගත කිරීමේ විධාන',
        'cat.study': 'අධ්‍යයන විධාන',
        'cat.tools': 'මෙවලම් සහ තොරතුරු',
        'cat.settings': 'සැකසුම් (හිමිකරු)',

        'note.limit': '📊 දිනකට සීමාව: පරිශීලකයෙකුට requests {n} යි',
        'note.unlimited': '📊 දිනකට සීමාව: අසීමිතයි',
        'note.reqGroup': '📌 .mb වැඩ කරන්නේ movie request group එකේ පමණයි.',

        'cmd.mb': 'චිත්‍රපටයක් / කතාමාලාවක් request කරන්න (MovieBox)',
        'cmd.forward': 'Message එකකට reply කර jid එකකට forward කරන්න (Owner / Sudo)',
        'cmd.cz': 'චිත්‍රපටයක් / කතාමාලාවක් ඔබේ chat එකටම ගන්න (CineSubz)',
        'cmd.movie': 'චිත්‍රපට සොයා download links ගන්න (KM Movies)',
        'cmd.ss': 'SinhalaSub චිත්‍රපට සොයා download links ගන්න',
        'cmd.ss2': 'SinhalaSub.lk සොයන්න (browser scraper)',
        'cmd.song': 'ගීතයක් audio ලෙස බාගන්න (නම හෝ YouTube link)',
        'cmd.video': 'YouTube වීඩියෝවක් බාගන්න (නම හෝ link)',
        'cmd.fb': 'Facebook වීඩියෝවක් බාගන්න',
        'cmd.tiktok': 'TikTok වීඩියෝවක් බාගන්න',
        'cmd.pastpaper': 'පැරණි ප්‍රශ්න පත්‍ර සොයන්න',
        'cmd.pastdl': 'ප්‍රශ්න පත්‍ර link එකක PDF එක ගන්න',
        'cmd.ping': 'බොට්ගේ වේගය බලන්න',
        'cmd.alive': 'බොට් online ද බලන්න',
        'cmd.runtime': 'බොට් ක්‍රියාත්මක වූ කාලය',
        'cmd.time': 'දැන් වේලාව (ශ්‍රී ලංකා)',
        'cmd.date': 'අද දිනය (ශ්‍රී ලංකා)',
        'cmd.id': 'Chat සහ user ID පෙන්වන්න',
        'cmd.jid': 'Chat JID එක (group / private) පෙන්වන්න, forward සඳහා (Owner / Sudo)',
        'cmd.owner': 'හිමිකරුගේ අංකය',
        'cmd.repeat': 'ඔබේ text එක නැවත යවන්න',
        'cmd.calc': 'ගණක යන්ත්‍රය',
        'cmd.flip': 'කාසියක් උඩ දමන්න',
        'cmd.dice': 'දාදු කැටයක් දමන්න',
        'cmd.group': 'Group invite link එක',
        'cmd.pair': 'අංකයකට pairing code එකක් ගන්න',
        'cmd.settings': 'Control panel එක විවෘත කරන්න',
        'cmd.lang': 'බොට්ගේ භාෂාව වෙනස් කරන්න',

        'lang.title': '🌐 භාෂාව',
        'lang.current': 'දැනට: {flag} {native}',
        'lang.list': 'තියෙන භාෂා:',
        'lang.how': 'වෙනස් කරන්න: {prefix}lang <code>   (උදා: {prefix}lang en)',
        'lang.changed': '✅ භාෂාව {flag} {native} ලෙස වෙනස් කළා',
        'lang.invalid': '❌ නොදන්නා භාෂාවක්. භාවිතා කරන්න: {codes}',
        'lang.ownerOnly': '⛔ භාෂාව වෙනස් කළ හැක්කේ හිමිකරුට / Sudo ට පමණි.',
        'lang.saveFailed': '⚠️ දැනට වෙනස් වුණා, නමුත් cloud save අසාර්ථකයි (restart වුණාම reset වෙයි).'
    }
};

/** Turn user input ("si", "Sinhala", "සිංහල", "2") into a language code, or null. */
function resolveLang(input) {
    const v = String(input || '').trim().toLowerCase();
    if (!v) return null;
    const codes = Object.keys(LANGS);
    if (/^\d+$/.test(v)) return codes[parseInt(v, 10) - 1] || null;
    for (const code of codes) {
        if (LANGS[code].aliases.includes(v) || LANGS[code].native.toLowerCase() === v) return code;
    }
    return null;
}

const isLang = (code) => Object.prototype.hasOwnProperty.call(LANGS, code);

/** Translate a key; falls back to English, then to the key itself. {vars} are filled in. */
function t(lang, key, vars = {}) {
    const table = STR[isLang(lang) ? lang : DEFAULT_LANG];
    const raw = table[key] ?? STR[DEFAULT_LANG][key] ?? key;
    return String(raw).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

module.exports = { DEFAULT_LANG, LANGS, STR, resolveLang, isLang, t };
