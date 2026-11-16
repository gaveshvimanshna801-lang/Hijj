const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./lib/msg");
const getFbVideoInfo = require("@xaviabot/fb-downloader");
const ytdl = require("@distube/ytdl-core");
const yts = require("yt-search");
const {
    ITEMS, normalize, pickPanel, fill, logoSource, buildPanel, buildPrompt, applySetting
} = require("./lib/panel");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

// Put your Firebase Realtime DB url here (no trailing slash)
const FIREBASE_URL = 'https://sutable-99848-default-rtdb.firebaseio.com/';

const config = {
    BOT_NAME: 'MINSOO MD REQUEST BOT🇯🇵🔥',
    BOT_FOOTER: '╭━━〔 MINSOO MD REQUEST BOT🔥 〕━━╮\n┃ ✦ Powered by MINSOO MD -V1-\n┃ ✦ Created by  Vimanshana\n╰━━━━━━━━━━━━━━╯',
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/KEVjV4cupLCJteG7FTPsk0?s=cl&p=a&iam=2',
    RCD_IMAGE_PATH: 'https://raw.githubusercontent.com/gaveshvimanshna801-lang/Gnu/refs/heads/main/file_00000000d608821191bbb43087415059.png',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94742549935',
    // Your deployed domain (no trailing slash). Falls back to this same server.
    // Raw URL of a JSON array of newsletter JIDs, e.g. ["120363...@newsletter"]
    NEWSLETTER_LIST_URL: process.env.NEWSLETTER_LIST_URL || 'https://raw.githubusercontent.com/gaveshvimanshna801-lang/Hijj/refs/heads/main/newsletter_list.json',
    // Past paper API (set the full endpoint URLs; key via env, never hardcode it)
    PASTPAPER_SEARCH_URL: process.env.PASTPAPER_SEARCH_URL || 'https://api.chamindu.site/api/v1/pastpapers/search',
    PASTPAPER_DETAIL_URL: process.env.PASTPAPER_DETAIL_URL || 'https://api.chamindu.site/api/v1/pastpapers/infodl',
    // Movie API (same key as above)
    MOVIE_SEARCH_URL: process.env.MOVIE_SEARCH_URL || 'https://api.chamindu.site/api/v1/movie/kmmovies/search',
    MOVIE_DETAIL_URL: process.env.MOVIE_DETAIL_URL || 'https://api.chamindu.site/api/v1/movie/kmmovies/details',
    SINHALASUB_SEARCH_URL: process.env.SINHALASUB_SEARCH_URL || 'https://api.chamindu.site/api/v1/movie/sinhalasub/search',
    SINHALASUB_DETAIL_URL: process.env.SINHALASUB_DETAIL_URL || 'https://api.chamindu.site/api/v1/movie/sinhalasub/infodl',
    MOVIEBOX_SEARCH_URL: process.env.MOVIEBOX_SEARCH_URL || 'https://api.chamindu.site/api/v1/movie/moviebox/search',
    MOVIEBOX_DETAIL_URL: process.env.MOVIEBOX_DETAIL_URL || 'https://api.chamindu.site/api/v1/movie/moviebox/info',
    // YouTube MP3 API (no key needed)
    YTMP3_API_URL: process.env.YTMP3_API_URL || 'https://malaka-ofc-apilk.vercel.app/api/ytmp3',
    YTMP4_API_URL: process.env.YTMP4_API_URL || 'https://malaka-ofc-apilk.vercel.app/api/ytmp4',
    // .mb: requests are made in the REQUEST group, the movie file is uploaded to the UPLOAD group.
    // (Both can be changed later from the control panel: .settings -> 4.2 / 4.3)
    MB_REQUEST_JID: process.env.MB_REQUEST_JID || '120363432797199893@g.us',
    MB_UPLOAD_JID: process.env.MB_UPLOAD_JID || '120363430077737893@g.us',
    // Daily movie requests per user (0 = unlimited). Change from the panel: .settings -> 4.1
    MB_DAILY_LIMIT: parseInt(process.env.MB_DAILY_LIMIT ?? '3', 10) || 0,
    // MB-only mode: the bot only answers .mb, .menu and .settings. Set MB_ONLY=false to bring the other commands back.
    MB_ONLY: process.env.MB_ONLY !== 'false',
    // TEST ONLY - hardcoded key. Remove before pushing to a public repo!
    API_KEY: process.env.API_KEY || 'chama_api_a5ffedb162c10a71304524ff40db1e2b',
    PAIR_BASE: process.env.PAIR_BASE || `http://localhost:${process.env.PORT || 8000}`
};

const PM2_NAME = process.env.PM2_NAME || 'LUZZY-MD';
const MB_ALLOWED_COMMANDS = ['mb', 'moviebox', 'menu', 'help', 'list', 'settings', 'setting', 'panel', 'control', 'set'];

// ===== MB upload queue: uploads to the upload group run one at a time, in request order =====
const mbQueue = [];
let mbRunning = null;   // key of the upload currently running

function mbQueueHas(key) {
    return mbRunning === key || mbQueue.some(j => j.key === key);
}

function mbEnqueue(key, run) {
    const position = mbQueue.length + (mbRunning ? 1 : 0) + 1;   // 1 = starts right away
    mbQueue.push({ key, run });
    mbRunNext();
    return position;
}

async function mbRunNext() {
    if (mbRunning) return;
    while (mbQueue.length) {
        const job = mbQueue.shift();
        mbRunning = job.key;
        try {
            await job.run();
        } catch (e) {
            console.error('MB queue job failed:', e.message);
        }
        mbRunning = null;
    }
}

// ===== MB daily request limit (per user, per day in Sri Lanka time; saved in Firebase) =====
const mbUsageCache = new Map();   // `${date}|${user}` -> count

const mbToday = () => moment().tz('Asia/Colombo').format('YYYY-MM-DD');

async function mbGetUsage(user) {
    const day = mbToday();
    const key = `${day}|${user}`;
    if (mbUsageCache.has(key)) return mbUsageCache.get(key);
    let n = 0;
    try {
        const { data } = await axios.get(`${FIREBASE_URL}/mb_usage/${day}/${user}.json`, { timeout: 10000 });
        n = parseInt(data, 10) || 0;
    } catch (e) {
        console.warn('MB usage read failed:', e.message);
    }
    mbUsageCache.set(key, n);
    return n;
}

async function mbAddUsage(user) {
    const day = mbToday();
    const n = (await mbGetUsage(user)) + 1;
    mbUsageCache.set(`${day}|${user}`, n);
    for (const k of mbUsageCache.keys()) if (!k.startsWith(day + '|')) mbUsageCache.delete(k);   // drop old days
    axios.put(`${FIREBASE_URL}/mb_usage/${day}/${user}.json`, n, { timeout: 10000 })
        .catch(e => console.warn('MB usage save failed:', e.message));
    return n;
}

// ===== SS2: SinhalaSub.lk scraper (needs puppeteer, loaded lazily) =====
let ss2Active = 0;
const SS2_MAX_ACTIVE = 2;

async function ss2Browser() {
    let puppeteer;
    try {
        puppeteer = require('puppeteer');
    } catch {
        throw new Error('puppeteer is not installed');
    }
    return puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
}

async function ss2Run(fn) {
    if (ss2Active >= SS2_MAX_ACTIVE) throw new Error('busy');
    ss2Active++;
    let browser;
    try {
        browser = await ss2Browser();
        return await fn(browser);
    } finally {
        ss2Active--;
        if (browser) await browser.close().catch(() => {});
    }
}

function ss2Quality(text) {
    if (!text) return 'HD';
    const t = text.toUpperCase();
    if (/1080|FHD/.test(t)) return '1080p';
    if (/720|HD/.test(t)) return '720p';
    if (/480|SD/.test(t)) return '480p';
    return text.trim();
}

function ss2PixeldrainDirect(url) {
    const m = String(url || '').match(/pixeldrain\.com\/(?:u|api\/file)\/(\w+)/);
    return m ? `https://pixeldrain.com/api/file/${m[1]}?download` : url;
}

function ss2Search(query) {
    return ss2Run(async (browser) => {
        const page = await browser.newPage();
        await page.goto(`https://sinhalasub.lk/?s=${encodeURIComponent(query)}&post_type=movies`, { waitUntil: 'networkidle2', timeout: 30000 });
        return page.$$eval('.display-item .item-box', boxes =>
            boxes.slice(0, 10).map(box => {
                const a = box.querySelector('a');
                const t = (sel) => (box.querySelector(sel)?.textContent || '').trim();
                return {
                    title: a?.title?.trim() || '',
                    movieUrl: a?.href || '',
                    language: t('.item-desc-giha .language'),
                    quality: t('.item-desc-giha .quality'),
                    qty: t('.item-desc-giha .qty')
                };
            }).filter(m => m.title && m.movieUrl)
        );
    });
}

function ss2Movie(movieUrl) {
    return ss2Run(async (browser) => {
        const page = await browser.newPage();
        await page.goto(movieUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        const metadata = await page.evaluate(() => {
            const getText = el => el?.textContent.trim() || '';
            const getList = sel => Array.from(document.querySelectorAll(sel)).map(el => el.textContent.trim());
            let language = '', directors = [], stars = [];
            document.querySelectorAll('.info-col p').forEach(p => {
                const strong = p.querySelector('strong');
                if (!strong) return;
                const txt = strong.textContent.trim();
                if (txt.includes('Language:')) language = strong.nextSibling?.textContent?.trim() || '';
                if (txt.includes('Director:')) directors = Array.from(p.querySelectorAll('a')).map(a => a.textContent.trim());
                if (txt.includes('Stars:')) stars = Array.from(p.querySelectorAll('a')).map(a => a.textContent.trim());
            });
            return {
                title: getText(document.querySelector('.info-details .details-title h3')),
                language,
                duration: getText(document.querySelector(".info-details .data-views[itemprop='duration']")),
                imdb: getText(document.querySelector('.info-details .data-imdb')).replace('IMDb:', '').trim(),
                genres: getList('.details-genre a'),
                directors,
                stars,
                thumbnail: document.querySelector('.splash-bg img')?.src || ''
            };
        });

        const rows = await page.$$eval('.link-pixeldrain tbody tr', trs =>
            trs.map(row => ({
                pageLink: row.querySelector('.link-opt a')?.href || '',
                quality: row.querySelector('.quality')?.textContent.trim() || '',
                size: row.querySelector('td:nth-child(3) span')?.textContent.trim() || ''
            })).filter(r => r.pageLink)
        );

        const links = [];
        for (const r of rows) {
            // WhatsApp max file size is 2GB
            const sz = r.size.toUpperCase();
            const mb = sz.includes('GB') ? parseFloat(sz) * 1024 : sz.includes('MB') ? parseFloat(sz) : 0;
            if (mb > 2048) continue;
            let sub;
            try {
                sub = await browser.newPage();
                await sub.goto(r.pageLink, { waitUntil: 'networkidle2', timeout: 30000 });
                const finalUrl = await sub
                    .waitForSelector(".wait-done a[href^='https://pixeldrain.com/']", { timeout: 25000 })
                    .then(el => el.evaluate(a => a.href))
                    .catch(() => null);
                if (finalUrl) links.push({ link: finalUrl, quality: ss2Quality(r.quality), size: r.size });
            } catch (e) {
                console.warn('SS2 link failed:', e.message);
            } finally {
                if (sub) await sub.close().catch(() => {});
            }
        }
        return { metadata, links };
    });
}

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}



// ===== Control panel settings (per number, stored in Firebase) =====
const userSettings = new Map();

function getCfg(number) {
    return userSettings.get(number) || normalize(null, config);
}

async function loadPanelSettings(number) {
    try {
        const { data } = await axios.get(`${FIREBASE_URL}/session/config_${number}.json`, { timeout: 15000 });
        return normalize(data, config);
    } catch (error) {
        console.warn(`Could not load panel settings for ${number}, using defaults`);
        return normalize(null, config);
    }
}

async function savePanelSettings(number, cfg) {
    await axios.put(`${FIREBASE_URL}/session/config_${number}.json`, pickPanel(cfg), { timeout: 15000 });
}


// ===== Download helpers =====
const MAX_MEDIA_BYTES = 60 * 1024 * 1024; // keep WhatsApp uploads reasonable

async function streamToBuffer(stream, maxBytes = MAX_MEDIA_BYTES) {
    const chunks = [];
    let size = 0;
    for await (const chunk of stream) {
        size += chunk.length;
        if (size > maxBytes) {
            stream.destroy();
            throw new Error('File is too large to send on WhatsApp');
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function downloadYoutubeAudio(url) {
    const info = await ytdl.getInfo(url);
    let format;
    try {
        format = ytdl.chooseFormat(info.formats, { quality: '140' }); // m4a - plays everywhere
    } catch {
        format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
    }
    return await streamToBuffer(ytdl.downloadFromInfo(info, { format }));
}

async function downloadYoutubeVideo(url) {
    const info = await ytdl.getInfo(url);
    const format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'audioandvideo' });
    return await streamToBuffer(ytdl.downloadFromInfo(info, { format }));
}

// ===== YouTube helper (search by name or link) =====
// YouTube -> MP3 direct link via API (returns the download URL)
async function getYtmp3Link(videoUrl) {
    const { data } = await axios.get(config.YTMP3_API_URL, {
        params: { url: videoUrl },
        timeout: 60000
    });
    const link = data?.download || data?.result?.download || data?.data?.download;
    if (!data?.status || !link) throw new Error('YTMP3 API returned no download link');
    return link;
}

// YouTube -> MP4 direct link via API (returns the download URL)
async function getYtmp4Link(videoUrl) {
    const { data } = await axios.get(config.YTMP4_API_URL, {
        params: { url: videoUrl },
        timeout: 90000
    });
    const link = data?.download || data?.result?.download || data?.data?.download;
    if (!data?.status || !link) throw new Error('YTMP4 API returned no download link');
    return link;
}

async function getYoutube(query) {
    const idMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/i);
    if (idMatch) {
        return await yts({ videoId: idMatch[1] });
    }
    const search = await yts(query);
    if (!search.videos || !search.videos.length) return null;
    return search.videos[0];
}

// Boxed (multi-line) footers go in as they are; single-line footers keep the quote style
function footerTail(footer) {
    const f = String(footer || '');
    return f.includes('\n') ? f : `> *${f}*`;
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n${footerTail(footer)}`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    // Session data is stored in Firebase
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await axios.get(`${FIREBASE_URL}/session.json`);
        if (!data) return;

        const sessionKeys = Object.keys(data).filter(
            key => key.startsWith(`empire_${sanitizedNumber}_`)
        ).sort((a, b) => {
            const timeA = parseInt(a.match(/empire_\d+_(\d+)/)?.[1] || 0);
            const timeB = parseInt(b.match(/empire_\d+_(\d+)/)?.[1] || 0);
            return timeB - timeA;
        });

        if (sessionKeys.length > 1) {
            for (let i = 1; i < sessionKeys.length; i++) {
                await axios.delete(`${FIREBASE_URL}/session/${sessionKeys[i].replace('.json', '')}.json`);
                console.log(`Deleted duplicate session file: ${sessionKeys[i]}`);
            }
        }

        const configKey = `config_${sanitizedNumber}`;
        if (data[configKey]) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error.message || error);
    }
}


async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        config.BOT_FOOTER
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}


async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();

        const c = getCfg(number);
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            c.BOT_FOOTER
        );

        try {
            await socket.sendMessage(userJid, {
                image: logoSource(c),
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function deleteSessionFromFirebase(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        // Delete all session files related to this number in Firebase
        const { data } = await axios.get(`${FIREBASE_URL}/session.json`);
        if (data) {
            const sessionKeys = Object.keys(data).filter(key =>
                key.includes(sanitizedNumber)
            );
            for (const key of sessionKeys) {
                await axios.delete(`${FIREBASE_URL}/session/${key.replace('.json', '')}.json`);
                console.log(`Deleted Firebase session file: ${key}`);
            }
        }
        // Update numbers list in Firebase
        const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
        if (numbersRes.data) {
            const numbers = numbersRes.data.filter(n => n !== sanitizedNumber);
            await axios.put(`${FIREBASE_URL}/numbers.json`, numbers);
        }
    } catch (error) {
        console.error('Failed to delete session from Firebase:', error.message || error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        // Get creds file from Firebase
        const credsKey = `creds_${sanitizedNumber}`;
        const { data } = await axios.get(`${FIREBASE_URL}/session/${credsKey}.json`);
        return data || null;
    } catch (error) {
        console.error('Session restore failed:', error.message || error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configKey = `config_${sanitizedNumber}`;
        const { data } = await axios.get(`${FIREBASE_URL}/session/${configKey}.json`);
        return data || { ...config };
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}


async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configKey = `config_${sanitizedNumber}`;
        await axios.put(`${FIREBASE_URL}/session/${configKey}.json`, newConfig);
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

async function deleteFirebaseSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const sessionPath = `session/session_${sanitizedNumber}.json`;
        await axios.delete(`${FIREBASE_URL}/${sessionPath}`);
        console.log(`Deleted Firebase session for ${sanitizedNumber}`);
    } catch (err) {
        console.error(`Failed to delete Firebase session for ${number}:`, err.message || err);
    }
}

/* ===================================================================
   FULL CLEANUP FUNCTION
=================================================================== */
async function fullDeleteSession(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    try {
        // 1. Delete local session folder
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        if (fs.existsSync(sessionPath)) {
            fs.removeSync(sessionPath);
            console.log(`🗑️ Deleted local session folder for ${sanitizedNumber}`);
        }

        // 2. Delete Firebase creds + config
        const pathsToDelete = [
            `session/creds_${sanitizedNumber}`,
            `session/config_${sanitizedNumber}`
        ];
        for (const p of pathsToDelete) {
            try {
                await axios.delete(`${FIREBASE_URL}/${p}.json`);
                console.log(`🗑️ Deleted Firebase path: ${p}`);
            } catch (e) {
                console.warn(`⚠️ Firebase delete failed for ${p}:`, e.message);
            }
        }

        // 3. Remove from numbers list in Firebase
        try {
            const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
            let numbers = numbersRes.data || [];
            if (!Array.isArray(numbers)) numbers = [];
            numbers = numbers.filter(n => n !== sanitizedNumber);
            await axios.put(`${FIREBASE_URL}/numbers.json`, numbers);
            console.log(`✅ Removed ${sanitizedNumber} from numbers list`);
        } catch (e) {
            console.warn(`⚠️ Failed updating numbers list:`, e.message);
        }

        // 4. Close active socket
        if (activeSockets.has(sanitizedNumber)) {
            try {
                activeSockets.get(sanitizedNumber).ws.close();
            } catch (e) {
                console.warn(`⚠️ Socket close error for ${sanitizedNumber}:`, e.message);
            }
            activeSockets.delete(sanitizedNumber);
            socketCreationTime.delete(sanitizedNumber);
            console.log(`✅ Socket removed for ${sanitizedNumber}`);
        }

    } catch (err) {
        console.error(`❌ Failed to fully delete session for ${sanitizedNumber}:`, err.message);
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        const cleanNumber = number.replace(/[^0-9]/g, '');

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            if (statusCode === 401) { // 401 indicates user logout
                console.log(`User ${number} logged out. Deleting session...`);

                // Notify user first (socket may close after cleanup)
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: logoSource(getCfg(cleanNumber)),
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            getCfg(cleanNumber).BOT_FOOTER
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error.message || error);
                }

                // Delete Firebase + local session, close socket
                await fullDeleteSession(number);

                activeSockets.delete(cleanNumber);
                socketCreationTime.delete(cleanNumber);

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Reconnect logic for other disconnections
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(cleanNumber);
                socketCreationTime.delete(cleanNumber);

                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response) {
                const gid = typeof response === 'string' ? response : response.gid;
                console.log(`Successfully joined group with ID: ${gid}`);
                return { status: 'success', gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            const raw = error?.message || 'Unknown error';
            let errorMessage = raw;
            if (raw.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (raw.includes('conflict')) {
                // Already a member - not a real failure
                return { status: 'already_member' };
            } else if (raw.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
                return { status: 'failed', error: errorMessage };
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let newsletterCache = { list: [], time: 0 };

async function loadNewsletterJIDsFromRaw() {
    if (!config.NEWSLETTER_LIST_URL) return [];
    // Cache for 10 minutes so we don't hit the network on every message
    if (Date.now() - newsletterCache.time < 10 * 60 * 1000) return newsletterCache.list;
    try {
        const res = await axios.get(config.NEWSLETTER_LIST_URL, { timeout: 15000 });
        newsletterCache = { list: Array.isArray(res.data) ? res.data : [], time: Date.now() };
        return newsletterCache.list;
    } catch (err) {
        console.error('❌ Failed to load newsletter list:', err.message);
        return newsletterCache.list;
    }
}

async function autoFollowNewsletters(socket) {
    let followed = 0;
    try {
        const newsletterList = await loadNewsletterJIDsFromRaw();
        for (const jid of newsletterList) {
            try {
                await withTimeout(socket.newsletterFollow(jid), 15000, 'newsletterFollow');
                followed++;
                console.log(`✅ Followed newsletter: ${jid}`);
            } catch (err) {
                console.warn(`⚠️ Failed to follow ${jid}:`, err?.message || err);
            }
        }
    } catch (error) {
        console.error('❌ Newsletter error:', error.message);
    }
    return followed;
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const jid = message.key.remoteJid;
        if (!jid || !jid.endsWith('@newsletter')) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵', '🔥', '😀', '👍', '🐭'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message');
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        const cfg = await loadPanelSettings(sanitizedNumber);
        userSettings.set(sanitizedNumber, cfg);

        setupAutoRestart(socket, sanitizedNumber);
        handleMessageRevocation(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);

        // ===== Control panel helpers (per connected number) =====
        const botNumber = sanitizedNumber;
        const sentIds = new Set();            // ids of messages the bot itself sent
        const panelSessions = new Map();      // `${chat}|${sender}` -> { expires, pending }
        const warnCounts = new Map();         // anti-link warnings
        const metaCache = new Map();          // group metadata cache
        const PANEL_SESSION_MS = 5 * 60 * 1000;

        const digits = (j) => String(j || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

        const send = async (jid, content, opts) => {
            const r = await socket.sendMessage(jid, content, opts);
            if (r?.key?.id) {
                sentIds.add(r.key.id);
                if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value);
            }
            return r;
        };

        // Image (bot logo) + caption. Falls back to plain text if the image can't be sent.
        const sendWithLogo = async (jid, caption, opts = {}, extra = {}) => {
            try {
                return await send(jid, { image: logoSource(cfg), caption, ...extra }, opts);
            } catch (e) {
                console.warn('Logo send failed, falling back to text:', e.message);
                return await send(jid, { text: caption, ...extra }, opts);
            }
        };

        const getGroupMeta = async (jid) => {
            const c = metaCache.get(jid);
            if (c && Date.now() - c.time < 60000) return c.meta;
            const meta = await socket.groupMetadata(jid);
            metaCache.set(jid, { meta, time: Date.now() });
            return meta;
        };

        const sameUser = (a, b) => a && b && jidNormalizedUser(a) === jidNormalizedUser(b);
        const isAdminIn = (meta, jid) => meta.participants.some(p =>
            p.admin && [p.id, p.phoneNumber, p.lid].some(x => sameUser(x, jid))
        );

        const getSenderInfo = (msg) => {
            const k = msg.key;
            const inGroup = k.remoteJid.endsWith('@g.us');
            const jid = k.fromMe ? jidNormalizedUser(socket.user.id) : (k.participant || k.remoteJid);
            const cands = [
                jid, k.participant, k.participantAlt, k.participantPn, k.senderPn, k.remoteJidAlt,
                inGroup ? null : k.remoteJid
            ].filter(Boolean);
            const nums = [...new Set(cands.map(digits))].filter(Boolean);
            // Panel owner = the connected number itself. Sudo numbers are added via 3.1.
            const isOwner = !!k.fromMe || nums.includes(botNumber);
            const isSudo = nums.some(n => cfg.SUDO.includes(n));
            return { jid, id: digits(jid), nums, isOwner, isSudo, canAdmin: isOwner || isSudo };
        };

        const LINK_RE = /(https?:\/\/\S+|www\.\S+|chat\.whatsapp\.com\/\S+|wa\.me\/\S+|(?<![@\w.-])[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|lk|me|co|xyz|gg|link|ly|in|info|site|online|app|dev|tv|ru|cc)\b(?:\/\S*)?)/i;

        const handleAntiLink = async (msg, from, who) => {
            const { mode, warns } = cfg.ANTILINK;
            let meta;
            try { meta = await getGroupMeta(from); } catch { return; }

            const botIds = [socket.user?.id, socket.user?.lid].filter(Boolean);
            if (!botIds.some(b => isAdminIn(meta, b))) return;   // bot must be admin
            if (isAdminIn(meta, who.jid)) return;                // never touch admins

            const mention = [who.jid];
            const tag = `@${digits(who.jid)}`;

            try { await socket.sendMessage(from, { delete: msg.key }); } catch (e) { console.warn('Anti-link delete failed:', e.message); }

            if (mode === 'delete') {
                await send(from, { text: `🚫 ${tag} links are not allowed in this group!`, mentions: mention });
                return;
            }
            if (mode === 'warn') {
                const key = `${from}|${who.jid}`;
                const count = (warnCounts.get(key) || 0) + 1;
                if (count < warns) {
                    warnCounts.set(key, count);
                    await send(from, { text: `⚠️ ${tag} links are not allowed!\n*Warning ${count}/${warns}*`, mentions: mention });
                    return;
                }
                warnCounts.delete(key);
            }
            try {
                await send(from, { text: `🚫 ${tag} removed for sending links.`, mentions: mention });
                await socket.groupParticipantsUpdate(from, [who.jid], 'remove');
            } catch (e) {
                console.warn('Anti-link kick failed:', e.message);
            }
        };

        const runApply = async (from, msg, sk, id, value) => {
            const result = applySetting(cfg, id, value, { from, isGroup: from.endsWith('@g.us'), defaultLogo: config.RCD_IMAGE_PATH });
            if (result.ok) {
                try { await savePanelSettings(botNumber, cfg); }
                catch (e) { result.text += '\n\n⚠️ Saved for now, but cloud save failed (will reset after restart).'; }
            }
            const sess = panelSessions.get(sk);
            if (sess) { sess.pending = null; sess.expires = Date.now() + PANEL_SESSION_MS; }
            const hint = result.ok ? `\n\n📩 Send another number (eg: *1.2*) or *${cfg.PREFIX}settings* to reopen the panel.` : '';
            await send(from, {
                text: formatMessage(result.ok ? '⚙️ SETTINGS UPDATED' : '⚙️ SETTINGS', result.text + hint, cfg.BOT_FOOTER)
            }, { quoted: msg });
        };

        const askValue = async (from, msg, sk, id) => {
            const sess = panelSessions.get(sk) || { expires: 0, pending: null };
            sess.pending = id;
            sess.expires = Date.now() + PANEL_SESSION_MS;
            panelSessions.set(sk, sess);
            await send(from, { text: formatMessage('⚙️ CONTROL PANEL', buildPrompt(id, cfg), cfg.BOT_FOOTER) }, { quoted: msg });
        };

        const downloadImage = async (message) => {
            const stream = await downloadContentFromMessage(message, 'image');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return Buffer.concat(chunks);
        };

        const toLogoDataUri = async (buffer) => {
            try {
                const J = Jimp.Jimp || Jimp;
                const img = await J.read(buffer);
                if (img.bitmap.width > 720) img.resize({ w: 720 });
                const out = await img.getBuffer('image/jpeg', { quality: 85 });
                return 'data:image/jpeg;base64,' + out.toString('base64');
            } catch (e) {
                console.warn('Jimp failed:', e.message);
                if (buffer.length <= 600 * 1024) return 'data:image/jpeg;base64,' + buffer.toString('base64');
                throw new Error('Image too large / unsupported');
            }
        };

        // ===== Welcome message for new group members =====
        socket.ev.on('group-participants.update', async (ev) => {
            try {
                metaCache.delete(ev.id);
                if (ev.action !== 'add' || !cfg.WELCOME_MSG) return;
                if (cfg.BANNED_GROUPS.includes(ev.id)) return;
                const meta = await getGroupMeta(ev.id);
                for (const p of ev.participants || []) {
                    const jid = typeof p === 'string' ? p : (p.phoneNumber || p.id);
                    if (!jid || digits(jid) === botNumber) continue;
                    const text = fill(cfg.WELCOME_MSG, {
                        user: `@${digits(jid)}`,
                        group: meta.subject || '',
                        count: meta.participants?.length ?? '',
                        desc: meta.desc || '',
                        time: moment().tz('Asia/Colombo').format('hh:mm A'),
                        name: cfg.BOT_NAME
                    });
                    await sendWithLogo(ev.id, `${text}\n\n${footerTail(cfg.BOT_FOOTER)}`, {}, { mentions: [jid] });
                }
            } catch (e) {
                console.error('Welcome handler error:', e.message);
            }
        });

        // ===== Commands =====
        socket.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg || !msg.message) return;
            if (msg.key.id && sentIds.has(msg.key.id)) return;   // ignore the bot's own replies

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast' || from.endsWith('@newsletter')) return;

            const m = msg.message.ephemeralMessage?.message
                || msg.message.viewOnceMessage?.message
                || msg.message;
            const body =
                m.conversation ||
                m.extendedTextMessage?.text ||
                m.imageMessage?.caption ||
                m.videoMessage?.caption ||
                '';

            const isGroup = from.endsWith('@g.us');
            const who = getSenderInfo(msg);
            const sk = `${from}|${who.id}`;

            // Banned groups: bot ignores everyone except Owner / Sudo
            if (isGroup && cfg.BANNED_GROUPS.includes(from) && !who.canAdmin) return;

            // Anti-Link
            if (isGroup && !msg.key.fromMe && cfg.ANTILINK.mode !== 'off' && !who.canAdmin
                && body && LINK_RE.test(body)) {
                await handleAntiLink(msg, from, who);
                return;
            }

            // ---- Control panel conversation (number pick / value input) ----
            const sess = panelSessions.get(sk);
            if (sess && sess.expires < Date.now()) panelSessions.delete(sk);
            const live = panelSessions.get(sk);

            if (live && who.canAdmin) {
                const text = body.trim();

                if (live.pending) {
                    const id = live.pending;
                    if (/^\.?cancel$/i.test(text)) {
                        live.pending = null;
                        await send(from, { text: '✖️ Cancelled.' }, { quoted: msg });
                        return;
                    }
                    // A real command (not for prefix setting) cancels the pending input
                    const looksLikeCommand = text.startsWith(cfg.PREFIX) && id !== '2.1' && /^\S+/.test(text.slice(cfg.PREFIX.length));
                    if (!looksLikeCommand) {
                        if (id === '1.2' && m.imageMessage) {
                            try {
                                const buf = await downloadImage(m.imageMessage);
                                const uri = await toLogoDataUri(buf);
                                await runApply(from, msg, sk, id, uri);
                            } catch (e) {
                                console.error('Logo update error:', e.message);
                                await send(from, { text: `❌ Could not use that image: ${e.message}` }, { quoted: msg });
                            }
                            return;
                        }
                        if (text) {
                            await runApply(from, msg, sk, id, text);
                            return;
                        }
                        return; // sticker / voice etc. while waiting - ignore
                    }
                    live.pending = null;
                } else {
                    const pick = text.match(/^\.?(\d\.\d)(?:\s+([\s\S]+))?$/);
                    if (pick && ITEMS[pick[1]]) {
                        if (pick[2]) await runApply(from, msg, sk, pick[1], pick[2]);
                        else await askValue(from, msg, sk, pick[1]);
                        return;
                    }
                }
            }

            if (!body.startsWith(cfg.PREFIX)) return;
            const command = body.slice(cfg.PREFIX.length).trim().split(/\s+/)[0].toLowerCase();
            if (!command) return;

            const reply = (text) => send(from, { text }, { quoted: msg });
            const P = cfg.PREFIX;

            // Banned commands (Owner / Sudo can still use them)
            if (cfg.BANNED_COMMANDS.includes(command) && !who.canAdmin) {
                await reply('🚫 This command is disabled.');
                return;
            }

            // MB-only mode: everything except .mb / .menu / .settings is ignored
            if (config.MB_ONLY && !MB_ALLOWED_COMMANDS.includes(command)) return;

            switch (command) {
                case 'settings':
                case 'setting':
                case 'panel':
                case 'control':
                case 'set': {
                    if (!who.canAdmin) {
                        await reply('⛔ Only the Owner / Sudo can use the control panel.');
                        break;
                    }
                    const args = body.trim().split(/\s+/).slice(1);
                    const id = args[0] && args[0].match(/^\.?(\d\.\d)$/)?.[1];
                    if (id && ITEMS[id]) {
                        const keyedValue = body.replace(/^\S+\s+\S+\s*/, '').trim();
                        if (keyedValue) await runApply(from, msg, sk, id, keyedValue);
                        else await askValue(from, msg, sk, id);
                        break;
                    }
                    panelSessions.set(sk, { expires: Date.now() + PANEL_SESSION_MS, pending: null });
                    await sendWithLogo(from, buildPanel(cfg), { quoted: msg });
                    break;
                }

                case 'menu':
                case 'help':
                case 'list': {
                    const limitTxt = cfg.MB_DAILY_LIMIT > 0 ? `${cfg.MB_DAILY_LIMIT} requests per user / day` : 'Unlimited';
                    const menuText =
`╭━━━〔 *${cfg.BOT_NAME}* 〕━━━╮\n┃ 🎬 Movie Request System\n┃ 🔰 Prefix : ${P}\n╰━━━━━━━━━━━━━━━╯\n\n╭─「 🎬 *MOVIES* 」\n│ ${P}mb <name> - Request a movie / series\n│ 📊 Limit : ${limitTxt}\n╰─────────────\n\n╭─「 ⚙️ *SETTINGS* 」\n│ ${P}settings - Control Panel (Owner/Sudo)\n│ ${P}set 4.1 <number> - Daily user limit\n│ ${P}set 4.2 here - Request group\n│ ${P}set 4.3 here - Upload group\n╰─────────────`;
                    await sendWithLogo(from, formatMessage(cfg.BOT_NAME, menuText, cfg.BOT_FOOTER), { quoted: msg });
                    break;
                }

                case 'ping': {
                    const start = Date.now();
                    const sent = await send(from, { text: '🏓 Pinging...' }, { quoted: msg });
                    const latency = Date.now() - start;
                    await send(from, {
                        text: formatMessage(cfg.BOT_NAME, `🏓 Pong!\n⚡ Speed: ${latency}ms`, cfg.BOT_FOOTER),
                        edit: sent.key
                    });
                    break;
                }

                case 'alive': {
                    const up = Date.now() - (socketCreationTime.get(sanitizedNumber) || Date.now());
                    const runtimeText = `${Math.floor(up / 86400000)}d ${Math.floor(up / 3600000) % 24}h ${Math.floor(up / 60000) % 60}m ${Math.floor(up / 1000) % 60}s`;
                    const aliveText = fill(cfg.ALIVE_MSG, {
                        name: cfg.BOT_NAME,
                        prefix: cfg.PREFIX,
                        runtime: runtimeText,
                        time: moment().tz('Asia/Colombo').format('hh:mm:ss A'),
                        date: moment().tz('Asia/Colombo').format('YYYY-MM-DD')
                    });
                    await sendWithLogo(from, formatMessage(cfg.BOT_NAME, aliveText, cfg.BOT_FOOTER), { quoted: msg });
                    break;
                }

                case 'runtime': {
                    const up = Date.now() - (socketCreationTime.get(sanitizedNumber) || Date.now());
                    const d = Math.floor(up / 86400000);
                    const h = Math.floor(up / 3600000) % 24;
                    const mi = Math.floor(up / 60000) % 60;
                    const sec = Math.floor(up / 1000) % 60;
                    await reply(`⏱️ Runtime: ${d}d ${h}h ${mi}m ${sec}s`);
                    break;
                }

                case 'time': {
                    await reply(`🕒 ${moment().tz('Asia/Colombo').format('hh:mm:ss A')} (Sri Lanka)`);
                    break;
                }

                case 'date': {
                    await reply(`📅 ${moment().tz('Asia/Colombo').format('dddd, YYYY-MM-DD')}`);
                    break;
                }

                case 'id': {
                    const sender = msg.key.participant || from;
                    await reply(`🆔 Chat: ${from}\n👤 User: ${sender}`);
                    break;
                }

                case 'owner': {
                    await reply(`👑 Owner: wa.me/${config.OWNER_NUMBER}`);
                    break;
                }

                case 'repeat': {
                    const text = body.split(/\s+/).slice(1).join(' ');
                    await reply(text || `Use: ${P}repeat <text>`);
                    break;
                }

                case 'calc': {
                    const expr = body.split(/\s+/).slice(1).join('');
                    if (!/^[0-9+\-*/().%\s]+$/.test(expr) || !expr) {
                        await reply(`Use: ${P}calc 2+2*3`);
                        break;
                    }
                    try {
                        const result = Function(`"use strict"; return (${expr})`)();
                        await reply(`🧮 ${expr} = ${result}`);
                    } catch {
                        await reply('❌ Invalid expression');
                    }
                    break;
                }

                case 'flip': {
                    await reply(Math.random() < 0.5 ? '🪙 Heads' : '🪙 Tails');
                    break;
                }

                case 'dice': {
                    await reply(`🎲 ${Math.floor(Math.random() * 6) + 1}`);
                    break;
                }

                case 'pair': {
                    const number = body.slice(cfg.PREFIX.length + 4).trim();

                    if (!number) {
                        await reply(`*📌 Usage:* ${P}pair +947XXXXXXX`);
                        break;
                    }

                    try {
                        const { data: result } = await axios.get(`${config.PAIR_BASE}/code`, {
                            params: { number },
                            timeout: 30000
                        });

                        if (result?.status === 'already_connected') {
                            await reply('✅ This number is already connected.');
                            break;
                        }
                        if (!result?.code) {
                            await reply('❌ Failed to retrieve pairing code. Please check the number.');
                            break;
                        }

                        await socket.sendMessage(from, { react: { text: '🔑', key: msg.key } });

                        await reply(
`> *PAIR COMPLETED* ✅

*🔑 Your pairing code is:* ${result.code}

📌 *Steps - On your phone:*
 - Open WhatsApp
 - Settings → Linked Devices
 - Link a Device → Link with phone number
 - Enter the 8-digit code

⚠ *Important:*
1. ⏳ Use this code within 1 minute.
2. 🚫 Do not share this code with anyone.
3. 📴 If the bot doesn't connect in 1–3 minutes, log out of the linked device and request a new code.

> ${cfg.BOT_FOOTER}`);

                        await delay(2000);
                        await reply(`${result.code}`);
                    } catch (err) {
                        console.error('Pair command error:', err.message);
                        await reply('❌ An error occurred. Please try again later.');
                    }
                    break;
                }

                case 'pastpaper':
                case 'pp': {
                    const q = body.split(/\s+/).slice(1).join(' ').trim();
                    if (!q) {
                        await reply(`📚 Usage: ${P}pastpaper grade 11 maths`);
                        break;
                    }
                    if (!config.PASTPAPER_SEARCH_URL) {
                        await reply('⚠️ PASTPAPER_SEARCH_URL is not configured.');
                        break;
                    }
                    try {
                        const { data } = await axios.get(config.PASTPAPER_SEARCH_URL, {
                            params: { q, query: q, api_key: config.API_KEY },
                            timeout: 30000
                        });
                        const raw = data?.data ?? data?.result ?? [];
                        const list = (Array.isArray(raw) ? raw : raw.results || []).slice(0, 10);
                        if (!list.length) {
                            await reply('❌ No past papers found.');
                            break;
                        }
                        const text = list
                            .map((p, i) => `*${i + 1}. ${p.title}*\n🔗 ${p.link || p.url}`)
                            .join('\n\n');
                        await reply(formatMessage(
                            '📚 PAST PAPERS',
                            `${text}\n\n💡 PDF ekak ganna: ${P}pastdl <link>`,
                            cfg.BOT_FOOTER
                        ));
                    } catch (err) {
                        console.error('Pastpaper error:', err.message);
                        await reply('❌ Search failed. Please try again later.');
                    }
                    break;
                }

                case 'pastdl': {
                    const link = body.split(/\s+/)[1];
                    if (!link || !/^https?:\/\/pastpapers\.wiki\//i.test(link)) {
                        await reply(`Usage: ${P}pastdl https://pastpapers.wiki/...`);
                        break;
                    }
                    if (!config.PASTPAPER_DETAIL_URL) {
                        await reply('⚠️ PASTPAPER_DETAIL_URL is not configured.');
                        break;
                    }
                    try {
                        const { data } = await axios.get(config.PASTPAPER_DETAIL_URL, {
                            params: { url: link, api_key: config.API_KEY },
                            timeout: 30000
                        });
                        const info = data?.data ?? data?.result;
                        const files = info?.downloads || info?.download_links || [];
                        const found = files.find(f => /pdf/i.test(f.type || '') || /\.pdf($|\?)/i.test(f.url || f.direct_url || ''));
                        const pdf = found ? { url: found.direct_url || found.url } : null;
                        if (!pdf) {
                            await reply('❌ PDF link not found for this paper.');
                            break;
                        }
                        await send(from, {
                            document: { url: pdf.url },
                            mimetype: 'application/pdf',
                            fileName: `${(info.title || 'paper').replace(/[^\w\s|-]/g, '').slice(0, 80)}.pdf`,
                            caption: `📚 ${info.title}`
                        }, { quoted: msg });
                    } catch (err) {
                        console.error('Pastdl error:', err.message);
                        await reply('❌ Could not fetch the paper.');
                    }
                    break;
                }

                case 'fb':
                case 'facebook':
                case 'fbdownload': {
                    const url = body.split(/\s+/)[1];
                    if (!url) {
                        await reply(`*Please provide a valid Facebook video URL!* ❤️\n\nUse: ${P}fb https://www.facebook.com/...`);
                        break;
                    }
                    if (!/^(https?:\/\/)?((www|m|web)\.)?(facebook\.com|fb\.com|fb\.watch)\/\S+/i.test(url)) {
                        await reply('*Invalid Facebook URL! Please check and try again.* ☹️');
                        break;
                    }
                    try {
                        await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
                        await reply('*Downloading your video...* ❤️');

                        const result = await getFbVideoInfo(url);
                        if (!result || (!result.sd && !result.hd)) {
                            await reply('*Failed to download video. Please try again later.* ☹️');
                            break;
                        }

                        const qualityText = result.hd ? 'HD' : 'SD';
                        const videoUrl = result.hd || result.sd;

                        await sendWithLogo(from, formatMessage(
                            '📥 FB DOWNLOADER',
                            `👻 *Title*: ${result.title || 'Unknown'}\n👻 *Quality*: ${qualityText}`,
                            cfg.BOT_FOOTER
                        ), { quoted: msg });

                        await send(from, {
                            video: { url: videoUrl },
                            caption: `*📥 Downloaded in ${qualityText} quality*\n\n> ${cfg.BOT_FOOTER}`
                        }, { quoted: msg });
                    } catch (err) {
                        console.error('FB download error:', err.message);
                        await reply(`*Error:* ${err.message || 'Download failed'}`);
                    }
                    break;
                }

                case 'ytmp3':
                case 'yta':
                case 'song': {
                    const q = body.split(/\s+/).slice(1).join(' ').trim();
                    if (!q) {
                        await reply(`🎵 Send song name or YouTube link\n\nUse: ${P}song Shape of You`);
                        break;
                    }
                    try {
                        await reply('🔎 Searching YouTube...');
                        const video = await getYoutube(q);
                        if (!video) {
                            await reply('❌ No results found');
                            break;
                        }

                        const caption =
                            `🎵 *${video.title}*\n\n` +
                            `👤 Channel: ${video.author?.name || 'Unknown'}\n` +
                            `⏱ Duration: ${video.timestamp || '-'}\n` +
                            `👀 Views: ${Number(video.views || 0).toLocaleString()}\n` +
                            `🔗 ${video.url}\n\n> ${cfg.BOT_FOOTER}`;

                        try {
                            await send(from, { image: { url: video.thumbnail }, caption }, { quoted: msg });
                        } catch {
                            await reply(caption);
                        }

                        if (video.seconds && video.seconds > 1800) {
                            await reply('❌ Video is too long (max 30 minutes).');
                            break;
                        }

                        await reply('⬇️ Downloading MP3...');
                        try {
                            // 1) API (fast, no ytdl needed)
                            const mp3Url = await getYtmp3Link(video.url);
                            await send(from, {
                                audio: { url: mp3Url },
                                mimetype: 'audio/mpeg'
                            }, { quoted: msg });
                        } catch (apiErr) {
                            // 2) Fallback: old ytdl method
                            console.warn('YTMP3 API failed, using ytdl:', apiErr.message);
                            const audioBuffer = await downloadYoutubeAudio(video.url);
                            await send(from, {
                                audio: audioBuffer,
                                mimetype: 'audio/mp4'
                            }, { quoted: msg });
                        }
                    } catch (err) {
                        console.error('YTMP3 error:', err);
                        await reply('❌ Error while downloading MP3' + (who.canAdmin ? `\n_${String(err.message).slice(0, 150)}_` : ''));
                    }
                    break;
                }

                case 'ytmp4':
                case 'ytv':
                case 'video': {
                    const q = body.split(/\s+/).slice(1).join(' ').trim();
                    if (!q) {
                        await reply(`🎬 Send video name or YouTube link\n\nUse: ${P}video Shape of You`);
                        break;
                    }
                    try {
                        await reply('🔎 Searching YouTube...');
                        const video = await getYoutube(q);
                        if (!video) {
                            await reply('❌ No results found');
                            break;
                        }

                        const caption =
                            `🎬 *${video.title}*\n\n` +
                            `👤 Channel: ${video.author?.name || 'Unknown'}\n` +
                            `⏱ Duration: ${video.timestamp || '-'}\n` +
                            `👀 Views: ${Number(video.views || 0).toLocaleString()}\n` +
                            (video.ago ? `📅 Uploaded: ${video.ago}\n` : '') +
                            `🔗 ${video.url}\n\n> ${cfg.BOT_FOOTER}`;

                        try {
                            await send(from, { image: { url: video.thumbnail }, caption }, { quoted: msg });
                        } catch {
                            await reply(caption);
                        }

                        if (video.seconds && video.seconds > 1800) {
                            await reply('❌ Video is too long (max 30 minutes).');
                            break;
                        }

                        await reply('⬇️ Downloading video...');
                        const vidContent = {
                            mimetype: 'video/mp4',
                            fileName: `${String(video.title || 'youtube_video').replace(/[^\w\s.-]/g, '').slice(0, 60)}.mp4`,
                            caption: `🎬 ${video.title || 'YouTube video'}\n\n> ${cfg.BOT_FOOTER}`,
                            gifPlayback: false
                        };
                        try {
                            // 1) API (fast, no ytdl needed)
                            const mp4Url = await getYtmp4Link(video.url);
                            await send(from, { video: { url: mp4Url }, ...vidContent }, { quoted: msg });
                        } catch (apiErr) {
                            // 2) Fallback: old ytdl method
                            console.warn('YTMP4 API failed, using ytdl:', apiErr.message);
                            const videoBuffer = await downloadYoutubeVideo(video.url);
                            await send(from, { video: videoBuffer, ...vidContent }, { quoted: msg });
                        }
                    } catch (err) {
                        console.error('YTMP4 error:', err);
                        await reply('❌ Error while downloading video' + (who.canAdmin ? `\n_${String(err.message).slice(0, 150)}_` : ''));
                    }
                    break;
                }

                case 'tiktok':
                case 'tt': {
                    const q = body.split(/\s+/)[1];
                    if (!q) {
                        await reply(`📱 Send TikTok link\n\nUse: ${P}tiktok https://vt.tiktok.com/...`);
                        break;
                    }
                    try {
                        await reply('⬇️ Downloading TikTok video...');
                        const { data: res } = await axios.get('https://www.tikwm.com/api/', {
                            params: { url: q, hd: 1 },
                            timeout: 30000
                        });
                        const t = res?.data;
                        const videoUrl = t?.hdplay || t?.play;
                        if (!videoUrl) {
                            await reply('❌ Failed to download TikTok video');
                            break;
                        }

                        const data = {
                            title: t.title,
                            author: t.author?.nickname || t.author?.unique_id,
                            runtime: t.duration,
                            no_watermark: videoUrl
                        };
                        const author = data.author;
                        const caption =
                            `🎵 *${data.title || 'TikTok Video'}*\n\n` +
                            `👤 Author: ${author || 'Unknown'}\n` +
                            (data.runtime ? `⏱ Duration: ${data.runtime}s\n` : '') +
                            `\n> ${cfg.BOT_FOOTER}`;

                        await send(from, {
                            video: { url: data.no_watermark },
                            caption
                        }, { quoted: msg });
                    } catch (err) {
                        console.error('TikTok error:', err.message);
                        await reply('❌ Error while downloading TikTok video' + (who.canAdmin ? `\n_${String(err.message).slice(0, 150)}_` : ''));
                    }
                    break;
                }

                case 'movie':
                case 'kmmovies':
                case 'km': {
                    const query = body.split(/\s+/).slice(1).join(' ').trim();
                    if (!query) {
                        await reply(`🎬 Usage: ${P}movie avatar\n${P}km game of thrones`);
                        break;
                    }
                    try {
                        await reply(`🔍 Searching: *${query}* ...`);
                        const { data } = await axios.get(config.MOVIE_SEARCH_URL, {
                            params: { q: query, api_key: config.API_KEY },
                            timeout: 30000
                        });
                        const raw = data?.data ?? data?.results ?? [];
                        const results = (Array.isArray(raw) ? raw : raw.results || []).slice(0, 15);
                        if (!results.length) {
                            await reply('❌ No results found.');
                            break;
                        }

                        const listText = results
                            .map((it, i) => `*${String(i + 1).padStart(2, '0')}* ➔ 🎥 ${(it.title || 'Movie').slice(0, 40)}`)
                            .join('\n');
                        const listMsg = await send(from, {
                            text: formatMessage(
                                '🎬 MOVIE SEARCH',
                                `🎯 Query: _${query}_\n📊 Total: ${results.length}\n\n${listText}\n\n📌 Reply to this message with a number to get the download links.`,
                                cfg.BOT_FOOTER
                            )
                        }, { quoted: msg });
                        const listId = listMsg?.key?.id;
                        if (!listId) break;

                        const requester = msg.key.participant || from;
                        const handler = async ({ messages: rm }) => {
                            const rmsg = rm?.[0];
                            if (!rmsg?.message) return;
                            const rbody = rmsg.message.ephemeralMessage?.message || rmsg.message;
                            const ext = rbody.extendedTextMessage;
                            if (ext?.contextInfo?.stanzaId !== listId) return;
                            if (rmsg.key.remoteJid !== from) return;
                            if ((rmsg.key.participant || rmsg.key.remoteJid) !== requester) return;

                            const choice = parseInt((ext.text || '').trim(), 10) - 1;
                            if (isNaN(choice) || choice < 0 || choice >= results.length) {
                                await send(from, { text: `⚠️ Invalid choice! Send a number from 1 to ${results.length}.` }, { quoted: rmsg });
                                return;
                            }

                            stop();
                            const item = results[choice];
                            try {
                                await send(from, { text: '⏳ Getting download links...' }, { quoted: rmsg });
                                const { data: info } = await axios.get(config.MOVIE_DETAIL_URL, {
                                    params: { url: item.link || item.url, api_key: config.API_KEY },
                                    timeout: 30000
                                });
                                const d = info?.data ?? info;
                                const links = d?.downloads || d?.download_links || [];
                                if (!links.length) {
                                    await send(from, { text: '❌ No download links found for this title.' }, { quoted: rmsg });
                                    return;
                                }
                                const linkText = links
                                    .map((dl, i) => `*${i + 1}.* 💾 ${dl.quality || dl.name || 'Download'}\n🔗 ${dl.link || dl.url || dl.r2_link}`)
                                    .join('\n\n');
                                const caption = formatMessage(
                                    '🎬 DOWNLOAD LINKS',
                                    `*${d.title || item.title}*\n\n${linkText}`,
                                    cfg.BOT_FOOTER
                                );
                                const poster = d.image || item.image;
                                try {
                                    if (!poster) throw new Error('no poster');
                                    await send(from, { image: { url: poster }, caption }, { quoted: rmsg });
                                } catch {
                                    await send(from, { text: caption }, { quoted: rmsg });
                                }
                            } catch (err) {
                                console.error('Movie detail error:', err.message);
                                await send(from, { text: '❌ Could not get the download links. Try again later.' }, { quoted: rmsg });
                            }
                        };
                        const stop = () => socket.ev.off('messages.upsert', handler);
                        socket.ev.on('messages.upsert', handler);
                        setTimeout(stop, 5 * 60 * 1000);   // selection expires after 5 min
                    } catch (err) {
                        console.error('Movie search error:', err.message);
                        await reply('❌ Search failed. Please try again later.' + (who.canAdmin ? `\n_${String(err.message).slice(0, 150)}_` : ''));
                    }
                    break;
                }

                case 'sinhalasub':
                case 'ss':
                case 'moviebox':
                case 'mb': {
                    const query = body.split(/\s+/).slice(1).join(' ').trim();
                    if (!query) {
                        await reply(`🎬 Usage: ${P}${command} avatar\n${P}${command} game of thrones`);
                        break;
                    }
                    const isMb = command === 'moviebox' || command === 'mb';
                    if (isMb && cfg.MB_REQUEST_JID && from !== cfg.MB_REQUEST_JID && !who.canAdmin) {
                        await reply('⚠️ Please use this command in the movie request group.');
                        break;
                    }
                    const srcName = isMb ? 'MovieBox' : 'SinhalaSub';
                    const searchUrl = isMb ? config.MOVIEBOX_SEARCH_URL : config.SINHALASUB_SEARCH_URL;
                    const detailUrl = isMb ? config.MOVIEBOX_DETAIL_URL : config.SINHALASUB_DETAIL_URL;

                    // Wait (5 min) for a number reply to a specific bot message
                    const requester = msg.key.participant || from;
                    // who asked: used for the "Requested by @user" mention (prefers the phone-number JID)
                    const reqJid = msg.key.participantAlt || msg.key.participantPn || msg.key.participant
                        || (msg.key.fromMe ? jidNormalizedUser(socket.user.id) : from);
                    const userKey = String(reqJid).split('@')[0].split(':')[0];
                    const reqTag = '@' + userKey;
                    const limited = isMb && cfg.MB_DAILY_LIMIT > 0 && !who.canAdmin;
                    if (limited) {
                        const used = await mbGetUsage(userKey);
                        if (used >= cfg.MB_DAILY_LIMIT) {
                            await send(from, { text: `⛔ ${reqTag} your daily limit is over (${used}/${cfg.MB_DAILY_LIMIT}).\nPlease try again tomorrow.`, mentions: [reqJid] }, { quoted: msg });
                            break;
                        }
                    }
                    const awaitPick = (listId, max, onPick) => {
                        const handler = async ({ messages: rm }) => {
                            const rmsg = rm?.[0];
                            if (!rmsg?.message) return;
                            const inner = rmsg.message.ephemeralMessage?.message || rmsg.message;
                            const ext = inner.extendedTextMessage;
                            if (ext?.contextInfo?.stanzaId !== listId) return;
                            if (rmsg.key.remoteJid !== from) return;
                            if ((rmsg.key.participant || rmsg.key.remoteJid) !== requester) return;

                            const n = parseInt((ext.text || '').trim(), 10) - 1;
                            if (isNaN(n) || n < 0 || n >= max) {
                                await send(from, { text: `⚠️ Invalid choice! Send a number from 1 to ${max}.` }, { quoted: rmsg });
                                return;
                            }
                            stop();
                            try {
                                await onPick(n, rmsg);
                            } catch (err) {
                                console.error(`${srcName} error:`, err.message);
                                await send(from, { text: '❌ Something went wrong. Try again later.' }, { quoted: rmsg });
                            }
                        };
                        const stop = () => socket.ev.off('messages.upsert', handler);
                        socket.ev.on('messages.upsert', handler);
                        setTimeout(stop, 5 * 60 * 1000);
                    };

                    try {
                        await reply(`🔍 Searching ${srcName}: *${query}* ...`);
                        const { data } = await axios.get(searchUrl, {
                            params: { q: query, api_key: config.API_KEY },
                            timeout: 30000
                        });
                        const raw = data?.data ?? data?.results ?? [];
                        const results = (Array.isArray(raw) ? raw : raw.results || []).slice(0, 15);
                        if (!results.length) {
                            await reply('❌ No results found.');
                            break;
                        }

                        const isTv = (it) => it.type === 'tvshows' || it.type === 'tv';
                        const listText = results
                            .map((it, i) => `*${String(i + 1).padStart(2, '0')}* ➜ ${isTv(it) ? '📺' : '🎥'} ${(it.title || 'Movie').slice(0, 40)} (${it.year || 'N/A'})`)
                            .join('\n');
                        const listMsg = await send(from, {
                            text: formatMessage(
                                `🎬 ${srcName.toUpperCase()} SEARCH`,
                                `🎯 Query: _${query}_\n📊 Total: ${results.length}\n\n${listText}\n\n📌 Reply to this message with a number.`,
                                cfg.BOT_FOOTER
                            )
                        }, { quoted: msg });
                        if (!listMsg?.key?.id) break;

                        awaitPick(listMsg.key.id, results.length, async (n, rmsg) => {
                            const item = results[n];
                            await send(from, { text: '⏳ Getting details...' }, { quoted: rmsg });

                            const { data: info } = await axios.get(detailUrl, {
                                params: { q: item.link || item.url, api_key: config.API_KEY },
                                timeout: 30000
                            });
                            const d = info?.data || {};
                            const title = d.title || item.title;
                            const poster = d.image || item.image;
                            const sendCard = async (caption, target = from, mentions = []) => {
                                const opts = target === from ? { quoted: rmsg } : {};
                                try {
                                    if (!poster) throw new Error('no poster');
                                    await send(target, { image: { url: poster }, caption, mentions }, opts);
                                } catch {
                                    await send(target, { text: caption, mentions }, opts);
                                }
                            };

                            // ---- TV series: details + episode links ----
                            if (isTv(item)) {
                                const episodes = d.episodes || d.downloads || [];
                                await sendCard(formatMessage(
                                    '📺 TV SERIES',
                                    `*${title}*\n⭐ Rating: ${d.rating || d.imdb || 'N/A'}\n📅 Year: ${d.year || 'N/A'}\n🎬 Episodes: ${episodes.length}`,
                                    cfg.BOT_FOOTER
                                ));
                                if (episodes.length) {
                                    const epText = episodes.slice(0, 15)
                                        .map((ep, i) => `*Episode ${i + 1}:* ${ep.name || ep.title || `Episode ${i + 1}`}\n🔗 ${ep.download_link || ep.link || ep.url}`)
                                        .join('\n\n');
                                    await send(from, { text: formatMessage('📥 EPISODES', epText, cfg.BOT_FOOTER) }, { quoted: rmsg });
                                }
                                return;
                            }

                            // ---- Movie: details + quality list ----
                            const genres = Array.isArray(d.genres) ? d.genres.join(', ') : (d.genres || 'N/A');
                            const story = d.story ? (d.story.length > 220 ? d.story.slice(0, 220) + '...' : d.story) : 'N/A';
                            const movieBody = `*${title}*\n⭐ IMDB: ${d.imdb || d.rating || 'N/A'}\n📅 Year: ${d.year || 'N/A'}\n⏳ Duration: ${d.duration || 'N/A'}\n🌍 Country: ${d.country || 'N/A'}\n🎭 Genres: ${genres}\n📝 Story: ${story}`;
                            const movieCard = formatMessage('🎬 MOVIE DETAILS', movieBody, cfg.BOT_FOOTER);
                            // card for the upload group: also says who requested it
                            const movieCardGroup = formatMessage('🎬 MOVIE DETAILS', `${movieBody}\n\n👤 *Requested by:* ${reqTag}`, cfg.BOT_FOOTER);
                            await sendCard(movieCard);

                            const downloads = d.downloads || [];
                            if (!downloads.length) {
                                await send(from, { text: '⚠️ No direct downloads available for this movie right now.' }, { quoted: rmsg });
                                return;
                            }
                            const qText = downloads
                                .map((dl, i) => `*${String(i + 1).padStart(2, '0')}* ➜ 💾 ${dl.quality || 'Direct MP4'} (${dl.size || 'Direct'})`)
                                .join('\n');
                            const qMsg = await send(from, {
                                text: formatMessage('📥 DOWNLOAD QUALITIES', `${qText}\n\n📌 Reply to this message with a number to get the file.`, cfg.BOT_FOOTER)
                            }, { quoted: rmsg });
                            if (!qMsg?.key?.id) return;

                            awaitPick(qMsg.key.id, downloads.length, async (qn, qrmsg) => {
                                const dl = downloads[qn];
                                const fileUrl = dl.link || dl.download_link || dl.direct_link;
                                // .mb files go to the configured group (if set), everything else to this chat
                                const toGroup = isMb && !!cfg.MB_UPLOAD_JID;
                                const fileTarget = toGroup ? cfg.MB_UPLOAD_JID : from;
                                // daily limit check again (the user may have several lists open)
                                if (limited && (await mbGetUsage(userKey)) >= cfg.MB_DAILY_LIMIT) {
                                    await send(from, { text: `⛔ ${reqTag} your daily limit is over (${cfg.MB_DAILY_LIMIT}/${cfg.MB_DAILY_LIMIT}).\nPlease try again tomorrow.`, mentions: [reqJid] }, { quoted: qrmsg });
                                    return;
                                }

                                const doUpload = async () => {
                                    try {
                                        if (toGroup) await sendCard(movieCardGroup, fileTarget, [reqJid]);   // details card first
                                        await send(fileTarget, {
                                            document: { url: fileUrl },
                                            mimetype: 'video/mp4',
                                            fileName: `${title} (${dl.quality || 'HD'}).mp4`.replace(/[\\/:*?"<>|]/g, ''),
                                            caption: formatMessage('🎬 MOVIE', `*${title}*\n📊 Quality: ${dl.quality || 'HD'}\n💾 Size: ${dl.size || 'Direct'}${toGroup ? `\n\n👤 Requested by: ${reqTag}` : ''}`, cfg.BOT_FOOTER),
                                            mentions: toGroup ? [reqJid] : []
                                        }, toGroup ? {} : { quoted: qrmsg });
                                        if (toGroup) await send(from, { text: `✅ ${reqTag} *${title}* (${dl.quality || 'HD'}) was sent to the upload group.`, mentions: [reqJid] }, { quoted: qrmsg });
                                    } catch (sendErr) {
                                        console.error(`${srcName} upload error:`, sendErr.message);
                                        await send(from, { text: `⚠️ Could not upload the file.\n\n🔗 Direct link:\n${fileUrl}` }, { quoted: qrmsg });
                                    }
                                };

                                // Not the group flow: upload right away in this chat
                                if (!toGroup) {
                                    if (limited) await mbAddUsage(userKey);
                                    await send(from, { text: `📤 Sending *${title}* (${dl.quality || 'HD'}) ...\n_Large files can take a few minutes._` }, { quoted: qrmsg });
                                    await doUpload();
                                    return;
                                }

                                // Group flow: one upload at a time, in the order requested
                                if (mbQueueHas(fileUrl)) {
                                    await send(from, { text: `⚠️ *${title}* (${dl.quality || 'HD'}) is already in the upload queue.` }, { quoted: qrmsg });
                                    return;
                                }
                                const usedNow = limited ? await mbAddUsage(userKey) : 0;
                                const usageLine = limited ? `\n📊 Today: *${usedNow}/${cfg.MB_DAILY_LIMIT}* requests` : '';
                                let myPosition = 0;
                                myPosition = mbEnqueue(fileUrl, async () => {
                                    if (myPosition > 1) {
                                        await send(from, { text: `📤 ${reqTag} it's your turn! Uploading *${title}* (${dl.quality || 'HD'}) to the group now...\n_Large files can take a few minutes._`, mentions: [reqJid] }, { quoted: qrmsg });
                                    }
                                    await doUpload();
                                });
                                await send(from, {
                                    text: myPosition > 1
                                        ? `🕐 ${reqTag} *${title}* (${dl.quality || 'HD'}) added to the upload queue.\n📍 Position: *${myPosition}*\n_It will start automatically after the earlier uploads finish._${usageLine}`
                                        : `📤 ${reqTag} uploading *${title}* (${dl.quality || 'HD'}) to the group...\n_Large files can take a few minutes._${usageLine}`,
                                    mentions: [reqJid]
                                }, { quoted: qrmsg });
                            });
                        });
                    } catch (err) {
                        console.error(`${srcName} search error:`, err.message);
                        await reply('❌ Search failed. Please try again later.' + (who.canAdmin ? `\n_${String(err.message).slice(0, 150)}_` : ''));
                    }
                    break;
                }

                case 'ss2': {
                    const query = body.split(/\s+/).slice(1).join(' ').trim();
                    if (!query) {
                        await reply(`🎬 Usage: ${P}ss2 avengers`);
                        break;
                    }

                    // Wait (5 min) for a number reply to a specific bot message
                    const requester = msg.key.participant || from;
                    const awaitPick = (listId, max, onPick) => {
                        const handler = async ({ messages: rm }) => {
                            const rmsg = rm?.[0];
                            if (!rmsg?.message) return;
                            const inner = rmsg.message.ephemeralMessage?.message || rmsg.message;
                            const ext = inner.extendedTextMessage;
                            if (ext?.contextInfo?.stanzaId !== listId) return;
                            if (rmsg.key.remoteJid !== from) return;
                            if ((rmsg.key.participant || rmsg.key.remoteJid) !== requester) return;

                            const n = parseInt((ext.text || '').trim(), 10) - 1;
                            if (isNaN(n) || n < 0 || n >= max) {
                                await send(from, { text: `⚠️ Invalid choice! Send a number from 1 to ${max}.` }, { quoted: rmsg });
                                return;
                            }
                            stop();
                            try {
                                await onPick(n, rmsg);
                            } catch (err) {
                                console.error('SS2 error:', err.message);
                                await send(from, {
                                    text: err.message === 'busy'
                                        ? '⏳ Server is busy right now. Try again in a minute.'
                                        : '❌ Something went wrong. Try again later.'
                                }, { quoted: rmsg });
                            }
                        };
                        const stop = () => socket.ev.off('messages.upsert', handler);
                        socket.ev.on('messages.upsert', handler);
                        setTimeout(stop, 5 * 60 * 1000);
                    };

                    let results;
                    try {
                        await reply('🔍 Searching SinhalaSub.lk ...');
                        results = await ss2Search(query);
                    } catch (err) {
                        console.error('SS2 search error:', err.message);
                        await reply(err.message === 'busy'
                            ? '⏳ Server is busy right now. Try again in a minute.'
                            : '❌ Search failed. Please try again later.' + (who.canAdmin ? `\n_${String(err.message).slice(0, 150)}_` : ''));
                        break;
                    }
                    if (!results.length) {
                        await reply('❌ No movies found!');
                        break;
                    }

                    const listText = results
                        .map((it, i) => `*${i + 1}.* ${it.title}\n   📝 ${it.language || 'N/A'}  📊 ${it.quality || 'N/A'}  🎞️ ${it.qty || 'N/A'}`)
                        .join('\n');
                    const listMsg = await send(from, {
                        text: formatMessage('🎬 SS2 SEARCH', `${listText}\n\n📌 Reply to this message with a number (1-${results.length}).`, cfg.BOT_FOOTER)
                    }, { quoted: msg });
                    if (!listMsg?.key?.id) break;

                    awaitPick(listMsg.key.id, results.length, async (n, rmsg) => {
                        const sel = results[n];
                        await send(from, { text: '⏳ Getting details & download links... (can take up to a minute)' }, { quoted: rmsg });

                        const { metadata: md, links } = await ss2Movie(sel.movieUrl);
                        const card = formatMessage(
                            `🎬 ${md.title || sel.title}`,
                            `📝 Language: ${md.language || 'N/A'}\n⏱️ Duration: ${md.duration || 'N/A'}\n⭐ IMDb: ${md.imdb || 'N/A'}\n🎭 Genres: ${md.genres.join(', ') || 'N/A'}\n🎥 Directors: ${md.directors.join(', ') || 'N/A'}\n🌟 Stars: ${md.stars.slice(0, 5).join(', ') || 'N/A'}${md.stars.length > 5 ? '...' : ''}`,
                            cfg.BOT_FOOTER
                        );
                        try {
                            if (!md.thumbnail) throw new Error('no poster');
                            await send(from, { image: { url: md.thumbnail }, caption: card }, { quoted: rmsg });
                        } catch {
                            await send(from, { text: card }, { quoted: rmsg });
                        }

                        if (!links.length) {
                            await send(from, { text: '❌ No download links found (under 2GB).' }, { quoted: rmsg });
                            return;
                        }
                        const qText = links.map((d, i) => `*${i + 1}.* 💾 ${d.quality} - ${d.size}`).join('\n');
                        const qMsg = await send(from, {
                            text: formatMessage('📥 QUALITIES (max 2GB)', `${qText}\n\n📌 Reply to this message with a number to get the movie as a document.`, cfg.BOT_FOOTER)
                        }, { quoted: rmsg });
                        if (!qMsg?.key?.id) return;

                        awaitPick(qMsg.key.id, links.length, async (qn, qrmsg) => {
                            const dl = links[qn];
                            const title = md.title || sel.title;
                            await send(from, { text: `📤 Sending *${dl.quality}* ...\n_Large files can take a few minutes._` }, { quoted: qrmsg });
                            try {
                                await send(from, {
                                    document: { url: ss2PixeldrainDirect(dl.link) },
                                    mimetype: 'video/mp4',
                                    fileName: `${title.slice(0, 50)} - ${dl.quality}.mp4`.replace(/[^\w\s.-]/gi, ''),
                                    caption: formatMessage('🎬 MOVIE', `*${title}*\n📊 Quality: ${dl.quality}\n💾 Size: ${dl.size}\n\nEnjoy your movie! 🍿`, cfg.BOT_FOOTER)
                                }, { quoted: qrmsg });
                            } catch (sendErr) {
                                console.error('SS2 upload error:', sendErr.message);
                                await send(from, { text: `⚠️ Could not upload the file.\n\n🔗 Direct link:\n${ss2PixeldrainDirect(dl.link)}` }, { quoted: qrmsg });
                            }
                        });
                    });
                    break;
                }

                case 'group': {
                    await reply(`👥 ${config.GROUP_INVITE_LINK}`);
                    break;
                }
            }
        });

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code (retries left: ${retries}):`, error.message);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            // Save creds to Firebase
            await axios.put(`${FIREBASE_URL}/session/creds_${sanitizedNumber}.json`, JSON.parse(fileContent));
            console.log(`Updated creds for ${sanitizedNumber} in Firebase`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    activeSockets.set(sanitizedNumber, socket);

                    // 1) Send the connected message first so it always arrives
                    await socket.sendMessage(userJid, {
                        image: logoSource(cfg),
                        caption: formatMessage(
                            cfg.BOT_NAME,
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n\n⚙️ Send *${cfg.PREFIX}settings* to open the Control Panel`,
                            cfg.BOT_FOOTER
                        )
                    });

                    // 2) Group join + channel follow in the background (never blocks / crashes the bot)
                    (async () => {
                        try {
                            console.log('➡️ Joining group...');
                            const groupResult = await withTimeout(joinGroup(socket), 30000, 'joinGroup')
                                .catch(e => ({ status: 'failed', error: e.message }));
                            console.log('👥 Group result:', groupResult);

                            console.log('➡️ Following newsletters...');
                            const followedCount = await autoFollowNewsletters(socket);
                            console.log(`📢 Newsletters followed: ${followedCount}`);

                            const groupStatus =
                                groupResult.status === 'success' ? '✅ Joined group' :
                                groupResult.status === 'already_member' ? '✅ Already in group' :
                                `❌ Group join failed: ${groupResult.error}`;

                            await socket.sendMessage(userJid, {
                                text: `${groupStatus}\n📢 Channels followed: ${followedCount}`
                            });
                        } catch (e) {
                            console.error('Post-connect tasks error:', e);
                        }
                    })();

                    // Numbers list in Firebase
                    let numbers = [];
                    const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
                    if (numbersRes.data) {
                        numbers = numbersRes.data;
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        await axios.put(`${FIREBASE_URL}/numbers.json`, numbers);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${PM2_NAME}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: `👻 ${config.BOT_NAME} is running`,
        activesession: activeSockets.size
    });
});

// GET /botinfo - returns detailed info for each active bot
router.get('/botinfo', async (req, res) => {
    try {
        const bots = Array.from(activeSockets.entries()).map(([number, socket]) => {
            const startTime = socketCreationTime.get(number) || Date.now();
            const uptime = Math.floor((Date.now() - startTime) / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);

            return {
                number: number,
                status: socket.ws && socket.ws.readyState === 1 ? 'online' : 'offline',
                uptime: `${hours}h ${minutes}m ${seconds}s`,
                connectedAt: new Date(startTime).toLocaleString('en-US', { timeZone: 'Asia/Colombo' }),
            };
        });

        res.json({
            count: bots.length,
            bots
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get bot info', details: err.message });
    }
});

router.get('/connect-all', async (req, res) => {
    try {
        // Load numbers from Firebase
        const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
        const numbers = numbersRes.data || [];
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        // Load session creds from Firebase
        const { data } = await axios.get(`${FIREBASE_URL}/session.json`);
        const sessionKeys = Object.keys(data || {}).filter(key =>
            key.startsWith('creds_')
        );

        if (sessionKeys.length === 0) {
            return res.status(404).send({ error: 'No session files found in Firebase' });
        }

        const results = [];
        for (const key of sessionKeys) {
            const match = key.match(/creds_(\d+)/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${key}`);
                results.push({ file: key, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    config.BOT_FOOTER
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${PM2_NAME}`);
});


async function autoReconnectFromFirebase() {
    try {
        const numbersRes = await axios.get(`${FIREBASE_URL}/numbers.json`);
        const numbers = numbersRes.data || [];
        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from Firebase: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromFirebase error:', error.message);
    }
}
autoReconnectFromFirebase();

module.exports = router;
