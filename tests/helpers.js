import assert from 'node:assert/strict';
import { zendeskClient } from '../src/zendesk-client.js';

// Replace zendeskClient.request for one test. `routes` maps "METHOD /endpoint"
// to a response object, or to a function (params, data) that returns one.
// Returns the list of calls made, for assertions.
export function stubZendesk(t, routes) {
  const calls = [];
  t.mock.method(zendeskClient, 'request', async (method, endpoint, data = null, params = null) => {
    calls.push({ method, endpoint, data, params });
    const route = routes[`${method} ${endpoint}`];
    if (route === undefined) throw new Error(`Unexpected request: ${method} ${endpoint}`);
    return typeof route === 'function' ? route(params, data) : route;
  });
  return calls;
}

export function findTool(tools, name) {
  const tool = tools.find(candidate => candidate.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool;
}

// Parse a tool result's JSON text, failing the test if the tool returned an error
export function resultJson(result) {
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

// Drop undefined values so request params can be compared with deepEqual
export function defined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

// Set object[key] for one test and restore it afterwards
// (node:test in Node 22 has no mock.property)
export function setProperty(t, object, key, value) {
  const had = Object.hasOwn(object, key);
  const previous = object[key];
  object[key] = value;
  t.after(() => {
    if (had) object[key] = previous;
    else delete object[key];
  });
}
