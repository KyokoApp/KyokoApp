import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ──────────────────────────────────────────────────────
interface AnimeCard {
  mal_id: number
  title: string
  title_english?: string
  images: { jpg: { large_image_url: string; image_url: string } }
  score?: number
  episodes?: number
  status?: string
  members?: number
  synopsis?: string
  genres?: { name: string }[]
  aired?: { from?: string }
  year?: number
  season?: string
  type?: string
  popularity?: number
}

interface Section {
  key: string
  label: string
  emoji: string
  data: AnimeCard[]
  loading: boolean
}

const JIKAN = 'https://api.jikan.moe/v4'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchWithRetry(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (res.status === 429) { await delay(1500); continue }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (i === retries) throw e
      await delay(800 * (i + 1))
    }
  }
}

function getTitle(a: AnimeCard) {
  return a.title_english || a.title || 'Unknown'
}

function getImg(a: AnimeCard) {
  return a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || ''
}

// ─── Mini Anime Card ────────────────────────────────────────────
function AnimeCardMini({ anime, rank }: { anime: AnimeCard; rank?: number }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: 14,
        overflow: 'hidden',
        background: '#111',
        cursor: 'pointer',
        border: hovered ? '1.5px solid #c8f500' : '1.5px solid rgba(200,245,0,0.12)',
        transition: 'border 0.2s, transform 0.2s, box-shadow 0.2s',
        transform: hovered ? 'translateY(-4px) scale(1.03)' : 'none',
        boxShadow: hovered ? '0 8px 32px rgba(200,245,0,0.18)' : '0 2px 8px rgba(0,0,0,0.4)',
        flexShrink: 0,
        width: 130,
      }}
    >
      {/* poster */}
      <div style={{ position: 'relative', paddingTop: '140%', background: '#1a1a1a' }}>
        <img
          src={getImg(anime)}
          alt={getTitle(anime)}
          loading="lazy"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }}
          onError={e => { (e.target as HTMLImageElement).style.opacity = '0' }}
        />
        {/* gradient overlay */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 60%)',
          height: '70%',
        }} />
        {/* rank badge */}
        {rank && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            background: '#c8f500', color: '#000',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 14, fontWeight: 700,
            padding: '1px 7px', borderRadius: 6,
            lineHeight: 1.4,
          }}>#{rank}</div>
        )}
        {/* score */}
        {anime.score && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            background: 'rgba(0,0,0,0.75)', color: '#c8f500',
            fontSize: 10, fontWeight: 700,
            padding: '2px 6px', borderRadius: 6,
            border: '1px solid rgba(200,245,0,0.3)',
          }}>⭐ {anime.score.toFixed(1)}</div>
        )}
        {/* title at bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '6px 8px',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#fff',
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{getTitle(anime)}</div>
          {anime.episodes && (
            <div style={{ fontSize: 9, color: 'rgba(200,245,0,0.7)', marginTop: 2 }}>
              {anime.episodes} eps
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Upcoming Row Item ──────────────────────────────────────────
function UpcomingItem({ anime, rank }: { anime: AnimeCard; rank: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px',
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 12,
      border: '1px solid rgba(200,245,0,0.08)',
      transition: 'background 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,245,0,0.06)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
    >
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 22, color: '#c8f500', opacity: 0.6,
        minWidth: 28, textAlign: 'center',
      }}>{rank}</div>
      <img
        src={getImg(anime)}
        alt={getTitle(anime)}
        loading="lazy"
        style={{ width: 42, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
        onError={e => { (e.target as HTMLImageElement).style.opacity = '0' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {getTitle(anime)}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
          {anime.type || 'TV'} · {(anime.members || 0).toLocaleString()} members
        </div>
        <div style={{ fontSize: 10, color: 'rgba(200,245,0,0.6)', marginTop: 1 }}>
          Belum tayang
        </div>
      </div>
    </div>
  )
}

// ─── Horizontal scroll section ──────────────────────────────────
function ScrollSection({
  title, emoji, items, loading, withRank = false
}: {
  title: string, emoji: string, items: AnimeCard[], loading: boolean, withRank?: boolean
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      {/* section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 16 }}>{emoji}</span>
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 18, letterSpacing: 1.5, color: '#fff',
        }}>{title}</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(200,245,0,0.12)', marginLeft: 4 }} />
      </div>

      {loading ? (
        <div style={{ display: 'flex', gap: 10 }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{
              width: 130, borderRadius: 14, background: '#1a1a1a',
              height: 182, flexShrink: 0,
              animation: 'kyoko-pulse 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.1}s`,
            }} />
          ))}
        </div>
      ) : (
        <div style={{
          display: 'flex', gap: 10,
          overflowX: 'auto', paddingBottom: 6,
          scrollbarWidth: 'none',
        }}>
          {items.map((a, i) => (
            <AnimeCardMini key={a.mal_id} anime={a} rank={withRank ? i + 1 : undefined} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────
export default function AnimeHeroSection() {
  const [topAnime, setTopAnime] = useState<AnimeCard[]>([])
  const [latestAnime, setLatestAnime] = useState<AnimeCard[]>([])
  const [rekomendasi, setRekomendasi] = useState<AnimeCard[]>([])
  const [upcoming, setUpcoming] = useState<AnimeCard[]>([])
  const [loadingTop, setLoadingTop] = useState(true)
  const [loadingLatest, setLoadingLatest] = useState(true)
  const [loadingReko, setLoadingReko] = useState(true)
  const [loadingUpcoming, setLoadingUpcoming] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'upcoming'>('info')

  const fetchAll = useCallback(async () => {
    // top anime (by score)
    fetchWithRetry(`${JIKAN}/top/anime?filter=bypopularity&limit=12`)
      .then(d => { setTopAnime(d.data || []); setLoadingTop(false) })
      .catch(() => setLoadingTop(false))

    await delay(400)

    // terbaru / currently airing
    fetchWithRetry(`${JIKAN}/seasons/now?limit=12`)
      .then(d => { setLatestAnime(d.data || []); setLoadingLatest(false) })
      .catch(() => setLoadingLatest(false))

    await delay(400)

    // rekomendasi (top all time)
    fetchWithRetry(`${JIKAN}/top/anime?filter=favorite&limit=12`)
      .then(d => { setRekomendasi(d.data || []); setLoadingReko(false) })
      .catch(() => setLoadingReko(false))

    await delay(400)

    // upcoming
    fetchWithRetry(`${JIKAN}/top/anime?filter=upcoming&limit=8`)
      .then(d => { setUpcoming(d.data || []); setLoadingUpcoming(false) })
      .catch(() => setLoadingUpcoming(false))
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const tabs = [
    { key: 'info', label: 'Info Anime' },
    { key: 'upcoming', label: 'Akan Rilis' },
  ] as const

  return (
    <div style={{
      marginTop: 24,
      background: 'rgba(200,245,0,0.03)',
      border: '1px solid rgba(200,245,0,0.1)',
      borderRadius: 20,
      padding: '18px 16px',
    }}>
      {/* inline style for pulse animation */}
      <style>{`
        @keyframes kyoko-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .kyoko-scroll::-webkit-scrollbar { display: none; }
      `}</style>

      {/* tab switcher */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 20,
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 999, padding: 3,
      }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 999,
              border: 'none', cursor: 'pointer', fontWeight: 700,
              fontSize: 12, letterSpacing: 0.5, transition: 'all 0.2s',
              background: activeTab === t.key ? '#c8f500' : 'transparent',
              color: activeTab === t.key ? '#000' : 'rgba(255,255,255,0.5)',
            }}
          >{t.label}</button>
        ))}
      </div>

      {activeTab === 'info' && (
        <>
          <ScrollSection title="TOP ANIME" emoji="🏆" items={topAnime} loading={loadingTop} withRank />
          <ScrollSection title="TERBARU / AIRING" emoji="🔥" items={latestAnime} loading={loadingLatest} />
          <ScrollSection title="REKOMENDASI" emoji="✨" items={rekomendasi} loading={loadingReko} />
        </>
      )}

      {activeTab === 'upcoming' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 16 }}>🗓️</span>
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18, letterSpacing: 1.5, color: '#fff',
            }}>AKAN SEGERA RILIS</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(200,245,0,0.12)', marginLeft: 4 }} />
          </div>

          {loadingUpcoming ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...Array(5)].map((_, i) => (
                <div key={i} style={{
                  height: 72, borderRadius: 12, background: '#1a1a1a',
                  animation: 'kyoko-pulse 1.4s ease-in-out infinite',
                  animationDelay: `${i * 0.1}s`,
                }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {upcoming.map((a, i) => (
                <UpcomingItem key={a.mal_id} anime={a} rank={i + 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
