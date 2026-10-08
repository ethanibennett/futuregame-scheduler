'use strict';
/*
 * Preload (`node -r ./test/stub-solver-preload.js server.js`) that lets server.js
 * boot WITHOUT the ./solver junction — a git worktree or a CI checkout has none,
 * and server.js requires into it at load time for the trainer features.
 *
 * Every `./solver/...` require resolves to an inert stub: a callable Proxy whose
 * every property is another stub, so destructuring, `new`, calls and chained
 * access at module scope all succeed. The trainer routes are unusable under it;
 * nothing else is affected.
 */
const Module = require('module');

function stub(name) {
  const fn = function () { return stub(name + '()'); };
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => `[solver stub ${name}]`;
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'then') return undefined; // not a thenable
      if (prop in target && prop !== 'name' && prop !== 'length') return target[prop];
      return stub(`${name}.${String(prop)}`);
    },
    apply() { return stub(name + '()'); },
    construct() { return stub('new ' + name); },
    ownKeys() { return ['prototype']; },
    getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop); },
  });
}

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (/^\.\/solver(?:\/|$)/.test(request)) {
    return stub(request);
  }
  return realLoad.apply(this, arguments);
};
