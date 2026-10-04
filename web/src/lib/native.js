// Bridge to the iOS shell (ios/Sources/Native/NativeBridge.swift).
//
// JS → native: window.webkit.messageHandlers.bike.postMessage({ type, ...payload })
// native → JS: window.__bikeNative.receive({ type, ...payload })
//
// Native holds every event until it hears `ready`, so nothing it sends can
// land before the handlers below are attached.

const handlers = new Map()

export const isNative = typeof window !== 'undefined' && Boolean(window.webkit?.messageHandlers?.bike)

if (typeof window !== 'undefined') {
  window.__bikeNative = {
    receive(message) {
      const set = handlers.get(message?.type)
      if (!set) return
      for (const fn of set) {
        try {
          fn(message)
        } catch (err) {
          console.error('native handler failed', message.type, err)
        }
      }
    },
  }
}

export function onNative(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type).add(fn)
  return () => handlers.get(type)?.delete(fn)
}

export function postNative(type, payload = {}) {
  if (!isNative) return false
  try {
    window.webkit.messageHandlers.bike.postMessage({ type, ...payload })
    return true
  } catch (err) {
    console.warn('native post failed', type, err)
    return false
  }
}

/** light | medium | heavy | success | warning | selection */
export const haptic = (style = 'light') => postNative('haptic', { style })

// HTTP through URLSession instead of the webview. Overpass turns away
// browser requests whose Origin isn't http(s) (and this page's origin is
// bike://app) but accepts a client that names itself in its User-Agent,
// which only native code can set.
let fetchSeq = 0
const pendingFetches = new Map()

onNative('fetchResult', (m) => {
  const pending = pendingFetches.get(m.id)
  if (!pending) return
  pendingFetches.delete(m.id)
  clearTimeout(pending.timer)
  if (m.error) pending.reject(new Error(m.error))
  else pending.resolve({ ok: m.status >= 200 && m.status < 300, status: m.status, json: async () => JSON.parse(m.body ?? '') })
})

export function nativeFetch(url, { method = 'GET', headers = {}, body = null, timeout = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = `f${++fetchSeq}`
    const timer = setTimeout(() => {
      pendingFetches.delete(id)
      reject(new Error('Request timed out'))
    }, timeout)
    pendingFetches.set(id, { resolve, reject, timer })
    if (!postNative('fetch', { id, url, method, headers, body })) {
      clearTimeout(timer)
      pendingFetches.delete(id)
      reject(new Error('Native bridge unavailable'))
    }
  })
}
