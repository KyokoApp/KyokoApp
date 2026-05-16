import React, { useEffect, useState, useRef, useCallback } from 'react'
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app'
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL,
  listAll, getMetadata, FirebaseStorage
} from 'firebase/storage'
import {
  getFirestore, collection, addDoc, getDocs, doc, deleteDoc,
  onSnapshot, orderBy, query, updateDoc, Firestore
} from 'firebase/firestore'

// ═══════════════════════════════════════════════════════
// FIREBASE CONFIGS
// 7 Firebase lama → limit 2GB per Firebase untuk manga
// kyokocross (ke-8) → pakai semua limit 5GB
// ═══════════════════════════════════════════════════════
const FIREBASE_CONFIGS: { name: string; label: string; limitGB: number; config: object }[] = [
  // ── Firebase ke-8 (khusus manga, full 5GB) ──────────
  {
    name: 'kyokocross',
    label: 'kyokocross ⭐',
    limitGB: 5,
    config: {
      apiKey: 'AIzaSyCdQG-Y4r2sG9mFIxf67Q7DA45zMsLR9f8',
      authDomain: 'kyokocross.firebaseapp.com',
      projectId: 'kyokocross',
      storageBucket: 'kyokocross.firebasestorage.app',
      messagingSenderId: '1072869574740',
      appId: '1:1072869574740:web:97efdfb78dd53caa0685c1',
    },
  },
  // ── 7 Firebase lama — limit 2GB untuk manga ─────────
  {
    name: 'chat',
    label: 'kyokochat (2GB)',
    limitGB: 2,
    config: {
      apiKey: 'AIzaSyD_TsheU34GB_hn_r1hiA1i4ZUC7-Z1qSo',
      authDomain: 'kyokochat-dc792.firebaseapp.com',
      projectId: 'kyokochat-dc792',
      storageBucket: 'kyokochat-dc792.firebasestorage.app',
      messagingSenderId: '730376199922',
      appId: '1:730376199922:web:e236b7caabbaa11c053a6b',
    },
  },
  {
    name: 'rpg1',
    label: 'kyokorpg1 (2GB)',
    limitGB: 2,
    config: {
      apiKey: 'AIzaSyBoIyBKvmEAav6tCZ2deXjXhylAPjnTdSA',
      authDomain: 'kyokorpg1.firebaseapp.com',
      projectId: 'kyokorpg1',
      storageBucket: 'kyokorpg1.firebasestorage.app',
      messagingSenderId: '1027115501521',
      appId: '1:1027115501521:web:44ece9f0070e1786abc2f0',
    },
  },
  {
    name: 'rpg2',
    label: 'kyokorpg2 (2GB)',
    limitGB: 2,
    config: {
      apiKey: 'AIzaSyD8Kfav-wDVVYuVjdPUrmqbVzIkl1Ztjw0',
      authDomain: 'kyokorpg2.firebaseapp.com',
      projectId: 'kyokorpg2',
      storageBucket: 'kyokorpg2.firebasestorage.app',
      messagingSenderId: '143692722959',
      appId: '1:143692722959:web:4a3163f0717f66ad6fc47a',
    },
  },
  {
    name: 'rpg3',
    label: 'kyokorpg3 (2GB)',
    limitGB: 2,
    config: {
      apiKey: 'AIzaSyDyqtGmjsxtu337KRZzzF2hf10e-k5W2Rk',
      authDomain: 'kyokorpg3.firebaseapp.com',
      projectId: 'kyokorpg3',
      storageBucket: 'kyokorpg3.firebasestorage.app',
      messagingSenderId: '987099196778',
      appId: '1:987099196778:web:1831086d569a88036d0913',
    },
  },
  {
    name: 'community',
    label: 'kyokocomunity (2GB)',
    limitGB: 2,
    config: {
      apiKey: 'AIzaSyCR31TsSG3xj1OFKVKPHa53f3_UPXFxSGI',
      authDomain: 'kyokocomunity.firebaseapp.com',
      projectId: 'kyokocomunity',
      storageBucket: 'kyokocomunity.firebasestorage.app',
      messagingSenderId: '119916958650',
      appId: '1:119916958650:web:77898a123e7fb2c24383',
    },
  },
  {
    name: 'admin',
    label: 'kyokoadmin (2GB)',
    limitGB: 2,
    config: {
      apiKey: 'AIzaSyCdEUk_0pPM_oUlwbhGA2j8-sX0RsoXcRw',
      authDomain: 'kyokoadmin.firebaseapp.com',
      projectId: 'kyokoadmin',
      storageBucket: 'kyokoadmin.firebasestorage.app',
      messagingSenderId: '949808881814',
      appId: '1:949808881814:web:afe5159e81eb08491e62b7',
    },
  },
  {
    name: 'bonus',
    label: 'kyokobonus (2GB)',
    limitGB: 2,
    config: {
      apiKey: 'AIzaSyBBdDhf0VQgST6bdfIt6WgBe-JVt-OxvSI',
      authDomain: 'kyokobonus.firebaseapp.com',
      projectId: 'kyokobonus',
      storageBucket: 'kyokobonus.firebasestorage.app',
      messagingSenderId: '722266253162',
      appId: '1:722266253162:web:ec515a7c58616d55a06713',
    },
  },
]

const LIMIT_BYTES = (gb: number) => gb * 1024 * 1024 * 1024

// ═══════════════════════════════════════════════════════
// INIT FIREBASE INSTANCES
// ═══════════════════════════════════════════════════════
function getFirebaseInstance(name: string, config: object): FirebaseApp {
  const existing = getApps().find(a => a.name === name)
  return existing ?? initializeApp(config, name)
}

interface FbInstance {
  name: string
  label: string
  limitGB: number
  app: FirebaseApp
  storage: FirebaseStorage
  db: Firestore
}

const FB_INSTANCES: FbInstance[] = FIREBASE_CONFIGS.map(fc => {
  const app = getFirebaseInstance(fc.name, fc.config)
  return {
    name: fc.name,
    label: fc.label,
    limitGB: fc.limitGB,
    app,
    storage: getStorage(app),
    db: getFirestore(app),
  }
})

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════
interface MangaDoc {
  id: string
  title: string
  author: string
  genre: string
  status: 'ongoing' | 'completed' | 'hiatus'
  coverUrl: string
  firebaseName: string
  chapters: ChapterDoc[]
  createdAt: number
  description: string
}

interface ChapterDoc {
  id: string
  mangaId: string
  chapterNumber: number
  title: string
  pages: string[]
  firebaseName: string
  uploadedAt: number
}

interface StorageStats {
  name: string
  label: string
  usedBytes: number
  limitBytes: number
  limitGB: number
}

interface Props {
  isAdmin: boolean
  userId: string
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function usagePercent(used: number, limit: number) {
  return Math.min(100, (used / limit) * 100)
}

function storageColor(pct: number) {
  if (pct >= 90) return '#ff4444'
  if (pct >= 70) return '#ffaa00'
  return '#c8f500'
}

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════
export default function MangaCrossPanel({ isAdmin, userId }: Props) {
  const [view, setView] = useState<'home' | 'read' | 'upload' | 'storage'>('home')
  const [mangas, setMangas] = useState<MangaDoc[]>([])
  const [selectedManga, setSelectedManga] = useState<MangaDoc | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<ChapterDoc | null>(null)
  const [activeTab, setActiveTab] = useState<'popular' | 'new' | 'saved'>('popular')
  const [search, setSearch] = useState('')
  const [storageStats, setStorageStats] = useState<StorageStats[]>([])
  const [loadingStats, setLoadingStats] = useState(false)

  // Upload state
  const [uploadFb, setUploadFb] = useState(FB_INSTANCES[0].name)
  const [uploadStep, setUploadStep] = useState<'meta' | 'cover' | 'chapter'>('meta')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadAuthor, setUploadAuthor] = useState('')
  const [uploadGenre, setUploadGenre] = useState('')
  const [uploadStatus, setUploadStatus] = useState<'ongoing'|'completed'|'hiatus'>('ongoing')
  const [uploadDesc, setUploadDesc] = useState('')
  const [uploadCoverFile, setUploadCoverFile] = useState<File | null>(null)
  const [uploadCoverPreview, setUploadCoverPreview] = useState('')
  const [uploadZipFile, setUploadZipFile] = useState<File | null>(null)
  const [uploadChapterNum, setUploadChapterNum] = useState(1)
  const [uploadChapterTitle, setUploadChapterTitle] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus2, setUploadStatus2] = useState('')
  const [uploadingMangaId, setUploadingMangaId] = useState('')

  const coverInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  // ── Load all mangas from all Firebase instances ──
  useEffect(() => {
    const unsubs: (() => void)[] = []
    const allMangas: Record<string, MangaDoc> = {}

    FB_INSTANCES.forEach(fb => {
      const q = query(collection(fb.db, 'mangaCross'), orderBy('createdAt', 'desc'))
      const unsub = onSnapshot(q, snap => {
        snap.docs.forEach(d => {
          const data = d.data()
          allMangas[d.id] = {
            id: d.id,
            title: data.title,
            author: data.author,
            genre: data.genre,
            status: data.status,
            coverUrl: data.coverUrl,
            firebaseName: fb.name,
            description: data.description || '',
            chapters: [],
            createdAt: data.createdAt,
          }
        })
        setMangas(Object.values(allMangas).sort((a, b) => b.createdAt - a.createdAt))
      })
      unsubs.push(unsub)
    })

    return () => unsubs.forEach(u => u())
  }, [])

  // ── Load chapters for selected manga ──
  useEffect(() => {
    if (!selectedManga) return
    const fb = FB_INSTANCES.find(f => f.name === selectedManga.firebaseName)
    if (!fb) return
    const q = query(
      collection(fb.db, 'mangaCross', selectedManga.id, 'chapters'),
      orderBy('chapterNumber', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      const chapters: ChapterDoc[] = snap.docs.map(d => ({
        id: d.id,
        mangaId: selectedManga.id,
        chapterNumber: d.data().chapterNumber,
        title: d.data().title,
        pages: d.data().pages || [],
        firebaseName: selectedManga.firebaseName,
        uploadedAt: d.data().uploadedAt,
      }))
      setSelectedManga(prev => prev ? { ...prev, chapters } : prev)
    })
    return () => unsub()
  }, [selectedManga?.id])

  // ── Fetch storage stats ──
  const fetchStorageStats = useCallback(async () => {
    setLoadingStats(true)
    const stats: StorageStats[] = []
    for (const fb of FB_INSTANCES) {
      try {
        // Hitung usage dari metadata semua file di /mangaCross/
        let totalBytes = 0
        const listResult = await listAll(ref(fb.storage, 'mangaCross'))
        // Rekursif folder
        const processFolder = async (folderRef: any) => {
          const result = await listAll(folderRef)
          for (const item of result.items) {
            const meta = await getMetadata(item)
            totalBytes += meta.size
          }
          for (const folder of result.prefixes) {
            await processFolder(folder)
          }
        }
        for (const prefix of listResult.prefixes) {
          await processFolder(prefix)
        }
        for (const item of listResult.items) {
          const meta = await getMetadata(item)
          totalBytes += meta.size
        }
        stats.push({ name: fb.name, label: fb.label, usedBytes: totalBytes, limitBytes: LIMIT_BYTES(fb.limitGB), limitGB: fb.limitGB })
      } catch {
        stats.push({ name: fb.name, label: fb.label, usedBytes: 0, limitBytes: LIMIT_BYTES(fb.limitGB), limitGB: fb.limitGB })
      }
    }
    setStorageStats(stats)
    setLoadingStats(false)
  }, [])

  useEffect(() => {
    if (view === 'storage') fetchStorageStats()
  }, [view])

  // ── Upload cover image ──
  const uploadCover = async (mangaId: string, fb: FbInstance): Promise<string> => {
    if (!uploadCoverFile) return ''
    const storageRef = ref(fb.storage, `mangaCross/${mangaId}/cover.jpg`)
    return new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, uploadCoverFile)
      task.on('state_changed',
        snap => setUploadProgress(10 + (snap.bytesTransferred / snap.totalBytes) * 20),
        reject,
        async () => { resolve(await getDownloadURL(task.snapshot.ref)) }
      )
    })
  }

  // ── Extract ZIP and upload pages ──
  const uploadZipPages = async (mangaId: string, chapterId: string, fb: FbInstance): Promise<string[]> => {
    if (!uploadZipFile) return []
    // Dynamically import JSZip
    const JSZip = (await import('https://cdn.skypack.dev/jszip' as any)).default
    const zip = await JSZip.loadAsync(uploadZipFile)
    const files = Object.values(zip.files) as any[]
    const imageFiles = files
      .filter((f: any) => !f.dir && /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name))
      .sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    const pageUrls: string[] = []
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i]
      const blob = await file.async('blob')
      const ext = file.name.split('.').pop()
      const storageRef = ref(fb.storage, `mangaCross/${mangaId}/chapters/${chapterId}/${String(i + 1).padStart(3, '0')}.${ext}`)
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob)
        task.on('state_changed',
          snap => {
            const base = 40
            const perFile = 55 / imageFiles.length
            setUploadProgress(base + i * perFile + (snap.bytesTransferred / snap.totalBytes) * perFile)
          },
          reject,
          async () => {
            pageUrls.push(await getDownloadURL(task.snapshot.ref))
            resolve()
          }
        )
      })
      setUploadStatus2(`Upload halaman ${i + 1}/${imageFiles.length}...`)
    }
    return pageUrls
  }

  // ── Full upload flow ──
  const handleUpload = async () => {
    if (!uploadTitle.trim() || !uploadCoverFile || !uploadZipFile) {
      alert('Lengkapi judul, cover, dan file ZIP chapter!')
      return
    }
    setUploading(true)
    setUploadProgress(0)
    setUploadStatus2('Membuat data manga...')
    try {
      const fb = FB_INSTANCES.find(f => f.name === uploadFb)!

      // 1. Create manga doc
      setUploadProgress(5)
      let mangaId = uploadingMangaId
      if (!mangaId) {
        const docRef = await addDoc(collection(fb.db, 'mangaCross'), {
          title: uploadTitle.trim(),
          author: uploadAuthor.trim() || 'Unknown',
          genre: uploadGenre.trim() || 'General',
          status: uploadStatus,
          description: uploadDesc.trim(),
          coverUrl: '',
          createdAt: Date.now(),
          firebaseName: fb.name,
        })
        mangaId = docRef.id
        setUploadingMangaId(mangaId)
      }

      // 2. Upload cover
      setUploadStatus2('Upload cover...')
      const coverUrl = await uploadCover(mangaId, fb)
      await updateDoc(doc(fb.db, 'mangaCross', mangaId), { coverUrl })
      setUploadProgress(35)

      // 3. Create chapter doc
      setUploadStatus2('Membuat data chapter...')
      const chapterRef = await addDoc(collection(fb.db, 'mangaCross', mangaId, 'chapters'), {
        chapterNumber: uploadChapterNum,
        title: uploadChapterTitle.trim() || `Chapter ${uploadChapterNum}`,
        pages: [],
        uploadedAt: Date.now(),
      })
      setUploadProgress(40)

      // 4. Upload ZIP pages
      setUploadStatus2('Mengekstrak & upload halaman ZIP...')
      const pages = await uploadZipPages(mangaId, chapterRef.id, fb)

      // 5. Save pages to Firestore
      setUploadStatus2('Menyimpan data...')
      await updateDoc(doc(fb.db, 'mangaCross', mangaId, 'chapters', chapterRef.id), { pages })
      setUploadProgress(100)
      setUploadStatus2('✅ Upload berhasil!')

      // Reset chapter fields untuk upload chapter berikutnya
      setTimeout(() => {
        setUploadZipFile(null)
        setUploadChapterNum(prev => prev + 1)
        setUploadChapterTitle('')
        setUploadProgress(0)
        setUploadStatus2('')
        setUploading(false)
        // Jangan reset manga meta — biar bisa lanjut upload chapter berikutnya
      }, 1500)
    } catch (e: any) {
      setUploadStatus2('❌ Error: ' + e.message)
      setUploading(false)
    }
  }

  // ── Reset upload form ──
  const resetUpload = () => {
    setUploadTitle(''); setUploadAuthor(''); setUploadGenre('')
    setUploadDesc(''); setUploadCoverFile(null); setUploadCoverPreview('')
    setUploadZipFile(null); setUploadChapterNum(1); setUploadChapterTitle('')
    setUploadProgress(0); setUploadStatus2(''); setUploadingMangaId('')
    setUploadStep('meta')
  }

  const filteredMangas = mangas.filter(m =>
    m.title.toLowerCase().includes(search.toLowerCase()) ||
    m.author.toLowerCase().includes(search.toLowerCase()) ||
    m.genre.toLowerCase().includes(search.toLowerCase())
  )

  const statusColor: Record<string, string> = {
    completed: '#4fc3f7',
    ongoing: '#c8f500',
    hiatus: '#ff9800',
  }

  // ════════════════════════════════════════════════════
  // VIEW: READER
  // ════════════════════════════════════════════════════
  if (view === 'read' && selectedChapter) {
    return (
      <div style={S.wrap}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => { setView('home'); setSelectedChapter(null) }}>‹ Kembali</button>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1, textAlign: 'center' }}>
            {selectedManga?.title} — Ch.{selectedChapter.chapterNumber}
          </div>
          <div style={{ width: 60 }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1, background: '#000' }}>
          {selectedChapter.pages.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: 40 }}>
              <div style={{ fontSize: 40 }}>📭</div>
              Halaman tidak ditemukan
            </div>
          ) : (
            selectedChapter.pages.map((url, i) => (
              <img key={i} src={url} alt={`page-${i + 1}`}
                style={{ width: '100%', display: 'block', marginBottom: 2 }} />
            ))
          )}
          <div style={{ height: 60 }} />
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════
  // VIEW: MANGA DETAIL
  // ════════════════════════════════════════════════════
  if (view === 'read' && selectedManga && !selectedChapter) {
    return (
      <div style={S.wrap}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => { setView('home'); setSelectedManga(null) }}>‹ Kembali</button>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1, textAlign: 'center' }}>
            {selectedManga.title}
          </div>
          <div style={{ width: 60 }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Cover + info */}
          <div style={{ display: 'flex', gap: 14, padding: '14px 14px 0' }}>
            <img src={selectedManga.coverUrl} alt="cover"
              style={{ width: 110, height: 160, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginBottom: 4 }}>{selectedManga.title}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>✍️ {selectedManga.author}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>🏷️ {selectedManga.genre}</div>
              <span style={{ fontSize: 10, fontWeight: 700, color: statusColor[selectedManga.status],
                background: statusColor[selectedManga.status] + '22', borderRadius: 4, padding: '2px 7px',
                textTransform: 'uppercase' }}>{selectedManga.status}</span>
              {selectedManga.description && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 8, lineHeight: 1.5 }}>
                  {selectedManga.description}
                </div>
              )}
            </div>
          </div>

          {/* Chapter list */}
          <div style={{ padding: '14px 14px 80px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 10, letterSpacing: 1 }}>
              CHAPTER LIST ({selectedManga.chapters.length})
            </div>
            {selectedManga.chapters.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: 30, fontSize: 13 }}>
                Belum ada chapter
              </div>
            ) : (
              selectedManga.chapters.map(ch => (
                <button key={ch.id} style={S.chapterBtn}
                  onClick={() => setSelectedChapter(ch)}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#c8f500' }}>Ch.{ch.chapterNumber}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', flex: 1, marginLeft: 10 }}>{ch.title}</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                    {new Date(ch.uploadedAt).toLocaleDateString('id-ID')}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════
  // VIEW: STORAGE MONITOR
  // ════════════════════════════════════════════════════
  if (view === 'storage') {
    return (
      <div style={S.wrap}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => setView('home')}>‹ Kembali</button>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>📊 Storage Monitor</div>
          <button style={{ ...S.backBtn, color: '#c8f500' }} onClick={fetchStorageStats}>↻</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 14 }}>
          {loadingStats ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: 40 }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>⏳</div>Menghitung storage...
            </div>
          ) : storageStats.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: 40 }}>
              Belum ada data. Tekan ↻ untuk refresh.
            </div>
          ) : (
            storageStats.map(s => {
              const pct = usagePercent(s.usedBytes, s.limitBytes)
              const color = storageColor(pct)
              return (
                <div key={s.name} style={S.storageCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>🔥 {s.label}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                        Limit: {s.limitGB} GB
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color }}>
                        {formatBytes(s.usedBytes)}
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                        dari {formatBytes(s.limitBytes)}
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 6, background: color,
                      width: pct + '%', transition: 'width .5s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                      Sisa: {formatBytes(s.limitBytes - s.usedBytes)}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color }}>
                      {pct.toFixed(1)}%
                      {pct >= 90 && ' ⚠️ HAMPIR PENUH'}
                      {pct >= 70 && pct < 90 && ' 🟡 Sedang'}
                      {pct < 70 && ' ✅ Aman'}
                    </span>
                  </div>
                </div>
              )
            })
          )}

          {/* Summary */}
          {storageStats.length > 0 && (
            <div style={{ ...S.storageCard, marginTop: 16, background: 'rgba(200,245,0,0.05)', borderColor: 'rgba(200,245,0,0.2)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#c8f500', marginBottom: 8 }}>📦 Total Semua Firebase</div>
              <div style={{ fontSize: 13, color: '#fff' }}>
                {formatBytes(storageStats.reduce((a, s) => a + s.usedBytes, 0))} /
                {' '}{formatBytes(storageStats.reduce((a, s) => a + s.limitBytes, 0))}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                Sisa total: {formatBytes(storageStats.reduce((a, s) => a + (s.limitBytes - s.usedBytes), 0))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════
  // VIEW: UPLOAD PANEL (Admin only)
  // ════════════════════════════════════════════════════
  if (view === 'upload') {
    return (
      <div style={S.wrap}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => { setView('home'); resetUpload() }}>‹ Kembali</button>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>📤 Upload Manga</div>
          <div style={{ width: 60 }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 14 }}>

          {/* Pilih Firebase */}
          <div style={S.formGroup}>
            <label style={S.label}>🔥 Pilih Firebase Storage</label>
            <select style={S.select} value={uploadFb} onChange={e => setUploadFb(e.target.value)}>
              {FB_INSTANCES.map(fb => (
                <option key={fb.name} value={fb.name}>
                  {fb.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
              💡 Cek storage monitor untuk lihat mana yang masih banyak ruang
            </div>
          </div>

          {/* Manga baru atau lanjutkan */}
          {uploadingMangaId ? (
            <div style={{ background: 'rgba(200,245,0,0.08)', borderRadius: 8, padding: 10, marginBottom: 14, border: '1px solid rgba(200,245,0,0.2)' }}>
              <div style={{ fontSize: 12, color: '#c8f500', fontWeight: 700 }}>✅ Manga dibuat: {uploadTitle}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                Sekarang upload chapter berikutnya atau{' '}
                <span style={{ color: '#ff6b6b', cursor: 'pointer' }} onClick={resetUpload}>buat manga baru</span>
              </div>
            </div>
          ) : null}

          {/* META */}
          {!uploadingMangaId && (
            <>
              <div style={S.sectionTitle}>📝 Info Manga</div>
              <div style={S.formGroup}>
                <label style={S.label}>Judul *</label>
                <input style={S.input} placeholder="Judul manga..." value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)} />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Author</label>
                <input style={S.input} placeholder="Nama pengarang..." value={uploadAuthor}
                  onChange={e => setUploadAuthor(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ ...S.formGroup, flex: 1 }}>
                  <label style={S.label}>Genre</label>
                  <input style={S.input} placeholder="Action, Romance..." value={uploadGenre}
                    onChange={e => setUploadGenre(e.target.value)} />
                </div>
                <div style={{ ...S.formGroup, flex: 1 }}>
                  <label style={S.label}>Status</label>
                  <select style={S.select} value={uploadStatus}
                    onChange={e => setUploadStatus(e.target.value as any)}>
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                    <option value="hiatus">Hiatus</option>
                  </select>
                </div>
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Deskripsi</label>
                <textarea style={{ ...S.input, height: 70, resize: 'none' }}
                  placeholder="Sinopsis manga..." value={uploadDesc}
                  onChange={e => setUploadDesc(e.target.value)} />
              </div>

              {/* Cover */}
              <div style={S.sectionTitle}>🖼️ Cover</div>
              <div style={S.formGroup}>
                <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) { setUploadCoverFile(f); setUploadCoverPreview(URL.createObjectURL(f)) }
                  }} />
                <button style={S.uploadBtn} onClick={() => coverInputRef.current?.click()}>
                  {uploadCoverFile ? `✅ ${uploadCoverFile.name}` : '📁 Pilih gambar cover'}
                </button>
                {uploadCoverPreview && (
                  <img src={uploadCoverPreview} alt="preview"
                    style={{ width: 100, height: 145, objectFit: 'cover', borderRadius: 6, marginTop: 8 }} />
                )}
              </div>
            </>
          )}

          {/* CHAPTER */}
          <div style={S.sectionTitle}>📦 Upload Chapter (ZIP)</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ ...S.formGroup, flex: 1 }}>
              <label style={S.label}>No. Chapter</label>
              <input style={S.input} type="number" min={1} value={uploadChapterNum}
                onChange={e => setUploadChapterNum(Number(e.target.value))} />
            </div>
            <div style={{ ...S.formGroup, flex: 2 }}>
              <label style={S.label}>Judul Chapter</label>
              <input style={S.input} placeholder={`Chapter ${uploadChapterNum}`}
                value={uploadChapterTitle} onChange={e => setUploadChapterTitle(e.target.value)} />
            </div>
          </div>
          <div style={S.formGroup}>
            <input ref={zipInputRef} type="file" accept=".zip" style={{ display: 'none' }}
              onChange={e => setUploadZipFile(e.target.files?.[0] || null)} />
            <button style={S.uploadBtn} onClick={() => zipInputRef.current?.click()}>
              {uploadZipFile ? `✅ ${uploadZipFile.name}` : '📁 Pilih file ZIP chapter'}
            </button>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
              ZIP berisi gambar JPG/PNG per halaman, urut namanya (001.jpg, 002.jpg, dst)
            </div>
          </div>

          {/* Progress */}
          {uploading && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ height: '100%', background: '#c8f500', borderRadius: 6,
                  width: uploadProgress + '%', transition: 'width .3s' }} />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>{uploadStatus2}</div>
            </div>
          )}

          {!uploading && uploadStatus2 && (
            <div style={{ fontSize: 12, color: uploadStatus2.startsWith('✅') ? '#c8f500' : '#ff6b6b',
              textAlign: 'center', marginBottom: 12, padding: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: 6 }}>
              {uploadStatus2}
            </div>
          )}

          {/* Submit */}
          <button style={{ ...S.submitBtn, opacity: uploading ? 0.5 : 1 }}
            onClick={handleUpload} disabled={uploading}>
            {uploading ? '⏳ Mengupload...' : uploadingMangaId ? '📤 Upload Chapter Ini' : '🚀 Upload Manga + Chapter'}
          </button>

          <div style={{ height: 60 }} />
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════
  // VIEW: HOME — Grid manga
  // ════════════════════════════════════════════════════
  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>💎</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>manga-cross</span>
          <span style={{ fontSize: 10, background: 'linear-gradient(90deg,#c8f500,#4fc3f7)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            fontWeight: 800, letterSpacing: 1 }}>PREMIUM</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && (
            <>
              <button style={S.iconBtn} onClick={() => setView('storage')} title="Storage Monitor">📊</button>
              <button style={S.iconBtn} onClick={() => setView('upload')} title="Upload Manga">📤</button>
            </>
          )}
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 12px 0', display: 'flex', gap: 8 }}>
        <input style={S.searchInput} placeholder="Cari manga... (tekan Enter)"
          value={search} onChange={e => setSearch(e.target.value)} />
        <button style={S.searchBtn}>🔍</button>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {(['popular', 'new', 'saved'] as const).map(t => (
          <button key={t} style={{ ...S.tab, ...(activeTab === t ? S.tabActive : {}) }}
            onClick={() => setActiveTab(t)}>
            {t === 'popular' ? '🔥 Populer' : t === 'new' ? '🆕 Terbaru' : '🔖 Saved'}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '10px 10px 60px' }}>
        {filteredMangas.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>💎</div>
            {search ? 'Manga tidak ditemukan' : isAdmin ? 'Belum ada manga. Tekan 📤 untuk upload!' : 'Belum ada manga premium'}
          </div>
        ) : (
          <div style={S.grid}>
            {filteredMangas.map(m => (
              <button key={m.id} style={S.card}
                onClick={() => { setSelectedManga(m); setView('read') }}>
                <div style={{ position: 'relative' }}>
                  <img src={m.coverUrl || 'https://via.placeholder.com/150x220/111/333?text=No+Cover'}
                    alt={m.title} style={S.cardImg} />
                  <div style={{ ...S.statusBadge, background: statusColor[m.status] + '22',
                    color: statusColor[m.status], borderColor: statusColor[m.status] + '44' }}>
                    {m.status.toUpperCase()}
                  </div>
                  <div style={S.premiumBadge}>💎</div>
                </div>
                <div style={S.cardTitle}>{m.title}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════
const S: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#0a0a0f', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#0a0a0f',
    borderBottom: '1px solid rgba(200,245,0,0.08)', flexShrink: 0,
  },
  readerHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#0a0a0f',
    borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
  },
  backBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
    fontSize: 14, cursor: 'pointer', padding: '4px 8px',
  },
  iconBtn: {
    background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 6,
    color: '#fff', fontSize: 14, cursor: 'pointer', padding: '5px 8px',
  },
  searchInput: {
    flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none',
  },
  searchBtn: {
    background: '#c8f500', border: 'none', borderRadius: 8, padding: '8px 12px',
    fontSize: 14, cursor: 'pointer',
  },
  tabs: {
    display: 'flex', gap: 4, padding: '8px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0,
  },
  tab: {
    flex: 1, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 4px',
    borderRadius: 6, transition: 'all .15s',
  },
  tabActive: {
    background: 'rgba(200,245,0,0.1)', color: '#c8f500',
  },
  grid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
  },
  card: {
    background: 'none', border: 'none', cursor: 'pointer',
    textAlign: 'left', padding: 0,
  },
  cardImg: {
    width: '100%', aspectRatio: '2/3', objectFit: 'cover',
    borderRadius: 8, display: 'block',
  },
  cardTitle: {
    fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)',
    marginTop: 6, lineHeight: 1.3,
    overflow: 'hidden', textOverflow: 'ellipsis',
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  } as any,
  statusBadge: {
    position: 'absolute', bottom: 6, left: 6,
    fontSize: 9, fontWeight: 800, padding: '2px 6px',
    borderRadius: 4, border: '1px solid', letterSpacing: 0.5,
  },
  premiumBadge: {
    position: 'absolute', top: 6, right: 6,
    fontSize: 14, filter: 'drop-shadow(0 0 4px gold)',
  },
  chapterBtn: {
    display: 'flex', alignItems: 'center', width: '100%',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8, padding: '10px 12px', cursor: 'pointer', marginBottom: 6,
    textAlign: 'left',
  },
  storageCard: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10, padding: 14, marginBottom: 12,
  },
  // Upload form styles
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1, marginBottom: 10, marginTop: 4,
  },
  formGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 5,
  },
  input: {
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%', background: '#1a1a24',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
  },
  uploadBtn: {
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 8,
    color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer',
    padding: '10px', textAlign: 'center',
  },
  submitBtn: {
    width: '100%', background: 'linear-gradient(90deg, #c8f500, #4fc3f7)',
    border: 'none', borderRadius: 10, color: '#000',
    fontSize: 14, fontWeight: 800, cursor: 'pointer', padding: '13px',
    marginTop: 8,
  },
}
