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

interface EmbedPlayer {
  id: string
  name: string
  icon: string
  color: string
  getUrl: (animeTitle: string, episode: number, animeId?: number) => string
}

type View = 'home' | 'results' | 'detail' | 'player'

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// EMBED PLAYERS
// Semua pakai format embed URL yang benar dan allow iframe
// ═══════════════════════════════════════════════════════════════
const EMBED_PLAYERS: EmbedPlayer[] = [
  {
    // vidsrc.to — format terbaru, paling lengkap kontennya
    id: 'vidsrc',
    name: 'VidSrc',
    icon: '🟢',
    color: '#4ade80',
    getUrl: (_title, ep, animeId) =>
      `https://vidsrc.to/embed/anime/${animeId || 0}/${ep}`,
  },
  {
    // vidsrc.su — mirror stabil
    id: 'vidsrc2',
    name: 'VidSrc 2',
    icon: '🟩',
    color: '#86efac',
    getUrl: (_title, ep, animeId) =>
      `https://vidsrc.su/embed/anime/${animeId || 0}/${ep}/1`,
  },
  {
    // vidsrc.in — mirror ke-3
    id: 'vidsrc3',
    name: 'VidSrc 3',
    icon: '🔵',
    color: '#60a5fa',
    getUrl: (_title, ep, animeId) =>
      `https://vidsrc.in/embed/anime?mal=${animeId || 0}&episode=${ep}`,
  },
  {
    // embed.su — MAL ID based, stabil
    id: 'embedsu',
    name: 'Embed.su',
    icon: '🟣',
    color: '#a78bfa',
    getUrl: (_title, ep, animeId) =>
      `https://embed.su/embed/anime/${animeId || 0}/${ep}`,
  },
  {
    // 2anime.xyz — khusus anime embed
    id: '2anime',
    name: '2Anime',
    icon: '🟠',
    color: '#fb923c',
    getUrl: (_title, ep, animeId) =>
      `https://2anime.xyz/embed/anime/${animeId || 0}/${ep}`,
  },
  {
    // anify embed — by MAL ID
    id: 'anify',
    name: 'Anify',
    icon: '🩵',
    color: '#38bdf8',
    getUrl: (_title, ep, animeId) =>
      `https://anify.tv/embed/anime/${animeId || 0}?episode=${ep}`,
  },
]

// ═══════════════════════════════════════════════════════════════
// JIKAN API v4 (MyAnimeList) — CORS open, no key needed
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

async function searchAniList(query: string): Promise<AnimeInfo[]> {
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
  font-family: 'Outfit', 'Segoe UI', sans-serif;
  position: relative;
}

/* ─── HEADER ─── */
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
.ax-back:hover { background: rgba(167,139,250,0.1); color: #a78bfa; border-color: rgba(167,139,250,0.3); }

/* ─── SEARCH ─── */
.ax-search-bar {
  display: flex; gap: 8px; padding: 12px 14px 8px; flex-shrink: 0;
}
.ax-search-input {
  flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 10px 14px; color: #fff; font-size: 13px;
  outline: none; transition: all .2s; font-family: inherit;
}
.ax-search-input:focus { border-color: rgba(167,139,250,0.5); background: rgba(167,139,250,0.06); box-shadow: 0 0 0 3px rgba(167,139,250,0.08); }
.ax-search-input::placeholder { color: rgba(255,255,255,0.25); }
.ax-search-btn {
  background: linear-gradient(135deg,#a78bfa,#7c3aed); border: none;
  border-radius: 12px; padding: 10px 16px; color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer; transition: all .2s;
  white-space: nowrap; font-family: inherit; flex-shrink: 0;
}
.ax-search-btn:hover { transform: scale(1.04); box-shadow: 0 0 18px rgba(167,139,250,0.4); }
.ax-search-btn:disabled { opacity: .45; transform: none; }

/* ─── SCROLL AREA ─── */
.ax-scroll {
  flex: 1; overflow-y: auto; padding: 10px 14px 80px;
  scrollbar-width: none;
}
.ax-scroll::-webkit-scrollbar { display: none; }

/* ─── TRENDING SECTION ─── */
.ax-section-label {
  font-size: 10px; font-weight: 700; color: rgba(167,139,250,0.6);
  letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 10px;
  display: flex; align-items: center; gap: 6px;
}
.ax-section-label::after {
  content: ''; flex: 1; height: 1px; background: rgba(167,139,250,0.12);
}

/* ─── CARD GRID ─── */
.ax-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
}
.ax-card {
  border-radius: 10px; overflow: hidden; cursor: pointer;
  position: relative; aspect-ratio: 2/3;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  transition: all .2s;
}
.ax-card:hover { border-color: rgba(167,139,250,0.3); transform: scale(1.02); }
.ax-card:active { transform: scale(0.97); }
.ax-card-img {
  width: 100%; height: 100%; object-fit: cover;
  display: block; transition: transform .3s;
}
.ax-card:hover .ax-card-img { transform: scale(1.06); }
.ax-card-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.92) 40%, transparent 100%);
}
.ax-card-info {
  position: absolute; bottom: 0; left: 0; right: 0;
  padding: 8px;
}
.ax-card-title {
  font-size: 10px; font-weight: 700; color: #fff; line-height: 1.2;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-bottom: 3px;
}
.ax-card-score {
  font-size: 9px; color: #fbbf24; font-weight: 700;
}
.ax-card-eps {
  font-size: 9px; color: rgba(255,255,255,0.4); margin-left: 4px;
}

/* ─── RESULT LIST (horizontal card style) ─── */
.ax-result-list { display: flex; flex-direction: column; gap: 8px; }
.ax-result-card {
  display: flex; gap: 12px; align-items: flex-start;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 10px; cursor: pointer; transition: all .2s; overflow: hidden;
  position: relative;
}
.ax-result-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: linear-gradient(#a78bfa,#60a5fa); opacity: 0; transition: opacity .2s;
}
.ax-result-card:hover { border-color: rgba(167,139,250,0.25); transform: translateX(4px); }
.ax-result-card:hover::before { opacity: 1; }
.ax-result-card:active { transform: scale(0.98); }
.ax-result-thumb {
  width: 56px; height: 80px; border-radius: 8px; object-fit: cover; flex-shrink: 0;
  background: rgba(255,255,255,0.06);
}
.ax-result-body { flex: 1; min-width: 0; }
.ax-result-title {
  font-size: 13px; font-weight: 700; color: #fff; line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-bottom: 4px;
}
.ax-result-sub { font-size: 10px; color: rgba(255,255,255,0.35); margin-bottom: 5px; }
.ax-result-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.ax-tag {
  font-size: 9px; padding: 2px 7px; border-radius: 4px; font-weight: 600;
  background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.2); color: #a78bfa;
}
.ax-tag.score { background: rgba(251,191,36,0.1); border-color: rgba(251,191,36,0.2); color: #fbbf24; }
.ax-tag.ep { background: rgba(96,165,250,0.1); border-color: rgba(96,165,250,0.2); color: #60a5fa; }

/* ─── DETAIL VIEW ─── */
.ax-detail-banner {
  width: 100%; aspect-ratio: 16/6; object-fit: cover; flex-shrink: 0;
  background: rgba(255,255,255,0.04);
}
.ax-detail-banner-placeholder {
  width: 100%; aspect-ratio: 16/6; flex-shrink: 0;
  background: linear-gradient(135deg,rgba(167,139,250,0.15),rgba(96,165,250,0.1));
  display: flex; align-items: center; justify-content: center; font-size: 40px;
}
.ax-detail-header {
  display: flex; gap: 12px; padding: 12px 14px 0; flex-shrink: 0; align-items: flex-start;
}
.ax-detail-thumb {
  width: 72px; height: 102px; border-radius: 10px; object-fit: cover;
  flex-shrink: 0; border: 2px solid rgba(167,139,250,0.3);
  margin-top: -32px; position: relative; z-index: 5;
  box-shadow: 0 4px 20px rgba(0,0,0,0.6);
}
.ax-detail-title {
  font-size: 15px; font-weight: 900; color: #fff; line-height: 1.2;
  margin-bottom: 4px;
}
.ax-detail-sub { font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 6px; }
.ax-detail-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.ax-detail-desc {
  font-size: 12px; color: rgba(255,255,255,0.45); line-height: 1.6;
  padding: 10px 14px; flex-shrink: 0;
}

/* ─── EPISODE PICKER ─── */
.ax-ep-section { padding: 0 14px; flex-shrink: 0; }
.ax-ep-label {
  font-size: 10px; font-weight: 700; color: rgba(167,139,250,0.6);
  letter-spacing: 1.5px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
}
.ax-ep-grid {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px;
  max-height: 180px; overflow-y: auto; scrollbar-width: none;
}
.ax-ep-grid::-webkit-scrollbar { display: none; }
.ax-ep-btn {
  aspect-ratio: 1; border-radius: 8px; background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.7);
  font-size: 11px; font-weight: 700; cursor: pointer; transition: all .2s;
  font-family: inherit; display: flex; align-items: center; justify-content: center;
}
.ax-ep-btn:hover { background: rgba(167,139,250,0.15); border-color: rgba(167,139,250,0.4); color: #a78bfa; }
.ax-ep-btn:active { transform: scale(0.9); }
.ax-ep-btn.active { background: linear-gradient(135deg,#a78bfa22,#7c3aed22); border-color: #a78bfa; color: #a78bfa; }

/* ─── PLAYER VIEW ─── */
.ax-player-box {
  width: 100%; aspect-ratio: 16/9; background: #000;
  position: relative; flex-shrink: 0; overflow: hidden;
}
.ax-player-box iframe {
  width: 100%; height: 100%; border: none; display: block;
}
.ax-player-overlay-msg {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px;
  background: #000; color: rgba(255,255,255,0.3); font-size: 13px;
}
.ax-player-controls {
  display: flex; gap: 6px; padding: 10px 14px; flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; align-items: center;
}
.ax-ctrl {
  padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 700;
  cursor: pointer; border: 1px solid; transition: all .2s; font-family: inherit;
}
.ax-ctrl.accent { background: rgba(167,139,250,0.12); border-color: rgba(167,139,250,0.3); color: #a78bfa; }
.ax-ctrl.accent:hover { background: rgba(167,139,250,0.22); }
.ax-ctrl.dim { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); }
.ax-ctrl.dim:hover { background: rgba(255,255,255,0.1); color: #fff; }

.ax-now-playing {
  font-size: 11px; color: rgba(255,255,255,0.35); padding: 6px 14px; flex-shrink: 0;
  display: flex; align-items: center; gap: 6px;
}
.ax-now-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  animation: ax-pulse 1.4s ease infinite;
}
@keyframes ax-pulse { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }

/* ─── SERVER PICKER ─── */
.ax-server-scroll {
  flex: 1; overflow-y: auto; padding: 10px 14px 80px; scrollbar-width: none;
}
.ax-server-scroll::-webkit-scrollbar { display: none; }
.ax-server-card {
  display: flex; align-items: center; gap: 12px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 12px 14px; margin-bottom: 8px;
  cursor: pointer; transition: all .2s; position: relative; overflow: hidden;
}
.ax-server-card:hover { border-color: rgba(167,139,250,0.3); transform: translateX(3px); }
.ax-server-card.active { border-color: rgba(167,139,250,0.6); background: rgba(167,139,250,0.08); }
.ax-server-card:active { transform: scale(0.98); }
.ax-server-icon {
  width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 18px;
}
.ax-server-name { font-size: 13px; font-weight: 700; color: #fff; }
.ax-server-sub { font-size: 10px; color: rgba(255,255,255,0.35); margin-top: 2px; }
.ax-server-badge {
  margin-left: auto; font-size: 10px; padding: 3px 8px; border-radius: 5px;
  font-weight: 700; background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.25); color: #a78bfa;
}
.ax-server-check { font-size: 16px; color: #a78bfa; margin-left: 4px; }
.ax-server-tip {
  margin: 8px 14px; padding: 9px 12px; border-radius: 10px;
  background: rgba(96,165,250,0.08); border: 1px solid rgba(96,165,250,0.18);
  font-size: 11px; color: rgba(96,165,250,0.8); line-height: 1.5; flex-shrink: 0;
}

/* ─── LOADING ─── */
.ax-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 50px 20px; color: rgba(255,255,255,0.3); font-size: 13px;
}
.ax-spinner {
  width: 30px; height: 30px; border: 3px solid rgba(167,139,250,0.15);
  border-top-color: #a78bfa; border-radius: 50%; animation: ax-spin .7s linear infinite;
}
@keyframes ax-spin { to { transform: rotate(360deg); } }

/* ─── EMPTY ─── */
.ax-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 60px 20px; color: rgba(255,255,255,0.2); font-size: 13px; text-align: center;
}

/* ─── STATUS BADGE ─── */
.ax-status {
  font-size: 9px; padding: 2px 7px; border-radius: 4px; font-weight: 700;
}
.ax-status.airing { background: rgba(52,211,153,0.12); border: 1px solid rgba(52,211,153,0.25); color: #34d399; }
.ax-status.finished { background: rgba(148,163,184,0.12); border: 1px solid rgba(148,163,184,0.2); color: #94a3b8; }
.ax-status.upcoming { background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.25); color: #fbbf24; }

/* ─── OPEN EXTERNAL BTN ─── */
.ax-open-btn {
  width: 100%; padding: 12px; border-radius: 12px; border: none;
  background: linear-gradient(135deg,#a78bfa,#7c3aed); color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
  transition: all .2s; display: flex; align-items: center; justify-content: center; gap: 8px;
}
.ax-open-btn:hover { transform: scale(1.02); box-shadow: 0 0 20px rgba(167,139,250,0.4); }
.ax-open-btn:active { transform: scale(0.97); }
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
  const [activePlayer, setActivePlayer] = useState<EmbedPlayer>(EMBED_PLAYERS[0])
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // ── Load trending on mount ─────────────────────────────────
  useEffect(() => {
    getTrending()
      .then(setTrending)
      .catch(() => {})
      .finally(() => setTrendLoading(false))
  }, [])

  // ── Search ─────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true)
    setView('results')
    try {
      const found = await searchAniList(query.trim())
      setResults(found)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query])

  // ── Select anime ───────────────────────────────────────────
  const handleSelectAnime = (anime: AnimeInfo) => {
    setSelectedAnime(anime)
    setSelectedEp(1)
    setActivePlayer(EMBED_PLAYERS[0])
    setView('detail')
  }

  // ── Watch episode ──────────────────────────────────────────
  const handleWatch = (ep: number, player?: EmbedPlayer) => {
    setSelectedEp(ep)
    if (player) setActivePlayer(player)
    setView('player')
  }

  // ── Open in browser ────────────────────────────────────────
  const handleOpenExternal = () => {
    if (!selectedAnime) return
    const title = selectedAnime.titleRomaji || selectedAnime.title
    const url = activePlayer.getUrl(title, selectedEp, selectedAnime.id)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // ── Fullscreen ─────────────────────────────────────────────
  const handleFullscreen = () => {
    const el = iframeRef.current
    if (!el) return
    try {
      if (el.requestFullscreen) el.requestFullscreen()
      else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen()
    } catch {}
  }

  // ── Generate episode count ─────────────────────────────────
  const epCount = selectedAnime?.episodes || 24

  const statusClass = (status: string) => {
    if (status === 'RELEASING') return 'airing'
    if (status === 'FINISHED') return 'finished'
    return 'upcoming'
  }
  const statusLabel = (status: string) => {
    if (status === 'RELEASING') return '● Ongoing'
    if (status === 'FINISHED') return 'Selesai'
    if (status === 'NOT_YET_RELEASED') return 'Upcoming'
    return status
  }

  const currentUrl = selectedAnime
    ? activePlayer.getUrl(selectedAnime.titleRomaji || selectedAnime.title, selectedEp, selectedAnime.id)
    : ''

  return (
    <>
      <style>{S}</style>
      <div className="ax-wrap">

        {/* ══════════ HOME ══════════ */}
        {view === 'home' && (
          <>
            <div className="ax-header">
              <span className="ax-logo">✦ ANIME STREAM</span>
            </div>
            <div className="ax-search-bar">
              <input
                className="ax-search-input"
                placeholder="Cari anime... (One Piece, Naruto, dll)"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <button className="ax-search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
                {searching ? '...' : '🔍'}
              </button>
            </div>
            <div className="ax-scroll">
              <div className="ax-section-label">🔥 TRENDING SEKARANG</div>
              {trendLoading ? (
                <div className="ax-loading" style={{ padding: '30px 0' }}>
                  <div className="ax-spinner" />
                  <div>Memuat trending...</div>
                </div>
              ) : (
                <div className="ax-grid">
                  {trending.map(a => (
                    <div key={a.id} className="ax-card" onClick={() => handleSelectAnime(a)}>
                      {a.thumbnail
                        ? <img src={a.thumbnail} alt="" className="ax-card-img" loading="lazy" />
                        : <div style={{ width: '100%', height: '100%', background: 'rgba(167,139,250,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🎌</div>
                      }
                      <div className="ax-card-overlay" />
                      <div className="ax-card-info">
                        <div className="ax-card-title">{a.title}</div>
                        <span className="ax-card-score">{a.score > 0 ? `★${a.score.toFixed(1)}` : ''}</span>
                        <span className="ax-card-eps">{a.episodes ? `${a.episodes} ep` : ''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════════ RESULTS ══════════ */}
        {view === 'results' && (
          <>
            <div className="ax-header">
              <button className="ax-back" onClick={() => setView('home')}>‹</button>
              <span className="ax-logo">HASIL PENCARIAN</span>
            </div>
            <div className="ax-search-bar">
              <input
                className="ax-search-input"
                placeholder="Cari lagi..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <button className="ax-search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
                {searching ? '...' : '🔍'}
              </button>
            </div>
            <div className="ax-scroll">
              {searching ? (
                <div className="ax-loading"><div className="ax-spinner" /><div>Mencari...</div></div>
              ) : results.length === 0 ? (
                <div className="ax-empty">
                  <div style={{ fontSize: 36 }}>😶</div>
                  <div>Anime tidak ditemukan</div>
                  <div style={{ fontSize: 11 }}>Coba kata kunci lain</div>
                </div>
              ) : (
                <div className="ax-result-list">
                  {results.map(a => (
                    <div key={a.id} className="ax-result-card" onClick={() => handleSelectAnime(a)}>
                      {a.thumbnail
                        ? <img src={a.thumbnail} alt="" className="ax-result-thumb" loading="lazy" />
                        : <div className="ax-result-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🎌</div>
                      }
                      <div className="ax-result-body">
                        <div className="ax-result-title">{a.title}</div>
                        {a.title !== a.titleRomaji && (
                          <div className="ax-result-sub">{a.titleRomaji}</div>
                        )}
                        <div className="ax-result-tags">
                          {a.score > 0 && <span className="ax-tag score">★ {a.score.toFixed(1)}</span>}
                          {a.episodes && <span className="ax-tag ep">{a.episodes} ep</span>}
                          <span className={`ax-status ${statusClass(a.status)}`}>{statusLabel(a.status)}</span>
                          {a.genres.slice(0, 2).map(g => <span key={g} className="ax-tag">{g}</span>)}
                        </div>
                      </div>
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16, alignSelf: 'center' }}>›</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════════ DETAIL ══════════ */}
        {view === 'detail' && selectedAnime && (
          <>
            <div className="ax-header">
              <button className="ax-back" onClick={() => setView(results.length > 0 ? 'results' : 'home')}>‹</button>
              <span className="ax-logo" style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedAnime.title}
              </span>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' }}>
                {/* Banner */}
                {selectedAnime.banner
                  ? <img src={selectedAnime.banner} alt="" className="ax-detail-banner" />
                  : <div className="ax-detail-banner-placeholder">🎌</div>
                }
                {/* Header */}
                <div className="ax-detail-header">
                  <img src={selectedAnime.thumbnail} alt="" className="ax-detail-thumb" />
                  <div style={{ flex: 1, paddingTop: 8 }}>
                    <div className="ax-detail-title">{selectedAnime.title}</div>
                    {selectedAnime.title !== selectedAnime.titleRomaji && (
                      <div className="ax-detail-sub">{selectedAnime.titleRomaji}</div>
                    )}
                    <div className="ax-detail-tags">
                      {selectedAnime.score > 0 && <span className="ax-tag score">★ {selectedAnime.score.toFixed(1)}</span>}
                      {selectedAnime.episodes && <span className="ax-tag ep">{selectedAnime.episodes} ep</span>}
                      {selectedAnime.year && <span className="ax-tag">{selectedAnime.year}</span>}
                      <span className={`ax-status ${statusClass(selectedAnime.status)}`}>{statusLabel(selectedAnime.status)}</span>
                    </div>
                  </div>
                </div>
                {/* Desc */}
                {selectedAnime.description && (
                  <p className="ax-detail-desc">{selectedAnime.description}...</p>
                )}
                {/* Episode Picker */}
                <div className="ax-ep-section">
                  <div className="ax-ep-label">🎬 PILIH EPISODE</div>
                  <div className="ax-ep-grid">
                    {Array.from({ length: epCount }, (_, i) => i + 1).map(ep => (
                      <button
                        key={ep}
                        className={`ax-ep-btn${selectedEp === ep ? ' active' : ''}`}
                        onClick={() => { setSelectedEp(ep); handleWatch(ep) }}
                      >
                        {ep}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Genres */}
                {selectedAnime.genres.length > 0 && (
                  <div style={{ padding: '10px 14px 4px', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {selectedAnime.genres.map(g => <span key={g} className="ax-tag">{g}</span>)}
                  </div>
                )}
                {/* Quick Watch button */}
                <div style={{ padding: '12px 14px 30px' }}>
                  <button className="ax-open-btn" onClick={() => handleWatch(selectedEp)}>
                    ▶ Tonton Episode {selectedEp}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══════════ PLAYER ══════════ */}
        {view === 'player' && selectedAnime && (
          <>
            <div className="ax-header">
              <button className="ax-back" onClick={() => setView('detail')}>‹ Detail</button>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {selectedAnime.title} · Ep {selectedEp}
              </span>
            </div>

            {/* Player Box */}
            <div className="ax-player-box">
              <iframe
                ref={iframeRef}
                src={currentUrl}
                allowFullScreen
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
                key={`${activePlayer.id}-${selectedEp}`}
                style={{ border: 'none', width: '100%', height: '100%', display: 'block', background: '#000' }}
              />
            </div>

            {/* Now Playing */}
            <div className="ax-now-playing">
              <div className="ax-now-dot" style={{ background: activePlayer.color }} />
              <span>{activePlayer.name} · {selectedAnime.title} Ep {selectedEp}</span>
            </div>

            {/* Controls */}
            <div className="ax-player-controls">
              <button className="ax-ctrl accent" onClick={handleFullscreen}>⛶ Fullscreen</button>
              <button className="ax-ctrl dim" onClick={() => { if (selectedEp > 1) setSelectedEp(e => e - 1) }}>
                ‹ Ep {selectedEp > 1 ? selectedEp - 1 : '-'}
              </button>
              <button className="ax-ctrl dim" onClick={() => { if (selectedEp < epCount) setSelectedEp(e => e + 1) }}>
                Ep {selectedEp < epCount ? selectedEp + 1 : '-'} ›
              </button>
            </div>

            {/* Tip */}
            <div className="ax-server-tip">
              💡 Coba <b>VidSrc</b> dulu — paling lengkap. Kalau kosong, coba mirror lainnya. Anime baru / season baru mungkin belum tersedia di semua server.
            </div>

            {/* Server Picker */}
            <div style={{ padding: '6px 14px 2px', fontSize: 10, fontWeight: 700, color: 'rgba(167,139,250,0.5)', letterSpacing: 1.5, flexShrink: 0 }}>
              GANTI SERVER ({EMBED_PLAYERS.length} tersedia)
            </div>
            <div className="ax-server-scroll">
              {EMBED_PLAYERS.map(player => {
                const isActive = activePlayer.id === player.id
                const subText =
                  player.id === 'vidsrc' ? '⭐ Paling lengkap — coba ini dulu'
                  : player.id === 'vidsrc2' ? 'Mirror VidSrc — fallback stabil'
                  : player.id === 'vidsrc3' ? 'Mirror VidSrc — by MAL ID'
                  : player.id === 'embedsu' ? 'Embed by MAL ID'
                  : player.id === '2anime' ? 'Khusus anime embed'
                  : player.id === 'anify' ? 'Embed by MAL ID'
                  : 'Embed player'
                return (
                  <div
                    key={player.id}
                    className={`ax-server-card${isActive ? ' active' : ''}`}
                    onClick={() => setActivePlayer(player)}
                  >
                    <div className="ax-server-icon" style={{ background: `${player.color}18` }}>
                      {player.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="ax-server-name">{player.name}</div>
                      <div className="ax-server-sub">{subText}</div>
                    </div>
                    {isActive
                      ? <span className="ax-server-check">✓</span>
                      : <span className="ax-server-badge" style={{ color: player.color, borderColor: `${player.color}33`, background: `${player.color}12` }}>
                          Pakai
                        </span>
                    }
                  </div>
                )
              })}
            </div>
          </>
        )}

      </div>
    </>
  )
}
