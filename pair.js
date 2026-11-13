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
    BOT_NAME: 'Luzzy MD',
    BOT_FOOTER: 'Luzzy MD',
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/EacsLrooJri9pd4GPN9XtY?s=cl&p=a&iam=2',
    RCD_IMAGE_PATH: 'https://d.uguu.se/ANoxcART.jpg',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94742549935',
    // Your deployed domain (no trailing slash). Falls back to this same server.
    // Raw URL of a JSON array of newsletter JIDs, e.g. ["120363...@newsletter"]
    NEWSLETTER_LIST_URL: process.env.NEWSLETTER_LIST_URL || '',
    PAIR_BASE: process.env.PAIR_BASE || `http://localhost:${process.env.PORT || 8000}`
};

const PM2_NAME = process.env.PM2_NAME || 'LUZZY-MD';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}


function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
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

        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            config.BOT_FOOTER
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
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
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            config.BOT_FOOTER
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
                await socket.newsletterFollow(jid);
                followed++;
                console.log(`✅ Followed newsletter: ${jid}`);
            } catch (err) {
                console.warn(`⚠️ Failed to follow ${jid}:`, err.message);
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

        setupAutoRestart(socket, sanitizedNumber);
        handleMessageRevocation(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);

        // ===== Commands =====
        socket.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg || !msg.message) return;

            const from = msg.key.remoteJid;
            const body =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                '';

            if (!body.startsWith(config.PREFIX)) return;
            const command = body.slice(config.PREFIX.length).trim().split(/\s+/)[0].toLowerCase();

            const reply = (text) => socket.sendMessage(from, { text }, { quoted: msg });
            const P = config.PREFIX;

            switch (command) {
                case 'menu':
                case 'help':
                case 'list': {
                    const menuText =
`╭━━━〔 *${config.BOT_NAME}* 〕━━━╮
┃ 👋 Hi! Bot Command Menu
┃ 🔰 Prefix : ${P}
╰━━━━━━━━━━━━━━━╯

╭─「 🤖 *BOT* 」
│ ${P}menu  - සියලු commands
│ ${P}ping  - Bot speed
│ ${P}alive - Bot online ද බලන්න
│ ${P}runtime - Bot run වුණ කාලය
╰─────────────

╭─「 🛠️ *TOOLS* 」
│ ${P}time  - ශ්‍රී ලංකා වෙලාව
│ ${P}date  - අද දිනය
│ ${P}id    - Chat / User ID
│ ${P}owner - Owner number
│ ${P}repeat <text> - Text repeat
│ ${P}calc <2+2> - Calculator
│ ${P}flip  - Coin flip
│ ${P}dice  - Dice roll
╰─────────────

╭─「 👥 *GROUP* 」
│ ${P}group - Group link
│ ${P}pair +947XXXXXXX - Pairing code
╰─────────────`;
                    await socket.sendMessage(from, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(config.BOT_NAME, menuText, config.BOT_FOOTER)
                    }, { quoted: msg });
                    break;
                }

                case 'ping': {
                    const start = Date.now();
                    const sent = await socket.sendMessage(from, { text: '🏓 Pinging...' }, { quoted: msg });
                    const latency = Date.now() - start;
                    await socket.sendMessage(from, {
                        text: formatMessage(config.BOT_NAME, `🏓 Pong!\n⚡ Speed: ${latency}ms`, config.BOT_FOOTER),
                        edit: sent.key
                    });
                    break;
                }

                case 'alive': {
                    await reply(formatMessage(config.BOT_NAME, '✅ Bot online & working!', config.BOT_FOOTER));
                    break;
                }

                case 'runtime': {
                    const up = Date.now() - (socketCreationTime.get(sanitizedNumber) || Date.now());
                    const d = Math.floor(up / 86400000);
                    const h = Math.floor(up / 3600000) % 24;
                    const m = Math.floor(up / 60000) % 60;
                    const sec = Math.floor(up / 1000) % 60;
                    await reply(`⏱️ Runtime: ${d}d ${h}h ${m}m ${sec}s`);
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
                    const number = body.slice(config.PREFIX.length + 4).trim();
                    const sender = msg.key.participant || from;

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

> ${config.BOT_FOOTER}`);

                        await delay(2000);
                        await reply(`${result.code}`);
                    } catch (err) {
                        console.error('Pair command error:', err.message);
                        await reply('❌ An error occurred. Please try again later.');
                    }
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

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupResult = await joinGroup(socket);
                    const followedCount = await autoFollowNewsletters(socket);
                    const groupStatus =
                        groupResult.status === 'success' ? '✅ Joined group' :
                        groupResult.status === 'already_member' ? '✅ Already in group' :
                        `❌ Group join failed: ${groupResult.error}`;

                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            config.BOT_NAME,
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n👥 ${groupStatus}\n📢 Channels followed: ${followedCount}\n`,
                            config.BOT_FOOTER
                        )
                    });

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
