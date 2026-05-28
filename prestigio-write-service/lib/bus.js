const fs = require('fs');
const path = require('path');

function createBus(config) {
  const {
    MOUNT_PATH,
    LEGACY_REQUEST_FILE,
    LEGACY_RESPONSE_FILE,
    REQUEST_DIR,
    RESPONSE_DIR,
    REQUEST_STABILITY_MS,
    FILE_TTL_MS,
    PRESTIGIO_APP_BASE_URL,
  } = config;

  function ensureBusDirs() {
    fs.mkdirSync(REQUEST_DIR, { recursive: true });
    fs.mkdirSync(RESPONSE_DIR, { recursive: true });
  }

  function writeJsonAtomic(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function sanitizeRequestId(value, fallback = 'write') {
    const raw = String(value || '').trim();
    const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    return cleaned || `${fallback}-${Date.now()}`;
  }

  function responsePathForRequest(requestId) {
    return path.join(RESPONSE_DIR, `${sanitizeRequestId(requestId)}.json`);
  }

  function writeResponse(data, { requestId, legacy = false } = {}) {
    const payload = requestId ? { ...data, requestId } : data;
    if (requestId) {
      writeJsonAtomic(responsePathForRequest(requestId), payload);
    }
    if (legacy || !requestId) {
      writeJsonAtomic(LEGACY_RESPONSE_FILE, payload);
    }
  }

  function buildModernQuoteUrl(quoteId) {
    return quoteId ? `${PRESTIGIO_APP_BASE_URL}/quote-v2.html?edit=${encodeURIComponent(quoteId)}` : null;
  }

  function isStableFile(filePath) {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs >= REQUEST_STABILITY_MS;
  }

  function listPendingRequestFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => path.join(dir, name))
      .filter(filePath => {
        try {
          return isStableFile(filePath);
        } catch (_) {
          return false;
        }
      })
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  }

  function cleanupOldBusFiles() {
    const cutoff = Date.now() - FILE_TTL_MS;
    for (const dir of [REQUEST_DIR, RESPONSE_DIR]) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const filePath = path.join(dir, name);
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) continue;
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
          }
        } catch (_) {
          // best effort cleanup
        }
      }
    }
  }

  return {
    MOUNT_PATH,
    LEGACY_REQUEST_FILE,
    LEGACY_RESPONSE_FILE,
    REQUEST_DIR,
    RESPONSE_DIR,
    ensureBusDirs,
    writeJsonAtomic,
    sanitizeRequestId,
    responsePathForRequest,
    writeResponse,
    buildModernQuoteUrl,
    isStableFile,
    listPendingRequestFiles,
    cleanupOldBusFiles,
  };
}

module.exports = { createBus };
