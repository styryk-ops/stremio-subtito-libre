// lib/srt.js
// Parsea un .srt a bloques {index, time, text} y lo reconstruye despues de traducir.
// Nunca tocamos "time" -> asi conservamos la sincronizacion original del subtitulo en ingles.

function parseSrt(raw) {
  // Normaliza saltos de linea y separa por bloques (doble salto de linea)
  const clean = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const chunks = clean.split(/\n\s*\n/);

  const blocks = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n').filter((l) => l.length > 0);
    if (lines.length < 2) continue;

    // Primera linea: indice numerico (a veces falta o viene con BOM raro, lo regeneramos igual)
    let idx = 0;
    let timeLineIdx = 0;

    if (/^\d+$/.test(lines[0].trim())) {
      idx = parseInt(lines[0].trim(), 10);
      timeLineIdx = 1;
    } else {
      // Algunos srt mal formados no traen indice; lo inferimos por orden
      idx = blocks.length + 1;
      timeLineIdx = 0;
    }

    const timeLine = lines[timeLineIdx];
    if (!timeLine || !timeLine.includes('-->')) continue;

    const textLines = lines.slice(timeLineIdx + 1);
    const text = textLines.join('\n');

    blocks.push({ index: idx, time: timeLine.trim(), text });
  }

  return blocks;
}

function buildSrt(blocks) {
  return blocks
    .map((b, i) => `${i + 1}\n${b.time}\n${b.text}`)
    .join('\n\n')
    .concat('\n');
}

module.exports = { parseSrt, buildSrt };
