const fs = require('fs');
const path = require('path');

const PINNED_SURFACE_PATH = path.join(__dirname, 'payload-gate-surface.json');

let cachedGate = null;
let cachedSurface = null;

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadPayloadGateModule() {
  const candidates = [
    process.env.PAYLOAD_GATE_PATH,
    '/app/payload-gate/index.cjs',
    path.resolve(__dirname, '../../prestigio-app/js/quote-intake/payload-gate/index.cjs'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        modulePath: candidate,
        module: require(candidate),
      };
    }
  }

  throw new Error(
    'Unable to load create-draft-quote payload gate. Expected prestigio-app/js/quote-intake/payload-gate/index.cjs to be mounted.',
  );
}

function verifyPayloadGateLock(gateModulePath, gateModule) {
  if (process.env.PAYLOAD_GATE_SURFACE_SKIP === '1') {
    return gateModule.loadGateSurface(path.dirname(gateModulePath));
  }

  if (!fs.existsSync(PINNED_SURFACE_PATH)) {
    throw new Error(
      'Write service missing pinned payload gate surface at lib/payload-gate-surface.json. ' +
      'Run npm run quote:payload-gate:surface:generate in prestigio-app.',
    );
  }

  const pinnedSurface = loadJson(PINNED_SURFACE_PATH);
  return gateModule.verifyPinnedGateSurface(path.dirname(gateModulePath), pinnedSurface);
}

function getPayloadGate() {
  if (!cachedGate) {
    const { modulePath, module: gateModule } = loadPayloadGateModule();
    cachedSurface = verifyPayloadGateLock(modulePath, gateModule);
    cachedGate = gateModule;
  }
  return cachedGate;
}

function getPayloadGateSurface() {
  if (!cachedSurface) {
    getPayloadGate();
  }
  return cachedSurface;
}

module.exports = {
  getPayloadGate,
  getPayloadGateSurface,
  loadPayloadGate: getPayloadGate,
};
