// ================================================================
// opfs.js — Origin Private File System model cache manager
// Stores multi-GB model weights locally for instant boot
// ================================================================

const OPFS_DIR = 'sentry-ai-models';

/**
 * Get the root OPFS directory handle.
 */
async function getRootDir() {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(OPFS_DIR, { create: true });
}

/**
 * Check if a model is already cached in OPFS.
 * @param {string} modelId
 * @returns {Promise<boolean>}
 */
export async function isModelCached(modelId) {
  try {
    const dir = await getRootDir();
    const safeId = modelId.replace(/[^a-zA-Z0-9-_.]/g, '_');
    await dir.getFileHandle(`${safeId}.meta`, { create: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get approximate OPFS storage usage info.
 */
export async function getStorageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return {
        usedBytes: usage || 0,
        quotaBytes: quota || 0,
        usedGB: ((usage || 0) / 1e9).toFixed(2),
        quotaGB: ((quota || 0) / 1e9).toFixed(1),
        percentUsed: quota ? Math.round((usage / quota) * 100) : 0,
      };
    }
  } catch {
    // ignore
  }
  return { usedBytes: 0, quotaBytes: 0, usedGB: '0', quotaGB: '?', percentUsed: 0 };
}

/**
 * Mark a model as cached (write .meta sentinel file).
 */
export async function markModelCached(modelId) {
  try {
    const dir = await getRootDir();
    const safeId = modelId.replace(/[^a-zA-Z0-9-_.]/g, '_');
    const fh = await dir.getFileHandle(`${safeId}.meta`, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify({ modelId, cachedAt: Date.now() }));
    await writable.close();
  } catch (e) {
    console.warn('OPFS: could not write meta', e);
  }
}

/**
 * Stream a file from URL into OPFS with progress reporting.
 * Note: WebLLM manages its own cache internally via IndexedDB/OPFS.
 * This is used for auxiliary files (e.g., ONNX models not managed by WebLLM).
 *
 * @param {string} url
 * @param {string} filename
 * @param {function} onProgress  ({loaded, total, percent, speedMBps})
 */
export async function streamFileToOPFS(url, filename, onProgress) {
  const dir = await getRootDir();
  const fh = await dir.getFileHandle(filename, { create: true });
  const writable = await fh.createWritable();

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);

  const total = parseInt(response.headers.get('Content-Length') || '0', 10);
  let loaded = 0;
  const startTime = Date.now();

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await writable.write(value);
    loaded += value.length;
    const elapsed = (Date.now() - startTime) / 1000;
    const speedMBps = loaded / elapsed / 1e6;
    onProgress?.({ loaded, total, percent: total ? (loaded / total) * 100 : 0, speedMBps });
  }
  await writable.close();
}

/**
 * Delete a cached model from OPFS.
 */
export async function deleteModelFromOPFS(modelId) {
  try {
    const dir = await getRootDir();
    const safeId = modelId.replace(/[^a-zA-Z0-9-_.]/g, '_');
    await dir.removeEntry(`${safeId}.meta`);
  } catch {
    // ignore
  }
}

/**
 * List all cached model metadata.
 */
export async function listCachedModels() {
  const cached = [];
  try {
    const dir = await getRootDir();
    for await (const [name] of dir.entries()) {
      if (name.endsWith('.meta')) {
        const fh = await dir.getFileHandle(name);
        const file = await fh.getFile();
        const text = await file.text();
        try { cached.push(JSON.parse(text)); } catch { /* ignore */ }
      }
    }
  } catch {
    // ignore
  }
  return cached;
}
