// ================================================================
// orama.js — Local Vector Database (Orama)
// In-browser hybrid search: BM25 full-text + vector ANN
// Schema: { id, content, source, type, embedding }
// ================================================================

import { create, insert, search, remove, count } from '@orama/orama';

let db = null;

const DB_STORAGE_KEY = 'sentry-ai-orama-db';

// ── Init ───────────────────────────────────────────────────────────
export async function initDB() {
  if (db) return db;

  db = await create({
    schema: {
      id:        'string',
      content:   'string',
      source:    'string',
      type:      'string',   // 'text' | 'pdf' | 'image' | 'audio'
      pageNum:   'number',
      embedding: `vector[384]`,
    },
  });

  // Try to restore from localStorage
  await loadDBFromStorage();
  return db;
}

// ── Ingest ─────────────────────────────────────────────────────────

/**
 * Chunk text and insert with embeddings.
 * @param {string} text - full document text
 * @param {string} source - filename or identifier
 * @param {string} type - 'text' | 'pdf' | 'image' | 'audio'
 * @param {function} embedFn - async (text) => Float32Array
 * @param {function} onProgress - ({done, total}) callback
 */
export async function ingestText(text, source, type = 'text', embedFn, onProgress) {
  if (!db) await initDB();

  const chunks = chunkText(text, 400, 50); // 400 tokens, 50 overlap
  const total = chunks.length;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embeddingArray = await embedFn(chunk);
    const embedding = Array.from(embeddingArray).slice(0, 384);

    await insert(db, {
      id:        `${source}-${i}-${Date.now()}`,
      content:   chunk,
      source,
      type,
      pageNum:   0,
      embedding,
    });

    onProgress?.({ done: i + 1, total });
  }

  await persistDB();
  return { chunks: total };
}

/**
 * Ingest a PDF file (uses pdfjs-dist loaded dynamically).
 */
export async function ingestPDF(file, embedFn, onProgress) {
  if (!db) await initDB();

  // Dynamic import to avoid bundling pdfjs at startup
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;

  let allText = '';
  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map(i => i.str).join(' ');
    allText += pageText + '\n\n';
    onProgress?.({ stage: 'extract', done: p, total: numPages });
  }

  return await ingestText(allText, file.name, 'pdf', embedFn, (p) => {
    onProgress?.({ stage: 'embed', ...p });
  });
}

// ── Search ─────────────────────────────────────────────────────────

/**
 * Hybrid search: combines BM25 full-text + vector ANN.
 * @param {string} query
 * @param {number[]} queryEmbedding - 384-dim vector
 * @param {number} limit
 */
export async function hybridSearch(query, queryEmbedding, limit = 6) {
  if (!db) await initDB();

  const embedding = queryEmbedding.slice(0, 384);

  const results = await search(db, {
    term: query,
    vector: { value: embedding, property: 'embedding' },
    limit,
    mode: 'hybrid',
    hybridWeights: { text: 0.3, vector: 0.7 },
  });

  return results.hits.map(h => ({
    id: h.id,
    content: h.document.content,
    source: h.document.source,
    type: h.document.type,
    score: h.score,
  }));
}

/**
 * Pure vector search (for image similarity).
 */
export async function vectorSearch(embedding, limit = 6) {
  if (!db) await initDB();

  const results = await search(db, {
    vector: { value: embedding.slice(0, 384), property: 'embedding' },
    limit,
    mode: 'vector',
  });

  return results.hits.map(h => ({
    id: h.id,
    content: h.document.content,
    source: h.document.source,
    type: h.document.type,
    score: h.score,
  }));
}

// ── Management ─────────────────────────────────────────────────────

export async function getDocumentCount() {
  if (!db) await initDB();
  return await count(db);
}

export async function removeBySource(source) {
  if (!db) return;
  const results = await search(db, { term: source, where: { source: { eq: source } }, limit: 1000 });
  for (const hit of results.hits) {
    await remove(db, hit.id);
  }
  await persistDB();
}

// ── Persistence ────────────────────────────────────────────────────

export async function persistDB() {
  if (!db) return;
  try {
    // Serialize DB hits to IndexedDB via localStorage (small DBs only)
    // For larger DBs, use IndexedDB directly
    const allDocs = await search(db, { term: '', limit: 10000 });
    const serialized = JSON.stringify(allDocs.hits.map(h => h.document));
    localStorage.setItem(DB_STORAGE_KEY, serialized);
  } catch (e) {
    console.warn('Orama persist warning:', e.message);
  }
}

export async function loadDBFromStorage() {
  try {
    const raw = localStorage.getItem(DB_STORAGE_KEY);
    if (!raw) return 0;
    const docs = JSON.parse(raw);
    for (const doc of docs) {
      await insert(db, { ...doc, id: doc.id || `${doc.source}-${Date.now()}-${Math.random()}` });
    }
    return docs.length;
  } catch (e) {
    console.warn('Orama load warning:', e.message);
    return 0;
  }
}

export async function clearDB() {
  db = await create({
    schema: {
      id: 'string', content: 'string', source: 'string',
      type: 'string', pageNum: 'number', embedding: 'vector[384]',
    },
  });
  localStorage.removeItem(DB_STORAGE_KEY);
}

// ── Utilities ──────────────────────────────────────────────────────

/**
 * Split text into overlapping chunks by word count.
 */
function chunkText(text, maxWords = 400, overlapWords = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start += maxWords - overlapWords;
  }
  return chunks;
}
