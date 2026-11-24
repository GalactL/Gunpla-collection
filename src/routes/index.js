const MAX_BODY = 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Corps de requête trop volumineux'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

// Hostnames accepted in the Host header (port must be the one actually listening):
// blocks DNS rebinding. Cross-site writes are blocked by the Origin check + strict JSON content-type.
export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export const isLoopbackHost = (host) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase());

// Startup warning (French) when HOST exposes the unauthenticated site beyond this machine; null otherwise.
export const hostWarning = (host) =>
  isLoopbackHost(host) ? null : `Attention : le site n'a pas de mot de passe ; HOST=${host} l'ouvre à tout votre réseau.`;

function checkOrigin(req, allowedHosts) {
  const host = String(req.headers.host ?? '').toLowerCase();
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host);
  if (!m || !allowedHosts.includes(m[1]) || Number(m[2]) !== req.socket.localPort) throw new HttpError(403, 'Hôte non autorisé');
  const origin = req.headers.origin;
  if (origin === undefined || req.method === 'GET' || req.method === 'HEAD') return;
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {}
  if (originHost !== host) throw new HttpError(403, 'Origine non autorisée');
}

// Handler: (req, res, { params, query, body }). Either write to res yourself
// (HTML, files, uploads) or return a value: undefined -> 204, else JSON 200.
// Throw HttpError(status, message) for error replies.
// body is the parsed JSON only when content-type is application/json;
// otherwise the request stream is left unread (uploads).
export function createRouter({ allowedHosts = LOCAL_HOSTS } = {}) {
  const routes = [];
  return {
    add(method, pattern, handler) {
      const keys = [];
      const re = new RegExp(
        '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$',
      );
      routes.push({ method: method.toUpperCase(), re, keys, handler });
    },
    async handle(req, res) {
      try {
        checkOrigin(req, allowedHosts);
        const url = new URL(req.url, 'http://localhost');
        let pathMatched = false;
        for (const r of routes) {
          const m = r.re.exec(url.pathname);
          if (!m) continue;
          pathMatched = true;
          if (r.method !== req.method) continue;
          const params = {};
          try {
            r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          } catch {
            throw new HttpError(400, 'Adresse invalide');
          }
          const isJson = /^\s*application\/json\s*(;|$)/i.test(req.headers['content-type'] || '');
          const body = isJson ? await readJson(req) : undefined;
          const out = await r.handler(req, res, { params, query: url.searchParams, body });
          if (!res.headersSent) {
            if (out === undefined) {
              res.writeHead(204);
              res.end();
            } else sendJson(res, 200, out);
          }
          return;
        }
        throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Méthode non autorisée' : 'Introuvable');
      } catch (err) {
        if (res.headersSent) return res.end();
        if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
        console.error(err);
        sendJson(res, 500, { error: 'Erreur interne' });
      }
    },
  };
}
