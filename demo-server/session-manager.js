'use strict';
const { Client, NoAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const qrcode = require('qrcode');

class SessionManager {
    constructor(io, ttlMs = 30 * 60 * 1000) {
        this.io = io; this.ttlMs = ttlMs; this.store = new Map();
    }
    async create(sessionId, config) {
        const now = Date.now();
        const session = {
            id: sessionId, status: 'pending_qr', config, qr: null, client: null,
            openai: new OpenAI({ apiKey: config.openaiKey }),
            history: [], messageCount: 0,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + this.ttlMs).toISOString(),
            _timer: null,
        };
        session._timer = setTimeout(() => { this.destroy(sessionId); }, this.ttlMs);
        this.store.set(sessionId, session);
        this._bootWhatsApp(session);
        return session;
    }
    _bootWhatsApp(session) {
        const executablePath = process.env.CHROMIUM_PATH || undefined;
        const puppeteerArgs = {
            headless: true,
            args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process','--disable-extensions'],
        };
        if (executablePath) puppeteerArgs.executablePath = executablePath;
        const client = new Client({ authStrategy: new NoAuth(), puppeteer: puppeteerArgs });
        session.client = client;
        client.on('qr', async (qr) => {
            try {
                const url = await qrcode.toDataURL(qr);
                session.qr = url; session.status = 'qr_ready';
                this.io.to('session:' + session.id).emit('qr', { qr: url });
                console.log('[Session] QR listo:', session.id);
            } catch(e) { console.error('QR error:', e.message); }
        });
        client.on('ready', () => {
            session.status = 'connected'; session.qr = null;
            console.log('[Session] Conectado:', session.id);
            this.io.to('session:' + session.id).emit('connected', { company: session.config.company });
        });
        client.on('message', async (msg) => {
            if (msg.fromMe || msg.type !== 'chat') return;
            const text = msg.body.trim();
            if (!text) return;
            session.messageCount++;
            this.io.to('session:' + session.id).emit('message', { direction: 'in', text, ts: Date.now() });
            try {
                const reply = await this._generateReply(session, text);
                await msg.reply(reply);
                this.io.to('session:' + session.id).emit('message', { direction: 'out', text: reply, ts: Date.now() });
            } catch(e) { console.error('Reply error:', e.message); }
        });
        client.on('auth_failure', () => {
            session.status = 'error';
            this.io.to('session:' + session.id).emit('error', { message: 'Fallo de autenticacion' });
        });
        client.on('disconnected', (reason) => {
            if (session.status === 'expired') return;
            session.status = 'disconnected';
            this.io.to('session:' + session.id).emit('disconnected', { reason });
        });
        client.initialize().catch((e) => {
            console.error('WA init error:', e.message);
            session.status = 'error';
            this.io.to('session:' + session.id).emit('error', { message: 'No se pudo iniciar WhatsApp Web' });
        });
    }
    async _generateReply(session, userText) {
        session.history.push({ role: 'user', content: userText });
        if (session.history.length > 24) session.history = session.history.slice(-24);
        const response = await session.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: session.config.systemPrompt }, ...session.history],
            max_tokens: 300, temperature: 0.7,
        });
        const reply = response.choices[0]?.message?.content?.trim() || '¡Gracias por escribir! ¿En que te puedo ayudar?';
        session.history.push({ role: 'assistant', content: reply });
        return reply;
    }
    async destroy(sessionId) {
        const session = this.store.get(sessionId);
        if (!session) return;
        session.status = 'expired';
        clearTimeout(session._timer);
        try { if (session.client) await session.client.destroy(); } catch(e) {}
        this.store.delete(sessionId);
        this.io.to('session:' + sessionId).emit('expired', { session_id: sessionId });
        console.log('[Session] Destruida:', sessionId);
    }
    get(id) { return this.store.get(id) || null; }
    count() { return this.store.size; }
    list() {
        return [...this.store.values()].map(s => ({
            id: s.id, status: s.status, company: s.config.company,
            messages: s.messageCount, created_at: s.createdAt, expires_at: s.expiresAt,
        }));
    }
}
module.exports = SessionManager;
