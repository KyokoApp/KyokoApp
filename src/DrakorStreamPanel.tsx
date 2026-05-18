import React, { useState, useCallback, useEffect, useRef } from 'react'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
interface DrakorInfo {
  tmdbId: number
  title: string
  titleOriginal: string
  thumbnail: string
  banner?: string
  episodes: number | null
  seasons: number
  status: string
  genres: string[]
  description: string
  score: number
  year?: number
  country: string
  type: 'series' | 'movie'
}

type View = 'home' | 'results' | 'detail' | 'player'
type ContentType = 'series' | 'movie'
type Country = 'KR' | 'JP' | 'CN' | 'TH' | 'ALL'

// ═══════════════════════════════════════════════════════════════
// VIDSRC — same domains as AnimeStreamPanel
// ═══════════════════════════════════════════════════════════════
// S1-S2: vidsrc (kadang default dub) | S3: 2embed (original audio) | S4: embedsu
const VIDSRC_DOMAINS = [
  'vidsrc-embed.ru',
  'vidsrc-embed.su',
  'vidsrcme.su',
  'vsrc.su',
]
// Server alternatif — original audio, allow iframe
const ALT_DOMAINS = [
  { name: 'multiembed', tv: (id:number,s:number,e:number) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`, movie: (id:number) => `https://multiembed.mov/?video_id=${id}&tmdb=1` },
  { name: 'smashystream', tv: (id:number,s:number,e:number) => `https://embed.smashystream.com/playere.php?tmdb=${id}&season=${s}&episode=${e}`, movie: (id:number) => `https://embed.smashystream.com/playere.php?tmdb=${id}` },
  { name: 'superembed', tv: (id:number,s:number,e:number) => `https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1&s=${s}&e=${e}`, movie: (id:number) => `https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1` },
]

function buildVidsrcUrl(
  tmdbId: number,
  type: ContentType,
  episode = 1,
  season = 1,
  domainIndex = 0
): string {
  // Index 0-3: vidsrc domains | Index 4-6: alt domains (original audio)
  if (domainIndex >= VIDSRC_DOMAINS.length) {
    const alt = ALT_DOMAINS[(domainIndex - VIDSRC_DOMAINS.length) % ALT_DOMAINS.length]
    return type === 'movie' ? alt.movie(tmdbId) : alt.tv(tmdbId, season, episode)
  }
  const domain = VIDSRC_DOMAINS[domainIndex]
  if (type === 'movie') {
    return `https://${domain}/embed/movie?tmdb=${tmdbId}&autoplay=1`
  }
  return `https://${domain}/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}&autoplay=1`
}

// ═══════════════════════════════════════════════════════════════
// TMDB API
// ═══════════════════════════════════════════════════════════════
const TMDB_KEY = '4ef0d7355d9ffb5151e987764708ce96'
const TMDB = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p'

const COUNTRY_MAP: Record<Country, string> = {
  KR: '🇰🇷 Korea',
  JP: '🇯🇵 Jepang',
  CN: '🇨🇳 China',
  TH: '🇹🇭 Thailand',
  ALL: '🌏 Semua',
}

function parseTmdbShow(m: any, type: ContentType = 'series'): DrakorInfo {
  const isMovie = type === 'movie'
  const title = isMovie ? (m.title || m.original_title) : (m.name || m.original_name)
  const originalTitle = isMovie ? m.original_title : m.original_name
  const date = isMovie ? m.release_date : m.first_air_date
  const year = date ? parseInt(date.split('-')[0]) : undefined
  const country = (isMovie ? m.production_countries?.[0]?.iso_3166_1 : m.origin_country?.[0]) || '??'
  const thumb = m.poster_path ? `${IMG}/w342${m.poster_path}` : ''
  const banner = m.backdrop_path ? `${IMG}/w780${m.backdrop_path}` : undefined
  const genres = (m.genres || []).slice(0, 3).map((g: any) => g.name)
  const genreNames = genres.length ? genres : (m.genre_ids || []).slice(0, 3).map((id: number) => genreIdToName(id))

  const status = isMovie
    ? (m.status === 'Released' ? 'FINISHED' : 'UPCOMING')
    : (m.status === 'Ended' || m.status === 'Canceled' ? 'FINISHED'
      : m.status === 'Returning Series' ? 'RELEASING' : 'UPCOMING')

  return {
    tmdbId: m.id,
    title,
    titleOriginal: originalTitle || title,
    thumbnail: thumb,
    banner,
    episodes: isMovie ? null : (m.number_of_episodes || m.episode_count || null),
    seasons: isMovie ? 0 : (m.number_of_seasons || 1),
    status,
    genres: genreNames,
    description: (m.overview || '').slice(0, 220),
    score: Math.round((m.vote_average || 0) * 10) / 10,
    year,
    country,
    type,
  }
}

function genreIdToName(id: number): string {
  const map: Record<number, string> = {
    18: 'Drama', 10749: 'Romance', 35: 'Comedy', 28: 'Action',
    53: 'Thriller', 9648: 'Mystery', 10765: 'Sci-Fi', 14: 'Fantasy',
    27: 'Horror', 80: 'Crime', 99: 'Documentary',
  }
  return map[id] || 'Drama'
}

async function searchDrakor(query: string, country: Country, type: ContentType): Promise<DrakorInfo[]> {
  const endpoint = type === 'movie' ? 'search/movie' : 'search/tv'
  const url = `${TMDB}/${endpoint}?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&page=1&language=en-US`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error('Search failed')
  const data = await res.json()
  let results = (data.results || []).map((m: any) => parseTmdbShow(m, type))

  // Filter by country jika bukan ALL
  if (country !== 'ALL') {
    results = results.filter((d: DrakorInfo) =>
      d.country.toUpperCase() === country ||
      d.titleOriginal !== d.title // keep mixed results
    )
  }
  return results.slice(0, 20)
}

async function getTrendingDrakor(country: Country, type: ContentType): Promise<DrakorInfo[]> {
  try {
    // Discover popular dramas by country
    const countryParam = country !== 'ALL' ? `&with_origin_country=${country}` : '&with_origin_country=KR|JP|CN|TH'
    const typeParam = type === 'movie' ? 'movie' : 'tv'
    const url = `${TMDB}/discover/${typeParam}?api_key=${TMDB_KEY}&language=en-US&sort_by=popularity.desc${countryParam}&with_genres=18&page=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error('Trending failed')
    const data = await res.json()
    return (data.results || []).slice(0, 12).map((m: any) => parseTmdbShow(m, type))
  } catch {
    return []
  }
}

async function getShowDetail(tmdbId: number, type: ContentType): Promise<DrakorInfo | null> {
  try {
    const endpoint = type === 'movie' ? 'movie' : 'tv'
    const url = `${TMDB}/${endpoint}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json()
    return parseTmdbShow(data, type)
  } catch {
    return null
  }
}

async function getSeasonEpisodes(tmdbId: number, season: number): Promise<number> {
  try {
    const url = `${TMDB}/tv/${tmdbId}/season/${season}?api_key=${TMDB_KEY}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return 16
    const data = await res.json()
    return data.episodes?.length || 16
  } catch {
    return 16
  }
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const S = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;900&display=swap');

.dk-wrap { display:flex; flex-direction:column; height:100%; overflow:hidden; background:#080810; color:#fff; font-family:'Outfit','Segoe UI',sans-serif; }

/* Header */
.dk-header { display:flex; align-items:center; gap:10px; padding:11px 14px; flex-shrink:0; background:rgba(8,8,16,0.97); border-bottom:1px solid rgba(255,82,82,0.12); z-index:20; }
.dk-logo { font-size:13px; font-weight:900; letter-spacing:.5px; background:linear-gradient(135deg,#ff5252,#ff9a3c); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
.dk-back { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:5px 11px; color:rgba(255,255,255,0.7); font-size:12px; cursor:pointer; font-family:inherit; }

/* Filter bar */
.dk-filter-bar { display:flex; gap:5px; padding:8px 14px 4px; overflow-x:auto; flex-shrink:0; scrollbar-width:none; }
.dk-filter-bar::-webkit-scrollbar { display:none; }
.dk-filter-btn { padding:5px 12px; border-radius:20px; font-size:10px; font-weight:700; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.35); white-space:nowrap; font-family:inherit; transition:all .15s; flex-shrink:0; }
.dk-filter-btn.active { background:rgba(255,82,82,0.15); border-color:#ff5252; color:#ff5252; }
.dk-filter-btn.movie { }
.dk-filter-btn.movie.active { background:rgba(255,154,60,0.15); border-color:#ff9a3c; color:#ff9a3c; }

/* Search */
.dk-search-bar { display:flex; gap:8px; padding:8px 14px; flex-shrink:0; }
.dk-search-input { flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:10px 14px; color:#fff; font-size:13px; outline:none; font-family:inherit; }
.dk-search-input:focus { border-color:rgba(255,82,82,0.5); }
.dk-search-input::placeholder { color:rgba(255,255,255,0.25); }
.dk-search-btn { background:linear-gradient(135deg,#ff5252,#c62828); border:none; border-radius:12px; padding:10px 16px; color:#fff; font-size:13px; font-weight:700; cursor:pointer; white-space:nowrap; font-family:inherit; }
.dk-search-btn:disabled { opacity:.45; }

/* Scroll area */
.dk-scroll { flex:1; overflow-y:auto; padding:10px 14px 80px; scrollbar-width:none; }
.dk-scroll::-webkit-scrollbar { display:none; }
.dk-section-label { font-size:10px; font-weight:700; color:rgba(255,82,82,0.6); letter-spacing:1.5px; text-transform:uppercase; margin-bottom:10px; display:flex; align-items:center; gap:6px; }
.dk-section-label::after { content:''; flex:1; height:1px; background:rgba(255,82,82,0.12); }

/* Grid cards */
.dk-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.dk-card { border-radius:10px; overflow:hidden; cursor:pointer; position:relative; aspect-ratio:2/3; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); }
.dk-card:active { transform:scale(0.97); }
.dk-card-img { width:100%; height:100%; object-fit:cover; display:block; }
.dk-card-overlay { position:absolute; inset:0; background:linear-gradient(to top,rgba(0,0,0,0.92) 40%,transparent 100%); }
.dk-card-info { position:absolute; bottom:0; left:0; right:0; padding:8px; }
.dk-card-title { font-size:10px; font-weight:700; color:#fff; line-height:1.2; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-bottom:3px; }
.dk-card-meta { font-size:9px; color:rgba(255,255,255,0.4); display:flex; gap:4px; align-items:center; }
.dk-card-score { font-size:9px; color:#fbbf24; font-weight:700; }
.dk-card-country { font-size:9px; }

/* Result list */
.dk-result-list { display:flex; flex-direction:column; gap:8px; }
.dk-result-card { display:flex; gap:12px; align-items:flex-start; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:10px; cursor:pointer; }
.dk-result-card:active { transform:scale(0.98); }
.dk-result-thumb { width:56px; height:80px; border-radius:8px; object-fit:cover; flex-shrink:0; background:rgba(255,255,255,0.06); }
.dk-result-body { flex:1; min-width:0; }
.dk-result-title { font-size:13px; font-weight:700; color:#fff; line-height:1.3; margin-bottom:3px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.dk-result-sub { font-size:10px; color:rgba(255,255,255,0.35); margin-bottom:5px; }
.dk-result-tags { display:flex; gap:4px; flex-wrap:wrap; }
.dk-tag { font-size:9px; padding:2px 7px; border-radius:4px; font-weight:600; background:rgba(255,82,82,0.1); border:1px solid rgba(255,82,82,0.2); color:#ff5252; }
.dk-tag.score { background:rgba(251,191,36,0.1); border-color:rgba(251,191,36,0.2); color:#fbbf24; }
.dk-tag.ep { background:rgba(96,165,250,0.1); border-color:rgba(96,165,250,0.2); color:#60a5fa; }
.dk-tag.movie { background:rgba(255,154,60,0.1); border-color:rgba(255,154,60,0.2); color:#ff9a3c; }

/* Status badges */
.dk-status { font-size:9px; padding:2px 7px; border-radius:4px; font-weight:700; }
.dk-status.airing { background:rgba(52,211,153,0.12); border:1px solid rgba(52,211,153,0.25); color:#34d399; }
.dk-status.finished { background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.2); color:#94a3b8; }
.dk-status.upcoming { background:rgba(251,191,36,0.12); border:1px solid rgba(251,191,36,0.25); color:#fbbf24; }

/* Detail */
.dk-detail-banner { width:100%; aspect-ratio:16/6; object-fit:cover; flex-shrink:0; }
.dk-detail-banner-ph { width:100%; aspect-ratio:16/6; flex-shrink:0; background:linear-gradient(135deg,rgba(255,82,82,0.15),rgba(255,154,60,0.1)); display:flex; align-items:center; justify-content:center; font-size:40px; }
.dk-detail-header { display:flex; gap:12px; padding:12px 14px 0; flex-shrink:0; align-items:flex-start; }
.dk-detail-thumb { width:72px; height:102px; border-radius:10px; object-fit:cover; flex-shrink:0; border:2px solid rgba(255,82,82,0.3); margin-top:-32px; position:relative; z-index:5; box-shadow:0 4px 20px rgba(0,0,0,0.6); }
.dk-detail-title { font-size:15px; font-weight:900; color:#fff; line-height:1.2; margin-bottom:4px; }
.dk-detail-sub { font-size:11px; color:rgba(255,255,255,0.4); margin-bottom:6px; }
.dk-detail-tags { display:flex; gap:4px; flex-wrap:wrap; }
.dk-detail-desc { font-size:12px; color:rgba(255,255,255,0.45); line-height:1.6; padding:10px 14px; flex-shrink:0; }

/* Episode picker */
.dk-season-row { display:flex; gap:5px; padding:0 14px 8px; overflow-x:auto; scrollbar-width:none; }
.dk-season-row::-webkit-scrollbar { display:none; }
.dk-season-btn { padding:4px 12px; border-radius:6px; font-size:10px; font-weight:700; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.4); font-family:inherit; white-space:nowrap; transition:all .15s; }
.dk-season-btn.active { background:rgba(255,82,82,0.15); border-color:#ff5252; color:#ff5252; }
.dk-ep-section { padding:0 14px; flex-shrink:0; }
.dk-ep-label { font-size:10px; font-weight:700; color:rgba(255,82,82,0.6); letter-spacing:1.5px; margin-bottom:8px; display:flex; align-items:center; gap:6px; }
.dk-ep-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:5px; max-height:160px; overflow-y:auto; scrollbar-width:none; }
.dk-ep-grid::-webkit-scrollbar { display:none; }
.dk-ep-btn { aspect-ratio:1; border-radius:8px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:rgba(255,255,255,0.7); font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; display:flex; align-items:center; justify-content:center; }
.dk-ep-btn:active { transform:scale(0.9); }
.dk-ep-btn.active { background:rgba(255,82,82,0.18); border-color:#ff5252; color:#ff5252; }

/* Player */
.dk-player-box { width:100%; aspect-ratio:16/9; background:#000; position:relative; flex-shrink:0; overflow:hidden; }
.dk-player-box.dk-fullscreen-active { position:fixed; inset:0; width:100vw; height:100vh; aspect-ratio:unset; z-index:9999; background:#000; }
.dk-player-box:-webkit-full-screen { width:100vw !important; height:100vh !important; }
.dk-player-box:fullscreen { width:100vw !important; height:100vh !important; }
.dk-player-box:-webkit-full-screen iframe { width:100% !important; height:100% !important; }
.dk-player-box:fullscreen iframe { width:100% !important; height:100% !important; }
.dk-player-box iframe { width:100%; height:100%; border:none; display:block; }
.dk-player-loading { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; background:#0d0d0d; z-index:2; pointer-events:none; }
.dk-player-controls { display:flex; gap:6px; padding:10px 14px; flex-shrink:0; border-bottom:1px solid rgba(255,255,255,0.06); align-items:center; flex-wrap:wrap; }
.dk-ctrl { padding:6px 12px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer; border:1px solid; font-family:inherit; }
.dk-ctrl.dim { background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); color:rgba(255,255,255,0.6); }
.dk-ctrl:disabled { opacity:.35; cursor:not-allowed; }
.dk-domain-row { display:flex; gap:5px; padding:8px 14px 0; flex-shrink:0; align-items:center; }
.dk-domain-btn { padding:4px 10px; border-radius:6px; font-size:10px; font-weight:700; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.4); font-family:inherit; }
.dk-domain-btn.active { background:rgba(255,82,82,0.15); border-color:#ff5252; color:#ff5252; }
.dk-now-playing { font-size:11px; color:rgba(255,255,255,0.35); padding:6px 14px; flex-shrink:0; display:flex; align-items:center; gap:6px; }
.dk-now-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; background:#ff5252; animation:dk-pulse 1.4s ease infinite; }
@keyframes dk-pulse { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }

/* Zone blocker — blokir pojok iklan, biarkan tengah tembus */
.dk-zone-block {
  position:absolute; z-index:8;
  background:transparent;
  -webkit-tap-highlight-color:transparent;
  pointer-events:all;
}
/* pojok kanan atas — iklan close/skip button */
.dk-zone-tr { top:0; right:0; width:22%; height:22%; }
/* pojok kiri atas */
.dk-zone-tl { top:0; left:0; width:22%; height:22%; }
/* pojok kanan bawah — iklan overlay */
.dk-zone-br { bottom:0; right:0; width:22%; height:18%; }
/* pojok kiri bawah */
.dk-zone-bl { bottom:0; left:0; width:22%; height:18%; }
/* area tengah — TEMBUS ke player, pointer-events:none */
.dk-zone-center {
  position:absolute; z-index:7;
  top:22%; left:22%; right:22%; bottom:18%;
  pointer-events:none;
}
.dk-fs-btn { position:absolute; bottom:8px; right:8px; z-index:10; background:rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.2); border-radius:8px; color:#fff; font-size:14px; width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; backdrop-filter:blur(4px); transition:background .15s; }
.dk-fs-btn:hover { background:rgba(255,82,82,0.4); border-color:#ff5252; }
.dk-fs-close { position:fixed; top:12px; right:12px; z-index:10000; background:rgba(0,0,0,0.7); border:1px solid rgba(255,255,255,0.25); border-radius:50%; color:#fff; font-size:16px; width:36px; height:36px; display:flex; align-items:center; justify-content:center; cursor:pointer; }

/* Utility */
.dk-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:50px 20px; color:rgba(255,255,255,0.3); font-size:13px; }
.dk-spinner { width:30px; height:30px; border:3px solid rgba(255,82,82,0.15); border-top-color:#ff5252; border-radius:50%; animation:dk-spin .7s linear infinite; }
@keyframes dk-spin { to { transform:rotate(360deg); } }
.dk-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:60px 20px; color:rgba(255,255,255,0.2); font-size:13px; text-align:center; }
.dk-info-box { margin:8px 14px; padding:9px 12px; border-radius:10px; background:rgba(96,165,250,0.08); border:1px solid rgba(96,165,250,0.18); font-size:11px; color:rgba(96,165,250,0.8); line-height:1.5; flex-shrink:0; }
.dk-warn-box { margin:8px 14px; padding:9px 12px; border-radius:10px; background:rgba(251,191,36,0.07); border:1px solid rgba(251,191,36,0.2); font-size:11px; color:rgba(251,191,36,0.8); line-height:1.5; flex-shrink:0; }
`

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
interface Props {
  isAdmin: boolean
  userId: string
}

export default function DrakorStreamPanel({ isAdmin, userId }: Props) {
  const [view, setView] = useState<View>('home')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<DrakorInfo[]>([])
  const [trending, setTrending] = useState<DrakorInfo[]>([])
  const [trendLoading, setTrendLoading] = useState(true)

  const [country, setCountry] = useState<Country>('KR')
  const [contentType, setContentType] = useState<ContentType>('series')

  const [selected, setSelected] = useState<DrakorInfo | null>(null)
  const [selectedEp, setSelectedEp] = useState(1)
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [seasonEpCount, setSeasonEpCount] = useState(16)
  const [loadingEps, setLoadingEps] = useState(false)
  const [domainIndex, setDomainIndex] = useState(0)
  const [iframeLoading, setIframeLoading] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playerRef = useRef<HTMLDivElement>(null)

  // Load trending on mount + when filter changes
  useEffect(() => {
    setTrendLoading(true)
    setTrending([])
    getTrendingDrakor(country, contentType)
      .then(setTrending)
      .catch(() => {})
      .finally(() => setTrendLoading(false))
  }, [country, contentType])

  // Load episode count when season changes
  useEffect(() => {
    if (!selected || selected.type === 'movie') return
    setLoadingEps(true)
    getSeasonEpisodes(selected.tmdbId, selectedSeason)
      .then(n => { setSeasonEpCount(n); setSelectedEp(1) })
      .finally(() => setLoadingEps(false))
  }, [selected, selectedSeason])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true)
    setView('results')
    try {
      const found = await searchDrakor(query.trim(), country, contentType)
      setResults(found)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query, country, contentType])

  const handleSelect = async (item: DrakorInfo) => {
    // Fetch full detail for accurate episode/season count
    setSelected(item)
    setSelectedEp(1)
    setSelectedSeason(1)
    setDomainIndex(0)
    setView('detail')

    if (item.type === 'series') {
      setLoadingEps(true)
      const detail = await getShowDetail(item.tmdbId, item.type)
      if (detail) setSelected(detail)
      const eps = await getSeasonEpisodes(item.tmdbId, 1)
      setSeasonEpCount(eps)
      setLoadingEps(false)
    }
  }

  const handleWatch = (ep: number) => {
    setSelectedEp(ep)
    setIframeLoading(true)
    setView('player')
  }

  const handleSeasonChange = (s: number) => {
    setSelectedSeason(s)
    setSelectedEp(1)
  }

  // Fullscreen
  const lockLandscape = useCallback(async () => {
    try {
      if ((screen.orientation as any)?.lock) await (screen.orientation as any).lock('landscape')
    } catch {}
  }, [])

  const unlockOrientation = useCallback(() => {
    try { if ((screen.orientation as any)?.unlock) (screen.orientation as any).unlock() } catch {}
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const el = playerRef.current
    if (!el) return
    if (!isFullscreen) {
      const req = (el as any).requestFullscreen || (el as any).webkitRequestFullscreen
      if (req) {
        try {
          await req.call(el)
          setIsFullscreen(true)
          await lockLandscape()
        } catch {
          // Native fullscreen failed, fallback CSS fullscreen
          setIsFullscreen(true)
        }
      } else {
        setIsFullscreen(true)
      }
    } else {
      unlockOrientation()
      const exit = (document as any).exitFullscreen || (document as any).webkitExitFullscreen
      if (exit) { try { await exit.call(document) } catch {} }
      setIsFullscreen(false)
    }
  }, [isFullscreen, lockLandscape, unlockOrientation])

  useEffect(() => {
    const onFsChange = () => {
      const fsEl = (document as any).fullscreenElement || (document as any).webkitFullscreenElement
      if (!fsEl) { setIsFullscreen(false); try { if ((screen.orientation as any)?.unlock) (screen.orientation as any).unlock() } catch {} }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [])

  const statusClass = (s: string) => s === 'RELEASING' ? 'airing' : s === 'FINISHED' ? 'finished' : 'upcoming'
  const statusLabel = (s: string) => s === 'RELEASING' ? '● Ongoing' : s === 'FINISHED' ? 'Selesai' : 'Upcoming'

  const embedUrl = selected
    ? buildVidsrcUrl(selected.tmdbId, selected.type, selectedEp, selectedSeason, domainIndex)
    : null

  const countries: Country[] = ['ALL', 'KR', 'JP', 'CN', 'TH']

  return (
    <>
      <style>{S}</style>
      <div className="dk-wrap">

        {/* ── HOME ── */}
        {view === 'home' && (
          <>
            <div className="dk-header">
              <span className="dk-logo">🎬 DRAKOR STREAM</span>
            </div>

            {/* Country filter */}
            <div className="dk-filter-bar">
              {countries.map(c => (
                <button key={c} className={`dk-filter-btn${country === c ? ' active' : ''}`}
                  onClick={() => setCountry(c)}>
                  {c === 'ALL' ? '🌏 Semua' : c === 'KR' ? '🇰🇷 Korea' : c === 'JP' ? '🇯🇵 Jepang' : c === 'CN' ? '🇨🇳 China' : '🇹🇭 Thailand'}
                </button>
              ))}
              <button className={`dk-filter-btn movie${contentType === 'series' ? '' : ' active'}`}
                onClick={() => setContentType(t => t === 'series' ? 'movie' : 'series')}>
                {contentType === 'series' ? '📺 Series' : '🎬 Movie'}
              </button>
            </div>

            <div className="dk-search-bar">
              <input className="dk-search-input" placeholder={`Cari ${contentType === 'movie' ? 'film' : 'drama'}...`}
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()} />
              <button className="dk-search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
                {searching ? '...' : 'Cari'}
              </button>
            </div>

            <div className="dk-scroll">
              <div className="dk-section-label">
                🔥 Populer {country !== 'ALL' ? COUNTRY_MAP[country] : 'Asia'}
              </div>
              {trendLoading ? (
                <div className="dk-loading"><div className="dk-spinner" /><span>Memuat...</span></div>
              ) : trending.length === 0 ? (
                <div className="dk-empty"><span style={{ fontSize: 32 }}>🎬</span><span>Tidak ada data</span></div>
              ) : (
                <div className="dk-grid">
                  {trending.map(d => (
                    <div key={d.tmdbId} className="dk-card" onClick={() => handleSelect(d)}>
                      {d.thumbnail
                        ? <img className="dk-card-img" src={d.thumbnail} alt={d.title} loading="lazy" />
                        : <div style={{ width: '100%', height: '100%', background: 'rgba(255,82,82,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🎬</div>
                      }
                      <div className="dk-card-overlay" />
                      <div className="dk-card-info">
                        <div className="dk-card-title">{d.title}</div>
                        <div className="dk-card-meta">
                          {d.score > 0 && <span className="dk-card-score">★ {d.score}</span>}
                          <span className="dk-card-country">{d.country === 'KR' ? '🇰🇷' : d.country === 'JP' ? '🇯🇵' : d.country === 'CN' ? '🇨🇳' : d.country === 'TH' ? '🇹🇭' : '🌏'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── RESULTS ── */}
        {view === 'results' && (
          <>
            <div className="dk-header">
              <button className="dk-back" onClick={() => setView('home')}>← Home</button>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                {searching ? 'Mencari...' : `${results.length} hasil`}
              </span>
            </div>

            <div className="dk-filter-bar">
              {countries.map(c => (
                <button key={c} className={`dk-filter-btn${country === c ? ' active' : ''}`}
                  onClick={() => setCountry(c)}>
                  {c === 'ALL' ? '🌏' : c === 'KR' ? '🇰🇷' : c === 'JP' ? '🇯🇵' : c === 'CN' ? '🇨🇳' : '🇹🇭'}
                </button>
              ))}
              <button className={`dk-filter-btn movie${contentType === 'series' ? '' : ' active'}`}
                onClick={() => setContentType(t => t === 'series' ? 'movie' : 'series')}>
                {contentType === 'series' ? '📺' : '🎬'}
              </button>
            </div>

            <div className="dk-search-bar">
              <input className="dk-search-input" placeholder="Cari drama..." value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()} />
              <button className="dk-search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
                {searching ? '...' : 'Cari'}
              </button>
            </div>

            <div className="dk-scroll">
              {searching ? (
                <div className="dk-loading"><div className="dk-spinner" /><span>Mencari...</span></div>
              ) : results.length === 0 ? (
                <div className="dk-empty"><span style={{ fontSize: 32 }}>🔍</span><span>Tidak ditemukan</span><span style={{ fontSize: 11 }}>Coba dengan judul asli (Korea/Inggris)</span></div>
              ) : (
                <div className="dk-result-list">
                  {results.map(d => (
                    <div key={d.tmdbId} className="dk-result-card" onClick={() => handleSelect(d)}>
                      {d.thumbnail
                        ? <img className="dk-result-thumb" src={d.thumbnail} alt={d.title} loading="lazy" />
                        : <div className="dk-result-thumb" style={{ background: 'rgba(255,82,82,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🎬</div>
                      }
                      <div className="dk-result-body">
                        <div className="dk-result-title">{d.title}</div>
                        <div className="dk-result-sub">{d.titleOriginal} · {d.year || '?'} · {d.country === 'KR' ? '🇰🇷' : d.country === 'JP' ? '🇯🇵' : d.country === 'CN' ? '🇨🇳' : '🌏'}</div>
                        <div className="dk-result-tags">
                          {d.score > 0 && <span className="dk-tag score">★ {d.score}</span>}
                          {d.type === 'movie'
                            ? <span className="dk-tag movie">🎬 Film</span>
                            : d.episodes && <span className="dk-tag ep">{d.episodes} ep</span>
                          }
                          <span className={`dk-status ${statusClass(d.status)}`}>{statusLabel(d.status)}</span>
                          {d.genres.slice(0, 2).map(g => <span key={g} className="dk-tag">{g}</span>)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── DETAIL ── */}
        {view === 'detail' && selected && (
          <>
            <div className="dk-header">
              <button className="dk-back" onClick={() => setView(results.length > 0 ? 'results' : 'home')}>← Kembali</button>
            </div>
            <div className="dk-scroll" style={{ padding: '0 0 80px' }}>
              {selected.banner
                ? <img className="dk-detail-banner" src={selected.banner} alt="" />
                : <div className="dk-detail-banner-ph">🎬</div>
              }
              <div className="dk-detail-header">
                {selected.thumbnail
                  ? <img className="dk-detail-thumb" src={selected.thumbnail} alt={selected.title} />
                  : <div className="dk-detail-thumb" style={{ background: 'rgba(255,82,82,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🎬</div>
                }
                <div style={{ flex: 1, minWidth: 0, paddingTop: 8 }}>
                  <div className="dk-detail-title">{selected.title}</div>
                  <div className="dk-detail-sub">
                    {selected.titleOriginal !== selected.title && `${selected.titleOriginal} · `}
                    {selected.year || '?'} · {selected.country === 'KR' ? '🇰🇷 Korea' : selected.country === 'JP' ? '🇯🇵 Jepang' : selected.country === 'CN' ? '🇨🇳 China' : selected.country === 'TH' ? '🇹🇭 Thailand' : selected.country}
                  </div>
                  <div className="dk-detail-tags">
                    {selected.score > 0 && <span className="dk-tag score">★ {selected.score}</span>}
                    <span className={`dk-status ${statusClass(selected.status)}`}>{statusLabel(selected.status)}</span>
                    {selected.type === 'movie' && <span className="dk-tag movie">🎬 Film</span>}
                    {selected.genres.slice(0, 2).map(g => <span key={g} className="dk-tag">{g}</span>)}
                  </div>
                </div>
              </div>

              {selected.description && (
                <div className="dk-detail-desc">{selected.description}...</div>
              )}

              {selected.type === 'movie' ? (
                // Movie: tombol tonton langsung
                <div style={{ padding: '12px 14px' }}>
                  <div className="dk-info-box">
                    ✅ Film siap ditonton via <strong>VidSrc</strong>
                  </div>
                  <button
                    className="dk-search-btn"
                    style={{ width: '100%', marginTop: 12, padding: '12px', fontSize: 14, borderRadius: 12 }}
                    onClick={() => { setIframeLoading(true); setView('player') }}>
                    ▶ Tonton Sekarang
                  </button>
                </div>
              ) : (
                // Series: season + episode picker
                <>
                  {selected.seasons > 1 && (
                    <>
                      <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: 'rgba(255,82,82,0.6)', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                        SEASON
                      </div>
                      <div className="dk-season-row">
                        {Array.from({ length: selected.seasons }, (_, i) => i + 1).map(s => (
                          <button key={s}
                            className={`dk-season-btn${selectedSeason === s ? ' active' : ''}`}
                            onClick={() => handleSeasonChange(s)}>
                            Season {s}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="dk-ep-section" style={{ marginTop: 8 }}>
                    <div className="dk-ep-label">
                      📺 EPISODE {selected.seasons > 1 ? `· S${selectedSeason}` : ''}
                    </div>
                    {loadingEps ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                        <div className="dk-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                        Memuat episode...
                      </div>
                    ) : (
                      <div className="dk-ep-grid">
                        {Array.from({ length: seasonEpCount }, (_, i) => i + 1).map(n => (
                          <button key={n}
                            className={`dk-ep-btn${selectedEp === n ? ' active' : ''}`}
                            onClick={() => handleWatch(n)}>
                            {n}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="dk-info-box" style={{ marginTop: 12 }}>
                    ✅ Stream siap via <strong>VidSrc</strong> — pilih episode untuk mulai.
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── PLAYER ── */}
        {view === 'player' && selected && (
          <>
            <div className="dk-header">
              <button className="dk-back" onClick={() => setView('detail')}>← Detail</button>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {selected.title}{selected.type === 'series' ? ` · S${selectedSeason} E${selectedEp}` : ''}
              </span>
            </div>

            {!embedUrl ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, textAlign: 'center' }}>
                <span style={{ fontSize: 36 }}>🔍</span>
                <span style={{ color: '#f87171', fontSize: 13, fontWeight: 700 }}>Stream tidak tersedia</span>
                <button className="dk-ctrl dim" style={{ marginTop: 8 }} onClick={() => setView('detail')}>← Kembali</button>
              </div>
            ) : (
              <>
                {/* Server selector */}
                <div className="dk-domain-row">
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginRight: 2 }}>Server:</span>
                  {[...VIDSRC_DOMAINS.map((_, i) => ({ label: `S${i+1}`, i })),
                    ...ALT_DOMAINS.map((a, i) => ({ label: a.name, i: i + VIDSRC_DOMAINS.length }))
                  ].map(({ label, i }) => (
                    <button key={i}
                      className={`dk-domain-btn${domainIndex === i ? ' active' : ''}`}
                      onClick={() => { setDomainIndex(i); setIframeLoading(true) }}>
                      {label}
                    </button>
                  ))}
                  <span style={{fontSize:9,color:'rgba(255,255,255,0.2)',marginLeft:4}}>multiembed/smashy = audio asli</span>
                </div>

                {/* Player */}
                <div ref={playerRef} className={`dk-player-box${isFullscreen ? ' dk-fullscreen-active' : ''}`}>
                  {iframeLoading && (
                    <div className="dk-player-loading">
                      <div className="dk-spinner" style={{ width: 36, height: 36, borderWidth: 4 }} />
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Memuat stream...</span>
                    </div>
                  )}
                  <iframe
                    key={`${domainIndex}-${selected.tmdbId}-${selectedSeason}-${selectedEp}`}
                    src={embedUrl}
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media; gyroscope; accelerometer"
                    onLoad={() => setIframeLoading(false)}
                    style={{ opacity: iframeLoading ? 0 : 1, transition: 'opacity .3s' }}
                  />
                  {/* Zone blocker — blokir pojok iklan */}
                  <div className="dk-zone-block dk-zone-tr" title="Area terlindungi"/>
                  <div className="dk-zone-block dk-zone-tl" title="Area terlindungi"/>
                  <div className="dk-zone-block dk-zone-br" title="Area terlindungi"/>
                  <div className="dk-zone-block dk-zone-bl" title="Area terlindungi"/>
                  <div className="dk-zone-center"/>
                  <button className="dk-fs-btn" onClick={toggleFullscreen}>{isFullscreen ? '✕' : '⛶'}</button>
                  {isFullscreen && <button className="dk-fs-close" onClick={toggleFullscreen}>✕</button>}
                </div>

                {/* Controls (hanya series) */}
                {selected.type === 'series' && (
                  <div className="dk-player-controls">
                    <button className="dk-ctrl dim" disabled={selectedEp <= 1}
                      onClick={() => { setSelectedEp(e => e - 1); setIframeLoading(true) }}>
                      ‹ Ep {selectedEp - 1 > 0 ? selectedEp - 1 : '-'}
                    </button>
                    <button className="dk-ctrl dim" disabled={selectedEp >= seasonEpCount}
                      onClick={() => { setSelectedEp(e => e + 1); setIframeLoading(true) }}>
                      Ep {selectedEp < seasonEpCount ? selectedEp + 1 : '-'} ›
                    </button>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
                      S{selectedSeason}E{selectedEp}
                    </span>
                  </div>
                )}

                <div className="dk-now-playing">
                  <div className="dk-now-dot" />
                  <span>
                    {selected.title}
                    {selected.type === 'series' ? ` · S${selectedSeason} Episode ${selectedEp}` : ' · Film'}
                  </span>
                </div>

                <div className="dk-warn-box">
                  💡 Audio Inggris? Coba <strong>multiembed</strong> atau <strong>smashystream</strong> — audio asli. S1–S4 = VidSrc (ada dub).
                </div>
              </>
            )}
          </>
        )}

      </div>
    </>
  )
}
