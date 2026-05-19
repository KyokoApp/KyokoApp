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

// ── Horizontal Swipe FAB ───────────────────────────────────────────────────────
function SwipeFAB({
  items,
  handlers,
  gcUnread,
  aiUnread,
  onClose,
}: {
  items: typeof FAB_ITEMS
  handlers: Record<string, () => void>
  gcUnread?: boolean
  aiUnread?: boolean
  onClose: () => void
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)
  const startIdxRef = useRef(0)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    startXRef.current = e.clientX
    startIdxRef.current = activeIdx
    setIsDragging(true)
    setDragX(0)
  }, [activeIdx])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    const dx = e.clientX - startXRef.current
    setDragX(dx)
  }, [isDragging])

  const onPointerUp = useCallback((_e: React.PointerEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    const threshold = 50
    if (dragX < -threshold) {
      setActiveIdx(i => Math.min(i + 1, items.length - 1))
    } else if (dragX > threshold) {
      setActiveIdx(i => Math.max(i - 1, 0))
    }
    setDragX(0)
  }, [isDragging, dragX, items.length])

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

        {/* Main active card */}
        <div
          className="sfab-card-main"
          style={{ '--card-color': active.color, '--card-grad': active.gradient } as React.CSSProperties}
          onClick={() => handlers[active.key]?.()}
        >
          <div className="sfab-card-bg" />
          <div className="sfab-card-icon" style={{ color: active.color, background: `color-mix(in srgb, ${active.color} 14%, #0a0a08)` }}>
            {active.icon}
            {active.key === 'globalchat' && gcUnread && <span className="sfab-unread" />}
            {active.key === 'ai' && aiUnread && <span className="sfab-unread" />}
          </div>
          <div className="sfab-card-info">
            <div className="sfab-card-name">{active.label}</div>
            <div className="sfab-card-sub">{active.sublabel}</div>
          </div>
          <div className="sfab-card-arrow" style={{ color: active.color }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>

        {/* Swipe strip */}
        <div className="sfab-strip-label">← geser untuk pilih lainnya →</div>
        <div
          className={`sfab-strip ${isDragging ? 'sfab-strip-drag' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            className="sfab-strip-track"
            style={{
              transform: `translateX(calc(${20 - activeIdx * 76}px + ${dragX * 0.5}px))`,
              transition: isDragging ? 'none' : 'transform 0.32s cubic-bezier(.34,1.4,.64,1)',
            }}
          >
            {items.map((item, i) => {
              const isActive = i === activeIdx
              const dist = Math.abs(i - activeIdx)
              const opacity = dist === 0 ? 1 : dist === 1 ? 0.65 : dist === 2 ? 0.35 : 0.15
              return (
                <div
                  key={item.key}
                  className={`sfab-chip ${isActive ? 'sfab-chip-active' : ''}`}
                  style={{ '--chip-color': item.color, opacity } as React.CSSProperties}
                  onClick={() => { if (isActive) handlers[item.key]?.(); else setActiveIdx(i) }}
                >
                  <span className="sfab-chip-icon" style={{ color: isActive ? item.color : 'rgba(255,255,255,0.45)' }}>
                    {item.icon}
                  </span>
                  {item.key === 'globalchat' && gcUnread && <span className="sfab-chip-unread" />}
                  {item.key === 'ai' && aiUnread && <span className="sfab-chip-unread" />}
                </div>
              )
            })}
          </div>
        </div>

        {/* Dots indicator */}
        <div className="sfab-dots">
          {items.map((_, i) => (
            <div
              key={i}
              className={`sfab-dot ${i === activeIdx ? 'sfab-dot-active' : ''}`}
              onClick={() => setActiveIdx(i)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Lainnya Full Page ─────────────────────────────────────────────────────────
const LAINNYA_SECTIONS = [
  {
    id: 'direktori-grup',
    label: 'Direktori Grup',
    desc: 'Temukan & daftarkan grup komunitas',
    color: '#a3e635',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    id: 'jual-beli-akun',
    label: 'Market Jual Beli',
    desc: 'Marketplace akun game komunitas',
    color: '#f472b6',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
        <line x1="3" y1="6" x2="21" y2="6"/>
        <path d="M16 10a4 4 0 0 1-8 0"/>
      </svg>
    ),
  },
  {
    id: 'apk-mod',
    label: 'APK & ScBot',
    desc: 'APK Mod, ScBot Free & Premium',
    color: '#fb923c',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="5" y="2" width="14" height="20" rx="2"/>
        <line x1="12" y1="18" x2="12" y2="18" strokeWidth="3"/>
        <line x1="9" y1="7" x2="15" y2="7"/>
        <line x1="9" y1="11" x2="15" y2="11"/>
      </svg>
    ),
  },
  {
    id: 'kirim-masukan',
    label: 'Rating & Ulasan',
    desc: 'Berikan rating untuk KyokoMd',
    color: '#facc15',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    ),
  },
]

function LainnyaFullPage({
  onNavigate,
  onClose,
}: {
  onNavigate: (id: string) => void
  onClose: () => void
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30)
    return () => clearTimeout(t)
  }, [])

  const handleNav = (id: string) => {
    setVisible(false)
    setTimeout(() => { onNavigate(id); onClose() }, 220)
  }

  return (
    <div className={`lainnya-page ${visible ? 'lainnya-page-in' : ''}`}>
      {/* Header */}
      <div className="lainnya-page-header">
        <button className="lainnya-page-back" onClick={onClose} type="button">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="lainnya-page-title-wrap">
          <div className="lainnya-page-title">KOMUNITAS</div>
          <div className="lainnya-page-sub">KyokoMd · Hub Komunitas</div>
        </div>
        <div className="lainnya-page-badge">4 FITUR</div>
      </div>

      <div className="lainnya-page-body">
        {/* Headline */}
        <div className="lainnya-page-headline">
          <div className="lainnya-headline-tag">◆ HUB KOMUNITAS</div>
          <h2 className="lainnya-headline-title">Semua Fitur<br/>Komunitas</h2>
          <p className="lainnya-headline-desc">Direktori grup, marketplace akun game, koleksi APK mod, dan ruang ulasan pengguna.</p>
        </div>

        {/* Section cards 2x2 grid */}
        <div className="lainnya-cards-grid">
          {LAINNYA_SECTIONS.map((sec, i) => (
            <button
              key={sec.id}
              className="lainnya-sec-card"
              style={{ '--sec-color': sec.color, animationDelay: `${i * 0.07}s` } as React.CSSProperties}
              onClick={() => handleNav(sec.id)}
              type="button"
            >
              <div className="lainnya-sec-card-top">
                <div className="lainnya-sec-icon" style={{ color: sec.color, background: `color-mix(in srgb, ${sec.color} 12%, transparent)` }}>
                  {sec.icon}
                </div>
                <div className="lainnya-sec-arrow" style={{ color: `color-mix(in srgb, ${sec.color} 50%, transparent)` }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </div>
              <div className="lainnya-sec-label" style={{ color: sec.color }}>{sec.label}</div>
              <div className="lainnya-sec-desc">{sec.desc}</div>
              <div className="lainnya-sec-glow" style={{ background: `radial-gradient(ellipse at 50% 120%, color-mix(in srgb, ${sec.color} 18%, transparent), transparent 60%)` }} />
            </button>
          ))}
        </div>

        {/* Quick pills */}
        <div className="lainnya-quick-header">AKSES CEPAT</div>
        <div className="lainnya-quick-row">
          {LAINNYA_SECTIONS.map((sec) => (
            <button
              key={`q-${sec.id}`}
              className="lainnya-quick-pill"
              style={{ '--sec-color': sec.color } as React.CSSProperties}
              onClick={() => handleNav(sec.id)}
              type="button"
            >
              <span style={{ color: sec.color, display:'flex',alignItems:'center',width:14,height:14,overflow:'hidden',flexShrink:0 }}>
                {sec.icon}
              </span>
              <span>{sec.label.split(' ')[0]}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="lainnya-footer-note">
          <span>⚡</span>
          <span>Daftarkan grup atau akun game kamu. Fitur diperbarui berkala!</span>
        </div>
      </div>
    </div>
  )
}

// ── Main BottomNav ────────────────────────────────────────────────────────────
export default function BottomNav({
  onOpenGlobalChat, onOpenAI, onOpenManga, onOpenNovel, onOpenAnime, onOpenRpg,
  onScrollTo, onLainnyaOpen, onLainnyaClose, gcUnread, aiUnread,
}: BottomNavProps) {
  const [fabOpen, setFabOpen] = useState(false)
  const [lainnyaOpen, setLainnyaOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('beranda')

  const openLainnya = () => {
    setLainnyaOpen(true)
    setFabOpen(false)
    onLainnyaOpen?.()
  }

  const closeLainnya = () => {
    setLainnyaOpen(false)
    onLainnyaClose?.()
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

      {lainnyaOpen && (
        <LainnyaFullPage
          onNavigate={(id) => { onScrollTo(id) }}
          onClose={closeLainnya}
        />
      )}

      <nav className="bottom-nav">
        <button
          className={`bn-tab ${activeTab === 'beranda' && !lainnyaOpen ? 'bn-tab-active' : ''}`}
          onClick={() => { setActiveTab('beranda'); onScrollTo('beranda'); closeLainnya() }}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
            <polyline points="9 21 9 12 15 12 15 21"/>
          </svg>
          <span>HOME</span>
        </button>

        <button
          className={`bn-tab ${activeTab === 'rekomendasi-game' && !lainnyaOpen ? 'bn-tab-active' : ''}`}
          onClick={() => { setActiveTab('rekomendasi-game'); onScrollTo('rekomendasi-game'); closeLainnya() }}
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
            onClick={() => { setFabOpen(p => !p); if (lainnyaOpen) closeLainnya() }}
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
          className={`bn-tab ${activeTab === 'berita-game' && !lainnyaOpen ? 'bn-tab-active' : ''}`}
          onClick={() => { setActiveTab('berita-game'); onScrollTo('berita-game'); closeLainnya() }}
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
          className={`bn-tab ${lainnyaOpen ? 'bn-tab-active' : ''}`}
          onClick={() => { lainnyaOpen ? closeLainnya() : openLainnya() }}
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
        /* ── Swipe FAB ─────────────────────────────────────────── */
        .sfab-outer {
          position: fixed;
          inset: 0;
          z-index: 9000;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          pointer-events: none;
        }
        .sfab-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.72);
          backdrop-filter: blur(8px);
          pointer-events: auto;
          animation: sfabBdIn .2s ease;
        }
        @keyframes sfabBdIn { from { opacity:0 } to { opacity:1 } }

        .sfab-panel {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 480px;
          background: #0d0d0b;
          border-top: 1px solid rgba(200,245,0,0.14);
          border-left: 1px solid rgba(255,255,255,0.04);
          border-right: 1px solid rgba(255,255,255,0.04);
          border-radius: 28px 28px 0 0;
          padding-bottom: calc(var(--bottom-nav-h, 70px) + 4px);
          pointer-events: auto;
          animation: sfabPanelIn .3s cubic-bezier(.34,1.3,.64,1);
        }
        @keyframes sfabPanelIn {
          from { transform: translateY(110%); opacity:0 }
          to   { transform: translateY(0);   opacity:1 }
        }
        .sfab-handle {
          width: 36px; height: 4px;
          border-radius: 2px;
          background: rgba(255,255,255,0.12);
          margin: 10px auto 0;
        }
        .sfab-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px 10px;
        }
        .sfab-title {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          color: rgba(255,255,255,0.3);
          text-transform: uppercase;
        }
        .sfab-close {
          width: 28px; height: 28px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.05);
          color: rgba(255,255,255,0.45);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
        }

        .sfab-card-main {
          margin: 0 16px 16px;
          padding: 18px 20px;
          border-radius: 20px;
          background: rgba(255,255,255,0.04);
          border: 1px solid color-mix(in srgb, var(--card-color,#c8f500) 22%, transparent);
          display: flex;
          align-items: center;
          gap: 16px;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: transform .15s;
        }
        .sfab-card-main:active { transform: scale(0.98); }
        .sfab-card-bg {
          position: absolute; inset: 0;
          background: var(--card-grad, linear-gradient(135deg,#c8f500,#a3e635));
          opacity: 0.05;
          pointer-events: none;
        }
        .sfab-card-icon {
          width: 54px; height: 54px;
          border-radius: 16px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          position: relative;
        }
        .sfab-unread {
          position: absolute; top: 3px; right: 3px;
          width: 10px; height: 10px;
          border-radius: 50%;
          background: #ff3b3b;
          border: 2px solid #0d0d0b;
        }
        .sfab-card-info { flex: 1; min-width: 0; }
        .sfab-card-name {
          font-size: 17px; font-weight: 800; color: #fff; margin-bottom: 3px;
        }
        .sfab-card-sub { font-size: 12px; color: rgba(255,255,255,0.38); }
        .sfab-card-arrow { flex-shrink: 0; }

        .sfab-strip-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
          color: rgba(255,255,255,0.18); text-transform: uppercase;
          text-align: center; margin-bottom: 8px;
        }
        .sfab-strip {
          overflow: hidden;
          padding: 4px 0 4px 0;
          cursor: grab;
          touch-action: none;
          user-select: none;
        }
        .sfab-strip-drag { cursor: grabbing; }
        .sfab-strip-track {
          display: flex; gap: 12px;
          width: max-content;
          will-change: transform;
          padding: 2px 0;
        }
        .sfab-chip {
          width: 64px; height: 64px;
          border-radius: 18px;
          border: 1.5px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.04);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0; position: relative;
          transition: border-color .2s, background .2s, transform .22s, box-shadow .22s;
        }
        .sfab-chip-active {
          border-color: color-mix(in srgb, var(--chip-color,#c8f500) 55%, transparent) !important;
          background: color-mix(in srgb, var(--chip-color,#c8f500) 10%, #0d0d0b) !important;
          transform: scale(1.1);
          box-shadow: 0 0 22px color-mix(in srgb, var(--chip-color,#c8f500) 28%, transparent);
        }
        .sfab-chip-icon { display:flex;align-items:center;justify-content:center;pointer-events:none; }
        .sfab-chip-unread {
          position: absolute; top: 6px; right: 6px;
          width: 7px; height: 7px; border-radius: 50%;
          background: #ff3b3b; border: 1.5px solid #0d0d0b;
        }
        .sfab-dots {
          display: flex; justify-content: center; gap: 6px;
          padding: 10px 0 6px;
        }
        .sfab-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: rgba(255,255,255,0.14); cursor: pointer;
          transition: all .22s;
        }
        .sfab-dot-active { width: 22px; border-radius: 3px; background: #c8f500; }

        /* ── Lainnya Full Page ─────────────────────────────────── */
        .lainnya-page {
          position: fixed; inset: 0; z-index: 9100;
          background: #080808;
          display: flex; flex-direction: column;
          transform: translateX(100%);
          transition: transform .28s cubic-bezier(.4,0,.2,1);
          overflow: hidden;
        }
        .lainnya-page-in { transform: translateX(0); }

        .lainnya-page-header {
          display: flex; align-items: center; gap: 14px;
          padding: 52px 20px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: #080808;
          flex-shrink: 0;
        }
        .lainnya-page-back {
          width: 40px; height: 40px; border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.05); color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
          transition: background .15s;
        }
        .lainnya-page-back:active { background: rgba(255,255,255,0.1); }
        .lainnya-page-title-wrap { flex: 1; }
        .lainnya-page-title { font-size: 18px; font-weight: 900; color: #fff; letter-spacing: 0.06em; }
        .lainnya-page-sub { font-size: 11px; color: rgba(255,255,255,0.32); margin-top: 2px; }
        .lainnya-page-badge {
          font-size: 10px; font-weight: 800; letter-spacing: 0.06em;
          color: #c8f500;
          background: rgba(200,245,0,0.1);
          border: 1px solid rgba(200,245,0,0.22);
          border-radius: 8px; padding: 4px 10px;
        }

        .lainnya-page-body {
          flex: 1; overflow-y: auto;
          padding: 0 16px calc(var(--bottom-nav-h,70px) + 24px);
          -webkit-overflow-scrolling: touch;
        }

        .lainnya-page-headline { padding: 28px 4px 24px; }
        .lainnya-headline-tag {
          font-size: 10px; font-weight: 800; letter-spacing: 0.12em;
          color: #c8f500; text-transform: uppercase; margin-bottom: 10px;
        }
        .lainnya-headline-title {
          font-size: 34px; font-weight: 900; color: #fff;
          line-height: 1.12; margin: 0 0 12px; letter-spacing: -0.02em;
        }
        .lainnya-headline-desc {
          font-size: 13px; color: rgba(255,255,255,0.38); line-height: 1.6; margin: 0;
        }

        .lainnya-cards-grid {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 12px; margin-bottom: 28px;
        }
        .lainnya-sec-card {
          position: relative; overflow: hidden;
          border-radius: 20px;
          border: 1px solid color-mix(in srgb, var(--sec-color,#c8f500) 20%, transparent);
          background: rgba(255,255,255,0.03);
          padding: 18px 16px;
          cursor: pointer; text-align: left;
          transition: transform .18s, background .15s;
          animation: secCardIn .4s cubic-bezier(.34,1.3,.64,1) both;
        }
        @keyframes secCardIn {
          from { opacity:0; transform: translateY(16px) scale(0.95) }
          to   { opacity:1; transform: translateY(0) scale(1) }
        }
        .lainnya-sec-card:active { transform: scale(0.97); }
        .lainnya-sec-card-top {
          display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px;
        }
        .lainnya-sec-icon {
          width: 48px; height: 48px; border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
        }
        .lainnya-sec-label { font-size: 14px; font-weight: 800; margin-bottom: 5px; line-height: 1.2; }
        .lainnya-sec-desc { font-size: 11px; color: rgba(255,255,255,0.33); line-height: 1.4; }
        .lainnya-sec-glow { position: absolute; inset: 0; pointer-events: none; }

        .lainnya-quick-header {
          font-size: 10px; font-weight: 800; letter-spacing: 0.1em;
          color: rgba(255,255,255,0.22); text-transform: uppercase; margin-bottom: 10px;
        }
        .lainnya-quick-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 28px; }
        .lainnya-quick-pill {
          display: flex; align-items: center; gap: 6px;
          padding: 9px 14px; border-radius: 99px;
          border: 1px solid color-mix(in srgb, var(--sec-color,#c8f500) 25%, transparent);
          background: color-mix(in srgb, var(--sec-color,#c8f500) 6%, transparent);
          color: rgba(255,255,255,0.65); font-size: 12px; font-weight: 700;
          cursor: pointer;
          transition: background .15s, transform .12s;
        }
        .lainnya-quick-pill:active { transform: scale(0.95); }

        .lainnya-footer-note {
          display: flex; align-items: center; gap: 10px;
          padding: 14px 16px; border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.02); margin-bottom: 16px;
          font-size: 12px; color: rgba(255,255,255,0.3); line-height: 1.5;
        }

        /* ── Bottom nav ────────────────────────────────────────── */
        .bottom-nav {
          position: fixed; bottom: 0; left: 0; right: 0;
          height: var(--bottom-nav-h, 70px);
          background: rgba(8,8,5,0.97);
          border-top: 1px solid rgba(200,245,0,0.1);
          display: flex; align-items: center; justify-content: space-around;
          padding: 0 4px; z-index: 9200;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
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
        .bn-unread-dot {
          position: absolute; top: 2px; right: 2px;
          width: 8px; height: 8px; border-radius: 50%;
          background: #ff3b3b; border: 1.5px solid #0a0a05;
          pointer-events: none;
        }
      `}</style>
    </>
  )
}
