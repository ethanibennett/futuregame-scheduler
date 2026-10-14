'use strict';
/*
 * Preload for the Notify tap's server tests (`node -r ./test/stub-delivery-preload.js server.js`,
 * passed through test/helpers/scratch-server.js boot(..., { preloads })). It stands in for the two
 * ways server.js can reach a backer, so a test can count what WOULD have been sent and nothing
 * leaves the machine:
 *
 *   web push   require('web-push') resolves to a stub: setVapidDetails does nothing and
 *              sendNotification resolves, logging `[delivery-stub] push <endpoint>`.
 *   SMS        global fetch to api.twilio.com answers 201 without a request, logging
 *              `[delivery-stub] sms <To>`. Every other fetch goes through untouched.
 *
 * With these stubs in place a test can set VAPID_* and TWILIO_* to made-up values, so the senders
 * get past their "not configured" early returns and only the BACKER_DELIVERY gate decides.
 */
const Module = require('module');

const stubPush = {
  setVapidDetails() {},
  generateVAPIDKeys() { return { publicKey: 'stub', privateKey: 'stub' }; },
  async sendNotification(sub) {
    console.log(`[delivery-stub] push ${sub && sub.endpoint}`);
    return { statusCode: 201, body: '', headers: {} };
  },
};

const realLoad = Module._load;
Module._load = function (request) {
  if (request === 'web-push') return stubPush;
  return realLoad.apply(this, arguments);
};

const realFetch = globalThis.fetch;
globalThis.fetch = async function (url, init) {
  const u = String(url && url.url ? url.url : url);
  if (/^https:\/\/api\.twilio\.com\//.test(u)) {
    let to = '';
    try { to = new URLSearchParams(String((init && init.body) || '')).get('To') || ''; } catch (_) { /* no body */ }
    console.log(`[delivery-stub] sms ${to}`);
    return new Response('{"sid":"SMstub"}', { status: 201, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch.apply(this, arguments);
};
