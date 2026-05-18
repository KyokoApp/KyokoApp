import React, { useState } from 'react'

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

const fabItems = [
  {
    key: 'globalchat',
    label: 'Global Chat',
    color: '#a3e635',
    angle: -90, // top
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
    angle: -30,
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
    angle: 30,
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
    angle: 90,
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
    angle: 150,
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
    angle: 210,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    ),
  },
]

const NAV_TABS = [
  {
    id: 'beranda',
    label: 'Home',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
        <polyline points="9 21 9 12 15 12 15 21"/>
      </svg>
    ),
  },
  {
    id: 'direktori-grup',
    label: 'Grup',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
]

export default function BottomNav({
  onOpenGlobalChat, onOpenAI, onOpenManga, onOpenNovel, onOpenAnime, onOpenRpg,
  onScrollTo, gcUnread, aiUnread
}: BottomNavProps) {
  const [fabOpen, setFabOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('beranda')

  const handlers: Record<string, () => void> = {
    globalchat: () => { setFabOpen(false); onOpenGlobalChat() },
    ai: () => { setFabOpen(false); onOpenAI() },
    manga: () => { setFabOpen(false); onOpenManga() },
    novel: () => { setFabOpen(false); onOpenNovel() },
    anime: () => { setFabOpen(false); onOpenAnime() },
    rpg: () => { setFabOpen(false); onOpenRpg() },
  }

  const hasUnread = gcUnread || aiUnread

  return (
    <>
      {/* Backdrop */}
      {fabOpen && (
        <div
          className="bn-backdrop"
          onClick={() => setFabOpen(false)}
        />
      )}

      {/* Speed dial items */}
      {fabItems.map((item) => {
        const rad = (item.angle * Math.PI) / 180
        const dist = 90
        const tx = Math.cos(rad) * dist
        const ty = Math.sin(rad) * dist
        return (
          <div
            key={item.key}
            className={`bn-speed-item ${fabOpen ? 'bn-speed-visible' : ''}`}
            style={{
              '--tx': `${tx}px`,
              '--ty': `${ty}px`,
              '--item-color': item.color,
            } as React.CSSProperties}
            onClick={handlers[item.key]}
          >
            <span className="bn-speed-label">{item.label}</span>
            <button
              className="bn-speed-btn"
              style={{ '--item-color': item.color } as React.CSSProperties}
              type="button"
              aria-label={item.label}
            >
              {item.icon}
              {item.key === 'globalchat' && gcUnread && <span className="bn-unread-dot" />}
              {item.key === 'ai' && aiUnread && <span className="bn-unread-dot" />}
            </button>
          </div>
        )
      })}

      {/* Bottom Bar */}
      <nav className="bottom-nav">
        {/* Left tabs */}
        {NAV_TABS.slice(0, 2).map(tab => (
          <button
            key={tab.id}
            className={`bn-tab ${activeTab === tab.id ? 'bn-tab-active' : ''}`}
            onClick={() => {
              setActiveTab(tab.id)
              onScrollTo(tab.id)
            }}
            type="button"
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}

        {/* Center FAB */}
        <div className="bn-fab-wrap">
          <button
            className={`bn-fab ${fabOpen ? 'bn-fab-open' : ''}`}
            onClick={() => setFabOpen(p => !p)}
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

        {/* Right tabs */}
        <button
          className={`bn-tab ${activeTab === 'rekomendasi-game' ? 'bn-tab-active' : ''}`}
          onClick={() => {
            setActiveTab('rekomendasi-game')
            onScrollTo('rekomendasi-game')
          }}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 11h4M8 9v4"/>
            <circle cx="15" cy="12" r="1" fill="currentColor"/>
            <circle cx="18" cy="10" r="1" fill="currentColor"/>
            <rect x="2" y="6" width="20" height="12" rx="4"/>
          </svg>
          <span>Game</span>
        </button>
        <button
          className={`bn-tab ${activeTab === 'jual-beli-akun' ? 'bn-tab-active' : ''}`}
          onClick={() => {
            setActiveTab('jual-beli-akun')
            onScrollTo('jual-beli-akun')
          }}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
          <span>Market</span>
        </button>
      </nav>
    </>
  )
}
