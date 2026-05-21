import GlobalChatPanel from './GlobalChatPanel'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { auth, googleProvider, dbChat, dbCommunity, dbAdmin, dbBonus } from './firebase'
import { collection, doc, setDoc, deleteDoc, onSnapshot, addDoc, orderBy, query, serverTimestamp, getDoc, getDocs, limit, updateDoc, increment } from 'firebase/firestore'

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

// ── Anime Hub Section ─────────────────────────────────────────────────────
// ── Manga Hub Section ─────────────────────────────────────────────────────
const MANGA_CATS = [
  { id: 'popular',  name: 'POPULER',  icon: '🔥', url: 'https://api.jikan.moe/v4/top/manga?filter=bypopularity&limit=12' },
  { id: 'manga',    name: 'MANGA',    icon: '📖', url: 'https://api.jikan.moe/v4/top/manga?type=manga&limit=12' },
  { id: 'manhwa',   name: 'MANHWA',   icon: '🇰🇷', url: 'https://api.jikan.moe/v4/top/manga?type=manhwa&limit=12' },
  { id: 'manhua',   name: 'MANHUA',   icon: '🇨🇳', url: 'https://api.jikan.moe/v4/top/manga?type=manhua&limit=12' },
  { id: 'novel',    name: 'NOVEL',    icon: '📝', url: 'https://api.jikan.moe/v4/top/manga?type=lightnovel&limit=12' },
  { id: 'action',   name: 'ACTION',   icon: '⚔️', url: 'https://api.jikan.moe/v4/manga?genres=1&order_by=score&sort=desc&limit=12' },
  { id: 'romance',  name: 'ROMANCE',  icon: '💘', url: 'https://api.jikan.moe/v4/manga?genres=22&order_by=score&sort=desc&limit=12' },
  { id: 'fantasy',  name: 'FANTASY',  icon: '🧙', url: 'https://api.jikan.moe/v4/manga?genres=10&order_by=score&sort=desc&limit=12' },
  { id: 'horror',   name: 'HORROR',   icon: '👁️', url: 'https://api.jikan.moe/v4/manga?genres=14&order_by=score&sort=desc&limit=12' },
  { id: 'comedy',   name: 'KOMEDI',   icon: '😂', url: 'https://api.jikan.moe/v4/manga?genres=4&order_by=score&sort=desc&limit=12' },
]

interface MangaItem {
  mal_id: number
  title: string
  title_english?: string
  images: { jpg: { image_url: string } }
  score?: number
  chapters?: number
  volumes?: number
  type?: string
  status?: string
  url?: string
  publishing?: boolean
}

// ── Manga Carousel (3 cards per page, slide left/right transition) ────────────
function MangaCarousel({ list, loading, activeId }: { list: MangaItem[]; loading: boolean; activeId: string }) {
  const CARDS_PER_PAGE = 3
  const [page, setPage] = useState(0)
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('left')
  const [animKey, setAnimKey] = useState(0)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const totalPages = Math.ceil(list.length / CARDS_PER_PAGE)

  const goTo = (next: number, dir: 'left' | 'right' = 'left') => {
    setSlideDir(dir)
    setAnimKey(k => k + 1)
    setPage(next)
  }

  useEffect(() => { setPage(0); setSlideDir('left'); setAnimKey(k => k + 1) }, [activeId])

  useEffect(() => {
    if (loading || list.length === 0) return
    autoRef.current = setInterval(() => {
      setSlideDir('left')
      setAnimKey(k => k + 1)
      setPage(p => (p + 1) % Math.ceil(list.length / CARDS_PER_PAGE))
    }, 4000)
    return () => { if (autoRef.current) clearInterval(autoRef.current) }
  }, [loading, list.length])

  const cards = list.slice(page * CARDS_PER_PAGE, page * CARDS_PER_PAGE + CARDS_PER_PAGE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden', position: 'relative' }}>
      <style>{`
        @keyframes mgSlideLeft { from { transform: translateX(60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes mgSlideRight { from { transform: translateX(-60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>

      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: 'rgba(10,10,10,0.92)', borderRadius: 10,
        }}>
          <div style={{ width: 28, height: 28, border: '3px solid #1a2200', borderTopColor: '#c8ff00', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#c8ff00', letterSpacing: 2 }}>FETCHING</span>
        </div>
      )}

      {/* Cards */}
      <div
        key={animKey}
        style={{
          display: 'flex', gap: 7, height: 260,
          animation: `${slideDir === 'left' ? 'mgSlideLeft' : 'mgSlideRight'} 0.35s cubic-bezier(0.22,1,0.36,1)`,
        }}
      >
        {cards.map((manga, idx) => {
          const title = manga.title_english || manga.title || 'Unknown'
          const score = manga.score ? `★ ${manga.score.toFixed(1)}` : '★ –'
          const info = manga.chapters ? `${manga.chapters} ch` : manga.volumes ? `${manga.volumes} vol` : manga.type || ''
          const img = manga.images?.jpg?.image_url || ''
          const isPublishing = manga.publishing || manga.status === 'Publishing'
          const badgeColor = isPublishing ? '#c8ff00' : manga.status === 'Not yet published' ? '#00c8ff' : '#333'
          const badgeTxtCol = isPublishing ? '#000' : '#fff'
          const badgeTxt = isPublishing ? 'LIVE' : manga.status === 'Not yet published' ? 'SOON' : 'END'
          return (
            <div
              key={manga.mal_id + '-' + idx}
              onClick={() => manga.url && window.open(manga.url, '_blank')}
              style={{
                flex: 1, minWidth: 0, position: 'relative', borderRadius: 10,
                overflow: 'hidden', cursor: 'pointer',
                background: '#111', border: '1px solid #1e2a00',
              }}
            >
              <img src={img} alt={title} loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#1a1a1a' }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.93) 45%, transparent 78%)',
                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 8,
              }}>
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#c8ff00', fontWeight: 700, marginBottom: 2 }}>{score}</div>
                <div style={{ fontSize: 9, fontWeight: 800, color: '#fff', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{title}</div>
                <div style={{ fontSize: 7, color: '#777', marginTop: 2 }}>{info}</div>
              </div>
              <div style={{
                position: 'absolute', top: 6, right: 6,
                background: badgeColor, color: badgeTxtCol,
                fontFamily: 'monospace', fontSize: 6, letterSpacing: 1,
                padding: '2px 5px', borderRadius: 3, fontWeight: 700,
              }}>{badgeTxt}</div>
            </div>
          )
        })}
        {cards.length < CARDS_PER_PAGE && Array.from({ length: CARDS_PER_PAGE - cards.length }).map((_, i) => (
          <div key={'empty-' + i} style={{ flex: 1, minWidth: 0 }} />
        ))}
      </div>

      {/* Nav controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={() => goTo((page - 1 + totalPages) % totalPages, 'right')}
          style={{ background: '#161f00', border: '1px solid #2a3a00', borderRadius: 6, color: '#c8ff00', fontSize: 16, padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace', lineHeight: 1, flexShrink: 0 }}
        >‹</button>
        <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'center' }}>
          {Array.from({ length: totalPages }).map((_, i) => (
            <div key={i} onClick={() => goTo(i, i > page ? 'left' : 'right')} style={{
              width: i === page ? 14 : 5, height: 5, borderRadius: 3,
              background: i === page ? '#c8ff00' : '#2a3a00',
              cursor: 'pointer', transition: 'all 0.3s ease',
            }} />
          ))}
        </div>
        <button
          onClick={() => goTo((page + 1) % totalPages, 'left')}
          style={{ background: '#161f00', border: '1px solid #2a3a00', borderRadius: 6, color: '#c8ff00', fontSize: 16, padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace', lineHeight: 1, flexShrink: 0 }}
        >›</button>
      </div>
    </div>
  )
}

// ── Video Carousel (home section, admin-managed) ────────────────────────────
interface VideoItem {
  id: string
  url: string
  title?: string
  addedAt?: number
}

const HOME_DEFAULT_VIDEOS: VideoItem[] = [
  { id: '__default__', url: 'https://c.termai.cc/a156/4VoP.mp4', title: '' },
]


function VideoCarousel({ isAdmin }: { isAdmin: boolean }) {
  const [videos, setVideos] = useState<VideoItem[]>(HOME_DEFAULT_VIDEOS)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showReplaceModal, setShowReplaceModal] = useState(false)
  const [replaceUrl, setReplaceUrl] = useState('')
  const [replaceTitle, setReplaceTitle] = useState('')
  const [replaceErr, setReplaceErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const touchStartX = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Upload video ke Cloudinary
  const uploadToCloudinary = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('upload_preset', 'kyokoapp')

      const xhr = new XMLHttpRequest()
      xhr.open('POST', 'https://api.cloudinary.com/v1_1/dtxpdx8ua/video/upload')

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100))
        }
      }

      xhr.onload = () => {
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText)
          resolve(data.secure_url)
        } else {
          reject(new Error('Upload gagal'))
        }
      }

      xhr.onerror = () => reject(new Error('Network error'))
      xhr.send(formData)
    })
  }

  // Load videos from Firestore (collection homeVideos, sorted by addedAt)
  useEffect(() => {
    const unsub = onSnapshot(collection(dbAdmin, 'homeVideos'), (snap) => {
      if (!snap.empty) {
        const list: VideoItem[] = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<VideoItem, 'id'>) }))
          .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))
        setVideos(list)
        setCurrentIndex(prev => Math.min(prev, list.length - 1))
      } else {
        setVideos(HOME_DEFAULT_VIDEOS)
        setCurrentIndex(0)
      }
    })
    return () => unsub()
  }, [])

  // Play active, pause others
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return
      if (i !== currentIndex) {
        v.pause()
        v.muted = true
      }
    })
    const active = videoRefs.current[currentIndex]
    if (!active) return
    active.muted = true  // tetap muted, user bisa unmute manual
    active.volume = 0.5
    active.play().catch(() => {})
  }, [currentIndex, videos.length])


  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(index, videos.length - 1))
    if (next === currentIndex) return
    setCurrentIndex(next)
  }

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 40) diff > 0 ? goTo(currentIndex + 1) : goTo(currentIndex - 1)
    touchStartX.current = null
  }

  // Open replace modal — pre-fill dengan URL video yang sedang aktif
  const openReplace = () => {
    const cur = videos[currentIndex]
    setReplaceUrl(cur?.url === HOME_DEFAULT_VIDEOS[0].url ? '' : (cur?.url || ''))
    setReplaceTitle(cur?.title || '')
    setReplaceErr('')
    setShowReplaceModal(true)
  }

  // Simpan: kalau video aktif ada di Firestore → updateDoc, kalau default → addDoc
  const handleReplace = async () => {
    if (!replaceUrl.trim()) { setReplaceErr('URL tidak boleh kosong'); return }
    setSaving(true)
    setReplaceErr('')
    try {
      const cur = videos[currentIndex]
      if (cur && cur.id !== '__default__') {
        // Update dokumen yang sudah ada
        await updateDoc(doc(dbAdmin, 'homeVideos', cur.id), {
          url: replaceUrl.trim(),
          title: replaceTitle.trim(),
        })
      } else {
        // Default video → buat dokumen baru (slot pertama)
        await setDoc(doc(dbAdmin, 'homeVideos', 'slot_' + currentIndex), {
          url: replaceUrl.trim(),
          title: replaceTitle.trim(),
          addedAt: currentIndex * 1000, // urutan tetap
        })
      }
      setShowReplaceModal(false)
    } catch {
      setReplaceErr('Gagal menyimpan, coba lagi')
    }
    setSaving(false)
  }

  return (
    <div style={{ marginTop: 20 }} ref={containerRef}>
      <style>{`
        @keyframes vcScanline {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
        @keyframes vcCornerPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes vcGlitch {
          0%,100% { clip-path: none; transform: none; }
        }
      `}</style>

      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 3, height: 12, background: '#c8ff00', borderRadius: 2 }} />
          <span style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: 3, color: '#c8ff00', textTransform: 'uppercase' }}>
            VIDEO
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 7, color: '#c8ff00', opacity: 0.4, letterSpacing: 1 }}>
            ▶ AUTO
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={openReplace}
            style={{
              background: '#161f00', border: '1px solid #c8ff00', borderRadius: 6,
              color: '#c8ff00', fontFamily: 'monospace', fontSize: 8,
              padding: '4px 10px', cursor: 'pointer', letterSpacing: 1,
            }}
          >
            ✎ GANTI
          </button>
        )}
      </div>

      {/* ── ZZZ-style outer frame ── */}
      <div style={{ position: 'relative', padding: '6px' }}>

        {/* Animated corner brackets */}
        {/* top-left */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: 18, height: 18, borderTop: '2px solid #c8ff00', borderLeft: '2px solid #c8ff00', borderRadius: '4px 0 0 0', animation: 'vcCornerPulse 2s ease-in-out infinite', zIndex: 10, pointerEvents: 'none' }} />
        {/* top-right */}
        <div style={{ position: 'absolute', top: 0, right: 0, width: 18, height: 18, borderTop: '2px solid #c8ff00', borderRight: '2px solid #c8ff00', borderRadius: '0 4px 0 0', animation: 'vcCornerPulse 2s ease-in-out infinite 0.5s', zIndex: 10, pointerEvents: 'none' }} />
        {/* bottom-left */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, width: 18, height: 18, borderBottom: '2px solid #c8ff00', borderLeft: '2px solid #c8ff00', borderRadius: '0 0 0 4px', animation: 'vcCornerPulse 2s ease-in-out infinite 1s', zIndex: 10, pointerEvents: 'none' }} />
        {/* bottom-right */}
        <div style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, borderBottom: '2px solid #c8ff00', borderRight: '2px solid #c8ff00', borderRadius: '0 0 4px 0', animation: 'vcCornerPulse 2s ease-in-out infinite 1.5s', zIndex: 10, pointerEvents: 'none' }} />

        {/* Side tick marks */}
        <div style={{ position: 'absolute', top: '50%', left: 0, transform: 'translateY(-50%)', width: 4, height: 20, background: 'linear-gradient(to bottom, transparent, #c8ff00, transparent)', opacity: 0.6, zIndex: 10, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '50%', right: 0, transform: 'translateY(-50%)', width: 4, height: 20, background: 'linear-gradient(to bottom, transparent, #c8ff00, transparent)', opacity: 0.6, zIndex: 10, pointerEvents: 'none' }} />

        {/* Carousel track */}
        <div
          style={{
            position: 'relative', width: '100%', overflow: 'hidden',
            borderRadius: 10,
            background: '#000',
            boxShadow: '0 0 0 1px rgba(200,255,0,0.15), 0 0 24px rgba(200,255,0,0.08), inset 0 0 40px rgba(0,0,0,0.5)',
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Scanline overlay — only subtle edge glow, no blocking layers */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none', overflow: 'hidden', borderRadius: 10,
          }}>
            {/* Left/right green edge glow only */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 6, background: 'linear-gradient(to right, rgba(200,255,0,0.12), transparent)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 6, background: 'linear-gradient(to left, rgba(200,255,0,0.12), transparent)', pointerEvents: 'none' }} />
          </div>

          {/* Swipe area blocker — prevents video click-to-pause */}
          <div
            style={{ position: 'absolute', inset: 0, zIndex: 4, cursor: 'default' }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          />

          <div
            style={{
              display: 'flex',
              transition: 'transform 0.38s cubic-bezier(0.22,1,0.36,1)',
              transform: `translateX(-${currentIndex * 100}%)`,
              willChange: 'transform',
            }}
          >
            {videos.map((video, i) => (
              <div
                key={video.id}
                style={{ flexShrink: 0, width: '100%', aspectRatio: '16/9', position: 'relative', background: '#000' }}
              >
                <video
                  ref={el => { videoRefs.current[i] = el }}
                  src={video.url}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
                  loop
                  playsInline
                  muted
                  autoPlay={i === 0}
                  preload="metadata"
                  crossOrigin="anonymous"
                />
                {video.title && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3, pointerEvents: 'none',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
                    padding: '24px 12px 10px',
                    fontFamily: 'monospace', fontSize: 10, color: '#c8ff00', letterSpacing: 1,
                  }}>
                    {video.title}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom HUD bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingInline: 2 }}>
          {/* Dots */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {videos.map((_, i) => (
              <div
                key={i}
                onClick={() => goTo(i)}
                style={{
                  width: i === currentIndex ? 16 : 4, height: 4, borderRadius: 2,
                  background: i === currentIndex ? '#c8ff00' : 'rgba(200,255,0,0.2)',
                  cursor: 'pointer', transition: 'all 0.3s ease',
                  boxShadow: i === currentIndex ? '0 0 6px rgba(200,255,0,0.5)' : 'none',
                }}
              />
            ))}
          </div>
          {/* Index label */}
          <span style={{ fontFamily: 'monospace', fontSize: 7, color: '#c8ff00', opacity: 0.4, letterSpacing: 1 }}>
            {String(currentIndex + 1).padStart(2, '0')} / {String(videos.length).padStart(2, '0')}
          </span>
        </div>

        {/* Arrow nav — only if > 1 video */}
        {videos.length > 1 && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 6 }}>
            <button
              onClick={() => goTo(currentIndex - 1)}
              style={{
                background: '#0d1500', border: '1px solid rgba(200,255,0,0.3)', borderRadius: 6,
                color: currentIndex === 0 ? 'rgba(200,255,0,0.2)' : '#c8ff00', fontSize: 15,
                padding: '3px 12px', cursor: currentIndex === 0 ? 'default' : 'pointer',
                fontFamily: 'monospace', lineHeight: 1,
              }}
            >‹</button>
            <button
              onClick={() => goTo(currentIndex + 1)}
              style={{
                background: '#0d1500', border: '1px solid rgba(200,255,0,0.3)', borderRadius: 6,
                color: currentIndex === videos.length - 1 ? 'rgba(200,255,0,0.2)' : '#c8ff00', fontSize: 15,
                padding: '3px 12px', cursor: currentIndex === videos.length - 1 ? 'default' : 'pointer',
                fontFamily: 'monospace', lineHeight: 1,
              }}
            >›</button>
          </div>
        )}
      </div>

      {/* Admin: Ganti Video Modal */}
      {showReplaceModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => { if (!saving) setShowReplaceModal(false) }}
        >
          <div
            style={{
              background: '#111', border: '1px solid rgba(200,255,0,0.3)', borderRadius: 20,
              padding: '24px 20px', maxWidth: 360, width: '100%',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#c8ff00', marginBottom: 4, letterSpacing: 2 }}>
              ✎ GANTI VIDEO
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#c8ff00', opacity: 0.4, marginBottom: 16, letterSpacing: 1 }}>
              SLOT {String(currentIndex + 1).padStart(2, '0')} / {String(videos.length).padStart(2, '0')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Upload dari HP */}
              <div style={{
                border: '1px dashed rgba(200,255,0,0.3)', borderRadius: 8,
                padding: '12px', textAlign: 'center', position: 'relative',
                background: '#0d1200',
              }}>
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#c8ff00', opacity: 0.7, marginBottom: 6, letterSpacing: 1 }}>
                  📁 UPLOAD DARI HP
                </div>
                <input
                  type="file"
                  accept="video/*"
                  disabled={saving}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setSaving(true)
                    setUploadProgress(0)
                    setReplaceErr('')
                    try {
                      const url = await uploadToCloudinary(file)
                      setReplaceUrl(url)
                      setUploadProgress(null)
                    } catch {
                      setReplaceErr('Upload gagal, coba lagi')
                      setUploadProgress(null)
                    }
                    setSaving(false)
                  }}
                  style={{
                    position: 'absolute', inset: 0, opacity: 0,
                    width: '100%', height: '100%', cursor: saving ? 'default' : 'pointer',
                  }}
                />
                {uploadProgress !== null ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                    <div style={{ width: '100%', height: 4, background: '#1a2200', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${uploadProgress}%`, background: '#c8ff00', borderRadius: 4, transition: 'width 0.2s ease' }} />
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#c8ff00' }}>
                      UPLOADING {uploadProgress}%
                    </span>
                  </div>
                ) : replaceUrl && replaceUrl.includes('cloudinary') ? (
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#c8ff00' }}>✓ Upload berhasil!</span>
                ) : (
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#888' }}>Tap untuk pilih video</span>
                )}
              </div>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 1, background: '#2a2a2a' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#555' }}>ATAU PASTE URL</span>
                <div style={{ flex: 1, height: 1, background: '#2a2a2a' }} />
              </div>

              {/* URL input manual */}
              <input
                type="text"
                placeholder="URL Video (mp4, cloudinary, dll)"
                value={replaceUrl}
                onChange={e => { setReplaceUrl(e.target.value); setReplaceErr('') }}
                disabled={saving}
                style={{
                  background: '#1a1a1a', border: `1px solid ${replaceErr ? '#ff4444' : '#2a3a00'}`, borderRadius: 8,
                  padding: '10px 12px', color: '#fff', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box',
                  opacity: saving ? 0.5 : 1,
                }}
              />
              {replaceErr && <div style={{ fontSize: 10, color: '#ff4444', fontFamily: 'monospace' }}>{replaceErr}</div>}

              {/* Judul */}
              <input
                type="text"
                placeholder="Judul (opsional)"
                value={replaceTitle}
                onChange={e => setReplaceTitle(e.target.value)}
                disabled={saving}
                style={{
                  background: '#1a1a1a', border: '1px solid #2a3a00', borderRadius: 8,
                  padding: '10px 12px', color: '#fff', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box',
                  opacity: saving ? 0.5 : 1,
                }}
              />

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={handleReplace}
                  disabled={saving}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10,
                    background: saving ? '#2a3a00' : 'linear-gradient(135deg,#c8ff00,#a0cc00)',
                    color: saving ? '#c8ff00' : '#000', fontWeight: 800, fontSize: 12, border: 'none',
                    cursor: saving ? 'default' : 'pointer', fontFamily: 'monospace', letterSpacing: 1,
                  }}
                >
                  {saving ? 'PROSES...' : 'SIMPAN'}
                </button>
                <button
                  onClick={() => { if (!saving) { setShowReplaceModal(false); setReplaceErr(''); setUploadProgress(null) } }}
                  disabled={saving}
                  style={{
                    padding: '12px 16px', borderRadius: 10,
                    background: '#1a1a1a', border: '1px solid #333',
                    color: saving ? '#444' : '#888', fontSize: 12, cursor: saving ? 'default' : 'pointer',
                  }}
                >
                  Batal
                </button>
              </div>

              {/* Hapus — hanya muncul kalau video bukan default */}
              {videos[currentIndex]?.id !== '__default__' && (
                <button
                  onClick={async () => {
                    setSaving(true)
                    try {
                      await deleteDoc(doc(dbAdmin, 'homeVideos', videos[currentIndex].id))
                      setCurrentIndex(0)
                      setShowReplaceModal(false)
                    } catch { setReplaceErr('Gagal menghapus') }
                    setSaving(false)
                  }}
                  disabled={saving}
                  style={{
                    width: '100%', padding: '10px', borderRadius: 10, marginTop: 4,
                    background: 'transparent', border: '1px solid rgba(255,60,60,0.4)',
                    color: '#ff5555', fontSize: 11, cursor: saving ? 'default' : 'pointer',
                    fontFamily: 'monospace', letterSpacing: 1,
                  }}
                >
                  🗑 HAPUS VIDEO INI
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MangaHubSection() {
  const [activeId, setActiveId] = useState('popular')
  const [mangaList, setMangaList] = useState<MangaItem[]>([])
  const [loading, setLoading] = useState(true)
  const cacheRef = useRef<Record<string, MangaItem[]>>({})
  const catTrackRef = useRef<HTMLDivElement>(null)
  const catAnimRef = useRef<Animation | null>(null)
  const catResumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pauseAndScheduleResume = () => {
    catAnimRef.current?.pause()
    if (catResumeTimer.current) clearTimeout(catResumeTimer.current)
    catResumeTimer.current = setTimeout(() => catAnimRef.current?.play(), 3000)
  }

  // Category scroll loop (horizontal)
  useEffect(() => {
    const track = catTrackRef.current
    if (!track) return
    const totalW = track.scrollWidth / 2
    catAnimRef.current?.cancel()
    catAnimRef.current = track.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(-${totalW}px)` }],
      { duration: 18000, iterations: Infinity, easing: 'linear' }
    )
    track.addEventListener('mouseenter', pauseAndScheduleResume)
    track.addEventListener('mouseleave', pauseAndScheduleResume)
    track.addEventListener('touchstart', pauseAndScheduleResume, { passive: true })
    track.addEventListener('touchend', pauseAndScheduleResume, { passive: true })
    return () => {
      track.removeEventListener('mouseenter', pauseAndScheduleResume)
      track.removeEventListener('mouseleave', pauseAndScheduleResume)
      track.removeEventListener('touchstart', pauseAndScheduleResume)
      track.removeEventListener('touchend', pauseAndScheduleResume)
      catAnimRef.current?.cancel()
      if (catResumeTimer.current) clearTimeout(catResumeTimer.current)
    }
  }, [])

  useEffect(() => {
    const cat = MANGA_CATS.find(c => c.id === activeId)
    if (!cat) return
    if (cacheRef.current[activeId]) { setMangaList(cacheRef.current[activeId]); setLoading(false); return }
    setLoading(true)
    fetch(cat.url)
      .then(r => r.json())
      .then(json => {
        const data: MangaItem[] = json.data || []
        cacheRef.current[activeId] = data
        setMangaList(data)
      })
      .catch(() => setMangaList([]))
      .finally(() => setLoading(false))
  }, [activeId])

  const catItems = [...MANGA_CATS, ...MANGA_CATS]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
      {/* CAROUSEL (top) */}
      <MangaCarousel list={mangaList} loading={loading} activeId={activeId} />

      {/* CATEGORY BAR (bottom, scroll horizontal) */}
      <div style={{
        overflow: 'hidden', position: 'relative',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
        maskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
        height: 64,
      }}>
        <div ref={catTrackRef} style={{ display: 'flex', flexDirection: 'row', gap: 7, width: 'max-content' }}>
          {catItems.map((cat, i) => (
            <div
              key={cat.id + i}
              onClick={() => { setActiveId(cat.id); pauseAndScheduleResume() }}
              style={{
                background: activeId === cat.id ? '#161f00' : '#111',
                border: `1px solid ${activeId === cat.id ? '#c8ff00' : '#1e2a00'}`,
                borderBottom: `3px solid ${activeId === cat.id ? '#c8ff00' : 'transparent'}`,
                borderRadius: 7, padding: '7px 12px', cursor: 'pointer',
                textAlign: 'center', transition: 'all 0.2s',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                boxShadow: activeId === cat.id ? '0 0 8px rgba(200,255,0,0.15)' : 'none',
                userSelect: 'none', flexShrink: 0,
              }}
            >
              <div style={{ fontSize: 15 }}>{cat.icon}</div>
              <div style={{
                fontFamily: 'monospace', fontSize: 7, letterSpacing: 1,
                textTransform: 'uppercase',
                color: activeId === cat.id ? '#c8ff00' : '#aaa',
                lineHeight: 1.3, whiteSpace: 'nowrap',
              }}>{cat.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Novel Hub Section ─────────────────────────────────────────────────────────
const NOVEL_CATS = [
  { id: 'popular',  name: 'POPULER',  icon: '🔥', url: 'https://api.jikan.moe/v4/top/manga?type=lightnovel&filter=bypopularity&limit=12' },
  { id: 'top',      name: 'TOP',      icon: '👑', url: 'https://api.jikan.moe/v4/top/manga?type=lightnovel&limit=12' },
  { id: 'airing',   name: 'TERBIT',   icon: '📡', url: 'https://api.jikan.moe/v4/top/manga?type=lightnovel&filter=publishing&limit=12' },
  { id: 'romance',  name: 'ROMANCE',  icon: '💘', url: 'https://api.jikan.moe/v4/manga?type=lightnovel&genres=22&order_by=score&sort=desc&limit=12' },
  { id: 'fantasy',  name: 'FANTASY',  icon: '🧙', url: 'https://api.jikan.moe/v4/manga?type=lightnovel&genres=10&order_by=score&sort=desc&limit=12' },
  { id: 'action',   name: 'ACTION',   icon: '⚔️', url: 'https://api.jikan.moe/v4/manga?type=lightnovel&genres=1&order_by=score&sort=desc&limit=12' },
  { id: 'drama',    name: 'DRAMA',    icon: '🎭', url: 'https://api.jikan.moe/v4/manga?type=lightnovel&genres=8&order_by=score&sort=desc&limit=12' },
  { id: 'mystery',  name: 'MISTERI',  icon: '🔍', url: 'https://api.jikan.moe/v4/manga?type=lightnovel&genres=7&order_by=score&sort=desc&limit=12' },
]

interface NovelItem {
  mal_id: number
  title: string
  title_english?: string
  images: { jpg: { image_url: string } }
  score?: number
  chapters?: number
  volumes?: number
  type?: string
  status?: string
  url?: string
  publishing?: boolean
}

function NovelHubSection() {
  const [activeId, setActiveId] = useState('popular')
  const [novelList, setNovelList] = useState<NovelItem[]>([])
  const [loading, setLoading] = useState(true)
  const cacheRef   = useRef<Record<string, NovelItem[]>>({})
  const trackRef   = useRef<HTMLDivElement>(null)
  const animRef    = useRef<Animation | null>(null)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pauseAndScheduleResume = () => {
    animRef.current?.pause()
    if (resumeTimer.current) clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => animRef.current?.play(), 3000)
  }

  // Sidebar scroll loop (vertikal, ke bawah)
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const totalH = track.scrollHeight / 2
    animRef.current?.cancel()
    animRef.current = track.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(-${totalH}px)` }],
      { duration: 18000, iterations: Infinity, easing: 'linear' }
    )
    track.addEventListener('mouseenter',  pauseAndScheduleResume)
    track.addEventListener('touchstart',  pauseAndScheduleResume, { passive: true })
    return () => {
      track.removeEventListener('mouseenter', pauseAndScheduleResume)
      track.removeEventListener('touchstart', pauseAndScheduleResume)
      animRef.current?.cancel()
      if (resumeTimer.current) clearTimeout(resumeTimer.current)
    }
  }, [])

  // Fetch data
  useEffect(() => {
    const cat = NOVEL_CATS.find(c => c.id === activeId)
    if (!cat) return
    if (cacheRef.current[activeId]) { setNovelList(cacheRef.current[activeId]); setLoading(false); return }
    setLoading(true)
    fetch(cat.url)
      .then(r => r.json())
      .then(json => {
        const data: NovelItem[] = json.data || []
        cacheRef.current[activeId] = data
        setNovelList(data)
      })
      .catch(() => setNovelList([]))
      .finally(() => setLoading(false))
  }, [activeId])

  const catItems = [...NOVEL_CATS, ...NOVEL_CATS]

  const renderCard = (novel: NovelItem, key: string) => {
    const title = novel.title_english || novel.title || 'Unknown'
    const score = novel.score ? `★ ${novel.score.toFixed(1)}` : '★ –'
    const info  = novel.volumes ? `${novel.volumes} vol` : novel.chapters ? `${novel.chapters} ch` : novel.type || ''
    const img   = novel.images?.jpg?.image_url || ''
    const isPublishing = novel.publishing || novel.status === 'Publishing'
    const badgeColor   = isPublishing ? '#c8ff00' : novel.status === 'Not yet published' ? '#00c8ff' : '#333'
    const badgeTxtCol  = isPublishing ? '#000' : '#fff'
    const badgeTxt     = isPublishing ? 'LIVE' : novel.status === 'Not yet published' ? 'SOON' : 'END'
    return (
      <div
        key={key}
        onClick={() => novel.url && window.open(novel.url, '_blank')}
        style={{
          flexShrink: 0, width: 88, height: 128,
          position: 'relative', borderRadius: 8, overflow: 'hidden',
          cursor: 'pointer', background: '#111', border: '1px solid #1e2a00',
        }}
      >
        {img && <img src={img} alt={title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#1a1a1a' }} />}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.95) 40%, transparent 75%)',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 6,
        }}>
          <div style={{ fontFamily: 'monospace', fontSize: 7, color: '#c8ff00', fontWeight: 700, marginBottom: 1 }}>{score}</div>
          <div style={{ fontSize: 7, fontWeight: 800, color: '#fff', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{title}</div>
          <div style={{ fontSize: 6, color: '#666', marginTop: 1 }}>{info}</div>
        </div>
        <div style={{
          position: 'absolute', top: 5, right: 5,
          background: badgeColor, color: badgeTxtCol,
          fontFamily: 'monospace', fontSize: 5, letterSpacing: 1,
          padding: '2px 4px', borderRadius: 3, fontWeight: 700,
        }}>{badgeTxt}</div>
      </div>
    )
  }

  // Duplikat 4x untuk seamless infinite loop
  const rowA = novelList.slice(0, 6)
  const rowB = novelList.slice(3, 9).length >= 3 ? novelList.slice(3, 9) : novelList.slice(0, 6)
  const rowAFull = [...rowA, ...rowA, ...rowA, ...rowA]
  const rowBFull = [...rowB, ...rowB, ...rowB, ...rowB]

  return (
    <div style={{ display: 'flex', gap: 12, position: 'relative' }}>
      <style>{`
        @keyframes novelScrollRight {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes novelScrollLeft {
          from { transform: translateX(-50%); }
          to   { transform: translateX(0); }
        }
      `}</style>

      {/* ── AREA KIRI: dua baris card ─────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden', position: 'relative', minHeight: 280 }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'rgba(10,10,10,0.92)', borderRadius: 10,
          }}>
            <div style={{ width: 28, height: 28, border: '3px solid #1a2200', borderTopColor: '#c8ff00', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#c8ff00', letterSpacing: 2 }}>FETCHING</span>
          </div>
        )}

        {/* ROW A → gerak ke kanan */}
        <div style={{ overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)', maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)' }}>
          <div style={{ display: 'flex', gap: 8, width: 'max-content', animation: rowAFull.length > 0 ? 'novelScrollRight 20s linear infinite' : 'none' }}>
            {rowAFull.map((n, i) => renderCard(n, `rowA-${n.mal_id}-${i}`))}
            {rowAFull.length === 0 && !loading && <div style={{ height: 128 }} />}
          </div>
        </div>

        {/* ROW B → gerak ke kiri */}
        <div style={{ overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)', maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)' }}>
          <div style={{ display: 'flex', gap: 8, width: 'max-content', animation: rowBFull.length > 0 ? 'novelScrollLeft 20s linear infinite' : 'none' }}>
            {rowBFull.map((n, i) => renderCard(n, `rowB-${n.mal_id}-${i}`))}
            {rowBFull.length === 0 && !loading && <div style={{ height: 128 }} />}
          </div>
        </div>
      </div>

      {/* ── SIDEBAR KANAN: kategori vertikal scroll ───────────── */}
      <div style={{
        width: 72, flexShrink: 0, overflow: 'hidden', position: 'relative', height: 280,
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
      }}>
        <div ref={trackRef} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {catItems.map((cat, i) => (
            <div
              key={cat.id + i}
              onClick={() => { setActiveId(cat.id); pauseAndScheduleResume() }}
              style={{
                background: activeId === cat.id ? '#161f00' : '#111',
                border: `1px solid ${activeId === cat.id ? '#c8ff00' : '#1e2a00'}`,
                borderRight: `3px solid ${activeId === cat.id ? '#c8ff00' : 'transparent'}`,
                borderRadius: 6, padding: '8px 6px', cursor: 'pointer',
                textAlign: 'center', transition: 'all 0.2s',
                boxShadow: activeId === cat.id ? '0 0 8px rgba(200,255,0,0.15)' : 'none',
                userSelect: 'none',
              }}
            >
              <div style={{ fontSize: 16, marginBottom: 3 }}>{cat.icon}</div>
              <div style={{
                fontFamily: 'monospace', fontSize: 6, letterSpacing: 1,
                textTransform: 'uppercase',
                color: activeId === cat.id ? '#c8ff00' : '#aaa',
                lineHeight: 1.3,
              }}>{cat.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const ANIME_CATS = [
  { id: 'airing',       name: 'LIVE NOW',  icon: '🔴', url: 'https://api.jikan.moe/v4/top/anime?filter=airing&limit=12' },
  { id: 'popular',      name: 'POPULER',   icon: '🔥', url: 'https://api.jikan.moe/v4/top/anime?filter=bypopularity&limit=12' },
  { id: 'seasonal',     name: 'SEASONAL',  icon: '🌸', url: 'https://api.jikan.moe/v4/seasons/now?limit=12' },
  { id: 'upcoming',     name: 'UPCOMING',  icon: '📅', url: 'https://api.jikan.moe/v4/top/anime?filter=upcoming&limit=12' },
  { id: 'movie',        name: 'MOVIE',     icon: '🎬', url: 'https://api.jikan.moe/v4/top/anime?filter=movie&limit=12' },
  { id: 'action',       name: 'ACTION',    icon: '⚔️', url: 'https://api.jikan.moe/v4/anime?genres=1&order_by=score&sort=desc&limit=12' },
  { id: 'romance',      name: 'ROMANCE',   icon: '💘', url: 'https://api.jikan.moe/v4/anime?genres=22&order_by=score&sort=desc&limit=12' },
  { id: 'fantasy',      name: 'FANTASY',   icon: '🧙', url: 'https://api.jikan.moe/v4/anime?genres=10&order_by=score&sort=desc&limit=12' },
  { id: 'horror',       name: 'HORROR',    icon: '👁️', url: 'https://api.jikan.moe/v4/anime?genres=14&order_by=score&sort=desc&limit=12' },
  { id: 'comedy',       name: 'KOMEDI',    icon: '😂', url: 'https://api.jikan.moe/v4/anime?genres=4&order_by=score&sort=desc&limit=12' },
]

interface AnimeItem {
  mal_id: number
  title: string
  title_english?: string
  images: { jpg: { image_url: string } }
  score?: number
  episodes?: number
  type?: string
  status?: string
  url?: string
}

// ── Anime Carousel (2 cards per page, fade transition) ────────────────────────
function AnimeCarousel({ list, loading, activeId }: { list: AnimeItem[]; loading: boolean; activeId: string }) {
  const CARDS_PER_PAGE = 2
  const [page, setPage] = useState(0)
  const [visible, setVisible] = useState(true)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const totalPages = Math.ceil(list.length / CARDS_PER_PAGE)

  const goTo = (next: number) => {
    setVisible(false)
    setTimeout(() => { setPage(next); setVisible(true) }, 320)
  }

  // reset page when category changes
  useEffect(() => { setPage(0); setVisible(true) }, [activeId])

  // auto-advance every 4s
  useEffect(() => {
    if (loading || list.length === 0) return
    autoRef.current = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setPage(p => (p + 1) % Math.ceil(list.length / CARDS_PER_PAGE))
        setVisible(true)
      }, 320)
    }, 4000)
    return () => { if (autoRef.current) clearInterval(autoRef.current) }
  }, [loading, list.length])

  const cards = list.slice(page * CARDS_PER_PAGE, page * CARDS_PER_PAGE + CARDS_PER_PAGE)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden', position: 'relative' }}>
      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: 'rgba(10,10,10,0.92)', borderRadius: 10,
        }}>
          <div style={{
            width: 28, height: 28,
            border: '3px solid #1a2200', borderTopColor: '#c8ff00',
            borderRadius: '50%', animation: 'spin 0.7s linear infinite',
          }} />
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#c8ff00', letterSpacing: 2 }}>FETCHING</span>
        </div>
      )}

      {/* Cards */}
      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0 }}>
        {cards.map(anime => {
          const title = anime.title_english || anime.title || 'Unknown'
          const score = anime.score ? `★ ${anime.score.toFixed(1)}` : '★ –'
          const eps   = anime.episodes ? `${anime.episodes} eps` : anime.type || ''
          const img   = anime.images?.jpg?.image_url || ''
          const st    = anime.status
          const badgeColor  = st === 'Currently Airing' ? '#c8ff00' : st === 'Not yet aired' ? '#00c8ff' : '#333'
          const badgeTxtCol = st === 'Currently Airing' ? '#000' : '#fff'
          const badgeTxt    = st === 'Currently Airing' ? 'LIVE' : st === 'Not yet aired' ? 'SOON' : 'END'
          return (
            <div
              key={anime.mal_id}
              onClick={() => anime.url && window.open(anime.url, '_blank')}
              style={{
                flex: 1, minWidth: 0, position: 'relative', borderRadius: 10,
                overflow: 'hidden', cursor: 'pointer',
                background: '#111', border: '1px solid #1e2a00',
                transition: 'opacity 0.32s ease, transform 0.32s ease',
                opacity: visible ? 1 : 0,
                transform: visible ? 'scale(1)' : 'scale(0.96)',
              }}
            >
              <img src={img} alt={title} loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#1a1a1a' }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.93) 45%, transparent 78%)',
                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 9,
              }}>
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#c8ff00', fontWeight: 700, marginBottom: 2 }}>{score}</div>
                <div style={{
                  fontSize: 10, fontWeight: 800, color: '#fff', lineHeight: 1.3,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{title}</div>
                <div style={{ fontSize: 8, color: '#777', marginTop: 2 }}>{eps}</div>
              </div>
              <div style={{
                position: 'absolute', top: 6, right: 6,
                background: badgeColor, color: badgeTxtCol,
                fontFamily: 'monospace', fontSize: 6, letterSpacing: 1,
                padding: '2px 5px', borderRadius: 3, fontWeight: 700,
              }}>{badgeTxt}</div>
            </div>
          )
        })}
        {cards.length === 1 && <div style={{ flex: 1 }} />}
      </div>

      {/* Nav controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={() => goTo((page - 1 + totalPages) % totalPages)}
          style={{
            background: '#161f00', border: '1px solid #2a3a00', borderRadius: 6,
            color: '#c8ff00', fontSize: 16, padding: '3px 10px', cursor: 'pointer',
            fontFamily: 'monospace', lineHeight: 1, flexShrink: 0,
          }}
        >‹</button>
        <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'center' }}>
          {Array.from({ length: totalPages }).map((_, i) => (
            <div key={i} onClick={() => goTo(i)} style={{
              width: i === page ? 14 : 5, height: 5, borderRadius: 3,
              background: i === page ? '#c8ff00' : '#2a3a00',
              cursor: 'pointer', transition: 'all 0.3s ease',
            }} />
          ))}
        </div>
        <button
          onClick={() => goTo((page + 1) % totalPages)}
          style={{
            background: '#161f00', border: '1px solid #2a3a00', borderRadius: 6,
            color: '#c8ff00', fontSize: 16, padding: '3px 10px', cursor: 'pointer',
            fontFamily: 'monospace', lineHeight: 1, flexShrink: 0,
          }}
        >›</button>
      </div>
    </div>
  )
}

function AnimeHubSection() {
  const [activeId, setActiveId] = useState('airing')
  const [animeList, setAnimeList] = useState<AnimeItem[]>([])
  const [loading, setLoading] = useState(true)
  const cacheRef    = useRef<Record<string, AnimeItem[]>>({})
  const trackRef    = useRef<HTMLDivElement>(null)
  const animRef     = useRef<Animation | null>(null)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // pause sidebar scroll, resume after 3s of no interaction
  const pauseAndScheduleResume = () => {
    animRef.current?.pause()
    if (resumeTimer.current) clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => animRef.current?.play(), 3000)
  }

  // Sidebar scroll loop
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const totalH = track.scrollHeight / 2
    animRef.current?.cancel()
    animRef.current = track.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(-${totalH}px)` }],
      { duration: 16000, iterations: Infinity, easing: 'linear' }
    )
    track.addEventListener('mouseenter',  pauseAndScheduleResume)
    track.addEventListener('mouseleave',  pauseAndScheduleResume)
    track.addEventListener('touchstart',  pauseAndScheduleResume, { passive: true })
    track.addEventListener('touchend',    pauseAndScheduleResume, { passive: true })
    return () => {
      track.removeEventListener('mouseenter', pauseAndScheduleResume)
      track.removeEventListener('mouseleave', pauseAndScheduleResume)
      track.removeEventListener('touchstart', pauseAndScheduleResume)
      track.removeEventListener('touchend',   pauseAndScheduleResume)
      animRef.current?.cancel()
      if (resumeTimer.current) clearTimeout(resumeTimer.current)
    }
  }, [])

  // Fetch anime list
  useEffect(() => {
    const cat = ANIME_CATS.find(c => c.id === activeId)
    if (!cat) return
    if (cacheRef.current[activeId]) { setAnimeList(cacheRef.current[activeId]); setLoading(false); return }
    setLoading(true)
    fetch(cat.url)
      .then(r => r.json())
      .then(json => {
        const data: AnimeItem[] = json.data || []
        cacheRef.current[activeId] = data
        setAnimeList(data)
      })
      .catch(() => setAnimeList([]))
      .finally(() => setLoading(false))
  }, [activeId])

  const catItems = [...ANIME_CATS, ...ANIME_CATS]

  return (
    <div style={{ display: 'flex', gap: 12, height: 380, position: 'relative' }}>
      {/* SIDEBAR */}
      <div style={{
        width: 80, flexShrink: 0, overflow: 'hidden', position: 'relative',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
      }}>
        <div ref={trackRef} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {catItems.map((cat, i) => (
            <div
              key={cat.id + i}
              onClick={() => { setActiveId(cat.id); pauseAndScheduleResume() }}
              style={{
                background: activeId === cat.id ? '#161f00' : '#111',
                border: `1px solid ${activeId === cat.id ? 'var(--accent, #c8ff00)' : '#1e2a00'}`,
                borderLeft: `3px solid ${activeId === cat.id ? 'var(--accent, #c8ff00)' : 'transparent'}`,
                borderRadius: 6, padding: '8px 6px', cursor: 'pointer',
                textAlign: 'center', transition: 'all 0.2s',
                boxShadow: activeId === cat.id ? '0 0 8px rgba(200,255,0,0.15)' : 'none',
                userSelect: 'none',
              }}
            >
              <div style={{ fontSize: 16, marginBottom: 3 }}>{cat.icon}</div>
              <div style={{
                fontFamily: 'monospace', fontSize: 7, letterSpacing: 1,
                textTransform: 'uppercase',
                color: activeId === cat.id ? '#c8ff00' : '#aaa',
                lineHeight: 1.3,
              }}>{cat.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CAROUSEL */}
      <AnimeCarousel list={animeList} loading={loading} activeId={activeId} />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

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
      content: 'Halo! Aku KyokoAI. Tanyakan apa saja tentang anime, manga, novel, atau komunitas Kyoko!',
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

  const handleLoginClick = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
      setShowLoginTutorial(true)
    } catch {
      signInWithRedirect(auth, googleProvider)
    }
  }
  const [aiUnread, setAiUnread] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
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
  const [musicTrackUrl, setMusicTrackUrl] = useState('https://c.termai.cc/a138/nOnf2vY.mp3')
  const [musicTrackName, setMusicTrackName] = useState('Default BGM')
  const [adminMusicUrl, setAdminMusicUrl] = useState('')
  const [adminMusicName, setAdminMusicName] = useState('')
  const [bgMusicAutoplay, setBgMusicAutoplay] = useState(false)

  // Load musik dari Firestore (admin bisa ganti via admin setting)
  React.useEffect(() => {
    const musicRef = doc(dbAdmin, 'site_config', 'bgmusic')
    const unsub = onSnapshot(musicRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        if (data?.url) {
          setMusicTrackUrl(data.url)
          setMusicTrackName(data.name || 'BGM')
          // Update audio element jika sudah ada
          const audio = audioRef.current
          if (audio) {
            const wasPlaying = !audio.paused
            audio.pause()
            audio.src = data.url
            audio.load()
            if (wasPlaying) audio.play().then(() => setMusicPlaying(true)).catch(() => setMusicPlaying(false))
          }
        }
        // Sync status autoplay dari Firestore
        const autoplay = data?.autoplay === true
        setBgMusicAutoplay(autoplay)
        const audio = audioRef.current
        if (audio) {
          if (autoplay && audio.paused) {
            audio.play().then(() => setMusicPlaying(true)).catch(() => {})
          } else if (!autoplay && !audio.paused) {
            audio.pause()
            setMusicPlaying(false)
          }
        }
      }
    })
    return () => unsub()
  }, [])

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
  const annCooldownRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
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
    const audio = new Audio(musicTrackUrl)
    audio.loop = true
    audio.volume = 0.4
    audioRef.current = audio
    // Default: musik MATI — user harus klik tombol musik untuk nyalakan
    return () => {
      audio.pause()
      audio.src = ''
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
    import('firebase/firestore').then(({ increment, updateDoc, getDoc, setDoc }) => {
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

  const visibleGroups = useMemo(() => {
    const items = groups[activeCategory] || []
    if (expandedCategories[activeCategory]) return items
    return items.slice(0, 5)
  }, [activeCategory, expandedCategories, groups])

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
    const element = document.getElementById(targetId)
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  const handleSaveBgMusic = async () => {
    if (!adminMusicUrl.trim()) return
    try {
      const musicRef = doc(dbAdmin, 'site_config', 'bgmusic')
      await setDoc(musicRef, { url: adminMusicUrl.trim(), name: adminMusicName.trim() || 'BGM', autoplay: bgMusicAutoplay, updatedAt: Date.now() })
      setAdminMusicUrl('')
      setAdminMusicName('')
    } catch (e) { console.error('Gagal simpan musik:', e) }
  }

  const handleToggleBgMusicAutoplay = async () => {
    const next = !bgMusicAutoplay
    try {
      const musicRef = doc(dbAdmin, 'site_config', 'bgmusic')
      await updateDoc(musicRef, { autoplay: next, updatedAt: Date.now() })
    } catch {
      // Kalau doc belum ada, pakai setDoc dengan merge
      try {
        const musicRef = doc(dbAdmin, 'site_config', 'bgmusic')
        await setDoc(musicRef, { autoplay: next, updatedAt: Date.now() }, { merge: true })
      } catch (e) { console.error('Gagal toggle autoplay:', e) }
    }
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
    import('firebase/firestore').then(({ updateDoc }) => {
      updateDoc(doc(dbCommunity, 'jualBeliAkun', id), { status: 'approved' }).catch(console.error)
    })
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
    import('firebase/firestore').then(({ updateDoc }) => {
      updateDoc(doc(dbCommunity, 'jualBeliAkun', jbSoldItem.id), { status: 'sold' }).catch(console.error)
    })
    setJbSoldModalOpen(false)
    setJbSoldInput('')
    setJbSoldErr('')
    setJbSoldItem(null)
  }

  const handleJbAdminMarkSold = (id: string) => {
    import('firebase/firestore').then(({ updateDoc }) => {
      updateDoc(doc(dbCommunity, 'jualBeliAkun', id), { status: 'sold' }).catch(console.error)
    })
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
          {/* Wipe-in */}
          {!splashFade && (
            <div className="splash-wipe" aria-hidden="true">
              <div className="splash-wipe-a" />
              <div className="splash-wipe-b" />
            </div>
          )}
          {/* Wipe-out */}
          {splashFade && (
            <div className="splash-wipe splash-wipe-out" aria-hidden="true">
              <div className="splash-wipe-out-a" />
              <div className="splash-wipe-out-b" />
            </div>
          )}
          {/* Crystal shards background */}
          <div className="splash-shards" aria-hidden="true">
            <div className="shard shard-1" /><div className="shard shard-2" /><div className="shard shard-3" />
            <div className="shard shard-4" /><div className="shard shard-5" /><div className="shard shard-6" />
            <div className="shard shard-7" /><div className="shard shard-8" /><div className="shard shard-9" />
            <div className="shard shard-10" /><div className="shard shard-11" /><div className="shard shard-12" />
            <div className="shard shard-13" /><div className="shard shard-14" /><div className="shard shard-15" />
            <div className="shard shard-16" />
          </div>
          {/* Center glow */}
          <div className="splash-glow" aria-hidden="true" />
          {/* Corner brackets */}
          <div className="splash-corner splash-corner-tl" aria-hidden="true" />
          <div className="splash-corner splash-corner-tr" aria-hidden="true" />
          <div className="splash-corner splash-corner-bl" aria-hidden="true" />
          <div className="splash-corner splash-corner-br" aria-hidden="true" />
          {/* Main content */}
          <div className="splash-content">
            <div className="splash-logo-wrap">
              <div className="splash-ring splash-ring-1" />
              <div className="splash-ring splash-ring-2" />
              <svg className="splash-crystal-ring" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
                <polygon points="80,4 152,40 152,120 80,156 8,120 8,40" fill="none" stroke="rgba(200,245,0,0.15)" strokeWidth="1" strokeDasharray="6 4"/>
                <polygon points="80,18 138,48 138,112 80,142 22,112 22,48" fill="none" stroke="rgba(200,245,0,0.07)" strokeWidth="1"/>
              </svg>
              <svg className="splash-logo-svg" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                <polygon points="40,4 72,20 72,60 40,76 8,60 8,20" fill="#0a0a0a" stroke="#c8f500" strokeWidth="1.5"/>
                <polygon points="40,12 65,25 65,55 40,68 15,55 15,25" fill="none" stroke="rgba(200,245,0,0.18)" strokeWidth="1"/>
                <text x="40" y="54" textAnchor="middle" fontFamily="Bebas Neue, sans-serif" fontSize="36" fill="#c8f500" fontWeight="900">K</text>
                <circle cx="40" cy="4" r="2" fill="#c8f500" opacity="0.8"/>
                <circle cx="40" cy="76" r="2" fill="#c8f500" opacity="0.8"/>
                <circle cx="72" cy="20" r="1.5" fill="#c8f500" opacity="0.5"/>
                <circle cx="8" cy="20" r="1.5" fill="#c8f500" opacity="0.5"/>
                <circle cx="72" cy="60" r="1.5" fill="#c8f500" opacity="0.5"/>
                <circle cx="8" cy="60" r="1.5" fill="#c8f500" opacity="0.5"/>
              </svg>
            </div>
            <div className="splash-brand">
              <span className="splash-brand-k">K</span><span className="splash-brand-rest">YOKO</span>
            </div>
            <div className="splash-tagline">
              <span className="splash-tag-line" /> ANIME · MANGA · NOVEL <span className="splash-tag-line" />
            </div>
            <div className="splash-loader">
              <div className="splash-loader-track" />
              <div className="splash-loader-bar" />
              <div className="splash-loader-glow" />
            </div>
            <div className="splash-status-row">
              <span className="splash-status-dot-anim" />
              <span className="splash-status">LOADING</span>
            </div>
          </div>
          <div className="splash-ver">v1.0</div>
          <div className="splash-est">EST. 2024</div>
          {/* Bottom ticker */}
          <div className="splash-ticker" aria-hidden="true">
            <div className="splash-ticker-inner">
              KYOKO · ANIME · MANGA · NOVEL · INFO HUB · ALWAYS UPDATED · COMMUNITY READY · 
              KYOKO · ANIME · MANGA · NOVEL · INFO HUB · ALWAYS UPDATED · COMMUNITY READY · 
            </div>
          </div>
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
            <div className="logo-title">Kyoko</div>
            <div className="logo-sub">Anime · Manga · Novel</div>
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

      <main>
        <section className="hero section" id="beranda">
          <div className="section-bg-text">KYOKO</div>
          <div className="hero-content fade-section">
            <div className="tagline">Anime · Manga · Novel · Info</div>
            <h1>
              <span>KYOKO</span>
            </h1>
            <p className="subtitle">By Ryuuki Kojo · Info Hub for the Community</p>
            <p className="description">
              Temukan info anime, manga, novel, dan lebih banyak lagi. Hub komunitas dengan konten selalu diperbarui!
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="https://chat.whatsapp.com/BbLtlR1EbviEHDnaUSvGYz" target="_blank" rel="noreferrer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{marginRight:6,flexShrink:0}}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                Grup Komunitas
              </a>
              <a className="btn btn-secondary" href="https://whatsapp.com/channel/0029Vb5avimI1rcisKNii32A" target="_blank" rel="noreferrer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:6,flexShrink:0}}><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Official Channel
              </a>
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
                  onClick={() => { setFabOpen(false); setGcUnread(false); setGcOpen(true) }}
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

            {/* ── Video Carousel ── */}
            <VideoCarousel isAdmin={isAdmin} />

          </div>
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
            <span>KYOKO · ANIME HUB · MANGA READER · NOVEL INFO · COMMUNITY READY · ALWAYS UPDATED · </span>
            <span>KYOKO · ANIME HUB · MANGA READER · NOVEL INFO · COMMUNITY READY · ALWAYS UPDATED · </span>
          </div>
        </div>

        <div className="film-divider" aria-hidden="true" />

        <section className="section fade-section" id="info-berita">
          <div className="section-number">02</div>
          <div className="section-bg-text">ANIME</div>
          <div className="section-header">
            <h2>Anime Hub</h2>
            <p>Temukan anime terbaik · selalu diperbarui real-time.</p>
          </div>
          <AnimeHubSection />
        </section>

        <div className="film-divider reverse" aria-hidden="true" />

        <section className="section fade-section" id="karakter">
          <div className="section-number">03</div>
          <div className="section-bg-text">MANGA</div>
          <div className="section-header">
            <h2>Manga Hub</h2>
            <p>Temukan manga terbaik · selalu diperbarui real-time.</p>
          </div>
          <MangaHubSection />
        </section>

        <section className="diagonal-band">
          <div className="band-text">JOIN THE COMMUNITY · ANIME · MANGA · NOVEL · KYOKO READY</div>
        </section>

        <section className="section fade-section" id="latar-belakang">
          <div className="section-number">04</div>
          <div className="section-bg-text">NOVEL</div>
          <div className="section-header">
            <h2>Info Novel</h2>
            <p>Temukan light novel terbaik · selalu diperbarui real-time.</p>
          </div>
          <NovelHubSection />
        </section>

        <div className="film-divider" aria-hidden="true" />

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
      </main>

      <footer className="footer">
        <div className="footer-logo">
          <span className="logo-mark">K</span>
          <div>
            <div className="logo-title">Kyoko</div>
            <div className="logo-sub">Anime · Manga · Novel</div>
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
        <p className="copyright">© 2024 Kyoko. Anime · Manga · Novel Hub.</p>
      </footer>


      {/* ── Global Chat Inline ───────────────────────────────────── */}
      {gcOpen && <GlobalChatPanel onClose={() => setGcOpen(false)} onUnread={() => setGcUnread(true)} onMusicChange={setGcMiniPlayer} />}

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
        <div style={{ position:'fixed', bottom:100, right:16, zIndex:9998, display:'flex', flexDirection:'column', gap:8, pointerEvents:'none' }}>
          {rpgToasts.map(t => (
            <div key={t.id} style={{ background:'rgba(8,8,8,0.95)', border:'1px solid rgba(200,245,0,0.3)', borderRadius:12, padding:'8px 14px', fontSize:12, color:'#c8f500', fontWeight:700, boxShadow:'0 4px 20px rgba(0,0,0,0.6)', animation:'rpgToastIn .3s cubic-bezier(.34,1.56,.64,1)' }}>
              {t.msg}
            </div>
          ))}
        </div>
      )}

      {/* ── Unified FAB ──────────────────────────────────────────── */}
      {fabOpen && <div className="fab-backdrop" onClick={() => setFabOpen(false)} />}
      <div className="fab-group">
        {/* Sub: Global Chat */}
        <div className={`fab-sub ${fabOpen ? 'fab-sub-visible' : ''}`} style={{ '--fab-delay': '0.05s' } as React.CSSProperties}>
          <span className="fab-sub-label">Global Chat</span>
          <button
            className="fab-sub-btn fab-sub-chat"
            onClick={() => { setFabOpen(false); setGcUnread(false); setGcOpen(true) }}
            aria-label="Global Chat"
            style={{ position: 'relative' }}
          >
            {gcUnread && <span className="fab-unread-badge">!</span>}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>
        {/* Sub: KyokoAI */}
        <div className={`fab-sub ${fabOpen ? 'fab-sub-visible' : ''}`} style={{ '--fab-delay': '0.12s' } as React.CSSProperties}>
          <span className="fab-sub-label">KyokoAI</span>
          <button
            className="fab-sub-btn fab-sub-ai"
            onClick={() => { setFabOpen(false); setAiUnread(false); setChatOpen(true) }}
            aria-label="KyokoAI"
            style={{ position: 'relative' }}
          >
            {aiUnread && <span className="fab-unread-badge">!</span>}
            <svg viewBox="0 0 32 32" width="20" height="20" fill="none">
              <path d="M8 11.5C8 10.12 9.12 9 10.5 9h11C22.88 9 24 10.12 24 11.5v6c0 1.38-1.12 2.5-2.5 2.5H19l-3 3.5-3-3.5h-2.5C9.12 20 8 18.88 8 17.5v-6Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="12" cy="14.5" r="1.5" fill="currentColor"/>
              <circle cx="16" cy="14.5" r="1.5" fill="currentColor"/>
              <circle cx="20" cy="14.5" r="1.5" fill="currentColor"/>
            </svg>
          </button>
        </div>
        {/* Main toggle — 3D Phone style icon */}
        <button
          className={`fab-main ${fabOpen ? 'fab-main-open' : ''}`}
          onClick={() => setFabOpen(p => !p)}
          aria-label="Menu"
          style={{ position: 'relative' }}
        >
          {/* Badge di FAB utama saat ada notif dan panel tertutup */}
          {!fabOpen && (gcUnread || aiUnread) && (
            <span className="fab-unread-badge" style={{
              top: -4, right: -4, width: 18, height: 18, fontSize: 11,
              background: '#ff3b3b', border: '2px solid #0a0a0a',
              boxShadow: '0 0 8px rgba(255,59,59,0.6)'
            }}>!</span>
          )}
          <span className="fab-main-icon">
            {/* 3D Phone icon when closed */}
            <svg className="fab-icon-chat" width="22" height="22" viewBox="0 0 24 24" fill="none">
              {/* Phone body with 3D depth */}
              <rect x="5" y="2" width="14" height="20" rx="3" ry="3" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.8"/>
              <rect x="6.5" y="3.5" width="11" height="14" rx="1" fill="currentColor" fillOpacity="0.25"/>
              {/* Screen glare */}
              <rect x="7" y="4" width="4" height="2" rx="0.5" fill="currentColor" fillOpacity="0.4"/>
              {/* Home button */}
              <circle cx="12" cy="20" r="1" fill="currentColor" fillOpacity="0.7"/>
              {/* Notch */}
              <rect x="10" y="2.5" width="4" height="1" rx="0.5" fill="currentColor" fillOpacity="0.5"/>
              {/* 3D side accent */}
              <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1"/>
            </svg>
            <svg className="fab-icon-close" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </span>
          <span className="fab-main-pulse" aria-hidden="true"/>
        </button>
      </div>

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

              {/* ── Music Management ── */}
              <div style={{ borderTop: '1px solid rgba(200,255,0,0.15)', paddingTop: 16, marginTop: 4 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#c8ff00', letterSpacing: 2, marginBottom: 10 }}>🎵 GANTI MUSIK LATAR</div>
                <div style={{ fontSize: 10, color: '#888', marginBottom: 12 }}>
                  Musik aktif: <span style={{ color: '#c8ff00' }}>{musicTrackName}</span>
                </div>

                {/* Toggle Autoplay */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: bgMusicAutoplay ? 'rgba(200,255,0,0.07)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${bgMusicAutoplay ? 'rgba(200,255,0,0.3)' : '#2a2a2a'}`,
                  borderRadius: 10, padding: '10px 14px', marginBottom: 12,
                }}>
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, color: bgMusicAutoplay ? '#c8ff00' : '#888', letterSpacing: 1 }}>
                      🔊 AUTOPLAY MUSIK
                    </div>
                    <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>
                      {bgMusicAutoplay ? 'Musik otomatis nyala saat user buka web' : 'Musik mati — user harus klik manual'}
                    </div>
                  </div>
                  <button
                    onClick={handleToggleBgMusicAutoplay}
                    type="button"
                    style={{
                      width: 48, height: 26, borderRadius: 13, border: 'none',
                      background: bgMusicAutoplay ? '#c8ff00' : '#333',
                      position: 'relative', cursor: 'pointer', transition: 'background 0.25s ease', flexShrink: 0,
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: 3, left: bgMusicAutoplay ? 25 : 3,
                      width: 20, height: 20, borderRadius: '50%',
                      background: bgMusicAutoplay ? '#000' : '#888',
                      transition: 'left 0.25s ease',
                    }} />
                  </button>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#aaa' }}>Nama Lagu (opsional)</span>
                  <input
                    type="text"
                    placeholder="Contoh: Lo-fi BGM"
                    value={adminMusicName}
                    onChange={e => setAdminMusicName(e.target.value)}
                    style={{ background: '#1a1a1a', border: '1px solid #2a3a00', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 12, outline: 'none' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: '#aaa' }}>URL Audio (.mp3, dll)</span>
                  <input
                    type="text"
                    placeholder="https://example.com/music.mp3"
                    value={adminMusicUrl}
                    onChange={e => setAdminMusicUrl(e.target.value)}
                    style={{ background: '#1a1a1a', border: '1px solid #2a3a00', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 12, outline: 'none' }}
                  />
                </label>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveBgMusic}
                  disabled={!adminMusicUrl.trim()}
                  style={{ opacity: adminMusicUrl.trim() ? 1 : 0.4 }}
                  type="button"
                >🎵 GANTI LAGU</button>
              </div>
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
            <div className="menu-logo">Kyoko</div>
            <button className="menu-close" type="button" onClick={() => setMenuOpen(false)} aria-label="Tutup menu">
              ×
            </button>
          </div>
          <nav className="menu-items">
            {[
              { label: 'Beranda', id: 'beranda' },
              { label: 'Karakter', id: 'karakter' },
              { label: 'Info & Berita', id: 'info-berita' },
              { label: 'Latar Belakang', id: 'latar-belakang' },
              { label: 'Direktori Grup', id: 'direktori-grup' },
              { label: 'Jual Beli Akun', id: 'jual-beli-akun' },
              { label: 'Rekomendasi Game', id: 'rekomendasi-game' },
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

      {/* zzz transition removed */}
    </div>
    </>
  )
}


export default App
