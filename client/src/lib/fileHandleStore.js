// A file handle from showOpenFilePicker() is a live object, not a path — it
// can't be stringified into localStorage, but IndexedDB can store it directly.
// That's what lets the app offer "reconnect" (one click, no file picker) after
// a reload instead of making you find the file again mid-draft.

const DB_NAME = 'adl-drafter';
const STORE = 'handles';
const KEY = 'pickFeedFile';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req?.result ?? null);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

// Every call swallows its own failure: a browser with site data blocked just
// means the file has to be picked again, which is a nuisance, not a fault.
export async function saveHandle(handle) {
  try {
    await withStore('readwrite', (store) => store.put(handle, KEY));
  } catch {
    /* not persistable here */
  }
}

export async function loadHandle() {
  try {
    return await withStore('readonly', (store) => store.get(KEY));
  } catch {
    return null;
  }
}

export async function clearHandle() {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    /* nothing to forget */
  }
}
