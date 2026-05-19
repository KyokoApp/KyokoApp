import React, { useState, useRef, useCallback, useEffect } from 'react'

interface BottomNavProps {
  onOpenGlobalChat: () => void
  onOpenAI: () => void
  onOpenManga: () => void
  onOpenNovel: () => void
  onOpenAnime: () => void
  onOpenRpg: () => void
  onScrollTo: (id: string) => void
  onLainnyaOpen?: () => void
  onLainnyaClose?: () => void
  onSectionNav?: (id: string) => void
  gcUnread?: boolean
  aiUnread?: boolean
}

// ── FAB items ──────────────────────────────────────────────────────────────────
const FAB_ITEMS = [
  {
    key: 'globalchat',
    label: 'Global Chat',
    sublabel: 'Chat bareng komunitas',
    color: '#a3e635',
    gradient: 'linear-gradient(135deg, #a3e635, #65a30d)',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    key: 'anime',
    label: 'AnimeStream',
    sublabel: 'Nonton anime gratis',
    color: '#c084fc',
    gradient: 'linear-gradient(135deg, #c084fc, #7c3aed)',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/>
        <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    key: 'manga',
    label: 'MangaStream',
    sublabel: 'Baca manga & komik',
    color: '#f472b6',
    gradient: 'linear-gradient(135deg, #f472b6, #be185d)',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="3" width="7" height="10" rx="1"/>
        <rect x="14" y="3" width="7" height="10" rx="1"/>
        <rect x="3" y="16" width="7" height="5" rx="1"/>
        <rect x="14" y="16" width="7" height="5" rx="1"/>
      </svg>
    ),
  },
  {
    key: 'novel',
    label: 'KyoNovel',
    sublabel: 'Baca light novel',
    color: '#fb923c',
    gradient: 'linear-gradient(135deg, #fb923c, #c2410c)',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <line x1="9" y1="7" x2="15" y2="7"/>
        <line x1="9" y1="11" x2="15" y2="11"/>
      </svg>
    ),
  },
  {
    key: 'rpg',
    label: 'RPG Game',
    sublabel: 'Battle & gacha RPG',
    color: '#facc15',
    gradient: 'linear-gradient(135deg, #facc15, #b45309)',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    ),
  },
  {
    key: 'ai',
    label: 'KyokoAI',
    sublabel: 'Tanya AI assistant',
    color: '#38bdf8',
    gradient: 'linear-gradient(135deg, #38bdf8, #0369a1)',
    icon: (
      <svg viewBox="0 0 32 32" width="24" height="24" fill="none">
        <path d="M8 11.5C8 10.12 9.12 9 10.5 9h11C22.88 9 24 10.12 24 11.5v6c0 1.38-1.12 2.5-2.5 2.5H19l-3 3.5-3-3.5h-2.5C9.12 20 8 18.88 8 17.5v-6Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <circle cx="12" cy="14.5" r="1.5" fill="currentColor"/>
        <circle cx="16" cy="14.5" r="1.5" fill="currentColor"/>
        <circle cx="20" cy="14.5" r="1.5" fill="currentColor"/>
      </svg>
    ),
  },
]

// ── Physics constants ───────────────────────────────────────────
const CHIP_W = 64
const CHIP_GAP = 12
const CHIP_STEP = CHIP_W + CHIP_GAP
const CLONE_COUNT = 2

function buildInfiniteItems(items: typeof FAB_ITEMS) {
  const head = items.slice(-CLONE_COUNT)
  const tail = items.slice(0, CLONE_COUNT)
  return [...head, ...items, ...tail]
}

// ── SwipeFAB (unchanged from original but polished) ─────────────
function SwipeFAB({
  items, handlers, gcUnread, aiUnread, onClose,
}: {
  items: typeof FAB_ITEMS
  handlers: Record<string, () => void>
  gcUnread?: boolean
  aiUnread?: boolean
  onClose: () => void
}) {
  const N = items.length
  const [virtualIdx, setVirtualIdx] = useState(CLONE_COUNT)
  const activeIdx = (virtualIdx - CLONE_COUNT + N * 100) % N
  const infiniteItems = useRef(buildInfiniteItems(items)).current
  const stripRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const drag = useRef({
    active: false, startX: 0, currentOffset: 0,
    targetOffset: 0, velocity: 0, lastX: 0, lastTime: 0,
  })

  const getBaseOffset = useCallback((vIdx: number) => {
    const containerW = stripRef.current?.clientWidth ?? 320
    const center = containerW / 2
    const chipCenter = vIdx * CHIP_STEP + CHIP_W / 2
    return center - chipCenter
  }, [])

  const applyTransform = useCallback((offset: number) => {
    if (trackRef.current) trackRef.current.style.transform = `translateX(${offset}px)`
  }, [])

  const updateChipStyles = useCallback((offset: number) => {
    if (!trackRef.current) return
    const containerW = stripRef.current?.clientWidth ?? 320
    const center = containerW / 2
    const chips = trackRef.current.querySelectorAll('.sfab-chip')
    chips.forEach((chipEl, i) => {
      const chip = chipEl as HTMLDivElement
      const chipCenter = offset + i * CHIP_STEP + CHIP_W / 2
      const dist = Math.abs(chipCenter - center) / CHIP_STEP
      const opacity = Math.max(0.08, 1 - dist * 0.42)
      const scale = dist < 0.5 ? 1.1 - dist * 0.2 : Math.max(0.85, 1.0 - (dist - 0.5) * 0.12)
      const dataColor = chip.getAttribute('data-color') ?? '#c8f500'
      if (dist < 0.3) {
        chip.style.opacity = '1'
        chip.style.transform = `scale(${scale})`
        chip.style.borderColor = `color-mix(in srgb, ${dataColor} 55%, transparent)`
        chip.style.background = `color-mix(in srgb, ${dataColor} 10%, #0d0d0b)`
        chip.style.boxShadow = `0 0 22px color-mix(in srgb, ${dataColor} 28%, transparent)`
        const icon = chip.querySelector('.sfab-chip-icon') as HTMLSpanElement | null
        if (icon) icon.style.color = dataColor
      } else {
        chip.style.opacity = String(opacity)
        chip.style.transform = `scale(${scale})`
        chip.style.borderColor = 'rgba(255,255,255,0.07)'
        chip.style.background = 'rgba(255,255,255,0.04)'
        chip.style.boxShadow = 'none'
        const icon = chip.querySelector('.sfab-chip-icon') as HTMLSpanElement | null
        if (icon) icon.style.color = 'rgba(255,255,255,0.45)'
      }
    })
  }, [])

  const springLoop = useCallback(() => {
    const d = drag.current
    if (!d.active) {
      const diff = d.targetOffset - d.currentOffset
      const springForce = diff * 0.22
      d.velocity = (d.velocity + springForce) * 0.78
      d.currentOffset += d.velocity
      applyTransform(d.currentOffset)
      updateChipStyles(d.currentOffset)
      if (Math.abs(d.velocity) < 0.15 && Math.abs(diff) < 0.15) {
        d.currentOffset = d.targetOffset
        applyTransform(d.currentOffset)
        updateChipStyles(d.currentOffset)
        return
      }
    }
    rafRef.current = requestAnimationFrame(springLoop)
  }, [applyTransform, updateChipStyles])

  const startSpring = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(springLoop)
  }, [springLoop])

  const snapToIndex = useCallback((vIdx: number) => {
    const clampedV = Math.max(0, Math.min(vIdx, infiniteItems.length - 1))
    drag.current.targetOffset = getBaseOffset(clampedV)
    drag.current.velocity = drag.current.velocity * 0.4
    startSpring()
  }, [getBaseOffset, infiniteItems.length, startSpring])

  const resolveAndSnap = useCallback(() => {
    const containerW = stripRef.current?.clientWidth ?? 320
    const center = containerW / 2
    let bestV = 0, bestDist = Infinity
    infiniteItems.forEach((_, i) => {
      const chipCenter = drag.current.currentOffset + i * CHIP_STEP + CHIP_W / 2
      const dist = Math.abs(chipCenter - center)
      if (dist < bestDist) { bestDist = dist; bestV = i }
    })
    let snappedV = bestV
    const realStart = CLONE_COUNT
    const realEnd = CLONE_COUNT + N - 1
    if (bestV < realStart) {
      snappedV = bestV + N
      drag.current.currentOffset = getBaseOffset(snappedV)
      drag.current.targetOffset = getBaseOffset(snappedV)
    } else if (bestV > realEnd) {
      snappedV = bestV - N
      drag.current.currentOffset = getBaseOffset(snappedV)
      drag.current.targetOffset = getBaseOffset(snappedV)
    }
    const newActiveIdx = (snappedV - CLONE_COUNT + N * 100) % N
    setVirtualIdx(snappedV)
    updateActiveCard(newActiveIdx)
    snapToIndex(snappedV)
  }, [N, getBaseOffset, snapToIndex])

  const updateActiveCard = useCallback((idx: number) => {
    setVirtualIdx(CLONE_COUNT + idx)
  }, [])

  useEffect(() => {
    const offset = getBaseOffset(CLONE_COUNT)
    drag.current.currentOffset = offset
    drag.current.targetOffset = offset
    applyTransform(offset)
    updateChipStyles(offset)
  }, [getBaseOffset, applyTransform, updateChipStyles])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current.active = true
    drag.current.startX = e.clientX
    drag.current.lastX = e.clientX
    drag.current.lastTime = performance.now()
    drag.current.velocity = 0
    cancelAnimationFrame(rafRef.current)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current.active) return
    const now = performance.now()
    const dx = e.clientX - drag.current.lastX
    const dt = Math.max(1, now - drag.current.lastTime)
    drag.current.velocity = dx / dt * 16
    drag.current.lastX = e.clientX
    drag.current.lastTime = now
    drag.current.currentOffset += dx
    applyTransform(drag.current.currentOffset)
    updateChipStyles(drag.current.currentOffset)
  }, [applyTransform, updateChipStyles])

  const onPointerUp = useCallback((_e: React.PointerEvent) => {
    if (!drag.current.active) return
    drag.current.active = false
    resolveAndSnap()
  }, [resolveAndSnap])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const active = items[activeIdx]

  return (
    <div className="sfab-outer">
      <div className="sfab-backdrop" onClick={onClose} />
      <div className="sfab-panel">
        <div className="sfab-handle" />
        <div className="sfab-header">
          <div className="sfab-title">Pilih Fitur</div>
          <button className="sfab-close" onClick={onClose} type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div
          className="sfab-card-main"
          style={{ '--card-color': active.color, '--card-grad': active.gradient } as React.CSSProperties}
          onClick={() => !drag.current.active && handlers[active.key]?.()}
        >
          <div className="sfab-card-bg" />
          <div className="sfab-card-icon" style={{ color: active.color, background: `color-mix(in srgb, ${active.color} 14%, #0a0a08)` }}>
            {active.icon}
            {active.key === 'globalchat' && gcUnread && <span className="sfab-unread" />}
            {active.key === 'ai' && aiUnread && <span className="sfab-unread" />}
          </div>
          <div className="sfab-card-info">
            <div className="sfab-card-name" key={active.key}>{active.label}</div>
            <div className="sfab-card-sub">{active.sublabel}</div>
          </div>
          <div className="sfab-card-arrow" style={{ color: active.color }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
        <div className="sfab-strip-label">← geser untuk pilih lainnya →</div>
        <div
          ref={stripRef}
          className="sfab-strip sfab-strip-infinite"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div ref={trackRef} className="sfab-strip-track">
            {infiniteItems.map((item, i) => (
              <div
                key={`${item.key}-${i}`}
                className="sfab-chip"
                data-color={item.color}
                style={{ '--chip-color': item.color } as React.CSSProperties}
                onClick={() => {
                  if (drag.current.active) return
                  const vIdx = CLONE_COUNT + items.findIndex(x => x.key === item.key)
                  setVirtualIdx(vIdx)
                  drag.current.targetOffset = getBaseOffset(vIdx)
                  drag.current.velocity = 0
                  startSpring()
                }}
              >
                <span className="sfab-chip-icon">{item.icon}</span>
                {item.key === 'globalchat' && gcUnread && <span className="sfab-chip-unread" />}
                {item.key === 'ai' && aiUnread && <span className="sfab-chip-unread" />}
              </div>
            ))}
          </div>
        </div>
        <div className="sfab-dots">
          {items.map((_, i) => (
            <div
              key={i}
              className={`sfab-dot ${i === activeIdx ? 'sfab-dot-active' : ''}`}
              onClick={() => {
                const vIdx = CLONE_COUNT + i
                setVirtualIdx(vIdx)
                drag.current.targetOffset = getBaseOffset(vIdx)
                drag.current.velocity = 0
                startSpring()
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Community Section types ────────────────────────────────────
type KomunitasTab = 'menu' | 'direktori' | 'market' | 'apk' | 'rating'

const KOMUNITAS_SECTIONS = [
  {
    id: 'direktori' as KomunitasTab,
    sectionId: 'direktori-grup',
    label: 'Direktori Grup',
    desc: 'Temukan & daftarkan grup komunitas WhatsApp',
    color: '#a3e635',
    num: '01',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    tags: ['WhatsApp', 'Anime', 'Game', 'Bot', 'Cari Teman'],
  },
  {
    id: 'market' as KomunitasTab,
    sectionId: 'jual-beli-akun',
    label: 'Market Akun',
    desc: 'Marketplace jual beli akun game komunitas',
    color: '#f472b6',
    num: '02',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
        <line x1="3" y1="6" x2="21" y2="6"/>
        <path d="M16 10a4 4 0 0 1-8 0"/>
      </svg>
    ),
    tags: ['Free Fire', 'ML', 'Genshin', 'Valorant', 'Honkai'],
  },
  {
    id: 'apk' as KomunitasTab,
    sectionId: 'apk-mod',
    label: 'APK & ScBot',
    desc: 'APK Mod, ScBot Free & Premium pilihan',
    color: '#fb923c',
    num: '03',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <rect x="5" y="2" width="14" height="20" rx="2"/>
        <line x1="12" y1="18" x2="12" y2="18" strokeWidth="3"/>
        <line x1="9" y1="7" x2="15" y2="7"/>
        <line x1="9" y1="11" x2="15" y2="11"/>
      </svg>
    ),
    tags: ['Game', 'Sosmed', 'AI', 'Bot', 'Tools'],
  },
  {
    id: 'rating' as KomunitasTab,
    sectionId: 'kirim-masukan',
    label: 'Rating & Ulasan',
    desc: 'Berikan bintang dan ulasan untuk KyokoMd',
    color: '#facc15',
    num: '04',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    ),
    tags: ['Review', 'Feedback', 'Saran', 'Kritik'],
  },
]

// ─── Community Section Detail Page ──────────────────────────────
function KomunitasSectionPage({
  section,
  onBack,
  onNavigate,
}: {
  section: typeof KOMUNITAS_SECTIONS[0]
  onBack: () => void
  onNavigate: (id: string) => void
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40)
    return () => clearTimeout(t)
  }, [])

  const featureMap: Record<KomunitasTab, { title: string; desc: string; cta: string; steps: string[]; tips: string[] }> = {
    menu: { title: '', desc: '', cta: '', steps: [], tips: [] },
    direktori: {
      title: 'Direktori Grup WhatsApp',
      desc: 'Temukan grup komunitas sesuai minatmu. Dari anime, game, teknologi sampai cari teman — semua ada di sini!',
      cta: 'Buka Direktori Grup',
      steps: ['Pilih kategori grup yang kamu cari', 'Klik link grup untuk bergabung langsung', 'Daftarkan grup milikmu gratis', 'Grup aktif selama 30 hari'],
      tips: ['Gunakan fitur pencarian untuk cari grup spesifik', 'Perbarui grup sebelum 30 hari untuk tetap tampil', 'Pastikan link WhatsApp masih aktif'],
    },
    market: {
      title: 'Marketplace Akun Game',
      desc: 'Jual atau beli akun game favoritmu. Ada Free Fire, Mobile Legends, Genshin Impact, dan banyak lagi!',
      cta: 'Buka Marketplace',
      steps: ['Browse listing akun berdasarkan game', 'Gunakan MM (Middleman) untuk keamanan', 'Upload listingmu gratis untuk dijual', 'Listing diverifikasi admin sebelum tampil'],
      tips: ['Selalu gunakan Middleman untuk transaksi aman', 'Foto akun harus jelas dan tidak blur', 'Harga wajar membantu cepat terjual'],
    },
    apk: {
      title: 'APK Mod & Script Bot',
      desc: 'Koleksi APK mod terseleksi dan ScBot WhatsApp free & premium dari tim KyokoMd.',
      cta: 'Lihat Koleksi APK',
      steps: ['Pilih tab APK MOD, ScBot Free, atau Premium', 'Filter berdasarkan kategori atau cari langsung', 'Klik DOWNLOAD untuk APK gratis', 'Hubungi via WA untuk ScBot Premium'],
      tips: ['Pastikan izin "Unknown Sources" diaktifkan', 'ScBot Premium didukung tim resmi KyokoMd', 'Update koleksi dilakukan secara berkala'],
    },
    rating: {
      title: 'Rating & Ulasan',
      desc: 'Bagikan pengalamanmu menggunakan KyokoMd! Ulasanmu membantu kami terus berkembang.',
      cta: 'Tulis Ulasan',
      steps: ['Pilih jumlah bintang (1-5)', 'Tulis nama dan ulasanmu', 'Klik Kirim Ulasan', 'Lihat ulasan dari pengguna lain'],
      tips: ['Ulasan jujur sangat kami hargai', 'Filter ulasan berdasarkan bintang', 'Semua ulasan real dari pengguna komunitas'],
    },
  }

  const info = featureMap[section.id]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9150,
      background: '#080808',
      display: 'flex', flexDirection: 'column',
      transform: visible ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.3s cubic-bezier(.4,0,.2,1)',
      overflow: 'hidden',
    }}>
      {/* Accent line top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, transparent, ${section.color}, transparent)`,
      }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '54px 20px 18px',
        background: `linear-gradient(180deg, color-mix(in srgb, ${section.color} 8%, #080808) 0%, #080808 100%)`,
        borderBottom: `1px solid ${section.color}18`,
        flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{
            width: 42, height: 42, borderRadius: 13,
            border: `1px solid ${section.color}30`,
            background: `color-mix(in srgb, ${section.color} 8%, transparent)`,
            color: section.color, display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 2,
            color: section.color, textTransform: 'uppercase', marginBottom: 3,
          }}>KOMUNITAS · {section.num}</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', letterSpacing: -0.3 }}>
            {section.label}
          </div>
        </div>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: `color-mix(in srgb, ${section.color} 12%, transparent)`,
          border: `1px solid ${section.color}25`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: section.color, flexShrink: 0,
        }}>
          {section.icon}
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '24px 20px',
        paddingBottom: 'calc(var(--bottom-nav-h, 70px) + 32px)',
      }}>
        {/* Hero desc */}
        <div style={{
          padding: '20px', borderRadius: 18, marginBottom: 22,
          background: `linear-gradient(135deg, color-mix(in srgb, ${section.color} 8%, transparent), transparent)`,
          border: `1px solid ${section.color}20`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 8, lineHeight: 1.4 }}>
            {info.title}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65 }}>
            {info.desc}
          </div>
        </div>

        {/* Tags */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 24 }}>
          {section.tags.map(t => (
            <span key={t} style={{
              fontSize: 11, fontWeight: 700, padding: '5px 12px',
              borderRadius: 99, color: section.color,
              background: `color-mix(in srgb, ${section.color} 10%, transparent)`,
              border: `1px solid ${section.color}25`,
            }}>{t}</span>
          ))}
        </div>

        {/* How it works */}
        <div style={{ marginBottom: 22 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,0.3)',
            textTransform: 'uppercase', marginBottom: 12,
          }}>CARA PAKAI</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {info.steps.map((step, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 14px', borderRadius: 14,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                animation: `bn-fade-up 0.35s ease ${i * 0.07}s both`,
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                  background: `color-mix(in srgb, ${section.color} 15%, transparent)`,
                  border: `1px solid ${section.color}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, color: section.color,
                  fontFamily: "'Bebas Neue', sans-serif",
                }}>{i + 1}</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>
                  {step}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tips */}
        <div style={{ marginBottom: 28 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,0.3)',
            textTransform: 'uppercase', marginBottom: 12,
          }}>TIPS & INFO</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {info.tips.map((tip, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5,
              }}>
                <span style={{ color: section.color, flexShrink: 0, fontSize: 14, lineHeight: 1.5 }}>◆</span>
                {tip}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => onNavigate(section.sectionId)}
          style={{
            width: '100%', padding: '16px',
            borderRadius: 16, border: 'none', cursor: 'pointer',
            background: `linear-gradient(135deg, ${section.color}, color-mix(in srgb, ${section.color} 70%, #000))`,
            color: section.color === '#facc15' || section.color === '#a3e635' ? '#000' : '#000',
            fontWeight: 900, fontSize: 15, letterSpacing: 0.8,
            boxShadow: `0 8px 32px ${section.color}35`,
            transition: 'transform 0.15s, box-shadow 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)' }}
          onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
        >
          {info.cta}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── Komunitas Hub (main menu) ───────────────────────────────────
function KomunitasHub({
  onClose,
  onOpenSection,
  onNavigate,
}: {
  onClose: () => void
  onOpenSection: (tab: KomunitasTab) => void
  onNavigate: (id: string) => void
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30)
    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9100,
      background: '#080808',
      display: 'flex', flexDirection: 'column',
      transform: visible ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.28s cubic-bezier(.4,0,.2,1)',
      overflow: 'hidden',
    }}>
      {/* header accent */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: 'linear-gradient(90deg, transparent, #c8f500 40%, #a3e635 60%, transparent)',
      }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '52px 20px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#080808', flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            width: 42, height: 42, borderRadius: 13,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 2,
            color: '#c8f500', textTransform: 'uppercase', marginBottom: 3,
          }}>◆ HUB KOMUNITAS</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: -0.3 }}>
            KOMUNITAS
          </div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 1,
          color: '#c8f500', background: 'rgba(200,245,0,0.1)',
          border: '1px solid rgba(200,245,0,0.22)',
          borderRadius: 8, padding: '4px 10px',
        }}>4 FITUR</div>
      </div>

      {/* Body */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '0 16px',
        paddingBottom: 'calc(var(--bottom-nav-h,70px) + 24px)',
      }}>
        {/* Headline */}
        <div style={{ padding: '24px 4px 20px' }}>
          <div style={{
            fontSize: 11, fontWeight: 800, letterSpacing: 2,
            color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase',
            marginBottom: 8,
          }}>Semua Fitur Komunitas</div>
          <div style={{
            fontSize: 13, color: 'rgba(255,255,255,0.38)',
            lineHeight: 1.6,
          }}>
            Direktori grup, marketplace akun game, koleksi APK, dan ruang ulasan. Pilih fitur di bawah.
          </div>
        </div>

        {/* Section cards 2x2 */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 12, marginBottom: 24,
        }}>
          {KOMUNITAS_SECTIONS.map((sec, i) => (
            <button
              key={sec.id}
              onClick={() => onOpenSection(sec.id)}
              type="button"
              style={{
                position: 'relative', overflow: 'hidden',
                borderRadius: 20,
                border: `1px solid color-mix(in srgb, ${sec.color} 20%, transparent)`,
                background: 'rgba(255,255,255,0.03)',
                padding: '18px 16px',
                cursor: 'pointer', textAlign: 'left',
                transition: 'transform 0.18s, background 0.15s',
                animation: `bn-card-in 0.4s cubic-bezier(.34,1.3,.64,1) ${i * 0.08}s both`,
              }}
              onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)' }}
              onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
            >
              {/* number watermark */}
              <div style={{
                position: 'absolute', top: -4, right: 12,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 52, fontWeight: 900,
                color: sec.color, opacity: 0.06,
                lineHeight: 1, userSelect: 'none',
              }}>{sec.num}</div>

              <div style={{
                display: 'flex', alignItems: 'flex-start',
                justifyContent: 'space-between', marginBottom: 14,
              }}>
                <div style={{
                  width: 50, height: 50, borderRadius: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: sec.color,
                  background: `color-mix(in srgb, ${sec.color} 12%, transparent)`,
                  border: `1px solid ${sec.color}20`,
                }}>
                  {sec.icon}
                </div>
                <div style={{
                  color: `color-mix(in srgb, ${sec.color} 50%, transparent)`,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </div>
              <div style={{
                fontSize: 14, fontWeight: 800, marginBottom: 5,
                lineHeight: 1.2, color: sec.color,
              }}>{sec.label}</div>
              <div style={{
                fontSize: 11, color: 'rgba(255,255,255,0.33)',
                lineHeight: 1.4,
              }}>{sec.desc}</div>

              {/* glow */}
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: `radial-gradient(ellipse at 50% 120%, color-mix(in srgb, ${sec.color} 14%, transparent), transparent 60%)`,
              }} />
            </button>
          ))}
        </div>

        {/* Quick access */}
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 2,
          color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 10,
        }}>AKSES LANGSUNG</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {KOMUNITAS_SECTIONS.map(sec => (
            <button
              key={`q-${sec.id}`}
              onClick={() => onNavigate(sec.sectionId)}
              type="button"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '9px 14px', borderRadius: 99,
                border: `1px solid color-mix(in srgb, ${sec.color} 25%, transparent)`,
                background: `color-mix(in srgb, ${sec.color} 6%, transparent)`,
                color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 700,
                cursor: 'pointer',
                transition: 'transform 0.12s',
              }}
              onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.94)' }}
              onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
            >
              <span style={{ color: sec.color, display: 'flex', width: 12, height: 12, overflow: 'hidden', flexShrink: 0 }}>
                {sec.icon}
              </span>
              <span>{sec.label.split(' ')[0]}</span>
            </button>
          ))}
        </div>

        {/* Footer note */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)', marginBottom: 16,
          fontSize: 12, color: 'rgba(255,255,255,0.28)', lineHeight: 1.5,
        }}>
          <span>⚡</span>
          <span>Fitur komunitas terus diperbarui. Daftarkan grup atau akun game kamu sekarang!</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main BottomNav ────────────────────────────────────────────────────────────
export default function BottomNav({
  onOpenGlobalChat, onOpenAI, onOpenManga, onOpenNovel, onOpenAnime, onOpenRpg,
  onScrollTo, onLainnyaOpen, onLainnyaClose, onSectionNav, gcUnread, aiUnread,
}: BottomNavProps) {
  const [fabOpen, setFabOpen] = useState(false)
  const [komunitasOpen, setKomunitasOpen] = useState(false)
  const [komunitasTab, setKomunitasTab] = useState<KomunitasTab>('menu')
  const [activeTab, setActiveTab] = useState('beranda')

  const openKomunitas = () => {
    setKomunitasOpen(true)
    setKomunitasTab('menu')
    setFabOpen(false)
    onLainnyaOpen?.()
  }

  const closeKomunitas = () => {
    setKomunitasOpen(false)
    setKomunitasTab('menu')
    onLainnyaClose?.()
  }

  const openSection = (tab: KomunitasTab) => {
    setKomunitasTab(tab)
  }

  const handleNavigate = (sectionId: string) => {
    // Navigate to actual section
    setKomunitasOpen(false)
    setKomunitasTab('menu')
    onSectionNav?.(sectionId)
  }

  const handlers: Record<string, () => void> = {
    globalchat: () => { setFabOpen(false); onOpenGlobalChat() },
    ai:          () => { setFabOpen(false); onOpenAI() },
    manga:       () => { setFabOpen(false); onOpenManga() },
    novel:       () => { setFabOpen(false); onOpenNovel() },
    anime:       () => { setFabOpen(false); onOpenAnime() },
    rpg:         () => { setFabOpen(false); onOpenRpg() },
  }

  const hasUnread = gcUnread || aiUnread

  const currentSection = KOMUNITAS_SECTIONS.find(s => s.id === komunitasTab)

  return (
    <>
      {fabOpen && (
        <SwipeFAB
          items={FAB_ITEMS}
          handlers={handlers}
          gcUnread={gcUnread}
          aiUnread={aiUnread}
          onClose={() => setFabOpen(false)}
        />
      )}

      {/* Komunitas Hub */}
      {komunitasOpen && komunitasTab === 'menu' && (
        <KomunitasHub
          onClose={closeKomunitas}
          onOpenSection={openSection}
          onNavigate={handleNavigate}
        />
      )}

      {/* Individual section pages */}
      {komunitasOpen && komunitasTab !== 'menu' && currentSection && (
        <KomunitasSectionPage
          section={currentSection}
          onBack={() => setKomunitasTab('menu')}
          onNavigate={handleNavigate}
        />
      )}

      <nav className="bottom-nav">
        <button
          className={`bn-tab ${activeTab === 'beranda' && !komunitasOpen ? 'bn-tab-active' : ''}`}
          onClick={() => { setActiveTab('beranda'); onScrollTo('beranda'); closeKomunitas() }}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
            <polyline points="9 21 9 12 15 12 15 21"/>
          </svg>
          <span>HOME</span>
        </button>

        <button
          className={`bn-tab ${activeTab === 'rekomendasi-game' && !komunitasOpen ? 'bn-tab-active' : ''}`}
          onClick={() => { setActiveTab('rekomendasi-game'); onScrollTo('rekomendasi-game'); closeKomunitas() }}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 11h4M8 9v4"/>
            <circle cx="15" cy="12" r="1" fill="currentColor"/>
            <circle cx="18" cy="10" r="1" fill="currentColor"/>
            <rect x="2" y="6" width="20" height="12" rx="4"/>
          </svg>
          <span>GAME</span>
        </button>

        <div className="bn-fab-wrap">
          <button
            className={`bn-fab ${fabOpen ? 'bn-fab-open' : ''}`}
            onClick={() => { setFabOpen(p => !p); if (komunitasOpen) closeKomunitas() }}
            type="button"
            aria-label="Menu"
          >
            {!fabOpen && hasUnread && <span className="bn-fab-badge" />}
            <svg className="bn-fab-open-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              {fabOpen
                ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
                : <><path d="M12 5v14M5 12h14"/></>
              }
            </svg>
            <span className="bn-fab-glow" aria-hidden="true" />
          </button>
        </div>

        <button
          className={`bn-tab ${activeTab === 'berita-game' && !komunitasOpen ? 'bn-tab-active' : ''}`}
          onClick={() => { setActiveTab('berita-game'); onScrollTo('berita-game'); closeKomunitas() }}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
            <line x1="10" y1="7" x2="18" y2="7"/>
            <line x1="10" y1="11" x2="18" y2="11"/>
            <line x1="10" y1="15" x2="14" y2="15"/>
          </svg>
          <span>BERITA</span>
        </button>

        <button
          className={`bn-tab ${komunitasOpen ? 'bn-tab-active' : ''}`}
          onClick={() => { komunitasOpen ? closeKomunitas() : openKomunitas() }}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          <span>LAINNYA</span>
        </button>
      </nav>

      <style>{`
        @keyframes bn-fade-up {
          from { opacity:0; transform: translateY(10px); }
          to { opacity:1; transform: translateY(0); }
        }
        @keyframes bn-card-in {
          from { opacity:0; transform: translateY(16px) scale(0.95) }
          to   { opacity:1; transform: translateY(0) scale(1) }
        }

        /* ── Swipe FAB ─────────────────────────────────────────── */
        .sfab-outer {
          position: fixed; inset: 0; z-index: 9000;
          display: flex; align-items: flex-end; justify-content: center;
          pointer-events: none;
        }
        .sfab-backdrop {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.75);
          backdrop-filter: blur(8px);
          pointer-events: auto;
          animation: sfabBdIn .2s ease;
        }
        @keyframes sfabBdIn { from { opacity:0 } to { opacity:1 } }
        .sfab-panel {
          position: relative; z-index: 1;
          width: 100%; max-width: 480px;
          background: #0d0d0b;
          border-top: 1px solid rgba(200,245,0,0.14);
          border-left: 1px solid rgba(255,255,255,0.04);
          border-right: 1px solid rgba(255,255,255,0.04);
          border-radius: 28px 28px 0 0;
          padding-bottom: calc(var(--bottom-nav-h, 70px) + 4px);
          pointer-events: auto;
          animation: sfabPanelIn .32s cubic-bezier(.34,1.3,.64,1);
        }
        @keyframes sfabPanelIn {
          from { transform: translateY(110%); opacity:0 }
          to   { transform: translateY(0);   opacity:1 }
        }
        .sfab-handle {
          width: 36px; height: 4px; border-radius: 2px;
          background: rgba(255,255,255,0.12); margin: 10px auto 0;
        }
        .sfab-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 20px 10px;
        }
        .sfab-title {
          font-size: 10px; font-weight: 800; letter-spacing: 0.12em;
          color: rgba(255,255,255,0.3); text-transform: uppercase;
        }
        .sfab-close {
          width: 28px; height: 28px; border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.45);
          display: flex; align-items: center; justify-content: center; cursor: pointer;
        }
        .sfab-card-main {
          margin: 0 16px 16px; padding: 18px 20px; border-radius: 20px;
          background: rgba(255,255,255,0.04);
          border: 1px solid color-mix(in srgb, var(--card-color,#c8f500) 22%, transparent);
          display: flex; align-items: center; gap: 16px;
          cursor: pointer; position: relative; overflow: hidden;
          transition: transform .15s;
        }
        .sfab-card-main:active { transform: scale(0.98); }
        .sfab-card-bg {
          position: absolute; inset: 0;
          background: var(--card-grad, linear-gradient(135deg,#c8f500,#a3e635));
          opacity: 0.05; pointer-events: none;
        }
        .sfab-card-icon {
          width: 54px; height: 54px; border-radius: 16px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; position: relative;
        }
        .sfab-unread {
          position: absolute; top: 3px; right: 3px;
          width: 10px; height: 10px; border-radius: 50%;
          background: #ff3b3b; border: 2px solid #0d0d0b;
        }
        .sfab-card-info { flex: 1; min-width: 0; }
        .sfab-card-name { font-size: 17px; font-weight: 800; color: #fff; margin-bottom: 3px; }
        .sfab-card-sub { font-size: 12px; color: rgba(255,255,255,0.38); }
        .sfab-card-arrow { flex-shrink: 0; }
        .sfab-strip-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
          color: rgba(255,255,255,0.18); text-transform: uppercase;
          text-align: center; margin-bottom: 8px;
        }
        .sfab-strip {
          overflow: hidden; padding: 4px 0 4px 0;
          cursor: grab; touch-action: none; user-select: none;
          position: relative;
        }
        .sfab-strip-infinite { cursor: grab; }
        .sfab-strip-infinite:active { cursor: grabbing; }
        .sfab-strip::after {
          content: ''; position: absolute; top: 4px; bottom: 4px;
          left: 50%; transform: translateX(-50%);
          width: 72px; border-radius: 20px;
          border: 1.5px solid rgba(255,255,255,0.08); pointer-events: none;
        }
        .sfab-strip-track {
          display: flex; gap: 12px; width: max-content;
          will-change: transform; padding: 2px 0;
        }
        .sfab-chip {
          width: 64px; height: 64px; border-radius: 18px;
          border: 1.5px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.04);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0; position: relative;
        }
        .sfab-chip-icon { display:flex;align-items:center;justify-content:center;pointer-events:none; }
        .sfab-chip-unread {
          position: absolute; top: 6px; right: 6px;
          width: 7px; height: 7px; border-radius: 50%;
          background: #ff3b3b; border: 1.5px solid #0d0d0b;
        }
        .sfab-dots { display: flex; justify-content: center; gap: 6px; padding: 10px 0 6px; }
        .sfab-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: rgba(255,255,255,0.14); cursor: pointer; transition: all .22s;
        }
        .sfab-dot-active { width: 22px; border-radius: 3px; background: #c8f500; }

        /* ── Bottom nav ────────────────────────────────────────── */
        .bottom-nav {
          position: fixed; bottom: 0; left: 0; right: 0;
          height: var(--bottom-nav-h, 70px);
          background: rgba(8,8,5,0.97);
          border-top: 1px solid rgba(200,245,0,0.1);
          display: flex; align-items: center; justify-content: space-around;
          padding: 0 4px; z-index: 9200;
          backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        }
        .bn-tab {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; gap: 3px; padding: 8px 2px;
          border: none; background: none;
          color: rgba(255,255,255,0.35);
          font-size: 9px; font-weight: 700; letter-spacing: 0.04em;
          cursor: pointer; transition: color .2s;
        }
        .bn-tab:active { opacity: 0.7; }
        .bn-tab-active { color: #c8f500; }
        .bn-fab-wrap {
          flex: 0 0 60px; display: flex;
          align-items: center; justify-content: center; position: relative;
        }
        .bn-fab {
          width: 54px; height: 54px; border-radius: 50%; border: none;
          background: linear-gradient(135deg, #c8f500, #a3e635); color: #0a0a05;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 20px rgba(200,245,0,0.35);
          position: relative; margin-bottom: 10px;
          transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s;
        }
        .bn-fab.bn-fab-open {
          transform: rotate(45deg) scale(0.9);
          box-shadow: 0 4px 30px rgba(200,245,0,0.5);
        }
        .bn-fab:active { transform: scale(0.92); }
        .bn-fab-open-icon { pointer-events: none; }
        .bn-fab-glow {
          position: absolute; inset: -4px; border-radius: 50%;
          background: radial-gradient(circle, rgba(200,245,0,0.3) 0%, transparent 70%);
          opacity: 0; pointer-events: none;
          animation: fabGlowPulse 2.5s ease-in-out infinite;
        }
        @keyframes fabGlowPulse {
          0%,100% { opacity:0; transform:scale(1); }
          50% { opacity:1; transform:scale(1.3); }
        }
        .bn-fab-badge {
          position: absolute; top: 2px; right: 2px;
          width: 10px; height: 10px; border-radius: 50%;
          background: #ff3b3b; border: 2px solid #0a0a05;
          pointer-events: none;
          animation: badgePulse 1.5s ease-in-out infinite;
        }
        @keyframes badgePulse {
          0%,100% { transform:scale(1); }
          50% { transform:scale(1.25); }
        }
      `}</style>
    </>
  )
}
