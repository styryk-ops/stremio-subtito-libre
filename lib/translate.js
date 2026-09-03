// lib/translate.js
// Traduce bloques de subtitulo probando proveedores en orden de prioridad.
// Si un proveedor devuelve error de cuota/token (429, modelo no encontrado, etc.)
// pasa automaticamente al siguiente. Nunca reordena bloques: siempre mapea por
// indice, y si a un proveedor le faltan un par de lineas en la respuesta, no
// descarta todo el trabajo -- solo esas lineas puntuales quedan sin traducir.

const fetch = require('node-fetch');

// Un .srt es texto liviano: una pelicula entera (1000-2500 lineas aprox.)
// entra sin problema en un solo pedido a cualquiera de los tres proveedores.
// Por eso el "batch" por defecto es enorme -- en la practica, todo el
// subtitulo se traduce junto, de una sola vez, no en tandas mientras se
// reproduce. Si algun subtitulo fuera excepcionalmente largo (una temporada
// completa pegada, por ejemplo) esto lo dividiria igual para no romper por
// limite de contexto del modelo.
const BATCH_SIZE = 3000;

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPrompt(items) {
  return (
    'Traduci al espanol (neutro) el campo "text" de cada objeto de esta lista JSON. ' +
    'Mantene el mismo orden y la misma cantidad de objetos. No agregues ni quites objetos. ' +
    'No traduzcas el campo "i". Responde SOLO con un JSON array valido, sin texto adicional, sin markdown, ' +
    'con el formato exacto [{"i":0,"text":"..."}, ...].\n\n' +
    'Lista a traducir:\n' +
    JSON.stringify(items)
  );
}

function extractJsonArray(rawText) {
  // Los modelos a veces envuelven la respuesta en ```json ... ``` pese a pedirselo limpio.
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No se encontro un JSON array en la respuesta del modelo');
  return JSON.parse(match[0]);
}

async function callGemini(items) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY no configurada');
  // "gemini-flash-latest" es un alias que Google mantiene apuntando siempre
  // al modelo Flash vigente -- evita que el addon se rompa cada vez que
  // Google renombra o da de baja una version puntual (ej: gemini-2.0-flash).
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(items) }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: respuesta vacia o inesperada');
  return extractJsonArray(text);
}

async function callMistral(items) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY no configurada');
  const model = process.env.MISTRAL_MODEL || 'mistral-small-latest';

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'user', content: buildPrompt(items) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Mistral HTTP ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Mistral: respuesta vacia o inesperada');
  return extractJsonArray(text);
}

async function callGrok(items) {
  const key = process.env.GROK_API_KEY;
  if (!key) throw new Error('GROK_API_KEY no configurada');
  // grok-4.3: modelo estandar vigente de xAI (1M de contexto), buena opcion
  // de precio/calidad para esta tarea. Los alias "grok-2-latest" y similares
  // de generaciones viejas ya fueron retirados por xAI.
  const model = process.env.GROK_MODEL || 'grok-4.3';

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'user', content: buildPrompt(items) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Grok HTTP ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Grok: respuesta vacia o inesperada');
  return extractJsonArray(text);
}

// Orden de prioridad. El primero que responda bien, gana. Si tira 429/cuota,
// modelo inexistente, o cualquier error de conexion, se pasa al siguiente.
const PROVIDERS = [
  { name: 'gemini', call: callGemini },
  { name: 'mistral', call: callMistral },
  { name: 'grok', call: callGrok },
];

// Traduce un batch probando los proveedores en orden. A diferencia de antes,
// ya NO descarta el resultado completo si el modelo devolvio unos pocos
// items de menos -- eso es normal (a veces el modelo fusiona o salta alguna
// linea vacia) y no amerita gastar cuota de otro proveedor por eso. Solo pasa
// al siguiente proveedor si hubo un error real (red, auth, modelo no existe,
// formato totalmente invalido, o cero resultados utilizables).
async function translateBatch(items) {
  let lastErr = null;
  for (const provider of PROVIDERS) {
    try {
      const result = await provider.call(items);
      if (!Array.isArray(result) || result.length === 0) {
        throw new Error(`${provider.name} no devolvio resultados utilizables`);
      }
      if (result.length !== items.length) {
        console.warn(
          `[translate] ${provider.name} devolvio ${result.length}/${items.length} items -- se usan los que llegaron, el resto queda en ingles`
        );
      } else {
        console.log(`[translate] batch de ${items.length} bloques OK con ${provider.name}`);
      }
      return result;
    } catch (e) {
      console.warn(`[translate] ${provider.name} fallo: ${e.message}. Probando siguiente proveedor...`);
      lastErr = e;
      continue;
    }
  }
  throw new Error(`Todos los proveedores fallaron. Ultimo error: ${lastErr?.message}`);
}

// Traduce todos los bloques del srt en batches, preservando indices.
async function translateBlocks(blocks) {
  const items = blocks.map((b, i) => ({ i, text: b.text }));
  const batches = chunkArray(items, BATCH_SIZE);

  const translatedByIndex = new Map();

  for (const batch of batches) {
    const translated = await translateBatch(batch);
    for (const t of translated) {
      if (t && typeof t.i === 'number' && typeof t.text === 'string') {
        translatedByIndex.set(t.i, t.text);
      }
    }
  }

  return blocks.map((b, i) => ({
    ...b,
    text: translatedByIndex.has(i) ? translatedByIndex.get(i) : b.text, // fallback: si algo falto, deja el original
  }));
}

module.exports = { translateBlocks };
