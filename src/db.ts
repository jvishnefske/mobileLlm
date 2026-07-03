// Tiny IndexedDB wrapper backing the agent's persistent memory and the
// imported document library. IndexedDB works identically on Android and iOS.

const DB_NAME = 'pocket-agent';
const DB_VERSION = 1;

export interface MemoryEntry {
  key: string;
  text: string;
  updatedAt: number;
}

export interface DocumentEntry {
  name: string;
  content: string;
  addedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('memory')) {
        db.createObjectStore('memory', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: 'memory' | 'documents',
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

export const memoryStore = {
  save: (key: string, text: string) =>
    tx('memory', 'readwrite', (s) => s.put({ key, text, updatedAt: Date.now() })),
  get: (key: string) => tx<MemoryEntry | undefined>('memory', 'readonly', (s) => s.get(key)),
  list: () => tx<MemoryEntry[]>('memory', 'readonly', (s) => s.getAll()),
  delete: (key: string) => tx('memory', 'readwrite', (s) => s.delete(key)),
};

export const documentStore = {
  save: (name: string, content: string) =>
    tx('documents', 'readwrite', (s) => s.put({ name, content, addedAt: Date.now() })),
  get: (name: string) => tx<DocumentEntry | undefined>('documents', 'readonly', (s) => s.get(name)),
  list: () => tx<DocumentEntry[]>('documents', 'readonly', (s) => s.getAll()),
  delete: (name: string) => tx('documents', 'readwrite', (s) => s.delete(name)),
};
