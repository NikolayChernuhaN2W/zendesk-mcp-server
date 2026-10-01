import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { zendeskClient } from '../src/zendesk-client.js';
import { setProperty } from './helpers.js';

function httpError(status, headers = {}, data = { error: 'x' }) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, headers, data } });
}

// Configure credentials and fake the transport for one test
function setup(t, responses) {
  const sleeps = [];
  const requests = [];
  setProperty(t, zendeskClient, 'subdomain', 'acme');
  setProperty(t, zendeskClient, 'email', 'a@b.c');
  setProperty(t, zendeskClient, 'apiToken', 'token');
  setProperty(t, zendeskClient, 'sleep', async ms => { sleeps.push(ms); });
  setProperty(t, zendeskClient, 'http', async config => {
    requests.push(config);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { data: next };
  });
  return { sleeps, requests };
}

test('sends the request to the account URL with basic auth', async t => {
  const { requests } = setup(t, [{ ok: true }]);
  assert.deepEqual(await zendeskClient.request('GET', '/tickets.json', null, { page: 1 }), { ok: true });
  assert.equal(requests[0].url, 'https://acme.zendesk.com/api/v2/tickets.json');
  assert.deepEqual(requests[0].params, { page: 1 });
  assert.match(requests[0].headers.Authorization, /^Basic /);
});

test('waits for Retry-After and retries on 429', async t => {
  const { sleeps, requests } = setup(t, [httpError(429, { 'retry-after': '5' }), { ok: true }]);
  assert.deepEqual(await zendeskClient.request('GET', '/tickets.json'), { ok: true });
  assert.deepEqual(sleeps, [5000]);
  assert.equal(requests.length, 2);
});

test('waits 10 seconds without Retry-After, and at most 60', async t => {
  const { sleeps } = setup(t, [httpError(429), httpError(429, { 'retry-after': '120' }), { ok: true }]);
  await zendeskClient.request('GET', '/tickets.json');
  assert.deepEqual(sleeps, [10000, 60000]);
});

test('gives up after 3 retries', async t => {
  const { requests } = setup(t, [httpError(429), httpError(429), httpError(429), httpError(429)]);
  await assert.rejects(zendeskClient.request('GET', '/tickets.json'), error => {
    assert.equal(error.status, 429);
    assert.match(error.message, /^Zendesk API Error: 429 - /);
    return true;
  });
  assert.equal(requests.length, 4);
});

test('does not retry other errors, and keeps the message format', async t => {
  const { requests } = setup(t, [httpError(404, {}, { error: 'RecordNotFound' })]);
  await assert.rejects(zendeskClient.request('GET', '/tickets/1.json'), error => {
    assert.equal(error.status, 404);
    assert.equal(error.message, 'Zendesk API Error: 404 - {"error":"RecordNotFound"}');
    return true;
  });
  assert.equal(requests.length, 1);
});

test('refuses to call Zendesk without credentials', async t => {
  setup(t, []);
  zendeskClient.apiToken = undefined; // restored by setup's setProperty
  await assert.rejects(zendeskClient.request('GET', '/tickets.json'), /credentials not configured/);
});

test('GET requests carry no body and no Content-Type', async t => {
  const { requests } = setup(t, [{ ok: true }, { ok: true }]);
  await zendeskClient.request('GET', '/help_center/articles/search.json', null, { label_names: 'ai_valid' });
  assert.equal('data' in requests[0], false);
  assert.equal(requests[0].headers['Content-Type'], undefined);

  await zendeskClient.request('POST', '/tickets.json', { ticket: { subject: 'Hi' } });
  assert.deepEqual(requests[1].data, { ticket: { subject: 'Hi' } });
  assert.equal(requests[1].headers['Content-Type'], 'application/json');
});

// Zendesk's Help Center search rejects a GET with any body ("Request body
// not accepted on GET request"), so check the bytes that actually go out
test('a GET sends nothing in the request body on the wire', async t => {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push({ body, contentLength: req.headers['content-length'], contentType: req.headers['content-type'] });
      res.setHeader('Content-Type', 'application/json');
      res.end('{"results":[]}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  setProperty(t, zendeskClient, 'subdomain', 'acme');
  setProperty(t, zendeskClient, 'email', 'a@b.c');
  setProperty(t, zendeskClient, 'apiToken', 'token');
  setProperty(t, zendeskClient, 'getBaseUrl', () => `http://127.0.0.1:${server.address().port}/api/v2`);

  await zendeskClient.searchArticles({ label_names: 'ai_valid' });
  assert.equal(received[0].body, '');
  assert.equal(received[0].contentType, undefined);
  assert.ok(!received[0].contentLength || received[0].contentLength === '0', `content-length was ${received[0].contentLength}`);
});
