import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ──────────────────────────────────────────────────────
interface MangaCard {
  mal_id: number
  title: string
  title_english?: string
  images: { jpg: { large_image_url: string; image_url: string } }
  score?: number
  chapters?: number
  volumes?: number
  status?: string
  members?: number
  synopsis?: string
  genres?: { name: string }[]
  type?: string
  publishing?: boolean
  authors?: { name: string }[]
  rank?: number
  popularity?: number
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

function getTitle(m: MangaCard) {
  return m.title_english || m.title || 'Unknown'
}
function getImg(m: MangaCard) {
  return m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || ''
}

// ─── Genre badge colors ─────────────────────────────────────────
const GENRE_COLORS: Record<string, string> = {
  'Action': '#ef4444', 'Romance': '#ec4899', 'Fantasy': '#8b5cf6',
  'Comedy': '#f59e0b', 'Drama': '#06b6d4', 'Horror': '#6b7280',
  'Sci-Fi': '#3b82f6', 'Shounen': '#f97316', 'Shoujo': '#f472b6',
  'Seinen': '#10b981', 'Slice of Life': '#84cc16', 'Mystery': '#a78bfa',
}

// ─── Manga Card Component ───────────────────────────────────────
function MangaCardMini({ manga, rank }: { manga: MangaCard; rank?: number }) {
  const [hovered, setHovered] = useState(false)
  const genre = manga.genres?.[0]?.name || ''
  const genreColor = GENRE_COLORS[genre] || '#c8f500'

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
      <div style={{ position: 'relative', paddingTop: '140%', background: '#1a1a1a' }}>
        <img
          src={getImg(manga)}
          alt={getTitle(manga)}
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
          background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)',
          height: '75%',
        }} />
        {/* rank badge */}
        {rank && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            background: '#c8f500', color: '#000',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 14, fontWeight: 700,
            padding: '1px 7px', borderRadius: 6, lineHeight: 1.4,
          }}>#{rank}</div>
        )}
        {/* genre badge top right */}
        {genre && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            background: genreColor + '22',
            border: `1px solid ${genreColor}66`,
            color: genreColor,
            fontSize: 8, fontWeight: 700,
            padding: '2px 5px', borderRadius: 5,
            letterSpacing: 0.3,
            maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{genre}</div>
        )}
        {/* score */}
        {manga.score && !rank && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            background: 'rgba(0,0,0,0.75)', color: '#c8f500',
            fontSize: 10, fontWeight: 700,
            padding: '2px 6px', borderRadius: 6,
            border: '1px solid rgba(200,245,0,0.3)',
          }}>⭐ {manga.score.toFixed(1)}</div>
        )}
        {/* bottom info */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '6px 8px',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1.3,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{getTitle(manga)}</div>
          <div style={{ fontSize: 9, color: 'rgba(200,245,0,0.7)', marginTop: 3, display: 'flex', gap: 6 }}>
            {manga.score && rank && <span>⭐ {manga.score.toFixed(1)}</span>}
            {manga.chapters
              ? <span>{manga.chapters} ch</span>
              : <span>{manga.status === 'Publishing' ? '📖 Ongoing' : manga.volumes ? `${manga.volumes} vol` : ''}</span>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Horizontal scroll section ──────────────────────────────────
function MangaScrollSection({
  title, emoji, items, loading, withRank = false
}: {
  title: string, emoji: string, items: MangaCard[], loading: boolean, withRank?: boolean
}) {
  return (
    <div style={{ marginBottom: 28 }}>
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
              width: 130, borderRadius: 14, background: '#1a1a1a', height: 182, flexShrink: 0,
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
          {items.map((m, i) => (
            <MangaCardMini key={m.mal_id} manga={m} rank={withRank ? i + 1 : undefined} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Publishing (ongoing) row item ─────────────────────────────
function PublishingItem({ manga, rank }: { manga: MangaCard; rank: number }) {
  const genre = manga.genres?.[0]?.name || ''
  const genreColor = GENRE_COLORS[genre] || '#c8f500'
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 12,
        border: '1px solid rgba(200,245,0,0.08)',
        transition: 'background 0.15s',
        cursor: 'pointer',
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
        src={getImg(manga)}
        alt={getTitle(manga)}
        loading="lazy"
        style={{ width: 42, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
        onError={e => { (e.target as HTMLImageElement).style.opacity = '0' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{getTitle(manga)}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {genre && (
            <span style={{
              fontSize: 9, fontWeight: 700,
              background: genreColor + '22', border: `1px solid ${genreColor}55`,
              color: genreColor, padding: '1px 5px', borderRadius: 4,
            }}>{genre}</span>
          )}
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
            {manga.type || 'Manga'}
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
          {manga.chapters ? `${manga.chapters} ch` : 'Ongoing'} · {(manga.members || 0).toLocaleString()} readers
        </div>
      </div>
      {manga.score && (
        <div style={{
          background: 'rgba(200,245,0,0.1)', border: '1px solid rgba(200,245,0,0.25)',
          borderRadius: 8, padding: '4px 8px', textAlign: 'center', flexShrink: 0,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#c8f500' }}>{manga.score.toFixed(1)}</div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>score</div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────
export default function MangaInfoSection() {
  const [topManga, setTopManga] = useState<MangaCard[]>([])
  const [publishing, setPublishing] = useState<MangaCard[]>([])
  const [rekomendasi, setRekomendasi] = useState<MangaCard[]>([])
  const [manhwa, setManhwa] = useState<MangaCard[]>([])
  const [loadingTop, setLoadingTop] = useState(true)
  const [loadingPub, setLoadingPub] = useState(true)
  const [loadingReko, setLoadingReko] = useState(true)
  const [loadingManhwa, setLoadingManhwa] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'publishing'>('info')

  const fetchAll = useCallback(async () => {
    // top manga by score
    fetchWithRetry(`${JIKAN}/top/manga?filter=bypopularity&limit=12`)
      .then(d => { setTopManga(d.data || []); setLoadingTop(false) })
      .catch(() => setLoadingTop(false))

    await delay(400)

    // currently publishing (ongoing)
    fetchWithRetry(`${JIKAN}/top/manga?filter=publishing&limit=10`)
      .then(d => { setPublishing(d.data || []); setLoadingPub(false) })
      .catch(() => setLoadingPub(false))

    await delay(400)

    // rekomendasi by favorites
    fetchWithRetry(`${JIKAN}/top/manga?filter=favorite&limit=12`)
      .then(d => { setRekomendasi(d.data || []); setLoadingReko(false) })
      .catch(() => setLoadingReko(false))

    await delay(400)

    // manhwa (korean)
    fetchWithRetry(`${JIKAN}/manga?type=manhwa&order_by=score&sort=desc&limit=12&sfw=true`)
      .then(d => { setManhwa(d.data || []); setLoadingManhwa(false) })
      .catch(() => setLoadingManhwa(false))
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const tabs = [
    { key: 'info', label: 'Info Manga' },
    { key: 'publishing', label: 'Ongoing' },
  ] as const

  return (
    <div style={{
      marginTop: 0,
      background: 'rgba(200,245,0,0.03)',
      border: '1px solid rgba(200,245,0,0.1)',
      borderRadius: 20,
      padding: '18px 16px',
    }}>
      {/* section title */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
      }}>
        <div style={{
          background: '#c8f500', borderRadius: 8,
          width: 4, height: 22, flexShrink: 0,
        }} />
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 22, letterSpacing: 2, color: '#c8f500',
        }}>MANGA</span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', letterSpacing: 1 }}>· MANHWA · MANHUA</span>
      </div>

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
          <MangaScrollSection title="TOP MANGA" emoji="🏆" items={topManga} loading={loadingTop} withRank />
          <MangaScrollSection title="REKOMENDASI" emoji="✨" items={rekomendasi} loading={loadingReko} />
          <MangaScrollSection title="MANHWA TERBAIK" emoji="🇰🇷" items={manhwa} loading={loadingManhwa} />
        </>
      )}

      {activeTab === 'publishing' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 16 }}>📖</span>
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 18, letterSpacing: 1.5, color: '#fff',
            }}>SEDANG TERBIT</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(200,245,0,0.12)', marginLeft: 4 }} />
          </div>

          {loadingPub ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} style={{
                  height: 78, borderRadius: 12, background: '#1a1a1a',
                  animation: 'kyoko-pulse 1.4s ease-in-out infinite',
                  animationDelay: `${i * 0.1}s`,
                }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {publishing.map((m, i) => (
                <PublishingItem key={m.mal_id} manga={m} rank={i + 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
