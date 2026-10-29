import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 7;
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
export const COOKIE = 'linkbio_admin';

const hash = async (password, salt = randomBytes(16).toString('hex')) =>
  `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
const safeEqual = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const verify = async (password, stored) => {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  return safeEqual((await hash(password, salt)).split(':')[1], expected);
};

/**
 * Senha: variável ADMIN_PASSWORD ou hash salvo no armazenamento (chave "auth").
 * Sessões sem estado: o cookie carrega a validade assinada com HMAC, então funcionam em várias instâncias (Netlify).
 * Trocar a senha troca a chave de assinatura e derruba todas as sessões.
 */
export function createAuth(kv, { envPassword = process.env.ADMIN_PASSWORD || '', sessionSecret = process.env.SESSION_SECRET || '' } = {}) {
  const stored = () => kv.getJSON('auth');
  const signingKey = async () => {
    if (envPassword) return createHash('sha256').update(`linkbio-admin|${envPassword}|${sessionSecret}`).digest();
    const auth = await stored();
    return auth?.secret ? Buffer.from(auth.secret, 'hex') : null;
  };
  const sign = (key, value) => createHmac('sha256', key).update(value).digest('hex');
  const createToken = async () => {
    const expires = String(Date.now() + SESSION_DAYS * 864e5);
    return `${expires}.${sign(await signingKey(), expires)}`;
  };
  const tokenFrom = (cookieHeader) => {
    const match = String(cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+\\.[a-f0-9]{64})`));
    return match ? match[1] : null;
  };
  const attemptsKey = (ip) => `auth-attempts/${createHash('sha256').update(String(ip)).digest('hex').slice(0, 24)}`;

  return {
    passwordFromEnv: Boolean(envPassword),
    cookieHeader: (token, secure) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_DAYS * 86400 : 0}${secure ? '; Secure' : ''}`,
    async configured() { return Boolean(envPassword || (await stored())?.hash); },
    async isAuthenticated(cookieHeader) {
      const token = tokenFrom(cookieHeader);
      if (!token) return false;
      const [expires, signature] = token.split('.');
      if (Number(expires) < Date.now()) return false;
      const key = await signingKey();
      return Boolean(key) && safeEqual(signature, sign(key, expires));
    },
    async setup(password) {
      if (await this.configured()) return null;
      await kv.setJSON('auth', { hash: await hash(password), secret: randomBytes(32).toString('hex') });
      return createToken();
    },
    async login(password, ip) {
      const key = attemptsKey(ip);
      const now = Date.now();
      const attempts = await kv.getJSON(key);
      const current = attempts && now - attempts.first < ATTEMPT_WINDOW ? attempts : { first: now, count: 0 };
      if (current.count >= MAX_ATTEMPTS) return { error: 'Muitas tentativas. Aguarde alguns minutos.', status: 429 };
      const ok = envPassword ? safeEqual(password, envPassword) : await verify(password, (await stored())?.hash);
      if (!ok) {
        await kv.setJSON(key, { ...current, count: current.count + 1 });
        return { error: 'Senha incorreta.', status: 401 };
      }
      if (attempts) await kv.delete(key);
      return { token: await createToken() };
    },
    async changePassword(current, next) {
      if (envPassword) return { error: 'A senha é definida pela variável ADMIN_PASSWORD na hospedagem. Altere por lá.' };
      const auth = await stored();
      if (!auth?.hash || !(await verify(current, auth.hash))) return { error: 'Senha atual incorreta.' };
      await kv.setJSON('auth', { hash: await hash(next), secret: randomBytes(32).toString('hex') });
      return { token: await createToken() };
    }
  };
}
