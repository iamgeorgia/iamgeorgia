import { api, apiLogin, record, USERS, sql } from './lib.mjs';
const lg = await apiLogin(USERS.management);
const ok = await api('GET', '/api/auth/me', { token: lg.token });
const sid = sql(`select id from sessions where user_id=(select id from users where email='${USERS.management}') and revoked_at is null order by created_at desc limit 1`);
sql(`update sessions set expires_at = now() - interval '1 minute' where id='${sid}'`);
const after = await api('GET', '/api/auth/me', { token: lg.token });
record('A20', 'An expired session (expires_at in the past) is refused with 401', ok.status === 200 && after.status === 401 ? 'PASS' : 'FAIL', `before=${ok.status} after=${after.status}`);
const lg2 = await apiLogin(USERS.management);
const n = sql(`select count(*) from sessions where user_id=(select id from users where email='${USERS.management}') and revoked_at is null and expires_at > now()`);
record('A21', 'Fresh login after expiry creates a new live session', lg2.status === 200 && Number(n) >= 1 ? 'PASS' : 'FAIL', `live=${n}`);
const ttl = sql(`select round(extract(epoch from (expires_at - created_at))/3600) from sessions where user_id=(select id from users where email='${USERS.management}') order by created_at desc limit 1`);
record('A22', 'Session lifetime (hours) recorded', 'INFO', `${ttl}h`);
// SUPER_ADMIN revokes another user's sessions → immediate 401
const sa = (await apiLogin(USERS.superadmin)).token;
const uid = sql(`select id from users where email='${USERS.management}'`);
const rev = await api('POST', `/api/admin/users/${uid}/sessions/revoke`, { token: sa, body: {} });
const after2 = await api('GET', '/api/auth/me', { token: lg2.token });
record('A23', 'Super admin revokes a user\'s sessions → that user is signed out at once', rev.status < 300 && after2.status === 401 ? 'PASS' : 'FAIL', `revoke=${rev.status} me=${after2.status}`);
await api('POST', '/api/auth/logout', { token: sa });
