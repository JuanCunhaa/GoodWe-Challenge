import crypto from 'node:crypto';

export function registerAppAuthRoutes(router, { dbApi, helpers }) {
  const { requireUser } = helpers;

  router.post('/auth/register', async (req, res) => {
    try {
      const { email, password, powerstation_id } = req.body || {};
      if (!email || !password || !powerstation_id) return res.status(400).json({ ok: false, error: 'email, password, powerstation_id required' });
      if (String(password).length < 6) return res.status(400).json({ ok: false, error: 'password must be at least 6 characters' });
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      const password_hash = `scrypt:${salt}:${hash}`;
      const user = await dbApi.createUser({ email, password_hash, powerstation_id });
      const token = crypto.randomUUID();
      await dbApi.createSession(user.id, token);
      res.json({ ok: true, token, user: { id: user.id, email: user.email, powerstation_id: user.powerstation_id } });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ ok: false, error: 'email and password required' });
      const user = await dbApi.getUserByEmail(email);
      if (!user) return res.status(401).json({ ok: false, error: 'invalid credentials' });
      const [scheme, salt, hash] = String(user.password_hash || '').split(':');
      if (scheme !== 'scrypt' || !salt || !hash) return res.status(500).json({ ok: false, error: 'invalid password scheme' });
      const verify = crypto.scryptSync(password, salt, 64).toString('hex');
      if (verify !== hash) return res.status(401).json({ ok: false, error: 'invalid credentials' });
      const token = crypto.randomUUID();
      await dbApi.createSession(user.id, token);
      res.json({ ok: true, token, user: { id: user.id, email: user.email, powerstation_id: user.powerstation_id } });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.get('/auth/me', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    res.json({ ok: true, user: { id: user.id, email: user.email, powerstation_id: user.powerstation_id } });
  });

  router.post('/auth/change-password', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return;
      const { old_password, new_password } = req.body || {};
      if (!old_password || !new_password) return res.status(400).json({ ok: false, error: 'old_password and new_password required' });
      if (String(new_password).length < 6) return res.status(400).json({ ok: false, error: 'new password must be at least 6 characters' });
      const [scheme, salt, hash] = String(user.password_hash || '').split(':');
      if (scheme !== 'scrypt' || !salt || !hash) return res.status(500).json({ ok: false, error: 'invalid password scheme' });
      const verify = crypto.scryptSync(old_password, salt, 64).toString('hex');
      if (verify !== hash) return res.status(401).json({ ok: false, error: 'invalid old password' });
      const newSalt = crypto.randomBytes(16).toString('hex');
      const newHash = crypto.scryptSync(new_password, newSalt, 64).toString('hex');
      const password_hash = `scrypt:${newSalt}:${newHash}`;
      await dbApi.updateUserPassword(user.id, password_hash);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
}

