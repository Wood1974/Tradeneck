// IndexedDB storage wrapper for Shield Capture App

class StorageManager {
  constructor(config) {
    this.config = config;
    this.db = null;
  }

  // Initialize IndexedDB
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.DB_NAME, this.config.DB_VERSION);

      request.onerror = () => {
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains(this.config.STORES.PACKS)) {
          const packStore = db.createObjectStore(this.config.STORES.PACKS, { keyPath: 'id' });
          packStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.config.STORES.CAPTURES)) {
          const captureStore = db.createObjectStore(this.config.STORES.CAPTURES, {
            keyPath: 'id',
            autoIncrement: true
          });
          captureStore.createIndex('pack_id', 'pack_id', { unique: false });
          captureStore.createIndex('nonce', 'nonce', { unique: false });
          captureStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.config.STORES.MANIFESTS)) {
          const manifestStore = db.createObjectStore(this.config.STORES.MANIFESTS, { keyPath: 'id' });
          manifestStore.createIndex('pack_id', 'pack_id', { unique: false });
          manifestStore.createIndex('created_at', 'created_at', { unique: false });
        }
      };
    });
  }

  // Save a pack definition
  async savePack(pack) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.config.STORES.PACKS], 'readwrite');
      const store = transaction.objectStore(this.config.STORES.PACKS);
      const packData = {
        ...pack,
        timestamp: Date.now()
      };
      const request = store.put(packData);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(packData);
    });
  }

  // Get all packs
  async getPacks() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.config.STORES.PACKS], 'readonly');
      const store = transaction.objectStore(this.config.STORES.PACKS);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  // Save a capture (photo + metadata)
  async saveCapture(capture) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.config.STORES.CAPTURES], 'readwrite');
      const store = transaction.objectStore(this.config.STORES.CAPTURES);
      const captureData = {
        ...capture,
        created_at: capture.created_at || new Date().toISOString()
      };
      const request = store.put(captureData);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        captureData.id = request.result;
        resolve(captureData);
      };
    });
  }

  // Get captures for a pack
  async getCapturesByPack(packId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.config.STORES.CAPTURES], 'readonly');
      const store = transaction.objectStore(this.config.STORES.CAPTURES);
      const index = store.index('pack_id');
      const request = index.getAll(packId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  // Get captures by nonce
  async getCapturesByNonce(nonce) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.config.STORES.CAPTURES], 'readonly');
      const store = transaction.objectStore(this.config.STORES.CAPTURES);
      const index = store.index('nonce');
      const request = index.getAll(nonce);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  // Get single capture
  async getCapture(captureId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.config.STORES.CAPTURES], 'readonly');
      const store = transaction.objectStore(this.config.STORES.CAPTURES);
      const request = store.get(captureId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  // Update capture
  async updateCapture(captureId, updates) {
    const capture = await this.getCapture(captureId);
    const updated = { ...capture, ...updates };
    return this.saveCapture(updated);
  }

  // Delete capture
  async deleteCapture(captureId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.config.STORES.CAPTURES], 'readwrite');
      const store = transaction.objectStore(this.config.STORES.CAPTURES);
      const request = store.delete(captureId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  // Save manifest
  async saveManifest(manifest) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.config.STORES.MANIFESTS], 'readwrite');
      const store = transaction.objectStore(this.config.STORES.MANIFESTS);
      const manifestData = {
        ...manifest,
        created_at: manifest.created_at || new Date().toISOString()
      };
      const request = store.put(manifestData);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        manifestData.id = request.result;
        resolve(manifestData);
      };
    });
  }

  // Get manifest by ID
  async getManifest(manifestId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.config.STORES.MANIFESTS], 'readonly');
      const store = transaction.objectStore(this.config.STORES.MANIFESTS);
      const request = store.get(manifestId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  // Clear all data (for testing)
  async clear() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([
        this.config.STORES.PACKS,
        this.config.STORES.CAPTURES,
        this.config.STORES.MANIFESTS
      ], 'readwrite');

      const stores = [
        this.config.STORES.PACKS,
        this.config.STORES.CAPTURES,
        this.config.STORES.MANIFESTS
      ];

      let completed = 0;
      stores.forEach(storeName => {
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => {
          completed++;
          if (completed === stores.length) {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
    });
  }
}
