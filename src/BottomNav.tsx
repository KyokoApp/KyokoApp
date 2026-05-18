import React, { useState, useRef, useCallback, useEffect } from 'react'

interface BottomNavProps {
  onOpenGlobalChat: () => void
  onOpenAI: () => void
  onOpenManga: () => void
  onOpenNovel: () => void
  onOpenAnime: () => void
  onOpenRpg: () => void
  onScrollTo: (id: string) => void
  gcUnread?: boolean
  aiUnread?: boolean
}

// ── FAB items (radial carousel) ──────────────────────────────────────────────
const FAB_ITEMS = [
  {
    key: 'globalchat',
    label: 'Global Chat',
    color: '#a3e635',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    key: 'ai',
    label: 'KyokoAI',
    color: '#38bdf8',
    icon: (
      <svg viewBox="0 0 32 32" width="20" height="20" fill="none">
        <path d="M8 11.5C8 10.12 9.12 9 10.5 9h11C22.88 9 24 10.12 24 11.5v6c0 1.38-1.12 2.5-2.5 2.5H19l-3 3.5-3-3.5h-2.5C9.12 20 8 18.88 8 17.5v-6Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <circle cx="12" cy="14.5" r="1.5" fill="currentColor"/>
        <circle cx="16" cy="14.5" r="1.5" fill="currentColor"/>
        <circle cx="20" cy="14.5" r="1.5" fill="currentColor"/>
      </svg>
    ),
  },
  {
    key: 'manga',
    label: 'MangaStream',
    color: '#f472b6',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
    color: '#fb923c',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <line x1="9" y1="7" x2="15" y2="7"/>
        <line x1="9" y1="11" x2="15" y2="11"/>
      </svg>
    ),
  },
  {
    key: 'anime',
    label: 'AnimeStream',
    color: '#c084fc',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/>
        <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    key: 'rpg',
    label: 'RPG Game',
    color: '#facc15',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    ),
  },
]

// ── "Lainnya" panel items ────────────────────────────────────────────────────
const LAINNYA_ITEMS = [
  {
    id: 'direktori-grup',
    label: 'Direktori Grup',
    desc: 'Temukan & daftarkan grup komunitas',
    color: '#a3e635',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
        <line x1="3" y1="6" x2="21" y2="6"/>
        <path d="M16 10a4 4 0 0 1-8 0"/>
      </svg>
    ),
  },
  {
    id: 'apk-mod',
    label: 'APK & SC Bot',
    desc: 'APK Mod, ScBot Free & Premium',
    color: '#fb923c',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="5" y="2" width="14" height="20" rx="2"/>
        <line x1="12" y1="18" x2="12" y2="18" strokeWidth="3"/>
        <line x1="9" y1="7" x2="15" y2="7"/>
        <line x1="9" y1="11" x2="15" y2="11"/>
      </svg>
    ),
  },
]

// ── Radial Carousel FAB ──────────────────────────────────────────────────────
// Only 3 items visible at once (center = top), rest fade out
// User can drag/rotate the wheel inside the circle
const VISIBLE_COUNT = 3        // how many visible at once
const RADIUS = 82              // px from center to item center
const ITEM_ANGLE = 55          // degrees between items
const BASE_ANGLE = -90         // top = item[0] when rotation=0

function RadialCarousel({
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
  const [rotation, setRotation] = useState(0)          // degrees, current wheel rotation
  const [targetRot, setTargetRot] = useState(0)         // snapped target
  const [isDragging, setIsDragging] = useState(false)
  const [dragging3d, setDragging3d] = useState({ tiltX: 0, tiltY: 0 })
  const startRef = useRef<{ angle: number; rotation: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number>(0)
  const rotRef = useRef(0)

  // Smooth animate rotation toward target
  useEffect(() => {
    cancelAnimationFrame(animRef.current)
    const animate = () => {
      const diff = targetRot - rotRef.current
      if (Math.abs(diff) < 0.1) {
        rotRef.current = targetRot
        setRotation(targetRot)
        return
      }
      rotRef.current += diff * 0.15
      setRotation(rotRef.current)
      animRef.current = requestAnimationFrame(animate)
    }
    animRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animRef.current)
  }, [targetRot])

  const getAngleFromEvent = useCallback((e: React.PointerEvent | React.TouchEvent) => {
    const el = containerRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.PointerEvent).clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.PointerEvent).clientY
    return Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    startRef.current = { angle: getAngleFromEvent(e), rotation: rotRef.current }
    setIsDragging(true)
  }, [getAngleFromEvent])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startRef.current || !isDragging) return
    const delta = getAngleFromEvent(e) - startRef.current.angle
    const newRot = startRef.current.rotation + delta
    rotRef.current = newRot
    setRotation(newRot)
    // 3D tilt effect
    const el = containerRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      const dx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)
      const dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)
      setDragging3d({ tiltX: dy * 12, tiltY: -dx * 12 })
    }
  }, [isDragging, getAngleFromEvent])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    setDragging3d({ tiltX: 0, tiltY: 0 })
    startRef.current = null
    // Snap: find the nearest item slot
    const step = ITEM_ANGLE
    const snapped = Math.round(rotRef.current / step) * step
    setTargetRot(snapped)
  }, [isDragging])

  // Rotate by one step (button)
  const rotateBy = useCallback((dir: 1 | -1) => {
    const next = Math.round(rotRef.current / ITEM_ANGLE) * ITEM_ANGLE + dir * ITEM_ANGLE
    setTargetRot(next)
  }, [])

  const n = items.length
  return (
    <div className="rc-outer">
      {/* Backdrop */}
      <div className="rc-backdrop" onClick={onClose} />

      {/* Arrow rotate buttons */}
      <button className="rc-arrow rc-arrow-left" onClick={() => rotateBy(-1)} type="button" aria-label="Putar kiri">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button className="rc-arrow rc-arrow-right" onClick={() => rotateBy(1)} type="button" aria-label="Putar kanan">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>

      {/* Drag circle */}
      <div
        ref={containerRef}
        className={`rc-ring ${isDragging ? 'rc-ring-drag' : ''}`}
        style={{
          transform: isDragging
            ? `perspective(600px) rotateX(${dragging3d.tiltX}deg) rotateY(${dragging3d.tiltY}deg)`
            : 'perspective(600px) rotateX(0deg) rotateY(0deg)',
          transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(.34,1.56,.64,1)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Ring glow */}
        <div className="rc-ring-glow" aria-hidden />
        {/* Track dots */}
        <div className="rc-track-dots" aria-hidden>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rc-track-dot" style={{ transform: `rotate(${i * 30}deg) translateY(-${RADIUS + 12}px)` }} />
          ))}
        </div>

        {/* Items */}
        {items.map((item, idx) => {
          const step = ITEM_ANGLE
          // angle on wheel: item's base angle + rotation
          const baseAngle = BASE_ANGLE + idx * step
          const absAngle = baseAngle + rotation
          // Normalize angle to -180..180 for opacity calc
          let normAngle = ((absAngle % 360) + 360) % 360
          if (normAngle > 180) normAngle -= 360
          // "top" slot = 0 degrees difference from -90 (pointing up)
          // We consider the effective angle pointing up as closest to 270 (= -90)
          // Distance from top slot
          const distFromTop = Math.abs(normAngle + 90) % 360
          const dist = distFromTop > 180 ? 360 - distFromTop : distFromTop
          // Visibility: visible if within VISIBLE_COUNT/2 * step
          const halfVisible = ((VISIBLE_COUNT - 1) / 2) * step
          const opacityRaw = dist <= halfVisible ? 1 - (dist / halfVisible) * 0.3 : Math.max(0, 1 - ((dist - halfVisible) / step) * 1.5)
          const isCenter = dist < step * 0.5
          const scale = isCenter ? 1.15 : opacityRaw > 0.5 ? 0.9 : 0.7

          const rad = (absAngle * Math.PI) / 180
          const x = Math.cos(rad) * RADIUS
          const y = Math.sin(rad) * RADIUS

          return (
            <div
              key={item.key}
              className="rc-item"
              style={{
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`,
                opacity: Math.max(0, opacityRaw),
                zIndex: isCenter ? 10 : 5,
                pointerEvents: opacityRaw > 0.3 ? 'auto' : 'none',
                transition: isDragging ? 'none' : 'opacity 0.22s ease, transform 0.22s ease',
              }}
              onClick={() => handlers[item.key]?.()}
            >
              {/* Label */}
              <span
                className="rc-item-label"
                style={{
                  opacity: isCenter ? 1 : 0,
                  transform: isCenter ? 'translateY(0)' : 'translateY(4px)',
                  transition: 'opacity 0.2s, transform 0.2s',
                  color: item.color,
                }}
              >
                {item.label}
              </span>

              {/* Button */}
              <button
                className={`rc-item-btn ${isCenter ? 'rc-item-center' : ''}`}
                style={{ '--item-color': item.color } as React.CSSProperties}
                type="button"
                aria-label={item.label}
                tabIndex={opacityRaw > 0.3 ? 0 : -1}
              >
                {item.icon}
                {item.key === 'globalchat' && gcUnread && <span className="bn-unread-dot" />}
                {item.key === 'ai' && aiUnread && <span className="bn-unread-dot" />}
              </button>

              {/* Center ring highlight */}
              {isCenter && <div className="rc-item-ring" style={{ borderColor: item.color }} />}
            </div>
          )
        })}

        {/* Center label */}
        <div className="rc-center-hint" aria-hidden>PUTAR</div>
      </div>
    </div>
  )
}

// ── "Lainnya" Panel (slides up) ──────────────────────────────────────────────
function LainnyaPanel({ onScrollTo, onClose }: { onScrollTo: (id: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="lainnya-backdrop" onClick={onClose} />
      <div className="lainnya-panel">
        <div className="lainnya-handle" />
        <div className="lainnya-title">Lainnya</div>
        <div className="lainnya-grid">
          {LAINNYA_ITEMS.map((item) => (
            <button
              key={item.id}
              className="lainnya-card"
              style={{ '--lainnya-color': item.color } as React.CSSProperties}
              onClick={() => { onScrollTo(item.id); onClose() }}
              type="button"
            >
              <div className="lainnya-card-icon" style={{ color: item.color, background: `${item.color}18` }}>
                {item.icon}
              </div>
              <div className="lainnya-card-text">
                <div className="lainnya-card-label">{item.label}</div>
                <div className="lainnya-card-desc">{item.desc}</div>
              </div>
              <div className="lainnya-card-arrow">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

// ── Main BottomNav ───────────────────────────────────────────────────────────
export default function BottomNav({
  onOpenGlobalChat, onOpenAI, onOpenManga, onOpenNovel, onOpenAnime, onOpenRpg,
  onScrollTo, gcUnread, aiUnread,
}: BottomNavProps) {
  const [fabOpen, setFabOpen] = useState(false)
  const [lainnyaOpen, setLainnyaOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('beranda')

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
      {/* Radial carousel */}
      {fabOpen && (
        <RadialCarousel
          items={FAB_ITEMS}
          handlers={handlers}
          gcUnread={gcUnread}
          aiUnread={aiUnread}
          onClose={() => setFabOpen(false)}
        />
      )}

      {/* Lainnya panel */}
      {lainnyaOpen && (
        <LainnyaPanel
          onScrollTo={onScrollTo}
          onClose={() => setLainnyaOpen(false)}
        />
      )}

      {/* Bottom bar */}
      <nav className="bottom-nav">
        {/* HOME */}
        <button
          className={`bn-tab ${activeTab === 'beranda' ? 'bn-tab-active' : ''}`}
          onClick={() => { setActiveTab('beranda'); onScrollTo('beranda') }}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
            <polyline points="9 21 9 12 15 12 15 21"/>
          </svg>
          <span>HOME</span>
        </button>

        {/* GAME */}
        <button
          className={`bn-tab ${activeTab === 'rekomendasi-game' ? 'bn-tab-active' : ''}`}
          onClick={() => { setActiveTab('rekomendasi-game'); onScrollTo('rekomendasi-game') }}
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

        {/* Center FAB */}
        <div className="bn-fab-wrap">
          <button
            className={`bn-fab ${fabOpen ? 'bn-fab-open' : ''}`}
            onClick={() => { setFabOpen(p => !p); setLainnyaOpen(false) }}
            type="button"
            aria-label="Menu"
          >
            {!fabOpen && hasUnread && <span className="bn-fab-badge" />}
            <span className="bn-fab-icon-wrap">
              <svg className="bn-fab-open-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                {fabOpen
                  ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
                  : <><path d="M12 5v14M5 12h14"/></>
                }
              </svg>
            </span>
            <span className="bn-fab-glow" aria-hidden="true" />
          </button>
        </div>

        {/* BERITA */}
        <button
          className={`bn-tab ${activeTab === 'info-berita' ? 'bn-tab-active' : ''}`}
          onClick={() => { setActiveTab('info-berita'); onScrollTo('info-berita') }}
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

        {/* LAINNYA */}
        <button
          className={`bn-tab ${lainnyaOpen ? 'bn-tab-active' : ''}`}
          onClick={() => { setLainnyaOpen(p => !p); setFabOpen(false) }}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="5" cy="12" r="1" fill="currentColor"/>
            <circle cx="12" cy="12" r="1" fill="currentColor"/>
            <circle cx="19" cy="12" r="1" fill="currentColor"/>
          </svg>
          <span>LAINNYA</span>
        </button>
      </nav>

      {/* ── CSS ── */}
      <style>{`
        /* ── Radial Carousel ───────────────────────────────────── */
        .rc-outer {
          position: fixed;
          inset: 0;
          z-index: 9000;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding-bottom: calc(var(--bottom-nav-h, 70px) + 20px);
          pointer-events: none;
        }
        .rc-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
          pointer-events: auto;
          animation: rcBackdropIn .22s ease;
        }
        @keyframes rcBackdropIn { from { opacity:0 } to { opacity:1 } }

        /* Arrow rotate buttons */
        .rc-arrow {
          position: absolute;
          bottom: calc(var(--bottom-nav-h, 70px) + 105px);
          width: 38px; height: 38px;
          border-radius: 50%;
          border: 1.5px solid rgba(200,245,0,0.25);
          background: rgba(15,15,15,0.9);
          color: #c8f500;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          pointer-events: auto;
          z-index: 9010;
          transition: background .15s;
        }
        .rc-arrow:active { background: rgba(200,245,0,0.15); }
        .rc-arrow-left  { left: calc(50% - 130px); }
        .rc-arrow-right { left: calc(50% + 92px); }

        /* Ring */
        .rc-ring {
          position: relative;
          width: 220px;
          height: 220px;
          border-radius: 50%;
          background: radial-gradient(circle at 40% 35%, rgba(30,30,20,0.95) 60%, rgba(15,15,10,0.98));
          border: 2px solid rgba(200,245,0,0.18);
          box-shadow:
            0 0 0 1px rgba(200,245,0,0.06),
            0 0 40px rgba(200,245,0,0.08),
            0 24px 60px rgba(0,0,0,0.7);
          pointer-events: auto;
          cursor: grab;
          touch-action: none;
          user-select: none;
          animation: rcRingIn .3s cubic-bezier(.34,1.56,.64,1);
          z-index: 9005;
        }
        .rc-ring.rc-ring-drag { cursor: grabbing; }
        @keyframes rcRingIn {
          from { opacity:0; transform: perspective(600px) scale(0.7) translateY(20px); }
          to   { opacity:1; transform: perspective(600px) scale(1) translateY(0); }
        }
        .rc-ring-glow {
          position: absolute; inset: -2px;
          border-radius: 50%;
          background: conic-gradient(from 0deg, transparent 70%, rgba(200,245,0,0.15) 90%, transparent 100%);
          animation: rcGlowSpin 4s linear infinite;
          pointer-events: none;
        }
        @keyframes rcGlowSpin { to { transform: rotate(360deg); } }

        /* Track dots */
        .rc-track-dots {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .rc-track-dot {
          position: absolute;
          left: 50%; top: 50%;
          width: 3px; height: 3px;
          margin: -1.5px;
          border-radius: 50%;
          background: rgba(200,245,0,0.18);
          transform-origin: 0 0;
        }

        /* Items */
        .rc-item {
          position: absolute;
          left: 50%; top: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          pointer-events: auto;
        }
        .rc-item-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          white-space: nowrap;
          text-shadow: 0 2px 8px rgba(0,0,0,0.8);
          pointer-events: none;
        }
        .rc-item-btn {
          width: 44px; height: 44px;
          border-radius: 50%;
          border: 1.5px solid rgba(255,255,255,0.12);
          background: rgba(20,20,15,0.9);
          color: var(--item-color, #fff);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          position: relative;
          transition: background .15s, box-shadow .15s;
          box-shadow: 0 2px 12px rgba(0,0,0,0.4);
        }
        .rc-item-btn.rc-item-center {
          width: 50px; height: 50px;
          border-color: var(--item-color, #fff);
          background: rgba(var(--item-color-rgb, 200,245,0), 0.12);
          box-shadow: 0 0 20px rgba(200,245,0,0.2), 0 4px 20px rgba(0,0,0,0.5);
        }
        .rc-item-ring {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          border: 1.5px solid;
          opacity: 0.4;
          pointer-events: none;
          animation: rcItemRingPulse 1.5s ease-in-out infinite;
        }
        @keyframes rcItemRingPulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50%       { transform: scale(1.1); opacity: 0.2; }
        }
        .rc-center-hint {
          position: absolute;
          left: 50%; top: 50%;
          transform: translate(-50%, -50%);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.1em;
          color: rgba(200,245,0,0.2);
          pointer-events: none;
          user-select: none;
        }

        /* ── Lainnya Panel ─────────────────────────────────────── */
        .lainnya-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(3px);
          z-index: 8900;
          animation: rcBackdropIn .2s ease;
        }
        .lainnya-panel {
          position: fixed;
          bottom: calc(var(--bottom-nav-h, 70px));
          left: 0; right: 0;
          background: linear-gradient(180deg, rgba(12,12,8,0.97) 0%, rgba(8,8,5,0.99) 100%);
          border-top: 1px solid rgba(200,245,0,0.15);
          border-radius: 20px 20px 0 0;
          z-index: 8950;
          padding: 12px 20px 20px;
          animation: lainnyaUp .28s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes lainnyaUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .lainnya-handle {
          width: 40px; height: 4px;
          border-radius: 2px;
          background: rgba(200,245,0,0.2);
          margin: 0 auto 14px;
        }
        .lainnya-title {
          font-size: 13px;
          font-weight: 800;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 14px;
        }
        .lainnya-grid {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .lainnya-card {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 16px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.03);
          cursor: pointer;
          text-align: left;
          color: #fff;
          transition: background .15s, border-color .15s, transform .15s;
          position: relative;
          overflow: hidden;
        }
        .lainnya-card::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, var(--lainnya-color, #a3e635) 0%, transparent 60%);
          opacity: 0;
          transition: opacity .2s;
        }
        .lainnya-card:active {
          transform: scale(0.98);
          background: rgba(255,255,255,0.06);
        }
        .lainnya-card:active::after { opacity: 0.06; }
        .lainnya-card-icon {
          width: 44px; height: 44px;
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .lainnya-card-text { flex: 1; min-width: 0; }
        .lainnya-card-label {
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 2px;
        }
        .lainnya-card-desc {
          font-size: 11px;
          opacity: 0.45;
          line-height: 1.3;
        }
        .lainnya-card-arrow {
          color: rgba(255,255,255,0.25);
          flex-shrink: 0;
        }

        /* ── Bottom nav overrides ──────────────────────────────── */
        .bottom-nav {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          height: var(--bottom-nav-h, 70px);
          background: rgba(8,8,5,0.97);
          border-top: 1px solid rgba(200,245,0,0.1);
          display: flex;
          align-items: center;
          justify-content: space-around;
          padding: 0 4px;
          z-index: 9100;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }
        .bn-tab {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          padding: 8px 2px;
          border: none;
          background: none;
          color: rgba(255,255,255,0.35);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: color .2s;
        }
        .bn-tab:active { opacity: 0.7; }
        .bn-tab-active { color: #c8f500; }
        .bn-fab-wrap {
          flex: 0 0 60px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .bn-fab {
          width: 54px; height: 54px;
          border-radius: 50%;
          border: none;
          background: linear-gradient(135deg, #c8f500, #a3e635);
          color: #0a0a05;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 20px rgba(200,245,0,0.35);
          position: relative;
          transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s;
          margin-bottom: 10px;
        }
        .bn-fab.bn-fab-open {
          transform: rotate(45deg) scale(0.9);
          box-shadow: 0 4px 30px rgba(200,245,0,0.5);
        }
        .bn-fab:active { transform: scale(0.92); }
        .bn-fab-open-icon { pointer-events: none; }
        .bn-fab-glow {
          position: absolute; inset: -4px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(200,245,0,0.3) 0%, transparent 70%);
          opacity: 0;
          animation: fabGlowPulse 2.5s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes fabGlowPulse {
          0%, 100% { opacity: 0; transform: scale(1); }
          50%       { opacity: 1; transform: scale(1.3); }
        }
        .bn-fab-badge {
          position: absolute;
          top: 2px; right: 2px;
          width: 10px; height: 10px;
          border-radius: 50%;
          background: #ff3b3b;
          border: 2px solid #0a0a05;
          pointer-events: none;
          animation: badgePulse 1.5s ease-in-out infinite;
        }
        @keyframes badgePulse {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.25); }
        }
        .bn-unread-dot {
          position: absolute;
          top: 2px; right: 2px;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #ff3b3b;
          border: 1.5px solid #0a0a05;
          pointer-events: none;
        }
      `}</style>
    </>
  )
}
