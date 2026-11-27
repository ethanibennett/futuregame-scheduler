'use strict';
/*
 * Preload for the Notify tap's server tests (`node -r ./test/stub-delivery-preload.js server.js`,
 * passed through test/helpers/scratch-server.js boot(..., { preloads })). It stands in for the two
 * ways server.js can reach a backer, so a test can count what WOULD have been sent and nothing
 * leaves the machine:
 *
 *   web push   require('web-push') resolves to a stub: setVapidDetails does nothing and
 *              sendNotification resolves, logging `[delivery-stub] push [<title>] <endpoint>`.
 *   SMS        global fetch to api.twilio.com answers 201 without a request, logging
 *              `[delivery-stub] sms <To>`. Every other fetch goes through untouched.
 *
 * With these stubs in place a test can set VAPID_* and TWILIO_* to made-up values, so the senders
 * get past their "not configured" early returns and only the BACKER_DELIVERY gate decides.
 *
 * With DELIVERY_STUB_DETAIL=1 (test/play-tables.test.js), each push also logs
 * `[delivery-detail] {"endpoint","payload","options"}` on a line of its own, and a push to an endpoint
 * holding `/stub-gone/` is refused as the push service refuses a dropped subscription (410), logging
 * `[delivery-stub] gone [<title>] <endpoint>`. Unset, the log is as it always was.
 */
const Module = require('module');

const stubPush = {
  setVapidDetails() {},
  generateVAPIDKeys() { return { publicKey: 'stub', privateKey: 'stub' }; },
  async sendNotification(sub, payload, options) {
    // The title in brackets, then the endpoint LAST (tests read it with split(' ').pop()).
    let title = '';
    try { title = String(JSON.parse(payload).title || ''); } catch (_) { /* not JSON */ }
    if (process.env.DELIVERY_STUB_DETAIL === '1') {
      console.log(`[delivery-detail] ${JSON.stringify({ endpoint: sub && sub.endpoint, payload, options: options || null })}`);
      if (/\/stub-gone\//.test(String(sub && sub.endpoint))) {
        console.log(`[delivery-stub] gone [${title}] ${sub.endpoint}`);
        throw Object.assign(new Error('Received unexpected response code'), { statusCode: 410 });
      }
    }
    console.log(`[delivery-stub] push [${title}] ${sub && sub.endpoint}`);
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
