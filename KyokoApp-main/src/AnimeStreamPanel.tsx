import React, { useState, useRef, useCallback, useEffect } from 'react'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
interface SamAnime {
  title: string
  url: string
  original_url?: string
  thumbnail: string
  type?: string
  status?: string
  score?: string
  synopsis?: string
  genres?: string[]
  views?: string
}

interface SamEpisode {
  title: string
  url: string
  episode?: string
  date?: string
  thumbnail?: string
  // params untuk embed endpoint
  post?: string | number
  nume?: string | number
  type?: string
}

interface SamDetail {
  title: string
  thumbnail: string
  rating?: string
  synopsis?: string
  genres?: string[]
  details?: Record<string, string>
  episodeList?: SamEpisode[]
}

interface DlServer  { provider: string; url: string }
interface DlQuality { quality: string; servers: DlServer[] }
interface DlFormat  { format: string; list: DlQuality[] }

interface StreamResult {
  title?: string
  episode?: string
  downloadLinks?: DlFormat[]
}

type View = 'home' | 'results' | 'detail' | 'player'

// ═══════════════════════════════════════════════════════════════
// SAMEHADAKU API
// ═══════════════════════════════════════════════════════════════
const API = 'https://nexta-api.vercel.app'

async function apiHome(): Promise<SamAnime[]> {
  try {
    const r = await fetch(`${API}/api/anime/samehadaku/home`)
    const d = await r.json()
    const arr = d.result?.data || d.result?.recent || d.result?.latest || d.data || (Array.isArray(d.result) ? d.result : null) || []
    return Array.isArray(arr) ? arr.slice(0, 18) : []
  } catch { return [] }
}

async function apiSearch(q: string): Promise<SamAnime[]> {
  const r = await fetch(`${API}/api/anime/samehadaku/search?q=${encodeURIComponent(q)}`)
  if (!r.ok) throw new Error('Search gagal')
  const d = await r.json()
  return d.result?.data || d.data || []
}

async function apiDetail(url: string): Promise<SamDetail | null> {
  try {
    const r = await fetch(url)
    const d = await r.json()
    const result = d.result || d
    // Log raw response ke console agar bisa debug field episode
    if (import.meta.env.DEV) {
      console.log('[AnimeStream] detail raw:', JSON.stringify(result).slice(0, 500))
    }
    return result
  } catch { return null }
}

// Embed endpoint butuh: post (ID episode), nume (nomor server), type (tipe embed)
// Params ini ada di data episodeList dari detail endpoint
async function apiEmbed(
  post: string | number,
  nume: string | number,
  embedType: string,
  refUrl?: string
): Promise<string | null> {
  try {
    let qs = `post=${encodeURIComponent(post)}&nume=${encodeURIComponent(nume)}&type=${encodeURIComponent(embedType)}`
    if (refUrl) qs += `&url=${encodeURIComponent(refUrl)}`
    const r = await fetch(`${API}/api/anime/samehadaku/embed?${qs}`)
    const d = await r.json()
    return (
      d.result?.url      ||
      d.result?.embedUrl ||
      d.result?.embed    ||
      d.result?.src      ||
      d.result?.iframe   ||
      d.embedUrl         ||
      d.url              ||
      d.src              ||
      null
    )
  } catch { return null }
}

// Coba semua kombinasi server sampai dapat embed URL
async function apiEmbedAny(
  post: string | number,
  refUrl?: string
): Promise<string | null> {
  const types = ['schtm1', 'schtm2', 'schtm3', 'v', 'mp4', 'schtm']
  for (const t of types) {
    for (let n = 1; n <= 4; n++) {
      const url = await apiEmbed(post, n, t, refUrl)
      if (url) return url
    }
  }
  return null
}

async function apiStream(episodeUrl: string): Promise<StreamResult | null> {
  try {
    const r = await fetch(`${API}/api/anime/samehadaku/stream?url=${encodeURIComponent(episodeUrl)}`)
    const d = await r.json()
    return d.result || null
  } catch { return null }
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const S = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;900&display=swap');

.ax-wrap {
  display:flex; flex-direction:column; height:100%; overflow:hidden;
  background:#080810; color:#fff;
  font-family:'Outfit','Segoe UI',sans-serif; position:relative;
}
.ax-header {
  display:flex; align-items:center; gap:10px;
  padding:11px 14px; flex-shrink:0;
  background:rgba(8,8,16,0.97);
  border-bottom:1px solid rgba(167,139,250,0.12); position:relative; z-index:20;
}
.ax-logo {
  font-size:13px; font-weight:900; letter-spacing:.5px;
  background:linear-gradient(135deg,#a78bfa,#60a5fa);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
}
.ax-back {
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
  border-radius:8px; padding:5px 11px; color:rgba(255,255,255,0.7);
  font-size:12px; cursor:pointer; transition:all .2s; font-family:inherit;
}
.ax-back:hover { background:rgba(167,139,250,0.1); color:#a78bfa; border-color:rgba(167,139,250,0.3); }
.ax-search-bar { display:flex; gap:8px; padding:12px 14px 8px; flex-shrink:0; }
.ax-search-input {
  flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
  border-radius:12px; padding:10px 14px; color:#fff; font-size:13px;
  outline:none; transition:all .2s; font-family:inherit;
}
.ax-search-input:focus { border-color:rgba(167,139,250,0.5); background:rgba(167,139,250,0.06); box-shadow:0 0 0 3px rgba(167,139,250,0.08); }
.ax-search-input::placeholder { color:rgba(255,255,255,0.25); }
.ax-search-btn {
  background:linear-gradient(135deg,#a78bfa,#7c3aed); border:none;
  border-radius:12px; padding:10px 16px; color:#fff;
  font-size:13px; font-weight:700; cursor:pointer; transition:all .2s;
  white-space:nowrap; font-family:inherit; flex-shrink:0;
}
.ax-search-btn:hover { transform:scale(1.04); box-shadow:0 0 18px rgba(167,139,250,0.4); }
.ax-search-btn:disabled { opacity:.45; transform:none; }
.ax-scroll { flex:1; overflow-y:auto; padding:10px 14px 80px; scrollbar-width:none; }
.ax-scroll::-webkit-scrollbar { display:none; }
.ax-section-label {
  font-size:10px; font-weight:700; color:rgba(167,139,250,0.6);
  letter-spacing:1.5px; text-transform:uppercase; margin-bottom:10px;
  display:flex; align-items:center; gap:6px;
}
.ax-section-label::after { content:''; flex:1; height:1px; background:rgba(167,139,250,0.12); }
.ax-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.ax-card {
  border-radius:10px; overflow:hidden; cursor:pointer;
  position:relative; aspect-ratio:2/3;
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); transition:all .2s;
}
.ax-card:hover { border-color:rgba(167,139,250,0.3); transform:scale(1.02); }
.ax-card:active { transform:scale(0.97); }
.ax-card-img { width:100%; height:100%; object-fit:cover; display:block; transition:transform .3s; }
.ax-card:hover .ax-card-img { transform:scale(1.06); }
.ax-card-overlay { position:absolute; inset:0; background:linear-gradient(to top,rgba(0,0,0,0.92) 40%,transparent 100%); }
.ax-card-info { position:absolute; bottom:0; left:0; right:0; padding:8px; }
.ax-card-title {
  font-size:10px; font-weight:700; color:#fff; line-height:1.2;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-bottom:3px;
}
.ax-card-score { font-size:9px; color:#fbbf24; font-weight:700; }
.ax-card-eps { font-size:9px; color:rgba(255,255,255,0.4); margin-left:4px; }
.ax-result-list { display:flex; flex-direction:column; gap:8px; }
.ax-result-card {
  display:flex; gap:12px; align-items:flex-start;
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
  border-radius:12px; padding:10px; cursor:pointer; transition:all .2s; overflow:hidden; position:relative;
}
.ax-result-card::before {
  content:''; position:absolute; left:0; top:0; bottom:0; width:3px;
  background:linear-gradient(#a78bfa,#60a5fa); opacity:0; transition:opacity .2s;
}
.ax-result-card:hover { border-color:rgba(167,139,250,0.25); transform:translateX(4px); }
.ax-result-card:hover::before { opacity:1; }
.ax-result-card:active { transform:scale(0.98); }
.ax-result-thumb { width:56px; height:80px; border-radius:8px; object-fit:cover; flex-shrink:0; background:rgba(255,255,255,0.06); }
.ax-result-body { flex:1; min-width:0; }
.ax-result-title {
  font-size:13px; font-weight:700; color:#fff; line-height:1.3;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-bottom:4px;
}
.ax-result-tags { display:flex; gap:4px; flex-wrap:wrap; }
.ax-tag {
  font-size:9px; padding:2px 7px; border-radius:4px; font-weight:600;
  background:rgba(167,139,250,0.1); border:1px solid rgba(167,139,250,0.2); color:#a78bfa;
}
.ax-tag.score { background:rgba(251,191,36,0.1); border-color:rgba(251,191,36,0.2); color:#fbbf24; }
.ax-tag.ep { background:rgba(96,165,250,0.1); border-color:rgba(96,165,250,0.2); color:#60a5fa; }
.ax-detail-banner { width:100%; aspect-ratio:16/6; object-fit:cover; flex-shrink:0; background:rgba(255,255,255,0.04); }
.ax-detail-banner-placeholder {
  width:100%; aspect-ratio:16/6; flex-shrink:0;
  background:linear-gradient(135deg,rgba(167,139,250,0.15),rgba(96,165,250,0.1));
  display:flex; align-items:center; justify-content:center; font-size:40px;
}
.ax-detail-header { display:flex; gap:12px; padding:12px 14px 0; flex-shrink:0; align-items:flex-start; }
.ax-detail-thumb {
  width:72px; height:102px; border-radius:10px; object-fit:cover;
  flex-shrink:0; border:2px solid rgba(167,139,250,0.3);
  margin-top:-32px; position:relative; z-index:5; box-shadow:0 4px 20px rgba(0,0,0,0.6);
}
.ax-detail-title { font-size:15px; font-weight:900; color:#fff; line-height:1.2; margin-bottom:4px; }
.ax-detail-tags { display:flex; gap:4px; flex-wrap:wrap; }
.ax-detail-desc {
  font-size:12px; color:rgba(255,255,255,0.45); line-height:1.6; padding:10px 14px; flex-shrink:0;
}
.ax-ep-section { padding:0 14px; flex-shrink:0; }
.ax-ep-label {
  font-size:10px; font-weight:700; color:rgba(167,139,250,0.6);
  letter-spacing:1.5px; margin-bottom:8px; display:flex; align-items:center; gap:6px;
}
.ax-ep-list { display:flex; flex-direction:column; gap:6px; max-height:260px; overflow-y:auto; scrollbar-width:none; }
.ax-ep-list::-webkit-scrollbar { display:none; }
.ax-ep-item {
  display:flex; align-items:center; gap:10px;
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07);
  border-radius:10px; padding:9px 12px; cursor:pointer; transition:all .2s;
}
.ax-ep-item:hover { background:rgba(167,139,250,0.1); border-color:rgba(167,139,250,0.35); }
.ax-ep-item:active { transform:scale(0.98); }
.ax-ep-item.active { background:rgba(167,139,250,0.15); border-color:#a78bfa; }
.ax-ep-num {
  width:28px; height:28px; border-radius:7px; flex-shrink:0;
  background:rgba(167,139,250,0.12); border:1px solid rgba(167,139,250,0.2);
  display:flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:800; color:#a78bfa;
}
.ax-ep-title { font-size:12px; font-weight:600; color:#fff; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ax-ep-date { font-size:10px; color:rgba(255,255,255,0.3); flex-shrink:0; }
.ax-player-box { width:100%; aspect-ratio:16/9; background:#000; position:relative; flex-shrink:0; overflow:hidden; }
.ax-player-box iframe { width:100%; height:100%; border:none; display:block; }
.ax-player-loading {
  position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:12px;
  background:#000; color:rgba(255,255,255,0.4); font-size:13px;
}
.ax-player-controls {
  display:flex; gap:6px; padding:10px 14px; flex-shrink:0;
  border-bottom:1px solid rgba(255,255,255,0.06); flex-wrap:wrap; align-items:center;
}
.ax-ctrl {
  padding:6px 12px; border-radius:8px; font-size:11px; font-weight:700;
  cursor:pointer; border:1px solid; transition:all .2s; font-family:inherit;
}
.ax-ctrl.accent { background:rgba(167,139,250,0.12); border-color:rgba(167,139,250,0.3); color:#a78bfa; }
.ax-ctrl.accent:hover { background:rgba(167,139,250,0.22); }
.ax-ctrl.dim { background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.1); color:rgba(255,255,255,0.6); }
.ax-ctrl.dim:hover { background:rgba(255,255,255,0.1); color:#fff; }
.ax-ctrl.green { background:rgba(52,211,153,0.1); border-color:rgba(52,211,153,0.3); color:#34d399; }
.ax-ctrl.green:hover { background:rgba(52,211,153,0.2); }
.ax-now-playing {
  font-size:11px; color:rgba(255,255,255,0.35); padding:6px 14px; flex-shrink:0;
  display:flex; align-items:center; gap:6px;
}
.ax-now-dot {
  width:6px; height:6px; border-radius:50%; background:#a78bfa; flex-shrink:0;
  animation:ax-pulse 1.4s ease infinite;
}
@keyframes ax-pulse { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }
.ax-dl-section { padding:8px 14px; flex-shrink:0; }
.ax-dl-format-label {
  font-size:9px; font-weight:700; color:rgba(255,255,255,0.3);
  letter-spacing:1.5px; text-transform:uppercase; margin-bottom:6px; margin-top:8px;
}
.ax-dl-quality-row { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px; align-items:center; }
.ax-dl-q-label { font-size:10px; font-weight:700; color:rgba(96,165,250,0.8); min-width:36px; }
.ax-dl-btn {
  padding:5px 12px; border-radius:7px; font-size:11px; font-weight:700;
  cursor:pointer; border:1px solid; transition:all .2s; font-family:inherit;
  text-decoration:none; display:inline-block;
}
.ax-dl-btn.gofile { background:rgba(251,191,36,0.08); border-color:rgba(251,191,36,0.25); color:#fbbf24; }
.ax-dl-btn.gofile:hover { background:rgba(251,191,36,0.18); }
.ax-dl-btn.krakenfiles { background:rgba(52,211,153,0.08); border-color:rgba(52,211,153,0.25); color:#34d399; }
.ax-dl-btn.krakenfiles:hover { background:rgba(52,211,153,0.18); }
.ax-dl-btn.other { background:rgba(167,139,250,0.08); border-color:rgba(167,139,250,0.25); color:#a78bfa; }
.ax-dl-btn.other:hover { background:rgba(167,139,250,0.18); }
.ax-loading {
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:12px; padding:50px 20px; color:rgba(255,255,255,0.3); font-size:13px;
}
.ax-spinner {
  width:30px; height:30px; border:3px solid rgba(167,139,250,0.15);
  border-top-color:#a78bfa; border-radius:50%; animation:ax-spin .7s linear infinite;
}
@keyframes ax-spin { to { transform:rotate(360deg); } }
.ax-empty {
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:8px; padding:60px 20px; color:rgba(255,255,255,0.2); font-size:13px; text-align:center;
}
.ax-status { font-size:9px; padding:2px 7px; border-radius:4px; font-weight:700; }
.ax-status.airing   { background:rgba(52,211,153,0.12); border:1px solid rgba(52,211,153,0.25); color:#34d399; }
.ax-status.finished { background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.2); color:#94a3b8; }
.ax-status.upcoming { background:rgba(251,191,36,0.12); border:1px solid rgba(251,191,36,0.25); color:#fbbf24; }
.ax-open-btn {
  width:100%; padding:12px; border-radius:12px; border:none;
  background:linear-gradient(135deg,#a78bfa,#7c3aed); color:#fff;
  font-size:13px; font-weight:700; cursor:pointer; font-family:inherit;
  transition:all .2s; display:flex; align-items:center; justify-content:center; gap:8px;
}
.ax-open-btn:hover { transform:scale(1.02); box-shadow:0 0 20px rgba(167,139,250,0.4); }
.ax-open-btn:active { transform:scale(0.97); }
.ax-tip {
  margin:6px 14px; padding:9px 12px; border-radius:10px;
  background:rgba(96,165,250,0.08); border:1px solid rgba(96,165,250,0.18);
  font-size:11px; color:rgba(96,165,250,0.8); line-height:1.5; flex-shrink:0;
}
`

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
interface Props { isAdmin: boolean; userId: string }

export default function AnimeStreamPanel({ isAdmin, userId }: Props) {
  const [view, setView]               = useState<View>('home')
  const [query, setQuery]             = useState('')
  const [searching, setSearching]     = useState(false)
  const [results, setResults]         = useState<SamAnime[]>([])
  const [homeList, setHomeList]       = useState<SamAnime[]>([])
  const [homeLoading, setHomeLoading] = useState(true)

  const [selectedAnime, setSelectedAnime]   = useState<SamAnime | null>(null)
  const [detail, setDetail]                 = useState<SamDetail | null>(null)
  const [detailLoading, setDetailLoading]   = useState(false)

  const [selectedEp, setSelectedEp]         = useState<SamEpisode | null>(null)
  const [embedUrl, setEmbedUrl]             = useState<string | null>(null)
  const [streamData, setStreamData]         = useState<StreamResult | null>(null)
  const [playerLoading, setPlayerLoading]   = useState(false)
  const [showDownload, setShowDownload]     = useState(false)

  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    apiHome().then(setHomeList).finally(() => setHomeLoading(false))
  }, [])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true); setView('results')
    try { setResults(await apiSearch(query.trim())) }
    catch { setResults([]) }
    finally { setSearching(false) }
  }, [query])

  const handleSelectAnime = async (anime: SamAnime) => {
    setSelectedAnime(anime); setDetail(null); setSelectedEp(null)
    setEmbedUrl(null); setStreamData(null); setShowDownload(false)
    setDetailLoading(true); setView('detail')
    const det = await apiDetail(anime.url)
    setDetail(det); setDetailLoading(false)
  }

  const handleWatch = async (ep: SamEpisode) => {
    setSelectedEp(ep); setEmbedUrl(null); setStreamData(null)
    setShowDownload(false); setPlayerLoading(true); setView('player')

    // Jika episode punya data post/nume/type (dari detail endpoint), pakai langsung
    if (ep.post && ep.nume && ep.type) {
      const embed = await apiEmbed(ep.post, ep.nume, ep.type, ep.url)
      if (embed) { setEmbedUrl(embed); setPlayerLoading(false); return }
    }

    // Fallback: coba semua kombinasi server dengan post ID saja
    if (ep.post) {
      const embed = await apiEmbedAny(ep.post, ep.url)
      if (embed) { setEmbedUrl(embed); setPlayerLoading(false); return }
    }

    // Terakhir: ambil stream/download links
    const stream = await apiStream(ep.url)
    setStreamData(stream); setShowDownload(true); setPlayerLoading(false)
  }

  const handleFullscreen = () => {
    const el = iframeRef.current; if (!el) return
    try {
      if (el.requestFullscreen) el.requestFullscreen()
      else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen()
    } catch {}
  }

  const epList = detail?.episodeList || []
  const currentEpIdx = selectedEp ? epList.findIndex(e => e.url === selectedEp.url) : -1

  const statusClass = (s?: string) => {
    if (!s) return 'upcoming'
    const l = s.toLowerCase()
    if (l.includes('ongoing') || l.includes('airing')) return 'airing'
    if (l.includes('completed') || l.includes('finished')) return 'finished'
    return 'upcoming'
  }
  const statusLabel = (s?: string) => {
    if (!s) return 'Unknown'
    const l = s.toLowerCase()
    if (l.includes('ongoing') || l.includes('airing')) return '● Ongoing'
    if (l.includes('completed') || l.includes('finished')) return 'Selesai'
    return s
  }
  const dlBtnClass = (p: string) => {
    const pl = p.toLowerCase()
    if (pl.includes('gofile')) return 'ax-dl-btn gofile'
    if (pl.includes('krakenfiles')) return 'ax-dl-btn krakenfiles'
    return 'ax-dl-btn other'
  }

  return (
    <>
      <style>{S}</style>
      <div className="ax-wrap">

        {/* HOME */}
        {view === 'home' && (
          <>
            <div className="ax-header"><span className="ax-logo">✦ SAMEHADAKU</span></div>
            <div className="ax-search-bar">
              <input className="ax-search-input" placeholder="Cari anime sub indo..."
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()} />
              <button className="ax-search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
                {searching ? '...' : '🔍'}
              </button>
            </div>
            <div className="ax-scroll">
              <div className="ax-section-label">🔥 TERBARU</div>
              {homeLoading ? (
                <div className="ax-loading" style={{ padding: '30px 0' }}>
                  <div className="ax-spinner" /><div>Memuat anime...</div>
                </div>
              ) : homeList.length === 0 ? (
                <div className="ax-empty">
                  <div style={{ fontSize: 36 }}>🎌</div>
                  <div>Gagal memuat daftar anime</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)' }}>Coba cari manual di atas</div>
                </div>
              ) : (
                <div className="ax-grid">
                  {homeList.map((a, i) => (
                    <div key={i} className="ax-card" onClick={() => handleSelectAnime(a)}>
                      {a.thumbnail
                        ? <img src={a.thumbnail} alt="" className="ax-card-img" loading="lazy" />
                        : <div style={{ width:'100%',height:'100%',background:'rgba(167,139,250,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28 }}>🎌</div>
                      }
                      <div className="ax-card-overlay" />
                      <div className="ax-card-info">
                        <div className="ax-card-title">{a.title}</div>
                        {a.score && <span className="ax-card-score">★{a.score}</span>}
                        {a.type  && <span className="ax-card-eps"> {a.type}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* RESULTS */}
        {view === 'results' && (
          <>
            <div className="ax-header">
              <button className="ax-back" onClick={() => setView('home')}>‹</button>
              <span className="ax-logo">HASIL PENCARIAN</span>
            </div>
            <div className="ax-search-bar">
              <input className="ax-search-input" placeholder="Cari lagi..."
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()} />
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
                  {results.map((a, i) => (
                    <div key={i} className="ax-result-card" onClick={() => handleSelectAnime(a)}>
                      {a.thumbnail
                        ? <img src={a.thumbnail} alt="" className="ax-result-thumb" loading="lazy" />
                        : <div className="ax-result-thumb" style={{ display:'flex',alignItems:'center',justifyContent:'center',fontSize:24 }}>🎌</div>
                      }
                      <div className="ax-result-body">
                        <div className="ax-result-title">{a.title}</div>
                        <div className="ax-result-tags">
                          {a.score  && <span className="ax-tag score">★ {a.score}</span>}
                          {a.type   && <span className="ax-tag ep">{a.type}</span>}
                          {a.status && <span className={`ax-status ${statusClass(a.status)}`}>{statusLabel(a.status)}</span>}
                          {(a.genres || []).slice(0,2).map(g => <span key={g} className="ax-tag">{g}</span>)}
                        </div>
                        {a.views && <div style={{ fontSize:10,color:'rgba(255,255,255,0.25)',marginTop:4 }}>👁 {a.views}</div>}
                      </div>
                      <span style={{ color:'rgba(255,255,255,0.2)',fontSize:16,alignSelf:'center' }}>›</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* DETAIL */}
        {view === 'detail' && selectedAnime && (
          <>
            <div className="ax-header">
              <button className="ax-back" onClick={() => setView(results.length > 0 ? 'results' : 'home')}>‹</button>
              <span className="ax-logo" style={{ fontSize:11,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                {selectedAnime.title}
              </span>
            </div>
            <div style={{ flex:1,overflow:'hidden',display:'flex',flexDirection:'column' }}>
              <div style={{ flex:1,overflowY:'auto',scrollbarWidth:'none' }}>
                {(detail?.thumbnail || selectedAnime.thumbnail)
                  ? <img src={detail?.thumbnail || selectedAnime.thumbnail} alt="" className="ax-detail-banner" />
                  : <div className="ax-detail-banner-placeholder">🎌</div>
                }
                <div className="ax-detail-header">
                  <img src={detail?.thumbnail || selectedAnime.thumbnail} alt="" className="ax-detail-thumb" />
                  <div style={{ flex:1,paddingTop:8 }}>
                    <div className="ax-detail-title">{detail?.title || selectedAnime.title}</div>
                    <div className="ax-detail-tags">
                      {(detail?.rating || selectedAnime.score) && <span className="ax-tag score">★ {detail?.rating || selectedAnime.score}</span>}
                      {detail?.details?.status && <span className={`ax-status ${statusClass(detail.details.status)}`}>{statusLabel(detail.details.status)}</span>}
                      {detail?.details?.type     && <span className="ax-tag ep">{detail.details.type}</span>}
                      {detail?.details?.episodes && <span className="ax-tag">{detail.details.episodes} ep</span>}
                    </div>
                  </div>
                </div>
                {(detail?.synopsis || selectedAnime.synopsis) && (
                  <p className="ax-detail-desc">
                    {(detail?.synopsis || selectedAnime.synopsis || '').replace(/\\n/g,' ').slice(0,220)}...
                  </p>
                )}
                {(detail?.genres || selectedAnime.genres || []).length > 0 && (
                  <div style={{ padding:'0 14px 8px',display:'flex',gap:5,flexWrap:'wrap' }}>
                    {(detail?.genres || selectedAnime.genres || []).map(g => <span key={g} className="ax-tag">{g}</span>)}
                  </div>
                )}
                <div className="ax-ep-section">
                  <div className="ax-ep-label" style={{ marginTop:8 }}>
                    🎬 DAFTAR EPISODE {detailLoading ? '...' : epList.length > 0 ? `(${epList.length})` : ''}
                  </div>
                  {detailLoading ? (
                    <div className="ax-loading" style={{ padding:'20px 0' }}>
                      <div className="ax-spinner" /><div>Memuat episode...</div>
                    </div>
                  ) : epList.length === 0 ? (
                    <div style={{ padding:'10px 0',fontSize:12,color:'rgba(255,255,255,0.3)',textAlign:'center' }}>
                      Daftar episode tidak tersedia
                    </div>
                  ) : (
                    <div className="ax-ep-list">
                      {epList.map((ep, i) => (
                        <div key={i} className={`ax-ep-item${selectedEp?.url === ep.url ? ' active' : ''}`} onClick={() => handleWatch(ep)}>
                          <div className="ax-ep-num">{i + 1}</div>
                          <div className="ax-ep-title">{ep.title || `Episode ${i + 1}`}</div>
                          {ep.date && <div className="ax-ep-date">{ep.date}</div>}
                          <span style={{ color:'rgba(255,255,255,0.2)',fontSize:13 }}>▶</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {epList.length > 0 && (
                  <div style={{ padding:'14px 14px 30px' }}>
                    <button className="ax-open-btn" onClick={() => handleWatch(epList[0])}>
                      ▶ Tonton Episode 1
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* PLAYER */}
        {view === 'player' && selectedAnime && selectedEp && (
          <>
            <div className="ax-header">
              <button className="ax-back" onClick={() => setView('detail')}>‹ Detail</button>
              <span style={{ fontSize:11,color:'rgba(255,255,255,0.5)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1 }}>
                {selectedAnime.title} · {selectedEp.title}
              </span>
            </div>
            <div className="ax-player-box">
              {playerLoading ? (
                <div className="ax-player-loading">
                  <div className="ax-spinner" /><div>Memuat player...</div>
                </div>
              ) : embedUrl ? (
                <iframe
                  ref={iframeRef} src={embedUrl} allowFullScreen
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
                  key={embedUrl}
                  style={{ border:'none',width:'100%',height:'100%',display:'block',background:'#000' }}
                />
              ) : (
                <div className="ax-player-loading">
                  <div style={{ fontSize:32 }}>📥</div>
                  <div style={{ textAlign:'center',padding:'0 20px',fontSize:12 }}>
                    {showDownload ? 'Embed tidak tersedia — pakai link download di bawah' : 'Gagal memuat player'}
                  </div>
                </div>
              )}
            </div>
            <div className="ax-now-playing">
              <div className="ax-now-dot" />
              <span>Samehadaku · {selectedEp.title}</span>
            </div>
            <div className="ax-player-controls">
              {embedUrl && <button className="ax-ctrl accent" onClick={handleFullscreen}>⛶ Fullscreen</button>}
              {currentEpIdx > 0 && (
                <button className="ax-ctrl dim" onClick={() => handleWatch(epList[currentEpIdx - 1])}>
                  ‹ Ep {currentEpIdx}
                </button>
              )}
              {currentEpIdx >= 0 && currentEpIdx < epList.length - 1 && (
                <button className="ax-ctrl dim" onClick={() => handleWatch(epList[currentEpIdx + 1])}>
                  Ep {currentEpIdx + 2} ›
                </button>
              )}
              <button className="ax-ctrl green" onClick={() => window.open(selectedEp.url,'_blank','noopener,noreferrer')}>
                🌐 Buka Browser
              </button>
            </div>
            {showDownload && streamData?.downloadLinks && streamData.downloadLinks.length > 0 && (
              <div style={{ flex:1,overflowY:'auto',scrollbarWidth:'none' }}>
                <div className="ax-dl-section">
                  <div className="ax-section-label" style={{ marginBottom:10 }}>📥 LINK DOWNLOAD</div>
                  {streamData.downloadLinks.map((fmt, fi) => (
                    <div key={fi}>
                      <div className="ax-dl-format-label">{fmt.format}</div>
                      {fmt.list?.map((q, qi) => (
                        <div key={qi} className="ax-dl-quality-row">
                          <span className="ax-dl-q-label">{q.quality}</span>
                          {q.servers?.map((srv, si) => (
                            <a key={si} href={srv.url} target="_blank" rel="noopener noreferrer" className={dlBtnClass(srv.provider)}>
                              {srv.provider}
                            </a>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!showDownload && (
              <div className="ax-tip">
                💡 Video dari <b>Samehadaku</b> — subtitle Indonesia. Kalau player tidak muncul, coba <b>Buka Browser</b>.
              </div>
            )}
          </>
        )}

      </div>
    </>
  )
}
