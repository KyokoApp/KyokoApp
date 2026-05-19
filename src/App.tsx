import React, { useEffect, useMemo, useRef, useState } from 'react'
import { auth, googleProvider, dbChat, dbCommunity, dbAdmin, dbBonus } from './firebase'
import { collection, doc, setDoc, deleteDoc, onSnapshot, orderBy, query, getDoc, getDocs, limit, updateDoc, increment } from 'firebase/firestore'

// Lazy load GlobalChatPanel - hemat memory saat tidak dibuka
const GlobalChatPanel = React.lazy(() => import('./GlobalChatPanel'))

// ── Cache helper (localStorage dengan TTL) ────────────────────
const CACHE_TTL = 5 * 60 * 1000 // 5 menit
function getCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(key); return null }
    return data as T
  } catch { return null }
}
function setCache(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })) } catch {}
}
function invalidateCache(key: string) {
  try { localStorage.removeItem(key) } catch {}
}
import { signInWithRedirect, signInWithPopup, getRedirectResult, signOut, onAuthStateChanged, User } from 'firebase/auth'

import BottomNav from './BottomNav'
import AnimeHeroSection from './AnimeHeroSection'
import MangaInfoSection from './MangaInfoSection'

function App() {
  const groupCategories = useMemo(
    () => ['Anime', 'Game', 'Bot WhatsApp', 'Jual Beli', 'Cari Teman', 'Teknologi', 'Musik', 'Belajar', 'Daerah', 'Random'],
    [],
  )
  const gameData = useMemo(
    () => ({
      RPG: [
        { name: 'Genshin Impact', link: 'https://play.google.com/store/apps/details?id=com.miHoYo.GenshinImpact' },
        { name: 'Wuthering Waves', link: 'https://play.google.com/store/apps/details?id=com.kurogame.wutheringwaves.global' },
        { name: 'Neverness To Everness', link: 'https://play.google.com/store/apps/details?id=com.hottagames.nte' },
      ],
      MOBA: [
        { name: 'Honor of Kings', link: 'https://play.google.com/store/apps/details?id=com.levelinfinite.sgameGlobal' },
        { name: 'Mobile Legends', link: 'https://play.google.com/store/apps/details?id=com.mobile.legends' },
      ],
      FPS: [
        { name: 'Delta Force', link: 'https://play.google.com/store/apps/details?id=com.garena.game.df' },
        { name: 'Free Fire', link: 'https://play.google.com/store/apps/details?id=com.dts.freefireth' },
        { name: 'Blood Strike', link: 'https://play.google.com/store/apps/details?id=com.netease.newspike' },
      ],
    }),
    [],
  )

  // ── Splash screen ─────────────────────────────────────────────────────────
  const [splashDone, setSplashDone] = useState(false)
  const [splashFade, setSplashFade] = useState(false)

  // ── Rating ─────────────────────────────────────────────────────────────────
  const [ratings, setRatings] = useState<{id:string;name:string;star:number;comment:string;createdAt:number;fake?:boolean}[]>([])
  const [ratingForm, setRatingForm] = useState({ name: '', star: 0, comment: '' })
  const [ratingHover, setRatingHover] = useState(0)
  const [ratingStatus, setRatingStatus] = useState<'idle'|'success'|'error'>('idle')
  const [ratingFilter, setRatingFilter] = useState<number | null>(null)
  const [ratingBubbleOpen, setRatingBubbleOpen] = useState(false)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [groups, setGroups] = useState<Record<string, { name: string; link: string; desc: string; createdAt: number }[]>>({})
  const [groupForm, setGroupForm] = useState({ name: '', link: '', category: groupCategories[0], desc: '' })
  const [groupErrors, setGroupErrors] = useState({ link: '' })
  const [activeGroupIndex, setActiveGroupIndex] = useState(0)
  const [groupSlideDirection, setGroupSlideDirection] = useState<'left' | 'right'>('right')
  const [groupBgText, setGroupBgText] = useState(0) // index
  const [groupBgDir, setGroupBgDir] = useState<'left'|'right'>('right')
  const [groupBgKey, setGroupBgKey] = useState(0) // force re-animate
  const [groupSearch, setGroupSearch] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})
  const [activeGenre, setActiveGenre] = useState<'RPG' | 'MOBA' | 'FPS'>('RPG')
  const [feedback, setFeedback] = useState({ name: '', category: 'Saran', message: '' })
  const [feedbackStatus, setFeedbackStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: '',
  })
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    {
      role: 'assistant',
      content: 'Halo! Aku KyokoAI. Tanyakan apa saja tentang KyokoMd atau komunitasnya.',
    },
  ])
  const [chatMemory, setChatMemory] = useState({
    userName: '',
    lastTopic: 'KyokoMd',
    lastMood: 'calm' as 'happy' | 'calm' | 'shy' | 'annoyed' | 'excited',
    lastUserMessage: '',
  })
  const [lastFallbackIndex, setLastFallbackIndex] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [navDrawerOpen, setNavDrawerOpen] = useState(false)
  const navDrawerRef = React.useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [visitorCount, setVisitorCount] = useState(0)
  const [newsFilter, setNewsFilter] = useState('Semua')
  const [gcOpen, setGcOpen] = useState(false)
  // ── Lainnya full-page tab ────────────────────────────────────────────────
  const [lainnyaOpen, setLainnyaOpen] = useState(false)
  const [gcUnread, setGcUnread] = useState(false)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [showLoginTutorial, setShowLoginTutorial] = useState(false)

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u)
      if (u && showLoginTutorial) {
        // Auto close tutorial after 4s dan buka global chat
        setTimeout(() => {
          setShowLoginTutorial(false)
          setGcOpen(true)
        }, 3500)
      }
    })
    return () => unsub()
  }, [showLoginTutorial])

  // ── OTA Update Checker ────────────────────────────────────────────────────
  React.useEffect(() => {
    const CURRENT_VERSION = '1.0.0'
    const VERSION_URL = 'https://kyokoapp.vercel.app/version.json'
    const CHECK_INTERVAL = 5 * 60 * 1000 // cek tiap 5 menit

    const checkUpdate = async () => {
      try {
        const res = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const isNative = !!(window as any).Capacitor?.isNativePlatform?.()
        if (!isNative) return // OTA hanya untuk APK, web auto update sendiri
        if (data.forceReload || data.version !== CURRENT_VERSION) {
          // Reload WebView untuk ambil versi terbaru dari Vercel
          window.location.reload()
        }
      } catch { /* silent fail */ }
    }

    checkUpdate() // cek saat pertama buka
    const interval = setInterval(checkUpdate, CHECK_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  const handleLoginClick = async () => {
    try {
      const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.()
      if (isCapacitor) {
        // Di APK: pakai plugin native Google Auth (tidak lewat WebView)
        const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
        await GoogleAuth.initialize()
        const googleUser = await GoogleAuth.signIn()
        const credential = (await import('firebase/auth')).GoogleAuthProvider.credential(
          googleUser.authentication.idToken
        )
        const { signInWithCredential } = await import('firebase/auth')
        await signInWithCredential(auth, credential)
        setShowLoginTutorial(true)
      } else {
        // Di browser: pakai popup seperti biasa
        await signInWithPopup(auth, googleProvider)
        setShowLoginTutorial(true)
      }
    } catch (err) {
      console.error('Login error:', err)
    }
  }
  const [aiUnread, setAiUnread] = useState(false)
  const [gcInitialTab, setGcInitialTab] = useState<'chat'|'rpg'|'fishing'|'anime'|'manga'|'novel'>('chat')

  // Max 2 RPG toast notifications
  const [rpgToasts, setRpgToasts] = useState<{id:number;msg:string}[]>([])
  const rpgToastIdRef = React.useRef(0)
  const showRpgToast = React.useCallback((msg: string) => {
    const id = ++rpgToastIdRef.current
    setRpgToasts(prev => [...prev.slice(-1), {id, msg}]) // max 2
    setTimeout(() => setRpgToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])
  // ── GC Mini Music Player (musik tetap nyala saat panel tutup) ──
  const [gcMiniPlayer, setGcMiniPlayer] = useState<{ playing: boolean; title: string; audioRef: React.RefObject<HTMLAudioElement | null> } | null>(null)

  // ── ZZZ Page Transition ────────────────────────────────────────────────────
  const [zzzActive, setZzzActive] = useState(false)
  const [zzzLabel, setZzzLabel] = useState('LOADING')
  const zzzTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const zzzTimeout2Ref = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerZzz = (label: string, onMidpoint: () => void) => {
    if (zzzTimeoutRef.current) clearTimeout(zzzTimeoutRef.current)
    if (zzzTimeout2Ref.current) clearTimeout(zzzTimeout2Ref.current)
    setZzzLabel(label)
    setZzzActive(true)
    zzzTimeoutRef.current = setTimeout(onMidpoint, 800)
    zzzTimeout2Ref.current = setTimeout(() => setZzzActive(false), 1600)
  }

  // APK MOD ADMIN
  const ADMIN_USER = 'KyokoRyu'
  const ADMIN_CODE = '20062005'
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('isAdmin') === 'true')
  const [adminModalOpen, setAdminModalOpen] = useState(false)
  const [adminUser, setAdminUser] = useState('')
  const [adminCode, setAdminCode] = useState('')
  const [adminError, setAdminError] = useState('')
  const [apkTab, setApkTab] = useState<'apk' | 'free' | 'premium'>('apk')
  const [apkBgKey, setApkBgKey] = useState(0)
  const [apkBgDir, setApkBgDir] = useState<'left'|'right'>('right')
  const apkBgLabels: Record<string, string> = { apk: 'APK MOD', free: 'SCBOT FREE', premium: 'PREMIUM' }
  const apkTabOrder = ['apk', 'free', 'premium'] as const
  const handleApkTab = (tab: 'apk'|'free'|'premium') => {
    const prevIdx = apkTabOrder.indexOf(apkTab)
    const nextIdx = apkTabOrder.indexOf(tab)
    setApkBgDir(nextIdx > prevIdx ? 'right' : 'left')
    setApkTab(tab)
    setApkBgKey(k => k+1)
    setApkSearchOpen(false)
    setFreeSearchOpen(false)
    setPremiumSearchOpen(false)
  }
  const [uploadModal, setUploadModal] = useState<'apk' | 'free' | 'premium' | null>(null)
  const [uploadForm, setUploadForm] = useState({ name: '', link: '', version: '', desc: '', waLink: '', category: 'Lainnya' })
  const [apkList, setApkList] = useState<{id:string;name:string;link:string;version:string;desc:string}[]>([])
  const [scbotFreeList, setScbotFreeList] = useState<{id:string;name:string;link:string;version:string;desc:string}[]>([])
  const [scbotPremiumList, setScbotPremiumList] = useState<{id:string;name:string;price:string;version:string;desc:string;waLink:string}[]>([])
  const [menuDots, setMenuDots] = useState<string | null>(null)
  // APK category filter & search
  const apkCategories = ['Game', 'Sosmed', 'AI', 'Lainnya']
  const scCategories = ['Semua', 'Game', 'Utility', 'Fun', 'Lainnya']
  const [apkCategory, setApkCategory] = useState<string>('Semua')
  const [apkSearchOpen, setApkSearchOpen] = useState(false)
  const [apkSearch, setApkSearch] = useState('')
  const [freeCategory, setFreeCategory] = useState<string>('Semua')
  const [freeSearchOpen, setFreeSearchOpen] = useState(false)
  const [freeSearch, setFreeSearch] = useState('')
  const [premiumCategory, setPremiumCategory] = useState<string>('Semua')
  const [premiumSearchOpen, setPremiumSearchOpen] = useState(false)
  const [premiumSearch, setPremiumSearch] = useState('')
  // Rating show more
  const [ratingShowCount, setRatingShowCount] = useState(3)
  const [musicPlaying, setMusicPlaying] = useState(false)

  // ── JUAL BELI AKUN ─────────────────────────────────────────────
  const jualBeliGames = ['Free Fire', 'Mobile Legends', 'Genshin Impact', 'Honkai Star Rail', 'Wuthering Waves', 'Blood Strike', 'Valorant']
  const [jualBeliItems, setJualBeliItems] = useState<{id:string;gambar:string;deskripsi:string;namaAkun:string;harga:string;noHp:string;game:string;status:'pending'|'approved'|'rejected'|'sold';createdAt:number}[]>([])
  const [jualBeliGame, setJualBeliGame] = useState('Free Fire')
  const [jualBeliModalOpen, setJualBeliModalOpen] = useState(false)
  const [jualBeliForm, setJualBeliForm] = useState({ gambar: '', deskripsi: '', namaAkun: '', harga: '', noHp: '', game: 'Free Fire' })
  const [jualBeliFormErr, setJualBeliFormErr] = useState({ noHp: '', gambar: '' })
  const [jualBeliFormStatus, setJualBeliFormStatus] = useState<'idle'|'success'|'error'>('idle')
  // Warning modal before opening seller's WA
  const [jualBeliWarnOpen, setJualBeliWarnOpen] = useState(false)
  const [jualBeliWarnItem, setJualBeliWarnItem] = useState<null|{id:string;noHp:string;game:string;namaAkun:string}>(null)
  // Seller "tandai terjual" — input nomor WA penjual untuk verifikasi
  const [jbSoldModalOpen, setJbSoldModalOpen] = useState(false)
  const [jbSoldItem, setJbSoldItem] = useState<null|{id:string;noHp:string;namaAkun:string}>(null)
  const [jbSoldInput, setJbSoldInput] = useState('')
  const [jbSoldErr, setJbSoldErr] = useState('')
  const [jualBeliWarnCooldown, setJualBeliWarnCooldown] = useState(5)
  const jualBeliCooldownRef = React.useRef<ReturnType<typeof setInterval>|null>(null)
  const [jualBeliSelectedMM, setJualBeliSelectedMM] = useState<string|null>(null)
  const [jualBeliMMList, setJualBeliMMList] = useState<{id:string;nama:string;akunResmi:string;platform:string;noWa:string;game:string;verified:boolean}[]>([])
  // Admin MM management
  const [adminMMModalOpen, setAdminMMModalOpen] = useState(false)
  const [mmForm, setMmForm] = useState({ nama: '', akunResmi: '', platform: 'Facebook', noWa: '', game: 'Free Fire', verified: true })
  const [jualBeliDetail, setJualBeliDetail] = useState<null|typeof jualBeliItems[0]>(null)
  const [jualBeliAdminTab, setJualBeliAdminTab] = useState<'pending'|'approved'>('pending')

  // ── PWA Install ────────────────────────────────────────────────
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [pwaInstalled, setPwaInstalled] = useState(false)
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => { setPwaInstalled(true); setDeferredPrompt(null) })
    // Cek sudah diinstall
    if (window.matchMedia('(display-mode: standalone)').matches) setPwaInstalled(true)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setPwaInstalled(true)
    setDeferredPrompt(null)
  }

  // Admin announcement / notif
  const [adminSettingOpen, setAdminSettingOpen] = useState(false)
  const [announcementText, setAnnouncementText] = useState('')
  const [announcementPosition, setAnnouncementPosition] = useState<'top'|'side'>('top')
  const [announcementActive, setAnnouncementActive] = useState(false)
  const [announcementVisible, setAnnouncementVisible] = useState(false)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)

  // ── Unread badge: watch globalChat untuk notif saat panel tertutup ──
  const gcLastMsgIdRef = React.useRef<string>('')
  React.useEffect(() => {
    if (gcOpen) { setGcUnread(false); return }
    const q = query(collection(dbChat, 'globalChat'), orderBy('createdAt', 'desc'), limit(1))
    let initialized = false
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return
      const latestDoc = snap.docs[0]
      const latestId = latestDoc.id
      const latestUid = latestDoc.data()?.uid || ''
      if (!initialized) { gcLastMsgIdRef.current = latestId; initialized = true; return }
      if (latestId !== gcLastMsgIdRef.current) {
        gcLastMsgIdRef.current = latestId
        // Hanya set unread jika bukan pesan dari diri sendiri
        const currentUid = auth.currentUser?.uid || ''
        if (latestUid !== currentUid) {
          setGcUnread(true)
        }
      }
    })
    return () => unsub()
  }, [gcOpen])

  // ── Handle Google redirect result di level App ────────────────────────────
  // Ini penting! Kalau getRedirectResult dipanggil di dalam GlobalChatPanel,
  // panel belum mount pas balik dari redirect, jadi result-nya hilang.
  React.useEffect(() => {
    getRedirectResult(auth).then((result) => {
      if (result?.user) {
        // Ada redirect result → auto-buka Global Chat panel
        setGcOpen(true)
      }
    }).catch(() => { /* tidak ada pending redirect, abaikan */ })
  }, [])

  // Show announcement on load — realtime from Firebase
  React.useEffect(() => {
    const annRef = doc(dbAdmin, 'site_config', 'announcement')
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null
    const unsub = onSnapshot(annRef, (snap) => {
      if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null }
      if (!snap.exists()) return
      const data = snap.data()
      const text = data?.text || ''
      const position = (data?.position as 'top' | 'side') || 'top'
      const updatedAt: number = data?.updatedAt || 0
      // Always sync text/position so admin modal input is pre-filled
      setAnnouncementText(text)
      setAnnouncementPosition(position)
      if (!text) {
        setAnnouncementActive(false)
        setAnnouncementVisible(false)
        return
      }
      // Show if broadcast is newer than what the user last saw, OR cooldown passed
      const lastShown = parseInt(localStorage.getItem('kyoko_ann_lastshown') || '0', 10)
      const cooldown = 60000 * 5
      const isNew = updatedAt > lastShown
      const cooldownPassed = Date.now() - lastShown >= cooldown
      if (!isNew && !cooldownPassed) return
      cleanupTimer = setTimeout(() => {
        setAnnouncementActive(true)
        setTimeout(() => setAnnouncementVisible(true), 80)
        localStorage.setItem('kyoko_ann_lastshown', String(updatedAt || Date.now()))
      }, 1800)
    })
    return () => { unsub(); if (cleanupTimer) clearTimeout(cleanupTimer) }
  }, [])

  React.useEffect(() => {
    const audio = new Audio('https://c.termai.cc/a138/nOnf2vY.mp3')
    audio.loop = true
    audio.volume = 0.4
    audioRef.current = audio
    // Auto-play: browser requires user interaction first, so we try on first click/touch
    const tryPlay = () => {
      audio.play().then(() => setMusicPlaying(true)).catch(() => {})
      document.removeEventListener('click', tryPlay)
      document.removeEventListener('touchstart', tryPlay)
    }
    document.addEventListener('click', tryPlay)
    document.addEventListener('touchstart', tryPlay)
    return () => {
      audio.pause()
      audio.src = ''
      document.removeEventListener('click', tryPlay)
      document.removeEventListener('touchstart', tryPlay)
    }
  }, [])

  const toggleMusic = () => {
    const audio = audioRef.current
    if (!audio) return
    if (musicPlaying) {
      audio.pause()
      setMusicPlaying(false)
    } else {
      audio.play().then(() => setMusicPlaying(true)).catch(() => {})
    }
  }
  // EDIT BERITA DI SINI - tambah objek baru untuk berita terbaru
  const gameNews = useMemo(
    () => [
      {
        game: 'genshin',
        title: 'Genshin Impact Version 5.5 Brings New Characters',
        description: 'Update terbaru Genshin Impact menghadirkan karakter baru dan area eksplorasi yang lebih luas.',
        url: 'https://genshin.hoyoverse.com',
        image: 'https://c.termai.cc/a168/fWL8x6q.jpg',
        date: '2026-05-09',
        source: 'HoYoverse Official',
      },
      {
        game: 'mobile-legends',
        title: 'Mobile Legends Season Update: Meta Baru dan Balance Patch',
        description: 'Patch terbaru Mobile Legends membawa perubahan meta dan penyesuaian hero utama.',
        url: 'https://m.mobilelegends.com',
        image: 'https://c.termai.cc/a167/OZkTk.jpg',
        date: '2026-05-10',
        source: 'Moonton News',
      },
      {
        game: 'wuthering-waves',
        title: 'Wuthering Waves Update: Eksplorasi dan Event Musim Baru',
        description: 'Event terbaru membuka area baru dan reward eksklusif untuk pemain aktif.',
        url: 'https://wutheringwaves.kurogame.com',
        image: 'https://c.termai.cc/a109/QJM.jpg',
        date: '2026-05-11',
        source: 'Kuro Games',
      },
      {
        game: 'free-fire',
        title: 'Free Fire menghadirkan mode baru dan kolaborasi spesial',
        description: 'Mode terbatas dan bundle kolaborasi baru tersedia di update terbaru Free Fire.',
        url: 'https://ff.garena.com',
        image: 'https://c.termai.cc/a184/MPYWRSy.jpg',
        date: '2026-05-12',
        source: 'Garena',
      },
    ],
    [],
  )

  const activeCategory = groupCategories[activeGroupIndex]

  useEffect(() => {
    const elements = document.querySelectorAll('.fade-section')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
          }
        })
      },
      { threshold: 0.2 },
    )

    elements.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [])

  // ── Splash screen timer ───────────────────────────────────────────────────
  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashFade(true), 2400)
    const doneTimer = setTimeout(() => setSplashDone(true), 3000)
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer) }
  }, [])

  // ── Firebase: Load ratings (getDocs + cache 5 menit) ─────────────────────
  const loadRatings = React.useCallback(async (forceRefresh = false) => {
    const fakeRatings = [
      { name: 'Arya_Gaming', star: 5, comment: 'Bot paling lengkap! Fiturnya banyak banget, admin juga ramah. Recommended banget buat yang cari bot WA berkualitas!' },
      { name: 'NadiaXplore', star: 5, comment: 'Udah lama pake KyokoMd dan ga pernah kecewa. Update terus, respon cepat.' },
      { name: 'RizkiBot27', star: 4, comment: 'Bagus banget, cuma minta tambah fitur game baru. Overall memuaskan!' },
      { name: 'Maulana_Tech', star: 5, comment: 'Top banget! Grup komunitasnya aktif, botnya stabil. 10/10 👍' },
      { name: 'SintaWijaya', star: 5, comment: 'KyokoMd emang beda dari bot lain. Premium worth it banget harganya.' },
      { name: 'FahriXD', star: 4, comment: 'Suka banget sama tampilan webnya, keren dan modern. Bot juga oke!' },
      { name: 'Putri_Gamer', star: 5, comment: 'Paling suka fitur direktori grupnya, gampang cari komunitas baru.' },
    ]
    if (!forceRefresh) {
      const cached = getCache<typeof ratings>('kyoko_ratings')
      if (cached) { setRatings(cached); return }
    }
    try {
      const snap = await getDocs(collection(dbCommunity, 'ratings'))
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as {name:string;star:number;comment:string;createdAt:number;fake?:boolean}) }))
      items.sort((a, b) => b.createdAt - a.createdAt)
      if (snap.empty) {
        fakeRatings.forEach((r, i) => {
          const id = `fake-${i}`
          setDoc(doc(dbCommunity, 'ratings', id), { ...r, createdAt: Date.now() - (i * 86400000), fake: true })
        })
      }
      setRatings(items)
      setCache('kyoko_ratings', items)
    } catch (e) { console.error('loadRatings error:', e) }
  }, [])

  useEffect(() => { loadRatings() }, [loadRatings])

  // ── Firebase: Load groups (getDocs + cache 5 menit) ──────────────────────
  const loadGroups = React.useCallback(async (forceRefresh = false) => {
    const expiryMs = 2592000000
    const initialGroups = groupCategories.reduce(
      (acc, category) => { acc[category] = []; return acc },
      {} as Record<string, { name: string; link: string; desc: string; createdAt: number }[]>,
    )
    if (!forceRefresh) {
      const cached = getCache<typeof groups>('kyoko_groups')
      if (cached) { setGroups(cached); return }
    }
    try {
      const snapshot = await getDocs(collection(dbCommunity, 'groups'))
      const loaded: Record<string, { name: string; link: string; desc: string; createdAt: number }[]> = { ...initialGroups }
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as { category: string; name: string; link: string; desc: string; createdAt: number }
        if (!data.category || !groupCategories.includes(data.category)) return
        const createdAt = typeof data.createdAt === 'number' ? data.createdAt : Date.now()
        if (Date.now() - createdAt > expiryMs) return
        if (!loaded[data.category]) loaded[data.category] = []
        loaded[data.category].push({ name: data.name, link: data.link, desc: data.desc, createdAt })
      })
      Object.keys(loaded).forEach((cat) => {
        loaded[cat].sort((a, b) => b.createdAt - a.createdAt)
      })
      setGroups(loaded)
      setCache('kyoko_groups', loaded)
    } catch (e) { console.error('loadGroups error:', e) }
  }, [groupCategories])

  useEffect(() => { loadGroups() }, [loadGroups])

  // ── Firebase: Load jual beli & MM list (getDocs + cache 5 menit) ────────
  const loadJualBeli = React.useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cachedJB = getCache<typeof jualBeliItems>('kyoko_jualbeli')
      const cachedMM = getCache<typeof jualBeliMMList>('kyoko_mmlist')
      if (cachedJB && cachedMM) { setJualBeliItems(cachedJB); setJualBeliMMList(cachedMM); return }
    }
    try {
      const [snapJB, snapMM] = await Promise.all([
        getDocs(collection(dbCommunity, 'jualBeliAkun')),
        getDocs(collection(dbCommunity, 'middlemanList')),
      ])
      const itemsJB = snapJB.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      itemsJB.sort((a: any, b: any) => b.createdAt - a.createdAt)
      const itemsMM = snapMM.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      setJualBeliItems(itemsJB)
      setJualBeliMMList(itemsMM)
      setCache('kyoko_jualbeli', itemsJB)
      setCache('kyoko_mmlist', itemsMM)
    } catch (e) { console.error('loadJualBeli error:', e) }
  }, [])

  useEffect(() => { loadJualBeli() }, [loadJualBeli])

  // ── Firebase: Load APK / SC lists (getDocs + cache 5 menit) ─────────────
  const loadApkLists = React.useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cA = getCache<typeof apkList>('kyoko_apklist')
      const cF = getCache<typeof scbotFreeList>('kyoko_scfree')
      const cP = getCache<typeof scbotPremiumList>('kyoko_scpremium')
      if (cA && cF && cP) { setApkList(cA); setScbotFreeList(cF); setScbotPremiumList(cP); return }
    }
    try {
      const [snapApk, snapFree, snapPremium] = await Promise.all([
        getDocs(collection(dbAdmin, 'apkList')),
        getDocs(collection(dbAdmin, 'scbotFreeList')),
        getDocs(collection(dbAdmin, 'scbotPremiumList')),
      ])
      const apk = snapApk.docs.map((d) => ({ id: d.id, ...(d.data() as {name:string;link:string;version:string;desc:string}) }))
      const free = snapFree.docs.map((d) => ({ id: d.id, ...(d.data() as {name:string;link:string;version:string;desc:string}) }))
      const premium = snapPremium.docs.map((d) => ({ id: d.id, ...(d.data() as {name:string;price:string;version:string;desc:string;waLink:string}) }))
      setApkList(apk); setScbotFreeList(free); setScbotPremiumList(premium)
      setCache('kyoko_apklist', apk); setCache('kyoko_scfree', free); setCache('kyoko_scpremium', premium)
    } catch (e) { console.error('loadApkLists error:', e) }
  }, [])

  useEffect(() => { loadApkLists() }, [loadApkLists])

  useEffect(() => {
    const storedTheme = localStorage.getItem('theme')
    if (storedTheme === 'light') {
      setTheme('light')
      document.body.classList.add('theme-light')
    }
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Close nav drawer on outside click
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (navDrawerRef.current && !navDrawerRef.current.contains(e.target as Node)) {
        setNavDrawerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    // Increment visitor di Firestore dan animate count
    let rafId = 0
    const visitorDocRef = doc(dbBonus, 'stats', 'visitors')
    const runAnimation = (target: number, from: number) => {
      const start = performance.now()
      const duration = 1800
      const animate = (time: number) => {
        const progress = Math.min((time - start) / duration, 1)
        const ease = 1 - Math.pow(1 - progress, 3)
        setVisitorCount(Math.floor(from + ease * (target - from)))
        if (progress < 1) rafId = requestAnimationFrame(animate)
      }
      rafId = requestAnimationFrame(animate)
    }
    // Increment count
    getDoc(visitorDocRef).then(snap => {
        if (!snap.exists()) {
          setDoc(visitorDocRef, { count: 1280 }).then(() => {
            runAnimation(1280, 0)
          })
        } else {
          const current = snap.data().count || 1280
          updateDoc(visitorDocRef, { count: increment(1) }).catch(() => {})
          runAnimation(current + 1, Math.max(0, current - 5))
        }
      }).catch(() => {
        runAnimation(1280, 1270)
      })
    return () => cancelAnimationFrame(rafId)
  }, [])


  const handleGroupSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!groupForm.name || !groupForm.link || !groupForm.desc) {
      return
    }
    const normalizedLink = groupForm.link.trim()
    const normalizedLower = normalizedLink.toLowerCase()
    const isWhatsAppLink =
      normalizedLower.includes('chat.whatsapp.com') || normalizedLower.includes('whatsapp.com/channel')
    if (!isWhatsAppLink) {
      setGroupErrors({ link: 'Masukkan link WhatsApp yang valid!' })
      return
    }
    const existingLinks = Object.values(groups)
      .flat()
      .map((group) => group.link.trim().toLowerCase())
    if (existingLinks.includes(normalizedLower)) {
      setGroupErrors({ link: 'Link grup ini sudah terdaftar!' })
      return
    }
    setGroupErrors({ link: '' })
    const newGroup = { category: groupForm.category, name: groupForm.name, link: normalizedLink, desc: groupForm.desc, createdAt: Date.now() }
    const docId = `${groupForm.category}-${Date.now()}`
    setDoc(doc(dbCommunity, 'groups', docId), newGroup).catch(console.error)
    // Optimistic update + invalidate cache
    setGroups(prev => {
      const updated = { ...prev }
      updated[groupForm.category] = [newGroup, ...(updated[groupForm.category] || [])]
      return updated
    })
    invalidateCache('kyoko_groups')
    setGroupForm({ name: '', link: '', category: groupCategories[0], desc: '' })
    setIsModalOpen(false)
  }

  const handleGroupNav = (direction: 'left' | 'right') => {
    setGroupSlideDirection(direction)
    setGroupBgDir(direction)
    setGroupBgKey(k => k + 1)
    setActiveGroupIndex((prev) => {
      const next = direction === 'left'
        ? (prev === 0 ? groupCategories.length - 1 : prev - 1)
        : (prev === groupCategories.length - 1 ? 0 : prev + 1)
      setGroupBgText(next)
      return next
    })
  }

  const filteredGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase()
    if (!query) return [] as { category: string; name: string; link: string; desc: string; createdAt: number }[]
    return groupCategories.flatMap((category) =>
      (groups[category] || [])
        .filter((group) => [group.name, group.desc, category].some((field) => field.toLowerCase().includes(query)))
        .map((group) => ({ ...group, category })),
    )
  }, [groupCategories, groupSearch, groups])

  const expiryMs = 2592000000
  const getDaysLeft = (createdAt: number) => Math.max(0, Math.ceil((createdAt + expiryMs - Date.now()) / 86400000))

  const handleRenewGroup = (link: string) => {
    const normalized = link.trim().toLowerCase()
    setGroups((prev) => {
      const updated = { ...prev }
      Object.keys(updated).forEach((category) => {
        updated[category] = updated[category].map((group) =>
          group.link.trim().toLowerCase() === normalized ? { ...group, createdAt: Date.now() } : group,
        )
      })
      return updated
    })
    window.alert('Grup berhasil diperbarui! Aktif 30 hari lagi.')
  }

  const handleFeedbackSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedbackStatus({ type: 'idle', message: '' })
    try {
      const formData = new FormData()
      formData.append('nama', feedback.name)
      formData.append('kategori', feedback.category)
      formData.append('pesan', feedback.message)
      formData.append('_subject', 'Masukan KyokoMd')
      formData.append('_captcha', 'false')

      const response = await fetch('https://formsubmit.co/kyokomd2006@gmail.com', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Gagal mengirim')
      }

      setFeedbackStatus({ type: 'success', message: 'Masukan berhasil dikirim! Terima kasih.' })
      setFeedback({ name: '', category: 'Saran', message: '' })
    } catch (error) {
      setFeedbackStatus({ type: 'error', message: 'Gagal mengirim. Coba lagi nanti.' })
    }
  }

  const handleRatingSubmit = async () => {
    if (!ratingForm.name.trim() || ratingForm.star === 0) return
    const id = `rating-${Date.now()}`
    const newRating = {
      id,
      name: ratingForm.name.trim(),
      star: ratingForm.star,
      comment: ratingForm.comment.trim(),
      createdAt: Date.now(),
      fake: false,
    }
    await setDoc(doc(dbCommunity, 'ratings', id), {
      name: newRating.name,
      star: newRating.star,
      comment: newRating.comment,
      createdAt: newRating.createdAt,
      fake: false,
    }).catch(console.error)
    // Update local state + invalidate cache
    setRatings(prev => [newRating, ...prev])
    invalidateCache('kyoko_ratings')
    setRatingForm({ name: '', star: 0, comment: '' })
    setRatingHover(0)
    setRatingStatus('success')
    setTimeout(() => setRatingStatus('idle'), 3000)
  }

  const handleDeleteRating = (id: string) => {
    if (!window.confirm('Hapus rating ini?')) return
    deleteDoc(doc(dbCommunity, 'ratings', id)).catch(console.error)
    setRatings(prev => prev.filter(r => r.id !== id))
    invalidateCache('kyoko_ratings')
  }

  const handleChatSend = async () => {
    if (!chatInput.trim() || chatLoading) return
    const input = chatInput.trim()
    setChatInput('')
    setChatMessages((prev) => [...prev, { role: 'user', content: input }])
    setChatLoading(true)

    const nameMatch = input.match(/\b(?:nama(?:ku| saya)?|aku|saya)\s*(?:adalah|=)\s*([A-Za-z0-9_\-\s]{2,24})/i)
    const inferredName = nameMatch ? nameMatch[1].trim() : chatMemory.userName
    const inferredMood = (() => {
      if (/[!]{2,}|\b(seru|mantap|keren|yay|yey|asik)\b/i.test(input)) return 'excited'
      if (/\b(hehe|hihi|malu|gugup)\b/i.test(input)) return 'shy'
      if (/\b(capek|sepi|bingung|ragu)\b/i.test(input)) return 'calm'
      if (/\b(kesel|sebel|males|kesal)\b/i.test(input)) return 'annoyed'
      if (/\b(senang|bahagia|makasih|terima kasih)\b/i.test(input)) return 'happy'
      return chatMemory.lastMood
    })()
    const inferredTopic = (() => {
      if (/\b(grup|group|komunitas|link)\b/i.test(input)) return 'Komunitas'
      if (/\b(bot|fitur|plugin|command)\b/i.test(input)) return 'Fitur Bot'
      if (/\bgame|genshin|moba|fps|rpg\b/i.test(input)) return 'Game'
      return chatMemory.lastTopic
    })()

    setChatMemory((prev) => ({
      ...prev,
      userName: inferredName,
      lastMood: inferredMood,
      lastTopic: inferredTopic,
      lastUserMessage: input,
    }))

    const fallbackVariants = [
      'Hmm... aku agak blank sebentar. Coba ulangi dengan kalimat yang lebih singkat ya?',
      'Wah, sinyalku lagi goyah. Boleh tanya lagi? Aku bakal jawab sebaik mungkin.',
      'Maaf, kepalaku lagi penuh. Coba tanya lagi ya~',
      'Sebentar ya, aku lagi mikir. Ulang pertanyaannya, aku jawab kok.',
      'Aku masih di sini kok. Coba tanya lagi pelan-pelan, ya?',
    ]
    const nextFallback = (offset = 0) => {
      const index = (lastFallbackIndex + 1 + offset) % fallbackVariants.length
      setLastFallbackIndex(index)
      return fallbackVariants[index]
    }

    try {
      const pesanDikirim = `Kamu adalah KyokoAI, asisten virtual KyokoMd. Jawab SINGKAT dan PADAT maksimal 3-4 kalimat saja, jangan panjang. Hanya jawab seputar: KyokoMd bot WhatsApp, cara gabung grup, fitur bot, rekomendasi game (Genshin Impact, Wuthering Waves, Neverness to Everness, Honor of Kings, Mobile Legends, Delta Force, Free Fire, Blood Strike), info top-up di saweria.co/YukiDesu/toko-top-up, dan direktori grup. Jika di luar topik jawab: "Maaf, aku hanya bisa membantu seputar KyokoMd dan fitur yang tersedia di web ini." Pertanyaan user: ${input}`
      const response = await fetch(`https://api-faa.my.id/faa/claude-ai?text=${encodeURIComponent(pesanDikirim)}`)
      if (!response.ok) {
        throw new Error('Request gagal')
      }
      const data = await response.json()
      if (data?.status === false) {
        throw new Error(data?.error || 'Request gagal')
      }
      const rawReply = typeof data?.result === 'string' ? data.result : nextFallback(1)
      const cleaned = rawReply
        .replace(/\n\n+/g, '\n')
        .replace(/[\*_`>#\-]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
      const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean)
      const limited = sentences.length > 4 ? `${sentences.slice(0, 4).join(' ')}...` : cleaned
      const reply = limited.replace(/\n/g, ' ').trim()
      setChatMessages((prev) => [...prev, { role: 'assistant', content: reply || nextFallback(1) }])
      if (!chatOpen) setAiUnread(true)
    } catch (error) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Maaf, AI sedang tidak tersedia. Coba lagi nanti.' },
      ])
    } finally {
      setChatLoading(false)
    }
  }

  const handleThemeToggle = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.body.classList.toggle('theme-light', nextTheme === 'light')
    localStorage.setItem('theme', nextTheme)
  }

  const handleMenuClick = (targetId: string) => {
    setMenuOpen(false)
    triggerZzz('NAVIGATING', () => {
      const element = document.getElementById(targetId)
      if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }


  const handleAdminLogin = () => {
    if (adminUser === ADMIN_USER && adminCode === ADMIN_CODE) {
      sessionStorage.setItem('isAdmin', 'true')
      setIsAdmin(true)
      setAdminModalOpen(false)
      setAdminError('')
      setAdminUser('')
      setAdminCode('')
    } else {
      setAdminError('Username atau kode salah!')
    }
  }

  const handleAdminLogout = () => {
    sessionStorage.removeItem('isAdmin')
    setIsAdmin(false)
  }

  const handleSaveAnnouncement = async () => {
    try {
      const annRef = doc(dbAdmin, 'site_config', 'announcement')
      await setDoc(annRef, { text: announcementText, position: announcementPosition, updatedAt: Date.now() })
    } catch (e) {
      console.error('Gagal simpan broadcast:', e)
    }
    setAdminSettingOpen(false)
    // preview langsung di admin
    setAnnouncementActive(true)
    setTimeout(() => setAnnouncementVisible(true), 80)
  }

  const handleDismissAnnouncement = () => {
    setAnnouncementVisible(false)
    setTimeout(() => setAnnouncementActive(false), 500)
  }

  const handleUpload = () => {
    if (!uploadForm.name || !uploadForm.link) return
    const id = `item-${Date.now()}`
    if (uploadModal === 'apk') {
      setDoc(doc(dbAdmin, 'apkList', id), { name: uploadForm.name, link: uploadForm.link, version: uploadForm.version, desc: uploadForm.desc, category: uploadForm.category }).catch(console.error)
      invalidateCache('kyoko_apklist')
    } else if (uploadModal === 'free') {
      setDoc(doc(dbAdmin, 'scbotFreeList', id), { name: uploadForm.name, link: uploadForm.link, version: uploadForm.version, desc: uploadForm.desc, category: uploadForm.category }).catch(console.error)
      invalidateCache('kyoko_scfree')
    } else if (uploadModal === 'premium') {
      setDoc(doc(dbAdmin, 'scbotPremiumList', id), { name: uploadForm.name, price: uploadForm.link, version: uploadForm.version, desc: uploadForm.desc, waLink: uploadForm.waLink, category: uploadForm.category }).catch(console.error)
      invalidateCache('kyoko_scpremium')
    }
    setUploadModal(null)
    setUploadForm({ name: '', link: '', version: '', desc: '', waLink: '', category: 'Lainnya' })
  }

  const handleDelete = (type: 'apk' | 'free' | 'premium', index: number) => {
    if (!window.confirm('Hapus item ini?')) return
    if (type === 'apk') {
      const item = apkList[index]
      if (item?.id) deleteDoc(doc(dbAdmin, 'apkList', item.id)).catch(console.error)
      invalidateCache('kyoko_apklist')
    } else if (type === 'free') {
      const item = scbotFreeList[index]
      if (item?.id) deleteDoc(doc(dbAdmin, 'scbotFreeList', item.id)).catch(console.error)
      invalidateCache('kyoko_scfree')
    } else {
      const item = scbotPremiumList[index]
      if (item?.id) deleteDoc(doc(dbAdmin, 'scbotPremiumList', item.id)).catch(console.error)
      invalidateCache('kyoko_scpremium')
    }
    setMenuDots(null)
  }

  // ── Jual Beli Handlers ────────────────────────────────────────────────────
  const handleJualBeliSubmit = async () => {
    const errs = { noHp: '', gambar: '' }
    const phoneRaw = jualBeliForm.noHp.trim()
    if (!phoneRaw.startsWith('62') || !/^62\d{8,13}$/.test(phoneRaw)) {
      errs.noHp = 'Nomor harus diawali 62 (contoh: 628123456789)'
    }
    if (!jualBeliForm.gambar.trim() || !jualBeliForm.gambar.startsWith('http')) {
      errs.gambar = 'Masukkan URL gambar yang valid (https://...)'
    }
    if (errs.noHp || errs.gambar) { setJualBeliFormErr(errs); return }
    if (!jualBeliForm.namaAkun || !jualBeliForm.harga || !jualBeliForm.deskripsi) return
    const id = `jb-${Date.now()}`
    await setDoc(doc(dbCommunity, 'jualBeliAkun', id), {
      ...jualBeliForm,
      noHp: phoneRaw,
      status: 'pending',
      createdAt: Date.now(),
    }).catch(console.error)
    invalidateCache('kyoko_jualbeli')
    setJualBeliModalOpen(false)
    setJualBeliForm({ gambar: '', deskripsi: '', namaAkun: '', harga: '', noHp: '', game: 'Free Fire' })
    setJualBeliFormErr({ noHp: '', gambar: '' })
    setJualBeliFormStatus('success')
    setTimeout(() => setJualBeliFormStatus('idle'), 4000)
  }

  const handleJualBeliApprove = (id: string) => {
    updateDoc(doc(dbCommunity, 'jualBeliAkun', id), { status: 'approved' }).catch(console.error)
  }
  const handleJualBeliReject = (id: string) => {
    if (!window.confirm('Tolak & hapus listing ini?')) return
    deleteDoc(doc(dbCommunity, 'jualBeliAkun', id)).catch(console.error)
  }

  const openJualBeliWarn = (item: {id:string;noHp:string;game:string;namaAkun:string}) => {
    setJualBeliWarnItem(item)
    setJualBeliSelectedMM(null)
    setJualBeliWarnCooldown(5)
    setJualBeliWarnOpen(true)
    if (jualBeliCooldownRef.current) clearInterval(jualBeliCooldownRef.current)
    jualBeliCooldownRef.current = setInterval(() => {
      setJualBeliWarnCooldown(prev => {
        if (prev <= 1) { clearInterval(jualBeliCooldownRef.current!); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  const handleAddMM = async () => {
    if (!mmForm.nama || !mmForm.akunResmi) return
    const id = `mm-${Date.now()}`
    await setDoc(doc(dbCommunity, 'middlemanList', id), { ...mmForm }).catch(console.error)
    setMmForm({ nama: '', akunResmi: '', platform: 'Facebook', noWa: '', game: 'Free Fire', verified: true })
    setAdminMMModalOpen(false)
  }
  const handleDeleteMM = (id: string) => {
    if (!window.confirm('Hapus middleman ini?')) return
    deleteDoc(doc(dbCommunity, 'middlemanList', id)).catch(console.error)
  }

  const handleJbMarkSold = () => {
    if (!jbSoldItem) return
    const input = jbSoldInput.trim()
    if (input !== jbSoldItem.noHp) {
      setJbSoldErr('Nomor tidak cocok dengan nomor penjual listing ini.')
      return
    }
    updateDoc(doc(dbCommunity, 'jualBeliAkun', jbSoldItem.id), { status: 'sold' }).catch(console.error)
    setJbSoldModalOpen(false)
    setJbSoldInput('')
    setJbSoldErr('')
    setJbSoldItem(null)
  }

  const handleJbAdminMarkSold = (id: string) => {
    updateDoc(doc(dbCommunity, 'jualBeliAkun', id), { status: 'sold' }).catch(console.error)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const filteredNews = useMemo(() => {
    if (newsFilter === 'Semua') return gameNews
    const map: Record<string, string> = {
      Genshin: 'genshin',
      'Mobile Legends': 'mobile-legends',
      'Free Fire': 'free-fire',
      'Wuthering Waves': 'wuthering-waves',
    }
    const target = map[newsFilter]
    return gameNews.filter((item) => item.game === target)
  }, [gameNews, newsFilter])

  const gameEmoji: Record<string, string> = {
    genshin: '✨',
    'mobile-legends': '⚔️',
    'free-fire': '🔥',
    'wuthering-waves': '🌊',
    default: '🎮',
  }

  return (
    <>
      {/* ── Splash Screen ─────────────────────────────────────────────────── */}
      {!splashDone && (
        <div className={`splash-screen ${splashFade ? 'splash-fade-out' : ''}`}>
          {/* ZZZ wipe-in overlay */}
          {!splashFade && (
            <div className="splash-wipe" aria-hidden="true">
              <div className="splash-wipe-a" />
              <div className="splash-wipe-b" />
            </div>
          )}
          {/* ZZZ wipe-out overlay */}
          {splashFade && (
            <div className="splash-wipe splash-wipe-out" aria-hidden="true">
              <div className="splash-wipe-out-a" />
              <div className="splash-wipe-out-b" />
            </div>
          )}
          {/* Liquid ripple layers */}
          <div className="splash-liquid-wrap" aria-hidden="true">
            <div className="splash-liquid splash-liquid-1" />
            <div className="splash-liquid splash-liquid-2" />
            <div className="splash-liquid splash-liquid-3" />
          </div>
          {/* Corner accents */}
          <div className="splash-corner splash-corner-tl" aria-hidden="true" />
          <div className="splash-corner splash-corner-tr" aria-hidden="true" />
          <div className="splash-corner splash-corner-bl" aria-hidden="true" />
          <div className="splash-corner splash-corner-br" aria-hidden="true" />
          {/* Horizontal scan line removed */}
          <div className="splash-content">
            <div className="splash-logo-wrap">
              <div className="splash-ring splash-ring-1" />
              <div className="splash-ring splash-ring-2" />
              <svg className="splash-logo-svg" viewBox="0 0 44 44" fill="none">
                <polygon points="22,2 40,11 40,33 22,42 4,33 4,11" fill="#c8f500" />
                <text x="22" y="30" textAnchor="middle" fontFamily="Bebas Neue, sans-serif" fontSize="22" fill="#0a0a0a" fontWeight="900">K</text>
              </svg>
            </div>
            <div className="splash-brand">KYOKOMD</div>
            <div className="splash-tagline">WHATSAPP BOT</div>
            <div className="splash-loader">
              <div className="splash-loader-bar" />
              <div className="splash-loader-pct" />
            </div>
            <div className="splash-status">READY</div>
          </div>
          <div className="splash-ver">v1.0</div>
          <div className="splash-est">EST. 2024</div>
        </div>
      )}
    <div className="page">
      <div className="noise-overlay" aria-hidden="true" />
      <header className="navbar">
        <div className="logo">
          <div className={`logo-k-wrap ${musicPlaying ? 'music-pulse' : ''}`} onClick={() => setMenuOpen(true)} role="button" aria-label="Buka menu">
            <svg className="logo-k-svg" viewBox="0 0 44 44" fill="none">
              <polygon points="22,2 40,11 40,33 22,42 4,33 4,11" fill="#c8f500" />
              <text x="22" y="30" textAnchor="middle" fontFamily="Bebas Neue, sans-serif" fontSize="22" fill="#0a0a0a" fontWeight="900">K</text>
            </svg>
            {musicPlaying && <div className="music-rings" aria-hidden="true"><span/><span/><span/></div>}
          </div>
          <div className="logo-text-wrap">
            <div className="logo-title">KyokoMd</div>
            <div className="logo-sub">Kyoko App · Official</div>
          </div>
        </div>

        <div className="nav-actions">
          {/* Collapsible icon drawer */}
          <div className="nav-drawer-wrap" ref={navDrawerRef}>
            <button
              className={`nav-drawer-trigger ${navDrawerOpen ? 'open' : ''}`}
              type="button"
              onClick={() => setNavDrawerOpen(p => !p)}
              aria-label="Menu icon"
            >
              <span className="nav-drawer-dot"/><span className="nav-drawer-dot"/><span className="nav-drawer-dot"/><span className="nav-drawer-dot"/>
            </button>
            <div className={`nav-drawer-panel ${navDrawerOpen ? 'open' : ''}`}>
              <a className="nav-icon-btn" href="https://saweria.co/YukiDesu/toko-top-up" target="_blank" rel="noreferrer" data-tooltip="Top-Up Shop" onClick={() => setNavDrawerOpen(false)}>🛒</a>
              <button className="nav-icon-btn" type="button" onClick={() => { setNavDrawerOpen(false); document.getElementById('apk-mod')?.scrollIntoView({ behavior: 'smooth' }) }} data-tooltip="APK Mod">
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10 2a1 1 0 0 1 .894.553l6 12A1 1 0 0 1 16 16H4a1 1 0 0 1-.894-1.447l6-12A1 1 0 0 1 10 2Zm0 3.236L5.618 14h8.764L10 5.236ZM9 11V8h2v3H9Zm0 2h2v2H9v-2Z"/></svg>
              </button>
              <button
                className="nav-icon-btn"
                type="button"
                onClick={() => { setNavDrawerOpen(false); isAdmin ? handleAdminLogout() : setAdminModalOpen(true) }}
                data-tooltip={isAdmin ? 'Logout Admin' : 'Admin Login'}
                style={{ color: isAdmin ? '#ff3b3b' : undefined }}
              >
                {isAdmin ? '🔓' : '🔒'}
              </button>
              <button className="nav-icon-btn" type="button" onClick={() => { setNavDrawerOpen(false); handleThemeToggle() }} data-tooltip="Tema">
                {theme === 'dark' ? '🌙' : '☀️'}
              </button>
            </div>
          </div>

          {/* Dev Call button with arrow badge */}
          <div className="devcall-wrap">
            <span className="devcall-arrow">◀</span>
            <a
              className="btn btn-devcall"
              href="https://wa.me/6285122344606"
              target="_blank"
              rel="noreferrer"
            >
              HUB DEV
            </a>
          </div>

          {/* Music button - far right */}
          <button
            className={`music-btn ${musicPlaying ? 'playing' : ''}`}
            type="button"
            onClick={toggleMusic}
            data-tooltip={musicPlaying ? 'Matikan Musik' : 'Nyalakan Musik'}
            aria-label="Toggle musik"
          >
            <span className="music-bars" aria-hidden="true">
              <span/><span/><span/><span/>
            </span>
          </button>
        </div>
      </header>

      <main className={lainnyaOpen ? 'lainnya-mode' : ''}>
        <section className="hero section" id="beranda">
          <div className="section-bg-text">ANIME</div>
          <div className="hero-content fade-section">
            <div className="tagline">Anime · Manga · Novel · Game</div>
            <h1>
              KYOKO <span>/</span> MD
            </h1>
            <p className="subtitle">Streaming · Community · Bot WhatsApp</p>
            <p className="description">
              Nonton anime, baca manga & novel, main RPG, dan terhubung dengan komunitas. Semua dalam satu aplikasi.
            </p>
            <div className="hero-actions">
              {!pwaInstalled && deferredPrompt && (
                <button className="btn btn-install" onClick={handleInstall}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight:6}}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Install App
                </button>
              )}
              {pwaInstalled && (
                <div className="btn-installed">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight:5}}><polyline points="20 6 9 17 4 12"/></svg>
                  Sudah Terinstall
                </div>
              )}
            </div>
            <div className="visitor-counter">
              <span className="visitor-icon">👥</span>
              <span className="visitor-number">{visitorCount}</span>
              <span className="visitor-label">Pengunjung</span>
            </div>

            {/* ── Login Banner ── */}
            {!authUser ? (
              <div style={{
                marginTop: 28,
                background: 'linear-gradient(135deg, rgba(163,230,53,0.12) 0%, rgba(163,230,53,0.04) 100%)',
                border: '1px solid rgba(163,230,53,0.3)',
                borderRadius: 20,
                padding: '20px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:24}}>💬</span>
                  <div>
                    <div style={{fontWeight:800,fontSize:15,color:'#a3e635',letterSpacing:0.5}}>GLOBAL CHAT & RPG</div>
                    <div style={{fontSize:12,opacity:0.6,marginTop:2}}>Login untuk akses chat, battle RPG, gacha & fishing!</div>
                  </div>
                </div>
                <button
                  onClick={handleLoginClick}
                  style={{
                    padding: '13px 0',
                    borderRadius: 999,
                    background: 'linear-gradient(135deg, #a3e635, #84cc16)',
                    color: '#000',
                    fontWeight: 800,
                    fontSize: 14,
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    letterSpacing: 0.5,
                    boxShadow: '0 4px 20px rgba(163,230,53,0.3)',
                  }}
                >
                  <img src="https://www.google.com/favicon.ico" width={16} height={16} alt="G" style={{borderRadius:3}}/>
                  LOGIN DENGAN GOOGLE — GRATIS
                </button>
                <div style={{display:'flex',gap:16,justifyContent:'center'}}>
                  {['🗨️ Chat Global','⚔️ Battle RPG','🎣 Fishing','✨ Gacha'].map(f => (
                    <span key={f} style={{fontSize:11,opacity:0.5}}>{f}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{
                marginTop: 28,
                background: 'rgba(163,230,53,0.08)',
                border: '1px solid rgba(163,230,53,0.2)',
                borderRadius: 20,
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <img src={authUser.photoURL || ''} width={36} height={36} style={{borderRadius:'50%',border:'2px solid #a3e635'}} alt="" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}}/>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:'#a3e635'}}>Halo, {authUser.displayName?.split(' ')[0] || 'User'}! 👋</div>
                    <div style={{fontSize:11,opacity:0.5}}>Kamu sudah login</div>
                  </div>
                </div>
                <button
                  onClick={() => { setGcUnread(false); setGcOpen(true) }}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 999,
                    background: 'linear-gradient(135deg,#a3e635,#84cc16)',
                    color: '#000',
                    fontWeight: 800,
                    fontSize: 12,
                    border: 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Buka Chat →
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Anime Info Section ── */}
        <section className="section fade-section" style={{ paddingTop: 0 }}>
          <AnimeHeroSection />
        </section>

        {/* ── Manga Info Section ── */}
        <section className="section fade-section" style={{ paddingTop: 0 }}>
          <MangaInfoSection />
        </section>

        {/* ── Tutorial Modal setelah login ── */}
        {showLoginTutorial && (
          <div style={{
            position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,
            display:'flex',alignItems:'center',justifyContent:'center',padding:24,
          }} onClick={() => { setShowLoginTutorial(false); setGcOpen(true) }}>
            <div style={{
              background:'#111',border:'1px solid rgba(163,230,53,0.4)',borderRadius:24,
              padding:'32px 28px',maxWidth:340,width:'100%',textAlign:'center',
              boxShadow:'0 0 60px rgba(163,230,53,0.15)',
            }} onClick={e => e.stopPropagation()}>
              <div style={{fontSize:52,marginBottom:12}}>🎉</div>
              <div style={{fontWeight:900,fontSize:20,color:'#a3e635',marginBottom:8}}>Login Berhasil!</div>
              <div style={{fontSize:13,opacity:0.6,lineHeight:1.6,marginBottom:24}}>
                Sekarang kamu bisa akses <b style={{color:'#fff'}}>Global Chat</b>, main <b style={{color:'#fff'}}>RPG Battle</b>, <b style={{color:'#fff'}}>Gacha</b>, <b style={{color:'#fff'}}>Fishing</b> dan masih banyak lagi!
              </div>
              <div style={{
                background:'rgba(163,230,53,0.08)',borderRadius:16,padding:'16px',
                marginBottom:20,border:'1px solid rgba(163,230,53,0.15)',
              }}>
                <div style={{fontSize:12,opacity:0.5,marginBottom:10}}>Cara masuk Global Chat:</div>
                <div style={{display:'flex',alignItems:'center',gap:10,justifyContent:'center'}}>
                  <div style={{background:'#a3e635',borderRadius:999,width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>💬</div>
                  <div style={{fontSize:12,opacity:0.7,textAlign:'left'}}>Klik tombol <b style={{color:'#a3e635'}}>FAB</b> di pojok kanan bawah → pilih <b style={{color:'#a3e635'}}>Global Chat</b></div>
                </div>
              </div>
              <button
                onClick={() => { setShowLoginTutorial(false); setGcOpen(true) }}
                style={{
                  width:'100%',padding:'14px',borderRadius:999,
                  background:'linear-gradient(135deg,#a3e635,#84cc16)',
                  color:'#000',fontWeight:900,fontSize:14,border:'none',cursor:'pointer',
                  boxShadow:'0 4px 20px rgba(163,230,53,0.4)',
                }}
              >
                🚀 Buka Global Chat Sekarang!
              </button>
              <div style={{fontSize:11,opacity:0.3,marginTop:12}}>Otomatis masuk dalam 3 detik...</div>
            </div>
          </div>
        )}

        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">
            <span>ANIME STREAM · MANGA READ · LIGHT NOVEL · RPG BATTLE · GACHA · FISHING · GLOBAL CHAT · TOP ANIME · </span>
            <span>ANIME STREAM · MANGA READ · LIGHT NOVEL · RPG BATTLE · GACHA · FISHING · GLOBAL CHAT · TOP ANIME · </span>
          </div>
        </div>

        <div className="film-divider" aria-hidden="true" />

        {/* ── Anime Quick Feature Cards (HOME only) ─────────────────── */}
        {!lainnyaOpen && (
          <section className="section fade-section" id="anime-features">
            <div className="section-bg-text">STREAM</div>
            <div className="section-header">
              <h2>Fitur Utama</h2>
              <p>Akses streaming anime, manga, novel, dan game favorit kamu langsung dari sini.</p>
            </div>
            <div className="anime-feature-grid">
              {[
                { key:'anime', label:'AnimeStream', desc:'Nonton anime sub/dub gratis', color:'#c084fc', emoji:'▶' },
                { key:'manga', label:'MangaStream', desc:'Baca manga & manhwa', color:'#f472b6', emoji:'📖' },
                { key:'novel', label:'KyoNovel', desc:'Light novel & web novel', color:'#fb923c', emoji:'📚' },
                { key:'rpg',   label:'RPG Game',   desc:'Battle, gacha & fishing', color:'#facc15', emoji:'⚔️' },
                { key:'globalchat', label:'Global Chat', desc:'Chat bareng komunitas', color:'#a3e635', emoji:'💬' },
                { key:'ai',    label:'KyokoAI',    desc:'Tanya AI assistant', color:'#38bdf8', emoji:'🤖' },
              ].map(f => (
                <div key={f.key} className="anime-feat-card" style={{ '--feat-color': f.color } as React.CSSProperties}>
                  <div className="anime-feat-emoji" style={{ color: f.color }}>{f.emoji}</div>
                  <div className="anime-feat-label">{f.label}</div>
                  <div className="anime-feat-desc">{f.desc}</div>
                  <div className="anime-feat-glow" />
                </div>
              ))}
            </div>
            <div className="anime-feat-note">
              Buka via tombol <strong style={{color:'#c8f500'}}>+</strong> di tengah navbar untuk mulai streaming!
            </div>
          </section>
        )}

        {/* ── Community sections (lainnya-mode only) ─────────────────── */}
        <div className={`lainnya-sections-wrap ${lainnyaOpen ? 'lainnya-sections-visible' : 'lainnya-sections-hidden'}`}>

        <section className="section fade-section" id="direktori-grup">
          <div className="section-number">05</div>
          <div
            key={groupBgKey}
            className={`section-bg-text section-bg-text-anim section-bg-text-${groupBgDir}`}
          >
            {groupCategories[groupBgText].toUpperCase()}
          </div>
          <div className="section-header">
            <h2>Direktori Grup</h2>
            <p>Temukan grup komunitas sesuai minat. Tambahkan grup milikmu untuk terhubung dengan lebih banyak teman.</p>
          </div>
          <div className="group-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setGroupForm((prev) => ({ ...prev, category: activeCategory }))
                setIsModalOpen(true)
              }}
            >
              Tambah Grup
            </button>
            <div className="group-nav">
              <button className="group-nav-btn" onClick={() => handleGroupNav('left')} aria-label="Sebelumnya">
                ←
              </button>
              <button className="group-nav-btn" onClick={() => handleGroupNav('right')} aria-label="Berikutnya">
                →
              </button>
            </div>
          </div>
          <div className="group-search">
            <input
              type="search"
              placeholder="Cari grup berdasarkan nama atau kategori..."
              value={groupSearch}
              onChange={(event) => setGroupSearch(event.target.value)}
            />
          </div>
          {groupSearch.trim() ? (
            <div className="group-results">
              {filteredGroups.length ? (
                filteredGroups.map((group, index) => (
                  <a className="group-card" key={`${group.name}-${index}`} href={group.link} target="_blank" rel="noreferrer">
                    <div className="card-title">{group.name}</div>
                    <div className="card-desc">{group.desc}</div>
                    <div className="group-tag">{group.category}</div>
                    <div className={`group-expire ${getDaysLeft(group.createdAt) <= 7 ? 'warn' : ''}`}>
                      Kedaluwarsa dalam {getDaysLeft(group.createdAt)} hari
                    </div>
                    <button
                      className="group-renew"
                      type="button"
                      onClick={(event) => {
                        event.preventDefault()
                        handleRenewGroup(group.link)
                      }}
                    >
                      Perbarui
                    </button>
                  </a>
                ))
              ) : (
                <div className="group-empty">Grup tidak ditemukan</div>
              )}
            </div>
          ) : (
            <div className={`group-carousel ${groupSlideDirection}`}>
              <div className="group-category">
                <div className="group-title active">{activeCategory}</div>
                <div className="group-list group-list-scroll">
                  {(groups[activeCategory] || []).length ? (
                    (groups[activeCategory] || []).map((group, index) => (
                      <a className="group-card" key={`${group.name}-${index}`} href={group.link} target="_blank" rel="noreferrer">
                        <div className="card-title">{group.name}</div>
                        <div className="card-desc">{group.desc}</div>
                        <div className={`group-expire ${getDaysLeft(group.createdAt) <= 7 ? 'warn' : ''}`}>
                          Kedaluwarsa dalam {getDaysLeft(group.createdAt)} hari
                        </div>
                        <button
                          className="group-renew"
                          type="button"
                          onClick={(event) => {
                            event.preventDefault()
                            handleRenewGroup(group.link)
                          }}
                        >
                          Perbarui
                        </button>
                      </a>
                    ))
                  ) : (
                    <div className="group-empty">Belum ada grup di kategori ini.</div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="group-indicator">
            {activeCategory.toUpperCase()} ({activeGroupIndex + 1}/{groupCategories.length})
          </div>
        </section>

        <section className="section fade-section" id="jual-beli-akun">
          <div className="section-number">06</div>
          <div className="section-bg-text">MARKET</div>
          <div className="section-header">
            <h2>Jual Beli Akun</h2>
            <p>Marketplace akun game komunitas. Siapa pun bisa upload dan berjualan. Semua listing menunggu persetujuan admin sebelum tampil.</p>
          </div>

          {/* Status success after submit */}
          {jualBeliFormStatus === 'success' && (
            <div className="jb-submit-success">
              <span>✅ Listing berhasil dikirim! Menunggu persetujuan admin.</span>
            </div>
          )}

          {/* Game category tabs */}
          <div className="jb-game-tabs">
            {jualBeliGames.map(g => (
              <button
                key={g}
                className={`jb-game-tab ${jualBeliGame === g ? 'active' : ''}`}
                onClick={() => setJualBeliGame(g)}
                type="button"
              >{g}</button>
            ))}
          </div>

          <div className="jb-actions">
            <button className="btn btn-primary" onClick={() => setJualBeliModalOpen(true)} type="button">
              + Jual Akun
            </button>
            {isAdmin && (
              <>
                <button className="btn btn-secondary" onClick={() => setAdminMMModalOpen(true)} type="button">
                  ⚙ Tambah Middleman
                </button>
                <div className="jb-admin-tabs">
                  <button className={`jb-admin-tab ${jualBeliAdminTab==='pending'?'active':''}`} onClick={() => setJualBeliAdminTab('pending')} type="button">
                    Pending ({jualBeliItems.filter(i=>i.status==='pending').length})
                  </button>
                  <button className={`jb-admin-tab ${jualBeliAdminTab==='approved'?'active':''}`} onClick={() => setJualBeliAdminTab('approved')} type="button">
                    Approved
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Admin pending list */}
          {isAdmin && jualBeliAdminTab === 'pending' && (
            <div className="jb-pending-list">
              {jualBeliItems.filter(i=>i.status==='pending').length === 0 && (
                <div className="group-empty">Tidak ada listing pending.</div>
              )}
              {jualBeliItems.filter(i=>i.status==='pending').map(item => (
                <div className="jb-pending-card" key={item.id}>
                  <div className="jb-pending-info">
                    <span className="jb-pending-game">{item.game}</span>
                    <span className="jb-pending-name">{item.namaAkun}</span>
                    <span className="jb-pending-price">Rp {item.harga}</span>
                    <span className="jb-pending-phone">{item.noHp}</span>
                  </div>
                  <div className="jb-pending-actions">
                    <button className="btn btn-primary" onClick={() => handleJualBeliApprove(item.id)} type="button">✓ Approve</button>
                    <button className="btn btn-secondary" onClick={() => handleJualBeliReject(item.id)} type="button">✕ Tolak</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Public listing grid */}
          {(!isAdmin || jualBeliAdminTab === 'approved') && (() => {
            const shown = jualBeliItems.filter(i => (i.status === 'approved' || i.status === 'sold') && i.game === jualBeliGame)
            return (
              <div className="jb-grid">
                {shown.length === 0 && (
                  <div className="group-empty">Belum ada akun {jualBeliGame} yang dijual.</div>
                )}
                {shown.map(item => (
                  <div className={`jb-card ${item.status === 'sold' ? 'jb-card-sold' : ''}`} key={item.id}>
                    {isAdmin && (
                      <div style={{display:'flex',gap:4,position:'absolute',top:8,right:8,zIndex:3}}>
                        {item.status !== 'sold' && (
                          <button className="jb-card-sold-btn" onClick={() => handleJbAdminMarkSold(item.id)} type="button" title="Tandai Terjual">✓</button>
                        )}
                        <button className="jb-card-delete" onClick={() => handleJualBeliReject(item.id)} type="button" title="Hapus">✕</button>
                      </div>
                    )}
                    {item.status === 'sold' && (
                      <div className="jb-sold-overlay">
                        <div className="jb-sold-stamp">TERJUAL</div>
                      </div>
                    )}
                    <div className="jb-card-img-wrap">
                      <img src={item.gambar} alt={item.namaAkun} className="jb-card-img"
                        onError={e => { (e.currentTarget as HTMLImageElement).src = 'https://placehold.co/300x160/111/c8f500?text=NO+IMG' }}
                      />
                      <div className="jb-card-game-badge">{item.game}</div>
                    </div>
                    <div className="jb-card-body">
                      <div className="jb-card-name">{item.namaAkun}</div>
                      <div className="jb-card-desc">{item.deskripsi}</div>
                      <div className="jb-card-price">Rp {item.harga}</div>
                      {item.status !== 'sold' ? (
                        <>
                          <button
                            className="btn btn-primary jb-card-contact"
                            onClick={() => openJualBeliWarn({ id: item.id, noHp: item.noHp, game: item.game, namaAkun: item.namaAkun })}
                            type="button"
                          >
                            📞 Hubungi Penjual
                          </button>
                          <button
                            className="jb-card-seller-sold"
                            onClick={() => { setJbSoldItem({id:item.id,noHp:item.noHp,namaAkun:item.namaAkun}); setJbSoldInput(''); setJbSoldErr(''); setJbSoldModalOpen(true) }}
                            type="button"
                          >
                            Sudah Terjual? Tandai
                          </button>
                        </>
                      ) : (
                        <div className="jb-card-sold-label">Akun ini sudah terjual</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </section>

        <section className="section fade-section" id="apk-mod">
          <div className="section-number">09</div>
          <div key={apkBgKey} className={`section-bg-text section-bg-text-anim section-bg-text-${apkBgDir}`}>
            {apkBgLabels[apkTab] || 'APKMOD'}
          </div>
          <div className="section-header">
            <h2>APK Mod & ScBot</h2>
            <p>Kumpulan APK dan ScBot pilihan dari KyokoMd.</p>
          </div>
          {isAdmin && (
            <div className="apk-admin-bar">
              <button className="btn btn-primary" onClick={() => setUploadModal('apk')}>+ Upload APK</button>
              <button className="btn btn-primary" onClick={() => setUploadModal('free')}>+ Upload ScBot Free</button>
              <button className="btn btn-primary" onClick={() => setUploadModal('premium')}>+ Upload ScBot Premium</button>
            </div>
          )}
          {/* ── Tab buttons + search slide-out ─────────────────────── */}
          <div className="apk-tabs-wrap">
            {/* APK MOD tab */}
            <div className="apk-tab-group">
              <button
                className={`apk-tab-btn ${apkTab === 'apk' ? 'active' : ''}`}
                onClick={() => handleApkTab('apk')}
              >🎮 APK MOD</button>
              {apkTab === 'apk' && (
                <button className="apk-search-icon-btn" onClick={() => setApkSearchOpen(p => !p)} type="button" title="Cari APK">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
              )}
              {apkTab === 'apk' && apkSearchOpen && (
                <input
                  className="apk-search-input"
                  type="text"
                  placeholder="Cari APK..."
                  value={apkSearch}
                  onChange={e => setApkSearch(e.target.value)}
                  autoFocus
                />
              )}
            </div>
            {/* SCBOT FREE tab */}
            <div className="apk-tab-group">
              <button
                className={`apk-tab-btn ${apkTab === 'free' ? 'active' : ''}`}
                onClick={() => handleApkTab('free')}
              >🤖 SCBOT FREE</button>
              {apkTab === 'free' && (
                <button className="apk-search-icon-btn" onClick={() => setFreeSearchOpen(p => !p)} type="button" title="Cari ScBot Free">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
              )}
              {apkTab === 'free' && freeSearchOpen && (
                <input
                  className="apk-search-input"
                  type="text"
                  placeholder="Cari ScBot Free..."
                  value={freeSearch}
                  onChange={e => setFreeSearch(e.target.value)}
                  autoFocus
                />
              )}
            </div>
            {/* SCBOT PREMIUM tab */}
            <div className="apk-tab-group">
              <button
                className={`apk-tab-btn ${apkTab === 'premium' ? 'active' : ''}`}
                onClick={() => handleApkTab('premium')}
              >⭐ SCBOT PREMIUM</button>
              {apkTab === 'premium' && (
                <button className="apk-search-icon-btn" onClick={() => setPremiumSearchOpen(p => !p)} type="button" title="Cari ScBot Premium">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
              )}
              {apkTab === 'premium' && premiumSearchOpen && (
                <input
                  className="apk-search-input"
                  type="text"
                  placeholder="Cari ScBot Premium..."
                  value={premiumSearch}
                  onChange={e => setPremiumSearch(e.target.value)}
                  autoFocus
                />
              )}
            </div>
          </div>

          {/* ── Category chips ─────────────────────────────────── */}
          {apkTab === 'apk' && (
            <div className="apk-cat-chips">
              {['Semua', ...apkCategories].map(cat => (
                <button key={cat} className={`apk-cat-chip ${apkCategory === cat ? 'active' : ''}`} onClick={() => setApkCategory(cat)} type="button">
                  {cat === 'Game' ? '🎮' : cat === 'Sosmed' ? '📱' : cat === 'AI' ? '🤖' : cat === 'Lainnya' ? '📦' : '✨'} {cat}
                </button>
              ))}
            </div>
          )}


          {/* ── APK List ───────────────────────────────────────── */}
          {apkTab === 'apk' && (() => {
            const q = apkSearch.toLowerCase()
            const shown = apkList.filter(item =>
              (apkCategory === 'Semua' || (item as any).category === apkCategory) &&
              (!q || item.name.toLowerCase().includes(q) || item.desc?.toLowerCase().includes(q))
            )
            return (
              <div className="apk-list apk-list-scroll">
                {shown.length === 0 && <div className="group-empty">Belum ada APK tersedia saat ini.</div>}
                {shown.map((item, i) => (
                  <div className="apk-card" key={item.id}>
                    {isAdmin && (
                      <div className="apk-dots-wrap">
                        <button className="apk-dots" onClick={() => setMenuDots(menuDots === `apk-${i}` ? null : `apk-${i}`)}>⋮</button>
                        {menuDots === `apk-${i}` && (
                          <div className="apk-dots-menu"><button onClick={() => handleDelete('apk', apkList.indexOf(item))}>🗑 Hapus</button></div>
                        )}
                      </div>
                    )}
                    {(item as any).category && <div className="apk-cat-badge">{(item as any).category === 'Game' ? '🎮' : (item as any).category === 'Sosmed' ? '📱' : (item as any).category === 'AI' ? '🤖' : '📦'} {(item as any).category}</div>}
                    <div className="apk-name">{item.name}</div>
                    {item.version && <div className="apk-version">v{item.version}</div>}
                    {item.desc && <div className="apk-desc">{item.desc}</div>}
                    <a className="btn btn-primary" href={item.link} target="_blank" rel="noreferrer">DOWNLOAD</a>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* ── ScBot Free List ────────────────────────────────── */}
          {apkTab === 'free' && (() => {
            const q = freeSearch.toLowerCase()
            const shown = scbotFreeList.filter(item =>
              (!q || item.name.toLowerCase().includes(q) || item.desc?.toLowerCase().includes(q))
            )
            return (
              <div className="apk-list apk-list-scroll">
                {shown.length === 0 && <div className="group-empty">Belum ada ScBot Free tersedia saat ini.</div>}
                {shown.map((item, i) => (
                  <div className="apk-card" key={item.id}>
                    {isAdmin && (
                      <div className="apk-dots-wrap">
                        <button className="apk-dots" onClick={() => setMenuDots(menuDots === `free-${i}` ? null : `free-${i}`)}>⋮</button>
                        {menuDots === `free-${i}` && (
                          <div className="apk-dots-menu"><button onClick={() => handleDelete('free', scbotFreeList.indexOf(item))}>🗑 Hapus</button></div>
                        )}
                      </div>
                    )}
                    {(item as any).category && <div className="apk-cat-badge">{(item as any).category === 'Game' ? '🎮' : (item as any).category === 'Utility' ? '🔧' : (item as any).category === 'Fun' ? '🎉' : '📦'} {(item as any).category}</div>}
                    <div className="apk-name">{item.name}</div>
                    {item.version && <div className="apk-version">v{item.version}</div>}
                    {item.desc && <div className="apk-desc">{item.desc}</div>}
                    <a className="btn btn-primary" href={item.link} target="_blank" rel="noreferrer">DOWNLOAD</a>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* ── ScBot Premium List ─────────────────────────────── */}
          {apkTab === 'premium' && (() => {
            const q = premiumSearch.toLowerCase()
            const shown = scbotPremiumList.filter(item =>
              (!q || item.name.toLowerCase().includes(q) || item.desc?.toLowerCase().includes(q))
            )
            return (
              <div className="apk-list apk-list-scroll">
                {shown.length === 0 && <div className="group-empty">Belum ada ScBot Premium tersedia saat ini.</div>}
                {shown.map((item, i) => (
                  <div className="apk-card" key={item.id}>
                    {isAdmin && (
                      <div className="apk-dots-wrap">
                        <button className="apk-dots" onClick={() => setMenuDots(menuDots === `prem-${i}` ? null : `prem-${i}`)}>⋮</button>
                        {menuDots === `prem-${i}` && (
                          <div className="apk-dots-menu"><button onClick={() => handleDelete('premium', scbotPremiumList.indexOf(item))}>🗑 Hapus</button></div>
                        )}
                      </div>
                    )}
                    {(item as any).category && <div className="apk-cat-badge">{(item as any).category === 'Game' ? '🎮' : (item as any).category === 'Utility' ? '🔧' : (item as any).category === 'Fun' ? '🎉' : '📦'} {(item as any).category}</div>}
                    <div className="apk-name">{item.name}</div>
                    {item.version && <div className="apk-version">v{item.version}</div>}
                    {item.desc && <div className="apk-desc">{item.desc}</div>}
                    {(item as any).price && <div className="apk-price">💰 {(item as any).price}</div>}
                    <div className="apk-btns">
                      {item.waLink && (
                        <a className="btn apk-buy-btn" href={item.waLink} target="_blank" rel="noreferrer">💬 BELI VIA WA</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </section>

        <section className="section fade-section" id="kirim-masukan">
          <div className="section-number">10</div>
          <div className="section-bg-text">RATING</div>
          <div className="section-header">
            <h2>Rating & Ulasan</h2>
            <p>Berikan rating dan ulasanmu untuk KyokoMd. Bantu kami berkembang lebih baik!</p>
          </div>

          {/* Rating summary */}
          {ratings.length > 0 && (
            <div className="rating-summary">
              <div className="rating-avg">
                {(ratings.reduce((s, r) => s + r.star, 0) / ratings.length).toFixed(1)}
              </div>
              <div className="rating-summary-right">
                <div className="rating-stars-display">
                  {[1,2,3,4,5].map(s => (
                    <span key={s} className={s <= Math.round(ratings.reduce((acc, r) => acc + r.star, 0) / ratings.length) ? 'star-filled' : 'star-empty'}>★</span>
                  ))}
                </div>
                <div className="rating-count">{ratings.length} ulasan</div>
                {/* Bar chart per bintang */}
                <div className="rating-bars">
                  {[5,4,3,2,1].map(s => {
                    const count = ratings.filter(r => r.star === s).length
                    const pct = ratings.length ? (count / ratings.length) * 100 : 0
                    return (
                      <div className="rating-bar-row" key={s}>
                        <span>{s}★</span>
                        <div className="rating-bar-track"><div className="rating-bar-fill" style={{width: `${pct}%`}} /></div>
                        <span>{count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Form beri rating */}
          <div className="rating-form-wrap">
            <h3 className="rating-form-title">Tulis Ulasan</h3>
            <div className="rating-star-input">
              {[1,2,3,4,5].map(s => (
                <button
                  key={s}
                  className={`star-btn ${s <= (ratingHover || ratingForm.star) ? 'star-active' : ''}`}
                  onMouseEnter={() => setRatingHover(s)}
                  onMouseLeave={() => setRatingHover(0)}
                  onClick={() => setRatingForm(p => ({...p, star: s}))}
                  type="button"
                >★</button>
              ))}
            </div>
            <input
              className="rating-input"
              type="text"
              placeholder="Nama kamu"
              value={ratingForm.name}
              onChange={e => setRatingForm(p => ({...p, name: e.target.value}))}
            />
            <textarea
              className="rating-input"
              placeholder="Tulis ulasanmu (opsional)"
              value={ratingForm.comment}
              onChange={e => setRatingForm(p => ({...p, comment: e.target.value}))}
              rows={3}
            />
            <button className="btn btn-primary" onClick={handleRatingSubmit} type="button">
              Kirim Ulasan
            </button>
            {ratingStatus === 'success' && <p className="form-status success">Ulasan berhasil dikirim! Terima kasih.</p>}
          </div>

          {/* List ulasan — 3 teratas + tombol filter kategori */}
          {(() => {
            const filtered = ratingFilter ? ratings.filter(r => r.star === ratingFilter) : ratings
            const showFilterBtn = ratings.length > 3
            return (
              <>
                <div className="rating-list rating-list-scroll">
                  {filtered.length === 0 && (
                    <div className="group-empty">Belum ada ulasan bintang {ratingFilter} saat ini.</div>
                  )}
                  {filtered.map((r) => (
                    <div className="rating-card" key={r.id}>
                      {isAdmin && (
                        <button className="rating-delete-btn" onClick={() => handleDeleteRating(r.id)} title="Hapus">✕</button>
                      )}
                      <div className="rating-card-top">
                        <span className="rating-card-name">{r.name}</span>
                        <span className="rating-card-stars">
                          {[1,2,3,4,5].map(s => <span key={s} className={s <= r.star ? 'star-filled' : 'star-empty'}>★</span>)}
                        </span>
                      </div>
                      {r.comment && <p className="rating-card-comment">{r.comment}</p>}
                    </div>
                  ))}
                </div>

                {/* filter bubble */}
                <div className="rating-more-wrap">
                  <div className="rating-more-row">
                    {showFilterBtn && (
                      <button
                        className="rating-more-btn"
                        onClick={() => setRatingBubbleOpen(p => !p)}
                        type="button"
                      >
                        {ratingFilter ? `Filter: Bintang ${ratingFilter} ★` : `Filter ★`}
                        <span className={`rating-more-arrow ${ratingBubbleOpen ? 'open' : ''}`}>▾</span>
                      </button>
                    )}
                    {ratingBubbleOpen && (
                      <div className="rating-bubble">
                        <button className={`rb-item ${!ratingFilter ? 'rb-active' : ''}`} onClick={() => { setRatingFilter(null); setRatingBubbleOpen(false) }} type="button">Semua ★</button>
                        {[5,4,3,2,1].map(s => (
                          <button key={s} className={`rb-item ${ratingFilter === s ? 'rb-active' : ''}`} onClick={() => { setRatingFilter(s); setRatingBubbleOpen(false) }} type="button">{s} ★ ({ratings.filter(r => r.star === s).length})</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )
          })()}
        </section>
        </div>{/* end lainnya-sections-wrap */}

        <section className="section fade-section" id="rekomendasi-game">
          <div className="section-number">07</div>
          <div className="section-bg-text">GAMES</div>
          <div className="section-header">
            <h2>Rekomendasi Game</h2>
            <p>Pilihan game favorit komunitas. Pilih genre dan langsung menuju Play Store.</p>
          </div>
          <div className="genre-tabs">
            {(['RPG', 'MOBA', 'FPS'] as const).map((genre) => (
              <button key={genre} className={`genre-btn ${activeGenre === genre ? 'active' : ''}`} onClick={() => setActiveGenre(genre)}>
                {genre}
              </button>
            ))}
          </div>
          <div className="card-grid">
            {gameData[activeGenre].map((game) => (
              <div className="game-card" key={game.name}>
                <div className="card-title">{game.name}</div>
                <a className="btn btn-secondary" href={game.link} target="_blank" rel="noreferrer">
                  Download
                </a>
              </div>
            ))}
          </div>
        </section>

        <div className="film-divider" aria-hidden="true" />

        <section className="section fade-section" id="berita-game">
          <div className="section-number">08</div>
          <div className="section-bg-text">NEWS</div>
          <div className="section-header">
            <h2>BERITA GAME</h2>
            <p className="section-tag">Update Terbaru</p>
            <p>Berita dan update terbaru seputar game favoritmu</p>
          </div>
          <div className="news-actions">
            <div className="news-filters">
              {['Semua', 'Genshin', 'Mobile Legends', 'Free Fire', 'Wuthering Waves'].map((filter) => (
                <button
                  key={filter}
                  className={`news-filter ${newsFilter === filter ? 'active' : ''}`}
                  onClick={() => setNewsFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
          <div className="news-track">
            {filteredNews.length === 0 && <div className="news-empty">Berita tidak tersedia saat ini. Coba lagi nanti.</div>}
            {filteredNews.length > 0 && (
              <div className="news-scroll">
                {filteredNews.map((item, index) => (
                  <article key={`${item.title}-${index}`} className="news-card" style={{ animationDelay: `${0.1 * index}s` }}>
                    <div className="news-thumb">
                      {typeof item.image === 'string' && item.image.startsWith('http') ? (
                        <img
                          src={item.image}
                          alt={item.title}
                          onError={(event) => {
                            const target = event.currentTarget
                            target.style.display = 'none'
                            const parent = target.parentElement
                            if (parent && !parent.querySelector('.news-placeholder')) {
                              const placeholder = document.createElement('div')
                              placeholder.className = 'news-placeholder'
                              const span = document.createElement('span')
                              span.textContent = gameEmoji[item.game] || gameEmoji.default
                              placeholder.appendChild(span)
                              parent.appendChild(placeholder)
                            }
                          }}
                        />
                      ) : (
                        <div className="news-placeholder">
                          <span>{gameEmoji[item.game] || gameEmoji.default}</span>
                        </div>
                      )}
                    </div>
                    <div className="news-source">{item.source}</div>
                    <div className="news-title">{item.title}</div>
                    <div className="news-desc">
                      {(item.description || '').slice(0, 60)}{(item.description || '').length > 60 ? '...' : ''}
                    </div>
                    <div className="news-footer">
                      <span className="news-date">{formatDate(item.date)}</span>
                      <a className="btn btn-secondary" href={item.url} target="_blank" rel="noreferrer">
                        Baca
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-logo">
          <span className="logo-mark">K</span>
          <div>
            <div className="logo-title">KyokoMd</div>
            <div className="logo-sub">Kyoko App · Official</div>
          </div>
        </div>
        <div className="socials">
          <a
            href="https://saweria.co/YukiDesu/toko-top-up"
            target="_blank"
            rel="noreferrer"
            aria-label="Top-Up Shop"
            data-tooltip="Top-Up Shop"
          >
            🛒
          </a>
          <a href="https://youtube.com/@ryuukikojo" target="_blank" rel="noreferrer" aria-label="YouTube">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C17.9 5 12 5 12 5s-5.9 0-7.7.3A2.7 2.7 0 0 0 2.4 7.2C2 9 2 12 2 12s0 3 0.4 4.8a2.7 2.7 0 0 0 1.9 1.9C6.1 19 12 19 12 19s5.9 0 7.7-0.3a2.7 2.7 0 0 0 1.9-1.9C22 15 22 12 22 12s0-3-0.4-4.8ZM10 15V9l5 3-5 3Z" />
            </svg>
          </a>
          <a href="https://www.instagram.com/yusha_desuwa" target="_blank" rel="noreferrer" aria-label="Instagram">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm10 2H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-5 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm5.2-3.4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z" />
            </svg>
          </a>
          <a href="https://www.facebook.com/share/1BFS6ndTdF/" target="_blank" rel="noreferrer" aria-label="Facebook">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M13.5 9H16V6h-2.5C11 6 10 7.5 10 9.4V11H8v3h2v7h3v-7h2.4l.6-3H13V9.8c0-.5.2-.8.9-.8Z" />
            </svg>
          </a>
          <a href="https://t.me/kyokomd" target="_blank" rel="noreferrer" aria-label="Telegram">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.9 4.6c.5-.2.9.3.7.8l-3 13.7c-.1.5-.7.7-1.1.4l-4.2-3.1-2 1.9c-.2.2-.6.1-.6-.2l.1-3.4 7.7-7.1c.3-.3-.1-.7-.5-.4l-9.4 5.8-3.7-1.2c-.5-.2-.5-.9 0-1.1l15.9-6.1Z" />
            </svg>
          </a>
        </div>
        <p className="copyright">© 2024 KyokoMd. Powered for the Community.</p>
      </footer>


      {/* ── Global Chat Inline ───────────────────────────────────── */}
      {gcOpen && (
        <React.Suspense fallback={
          <div style={{position:'fixed',inset:0,background:'#080810',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <div style={{color:'#a3e635',fontSize:14}}>Memuat...</div>
          </div>
        }>
          <GlobalChatPanel onClose={() => { setGcOpen(false); setGcInitialTab('chat') }} onUnread={() => setGcUnread(true)} onMusicChange={setGcMiniPlayer} initialTab={gcInitialTab} />
        </React.Suspense>
      )}


      {/* ── GC Mini Music Player floating ────────────────────────── */}
      {gcMiniPlayer && !gcOpen && (
        <div className="gc-mini-player">
          <div className="gc-mini-player-inner">
            <div className="gc-mini-bars" aria-hidden="true">
              <span/><span/><span/><span/>
            </div>
            <div className="gc-mini-title">{gcMiniPlayer.title}</div>
            <button
              className="gc-mini-toggle"
              onClick={() => {
                const audio = gcMiniPlayer.audioRef.current
                if (!audio) return
                if (gcMiniPlayer.playing) {
                  audio.pause()
                  setGcMiniPlayer(p => p ? { ...p, playing: false } : null)
                } else {
                  audio.play().catch(() => {})
                  setGcMiniPlayer(p => p ? { ...p, playing: true } : null)
                }
              }}
              title={gcMiniPlayer.playing ? 'Pause' : 'Play'}
            >
              {gcMiniPlayer.playing
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              }
            </button>
            <button
              className="gc-mini-close"
              onClick={() => { gcMiniPlayer.audioRef.current?.pause(); setGcMiniPlayer(null) }}
              title="Tutup"
            >✕</button>
          </div>
        </div>
      )}

      {/* ── RPG Toast notifications (max 2) ──────────────────────── */}
      {rpgToasts.length > 0 && (
        <div style={{ position:'fixed', bottom:'calc(var(--bottom-nav-h, 70px) + 16px)', right:16, zIndex:9998, display:'flex', flexDirection:'column', gap:8, pointerEvents:'none' }}>
          {rpgToasts.map(t => (
            <div key={t.id} style={{ background:'rgba(8,8,8,0.95)', border:'1px solid rgba(200,245,0,0.3)', borderRadius:12, padding:'8px 14px', fontSize:12, color:'#c8f500', fontWeight:700, boxShadow:'0 4px 20px rgba(0,0,0,0.6)', animation:'rpgToastIn .3s cubic-bezier(.34,1.56,.64,1)' }}>
              {t.msg}
            </div>
          ))}
        </div>
      )}

      {/* ── BottomNav (replaces old FAB) ────────────────────────── */}
      <BottomNav
        onOpenGlobalChat={() => { setGcInitialTab('chat'); setGcUnread(false); setGcOpen(true) }}
        onOpenAI={() => { setAiUnread(false); setChatOpen(true) }}
        onOpenManga={() => { setGcInitialTab('manga'); setGcOpen(true) }}
        onOpenNovel={() => { setGcInitialTab('novel'); setGcOpen(true) }}
        onOpenAnime={() => { setGcInitialTab('anime'); setGcOpen(true) }}
        onOpenRpg={() => { setGcInitialTab('rpg'); setGcOpen(true) }}
        onScrollTo={(id) => {
          triggerZzz('NAVIGATING', () => {
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
        }}
        onLainnyaOpen={() => setLainnyaOpen(true)}
        onLainnyaClose={() => setLainnyaOpen(false)}
        gcUnread={gcUnread}
        aiUnread={aiUnread}
      />

      <div className={`chat-widget ${chatOpen ? 'open' : ''}`}>
        <div className="chat-header">
          <div>
            <div className="chat-title">KyokoAI</div>
            <div className="chat-sub">Powered by Anthropic</div>
          </div>
          <button className="chat-close" onClick={() => { setChatOpen(false); setAiUnread(false) }}>
            ×
          </button>
        </div>
        <div className="chat-body">
          {chatMessages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
              {message.content}
            </div>
          ))}
          {chatLoading && (
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          )}
        </div>
        <div className="chat-input">
          <input
            type="text"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            placeholder="Tulis pesan..."
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleChatSend()
              }
            }}
          />
          <button className="btn btn-primary" onClick={handleChatSend} disabled={chatLoading}>
            Kirim
          </button>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Tambah Grup</div>
                <div className="modal-sub">Masukkan detail grup WhatsApp kamu.</div>
              </div>
              <button className="chat-close" onClick={() => setIsModalOpen(false)}>
                ×
              </button>
            </div>
            <form className="modal-form" onSubmit={handleGroupSubmit}>
              <label>
                <span>Nama Grup</span>
                <input
                  type="text"
                  value={groupForm.name}
                  onChange={(event) => setGroupForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </label>
              <label>
                <span>Link WhatsApp</span>
                <input
                  type="url"
                  value={groupForm.link}
                  onChange={(event) => {
                    setGroupForm((prev) => ({ ...prev, link: event.target.value }))
                    setGroupErrors((prev) => ({ ...prev, link: '' }))
                  }}
                  required
                />
                {groupErrors.link && <span className="input-error">{groupErrors.link}</span>}
              </label>
              <label>
                <span>Kategori</span>
                <select
                  value={groupForm.category}
                  onChange={(event) => setGroupForm((prev) => ({ ...prev, category: event.target.value }))}
                >
                  {groupCategories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Deskripsi Singkat</span>
                <textarea
                  value={groupForm.desc}
                  onChange={(event) => setGroupForm((prev) => ({ ...prev, desc: event.target.value }))}
                  required
                />
              </label>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit">
                  Simpan
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => setIsModalOpen(false)}>
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {adminModalOpen && (
        <div className="modal-overlay" onClick={() => setAdminModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">ADMIN LOGIN</div>
                <div className="modal-sub">Masukkan kredensial admin.</div>
              </div>
              <button className="chat-close" onClick={() => setAdminModalOpen(false)}>×</button>
            </div>
            <div className="modal-form">
              <label><span>Username</span>
                <input type="text" placeholder="Username" value={adminUser} onChange={e => setAdminUser(e.target.value)} />
              </label>
              <label><span>Kode Akses</span>
                <input type="password" placeholder="8 digit kode" value={adminCode} onChange={e => setAdminCode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdminLogin()} />
              </label>
              {adminError && <div className="input-error">{adminError}</div>}
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleAdminLogin}>LOGIN</button>
                <button className="btn btn-secondary" onClick={() => setAdminModalOpen(false)}>Batal</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {uploadModal && (
        <div className="modal-overlay" onClick={() => setUploadModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">
                  {uploadModal === 'apk' ? 'UPLOAD APK' : uploadModal === 'free' ? 'UPLOAD SCBOT FREE' : 'UPLOAD SCBOT PREMIUM'}
                </div>
                <div className="modal-sub">Isi detail file yang akan diupload.</div>
              </div>
              <button className="chat-close" onClick={() => setUploadModal(null)}>×</button>
            </div>
            <div className="modal-form">
              <label><span>Nama</span>
                <input type="text" value={uploadForm.name} onChange={e => setUploadForm(p => ({...p, name: e.target.value}))} required />
              </label>
              {uploadModal === 'apk' && (
                <label><span>Kategori</span>
                  <select value={uploadForm.category} onChange={e => setUploadForm(p => ({...p, category: e.target.value}))}>
                    {['Game','Sosmed','AI','Lainnya'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {uploadModal !== 'premium' && (
                <label><span>Link Download</span>
                  <input type="url" value={uploadForm.link} onChange={e => setUploadForm(p => ({...p, link: e.target.value}))} required />
                </label>
              )}
              {uploadModal === 'premium' && (
                <label><span>Harga / Price</span>
                  <input type="text" placeholder="Contoh: Rp 15.000" value={uploadForm.link} onChange={e => setUploadForm(p => ({...p, link: e.target.value}))} required />
                </label>
              )}
              <label><span>Versi (opsional)</span>
                <input type="text" value={uploadForm.version} onChange={e => setUploadForm(p => ({...p, version: e.target.value}))} />
              </label>
              <label><span>Deskripsi (opsional)</span>
                <textarea value={uploadForm.desc} onChange={e => setUploadForm(p => ({...p, desc: e.target.value}))} />
              </label>
              {uploadModal === 'premium' && (
                <label><span>Link WA Pembelian</span>
                  <input type="url" placeholder="https://wa.me/..." value={uploadForm.waLink} onChange={e => setUploadForm(p => ({...p, waLink: e.target.value}))} />
                </label>
              )}
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleUpload}>UPLOAD</button>
                <button className="btn btn-secondary" onClick={() => setUploadModal(null)}>Batal</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Announcement Notification ─────────────────────────────────── */}
      {announcementActive && announcementText && (
        <div className={`ann-wrap ann-${announcementPosition} ${announcementVisible ? 'ann-visible' : ''}`}>
          <div className="ann-loader-bar" />
          <div className="ann-body">
            <span className="ann-icon">📢</span>
            <span className="ann-text">{announcementText}</span>
            <button className="ann-close" onClick={handleDismissAnnouncement} aria-label="Tutup">×</button>
          </div>
        </div>
      )}

      {/* ── Admin Setting Modal ────────────────────────────────────────── */}
      {adminSettingOpen && (
        <div className="modal-overlay" onClick={() => setAdminSettingOpen(false)}>
          <div className="modal modal-admin-setting" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title" style={{color:'#c8f500'}}>⚙ ADMIN SETTING</div>
                <div className="modal-sub">📢 Broadcast ke semua pengunjung via Firebase.</div>
              </div>
              <button className="chat-close" onClick={() => setAdminSettingOpen(false)}>×</button>
            </div>
            <div className="modal-form">
              <label>
                <span>Teks Broadcast</span>
                <textarea
                  value={announcementText}
                  onChange={e => setAnnouncementText(e.target.value)}
                  placeholder="Ketik pesan broadcast di sini... (semua pengunjung akan melihat)"
                  rows={3}
                />
              </label>
              <label>
                <span>Posisi Notifikasi</span>
                <select value={announcementPosition} onChange={e => setAnnouncementPosition(e.target.value as 'top'|'side')}>
                  <option value="top">Dari Atas</option>
                  <option value="side">Dari Samping</option>
                </select>
              </label>
              <div className="ann-preview-note">💡 Broadcast disimpan ke Firebase — semua pengunjung akan melihat saat buka web (cooldown 5 menit per orang).</div>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleSaveAnnouncement}>📢 BROADCAST SEKARANG</button>
                <button className="btn btn-secondary" onClick={async () => {
                  try {
                    await setDoc(doc(dbAdmin, 'site_config', 'announcement'), { text: '', position: announcementPosition, updatedAt: Date.now() })
                    setAnnouncementText('')
                    setAnnouncementVisible(false)
                    setTimeout(() => setAnnouncementActive(false), 500)
                  } catch {}
                  setAdminSettingOpen(false)
                }}>🗑 Hapus Broadcast</button>
                <button className="btn btn-secondary" onClick={() => setAdminSettingOpen(false)}>Batal</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        className={`scroll-top ${showScrollTop ? 'visible' : ''}`}
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Scroll ke atas"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
        <span className="scroll-top-label">ATAS</span>
      </button>
      <div className={`menu-overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
        <div className="menu-panel" onClick={(event) => event.stopPropagation()}>
          <div className="menu-header">
            <div className="menu-logo">KyokoMd</div>
            <button className="menu-close" type="button" onClick={() => setMenuOpen(false)} aria-label="Tutup menu">
              ×
            </button>
          </div>
          <nav className="menu-items">
            {[
              { label: 'Beranda', id: 'beranda' },
              { label: 'Rekomendasi Game', id: 'rekomendasi-game' },
              { label: 'Berita Game', id: 'berita-game' },
              { label: 'Direktori Grup', id: 'direktori-grup' },
              { label: 'Jual Beli Akun', id: 'jual-beli-akun' },
              { label: 'APK & ScBot', id: 'apk-mod' },
              { label: 'Rating', id: 'kirim-masukan' },
            ].map((item, index) => (
              <button
                key={item.id}
                type="button"
                className="menu-item"
                style={{ transitionDelay: `${0.08 * index}s` }}
                onClick={() => handleMenuClick(item.id)}
              >
                {item.label}
              </button>
            ))}
            {isAdmin && (
              <button
                type="button"
                className="menu-item menu-item-admin"
                style={{ transitionDelay: `${0.08 * 7}s` }}
                onClick={() => { setMenuOpen(false); setAdminSettingOpen(true) }}
              >
                ⚙ Admin Setting
              </button>
            )}
          </nav>
          <a className="menu-cta" href="https://chat.whatsapp.com/BbLtlR1EbviEHDnaUSvGYz" target="_blank" rel="noreferrer">
            GABUNG
          </a>
        </div>
      </div>
      {/* ── Jual Beli Upload Modal ────────────────────────────────────── */}
      {jualBeliModalOpen && (
        <div className="modal-overlay" onClick={() => setJualBeliModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">JUAL AKUN GAME</div>
                <div className="modal-sub">Listing akan menunggu persetujuan admin.</div>
              </div>
              <button className="chat-close" onClick={() => setJualBeliModalOpen(false)}>×</button>
            </div>
            <div className="modal-form">
              <label><span>Game</span>
                <select value={jualBeliForm.game} onChange={e => setJualBeliForm(p => ({...p, game: e.target.value}))}>
                  {jualBeliGames.map(g => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label><span>Nama Akun</span>
                <input type="text" placeholder="Nama / ID akun" value={jualBeliForm.namaAkun} onChange={e => setJualBeliForm(p => ({...p, namaAkun: e.target.value}))} required />
              </label>
              <label><span>URL Gambar (https://...)</span>
                <input type="url" placeholder="https://contoh.com/gambar.jpg" value={jualBeliForm.gambar} onChange={e => { setJualBeliForm(p => ({...p, gambar: e.target.value})); setJualBeliFormErr(p => ({...p, gambar: ''})) }} />
                {jualBeliFormErr.gambar && <span className="input-error">{jualBeliFormErr.gambar}</span>}
              </label>
              <label><span>Deskripsi Akun</span>
                <textarea placeholder="Jelaskan isi akun (rank, skin, dll)" value={jualBeliForm.deskripsi} onChange={e => setJualBeliForm(p => ({...p, deskripsi: e.target.value}))} rows={3} required />
              </label>
              <label><span>Harga (Rupiah)</span>
                <input type="text" placeholder="Contoh: 150000" value={jualBeliForm.harga} onChange={e => setJualBeliForm(p => ({...p, harga: e.target.value}))} required />
              </label>
              <label><span>Nomor WhatsApp (62...)</span>
                <input type="text" placeholder="6281234567890" value={jualBeliForm.noHp} onChange={e => { setJualBeliForm(p => ({...p, noHp: e.target.value})); setJualBeliFormErr(p => ({...p, noHp: ''})) }} />
                {jualBeliFormErr.noHp && <span className="input-error">{jualBeliFormErr.noHp}</span>}
                <span className="input-hint">Wajib format 62xxx (bukan 08xxx)</span>
              </label>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleJualBeliSubmit} type="button">KIRIM LISTING</button>
                <button className="btn btn-secondary" onClick={() => setJualBeliModalOpen(false)} type="button">Batal</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Jual Beli Warning Modal ──────────────────────────────────── */}
      {jualBeliWarnOpen && jualBeliWarnItem && (() => {
        const matchMMs = jualBeliMMList.filter(mm => mm.game === jualBeliWarnItem.game)
        const selectedMMData = jualBeliMMList.find(mm => mm.id === jualBeliSelectedMM)
        return (
          <div className="modal-overlay jb-warn-overlay" onClick={() => { setJualBeliWarnOpen(false); if(jualBeliCooldownRef.current) clearInterval(jualBeliCooldownRef.current) }}>
            <div className="modal jb-warn-modal" onClick={e => e.stopPropagation()}>
              <button className="chat-close jb-warn-close" onClick={() => { setJualBeliWarnOpen(false); if(jualBeliCooldownRef.current) clearInterval(jualBeliCooldownRef.current) }}>×</button>

              <div className="jb-warn-header">
                <div className="jb-warn-icon">⚠️</div>
                <div className="jb-warn-title">PERINGATAN TRANSAKSI</div>
              </div>

              <div className="jb-warn-card">
                <div className="jb-warn-text">
                  Sebelum Melanjutkan Harap Menggunakan <strong>MM (Middle Man)</strong> atau Orang Ketiga untuk Bertransaksi
                </div>
                <div className="jb-warn-sub">
                  Kami tidak bertanggung jawab atas kerugian akibat transaksi langsung tanpa perantara.
                </div>
              </div>

              {/* MM Selector */}
              <div className="jb-mm-section">
                <div className="jb-mm-title">
                  🛡️ Middleman Terverifikasi untuk <span className="jb-mm-game">{jualBeliWarnItem.game}</span>
                </div>
                {matchMMs.length === 0 ? (
                  <div className="jb-mm-empty">Belum ada MM terdaftar untuk game ini.</div>
                ) : (
                  <div className="jb-mm-list">
                    {matchMMs.slice(0, 3).map(mm => (
                      <div
                        key={mm.id}
                        className={`jb-mm-card ${jualBeliSelectedMM === mm.id ? 'selected' : ''} ${mm.verified ? 'verified' : ''}`}
                        onClick={() => setJualBeliSelectedMM(prev => prev === mm.id ? null : mm.id)}
                      >
                        {mm.verified && <div className="jb-mm-verified-badge">✓ REKOMENDASI</div>}
                        <div className="jb-mm-effect" aria-hidden="true" />
                        <div className="jb-mm-name">{mm.nama}</div>
                        <div className="jb-mm-platform">{mm.platform}: <span>{mm.akunResmi}</span></div>
                        <div className="jb-mm-game-tag">{mm.game}</div>
                        {jualBeliSelectedMM === mm.id && (
                          <button
                            className="jb-mm-deselect"
                            onClick={e => { e.stopPropagation(); setJualBeliSelectedMM(null) }}
                            type="button"
                          >✕ Batal pilih</button>
                        )}
                      </div>
                    ))}
                    {matchMMs.length > 3 && (
                      <div className="jb-mm-more">Scroll untuk lihat lebih banyak MM ↓</div>
                    )}
                  </div>
                )}
              </div>

              <div className="jb-warn-footer">
                {jualBeliWarnCooldown > 0 ? (
                  <button className="btn jb-warn-btn-disabled" disabled type="button">
                    Lanjutkan ({jualBeliWarnCooldown}s)
                  </button>
                ) : (
                  <a
                    className="btn btn-primary jb-warn-btn-go"
                    href={`https://wa.me/${jualBeliWarnItem.noHp}?text=${encodeURIComponent(`Halo, saya tertarik dengan akun ${jualBeliWarnItem.namaAkun} (${jualBeliWarnItem.game}) yang anda jual di kyokoapp.netlify.app, apakah masih tersedia?`)}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => { setJualBeliWarnOpen(false) }}
                  >
                    Hubungi Penjual via WA
                  </a>
                )}
                {selectedMMData?.noWa && (
                  <a
                    className="btn btn-secondary jb-warn-btn-mm"
                    href={`https://wa.me/${selectedMMData.noWa}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    💬 Hubungi MM: {selectedMMData.nama}
                  </a>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Admin MM Management Modal ─────────────────────────────────── */}
      {adminMMModalOpen && (
        <div className="modal-overlay" onClick={() => setAdminMMModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title" style={{color:'#c8f500'}}>🛡️ TAMBAH MIDDLEMAN</div>
                <div className="modal-sub">Daftar MM terverifikasi yang akan tampil di warning transaksi.</div>
              </div>
              <button className="chat-close" onClick={() => setAdminMMModalOpen(false)}>×</button>
            </div>
            <div className="modal-form">
              {/* Existing MM list */}
              {jualBeliMMList.length > 0 && (
                <div className="jb-admin-mm-list">
                  <div className="jb-admin-mm-list-title">MM Terdaftar:</div>
                  {jualBeliMMList.map(mm => (
                    <div key={mm.id} className="jb-admin-mm-row">
                      <div>
                        <span className="jb-admin-mm-name">{mm.nama}</span>
                        <span className="jb-admin-mm-tag">{mm.game}</span>
                        {mm.verified && <span className="jb-mm-verified-badge-sm">✓</span>}
                      </div>
                      <button className="jb-admin-mm-del" onClick={() => handleDeleteMM(mm.id)} type="button">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <label><span>Nama</span>
                <input type="text" placeholder="Nama admin/MM" value={mmForm.nama} onChange={e => setMmForm(p => ({...p, nama: e.target.value}))} />
              </label>
              <label><span>Platform</span>
                <select value={mmForm.platform} onChange={e => setMmForm(p => ({...p, platform: e.target.value}))}>
                  {['Facebook','Instagram','Twitter/X','Telegram','TikTok','Lainnya'].map(pl => <option key={pl}>{pl}</option>)}
                </select>
              </label>
              <label><span>Akun Resmi ({mmForm.platform})</span>
                <input type="text" placeholder="Link/username akun resmi" value={mmForm.akunResmi} onChange={e => setMmForm(p => ({...p, akunResmi: e.target.value}))} />
              </label>
              <label><span>No WhatsApp (opsional, 62...)</span>
                <input type="text" placeholder="6281234567890" value={mmForm.noWa} onChange={e => setMmForm(p => ({...p, noWa: e.target.value}))} />
              </label>
              <label><span>Kategori Game</span>
                <select value={mmForm.game} onChange={e => setMmForm(p => ({...p, game: e.target.value}))}>
                  {jualBeliGames.map(g => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label className="jb-mm-toggle-label">
                <span>Status Terverifikasi</span>
                <button
                  className={`jb-mm-toggle ${mmForm.verified ? 'on' : 'off'}`}
                  onClick={() => setMmForm(p => ({...p, verified: !p.verified}))}
                  type="button"
                >
                  {mmForm.verified ? '✓ ON' : '✕ OFF'}
                </button>
              </label>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleAddMM} type="button">TAMBAH MM</button>
                <button className="btn btn-secondary" onClick={() => setAdminMMModalOpen(false)} type="button">Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Seller: Tandai Terjual Modal ─────────────────────────────── */}
      {jbSoldModalOpen && jbSoldItem && (
        <div className="modal-overlay" onClick={() => setJbSoldModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">TANDAI TERJUAL</div>
                <div className="modal-sub">Verifikasi nomor WA kamu sebagai penjual.</div>
              </div>
              <button className="chat-close" onClick={() => setJbSoldModalOpen(false)}>×</button>
            </div>
            <div className="modal-form">
              <div className="jb-sold-info">
                Akun: <strong>{jbSoldItem.namaAkun}</strong>
              </div>
              <label>
                <span>Masukkan nomor WA kamu (62...)</span>
                <input
                  type="text"
                  placeholder="6281234567890"
                  value={jbSoldInput}
                  onChange={e => { setJbSoldInput(e.target.value); setJbSoldErr('') }}
                />
                {jbSoldErr && <span className="input-error">{jbSoldErr}</span>}
                <span className="input-hint">Harus sama dengan nomor yang kamu daftarkan saat upload.</span>
              </label>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleJbMarkSold} type="button">✓ Konfirmasi Terjual</button>
                <button className="btn btn-secondary" onClick={() => setJbSoldModalOpen(false)} type="button">Batal</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ZZZ-style transition overlay */}
      <div className={`zzz-transition-overlay${zzzActive ? ' zzz-active' : ''}`} aria-hidden="true">
        <div className="zzz-slash" />
        <div className="zzz-slash-2" />
        <div className="zzz-slash-out" />
        <div className="zzz-slash-out-2" />
        <div className="zzz-ripple zzz-ripple-1" />
        <div className="zzz-ripple zzz-ripple-2" />
        <div className="zzz-ripple zzz-ripple-3" />
        <div className="zzz-scanlines" />
        <div className="zzz-glitch-r" />
        <div className="zzz-glitch-g" />
        <div className="zzz-glitch-b" />
        <div className="zzz-noise" />
        <div className="zzz-flash" />
        <div className="zzz-line-h" />
        <div className="zzz-line-v" />
        <div className="zzz-corner zzz-corner-tl" />
        <div className="zzz-corner zzz-corner-br" />
        <div className="zzz-label">{zzzLabel}</div>
      </div>
    </div>
    </>
  )
}


export default App
