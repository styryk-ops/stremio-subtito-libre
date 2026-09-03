// server.js
// Addon de Stremio: busca subtitulos en ingles bien sincronizados (OpenSubtitles),
// los traduce al espanol con IA (Gemini -> Mistral -> Grok, con fallback automatico
// por cuota agotada) y sirve el resultado con los timestamps ORIGINALES intactos.

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { findEnglishSubtitleUrl, downloadSrt } = require('./lib/opensubtitles');
const { parseSrt, buildSrt } = require('./lib/srt');
const { translateBlocks } = require('./lib/translate');

const PORT = process.env.PORT || 7000;
const TARGET_LANG = process.env.TARGET_LANG || 'spa';
const CACHE_DIR = path.join(__dirname, 'cache');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const app = express();

// Permite que Stremio (desde cualquier dispositivo: PC, celular, Smart TV)
// pueda pedirle datos a este addon. Sin esto, el navegador/Stremio bloquea
// el pedido por seguridad (CORS) y da "Failed to fetch".
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ---------- Manifest ----------
const manifest = {
  id: 'community.subtitolibre',
  version: '1.0.0',
  name: 'Subtito Libre',
  description: 'Traduce subtitulos en ingles al espanol con IA (Gemini/Mistral/Grok), gratis y con tu propia API key.',
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
};

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(manifest));
});

// ---------- Utilidad de cache ----------
function cacheKeyFor(sourceUrl) {
  return crypto.createHash('sha256').update(sourceUrl + TARGET_LANG).digest('hex');
}

function cachePathFor(key) {
  return path.join(CACHE_DIR, `${key}.srt`);
}

// ---------- Endpoint de subtitulos (lo que consulta Stremio) ----------
// Stremio a veces pide /subtitles/:type/:id.json y a veces
// /subtitles/:type/:id/:extra.json (con datos extra como el hash del video).
// Registramos ambas rutas apuntando al mismo handler para no perder pedidos,
// que es la causa mas comun de que un addon de subtitulos "no aparezca".
async function subtitlesHandler(req, res) {
  try {
    const { type } = req.params;
    const id = decodeURIComponent(req.params.id);

    console.log(`[subtitles] pedido recibido: type=${type} id=${id}`);

    const sourceUrl = await findEnglishSubtitleUrl(type, id);
    if (!sourceUrl) {
      console.log('[subtitles] no se encontro subtitulo en ingles para este contenido');
      return res.json({ subtitles: [] });
    }

    const key = cacheKeyFor(sourceUrl);
    const cachePath = cachePathFor(key);

    // Si ya esta traducido y cacheado, lo servimos directo sin gastar tokens de nuevo
    if (!fs.existsSync(cachePath)) {
      console.log(`[subtitles] traduciendo subtitulo nuevo: ${sourceUrl}`);
      const rawSrt = await downloadSrt(sourceUrl);
      const blocks = parseSrt(rawSrt);
      const translatedBlocks = await translateBlocks(blocks);
      const outSrt = buildSrt(translatedBlocks);
      fs.writeFileSync(cachePath, outSrt, 'utf8');
    } else {
      console.log(`[subtitles] usando cache: ${cachePath}`);
    }

    const publicUrl = `${req.protocol}://${req.get('host')}/subs/${key}.srt`;

    res.json({
      subtitles: [
        {
          id: `subtitolibre-${key}`,
          url: publicUrl,
          lang: TARGET_LANG,
        },
      ],
    });
  } catch (err) {
    console.error('[subtitles] error:', err.message);
    res.json({ subtitles: [] }); // Stremio prefiere lista vacia antes que un error duro
  }
}

app.get('/subtitles/:type/:id.json', subtitlesHandler);
app.get('/subtitles/:type/:id/:extra.json', subtitlesHandler);

// ---------- Sirve los .srt ya traducidos y cacheados ----------
app.get('/subs/:key.srt', (req, res) => {
  const cachePath = cachePathFor(req.params.key);
  if (!fs.existsSync(cachePath)) return res.status(404).send('No encontrado');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(cachePath);
});

app.listen(PORT, () => {
  console.log(`Addon corriendo en http://127.0.0.1:${PORT}/manifest.json`);
  console.log('Para instalarlo en Stremio: pega esa URL en "Instalar addon desde URL".');
});
