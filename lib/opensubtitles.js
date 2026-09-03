// lib/opensubtitles.js
// Reutiliza el addon publico de OpenSubtitles (mismo protocolo Stremio) como fuente.
// No hace falta API key propia: es el mismo addon que ya tenes instalado en Stremio.

const fetch = require('node-fetch');

const OPENSUBTITLES_BASE = 'https://opensubtitles-v3.strem.io';

// Devuelve la mejor URL de subtitulo en ingles disponible para type/id (imdb id, ej: tt1234567)
async function findEnglishSubtitleUrl(type, id) {
  const url = `${OPENSUBTITLES_BASE}/subtitles/${type}/${encodeURIComponent(id)}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenSubtitles HTTP ${res.status}`);

  const data = await res.json();
  const subs = data.subtitles || [];

  const englishSubs = subs.filter((s) => s.lang === 'eng' || s.lang === 'en');
  if (englishSubs.length === 0) return null;

  // El addon ya los devuelve mas o menos ordenados por relevancia/descargas; nos quedamos con el primero
  return englishSubs[0].url;
}

async function downloadSrt(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Descarga de subtitulo fallo: HTTP ${res.status}`);
  return res.text();
}

module.exports = { findEnglishSubtitleUrl, downloadSrt };
