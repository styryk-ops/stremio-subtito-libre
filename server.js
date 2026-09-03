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

// Stremio a veces manda el mismo pedido de subtitulo dos veces casi
// simultaneas (por ejemplo al mostrar la vista previa y al arrancar la
// reproduccion). Sin esto, cada pedido dispara su propia traduccion completa
// en paralelo, gastando el doble de cuota de las APIs por nada. Este mapa
// guarda la traduccion "en curso" por clave, asi el segundo pedido espera el
// mismo resultado del primero en vez de arrancar una traduccion nueva.
const inFlightTranslations = new Map();

async function getOrTranslate(sourceUrl) {
  const key = cacheKeyFor(sourceUrl);
  const cachePath = cachePathFor(key);

  if (fs.existsSync(cachePath)) {
    console.log(`[subtitles] usando cache: ${cachePath}`);
    return key;
  }

  if (inFlightTranslations.has(key)) {
    console.log('[subtitles] ya hay una traduccion de este subtitulo en curso, esperando esa misma...');
    await inFlightTranslations.get(key);
    return key;
  }

  const job = (async () => {
    console.log(`[subtitles] traduciendo subtitulo nuevo: ${sourceUrl}`);
    const rawSrt = await downloadSrt(sourceUrl);
    const blocks = parseSrt(rawSrt);
    const translatedBlocks = await translateBlocks(blocks);
    const outSrt = buildSrt(translatedBlocks);
    fs.writeFileSync(cachePath, outSrt, 'utf8');
  })();

  inFlightTranslations.set(key, job);
  try {
    await job;
  } finally {
    inFlightTranslations.delete(key);
  }

  return key;
}

// ---------- Endpoint de subtitulos (lo que consulta Stremio) ----------
// Stremio a veces pide /subtitles/:type/:id.json y a veces
// /subtitles/:type/:id/:extra.json (con datos extra como el hash del video).
// Registramos ambas rutas apuntando al mismo handler para no perder pedidos,
// que es la causa mas comun de que un addon de subtitulos "no aparezca".
//
// IMPORTANTE: este handler NO traduce nada todavia. Solo busca si existe un
// subtitulo en ingles y devuelve la URL donde Stremio puede buscarlo. Stremio
// llama a este endpoint automaticamente para varios episodios a la vez (por
// ejemplo al precargar el siguiente capitulo), asi que si tradujeramos aca
// gastariamos cuota de las APIs por episodios que capaz nunca mires. La
// traduccion real se dispara recien en la ruta /subs/:key.srt, que solo se
// pide cuando elegis "Subtito Libre" en el menu de subtitulos del reproductor.
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
    const publicUrl = `${req.protocol}://${req.get('host')}/subs/${key}.srt?src=${encodeURIComponent(sourceUrl)}`;

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

// ---------- Sirve los .srt, traduciendo recien aca si hace falta ----------
// Este es el momento real de "boton de traducir": solo se llega hasta aca
// cuando elegiste ese subtitulo en el reproductor y Stremio va a mostrarlo.
app.get('/subs/:key.srt', async (req, res) => {
  const { key } = req.params;
  const cachePath = cachePathFor(key);

  try {
    if (!fs.existsSync(cachePath)) {
      const src = req.query.src;
      if (!src) {
        return res.status(404).send('No encontrado (falta el subtitulo de origen)');
      }
      await getOrTranslate(decodeURIComponent(src));
    }

    if (!fs.existsSync(cachePath)) {
      return res.status(500).send('No se pudo generar el subtitulo');
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.sendFile(cachePath);
  } catch (err) {
    console.error('[subs] error:', err.message);
    res.status(502).send('Error traduciendo el subtitulo, proba de nuevo en un rato');
  }
});

app.listen(PORT, () => {
  console.log(`Addon corriendo en http://127.0.0.1:${PORT}/manifest.json`);
  console.log('Para instalarlo en Stremio: pega esa URL en "Instalar addon desde URL".');
});
