// Two tiers. localStorage for small settings that must be readable
// synchronously on first render; IndexedDB for anything that grows — ride
// tracks and cached bike-lane tiles would blow the ~5 MB localStorage quota
// within a month of daily rides.

const PREFIX = 'bike.'

export function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeLocal(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch (err) {
    console.warn('localStorage write failed', key, err)
  }
}

const DB_NAME = 'bike'
const DB_VERSION = 1
export const STORES = { rides: 'rides', tracks: 'tracks', tiles: 'tiles', kv: 'kv' }

let dbPromise = null
const memory = new Map(Object.values(STORES).map((s) => [s, new Map()]))

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // Another tab upgrading the schema would otherwise block forever.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    // Private browsing and storage-disabled webviews land here. Everything
    // keeps working against the in-memory map; it just does not survive reload.
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  return dbPromise
}

function write(store, fn) {
  return openDb()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          if (!db) return resolve()
          const tx = db.transaction(store, 'readwrite')
          fn(tx.objectStore(store))
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        }),
    )
    .catch((err) => console.warn('db write failed', store, err))
}

export function dbGet(store, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(memory.get(store).get(key))
        const req = db.transaction(store, 'readonly').objectStore(store).get(key)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(memory.get(store).get(key))
      }),
  )
}

export function dbPut(store, key, value) {
  memory.get(store).set(key, value)
  return write(store, (os) => os.put(value, key))
}

export function dbDelete(store, key) {
  memory.get(store).delete(key)
  return write(store, (os) => os.delete(key))
}

export function dbClear(store) {
  memory.get(store).clear()
  return write(store, (os) => os.clear())
}

export function dbAll(store) {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve([...memory.get(store).values()])
        const req = db.transaction(store, 'readonly').objectStore(store).getAll()
        req.onsuccess = () => resolve(req.result || [])
        req.onerror = () => resolve([...memory.get(store).values()])
      }),
  )
}

/** Ask the browser not to evict ride history under storage pressure. */
export function requestPersistence() {
  try {
    navigator.storage?.persist?.().catch(() => {})
  } catch {
    // Not available in every webview; nothing to do about it.
  }
}
