const { test } = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const request = require('supertest');
const { readConfig } = require('../config/env');
const { createApp } = require('../app');
const { migrate } = require('../scripts/migrate');
const { createServices } = require('../config/services');

function environment(overrides = {}) {
  return { NODE_ENV: 'test', APP_BASE_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://localhost/remarket_test', MONGODB_URI: 'mongodb://localhost/test',
    SESSION_SECRET: 'a-test-secret-with-at-least-32-characters',
    SMTP_HOST: 'localhost', SMTP_USER: 'test', SMTP_PASS: 'test', EMAIL_FROM: 'test@example.com',
    CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test', CLOUDINARY_API_SECRET: 'test', ...overrides };
}
function application({ sqlFailure = false, mongoState = 1 } = {}) {
  return createApp({ config: readConfig(environment()),
    pool: { query: async () => { if (sqlFailure) throw new Error('private database error'); } },
    mongo: { connection: { readyState: mongoState, db: { admin: () => ({ ping: async () => {} }) } } },
    sessionStore: new session.MemoryStore() }).app;
}
test('configuration rejects missing secrets and unsafe production settings', () => {
  assert.throws(() => readConfig({}), /Missing environment/);
  assert.throws(() => readConfig(environment({ SESSION_SECRET: 'short' })), /SESSION_SECRET/);
  assert.throws(() => readConfig(environment({ NODE_ENV: 'production' })), /HTTPS/);
  assert.throws(() => readConfig(environment({ PORT: 'invalid' })), /port/);
  assert.equal(readConfig(environment()).PORT, 3000);
  assert.equal(readConfig(environment()).ALLOWED_EMAIL_DOMAIN, '');
});
test('SMTP and Cloudinary clients construct without sending requests', () => {
  const services = createServices(readConfig(environment()));
  assert.equal(typeof services.mail.sendMail, 'function');
  assert.equal(services.mail.options.requireTLS, true);
  assert.equal(typeof services.images.uploader.upload_stream, 'function');
  services.mail.close();
});
test('health probes both databases without creating a session', async () => {
  const response = await request(application()).get('/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok' });
  assert.equal(response.headers['set-cookie'], undefined);
});
test('health reports unavailable without leaking connection details', async () => {
  for (const options of [{ sqlFailure: true }, { mongoState: 0 }]) {
    const response = await request(application(options)).get('/health').expect(503);
    assert.deepEqual(response.body, { status: 'unavailable' });
  }
});
test('home renders branding, security headers, and protected cookie', async () => {
  const response = await request(application()).get('/').expect(200);
  assert.match(response.text, /Sherubtse/);
  assert.ok(response.headers['content-security-policy']);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
});
test('missing and invalid CSRF tokens reject mutations', async () => {
  const agent = request.agent(application());
  await agent.get('/').expect(200);
  await agent.post('/anything').send({}).expect(403);
  await agent.post('/anything').send({ _csrf: 'bad' }).expect(403);
});
test('404 renders a safe error page', async () => {
  const response = await request(application()).get('/missing').expect(404);
  assert.match(response.text, /Page not found/);
});
test('migration runner rolls back failed migration and releases lock', async () => {
  const calls = [];
  const client = { query: async sql => {
    calls.push(sql);
    if (sql.startsWith('SELECT checksum')) return { rowCount: 0 };
    if (sql.includes('CREATE TABLE users')) throw new Error('simulated DDL failure');
    return {};
  }, release: () => calls.push('release') };
  await assert.rejects(migrate({ connect: async () => client }), /simulated/);
  assert.ok(calls.includes('ROLLBACK'));
  assert.ok(calls.some(sql => sql.startsWith('SELECT pg_advisory_unlock')));
  assert.equal(calls.at(-1), 'release');
});
