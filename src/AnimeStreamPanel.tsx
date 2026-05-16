import React, { useState, useCallback, useEffect } from 'react'

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
  slug?: string // untuk embed URL
}

type View = 'home' | 'results' | 'detail' | 'player'

// ═══════════════════════════════════════════════════════════════
// EMBED URL BUILDER
// Pakai hianime.to embed — paling stabil, support banyak anime
// ═══════════════════════════════════════════════════════════════
function buildEmbedUrl(anime: AnimeInfo, episode: number): string {
  // Coba cari di hianime via slug dari title romaji
  const slug = anime.titleRomaji
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

  // Format: https://hianime.to/watch/{slug}-{malId}?ep={episode}
  // Fallback: pakai 9anime embed
  return `https://hianime.to/watch/${slug}-${anime.id}?ep=${episode}`
}

// ═══════════════════════════════════════════════════════════════
// JIKAN API — data anime (info, thumbnail, dll)
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

/* PLAYER - iframe embed */
.ax-player-box {
  width: 100%; aspect-ratio: 16/9; background: #000;
  position: relative; flex-shrink: 0; overflow: hidden;
}
.ax-player-box iframe {
  width: 100%; height: 100%; border: none; display: block;
}
.ax-player-loading {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  background: #0d0d0d; z-index: 2;
}
.ax-player-controls { display: flex; gap: 6px; padding: 10px 14px; flex-shrink: 0; border-bottom: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; align-items: center; }
.ax-ctrl { padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid; transition: all .2s; font-family: inherit; }
.ax-ctrl.accent { background: rgba(167,139,250,0.12); border-color: rgba(167,139,250,0.3); color: #a78bfa; }
.ax-ctrl.dim { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); }
.ax-ctrl:disabled { opacity: .35; cursor: not-allowed; }
.ax-now-playing { font-size: 11px; color: rgba(255,255,255,0.35); padding: 6px 14px; flex-shrink: 0; display: flex; align-items: center; gap: 6px; }
.ax-now-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: #a78bfa; animation: ax-pulse 1.4s ease infinite; }
@keyframes ax-pulse { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }
.ax-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 50px 20px; color: rgba(255,255,255,0.3); font-size: 13px; }
.ax-spinner { width: 30px; height: 30px; border: 3px solid rgba(167,139,250,0.15); border-top-color: #a78bfa; border-radius: 50%; animation: ax-spin .7s linear infinite; }
@keyframes ax-spin { to { transform: rotate(360deg); } }
.ax-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 60px 20px; color: rgba(255,255,255,0.2); font-size: 13px; text-align: center; }
.ax-status { font-size: 9px; padding: 2px 7px; border-radius: 4px; font-weight: 700; }
.ax-status.airing { background: rgba(52,211,153,0.12); border: 1px solid rgba(52,211,153,0.25); color: #34d399; }
.ax-status.finished { background: rgba(148,163,184,0.12); border: 1px solid rgba(148,163,184,0.2); color: #94a3b8; }
.ax-status.upcoming { background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.25); color: #fbbf24; }
.ax-info-box { margin: 8px 14px; padding: 9px 12px; border-radius: 10px; background: rgba(96,165,250,0.08); border: 1px solid rgba(96,165,250,0.18); font-size: 11px; color: rgba(96,165,250,0.8); line-height: 1.5; flex-shrink: 0; }
.ax-warn-box { margin: 8px 14px; padding: 9px 12px; border-radius: 10px; background: rgba(251,191,36,0.07); border: 1px solid rgba(251,191,36,0.2); font-size: 11px; color: rgba(251,191,36,0.8); line-height: 1.5; flex-shrink: 0; }
.ax-provider-row { display: flex; gap: 6px; padding: 8px 14px 0; flex-shrink: 0; flex-wrap: wrap; }
.ax-provider-btn { padding: 5px 12px; border-radius: 8px; font-size: 10px; font-weight: 700; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.5); font-family: inherit; transition: all .2s; }
.ax-provider-btn.active { background: rgba(167,139,250,0.15); border-color: #a78bfa; color: #a78bfa; }
`

// ═══════════════════════════════════════════════════════════════
// EMBED PROVIDERS
// ═══════════════════════════════════════════════════════════════
type Provider = 'hianime' | 'yugenanime' | 'allanime'

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'hianime', label: '🎌 Hianime' },
  { id: 'yugenanime', label: '🌸 YugenAnime' },
  { id: 'allanime', label: '⚡ AllAnime' },
]

function getEmbedUrl(anime: AnimeInfo, episode: number, provider: Provider): string {
  const slug = anime.titleRomaji
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

  switch (provider) {
    case 'hianime':
      return `https://hianime.to/watch/${slug}-${anime.id}?ep=${episode}`
    case 'yugenanime':
      return `https://yugenanime.tv/anime/${anime.id}/${slug}/watch/?ep=${episode}`
    case 'allanime':
      return `https://allanime.to/anime/${anime.id}/episode-${episode}`
    default:
      return `https://hianime.to/watch/${slug}-${anime.id}?ep=${episode}`
  }
}

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
  const [iframeLoading, setIframeLoading] = useState(true)
  const [provider, setProvider] = useState<Provider>('hianime')

  const epCount = selectedAnime?.episodes || 24

  // ── Load trending ──────────────────────────────────────────
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
    setView('detail')
  }

  const handleWatch = (ep: number) => {
    setSelectedEp(ep)
    setIframeLoading(true)
    setView('player')
  }

  const statusClass = (s: string) => s === 'RELEASING' ? 'airing' : s === 'FINISHED' ? 'finished' : 'upcoming'
  const statusLabel = (s: string) => s === 'RELEASING' ? '● Ongoing' : s === 'FINISHED' ? 'Selesai' : s === 'NOT_YET_RELEASED' ? 'Upcoming' : s

  const embedUrl = selectedAnime ? getEmbedUrl(selectedAnime, selectedEp, provider) : ''

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
                <div className="ax-ep-label">📺 PILIH EPISODE</div>
                <div className="ax-ep-grid">
                  {Array.from({ length: epCount }, (_, i) => i + 1).map(n => (
                    <button key={n} className={`ax-ep-btn ${selectedEp === n ? 'active' : ''}`}
                      onClick={() => handleWatch(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ax-info-box" style={{ marginTop: 12 }}>
                🌐 Stream via <strong>embed player</strong> — pilih provider jika satu tidak jalan.
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

            {/* Provider selector */}
            <div className="ax-provider-row">
              {PROVIDERS.map(p => (
                <button key={p.id}
                  className={`ax-provider-btn ${provider === p.id ? 'active' : ''}`}
                  onClick={() => { setProvider(p.id); setIframeLoading(true) }}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Iframe Player */}
            <div className="ax-player-box">
              {iframeLoading && (
                <div className="ax-player-loading">
                  <div className="ax-spinner" style={{ width: 36, height: 36, borderWidth: 4 }} />
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Memuat player...</span>
                </div>
              )}
              <iframe
                key={`${provider}-${selectedAnime.id}-${selectedEp}`}
                src={embedUrl}
                allowFullScreen
                allow="autoplay; fullscreen; picture-in-picture"
                onLoad={() => setIframeLoading(false)}
                style={{ opacity: iframeLoading ? 0 : 1, transition: 'opacity .3s' }}
              />
            </div>

            {/* Controls */}
            <div className="ax-player-controls">
              <button className="ax-ctrl dim" disabled={selectedEp <= 1}
                onClick={() => { setSelectedEp(e => e - 1); setIframeLoading(true) }}>
                ‹ Ep {selectedEp - 1 > 0 ? selectedEp - 1 : '-'}
              </button>
              <button className="ax-ctrl dim" disabled={selectedEp >= epCount}
                onClick={() => { setSelectedEp(e => e + 1); setIframeLoading(true) }}>
                Ep {selectedEp < epCount ? selectedEp + 1 : '-'} ›
              </button>
            </div>

            <div className="ax-now-playing">
              <div className="ax-now-dot" />
              <span>{selectedAnime.title} · Episode {selectedEp}</span>
              <span style={{ marginLeft: 'auto', color: 'rgba(167,139,250,0.6)', fontSize: 10 }}>{PROVIDERS.find(p => p.id === provider)?.label}</span>
            </div>

            <div className="ax-warn-box">
              ⚠️ Kalau player tidak muncul, coba ganti provider di atas. Setiap provider bisa berbeda ketersediaan episodenya.
            </div>
          </>
        )}
      </div>
    </>
  )
}
