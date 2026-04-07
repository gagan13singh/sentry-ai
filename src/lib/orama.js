// ================================================================
// orama.js — Local Vector Database (Orama)
// FIXED: IndexedDB persistence (no more localStorage 5MB limit)
// FIXED: Proper Float32Array → Array type coercion before insert
// FIXED: removeBySource actually works now
// ================================================================

import { create, insert, search, remove, count, getByID } from '@orama/orama';

let db = null;
const IDB_NAME = 'sentry-ai-orama';
const IDB_STORE = 'documents';
const IDB_VERSION = 1;

// ── IndexedDB helpers ──────────────────────────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbGetAll() {
  const db = await openIDB();
  const tx = db.transaction(IDB_STORE, 'readonly');
  const store = tx.objectStore(IDB_STORE);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = (e) => resolve(e.target.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbPutBatch(docs) {
  if (!docs.length) return;
  const db = await openIDB();
  const tx = db.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  for (const doc of docs) store.put(doc);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function idbDeleteBySource(source) {
  const db = await openIDB();
  const tx = db.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  const all = await new Promise((res) => {
    const req = store.getAll();
    req.onsuccess = (e) => res(e.target.result || []);
  });
  for (const doc of all) {
    if (doc.source === source) store.delete(doc.id);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function idbClear() {
  const db = await openIDB();
  const tx = db.transaction(IDB_STORE, 'readwrite');
  tx.objectStore(IDB_STORE).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ── Init ───────────────────────────────────────────────────────────
export async function initDB() {
  if (db) return db;

  db = await create({
    schema: {
      id: 'string',
      content: 'string',
      source: 'string',
      type: 'string',
      pageNum: 'number',
      embedding: `vector[384]`,
    },
  });

  await loadDBFromIDB();
  return db;
}

// ── Ingest ─────────────────────────────────────────────────────────
export async function ingestText(text, source, type = 'text', embedFn, onProgress) {
  if (!db) await initDB();

  const chunks = chunkText(text, 400, 50);
  const total = chunks.length;
  const inserted = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const raw = await embedFn(chunk);

    // FIXED: Always coerce to plain number[] — Orama rejects typed arrays
    const embedding = Array.from(raw instanceof Float32Array ? raw : new Float32Array(raw)).slice(0, 384);

    const doc = {
      id: `${source}-${i}-${Date.now()}`,
      content: chunk,
      source,
      type,
      pageNum: 0,
      embedding,
    };

    await insert(db, doc);
    inserted.push(doc);
    onProgress?.({ done: i + 1, total });
  }

  await idbPutBatch(inserted);
  return { chunks: total };
}

export async function ingestPDF(file, embedFn, onProgress) {
  if (!db) await initDB();

  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  let allText = '';

  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    allText += content.items.map(i => i.str).join(' ') + '\n\n';
    onProgress?.({ stage: 'extract', done: p, total: numPages });
  }

  return await ingestText(allText, file.name, 'pdf', embedFn, (p) => {
    onProgress?.({ stage: 'embed', ...p });
  });
}

// ── Search ─────────────────────────────────────────────────────────
export async function hybridSearch(query, queryEmbedding, limit = 6) {
  if (!db) await initDB();

  // FIXED: Always coerce to plain number[] before passing to Orama
  const embedding = Array.from(
    queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding)
  ).slice(0, 384);

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

export async function vectorSearch(embedding, limit = 6) {
  if (!db) await initDB();
  const vec = Array.from(
    embedding instanceof Float32Array ? embedding : new Float32Array(embedding)
  ).slice(0, 384);

  const results = await search(db, {
    vector: { value: vec, property: 'embedding' },
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

// FIXED: actually deletes from both Orama and IDB
export async function removeBySource(source) {
  if (!db) return;

  const results = await search(db, {
    term: '',
    where: { source: { eq: source } },
    limit: 10000,
  });

  for (const hit of results.hits) {
    try { await remove(db, hit.id); } catch (_) { }
  }

  await idbDeleteBySource(source);
}

// ── Persistence ────────────────────────────────────────────────────
export async function persistDB() {
  if (!db) return;
  try {
    const allDocs = await search(db, { term: '', limit: 50000 });
    await idbPutBatch(allDocs.hits.map(h => h.document));
  } catch (e) {
    console.warn('Orama persist warning:', e.message);
  }
}

export async function loadDBFromIDB() {
  try {
    const docs = await idbGetAll();
    for (const doc of docs) {
      // Re-coerce embeddings loaded from IDB (stored as plain arrays)
      if (doc.embedding && !(doc.embedding instanceof Array)) {
        doc.embedding = Array.from(doc.embedding);
      }
      try { await insert(db, { ...doc }); } catch (_) { }
    }
    return docs.length;
  } catch (e) {
    console.warn('Orama IDB load warning:', e.message);
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
  await idbClear();
}

// ── Utilities ──────────────────────────────────────────────────────
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