// =============================================================================
// DEVELOPMENT-ONLY stand-in for the parts of Supabase the PWA uses, so the app
// can run and be tested end-to-end against a local Postgres without Docker:
//   /auth/v1/signup, /auth/v1/token (password, refresh_token), /auth/v1/user, /auth/v1/logout
//   /rest/v1/rpc/<function>   (PostgREST-style RPC, executed as the caller's role)
//   /rest/v1/<table>          (select/insert/update/delete with eq filters)
//   /functions/v1/admin-create-user
// Every request runs in a transaction with request.jwt.claims + SET ROLE, the
// same way PostgREST does, so RLS and function permissions are exercised for
// real. NEVER deploy this.
// =============================================================================
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.PORT ?? 54321);
const SECRET = process.env.JWT_SECRET ?? 'dev-only-secret-do-not-use-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54329/ipl_dev', max: 8 });
const refreshTokens = new Map();

// ---------------------------------------------------------------- JWT (HS256)
const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
function verify(token) {
  const [h, p, s] = (token ?? '').split('.');
  if (!s) return null;
  const good = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(good), Buffer.from(s.padEnd(good.length).slice(0, good.length)))) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp * 1000 > Date.now() ? claims : null;
}

function userJson(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: u.phone ?? '',
    user_metadata: u.raw_user_meta_data ?? {}, app_metadata: { provider: 'email' }, created_at: u.created_at,
    confirmed_at: u.created_at, email_confirmed_at: u.created_at };
}
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const refresh = crypto.randomBytes(24).toString('hex');
  refreshTokens.set(refresh, u.id);
  return { access_token: sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, iat: now, exp: now + 3600 }),
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u) };
}

// ---------------------------------------------------------------- helpers
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, range, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-range',
};
function send(res, status, body) {
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
async function readBody(req) {
  let data = '';
  for await (const c of req) data += c;
  return data ? JSON.parse(data) : {};
}
function claimsFrom(req) {
  const auth = req.headers.authorization ?? '';
  const c = auth.startsWith('Bearer ') ? verify(auth.slice(7)) : null;
  return c ?? { role: 'anon' };
}
async function asRole(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const role = ['authenticated', 'service_role'].includes(claims.role) ? claims.role : 'anon';
    await client.query(`set local role ${role}`);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
function pgError(res, e) {
  const status = e.code === '42501' ? 403 : e.code === 'P0002' ? 404 : e.code?.startsWith('22') || e.code?.startsWith('23') ? 400 : 400;
  if (!['42501', 'P0002', '22023', '23505', '23514', '22001', '22P02'].includes(e.code)) console.error('[pg]', e.code, e.message);
  send(res, status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

const fnCache = new Map();
async function fnInfo(name) {
  if (fnCache.has(name)) return fnCache.get(name);
  const { rows } = await pool.query(
    `select p.proretset, format_type(p.prorettype, null) as rettype,
            coalesce(array(select format_type(t, null) from unnest(p.proargtypes) t), '{}') as argtypes,
            coalesce(p.proargnames, '{}') as argnames
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1 limit 1`, [name]);
  const info = rows[0] ?? null;
  fnCache.set(name, info);
  return info;
}
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error('bad identifier'), { code: '42602' }); return `"${s}"`; };

// ---------------------------------------------------------------- handlers
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204);

  // ---- auth
  if (path === '/auth/v1/signup' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.password || b.password.length < 6) return send(res, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
    const exists = await pool.query('select 1 from auth.users where email = $1', [b.email?.toLowerCase()]);
    if (exists.rowCount) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
    const { rows } = await pool.query(
      `insert into auth.users (email, raw_user_meta_data, encrypted_password)
       values ($1, $2, extensions.crypt($3, extensions.gen_salt('bf'))) returning *`,
      [b.email?.toLowerCase(), b.data ?? {}, b.password]);
    return send(res, 200, session(rows[0]));
  }
  if (path === '/auth/v1/token' && req.method === 'POST') {
    const b = await readBody(req);
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const { rows } = await pool.query(
        `select * from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)`,
        [b.email?.toLowerCase(), b.password ?? '']);
      if (!rows[0]) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(rows[0]));
    }
    if (grant === 'refresh_token') {
      const uid = refreshTokens.get(b.refresh_token);
      if (!uid) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refreshTokens.delete(b.refresh_token);
      const { rows } = await pool.query('select * from auth.users where id = $1', [uid]);
      return send(res, 200, session(rows[0]));
    }
    return send(res, 400, { msg: 'unsupported grant_type' });
  }
  if (path === '/auth/v1/user') {
    const c = claimsFrom(req);
    if (!c.sub) return send(res, 401, { msg: 'invalid JWT' });
    const { rows } = await pool.query('select * from auth.users where id = $1', [c.sub]);
    return rows[0] ? send(res, 200, userJson(rows[0])) : send(res, 404, { msg: 'User not found' });
  }
  if (path === '/auth/v1/logout') return send(res, 204);

  // ---- rpc
  const rpc = path.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
  if (rpc) {
    const info = await fnInfo(rpc[1]);
    if (!info) return send(res, 404, { code: 'PGRST202', message: `function ${rpc[1]} not found` });
    const args = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await readBody(req);
    const params = []; const parts = [];
    info.argnames.forEach((n, i) => {
      if (!(n in args)) return;
      let v = args[n];
      const t = info.argtypes[i];
      if ((t === 'jsonb' || t === 'json') && v !== null) v = JSON.stringify(v);
      params.push(v);
      parts.push(`${ident(n)} => $${params.length}::${t}`);
    });
    const call = `public.${ident(rpc[1])}(${parts.join(', ')})`;
    const sql = info.proretset ? `select coalesce(json_agg(t), '[]'::json) as r from ${call} t`
      : info.rettype === 'void' ? `select ${call}, null::json as r` : `select to_json(${call}) as r`;
    try {
      const r = await asRole(claimsFrom(req), (c) => c.query(sql, params));
      return send(res, 200, r.rows[0]?.r ?? null);
    } catch (e) { return pgError(res, e); }
  }

  // ---- edge function stand-in
  if (path === '/functions/v1/admin-create-user' && req.method === 'POST') {
    const claims = claimsFrom(req);
    const b = await readBody(req);
    try {
      const allowed = await asRole(claims, (c) => c.query("select app.has_perm('users.manage') as ok"));
      if (!allowed.rows[0]?.ok) return send(res, 403, { error: 'not_allowed' });
      const { rows } = await pool.query(
        `insert into auth.users (email, raw_user_meta_data, encrypted_password)
         values ($1, $2, extensions.crypt($3, extensions.gen_salt('bf'))) returning id`,
        [b.email.toLowerCase(), { full_name: b.full_name }, b.password]);
      await asRole(claims, async (c) => {
        await c.query('select public.admin_set_user_roles($1, $2)', [rows[0].id, b.roles]);
        if (b.job_title) await c.query('select public.admin_update_profile($1, $2)', [rows[0].id, { job_title: b.job_title }]);
      });
      return send(res, 200, { id: rows[0].id });
    } catch (e) { return pgError(res, e); }
  }

  if (path === '/functions/v1/admin-reset-pin' && req.method === 'POST') {
    const claims = claimsFrom(req);
    const b = await readBody(req);
    try {
      const allowed = await asRole(claims, (c) => c.query("select app.has_perm('users.manage') as ok"));
      if (!allowed.rows[0]?.ok) return send(res, 403, { error: 'not_allowed' });
      const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      await pool.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id = $1`, [b.user_id, pin]);
      await asRole(claims, (c) => c.query('select public.log_pin_reset($1)', [b.user_id]));
      return send(res, 200, { pin });
    } catch (e) { return pgError(res, e); }
  }

  // ---- simple table access (master data screens)
  const tbl = path.match(/^\/rest\/v1\/([a-z_0-9]+)$/);
  if (tbl) {
    const table = `public.${ident(tbl[1])}`;
    const where = []; const params = []; let order = ''; let limit = '';
    for (const [k, v] of url.searchParams) {
      if (k === 'select' || k === 'columns') continue;
      if (k === 'order') { order = ' order by ' + v.split(',').map((o) => { const [c, d] = o.split('.'); return `${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', '); continue; }
      if (k === 'limit') { limit = ` limit ${Number(v) | 0}`; continue; }
      const m = v.match(/^(eq|neq|is)\.(.*)$/);
      if (!m) continue;
      if (m[1] === 'is') { where.push(`${ident(k)} is ${m[2] === 'null' ? 'null' : 'not null'}`); continue; }
      params.push(m[2]); where.push(`${ident(k)}::text ${m[1] === 'eq' ? '=' : '<>'} $${params.length}`);
    }
    const w = where.length ? ` where ${where.join(' and ')}` : '';
    try {
      const out = await asRole(claimsFrom(req), async (c) => {
        if (req.method === 'GET') return (await c.query(`select * from ${table}${w}${order}${limit}`, params)).rows;
        const body = req.method === 'DELETE' ? null : await readBody(req);
        if (req.method === 'POST') {
          const rows = Array.isArray(body) ? body : [body];
          const results = [];
          for (const row of rows) {
            const cols = Object.keys(row);
            const r = await c.query(`insert into ${table} (${cols.map(ident).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
              cols.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k])));
            results.push(...r.rows);
          }
          return results;
        }
        if (req.method === 'PATCH') {
          const cols = Object.keys(body);
          const set = cols.map((k, i) => `${ident(k)} = $${params.length + i + 1}`).join(', ');
          return (await c.query(`update ${table} set ${set}${w} returning *`, [...params, ...cols.map((k) => body[k])])).rows;
        }
        if (req.method === 'DELETE') return (await c.query(`delete from ${table}${w} returning *`, params)).rows;
        return [];
      });
      return send(res, req.method === 'POST' ? 201 : 200, out);
    } catch (e) { return pgError(res, e); }
  }
  send(res, 404, { message: 'not found' });
}

http.createServer((req, res) => handle(req, res).catch((e) => { console.error(e); send(res, 500, { message: 'dev api error' }); }))
  .listen(PORT, () => console.log(`[dev-api] http://localhost:${PORT}  (DEVELOPMENT ONLY)`));
