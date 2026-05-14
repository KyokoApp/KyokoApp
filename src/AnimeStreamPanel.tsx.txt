import React, { useState, useRef, useCallback, useEffect } from 'react'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
interface AnimeInfo {
  id: number
  title: string
  titleRomaji: string
  titleEnglish?: string
  thumbnail: string
  banner?: string
  episodes: number | null
  status: string
  genres: string[]
  description: string
  score: number
  year?: number
  format: string
}

interface StreamSource {
  url: string
  quality: string
  isM3U8: boolean
}

interface EpisodeInfo {
  id: string
  number: number
  title?: string
}

type View = 'home' | 'results' | 'detail' | 'player'

// ═══════════════════════════════════════════════════════════════
// CONSUMET API
// Public instances — sama yang dipakai Saikou & Aniyomi
// ═══════════════════════════════════════════════════════════════
const CONSUMET_INSTANCES = [
  'https://api.consumet.org',
  'https://consumet-api.onrender.com',
  'https://consumet.animepahe.ru',
]

async function fetchConsumet(path: string): Promise<any> {
  for (const base of CONSUMET_INSTANCES) {
    try {
      const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) return await res.json()
    } catch {
      // try next instance
    }
  }
  throw new Error('Semua Consumet instance tidak bisa diakses')
}

async function getEpisodeList(malId: number): Promise<EpisodeInfo[]> {
  try {
    const data = await fetchConsumet(`/meta/mal/episodes/${malId}`)
    if (data?.episodes?.length) {
      return data.episodes.map((ep: any) => ({
        id: ep.id,
        number: ep.number,
        title: ep.title,
      }))
    }
  } catch {}
  return []
}

async function getStreamSources(episodeId: string): Promise<StreamSource[]> {
  try {
    const data = await fetchConsumet(`/anime/gogoanime/watch/${encodeURIComponent(episodeId)}`)
    if (data?.sources?.length) {
      return data.sources.map((s: any) => ({
        url: s.url,
        quality: s.quality || 'auto',
        isM3U8: s.isM3U8 ?? s.url?.includes('.m3u8'),
      }))
    }
  } catch {}
  return []
}

// ═══════════════════════════════════════════════════════════════
// JIKAN API — untuk data anime (info, thumbnail, dll)
// ═══════════════════════════════════════════════════════════════
const JIKAN = 'https://api.jikan.moe/v4'

function parseJikan(m: any): AnimeInfo {
  const status = m.status === 'Currently Airing' ? 'RELEASING'
    : m.status === 'Finished Airing' ? 'FINISHED'
    : 'NOT_YET_RELEASED'
  return {
    id: m.mal_id,
    title: m.title_english || m.title,
    titleRomaji: m.title,
    titleEnglish: m.title_english,
    thumbnail: m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || '',
    banner: m.images?.jpg?.large_image_url || '',
    episodes: m.episodes || null,
    status,
    genres: (m.genres || []).slice(0, 3).map((g: any) => g.name),
    description: (m.synopsis || '').slice(0, 200),
    score: m.score || 0,
    year: m.year || m.aired?.prop?.from?.year,
    format: m.type || 'TV',
  }
}

async function searchAnime(query: string): Promise<AnimeInfo[]> {
  const res = await fetch(`${JIKAN}/anime?q=${encodeURIComponent(query)}&limit=18&sfw=true`)
  if (!res.ok) throw new Error('Jikan search failed')
  const data = await res.json()
  return (data.data || []).map(parseJikan)
}

async function getTrending(): Promise<AnimeInfo[]> {
  const res = await fetch(`${JIKAN}/top/anime?filter=airing&limit=12`)
  if (!res.ok) throw new Error('Jikan trending failed')
  const data = await res.json()
  return (data.data || []).map(parseJikan)
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const S = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;900&display=swap');
.ax-wrap {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
  background: #080810; color: #fff;
  font-family: 'Outfit', 'Segoe UI', sans-serif; position: relative;
}
.ax-header {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px; flex-shrink: 0;
  background: rgba(8,8,16,0.97);
  border-bottom: 1px solid rgba(167,139,250,0.12);
  position: relative; z-index: 20;
}
.ax-logo {
  font-size: 13px; font-weight: 900; letter-spacing: .5px;
  background: linear-gradient(135deg,#a78bfa,#60a5fa);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.ax-back {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px; padding: 5px 11px; color: rgba(255,255,255,0.7);
  font-size: 12px; cursor: pointer; transition: all .2s; font-family: inherit;
}
.ax-search-bar { display: flex; gap: 8px; padding: 12px 14px 8px; flex-shrink: 0; }
.ax-search-input {
  flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 10px 14px; color: #fff; font-size: 13px;
  outline: none; transition: all .2s; font-family: inherit;
}
.ax-search-input:focus { border-color: rgba(167,139,250,0.5); background: rgba(167,139,250,0.06); }
.ax-search-input::placeholder { color: rgba(255,255,255,0.25); }
.ax-search-btn {
  background: linear-gradient(135deg,#a78bfa,#7c3aed); border: none;
  border-radius: 12px; padding: 10px 16px; color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; font-family: inherit;
}
.ax-search-btn:disabled { opacity: .45; }
.ax-scroll { flex: 1; overflow-y: auto; padding: 10px 14px 80px; scrollbar-width: none; }
.ax-scroll::-webkit-scrollbar { display: none; }
.ax-section-label {
  font-size: 10px; font-weight: 700; color: rgba(167,139,250,0.6);
  letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 10px;
  display: flex; align-items: center; gap: 6px;
}
.ax-section-label::after { content: ''; flex: 1; height: 1px; background: rgba(167,139,250,0.12); }
.ax-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.ax-card {
  border-radius: 10px; overflow: hidden; cursor: pointer;
  position: relative; aspect-ratio: 2/3;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); transition: all .2s;
}
.ax-card:active { transform: scale(0.97); }
.ax-card-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ax-card-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.92) 40%, transparent 100%); }
.ax-card-info { position: absolute; bottom: 0; left: 0; right: 0; padding: 8px; }
.ax-card-title { font-size: 10px; font-weight: 700; color: #fff; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 3px; }
.ax-card-score { font-size: 9px; color: #fbbf24; font-weight: 700; }
.ax-card-eps { font-size: 9px; color: rgba(255,255,255,0.4); margin-left: 4px; }
.ax-result-list { display: flex; flex-direction: column; gap: 8px; }
.ax-result-card {
  display: flex; gap: 12px; align-items: flex-start;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 10px; cursor: pointer; transition: all .2s; position: relative;
}
.ax-result-card:active { transform: scale(0.98); }
.ax-result-thumb { width: 56px; height: 80px; border-radius: 8px; object-fit: cover; flex-shrink: 0; background: rgba(255,255,255,0.06); }
.ax-result-body { flex: 1; min-width: 0; }
.ax-result-title { font-size: 13px; font-weight: 700; color: #fff; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 4px; }
.ax-result-sub { font-size: 10px; color: rgba(255,255,255,0.35); margin-bottom: 5px; }
.ax-result-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.ax-tag { font-size: 9px; padding: 2px 7px; border-radius: 4px; font-weight: 600; background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.2); color: #a78bfa; }
.ax-tag.score { background: rgba(251,191,36,0.1); border-color: rgba(251,191,36,0.2); color: #fbbf24; }
.ax-tag.ep { background: rgba(96,165,250,0.1); border-color: rgba(96,165,250,0.2); color: #60a5fa; }
.ax-detail-banner { width: 100%; aspect-ratio: 16/6; object-fit: cover; flex-shrink: 0; background: rgba(255,255,255,0.04); }
.ax-detail-banner-placeholder { width: 100%; aspect-ratio: 16/6; flex-shrink: 0; background: linear-gradient(135deg,rgba(167,139,250,0.15),rgba(96,165,250,0.1)); display: flex; align-items: center; justify-content: center; font-size: 40px; }
.ax-detail-header { display: flex; gap: 12px; padding: 12px 14px 0; flex-shrink: 0; align-items: flex-start; }
.ax-detail-thumb { width: 72px; height: 102px; border-radius: 10px; object-fit: cover; flex-shrink: 0; border: 2px solid rgba(167,139,250,0.3); margin-top: -32px; position: relative; z-index: 5; box-shadow: 0 4px 20px rgba(0,0,0,0.6); }
.ax-detail-title { font-size: 15px; font-weight: 900; color: #fff; line-height: 1.2; margin-bottom: 4px; }
.ax-detail-sub { font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 6px; }
.ax-detail-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.ax-detail-desc { font-size: 12px; color: rgba(255,255,255,0.45); line-height: 1.6; padding: 10px 14px; flex-shrink: 0; }
.ax-ep-section { padding: 0 14px; flex-shrink: 0; }
.ax-ep-label { font-size: 10px; font-weight: 700; color: rgba(167,139,250,0.6); letter-spacing: 1.5px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.ax-ep-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; max-height: 180px; overflow-y: auto; scrollbar-width: none; }
.ax-ep-grid::-webkit-scrollbar { display: none; }
.ax-ep-btn { aspect-ratio: 1; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); font-size: 11px; font-weight: 700; cursor: pointer; transition: all .2s; font-family: inherit; display: flex; align-items: center; justify-content: center; }
.ax-ep-btn:active { transform: scale(0.9); }
.ax-ep-btn.active { background: linear-gradient(135deg,#a78bfa22,#7c3aed22); border-color: #a78bfa; color: #a78bfa; }
.ax-player-box { width: 100%; aspect-ratio: 16/9; background: #000; position: relative; flex-shrink: 0; overflow: hidden; }
.ax-player-box video { width: 100%; height: 100%; object-fit: contain; display: block; background: #000; }
.ax-player-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #0d0d0d; z-index: 2; padding: 20px; text-align: center; }
.ax-player-controls { display: flex; gap: 6px; padding: 10px 14px; flex-shrink: 0; border-bottom: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; align-items: center; }
.ax-ctrl { padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid; transition: all .2s; font-family: inherit; }
.ax-ctrl.accent { background: rgba(167,139,250,0.12); border-color: rgba(167,139,250,0.3); color: #a78bfa; }
.ax-ctrl.dim { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); }
.ax-ctrl:disabled { opacity: .35; cursor: not-allowed; }
.ax-now-playing { font-size: 11px; color: rgba(255,255,255,0.35); padding: 6px 14px; flex-shrink: 0; display: flex; align-items: center; gap: 6px; }
.ax-now-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: #a78bfa; animation: ax-pulse 1.4s ease infinite; }
@keyframes ax-pulse { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }
.ax-quality-row { display: flex; gap: 6px; padding: 8px 14px; flex-shrink: 0; flex-wrap: wrap; border-bottom: 1px solid rgba(255,255,255,0.06); }
.ax-quality-btn { padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 700; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.5); font-family: inherit; }
.ax-quality-btn.active { background: rgba(167,139,250,0.15); border-color: #a78bfa; color: #a78bfa; }
.ax-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 50px 20px; color: rgba(255,255,255,0.3); font-size: 13px; }
.ax-spinner { width: 30px; height: 30px; border: 3px solid rgba(167,139,250,0.15); border-top-color: #a78bfa; border-radius: 50%; animation: ax-spin .7s linear infinite; }
@keyframes ax-spin { to { transform: rotate(360deg); } }
.ax-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 60px 20px; color: rgba(255,255,255,0.2); font-size: 13px; text-align: center; }
.ax-status { font-size: 9px; padding: 2px 7px; border-radius: 4px; font-weight: 700; }
.ax-status.airing { background: rgba(52,211,153,0.12); border: 1px solid rgba(52,211,153,0.25); color: #34d399; }
.ax-status.finished { background: rgba(148,163,184,0.12); border: 1px solid rgba(148,163,184,0.2); color: #94a3b8; }
.ax-status.upcoming { background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.25); color: #fbbf24; }
.ax-info-box { margin: 8px 14px; padding: 9px 12px; border-radius: 10px; background: rgba(96,165,250,0.08); border: 1px solid rgba(96,165,250,0.18); font-size: 11px; color: rgba(96,165,250,0.8); line-height: 1.5; flex-shrink: 0; }
`

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
interface Props {
  isAdmin: boolean
  userId: string
}

export default function AnimeStreamPanel({ isAdmin, userId }: Props) {
  const [view, setView] = useState<View>('home')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<AnimeInfo[]>([])
  const [trending, setTrending] = useState<AnimeInfo[]>([])
  const [trendLoading, setTrendLoading] = useState(true)

  const [selectedAnime, setSelectedAnime] = useState<AnimeInfo | null>(null)
  const [selectedEp, setSelectedEp] = useState<number>(1)
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([])
  const [epLoading, setEpLoading] = useState(false)

  const [sources, setSources] = useState<StreamSource[]>([])
  const [activeSource, setActiveSource] = useState<StreamSource | null>(null)
  const [streamLoading, setStreamLoading] = useState(false)
  const [streamError, setStreamError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)

  // ── Load trending ──────────────────────────────────────────
  useEffect(() => {
    getTrending()
      .then(setTrending)
      .catch(() => {})
      .finally(() => setTrendLoading(false))
  }, [])

  // ── Load episode list saat anime dipilih ──────────────────
  useEffect(() => {
    if (!selectedAnime) return
    setEpLoading(true)
    setEpisodes([])
    getEpisodeList(selectedAnime.id)
      .then(eps => {
        if (eps.length > 0) {
          setEpisodes(eps)
        } else {
          const count = selectedAnime.episodes || 12
          setEpisodes(Array.from({ length: count }, (_, i) => ({
            id: `${selectedAnime.titleRomaji.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-episode-${i + 1}`,
            number: i + 1,
          })))
        }
      })
      .catch(() => {
        const count = selectedAnime.episodes || 12
        setEpisodes(Array.from({ length: count }, (_, i) => ({
          id: `${selectedAnime.titleRomaji.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-episode-${i + 1}`,
          number: i + 1,
        })))
      })
      .finally(() => setEpLoading(false))
  }, [selectedAnime])

  // ── Load HLS stream ────────────────────────────────────────
  const loadStream = useCallback(async (ep: EpisodeInfo) => {
    setStreamLoading(true)
    setStreamError('')
    setSources([])
    setActiveSource(null)
    setView('player')

    try {
      const srcs = await getStreamSources(ep.id)
      if (srcs.length === 0) {
        setStreamError('Tidak ada stream untuk episode ini. Coba episode lain.')
        setStreamLoading(false)
        return
      }
      setSources(srcs)
      const best = srcs.find(s => s.quality === '1080p')
        || srcs.find(s => s.quality === '720p')
        || srcs.find(s => s.quality === '480p')
        || srcs[0]
      setActiveSource(best)
    } catch {
      setStreamError('Gagal mengambil stream. Cek koneksi dan coba lagi.')
    } finally {
      setStreamLoading(false)
    }
  }, [])

  // ── Attach source ke video element ────────────────────────
  useEffect(() => {
    if (!activeSource || !videoRef.current) return
    const video = videoRef.current

    if (activeSource.isM3U8) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = activeSource.url
        video.load()
      } else {
        const loadHls = () => {
          const Hls = (window as any).Hls
          if (Hls?.isSupported()) {
            const hls = new Hls({ enableWorker: false })
            hls.loadSource(activeSource.url)
            hls.attachMedia(video)
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}))
          }
        }
        if ((window as any).Hls) {
          loadHls()
        } else {
          const s = document.createElement('script')
          s.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js'
          s.onload = loadHls
          document.head.appendChild(s)
        }
      }
    } else {
      video.src = activeSource.url
      video.load()
      video.play().catch(() => {})
    }
  }, [activeSource])

  // ── Search ─────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true)
    setView('results')
    try {
      const found = await searchAnime(query.trim())
      setResults(found)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query])

  const handleSelectAnime = (anime: AnimeInfo) => {
    setSelectedAnime(anime)
    setSelectedEp(1)
    setSources([])
    setActiveSource(null)
    setStreamError('')
    setView('detail')
  }

  const handleWatch = (ep: EpisodeInfo) => {
    setSelectedEp(ep.number)
    loadStream(ep)
  }

  const handleFullscreen = () => {
    const el = videoRef.current
    if (!el) return
    try {
      if (el.requestFullscreen) el.requestFullscreen()
      else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen()
    } catch {}
  }

  const epCount = episodes.length || selectedAnime?.episodes || 24

  const statusClass = (s: string) => s === 'RELEASING' ? 'airing' : s === 'FINISHED' ? 'finished' : 'upcoming'
  const statusLabel = (s: string) => s === 'RELEASING' ? '● Ongoing' : s === 'FINISHED' ? 'Selesai' : s === 'NOT_YET_RELEASED' ? 'Upcoming' : s

  return (
    <>
      <style>{S}</style>
      <div className="ax-wrap">

        {/* ══ HOME ══ */}
        {view === 'home' && (
          <>
            <div className="ax-header">
              <span className="ax-logo">✦ ANIME STREAM</span>
            </div>
            <div className="ax-search-bar">
              <input className="ax-search-input" placeholder="Cari anime..." value={query}
                onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
              <button className="ax-search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
                {searching ? '...' : 'Cari'}
              </button>
            </div>
            <div className="ax-scroll">
              <div className="ax-section-label">🔥 Trending Sekarang</div>
              {trendLoading ? (
                <div className="ax-loading"><div className="ax-spinner" /><span>Memuat...</span></div>
              ) : (
                <div className="ax-grid">
                  {trending.map(a => (
                    <div key={a.id} className="ax-card" onClick={() => handleSelectAnime(a)}>
                      <img className="ax-card-img" src={a.thumbnail} alt={a.title} loading="lazy" />
                      <div className="ax-card-overlay" />
                      <div className="ax-card-info">
                        <div className="ax-card-title">{a.title}</div>
                        {a.score > 0 && <span className="ax-card-score">★ {a.score}</span>}
                        {a.episodes && <span className="ax-card-eps">{a.episodes} ep</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ RESULTS ══ */}
        {view === 'results' && (
          <>
            <div className="ax-header">
              <button className="ax-back" onClick={() => setView('home')}>← Home</button>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                {searching ? 'Mencari...' : `${results.length} hasil`}
              </span>
            </div>
            <div className="ax-search-bar">
              <input className="ax-search-input" placeholder="Cari anime..." value={query}
                onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
              <button className="ax-search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
                {searching ? '...' : 'Cari'}
              </button>
            </div>
            <div className="ax-scroll">
              {searching ? (
                <div className="ax-loading"><div className="ax-spinner" /><span>Mencari...</span></div>
              ) : results.length === 0 ? (
                <div className="ax-empty"><span style={{ fontSize: 32 }}>🔍</span><span>Tidak ditemukan</span></div>
              ) : (
                <div className="ax-result-list">
                  {results.map(a => (
                    <div key={a.id} className="ax-result-card" onClick={() => handleSelectAnime(a)}>
                      <img className="ax-result-thumb" src={a.thumbnail} alt={a.title} loading="lazy" />
                      <div className="ax-result-body">
                        <div className="ax-result-title">{a.title}</div>
                        <div className="ax-result-sub">{a.titleRomaji} · {a.year || '?'} · {a.format}</div>
                        <div className="ax-result-tags">
                          {a.score > 0 && <span className="ax-tag score">★ {a.score}</span>}
                          {a.episodes && <span className="ax-tag ep">{a.episodes} ep</span>}
                          <span className={`ax-status ${statusClass(a.status)}`}>{statusLabel(a.status)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ DETAIL ══ */}
        {view === 'detail' && selectedAnime && (
          <>
            <div className="ax-header">
              <button className="ax-back" onClick={() => setView(results.length > 0 ? 'results' : 'home')}>← Kembali</button>
            </div>
            <div className="ax-scroll" style={{ padding: '0 0 80px' }}>
              {selectedAnime.banner
                ? <img className="ax-detail-banner" src={selectedAnime.banner} alt="" />
                : <div className="ax-detail-banner-placeholder">🎌</div>}
              <div className="ax-detail-header">
                <img className="ax-detail-thumb" src={selectedAnime.thumbnail} alt={selectedAnime.title} />
                <div style={{ flex: 1, minWidth: 0, paddingTop: 8 }}>
                  <div className="ax-detail-title">{selectedAnime.title}</div>
                  <div className="ax-detail-sub">{selectedAnime.titleRomaji} · {selectedAnime.year || '?'}</div>
                  <div className="ax-detail-tags">
                    {selectedAnime.score > 0 && <span className="ax-tag score">★ {selectedAnime.score}</span>}
                    <span className={`ax-status ${statusClass(selectedAnime.status)}`}>{statusLabel(selectedAnime.status)}</span>
                    {selectedAnime.genres.slice(0, 2).map(g => <span key={g} className="ax-tag">{g}</span>)}
                  </div>
                </div>
              </div>
              {selectedAnime.description && <div className="ax-detail-desc">{selectedAnime.description}...</div>}

              <div className="ax-ep-section">
                <div className="ax-ep-label">
                  📺 PILIH EPISODE
                  {epLoading && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>memuat...</span>}
                </div>
                {epLoading ? (
                  <div className="ax-loading" style={{ padding: '20px 0' }}><div className="ax-spinner" /></div>
                ) : (
                  <div className="ax-ep-grid">
                    {episodes.map(ep => (
                      <button key={ep.number} className={`ax-ep-btn ${selectedEp === ep.number ? 'active' : ''}`}
                        onClick={() => handleWatch(ep)}>
                        {ep.number}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="ax-info-box" style={{ marginTop: 12 }}>
                💡 Stream via <strong>Consumet API + HLS</strong> — cara yang sama dipakai Saikou & Aniyomi. Tidak ada iframe, langsung ke video player.
              </div>
            </div>
          </>
        )}

        {/* ══ PLAYER ══ */}
        {view === 'player' && selectedAnime && (
          <>
            <div className="ax-header">
              <button className="ax-back" onClick={() => setView('detail')}>← Detail</button>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {selectedAnime.title} · Ep {selectedEp}
              </span>
            </div>

            <div className="ax-player-box">
              {(streamLoading || (!activeSource && !streamError)) && (
                <div className="ax-player-overlay">
                  <div className="ax-spinner" style={{ width: 36, height: 36, borderWidth: 4 }} />
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Mengambil stream HLS...</span>
                  <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>Menghubungi Consumet API...</span>
                </div>
              )}
              {streamError && (
                <div className="ax-player-overlay">
                  <span style={{ fontSize: 32 }}>⚠️</span>
                  <span style={{ color: '#f87171', fontSize: 13, fontWeight: 700 }}>{streamError}</span>
                  <button onClick={() => setView('detail')}
                    style={{ marginTop: 8, padding: '8px 18px', background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    ← Pilih Episode Lain
                  </button>
                </div>
              )}
              <video
                ref={videoRef}
                controls
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: activeSource ? 'block' : 'none' }}
              />
            </div>

            {sources.length > 1 && (
              <div className="ax-quality-row">
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', alignSelf: 'center', marginRight: 4 }}>Kualitas:</span>
                {sources.map((s, i) => (
                  <button key={i} className={`ax-quality-btn ${activeSource?.url === s.url ? 'active' : ''}`}
                    onClick={() => setActiveSource(s)}>
                    {s.quality}
                  </button>
                ))}
              </div>
            )}

            <div className="ax-player-controls">
              <button className="ax-ctrl accent" onClick={handleFullscreen}>⛶ Fullscreen</button>
              <button className="ax-ctrl dim" disabled={selectedEp <= 1}
                onClick={() => {
                  const prev = episodes.find(e => e.number === selectedEp - 1) || { id: String(selectedEp - 1), number: selectedEp - 1 }
                  handleWatch(prev)
                }}>
                ‹ Ep {selectedEp - 1 > 0 ? selectedEp - 1 : '-'}
              </button>
              <button className="ax-ctrl dim" disabled={selectedEp >= epCount}
                onClick={() => {
                  const next = episodes.find(e => e.number === selectedEp + 1) || { id: String(selectedEp + 1), number: selectedEp + 1 }
                  handleWatch(next)
                }}>
                Ep {selectedEp < epCount ? selectedEp + 1 : '-'} ›
              </button>
            </div>

            <div className="ax-now-playing">
              <div className="ax-now-dot" />
              <span>{selectedAnime.title} · Episode {selectedEp}</span>
              {activeSource && <span style={{ marginLeft: 'auto', color: 'rgba(167,139,250,0.6)', fontSize: 10 }}>{activeSource.quality}</span>}
            </div>

            <div style={{ flex: 1, overflow: 'hidden auto', padding: '8px 0 40px', scrollbarWidth: 'none' }}>
              <div className="ax-info-box">
                🎬 Menggunakan <strong>HLS stream langsung</strong> — bukan iframe. Video diputar native di WebView tanpa masalah sandbox atau block.
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
