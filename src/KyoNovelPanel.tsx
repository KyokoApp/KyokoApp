import React, { useEffect, useState, useRef, useCallback } from 'react'
import { initializeApp, getApps, FirebaseApp } from 'firebase/app'
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL,
  deleteObject, FirebaseStorage,
} from 'firebase/storage'
import {
  getFirestore, collection, addDoc, getDocs, doc, deleteDoc,
  onSnapshot, orderBy, query, updateDoc, Firestore,
  getDoc, where, setDoc, arrayUnion,
} from 'firebase/firestore'

// ═══════════════════════════════════════════════════════
// FIREBASE CONFIGS
// ═══════════════════════════════════════════════════════
const FIREBASE_CONFIGS: { name: string; label: string; limitGB: number; config: object }[] = [
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

function getFirebaseInstance(name: string, config: object): FirebaseApp {
  const existing = getApps().find(a => a.name === name)
  return existing ?? initializeApp(config, name)
}

interface FbInstance {
  name: string; label: string; limitGB: number
  app: FirebaseApp; storage: FirebaseStorage; db: Firestore
}

const FB_INSTANCES: FbInstance[] = FIREBASE_CONFIGS.map(fc => {
  const app = getFirebaseInstance(fc.name, fc.config)
  return { name: fc.name, label: fc.label, limitGB: fc.limitGB, app, storage: getStorage(app), db: getFirestore(app) }
})

const dbChat = FB_INSTANCES.find(f => f.name === 'chat')!.db
const PROXY = 'https://api.allorigins.win/raw?url='

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════
interface NovelDoc {
  id: string
  title: string
  author: string
  genre: string
  status: 'ongoing' | 'completed' | 'hiatus'
  coverUrl: string
  firebaseName: string
  description: string
  createdAt: number
  totalBytes: number
  tags: string
}

interface ChapterDoc {
  id: string
  novelId: string
  chapterNumber: number
  title: string
  textUrl: string
  firebaseName: string
  uploadedAt: number
  coinPrice: number
  wordCount: number
}

interface CoinRequest {
  id: string; uid: string; username: string; photoURL: string
  amount: number; totalPrice: number; status: 'pending' | 'approved' | 'rejected'; createdAt: number
}

interface PublicNovel {
  id: string
  title: string
  author: string
  coverUrl: string
  genre: string
  rating: number
  pages: number
  status: string
  slug: string
}

interface PublicChapter {
  id: string
  title: string
  date: string
  order: number
}

interface Props { isAdmin: boolean; userId: string }

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function stripHtml(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<\/p>/gi, '\n\n')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/div>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

const ALLOWED_TAGS = /^(p|br|b|strong|i|em|u|s|del|h1|h2|h3|h4|blockquote|hr|span|div|a|ul|ol|li|sup|sub|pre|code|center)$/i
const ALLOWED_ATTRS = /^(style|class|href|target|rel)$/i

function sanitizeHtml(raw: string): string {
  let html = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<input[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
  html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
  html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '')
  html = html.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (match: string, tag: string, attrs: string) => {
    if (ALLOWED_TAGS.test(tag)) {
      const cleanAttrs = attrs.replace(/\s+([a-z-]+)\s*=\s*["']([^"']*)["']/gi, (_m: string, attr: string, val: string) => {
        if (!ALLOWED_ATTRS.test(attr)) return ''
        if (/javascript:/i.test(val)) return ''
        return ` ${attr}="${val}"`
      })
      return `<${match.startsWith('</') ? '/' : ''}${tag}${cleanAttrs}>`
    }
    return ''
  })
  return html.trim()
}

// ── BARU: sanitize HTML tapi pertahankan <style> internal ──
// Khusus untuk file HTML novel yang punya CSS sendiri (drop cap, scene break, dll)
function sanitizeHtmlFull(raw: string): string {
  // Buang script, iframe, form, event handlers — tapi PERTAHANKAN <style>
  let html = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<input[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
  html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
  html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '')
  // Ambil hanya konten <body> kalau ada, supaya tidak dobel DOCTYPE
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const styleMatch = raw.match(/(<style[\s\S]*?<\/style>)/gi) || []
  const bodyContent = bodyMatch ? bodyMatch[1] : html
  return styleMatch.join('\n') + '\n' + bodyContent
}

function isHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content.trim())
}

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════
export default function KyoNovelPanel({ isAdmin, userId }: Props) {
  const [mainTab, setMainTab] = useState<'kyonovel' | 'public'>('kyonovel')
  const [view, setView] = useState<'home' | 'detail' | 'read' | 'upload' | 'topup' | 'inbox' | 'storage'>('home')

  const [novels, setNovels] = useState<NovelDoc[]>([])
  const [selectedNovel, setSelectedNovel] = useState<NovelDoc | null>(null)
  const [chapters, setChapters] = useState<ChapterDoc[]>([])
  const [selectedChapter, setSelectedChapter] = useState<ChapterDoc | null>(null)
  const [chapterText, setChapterText] = useState('')
  const [loadingText, setLoadingText] = useState(false)
  const [search, setSearch] = useState('')
  const [activeHomeTab, setActiveHomeTab] = useState<'semua' | 'ongoing' | 'completed'>('semua')

  const [pubSearch, setPubSearch] = useState('')
  const [pubNovels, setPubNovels] = useState<PublicNovel[]>([])
  const [pubLoading, setPubLoading] = useState(false)
  const [pubNovel, setPubNovel] = useState<PublicNovel | null>(null)
  const [pubChapters, setPubChapters] = useState<PublicChapter[]>([])
  const [pubChapLoading, setPubChapLoading] = useState(false)
  const [pubChapText, setPubChapText] = useState('')
  const [pubChapReadLoading, setPubChapReadLoading] = useState(false)
  const [pubView, setPubView] = useState<'list' | 'detail' | 'read'>('list')
  const [pubSelectedChap, setPubSelectedChap] = useState<PublicChapter | null>(null)

  const [username, setUsername] = useState('User')
  const [photoURL, setPhotoURL] = useState('')
  const [userCoins, setUserCoins] = useState(0)
  const [unlockedNovels, setUnlockedNovels] = useState<string[]>([])
  const [coinRequests, setCoinRequests] = useState<CoinRequest[]>([])
  const [topupAmount, setTopupAmount] = useState(10)
  const [topupLoading, setTopupLoading] = useState(false)
  const [unlockLoading, setUnlockLoading] = useState(false)
  const [pendingChapter, setPendingChapter] = useState<ChapterDoc | null>(null)
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false)

  const [uploadFb, setUploadFb] = useState(FB_INSTANCES[0].name)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadAuthor, setUploadAuthor] = useState('')
  const [uploadGenre, setUploadGenre] = useState('')
  const [uploadTags, setUploadTags] = useState('')
  const [uploadStatus, setUploadStatus] = useState<'ongoing' | 'completed' | 'hiatus'>('ongoing')
  const [uploadDesc, setUploadDesc] = useState('')
  const [uploadCoinPrice, setUploadCoinPrice] = useState(1)
  const [uploadCoverUrl, setUploadCoverUrl] = useState('')
  const [uploadTxtFile, setUploadTxtFile] = useState<File | null>(null)
  const [uploadChapterNum, setUploadChapterNum] = useState(1)
  const [uploadChapterTitle, setUploadChapterTitle] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadStatusMsg, setUploadStatusMsg] = useState('')
  const [uploadingNovelId, setUploadingNovelId] = useState('')

  const txtInputRef = useRef<HTMLInputElement>(null)
  const [fontSize, setFontSize] = useState(15)

  // ═══════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════
  useEffect(() => {
    if (!userId) return
    const unsub = onSnapshot(doc(dbChat, 'chatUsers', userId), snap => {
      if (snap.exists()) {
        const data = snap.data()
        setUserCoins(data.mangaCoins || 0)
        setUnlockedNovels(data.unlockedNovels || [])
        setUsername(data.username || 'User')
        setPhotoURL(data.photoURL || '')
      }
    })
    return () => unsub()
  }, [userId])

  useEffect(() => {
    if (!isAdmin) return
    const q = query(collection(dbChat, 'mangaCoinRequests'), where('status', '==', 'pending'))
    const unsub = onSnapshot(q, snap => {
      setCoinRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as CoinRequest)))
    })
    return () => unsub()
  }, [isAdmin])

  useEffect(() => {
    const unsubs: (() => void)[] = []
    const novelsByFb: Record<string, Record<string, NovelDoc>> = {}

    FB_INSTANCES.forEach(fb => {
      const q = query(collection(fb.db, 'kyoNovels'), orderBy('createdAt', 'desc'))
      const unsub = onSnapshot(q, snap => {
        novelsByFb[fb.name] = {}
        snap.docs.forEach(d => {
          novelsByFb[fb.name][d.id] = {
            id: d.id, firebaseName: fb.name,
            ...d.data(),
          } as NovelDoc
        })
        const all: NovelDoc[] = []
        Object.values(novelsByFb).forEach(fbMap => all.push(...Object.values(fbMap)))
        all.sort((a, b) => b.createdAt - a.createdAt)
        setNovels(all)
      })
      unsubs.push(unsub)
    })
    return () => unsubs.forEach(u => u())
  }, [])

  useEffect(() => {
    if (!selectedNovel) { setChapters([]); return }
    const fb = FB_INSTANCES.find(f => f.name === selectedNovel.firebaseName)!
    const q = query(
      collection(fb.db, 'kyoNovels', selectedNovel.id, 'chapters'),
      orderBy('chapterNumber', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      setChapters(snap.docs.map(d => ({
        id: d.id, novelId: selectedNovel.id, firebaseName: selectedNovel.firebaseName,
        ...d.data(),
      } as ChapterDoc)))
    })
    return () => unsub()
  }, [selectedNovel])

  // ═══════════════════════════════════════════════════
  // HANDLERS — COIN SYSTEM
  // ═══════════════════════════════════════════════════
  const handleTopupRequest = async () => {
    if (!userId || topupAmount < 1) return
    setTopupLoading(true)
    try {
      const existing = await getDocs(query(
        collection(dbChat, 'mangaCoinRequests'),
        where('uid', '==', userId), where('status', '==', 'pending')
      ))
      if (!existing.empty) {
        alert('Kamu sudah punya request top-up yang pending. Tunggu admin approve dulu ya!')
        setTopupLoading(false)
        return
      }
      await addDoc(collection(dbChat, 'mangaCoinRequests'), {
        uid: userId, username, photoURL,
        amount: topupAmount,
        totalPrice: topupAmount * 1000,
        status: 'pending',
        createdAt: Date.now(),
      })
      alert(`✅ Request top-up ${topupAmount} coin (Rp ${(topupAmount * 1000).toLocaleString('id-ID')}) berhasil dikirim!\n\nTunggu konfirmasi admin ya.`)
      setView('home')
    } catch (e: any) {
      alert('Gagal kirim request: ' + e.message)
    }
    setTopupLoading(false)
  }

  const handleApproveTopup = async (req: CoinRequest) => {
    const userRef = doc(dbChat, 'chatUsers', req.uid)
    const snap = await getDoc(userRef)
    const current = snap.exists() ? (snap.data().mangaCoins || 0) : 0
    await updateDoc(userRef, { mangaCoins: current + req.amount })
    await updateDoc(doc(dbChat, 'mangaCoinRequests', req.id), { status: 'approved', approvedAt: Date.now() })
  }

  const handleRejectTopup = async (req: CoinRequest) => {
    await updateDoc(doc(dbChat, 'mangaCoinRequests', req.id), { status: 'rejected', rejectedAt: Date.now() })
  }

  const handleUnlockChapter = async (chapter: ChapterDoc) => {
    if (!userId) return
    if (userCoins < chapter.coinPrice) {
      alert(`Coin kamu tidak cukup!\n\nChapter ini butuh ${chapter.coinPrice} coin, kamu punya ${userCoins} coin.\n\nTop-up dulu ya!`)
      return
    }
    setUnlockLoading(true)
    try {
      const userRef = doc(dbChat, 'chatUsers', userId)
      await updateDoc(userRef, {
        mangaCoins: userCoins - chapter.coinPrice,
        unlockedNovels: arrayUnion(chapter.id),
      })
      setShowUnlockConfirm(false)
      setPendingChapter(null)
      openKyoChapter(chapter)
    } catch (e: any) {
      alert('Gagal unlock chapter: ' + e.message)
    }
    setUnlockLoading(false)
  }

  const handleChapterClick = (ch: ChapterDoc) => {
    if (isAdmin || ch.coinPrice === 0 || unlockedNovels.includes(ch.id)) {
      openKyoChapter(ch)
      return
    }
    setPendingChapter(ch)
    setShowUnlockConfirm(true)
  }

  const openKyoChapter = async (ch: ChapterDoc) => {
    setSelectedChapter(ch)
    setChapterText('')
    setLoadingText(true)
    setView('read')
    try {
      const res = await fetch(ch.textUrl)
      const raw = await res.text()
      if (isHtmlContent(raw)) {
        // ── HTML novel: gunakan sanitizer yang pertahankan <style> ──
        setChapterText(sanitizeHtmlFull(raw))
      } else {
        setChapterText(raw)
      }
    } catch (e: any) {
      setChapterText('❌ Gagal load konten chapter: ' + (e as any).message)
    }
    setLoadingText(false)
  }

  // ═══════════════════════════════════════════════════
  // HANDLERS — UPLOAD
  // ═══════════════════════════════════════════════════
  const handleUpload = async () => {
    if (!uploadTitle.trim() || !uploadCoverUrl.trim() || !uploadTxtFile) {
      alert('Lengkapi judul, URL cover, dan file chapter!')
      return
    }
    setUploading(true)
    setUploadProgress(0)
    setUploadStatusMsg('Membuat data novel...')
    try {
      const fb = FB_INSTANCES.find(f => f.name === uploadFb)!

      let novelId = uploadingNovelId
      if (!novelId) {
        setUploadProgress(10)
        const docRef = await addDoc(collection(fb.db, 'kyoNovels'), {
          title: uploadTitle.trim(),
          author: uploadAuthor.trim() || 'Unknown',
          genre: uploadGenre.trim() || 'General',
          tags: uploadTags.trim(),
          status: uploadStatus,
          description: uploadDesc.trim(),
          coverUrl: uploadCoverUrl.trim(),
          createdAt: Date.now(),
          firebaseName: fb.name,
          totalBytes: 0,
        })
        novelId = docRef.id
        setUploadingNovelId(novelId)
      }
      setUploadProgress(20)

      setUploadStatusMsg('Membuat data chapter...')
      const chapRef = await addDoc(collection(fb.db, 'kyoNovels', novelId, 'chapters'), {
        chapterNumber: uploadChapterNum,
        title: uploadChapterTitle.trim() || `Chapter ${uploadChapterNum}`,
        textUrl: '',
        coinPrice: uploadCoinPrice,
        wordCount: 0,
        uploadedAt: Date.now(),
        firebaseName: fb.name,
      })
      setUploadProgress(35)

      setUploadStatusMsg('Upload file chapter...')
      const fileBytes = uploadTxtFile.size
      const fileExt = uploadTxtFile.name.endsWith('.html') ? 'html' : 'txt'
      const storagePath = `kyoNovels/${novelId}/chapters/${chapRef.id}.${fileExt}`
      const fileRef = storageRef(fb.storage, storagePath)
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(fileRef, uploadTxtFile)
        task.on('state_changed',
          snap => {
            const pct = (snap.bytesTransferred / snap.totalBytes) * 60
            setUploadProgress(35 + pct)
          },
          reject,
          () => resolve()
        )
      })
      const textUrl = await getDownloadURL(fileRef)
      setUploadProgress(95)

      const rawText = await uploadTxtFile.text()
      const plainText = isHtmlContent(rawText) ? stripHtml(rawText) : rawText
      const wordCount = plainText.trim().split(/\s+/).length

      setUploadStatusMsg('Menyimpan data...')
      await updateDoc(doc(fb.db, 'kyoNovels', novelId, 'chapters', chapRef.id), { textUrl, wordCount })

      const nvSnap = await getDoc(doc(fb.db, 'kyoNovels', novelId))
      const prevBytes = nvSnap.exists() ? (nvSnap.data().totalBytes || 0) : 0
      await updateDoc(doc(fb.db, 'kyoNovels', novelId), { totalBytes: prevBytes + fileBytes })

      setUploadProgress(100)
      setUploadStatusMsg('✅ Upload berhasil!')
      setTimeout(() => {
        setUploadTxtFile(null)
        setUploadChapterNum(prev => prev + 1)
        setUploadChapterTitle('')
        setUploadProgress(0)
        setUploadStatusMsg('')
        setUploading(false)
      }, 1500)
    } catch (e: any) {
      setUploadStatusMsg('❌ Error: ' + e.message)
      setUploading(false)
    }
  }

  const resetUploadForm = () => {
    setUploadTitle(''); setUploadAuthor(''); setUploadGenre(''); setUploadTags('')
    setUploadDesc(''); setUploadCoverUrl(''); setUploadTxtFile(null)
    setUploadChapterNum(1); setUploadChapterTitle(''); setUploadingNovelId('')
    setUploadProgress(0); setUploadStatusMsg(''); setUploadCoinPrice(1)
  }

  // ═══════════════════════════════════════════════════
  // HANDLERS — PUBLIC TAB (Royal Road)
  // ═══════════════════════════════════════════════════
  const searchPublicNovels = useCallback(async (keyword: string) => {
    setPubLoading(true)
    setPubNovels([])
    try {
      const url = keyword.trim()
        ? `https://www.royalroad.com/fictions/search?title=${encodeURIComponent(keyword)}&type=0&genres=&tags=&minPages=0&maxPages=0&minRating=0&maxRating=5&status=ALL&orderBy=relevance&count=20`
        : `https://www.royalroad.com/fictions/best-rated?type=0&genres=&tags=&minPages=0&maxPages=0&minRating=0&maxRating=5&status=ALL&count=20`

      const res = await fetch(PROXY + encodeURIComponent(url))
      const html = await res.text()
      const parser = new DOMParser()
      const dom = parser.parseFromString(html, 'text/html')

      const cards = dom.querySelectorAll('.fiction-list-item, .row.fiction-list-item')
      const results: PublicNovel[] = []

      cards.forEach(card => {
        const linkEl = card.querySelector('h2.fiction-title a, .fiction-title a') as HTMLAnchorElement
        if (!linkEl) return
        const href = linkEl.getAttribute('href') || ''
        const match = href.match(/\/fiction\/(\d+)/)
        if (!match) return
        const id = match[1]
        const slug = href
        const title = linkEl.textContent?.trim() || 'Unknown'
        const coverEl = card.querySelector('img.thumbnail, img') as HTMLImageElement
        const coverUrl = coverEl?.src || coverEl?.getAttribute('data-src') || ''
        const authorEl = card.querySelector('.author-name, .col-sm-3 .author span')
        const author = authorEl?.textContent?.trim() || 'Unknown'
        const ratingEl = card.querySelector('.star-offset, .rating-star .number')
        const rating = parseFloat(ratingEl?.textContent?.trim() || '0')
        const statusEl = card.querySelector('.label-complete, .label-ongoing, .label-hiatus, .label-stub')
        const status = statusEl?.textContent?.trim() || 'ongoing'
        const genreEl = card.querySelector('.tags .label:first-child, .fiction-tags .label')
        const genre = genreEl?.textContent?.trim() || 'Fantasy'
        const pagesEl = card.querySelector('.fiction-stats .col-sm-2:last-child, .pages-count')
        const pages = parseInt(pagesEl?.textContent?.replace(/\D/g, '') || '0')
        results.push({ id, title, author, coverUrl, genre, rating, pages, status, slug })
      })

      setPubNovels(results)
    } catch (e) {
      console.error('Gagal fetch Royal Road:', e)
      setPubNovels([])
    }
    setPubLoading(false)
  }, [])

  useEffect(() => {
    if (mainTab === 'public' && pubNovels.length === 0) {
      searchPublicNovels('')
    }
  }, [mainTab])

  const openPublicNovel = async (novel: PublicNovel) => {
    setPubNovel(novel)
    setPubView('detail')
    setPubChapters([])
    setPubChapLoading(true)
    try {
      const url = `https://www.royalroad.com${novel.slug}`
      const res = await fetch(PROXY + encodeURIComponent(url))
      const html = await res.text()
      const parser = new DOMParser()
      const dom = parser.parseFromString(html, 'text/html')
      const rows = dom.querySelectorAll('#chapters tbody tr, .chapter-row')
      const chaps: PublicChapter[] = []
      rows.forEach((row, i) => {
        const linkEl = row.querySelector('a') as HTMLAnchorElement
        if (!linkEl) return
        const href = linkEl.getAttribute('href') || ''
        const title = linkEl.textContent?.trim() || `Chapter ${i + 1}`
        const dateEl = row.querySelector('time, .text-muted')
        const date = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || ''
        const idMatch = href.match(/\/(\d+)\/chapter\/(\d+)/)
        const chapId = idMatch ? `${idMatch[1]}_${idMatch[2]}` : `chap_${i}`
        chaps.push({ id: chapId, title, date, order: i + 1 })
      })
      setPubChapters(chaps)
    } catch (e) {
      console.error('Gagal load chapter list:', e)
    }
    setPubChapLoading(false)
  }

  const openPublicChapter = async (chap: PublicChapter, novelSlug: string) => {
    setPubSelectedChap(chap)
    setPubChapText('')
    setPubChapReadLoading(true)
    setPubView('read')
    try {
      const parts = chap.id.split('_')
      if (parts.length < 2) throw new Error('Invalid chapter id')
      const chapUrl = `/fiction/${parts[0]}/chapter/${parts[1]}`
      const res = await fetch(PROXY + encodeURIComponent(`https://www.royalroad.com${chapUrl}`))
      const html = await res.text()
      const parser = new DOMParser()
      const dom = parser.parseFromString(html, 'text/html')
      const content = dom.querySelector('.chapter-content')
      if (content) {
        setChapterText(stripHtml(content.innerHTML))
        setPubChapText(stripHtml(content.innerHTML))
      } else {
        setPubChapText('❌ Gagal mengambil konten chapter ini.')
      }
    } catch (e: any) {
      setPubChapText('❌ Error: ' + e.message)
    }
    setPubChapReadLoading(false)
  }

  // ═══════════════════════════════════════════════════
  // VIEW: TOPUP
  // ═══════════════════════════════════════════════════
  if (view === 'topup') {
    const presets = [5, 10, 20, 50, 100]
    return (
      <div style={S.wrap}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => setView('home')}>‹ Kembali</button>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>🪙 Top-up Coin</div>
          <div style={{ width: 60 }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 16 }}>
          <div style={{ background: 'rgba(200,245,0,0.07)', border: '1px solid rgba(200,245,0,0.2)', borderRadius: 14, padding: 16, marginBottom: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>SALDO KAMU</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#c8f500' }}>🪙 {userCoins}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>coin</div>
          </div>
          <div style={S.sectionTitle}>PILIH JUMLAH TOP-UP</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            {presets.map(p => (
              <button key={p} style={{
                background: topupAmount === p ? 'rgba(200,245,0,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${topupAmount === p ? 'rgba(200,245,0,0.5)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 10, padding: '10px 4px', cursor: 'pointer', textAlign: 'center',
              }} onClick={() => setTopupAmount(p)}>
                <div style={{ fontSize: 16, fontWeight: 900, color: topupAmount === p ? '#c8f500' : '#fff' }}>🪙 {p}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Rp {(p * 1000).toLocaleString('id-ID')}</div>
              </button>
            ))}
            <button style={{
              background: !presets.includes(topupAmount) ? 'rgba(200,245,0,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${!presets.includes(topupAmount) ? 'rgba(200,245,0,0.5)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 10, padding: '10px 4px', cursor: 'pointer', textAlign: 'center', gridColumn: 'span 3',
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Custom jumlah</div>
              <input type="number" min={1} value={topupAmount}
                onChange={e => setTopupAmount(Math.max(1, Number(e.target.value)))}
                style={{ ...S.input, textAlign: 'center', fontWeight: 800, fontSize: 16, color: '#c8f500', background: 'transparent', border: 'none', outline: 'none', width: '100%' }}
                onClick={e => e.stopPropagation()} />
            </button>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Jumlah coin</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>🪙 {topupAmount}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Harga per coin</span>
              <span style={{ fontSize: 13, color: '#fff' }}>Rp 1.000</span>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Total</span>
              <span style={{ fontSize: 15, fontWeight: 900, color: '#c8f500' }}>Rp {(topupAmount * 1000).toLocaleString('id-ID')}</span>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 16, lineHeight: 1.6, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 10 }}>
            📌 Request top-up akan dikirim ke admin untuk dikonfirmasi.<br />
            Setelah admin approve, coin langsung masuk ke akunmu.<br />
            Coin ini juga berlaku untuk MangaCross & KyoNovel.
          </div>
          <button style={{ ...S.submitBtn, opacity: topupLoading ? 0.5 : 1 }} onClick={handleTopupRequest} disabled={topupLoading}>
            {topupLoading ? '⏳ Mengirim...' : `🪙 Request Top-up ${topupAmount} Coin`}
          </button>
          <div style={{ height: 40 }} />
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // VIEW: INBOX (Admin)
  // ═══════════════════════════════════════════════════
  if (view === 'inbox' && isAdmin) {
    return (
      <div style={S.wrap}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => setView('home')}>‹ Kembali</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#ff9d00' }}>📬 Inbox Top-up Coin</span>
            {coinRequests.length > 0 && (
              <span style={{ background: '#ff375f', color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>{coinRequests.length}</span>
            )}
          </div>
          <div style={{ width: 60 }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 14 }}>
          {coinRequests.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: 60 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
              Tidak ada permintaan top-up
            </div>
          ) : coinRequests.map(req => (
            <div key={req.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,157,0,0.2)', borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                {req.photoURL ? (
                  <img src={req.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👤</div>
                )}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{req.username}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{new Date(req.createdAt).toLocaleString('id-ID')}</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Coin</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#c8f500' }}>🪙 {req.amount}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Total</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Rp {req.totalPrice.toLocaleString('id-ID')}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ flex: 1, background: 'rgba(200,245,0,0.15)', border: '1px solid rgba(200,245,0,0.4)', borderRadius: 8, padding: '10px', color: '#c8f500', fontSize: 13, fontWeight: 800, cursor: 'pointer' }} onClick={() => handleApproveTopup(req)}>✅ Approve</button>
                <button style={{ flex: 1, background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.3)', borderRadius: 8, padding: '10px', color: '#ff4444', fontSize: 13, fontWeight: 800, cursor: 'pointer' }} onClick={() => handleRejectTopup(req)}>❌ Tolak</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // VIEW: UPLOAD (Admin)
  // ═══════════════════════════════════════════════════
  if (view === 'upload' && isAdmin) {
    return (
      <div style={S.wrap}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => { setView('home'); resetUploadForm() }}>‹ Kembali</button>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>📤 Upload Novel</div>
          <div style={{ width: 60 }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 14 }}>

          <div style={S.sectionTitle}>TARGET FIREBASE</div>
          <div style={{ ...S.formGroup }}>
            <label style={S.label}>Simpan ke Firebase</label>
            <select style={S.select} value={uploadFb} onChange={e => setUploadFb(e.target.value)}>
              {FB_INSTANCES.map(fb => <option key={fb.name} value={fb.name}>{fb.label}</option>)}
            </select>
          </div>

          {!uploadingNovelId ? (
            <>
              <div style={S.sectionTitle}>📚 DETAIL NOVEL (baru)</div>
              <div style={S.formGroup}>
                <label style={S.label}>Judul Novel *</label>
                <input style={S.input} placeholder="Contoh: Sword Art Online" value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ ...S.formGroup, flex: 1 }}>
                  <label style={S.label}>Penulis</label>
                  <input style={S.input} placeholder="Nama penulis" value={uploadAuthor} onChange={e => setUploadAuthor(e.target.value)} />
                </div>
                <div style={{ ...S.formGroup, flex: 1 }}>
                  <label style={S.label}>Genre</label>
                  <input style={S.input} placeholder="Fantasy, Romance..." value={uploadGenre} onChange={e => setUploadGenre(e.target.value)} />
                </div>
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Tags (opsional)</label>
                <input style={S.input} placeholder="isekai, harem, magic..." value={uploadTags} onChange={e => setUploadTags(e.target.value)} />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Status</label>
                <select style={S.select} value={uploadStatus} onChange={e => setUploadStatus(e.target.value as any)}>
                  <option value="ongoing">Ongoing</option>
                  <option value="completed">Completed</option>
                  <option value="hiatus">Hiatus</option>
                </select>
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Deskripsi</label>
                <textarea style={{ ...S.input, minHeight: 70, resize: 'vertical' } as any}
                  placeholder="Sinopsis novel..." value={uploadDesc} onChange={e => setUploadDesc(e.target.value)} />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>URL Cover *</label>
                <input style={S.input} placeholder="https://..." value={uploadCoverUrl} onChange={e => setUploadCoverUrl(e.target.value)} />
                {uploadCoverUrl && (
                  <img src={uploadCoverUrl} alt="Preview" onError={e => (e.currentTarget.style.display = 'none')}
                    style={{ marginTop: 8, width: 80, height: 110, objectFit: 'cover', borderRadius: 6 }} />
                )}
              </div>
            </>
          ) : (
            <div style={{ background: 'rgba(200,245,0,0.07)', border: '1px solid rgba(200,245,0,0.2)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>MELANJUTKAN NOVEL</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#c8f500' }}>{uploadTitle || '—'}</div>
              <button style={{ marginTop: 8, background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: 'rgba(255,255,255,0.5)', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}
                onClick={resetUploadForm}>🔄 Ganti novel baru</button>
            </div>
          )}

          <div style={S.sectionTitle}>📄 CHAPTER</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ ...S.formGroup, flex: 1 }}>
              <label style={S.label}>No. Chapter</label>
              <input style={S.input} type="number" min={1} value={uploadChapterNum} onChange={e => setUploadChapterNum(Number(e.target.value))} />
            </div>
            <div style={{ ...S.formGroup, flex: 2 }}>
              <label style={S.label}>Judul Chapter</label>
              <input style={S.input} placeholder={`Chapter ${uploadChapterNum}`} value={uploadChapterTitle} onChange={e => setUploadChapterTitle(e.target.value)} />
            </div>
          </div>
          <div style={S.formGroup}>
            <label style={S.label}>💰 Harga (coin) — 0 = gratis</label>
            <input style={S.input} type="number" min={0} value={uploadCoinPrice} onChange={e => setUploadCoinPrice(Number(e.target.value))} />
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>1 coin = Rp 1.000</div>
          </div>

          {/* ── File input: accept .txt dan .html ── */}
          <div style={S.formGroup}>
            <input
              ref={txtInputRef}
              type="file"
              accept=".txt,.html"
              style={{ display: 'none' }}
              onChange={e => setUploadTxtFile(e.target.files?.[0] || null)}
            />
            <button style={S.uploadBtn} onClick={() => txtInputRef.current?.click()}>
              {uploadTxtFile ? `✅ ${uploadTxtFile.name}` : '📁 Pilih file TXT atau HTML chapter'}
            </button>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
              Format: .txt atau .html — satu file = satu chapter.
            </div>
          </div>

          {uploading && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ height: '100%', background: '#c8f500', borderRadius: 6, width: uploadProgress + '%', transition: 'width .3s' }} />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>{uploadStatusMsg}</div>
            </div>
          )}
          {!uploading && uploadStatusMsg && (
            <div style={{ fontSize: 12, color: uploadStatusMsg.startsWith('✅') ? '#c8f500' : '#ff6b6b', textAlign: 'center', marginBottom: 12, padding: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: 6 }}>
              {uploadStatusMsg}
            </div>
          )}

          <button style={{ ...S.submitBtn, opacity: uploading ? 0.5 : 1 }} onClick={handleUpload} disabled={uploading}>
            {uploading ? '⏳ Mengupload...' : uploadingNovelId ? '📤 Upload Chapter Ini' : '🚀 Upload Novel + Chapter'}
          </button>
          <div style={{ height: 60 }} />
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // VIEW: READ — KyoNovel reader
  // ═══════════════════════════════════════════════════
  if (view === 'read' && selectedChapter) {
    const isHtml = isHtmlContent(chapterText)
    return (
      <div style={{ ...S.wrap, background: '#0e0e16' }}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => { setView('detail'); setSelectedChapter(null); setChapterText('') }}>‹ Kembali</button>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center', maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedChapter.title}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...S.iconBtn, fontSize: 13 }} onClick={() => setFontSize(f => Math.max(11, f - 1))}>A-</button>
            <button style={{ ...S.iconBtn, fontSize: 13 }} onClick={() => setFontSize(f => Math.min(22, f + 1))}>A+</button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loadingText ? (
            <div style={{ textAlign: 'center', paddingTop: 60, color: 'rgba(255,255,255,0.3)', fontSize: fontSize }}>⏳ Memuat chapter...</div>
          ) : isHtml ? (
            // ── HTML Novel: render langsung dengan styling asli ──
            <>
              <style>{`
                .kyo-html-reader * { font-size: inherit !important; }
                .kyo-html-reader p { margin-bottom: 1.2em; }
                .kyo-html-reader .book-wrap { max-width: 100% !important; box-shadow: none !important; margin: 0 !important; }
              `}</style>
              <div
                className="kyo-html-reader"
                style={{ fontSize: fontSize }}
                dangerouslySetInnerHTML={{ __html: chapterText }}
              />
            </>
          ) : (
            // ── Plain text: render per paragraf ──
            <div style={{ padding: '16px 18px', lineHeight: 1.85, color: 'rgba(255,255,255,0.88)', fontSize: fontSize }}>
              {chapterText.split('\n').map((para, i) =>
                para.trim() ? <p key={i} style={{ marginBottom: '1em', marginTop: 0 }}>{para}</p> : <br key={i} />
              )}
            </div>
          )}
          <div style={{ height: 60 }} />
        </div>

        {/* Chapter nav */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8 }}>
          {(() => {
            const idx = chapters.findIndex(c => c.id === selectedChapter.id)
            const prev = idx > 0 ? chapters[idx - 1] : null
            const next = idx < chapters.length - 1 ? chapters[idx + 1] : null
            return (
              <>
                <button disabled={!prev} onClick={() => prev && handleChapterClick(prev)}
                  style={{ flex: 1, ...S.submitBtn, background: prev ? 'rgba(200,245,0,0.15)' : 'rgba(255,255,255,0.05)', color: prev ? '#c8f500' : 'rgba(255,255,255,0.2)', border: `1px solid ${prev ? 'rgba(200,245,0,0.3)' : 'rgba(255,255,255,0.05)'}`, marginTop: 0 }}>
                  ‹ Prev
                </button>
                <button disabled={!next} onClick={() => next && handleChapterClick(next)}
                  style={{ flex: 1, ...S.submitBtn, background: next ? 'rgba(200,245,0,0.15)' : 'rgba(255,255,255,0.05)', color: next ? '#c8f500' : 'rgba(255,255,255,0.2)', border: `1px solid ${next ? 'rgba(200,245,0,0.3)' : 'rgba(255,255,255,0.05)'}`, marginTop: 0 }}>
                  Next ›
                </button>
              </>
            )
          })()}
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // VIEW: DETAIL — Novel info + chapter list
  // ═══════════════════════════════════════════════════
  if (view === 'detail' && selectedNovel) {
    const statusColor: Record<string, string> = { ongoing: '#c8f500', completed: '#4fc3f7', hiatus: '#ff9d00' }
    return (
      <div style={S.wrap}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => { setView('home'); setSelectedNovel(null); setChapters([]) }}>‹ Kembali</button>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>📖 Detail Novel</div>
          {isAdmin && (
            <button style={{ ...S.iconBtn, fontSize: 11 }} onClick={() => {
              setUploadTitle(selectedNovel.title); setUploadAuthor(selectedNovel.author)
              setUploadGenre(selectedNovel.genre); setUploadDesc(selectedNovel.description)
              setUploadCoverUrl(selectedNovel.coverUrl); setUploadStatus(selectedNovel.status)
              setUploadFb(selectedNovel.firebaseName); setUploadingNovelId(selectedNovel.id)
              setUploadChapterNum(chapters.length + 1); setView('upload')
            }}>+ Bab</button>
          )}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', gap: 14, padding: '14px 14px 10px' }}>
            <img src={selectedNovel.coverUrl} alt={selectedNovel.title} onError={e => (e.currentTarget.src = 'https://placehold.co/90x130/1a1a24/444?text=Novel')}
              style={{ width: 90, height: 130, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginBottom: 4, lineHeight: 1.3 }}>{selectedNovel.title}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>✍️ {selectedNovel.author}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>🏷️ {selectedNovel.genre}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 4, border: `1px solid ${statusColor[selectedNovel.status]}`, color: statusColor[selectedNovel.status], letterSpacing: 0.5 }}>
                  {selectedNovel.status.toUpperCase()}
                </span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', padding: '2px 7px', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                  {chapters.length} BAB
                </span>
                {selectedNovel.totalBytes > 0 && (
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', padding: '2px 7px', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                    {formatBytes(selectedNovel.totalBytes)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {selectedNovel.description && (
            <div style={{ padding: '0 14px 12px', fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
              {selectedNovel.description}
            </div>
          )}
          <div style={{ padding: '0 14px 4px' }}>
            <div style={S.sectionTitle}>DAFTAR BAB</div>
          </div>
          <div style={{ padding: '0 14px 80px' }}>
            {chapters.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: 30 }}>Belum ada bab tersedia</div>
            ) : chapters.map(ch => {
              const isUnlocked = isAdmin || ch.coinPrice === 0 || unlockedNovels.includes(ch.id)
              return (
                <button key={ch.id} style={{ ...S.chapterBtn }} onClick={() => handleChapterClick(ch)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 2 }}>
                      Bab {ch.chapterNumber}{ch.title && ch.title !== `Chapter ${ch.chapterNumber}` ? ` — ${ch.title}` : ''}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                      {ch.wordCount > 0 ? `${ch.wordCount.toLocaleString()} kata` : ''}
                    </div>
                  </div>
                  {isUnlocked ? (
                    <span style={{ fontSize: 11, color: '#c8f500' }}>{ch.coinPrice === 0 ? '🆓' : '✅'} Baca</span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11 }}>🔒</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#c8f500' }}>🪙 {ch.coinPrice}</span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {showUnlockConfirm && pendingChapter && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 }}>
            <div style={{ background: '#16161f', border: '1px solid rgba(200,245,0,0.2)', borderRadius: 16, padding: 24, maxWidth: 320, width: '100%' }}>
              <div style={{ fontSize: 24, textAlign: 'center', marginBottom: 12 }}>🔓</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', textAlign: 'center', marginBottom: 6 }}>Beli Bab Ini?</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginBottom: 16 }}>
                Bab {pendingChapter.chapterNumber} — {pendingChapter.title || ''}
              </div>
              <div style={{ background: 'rgba(200,245,0,0.07)', borderRadius: 10, padding: 12, marginBottom: 16, textAlign: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#c8f500' }}>🪙 {pendingChapter.coinPrice}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginLeft: 6 }}>dari saldo {userCoins} coin</span>
              </div>
              {userCoins < pendingChapter.coinPrice && (
                <div style={{ fontSize: 11, color: '#ff6b6b', textAlign: 'center', marginBottom: 10 }}>⚠️ Coin tidak cukup! Top-up dulu ya.</div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: 'rgba(255,255,255,0.6)', fontSize: 13, padding: 10, cursor: 'pointer' }}
                  onClick={() => { setShowUnlockConfirm(false); setPendingChapter(null) }}>Batal</button>
                {userCoins < pendingChapter.coinPrice ? (
                  <button style={{ flex: 1, ...S.submitBtn, marginTop: 0 }} onClick={() => { setShowUnlockConfirm(false); setPendingChapter(null); setView('topup') }}>🪙 Top-up</button>
                ) : (
                  <button style={{ flex: 1, ...S.submitBtn, marginTop: 0, opacity: unlockLoading ? 0.5 : 1 }}
                    onClick={() => handleUnlockChapter(pendingChapter!)} disabled={unlockLoading}>
                    {unlockLoading ? '⏳...' : `🔓 Beli — 🪙 ${pendingChapter.coinPrice}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // VIEW: PUBLIC — Reader
  // ═══════════════════════════════════════════════════
  if (mainTab === 'public' && pubView === 'read' && pubSelectedChap) {
    return (
      <div style={{ ...S.wrap, background: '#0e0e16' }}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => { setPubView('detail'); setPubChapText('') }}>‹ Kembali</button>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center', maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pubSelectedChap.title}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...S.iconBtn, fontSize: 13 }} onClick={() => setFontSize(f => Math.max(11, f - 1))}>A-</button>
            <button style={{ ...S.iconBtn, fontSize: 13 }} onClick={() => setFontSize(f => Math.min(22, f + 1))}>A+</button>
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', lineHeight: 1.85, color: 'rgba(255,255,255,0.88)', fontSize: fontSize }}>
          {pubChapReadLoading ? (
            <div style={{ textAlign: 'center', paddingTop: 60, color: 'rgba(255,255,255,0.3)' }}>⏳ Memuat chapter...</div>
          ) : (
            pubChapText.split('\n').map((para, i) =>
              para.trim() ? <p key={i} style={{ marginBottom: '1em', marginTop: 0 }}>{para}</p> : <br key={i} />
            )
          )}
          <div style={{ height: 60 }} />
        </div>
        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8 }}>
          {(() => {
            const idx = pubChapters.findIndex(c => c.id === pubSelectedChap.id)
            const prev = idx > 0 ? pubChapters[idx - 1] : null
            const next = idx < pubChapters.length - 1 ? pubChapters[idx + 1] : null
            return (
              <>
                <button disabled={!prev} onClick={() => prev && pubNovel && openPublicChapter(prev, pubNovel.slug)}
                  style={{ flex: 1, ...S.submitBtn, background: prev ? 'rgba(200,245,0,0.15)' : 'rgba(255,255,255,0.05)', color: prev ? '#c8f500' : 'rgba(255,255,255,0.2)', border: `1px solid ${prev ? 'rgba(200,245,0,0.3)' : 'rgba(255,255,255,0.05)'}`, marginTop: 0 }}>
                  ‹ Prev
                </button>
                <button disabled={!next} onClick={() => next && pubNovel && openPublicChapter(next, pubNovel.slug)}
                  style={{ flex: 1, ...S.submitBtn, background: next ? 'rgba(200,245,0,0.15)' : 'rgba(255,255,255,0.05)', color: next ? '#c8f500' : 'rgba(255,255,255,0.2)', border: `1px solid ${next ? 'rgba(200,245,0,0.3)' : 'rgba(255,255,255,0.05)'}`, marginTop: 0 }}>
                  Next ›
                </button>
              </>
            )
          })()}
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // VIEW: PUBLIC — Detail novel
  // ═══════════════════════════════════════════════════
  if (mainTab === 'public' && pubView === 'detail' && pubNovel) {
    return (
      <div style={S.wrap}>
        <div style={S.readerHeader}>
          <button style={S.backBtn} onClick={() => { setPubView('list'); setPubNovel(null); setPubChapters([]) }}>‹ Kembali</button>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>📖 Royal Road</div>
          <div style={{ width: 60 }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', gap: 14, padding: '14px 14px 10px' }}>
            <img src={pubNovel.coverUrl} alt={pubNovel.title} onError={e => (e.currentTarget.src = 'https://placehold.co/90x130/1a1a24/444?text=Novel')}
              style={{ width: 90, height: 130, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginBottom: 4, lineHeight: 1.3 }}>{pubNovel.title}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>✍️ {pubNovel.author}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>🏷️ {pubNovel.genre}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {pubNovel.rating > 0 && <span style={{ fontSize: 9, padding: '2px 7px', background: 'rgba(255,200,0,0.1)', border: '1px solid rgba(255,200,0,0.3)', borderRadius: 4, color: '#ffc800' }}>⭐ {pubNovel.rating.toFixed(1)}</span>}
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', padding: '2px 7px', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>🆓 Gratis</span>
              </div>
            </div>
          </div>
          <div style={{ padding: '0 14px 4px' }}>
            <div style={S.sectionTitle}>DAFTAR BAB ({pubChapters.length})</div>
          </div>
          <div style={{ padding: '0 14px 80px' }}>
            {pubChapLoading ? (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: 30 }}>⏳ Memuat daftar bab...</div>
            ) : pubChapters.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: 30 }}>Tidak ada bab tersedia</div>
            ) : pubChapters.map(ch => (
              <button key={ch.id} style={{ ...S.chapterBtn }} onClick={() => openPublicChapter(ch, pubNovel.slug)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{ch.title}</div>
                  {ch.date && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{ch.date}</div>}
                </div>
                <span style={{ fontSize: 11, color: '#4fc3f7' }}>🆓 Baca</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // VIEW: HOME
  // ═══════════════════════════════════════════════════
  const filteredNovels = novels.filter(n => {
    const matchSearch = !search || n.title.toLowerCase().includes(search.toLowerCase()) || n.author.toLowerCase().includes(search.toLowerCase())
    const matchTab = activeHomeTab === 'semua' || n.status === activeHomeTab
    return matchSearch && matchTab
  })

  const statusColor: Record<string, string> = { ongoing: '#c8f500', completed: '#4fc3f7', hiatus: '#ff9d00' }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>📕</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>kyonovel</span>
          <span style={{ fontSize: 10, background: 'linear-gradient(90deg,#c8f500,#4fc3f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 800, letterSpacing: 1 }}>NOVEL</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(200,245,0,0.1)', border: '1px solid rgba(200,245,0,0.25)', borderRadius: 20, padding: '4px 10px', cursor: 'pointer' }}
            onClick={() => setView('topup')}>
            <span style={{ fontSize: 13 }}>🪙</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#c8f500' }}>{userCoins}</span>
          </div>
          {isAdmin && (
            <>
              <button style={{ ...S.iconBtn, position: 'relative', background: coinRequests.length > 0 ? 'rgba(255,157,0,0.15)' : 'rgba(255,255,255,0.06)', border: `1px solid ${coinRequests.length > 0 ? 'rgba(255,157,0,0.4)' : 'transparent'}`, color: coinRequests.length > 0 ? '#ff9d00' : '#fff' }}
                onClick={() => setView('inbox')}>
                📬
                {coinRequests.length > 0 && (
                  <span style={{ position: 'absolute', top: -4, right: -4, background: '#ff375f', color: '#fff', borderRadius: 10, padding: '1px 5px', fontSize: 9, fontWeight: 800 }}>{coinRequests.length}</span>
                )}
              </button>
              <button style={S.iconBtn} onClick={() => { resetUploadForm(); setView('upload') }} title="Upload Novel">📤</button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        {(['kyonovel', 'public'] as const).map(t => (
          <button key={t} style={{ flex: 1, background: mainTab === t ? 'rgba(200,245,0,0.08)' : 'none', border: 'none', borderBottom: mainTab === t ? '2px solid #c8f500' : '2px solid transparent', color: mainTab === t ? '#c8f500' : 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '9px 4px' }}
            onClick={() => setMainTab(t)}>
            {t === 'kyonovel' ? '💎 KyoNovel' : '🌐 Publik'}
          </button>
        ))}
      </div>

      {mainTab === 'kyonovel' && (
        <>
          <div style={{ padding: '8px 12px 0', display: 'flex', gap: 8 }}>
            <input style={S.searchInput} placeholder="Cari novel atau penulis..."
              value={search} onChange={e => setSearch(e.target.value)} />
            <button style={S.searchBtn}>🔍</button>
          </div>
          <div style={S.tabs}>
            {(['semua', 'ongoing', 'completed'] as const).map(t => (
              <button key={t} style={{ ...S.tab, ...(activeHomeTab === t ? S.tabActive : {}) }} onClick={() => setActiveHomeTab(t)}>
                {t === 'semua' ? '📚 Semua' : t === 'ongoing' ? '🔥 Ongoing' : '✅ Selesai'}
              </button>
            ))}
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
            {novels.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'rgba(255,255,255,0.15)' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📕</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Belum ada novel</div>
                {isAdmin && <div style={{ fontSize: 11, marginTop: 6 }}>Tap 📤 untuk upload novel pertama</div>}
              </div>
            ) : (
              <div style={S.grid}>
                {filteredNovels.map(novel => (
                  <button key={novel.id} style={S.card} onClick={() => { setSelectedNovel(novel); setView('detail') }}>
                    <div style={{ position: 'relative', paddingTop: '140%' }}>
                      <img src={novel.coverUrl} alt={novel.title} onError={e => (e.currentTarget.src = 'https://placehold.co/120x168/1a1a24/444?text=Novel')}
                        style={{ ...S.cardImg, position: 'absolute', inset: 0 }} />
                      <span style={{ ...S.statusBadge, color: statusColor[novel.status], borderColor: statusColor[novel.status], background: 'rgba(0,0,0,0.65)' }}>
                        {novel.status.toUpperCase()}
                      </span>
                      <span style={S.premiumBadge}>💎</span>
                    </div>
                    <div style={S.cardTitle}>{novel.title}</div>
                  </button>
                ))}
              </div>
            )}
            <div style={{ height: 40 }} />
          </div>
        </>
      )}

      {mainTab === 'public' && (
        <>
          <div style={{ padding: '8px 12px 0', display: 'flex', gap: 8 }}>
            <input style={S.searchInput} placeholder="Cari di Royal Road..."
              value={pubSearch} onChange={e => setPubSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchPublicNovels(pubSearch)} />
            <button style={S.searchBtn} onClick={() => searchPublicNovels(pubSearch)}>🔍</button>
          </div>
          <div style={{ padding: '4px 12px 0', fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>via Royal Road · Baca gratis langsung di app</div>
          <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
            {pubLoading ? (
              <div style={{ textAlign: 'center', paddingTop: 60, color: 'rgba(255,255,255,0.3)' }}>⏳ Memuat...</div>
            ) : pubNovels.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'rgba(255,255,255,0.15)' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
                <div>Tidak ada hasil. Coba kata kunci lain.</div>
              </div>
            ) : (
              <div style={S.grid}>
                {pubNovels.map(novel => (
                  <button key={novel.id} style={S.card} onClick={() => openPublicNovel(novel)}>
                    <div style={{ position: 'relative', paddingTop: '140%' }}>
                      <img src={novel.coverUrl} alt={novel.title} onError={e => (e.currentTarget.src = 'https://placehold.co/120x168/1a1a24/444?text=Novel')}
                        style={{ ...S.cardImg, position: 'absolute', inset: 0 }} />
                      <span style={{ ...S.statusBadge, color: '#4fc3f7', borderColor: '#4fc3f7', background: 'rgba(0,0,0,0.65)' }}>🆓 GRATIS</span>
                      {novel.rating > 0 && (
                        <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 9, background: 'rgba(0,0,0,0.7)', color: '#ffc800', padding: '2px 5px', borderRadius: 4, fontWeight: 700 }}>
                          ⭐{novel.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div style={S.cardTitle}>{novel.title}</div>
                  </button>
                ))}
              </div>
            )}
            <div style={{ height: 40 }} />
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════
const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0f', overflow: 'hidden', position: 'relative' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#0a0a0f', borderBottom: '1px solid rgba(200,245,0,0.08)', flexShrink: 0 },
  readerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#0a0a0f', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 14, cursor: 'pointer', padding: '4px 8px' },
  iconBtn: { background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 14, cursor: 'pointer', padding: '5px 8px' },
  searchInput: { flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none' },
  searchBtn: { background: '#c8f500', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 14, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 },
  tab: { flex: 1, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 4px', borderRadius: 6, transition: 'all .15s' },
  tabActive: { background: 'rgba(200,245,0,0.1)', color: '#c8f500' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 },
  card: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, cursor: 'pointer', overflow: 'hidden', textAlign: 'left', padding: 0 },
  cardImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  cardTitle: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.85)', padding: '5px 6px', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  statusBadge: { position: 'absolute', bottom: 6, left: 6, fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, border: '1px solid', letterSpacing: 0.5 },
  premiumBadge: { position: 'absolute', top: 6, right: 6, fontSize: 14, filter: 'drop-shadow(0 0 4px gold)' },
  chapterBtn: { display: 'flex', alignItems: 'center', width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', marginBottom: 6, textAlign: 'left' },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, marginBottom: 10, marginTop: 4 },
  formGroup: { marginBottom: 12 },
  label: { fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 5 },
  input: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  select: { width: '100%', background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  uploadBtn: { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 8, color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer', padding: '10px', textAlign: 'center' },
  submitBtn: { width: '100%', background: 'linear-gradient(90deg, #c8f500, #4fc3f7)', border: 'none', borderRadius: 10, color: '#000', fontSize: 14, fontWeight: 800, cursor: 'pointer', padding: '13px', marginTop: 8 },
}
