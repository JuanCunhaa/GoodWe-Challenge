import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function createHelpers({ gw, dbApi }) {
  function resolveEnvPath(name) {
    let p = process.env[name] || '';
    if (!p) return '';
    p = p.replace(/^"|^'|"$|'$/g, '');
    if (path.isAbsolute(p)) return p;
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const base = path.resolve(here, '..');
      return path.resolve(base, p);
    } catch { return p; }
  }

  const getBearerToken = (req) => {
    const auth = String(req.headers['authorization'] || '');
    return auth.startsWith('Bearer ') ? auth.slice(7) : null;
  };

  const tryGetUser = async (req) => {
    try {
      const token = getBearerToken(req);
      if (!token) return null;
      const sess = await dbApi.getSession(token);
      if (!sess) return null;
      const user = await dbApi.getUserById(sess.user_id);
      return user || null;
    } catch { return null; }
  };

  const requireUser = async (req, res) => {
    const token = getBearerToken(req);
    if (!token) { res.status(401).json({ ok: false, error: 'missing token' }); return null; }
    // Service mode: allow ASSIST_TOKEN to impersonate any user (first), for internal ingestors
    if (process.env.ASSIST_TOKEN && token === process.env.ASSIST_TOKEN) {
      try {
        const preferredId = Number(process.env.INGEST_USER_ID || NaN);
        let user = null;
        if (Number.isFinite(preferredId)) user = await dbApi.getUserById(preferredId);
        if (!user) user = await (dbApi.getAnyUser?.() || null);
        if (!user) { res.status(401).json({ ok: false, error: 'no users available for service token' }); return null; }
        return user;
      } catch {
        res.status(401).json({ ok: false, error: 'service token not authorized' }); return null;
      }
    }
    const sess = await dbApi.getSession(token);
    if (!sess) { res.status(401).json({ ok: false, error: 'invalid token' }); return null; }
    const user = await dbApi.getUserById(sess.user_id);
    if (!user) { res.status(401).json({ ok: false, error: 'invalid token' }); return null; }
    return user;
  };

  const getPsId = async (req) => {
    // Always prefer the powerstation linked to the authenticated user
    const user = await tryGetUser(req);
    if (user?.powerstation_id) return user.powerstation_id;
    // As a fallback (e.g., service mode), accept query
    return (
      req.query.powerStationId ||
      req.query.powerstation_id ||
      req.query.pw_id ||
      ''
    );
  };

  function deriveBaseUrl(req) {
    const explicit = (process.env.BASE_URL || '').trim();
    if (explicit) return explicit.replace(/\/$/, '');
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}`;
  }

  return { resolveEnvPath, getBearerToken, tryGetUser, requireUser, getPsId, deriveBaseUrl };
}
