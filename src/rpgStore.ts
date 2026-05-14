/**
 * rpgStore.ts — Local-First RPG State Manager
 *
 * Arsitektur:
 *  1. Setiap RPG action → IndexedDB DULU (instant, offline-capable)
 *  2. React state update dari lokal → UI tidak pernah nunggu network
 *  3. Firebase sync: background, 1× per hari (atau saat online setelah offline)
 *  4. Transfer: queue lokal → execute saat online
 *  5. Anti-cheat: enkripsi XOR + checksum + delta validation
 *
 * Cara kerja transfer:
 *  - Online  : eksekusi langsung ke Firebase (real-time)
 *  - Offline : queue di IndexedDB, auto-execute saat buka app & online
 *  - UI transfer menampilkan "lastSyncedGold" (dari Firebase terakhir),
 *    bukan local gold → mencegah abuse transfer gold yang belum tersync
 */

import { doc, setDoc, updateDoc, getDoc, Firestore } from 'firebase/firestore'

// ════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════
export interface PendingTransfer {
  id: string
  fromUid: string
  toUid: string
  toUsername: string
  amount: number
  queuedAt: number
}

export interface SyncMeta {
  uid: string
  lastSync: number           // timestamp terakhir sync ke Firebase
  lastSyncedGold: number     // gold saat sync terakhir (untuk transfer UI)
  hasLocalChanges: boolean   // ada perubahan belum di-sync
}

export interface DeltaValidation {
  valid: boolean
  suspicious: boolean
  reason?: string
}

// ════════════════════════════════════════════════════════════════
// ENCRYPTION — XOR rolling key
// Cegah casual cheater yang coba edit localStorage/IndexedDB manual
// Bukan enkripsi kriptografis — key ada di JS, tapi cukup untuk 99% kasus
// ════════════════════════════════════════════════════════════════
const MAGIC = [0x4B, 0x79, 0x6F, 0x6B, 0x6F, 0x52, 0x50, 0x47] // "KyokoRPG"

function deriveKey(uid: string): Uint8Array {
  const key = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    const c = uid.charCodeAt(i % uid.length) || 0x42
    key[i] = (MAGIC[i % MAGIC.length] ^ c ^ ((i * 31 + 7) & 0xFF)) & 0xFF
  }
  return key
}

/** FNV-1a 32-bit hash — ringan, cukup untuk checksum */
function fnv32(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h = ((h ^ s.charCodeAt(i)) * 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function encryptData(data: string, uid: string): string {
  const key = deriveKey(uid)
  const bytes = new TextEncoder().encode(data)
  const enc = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    enc[i] = bytes[i] ^ key[i % key.length]
  }
  const b64 = btoa(String.fromCharCode(...Array.from(enc)))
  return `${fnv32(data + uid)}:${b64}`
}

export function decryptData(enc: string, uid: string): string | null {
  try {
    const colon = enc.indexOf(':')
    if (colon < 0) return null
    const checksum = enc.slice(0, colon)
    const b64 = enc.slice(colon + 1)
    const key = deriveKey(uid)
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dec = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) {
      dec[i] = bytes[i] ^ key[i % key.length]
    }
    const data = new TextDecoder().decode(dec)
    if (fnv32(data + uid) !== checksum) {
      console.warn('[rpgStore] ⚠️ Checksum mismatch — data mungkin di-tamper, abaikan')
      return null
    }
    return data
  } catch {
    return null
  }
}

// ════════════════════════════════════════════════════════════════
// INDEXEDDB WRAPPER
// ════════════════════════════════════════════════════════════════
const IDB_NAME = 'kyoko_rpg_v2'
const IDB_VERSION = 1
let _idb: IDBDatabase | null = null

async function openIdb(): Promise<IDBDatabase> {
  if (_idb) return _idb
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('chars')) {
        db.createObjectStore('chars', { keyPath: 'uid' })
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'uid' })
      }
      if (!db.objectStoreNames.contains('transfers')) {
        const ts = db.createObjectStore('transfers', { keyPath: 'id' })
        ts.createIndex('fromUid', 'fromUid', { unique: false })
      }
    }
    req.onsuccess = (e) => {
      _idb = (e.target as IDBOpenDBRequest).result
      resolve(_idb)
    }
    req.onerror = () => reject(req.error)
  })
}

async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key)
    req.onsuccess = () => resolve((req.result as T) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(store: string, value: object): Promise<void> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(value)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function idbGetAllByIndex<T>(store: string, index: string, key: IDBValidKey): Promise<T[]> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).index(index).getAll(key)
    req.onsuccess = () => resolve((req.result as T[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

// ════════════════════════════════════════════════════════════════
// ANTI-CHEAT: DELTA VALIDATION
// Cek apakah perubahan stat masuk akal dalam rentang waktu tertentu
// ════════════════════════════════════════════════════════════════

// Estimasi maksimum sangat liberal (biar tidak false-positive untuk player aktif):
// 1000 battle/hari × max 700 gold = 700k gold
// + crafting, dungeon, quest = ~50k
// Total: ~750k/hari
const MAX_GOLD_GAIN_PER_DAY = 750_000
const MAX_LEVEL_GAIN_PER_DAY = 15

export function validateDelta(
  prevGold: number,
  prevLevel: number,
  newGold: number,
  newLevel: number,
  elapsedMs: number
): DeltaValidation {
  const days = Math.max(elapsedMs / (24 * 3_600_000), 1 / 24) // min 1 jam

  const goldGain = newGold - prevGold
  const levelGain = newLevel - prevLevel

  if (levelGain < 0) {
    return { valid: false, suspicious: true, reason: 'Level tidak bisa turun' }
  }
  if (goldGain > MAX_GOLD_GAIN_PER_DAY * days) {
    return { valid: false, suspicious: true, reason: `Gold gain terlalu tinggi: +${goldGain} dalam ${(days * 24).toFixed(1)} jam` }
  }
  if (levelGain > MAX_LEVEL_GAIN_PER_DAY * days) {
    return { valid: false, suspicious: true, reason: `Level gain terlalu tinggi: +${levelGain}` }
  }

  return { valid: true, suspicious: false }
}

// ════════════════════════════════════════════════════════════════
// PUBLIC API — CHAR STORAGE
// ════════════════════════════════════════════════════════════════

/** Simpan char ke IndexedDB (terenkripsi) */
export async function rpgSaveLocal(uid: string, char: object): Promise<void> {
  try {
    const json = JSON.stringify(char)
    const encrypted = encryptData(json, uid)
    await idbPut('chars', { uid, data: encrypted, savedAt: Date.now() })
  } catch (e) {
    console.error('[rpgStore] saveLocal error:', e)
  }
}

/** Load char dari IndexedDB (decrypt + verify checksum) */
export async function rpgLoadLocal(uid: string): Promise<object | null> {
  try {
    const row = await idbGet<{ uid: string; data: string; savedAt: number }>('chars', uid)
    if (!row) return null
    const json = decryptData(row.data, uid)
    if (!json) {
      console.warn('[rpgStore] Data lokal tidak valid atau di-tamper, abaikan')
      return null
    }
    return JSON.parse(json)
  } catch (e) {
    console.error('[rpgStore] loadLocal error:', e)
    return null
  }
}

// ════════════════════════════════════════════════════════════════
// PUBLIC API — SYNC META
// ════════════════════════════════════════════════════════════════

export async function getSyncMeta(uid: string): Promise<SyncMeta> {
  const meta = await idbGet<SyncMeta>('meta', uid)
  return meta ?? { uid, lastSync: 0, lastSyncedGold: 0, hasLocalChanges: false }
}

export async function setSyncMeta(uid: string, updates: Partial<Omit<SyncMeta, 'uid'>>): Promise<void> {
  const cur = await getSyncMeta(uid)
  await idbPut('meta', { ...cur, uid, ...updates })
}

export async function markLocalChanges(uid: string): Promise<void> {
  await setSyncMeta(uid, { hasLocalChanges: true })
}

export async function rpgNeedsSync(uid: string): Promise<boolean> {
  const meta = await getSyncMeta(uid)
  if (!meta.hasLocalChanges) return false
  return Date.now() - meta.lastSync >= 24 * 3_600_000
}

// ════════════════════════════════════════════════════════════════
// PUBLIC API — FIREBASE SYNC (background)
// ════════════════════════════════════════════════════════════════

/**
 * Sync char ke Firebase (hanya jika online + 24h sejak sync terakhir).
 * Dipanggil background — tidak block UI.
 * Returns true jika sync berhasil.
 */
export async function rpgSyncToFirebase(
  uid: string,
  char: object & { gold?: number; level?: number },
  getRpgDb: (uid: string) => Firestore
): Promise<boolean> {
  if (!navigator.onLine) return false

  try {
    const meta = await getSyncMeta(uid)
    const elapsed = Date.now() - meta.lastSync

    // Delta validation (cek kewajaran sebelum push ke Firebase)
    if (meta.lastSync > 0) {
      const delta = validateDelta(
        meta.lastSyncedGold,
        0, // level lama tidak disimpan di meta untuk simplicity
        char.gold ?? 0,
        char.level ?? 0,
        elapsed
      )
      if (delta.suspicious) {
        console.warn('[rpgStore] ⚠️ Delta mencurigakan:', delta.reason)
        // Tetap sync tapi bisa di-flag di Firebase analytics
        // Jangan block sync atau user akan frustrated
      }
    }

    const db = getRpgDb(uid)
    await setDoc(doc(db, 'rpgChars', uid), char as Record<string, unknown>, { merge: true })

    await setSyncMeta(uid, {
      lastSync: Date.now(),
      lastSyncedGold: char.gold ?? 0,
      hasLocalChanges: false,
    })

    console.log('[rpgStore] ✅ Sync ke Firebase berhasil')
    return true
  } catch (e) {
    console.error('[rpgStore] syncToFirebase error:', e)
    return false
  }
}

// ════════════════════════════════════════════════════════════════
// PUBLIC API — TRANSFER QUEUE
// ════════════════════════════════════════════════════════════════

/** Tambahkan transfer ke antrian (saat offline atau Firebase error) */
export async function queueTransfer(transfer: Omit<PendingTransfer, 'id'>): Promise<string> {
  const id = `${transfer.fromUid}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  await idbPut('transfers', { ...transfer, id })
  return id
}

/** Ambil semua pending transfers milik user */
export async function getPendingTransfers(fromUid: string): Promise<PendingTransfer[]> {
  return idbGetAllByIndex<PendingTransfer>('transfers', 'fromUid', fromUid)
}

/** Hapus transfer yang sudah selesai atau dibatalkan */
export async function clearTransfer(id: string): Promise<void> {
  await idbDelete('transfers', id)
}

/**
 * Execute semua pending transfers ke Firebase.
 * Dipanggil saat app online setelah sebelumnya offline.
 * Returns jumlah transfer yang berhasil.
 */
export async function executePendingTransfers(
  fromUid: string,
  currentLocalGold: number,
  getRpgDb: (uid: string) => Firestore,
  onResult: (msg: string, isSuccess: boolean) => void
): Promise<number> {
  if (!navigator.onLine) return 0
  const pending = await getPendingTransfers(fromUid)
  if (pending.length === 0) return 0

  let gold = currentLocalGold
  let executed = 0

  for (const t of pending) {
    if (gold < t.amount) {
      onResult(`⚠️ Transfer pending ke ${t.toUsername} (${t.amount}G) dibatalkan: gold tidak cukup`, false)
      await clearTransfer(t.id)
      continue
    }

    try {
      const senderDb = getRpgDb(fromUid)
      const receiverDb = getRpgDb(t.toUid)

      // Kurangi sender
      await updateDoc(doc(senderDb, 'rpgChars', fromUid), { gold: gold - t.amount })
      // Tambah receiver (best-effort)
      const recSnap = await getDoc(doc(receiverDb, 'rpgChars', t.toUid))
      if (recSnap.exists()) {
        await updateDoc(doc(receiverDb, 'rpgChars', t.toUid), {
          gold: (recSnap.data().gold ?? 0) + t.amount,
        })
      }

      gold -= t.amount
      await clearTransfer(t.id)
      executed++
      onResult(`✅ Transfer pending ${t.amount}G ke ${t.toUsername} berhasil!`, true)
    } catch (e) {
      console.error('[rpgStore] Execute transfer error:', e)
    }
  }

  return executed
}

// ════════════════════════════════════════════════════════════════
// CONNECTIVITY HELPERS
// ════════════════════════════════════════════════════════════════

export function isOnline(): boolean {
  return navigator.onLine
}

/**
 * Cek apakah user punya session Firebase yang tersimpan (cached auth).
 * Digunakan untuk menentukan apakah bisa main offline tanpa login ulang.
 */
export function hasCachedAuth(): boolean {
  // Firebase simpan auth state di IndexedDB/localStorage dengan prefix ini
  try {
    const keys = Object.keys(localStorage)
    return keys.some((k) => k.startsWith('firebase:authUser:') || k.includes('firebaseLocalStorage'))
  } catch {
    return false
  }
}

/** Setup listener untuk auto-sync saat koneksi kembali */
export function setupOnlineListener(
  uid: string,
  getCurrentChar: () => object & { gold?: number; level?: number },
  getRpgDb: (uid: string) => Firestore,
  onPendingTransferResult: (msg: string, isSuccess: boolean) => void
): () => void {
  const handler = async () => {
    if (!navigator.onLine || !uid) return
    console.log('[rpgStore] 🌐 Online! Menjalankan sync & pending transfers...')

    // Execute pending transfers
    const char = getCurrentChar()
    if (char.gold !== undefined) {
      await executePendingTransfers(uid, char.gold, getRpgDb, onPendingTransferResult)
    }

    // Sync jika diperlukan
    const needsSync = await rpgNeedsSync(uid)
    if (needsSync) {
      await rpgSyncToFirebase(uid, char, getRpgDb)
    }
  }

  window.addEventListener('online', handler)
  return () => window.removeEventListener('online', handler)
}
