'use strict';
const https = require('https');
const http  = require('http');
const OpenAI = require('openai');

class AIScanner {
    constructor(apiKey) { this.openai = new OpenAI({ apiKey }); }

    async scanSite(url, maxChars = 10000) {
        const rawHtml = await this._fetchUrl(url);
        const text = this._htmlToText(rawHtml).slice(0, maxChars);
        return this._extractFacts(text, url);
    }

    _fetchUrl(url, timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            const lib = url.startsWith('https') ? https : http;
            const req = lib.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'OMEX-Demo-Scanner/1.0', 'Accept': 'text/html' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return this._fetchUrl(res.headers.location, timeoutMs).then(resolve).catch(reject);
                }
                let data = '';
                res.setEncoding('utf8');
                res.on('data', c => { data += c; if (data.length > 300000) req.destroy(); });
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        });
    }

    _htmlToText(html) {
        return html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<head[\s\S]*?<\/head>/gi, ' ')
            .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')
            .replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();
    }

    async _extractFacts(text, url) {
        const prompt = `Analiza el texto de este sitio web (${url}) y devuelve SOLO JSON valido con esta estructura (omite campos sin datos):
{"company_name":"nombre","description":"descripcion corta","services":["s1","s2"],"products":["p1"],"location":"Ciudad, Pais","hours":"horario","phone":"+52...","email":"correo","booking_url":"url agenda","price_range":"rango precios","differentiators":["ventaja1"]}

TEXTO: ${text.slice(0, 7000)}`;

        const res = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600, temperature: 0.1,
            response_format: { type: 'json_object' },
        });
        try { return JSON.parse(res.choices[0]?.message?.content || '{}'); } catch { return {}; }
    }
}
module.exports = AIScanner;
