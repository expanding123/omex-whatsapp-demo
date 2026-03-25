'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const { v4: uuidv4 } = require('uuid');

const SessionManager = require('./session-manager');
const AIScanner      = require('./ai-scanner');

const app    = express();
const server = http.createServer(app);

const PORT        = process.env.PORT          || 3099;
const SECRET_KEY  = process.env.DEMO_SECRET   || 'cambiar-en-railway-variables';
const SESSION_TTL = parseInt(process.env.DEMO_TTL_MIN || '30') * 60 * 1000;
const WP_ORIGIN   = process.env.WP_ORIGIN     || '*';

const io = new Server(server, {
    cors: { origin: WP_ORIGIN === '*' ? '*' : [WP_ORIGIN], methods: ['GET', 'POST'] },
    allowEIO3: true,
    transports: ['websocket', 'polling'],
});

app.use(cors({ origin: WP_ORIGIN === '*' ? '*' : [WP_ORIGIN] }));
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

function authMiddleware(req, res, next) {
    const key = req.headers['x-omex-demo-key'] || req.body?.secret;
    if (key !== SECRET_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
    next();
}

const sessions = new SessionManager(io, SESSION_TTL);

app.post('/demo/create', authMiddleware, async (req, res) => {
    const { company, services, site_url, openai_key } = req.body;
    if (!company || !openai_key) return res.status(400).json({ ok: false, error: 'company y openai_key requeridos' });
    const MAX = parseInt(process.env.MAX_SESSIONS || '3');
    if (sessions.count() >= MAX) return res.status(503).json({ ok: false, error: 'Demo lleno, espera un momento.' });

    const sessionId = uuidv4();
    const systemPrompt = buildBasePrompt(company, services);

    try {
        // Crear sesión INMEDIATAMENTE con prompt base (sin esperar el scan)
        await sessions.create(sessionId, { company, services, site_url, systemPrompt, scanFacts: null, openaiKey: openai_key });

        // Responder de inmediato
        res.json({ ok: true, session_id: sessionId, scan_facts: null });

        // Escanear en BACKGROUND y actualizar el prompt cuando termine
        if (site_url && site_url.startsWith('http')) {
            (async () => {
                try {
                    const scanner = new AIScanner(openai_key);
                    const scanFacts = await scanner.scanSite(site_url);
                    const updatedPrompt = buildPromptFromFacts(company, services, scanFacts);
                    const session = sessions.get(sessionId);
                    if (session) {
                        session.config.systemPrompt = updatedPrompt;
                        session.config.scanFacts = scanFacts;
                        io.to('session:' + sessionId).emit('scan_complete', { scan_facts: scanFacts });
                        console.log('[Demo] Scan completado para', sessionId);
                    }
                } catch (e) {
                    console.warn('[Demo] Scan background fallo:', e.message);
                }
            })();
        }
    } catch (err) {
        console.error('[Demo] Error en /create:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('/demo/status/:sessionId', authMiddleware, (req, res) => {
    const s = sessions.get(req.params.sessionId);
    if (!s) return res.json({ ok: true, status: 'not_found' });
    res.json({ ok: true, status: s.status, company: s.config.company, qr: s.qr || null, messages: s.messageCount || 0 });
});

app.post('/demo/destroy/:sessionId', authMiddleware, async (req, res) => {
    await sessions.destroy(req.params.sessionId);
    res.json({ ok: true });
});

app.get('/demo/list', authMiddleware, (req, res) => res.json({ ok: true, sessions: sessions.list() }));

app.get('/health', (req, res) => res.json({ ok: true, service: 'omex-demo', sessions: sessions.count(), uptime: Math.floor(process.uptime()) + 's', node: process.version }));

io.on('connection', (socket) => {
    socket.on('subscribe', ({ session_id }) => {
        if (!session_id) return;
        socket.join('session:' + session_id);
        const s = sessions.get(session_id);
        if (s?.qr) socket.emit('qr', { qr: s.qr });
        if (s?.status === 'connected') socket.emit('connected', { company: s.config.company });
    });
});

function buildBasePrompt(company, services) {
    return ['Eres asesor de ' + company + ' por WhatsApp.', services ? 'Servicios: ' + services : '', 'REGLAS: Mensajes cortos, 1 pregunta por turno, tono humano, no inventes precios.', 'OBJETIVO: Entender necesidad y cerrar con cotizacion o videollamada.'].filter(Boolean).join(' ');
}

function buildPromptFromFacts(company, services, facts) {
    const lines = ['Eres asesor de ' + company + ' por WhatsApp.'];
    if (facts.description) lines.push('Empresa: ' + facts.description);
    if (facts.services?.length) lines.push('Servicios: ' + facts.services.slice(0,8).join(', '));
    if (facts.location) lines.push('Ubicacion: ' + facts.location);
    if (facts.hours) lines.push('Horario: ' + facts.hours);
    if (services) lines.push('Info: ' + services);
    lines.push('REGLAS: Mensajes cortos. 1 pregunta por turno. No inventes precios.');
    return lines.join('\n');
}

server.listen(PORT, '0.0.0.0', () => { console.log('[OMEX Demo] Puerto ' + PORT); });
