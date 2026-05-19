import React, { useEffect, useState, useCallback, useRef } from 'react'

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
  duration?: string
}

const JIKAN = 'https://api.jikan.moe/v4'
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchWithRetry(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) })
      if (res.status === 429) { await delay(2000); continue }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (i === retries) throw e
      await delay(900 * (i + 1))
    }
  }
}

function getTitle(a: AnimeCard) {
  return a.title_english || a.title || 'Unknown'
}
function getImg(a: AnimeCard) {
  return a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || ''
}

// ─── Skeleton Card ──────────────────────────────────────────────
function SkeletonCard({ delay: d = 0 }: { delay?: number }) {
  return (
    <div style={{
      width: 120, flexShrink: 0, borderRadius: 14,
      background: 'linear-gradient(135deg, #161616, #1e1e1e)',
      height: 170,
      animation: `ahs-pulse 1.6s ease-in-out ${d}s infinite`,
    }} />
  )
}

// ─── Anime Card ─────────────────────────────────────────────────
function AnimeCardMini({ anime, rank, accent = '#c8f500', onClick }: {
  anime: AnimeCard; rank?: number; accent?: string; onClick?: () => void
}) {
  const [hov, setHov] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
      style={{
        position: 'relative', borderRadius: 14, overflow: 'hidden',
        background: '#111', cursor: onClick ? 'pointer' : 'default',
        border: hov ? `1.5px solid ${accent}` : '1.5px solid rgba(200,245,0,0.1)',
        transition: 'all 0.25s cubic-bezier(.34,1.2,.64,1)',
        transform: hov ? 'translateY(-6px) scale(1.04)' : 'none',
        boxShadow: hov ? `0 12px 36px ${accent}30` : '0 2px 8px rgba(0,0,0,0.5)',
        flexShrink: 0, width: 120,
      }}
    >
      <div style={{ position: 'relative', paddingTop: '140%', background: '#1a1a1a' }}>
        {!imgLoaded && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(135deg,#161616,#1e1e1e)',
            animation: 'ahs-pulse 1.6s ease-in-out infinite',
          }} />
        )}
        <img
          src={getImg(anime)}
          alt={getTitle(anime)}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
            opacity: imgLoaded ? 1 : 0,
            transition: 'opacity 0.4s ease',
          }}
          onError={e => { (e.target as HTMLImageElement).style.opacity = '0' }}
        />
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)',
          height: '75%',
        }} />
        {rank && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            background: accent, color: '#000',
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 13, fontWeight: 700,
            padding: '1px 7px', borderRadius: 6, lineHeight: 1.5,
            boxShadow: `0 2px 8px ${accent}60`,
          }}>#{rank}</div>
        )}
        {anime.score && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            background: 'rgba(0,0,0,0.82)', color: accent,
            fontSize: 10, fontWeight: 700,
            padding: '2px 6px', borderRadius: 6,
            border: `1px solid ${accent}40`,
          }}>⭐ {anime.score.toFixed(1)}</div>
        )}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '8px 8px 6px' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1.3,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{getTitle(anime)}</div>
          {anime.episodes && (
            <div style={{ fontSize: 9, color: `${accent}b0`, marginTop: 2, fontWeight: 600 }}>
              {anime.episodes} eps
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Film Card (wider, landscape feel) ──────────────────────────
function FilmCard({ anime, rank }: { anime: AnimeCard; rank: number }) {
  const [hov, setHov] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const accent = '#f59e0b'

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: 'relative', borderRadius: 16, overflow: 'hidden',
        background: '#111', cursor: 'pointer', flexShrink: 0,
        width: 155, height: 220,
        border: hov ? `1.5px solid ${accent}` : '1.5px solid rgba(245,158,11,0.15)',
        transition: 'all 0.28s cubic-bezier(.34,1.2,.64,1)',
        transform: hov ? 'translateY(-8px) scale(1.05)' : 'none',
        boxShadow: hov ? `0 16px 40px rgba(245,158,11,0.25)` : '0 2px 10px rgba(0,0,0,0.6)',
      }}
    >
      {!imgLoaded && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg,#1a1610,#241e0a)',
          animation: 'ahs-pulse 1.6s ease-in-out infinite',
        }} />
      )}
      <img
        src={getImg(anime)}
        alt={getTitle(anime)}
        loading="lazy"
        onLoad={() => setImgLoaded(true)}
        style={{
          width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.4s ease',
        }}
        onError={e => { (e.target as HTMLImageElement).style.opacity = '0' }}
      />
      {/* cinematic vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)',
      }} />
      {/* film strip indicator */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 6,
        background: `linear-gradient(90deg, ${accent}00, ${accent}80, ${accent}00)`,
      }} />
      {/* rank badge - film style */}
      <div style={{
        position: 'absolute', top: 10, left: 10,
        background: `linear-gradient(135deg, ${accent}, #d97706)`,
        color: '#000', fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
        letterSpacing: 1,
      }}>FILM #{rank}</div>
      {anime.score && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: 'rgba(0,0,0,0.85)', color: accent,
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
          border: `1px solid ${accent}50`,
        }}>⭐ {anime.score.toFixed(1)}</div>
      )}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 10px 8px' }}>
        <div style={{
          fontSize: 12, fontWeight: 800, color: '#fff', lineHeight: 1.3,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
          marginBottom: 4,
        }}>{getTitle(anime)}</div>
        {anime.year && (
          <div style={{ fontSize: 10, color: `${accent}90`, fontWeight: 600 }}>
            {anime.year} · Film
          </div>
        )}
        <div style={{
          display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap',
        }}>
          {(anime.genres || []).slice(0, 2).map(g => (
            <span key={g.name} style={{
              fontSize: 9, fontWeight: 700, color: '#000',
              background: accent, padding: '1px 6px', borderRadius: 4,
            }}>{g.name}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Upcoming Item ──────────────────────────────────────────────
function UpcomingItem({ anime, rank, visible }: { anime: AnimeCard; rank: number; visible: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 14px',
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 14,
      border: '1px solid rgba(200,245,0,0.07)',
      transition: 'all 0.2s ease',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(0)' : 'translateX(-16px)',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(200,245,0,0.06)'
        e.currentTarget.style.borderColor = 'rgba(200,245,0,0.2)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
        e.currentTarget.style.borderColor = 'rgba(200,245,0,0.07)'
      }}
    >
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 24, color: '#c8f500', opacity: 0.45,
        minWidth: 28, textAlign: 'center', lineHeight: 1,
      }}>{rank}</div>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <img
          src={getImg(anime)}
          alt={getTitle(anime)}
          loading="lazy"
          style={{ width: 44, height: 58, objectFit: 'cover', borderRadius: 8, display: 'block' }}
          onError={e => { (e.target as HTMLImageElement).style.opacity = '0' }}
        />
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 8,
          border: '1px solid rgba(200,245,0,0.2)',
        }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{getTitle(anime)}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>
          {anime.type || 'TV'} · {(anime.members || 0).toLocaleString()} fans
        </div>
        <div style={{ fontSize: 10, color: 'rgba(200,245,0,0.65)', marginTop: 3, fontWeight: 600 }}>
          🕐 Belum tayang
        </div>
      </div>
    </div>
  )
}

// ─── Section Header ─────────────────────────────────────────────
function SectionHeader({ emoji, title, accent = '#c8f500' }: { emoji: string; title: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
      <span style={{ fontSize: 17 }}>{emoji}</span>
      <span style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 17, letterSpacing: 2, color: '#fff',
      }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${accent}30, transparent)`, marginLeft: 4 }} />
    </div>
  )
}

// ─── Scroll Row ──────────────────────────────────────────────────
function ScrollRow({ children, id }: { children: React.ReactNode; id?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  // touch scroll feel
  return (
    <div
      id={id}
      ref={ref}
      style={{
        display: 'flex', gap: 10,
        overflowX: 'auto', paddingBottom: 8, paddingTop: 2,
        scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' as any,
        scrollSnapType: 'x proximity',
      } as React.CSSProperties}
    >
      {children}
    </div>
  )
}

// ─── Main ───────────────────────────────────────────────────────
export default function AnimeHeroSection() {
  const [topAnime, setTopAnime] = useState<AnimeCard[]>([])
  const [latestAnime, setLatestAnime] = useState<AnimeCard[]>([])
  const [rekomendasi, setRekomendasi] = useState<AnimeCard[]>([])
  const [upcoming, setUpcoming] = useState<AnimeCard[]>([])
  const [films, setFilms] = useState<AnimeCard[]>([])

  const [loadingTop, setLoadingTop] = useState(true)
  const [loadingLatest, setLoadingLatest] = useState(true)
  const [loadingReko, setLoadingReko] = useState(true)
  const [loadingUpcoming, setLoadingUpcoming] = useState(true)
  const [loadingFilm, setLoadingFilm] = useState(true)

  const [activeTab, setActiveTab] = useState<'info' | 'upcoming'>('info')
  const [upcomingVisible, setUpcomingVisible] = useState(false)

  const fetchAll = useCallback(async () => {
    fetchWithRetry(`${JIKAN}/top/anime?filter=bypopularity&limit=12`)
      .then(d => { setTopAnime(d.data || []); setLoadingTop(false) })
      .catch(() => setLoadingTop(false))

    await delay(350)

    fetchWithRetry(`${JIKAN}/seasons/now?limit=12`)
      .then(d => { setLatestAnime(d.data || []); setLoadingLatest(false) })
      .catch(() => setLoadingLatest(false))

    await delay(350)

    fetchWithRetry(`${JIKAN}/top/anime?filter=favorite&limit=12`)
      .then(d => { setRekomendasi(d.data || []); setLoadingReko(false) })
      .catch(() => setLoadingReko(false))

    await delay(350)

    fetchWithRetry(`${JIKAN}/top/anime?filter=upcoming&limit=10`)
      .then(d => { setUpcoming(d.data || []); setLoadingUpcoming(false) })
      .catch(() => setLoadingUpcoming(false))

    await delay(350)

    // Fetch movies/films
    fetchWithRetry(`${JIKAN}/top/anime?type=movie&limit=12&filter=bypopularity`)
      .then(d => { setFilms(d.data || []); setLoadingFilm(false) })
      .catch(() => setLoadingFilm(false))
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Stagger upcoming items in
  useEffect(() => {
    if (activeTab === 'upcoming') {
      const t = setTimeout(() => setUpcomingVisible(true), 80)
      return () => clearTimeout(t)
    } else {
      setUpcomingVisible(false)
    }
  }, [activeTab])

  const tabs = [
    { key: 'info' as const, label: 'Info Anime' },
    { key: 'upcoming' as const, label: 'Akan Rilis' },
  ]

  return (
    <div style={{
      marginTop: 20,
      background: 'rgba(10,10,8,0.9)',
      border: '1px solid rgba(200,245,0,0.12)',
      borderRadius: 22,
      padding: '18px 14px 22px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes ahs-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        @keyframes ahs-fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ahs-tab-in {
          from { opacity: 0; transform: translateX(10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .ahs-scroll-row::-webkit-scrollbar { display: none; }
      `}</style>

      {/* subtle top accent */}
      <div style={{
        position: 'absolute', top: 0, left: '20%', right: '20%', height: 2,
        background: 'linear-gradient(90deg, transparent, #c8f500, transparent)',
        borderRadius: 1,
      }} />

      {/* Tab Switcher */}
      <div style={{
        display: 'flex', gap: 5, marginBottom: 22,
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 999, padding: 4,
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 999,
              border: 'none', cursor: 'pointer',
              fontWeight: 800, fontSize: 12, letterSpacing: 0.6,
              transition: 'all 0.22s cubic-bezier(.34,1.2,.64,1)',
              background: activeTab === t.key
                ? 'linear-gradient(135deg, #c8f500, #a3e635)'
                : 'transparent',
              color: activeTab === t.key ? '#000' : 'rgba(255,255,255,0.45)',
              boxShadow: activeTab === t.key ? '0 4px 16px rgba(200,245,0,0.3)' : 'none',
              transform: activeTab === t.key ? 'scale(1.02)' : 'scale(1)',
            }}
          >{t.label}</button>
        ))}
      </div>

      {activeTab === 'info' && (
        <div style={{ animation: 'ahs-tab-in 0.28s ease both' }}>
          {/* TOP ANIME */}
          <div style={{ marginBottom: 28 }}>
            <SectionHeader emoji="🏆" title="TOP ANIME" />
            <div className="ahs-scroll-row" style={{
              display: 'flex', gap: 10, overflowX: 'auto',
              paddingBottom: 8, scrollbarWidth: 'none',
            }}>
              {loadingTop
                ? [...Array(5)].map((_, i) => <SkeletonCard key={i} delay={i * 0.1} />)
                : topAnime.map((a, i) => (
                    <AnimeCardMini key={a.mal_id} anime={a} rank={i + 1} accent="#c8f500" />
                  ))
              }
            </div>
          </div>

          {/* TERBARU / AIRING */}
          <div style={{ marginBottom: 28 }}>
            <SectionHeader emoji="🔥" title="TERBARU / AIRING" accent="#f97316" />
            <div className="ahs-scroll-row" style={{
              display: 'flex', gap: 10, overflowX: 'auto',
              paddingBottom: 8, scrollbarWidth: 'none',
            }}>
              {loadingLatest
                ? [...Array(5)].map((_, i) => <SkeletonCard key={i} delay={i * 0.1} />)
                : latestAnime.map((a) => (
                    <AnimeCardMini key={a.mal_id} anime={a} accent="#f97316" />
                  ))
              }
            </div>
          </div>

          {/* ANIME FILM */}
          <div style={{ marginBottom: 28 }}>
            <SectionHeader emoji="🎬" title="ANIME FILM" accent="#f59e0b" />
            {/* film section header badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 99, padding: '4px 12px',
              marginBottom: 12,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#f59e0b',
                animation: 'ahs-pulse 1.4s ease-in-out infinite',
              }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: 1 }}>
                TOP MOVIE ALL TIME
              </span>
            </div>
            <div className="ahs-scroll-row" style={{
              display: 'flex', gap: 12, overflowX: 'auto',
              paddingBottom: 8, scrollbarWidth: 'none',
            }}>
              {loadingFilm
                ? [...Array(5)].map((_, i) => (
                    <div key={i} style={{
                      width: 155, height: 220, borderRadius: 16, flexShrink: 0,
                      background: 'linear-gradient(135deg,#1a1610,#241e0a)',
                      animation: `ahs-pulse 1.6s ease-in-out ${i * 0.1}s infinite`,
                    }} />
                  ))
                : films.map((a, i) => (
                    <FilmCard key={a.mal_id} anime={a} rank={i + 1} />
                  ))
              }
            </div>
          </div>

          {/* REKOMENDASI */}
          <div style={{ marginBottom: 4 }}>
            <SectionHeader emoji="✨" title="REKOMENDASI" accent="#a78bfa" />
            <div className="ahs-scroll-row" style={{
              display: 'flex', gap: 10, overflowX: 'auto',
              paddingBottom: 8, scrollbarWidth: 'none',
            }}>
              {loadingReko
                ? [...Array(5)].map((_, i) => <SkeletonCard key={i} delay={i * 0.1} />)
                : rekomendasi.map((a) => (
                    <AnimeCardMini key={a.mal_id} anime={a} accent="#a78bfa" />
                  ))
              }
            </div>
          </div>
        </div>
      )}

      {activeTab === 'upcoming' && (
        <div style={{ animation: 'ahs-tab-in 0.28s ease both' }}>
          <SectionHeader emoji="🗓️" title="AKAN SEGERA RILIS" />

          {/* info strip */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', borderRadius: 12, marginBottom: 16,
            background: 'rgba(200,245,0,0.05)',
            border: '1px solid rgba(200,245,0,0.12)',
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%', background: '#c8f500',
              animation: 'ahs-pulse 1.2s ease infinite', flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: 'rgba(200,245,0,0.7)', fontWeight: 600 }}>
              Update otomatis dari MyAnimeList
            </span>
          </div>

          {loadingUpcoming ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} style={{
                  height: 76, borderRadius: 14,
                  background: 'linear-gradient(135deg,#161616,#1e1e1e)',
                  animation: `ahs-pulse 1.6s ease-in-out ${i * 0.1}s infinite`,
                }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {upcoming.map((a, i) => (
                <div key={a.mal_id} style={{
                  transition: `all 0.3s ease ${i * 0.06}s`,
                }}>
                  <UpcomingItem anime={a} rank={i + 1} visible={upcomingVisible} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
