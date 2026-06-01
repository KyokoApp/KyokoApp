import React, { useEffect, useRef, useState, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────
interface Track {
  id: string
  name: string
  src: string
  duration: number
}

interface LocalMusicPlayerProps {
  onClose: () => void
}

// ── Constants ──────────────────────────────────────────────────────────────
const MIN_DURATION_SEC = 120
const AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.ogg', '.flac', '.wav', '.opus', '.wma', '.3gp']

// Folder standar audio Android yang di-scan
const SCAN_DIRS = [
  'Music',
  'Download',
  'Downloads',
  'DCIM/Audio',
  'Podcasts',
  'Audiobooks',
]

// ── Helpers ────────────────────────────────────────────────────────────────
function trimExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '')
}

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase()
  return AUDIO_EXTS.some(ext => lower.endsWith(ext))
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function isNativePlatform(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.()
}

function getCapacitorPlugin(name: string): any {
  return (window as any).Capacitor?.Plugins?.[name]
}

// Baca durasi audio dari URL via HTMLAudioElement
function getAudioDurationFromUrl(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio(url)
    const timeout = setTimeout(() => resolve(0), 8000)
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timeout)
      resolve(audio.duration)
    })
    audio.addEventListener('error', () => {
      clearTimeout(timeout)
      resolve(0)
    })
    audio.preload = 'metadata'
  })
}

function getAudioDurationFromFile(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    audio.addEventListener('loadedmetadata', () => { URL.revokeObjectURL(url); resolve(audio.duration) })
    audio.addEventListener('error', () => { URL.revokeObjectURL(url); resolve(0) })
  })
}

// ── Native Scanner via @capacitor/filesystem ───────────────────────────────
async function scanNativeAudio(
  onProgress: (msg: string) => void
): Promise<Track[]> {
  const Filesystem = getCapacitorPlugin('Filesystem')
  if (!Filesystem) throw new Error('Plugin Filesystem tidak ditemukan')

  // Minta permission storage
  try {
    const perm = await Filesystem.requestPermissions()
    if (perm?.publicStorage === 'denied') {
      throw new Error('Izin storage ditolak. Buka Pengaturan → Izin Aplikasi → Storage → Izinkan.')
    }
  } catch (e: any) {
    if (e?.message?.includes('ditolak')) throw e
    // Beberapa device tidak perlu requestPermissions, lanjut
  }

  const tracks: Track[] = []
  let scanned = 0

  for (const dir of SCAN_DIRS) {
    onProgress(`Scan folder: ${dir}...`)
    try {
      const result = await Filesystem.readdir({
        path: dir,
        directory: 'EXTERNAL_STORAGE', // ExternalStorageDirectory
      })

      const files: string[] = result?.files ?? []
      const audioFiles = files.filter(f => {
        const fname = typeof f === 'string' ? f : (f as any).name ?? ''
        return isAudioFile(fname)
      })

      for (const f of audioFiles) {
        const fname = typeof f === 'string' ? f : (f as any).name ?? ''
        scanned++
        onProgress(`Mengecek ${scanned}: ${trimExt(fname)}`)

        // Baca file sebagai URI bisa diputar
        let fileUri = ''
        try {
          const uriResult = await Filesystem.getUri({
            path: `${dir}/${fname}`,
            directory: 'EXTERNAL_STORAGE',
          })
          fileUri = uriResult?.uri ?? ''
        } catch {
          continue
        }

        if (!fileUri) continue

        // Cek durasi via Audio element
        const durSec = await getAudioDurationFromUrl(fileUri)
        if (durSec < MIN_DURATION_SEC) continue

        tracks.push({
          id: `${dir}/${fname}`,
          name: trimExt(fname),
          src: fileUri,
          duration: durSec,
        })
      }
    } catch {
      // Folder tidak ada atau tidak bisa dibaca, skip
    }
  }

  tracks.sort((a, b) => a.name.localeCompare(b.name))
  return tracks
}

// ── Component ──────────────────────────────────────────────────────────────
export default function LocalMusicPlayer({ onClose }: LocalMusicPlayerProps) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [currentIdx, setCurrentIdx] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [shuffle, setShuffle] = useState(false)
  const [loop, setLoop] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [scanError, setScanError] = useState('')
  const [visible, setVisible] = useState(false)
  const [isNative] = useState(() => isNativePlatform())

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlsRef = useRef<string[]>([])

  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])

  useEffect(() => {
    if (isNative) handleNativeScan()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative])

  useEffect(() => {
    return () => { objectUrlsRef.current.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  // ── Audio element ──────────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio()
    audio.volume = volume
    audioRef.current = audio

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0)
    }
    const onLoadedMetadata = () => setDuration(audio.duration)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.pause(); audio.src = ''
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (audioRef.current) audioRef.current.loop = loop }, [loop])
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume }, [volume])

  // ── Auto-next on ended ─────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => {
      if (loop) return
      setCurrentIdx(prev => {
        if (prev === null || tracks.length === 0) return prev
        const next = shuffle
          ? Math.floor(Math.random() * tracks.length)
          : (prev + 1) % tracks.length
        const track = tracks[next]
        if (!track) return prev
        audio.src = track.src
        audio.load()
        audio.play().catch(() => {})
        return next
      })
    }
    audio.addEventListener('ended', onEnded)
    return () => audio.removeEventListener('ended', onEnded)
  }, [tracks, shuffle, loop])

  // ── Load track ─────────────────────────────────────────────────────────
  const loadTrack = useCallback((idx: number, autoplay = true) => {
    const audio = audioRef.current
    if (!audio || !tracks[idx]) return
    audio.pause()
    audio.src = tracks[idx].src
    audio.load()
    setCurrentIdx(idx)
    setProgress(0); setCurrentTime(0)
    setDuration(tracks[idx].duration)
    if (autoplay) audio.play().catch(() => {})
  }, [tracks])

  // ── Controls ───────────────────────────────────────────────────────────
  const handlePlayPause = () => {
    const audio = audioRef.current
    if (!audio) return
    if (currentIdx === null && tracks.length > 0) { loadTrack(0); return }
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  const handleNext = useCallback(() => {
    if (tracks.length === 0) return
    const next = currentIdx === null ? 0
      : shuffle ? Math.floor(Math.random() * tracks.length)
      : (currentIdx + 1) % tracks.length
    loadTrack(next)
  }, [tracks, shuffle, currentIdx, loadTrack])

  const handlePrev = () => {
    if (tracks.length === 0) return
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return }
    const prev = currentIdx === null ? 0 : (currentIdx - 1 + tracks.length) % tracks.length
    loadTrack(prev)
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    const val = parseFloat(e.target.value)
    audio.currentTime = val * audio.duration
    setProgress(val)
  }

  // ── Native scan ────────────────────────────────────────────────────────
  const handleNativeScan = async () => {
    setScanning(true)
    setScanError('')
    setScanMsg('Memindai lagu dari perangkat...')
    audioRef.current?.pause()
    setCurrentIdx(null); setProgress(0); setCurrentTime(0); setDuration(0)
    setTracks([])

    try {
      const found = await scanNativeAudio((msg) => setScanMsg(msg))
      setTracks(found)
      setScanMsg(found.length === 0
        ? 'Tidak ada lagu ≥2 menit ditemukan'
        : `${found.length} lagu ditemukan`)
    } catch (err: any) {
      setScanError(err?.message ?? 'Gagal scan lagu')
      setScanMsg('')
    } finally {
      setScanning(false)
    }
  }

  // ── Web file picker fallback ───────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setScanning(true); setScanError('')
    setScanMsg(`Scanning ${files.length} file...`)
    objectUrlsRef.current.forEach(u => URL.revokeObjectURL(u))
    objectUrlsRef.current = []

    const newTracks: Track[] = []
    let skipped = 0

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setScanMsg(`Mengecek ${i + 1}/${files.length}: ${trimExt(file.name)}`)
      const dur = await getAudioDurationFromFile(file)
      if (dur < MIN_DURATION_SEC) { skipped++; continue }
      const url = URL.createObjectURL(file)
      objectUrlsRef.current.push(url)
      newTracks.push({ id: `${file.name}-${file.size}`, name: trimExt(file.name), src: url, duration: dur })
    }

    audioRef.current?.pause()
    setCurrentIdx(null); setProgress(0); setCurrentTime(0); setDuration(0)
    setTracks(newTracks)
    setScanMsg(newTracks.length === 0
      ? `Tidak ada lagu ≥2 menit (${skipped} dilewati)`
      : `${newTracks.length} lagu ditemukan${skipped ? `, ${skipped} dilewati` : ''}`)
    setScanning(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    setVisible(false)
    setTimeout(() => { audioRef.current?.pause(); onClose() }, 300)
  }

  const currentTrack = currentIdx !== null ? tracks[currentIdx] : null

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      className="lmp-overlay"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.3s' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        className="lmp-panel"
        style={{ transform: visible ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 0.35s cubic-bezier(0.32,0.72,0,1)' }}
      >
        {/* Header */}
        <div className="lmp-header">
          <div className="lmp-header-left">
            <span className="lmp-icon-note">♪</span>
            <span className="lmp-title">Local Music</span>
            {isNative && <span className="lmp-badge">Android</span>}
          </div>
          <button className="lmp-close" onClick={handleClose}>✕</button>
        </div>

        {/* Now Playing */}
        <div className="lmp-now-playing">
          <div className="lmp-vinyl" style={{ animationPlayState: playing ? 'running' : 'paused' }}>
            <div className="lmp-vinyl-inner" /><div className="lmp-vinyl-dot" />
          </div>
          <div className="lmp-track-info">
            <div className="lmp-track-name" title={currentTrack?.name || ''}>
              {currentTrack ? currentTrack.name : 'Pilih lagu dari playlist'}
            </div>
            <div className="lmp-track-dur">{currentTrack ? `${fmtTime(currentTime)} / ${fmtTime(duration)}` : '—'}</div>
          </div>
        </div>

        {/* Progress */}
        <div className="lmp-progress-wrap">
          <input className="lmp-progress" type="range" min={0} max={1} step={0.001}
            value={progress} onChange={handleSeek} disabled={currentIdx === null} />
        </div>

        {/* Controls */}
        <div className="lmp-controls">
          <button className={`lmp-ctrl-btn lmp-ctrl-sm ${shuffle ? 'lmp-ctrl-active' : ''}`} onClick={() => setShuffle(p => !p)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
              <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
            </svg>
          </button>
          <button className="lmp-ctrl-btn" onClick={handlePrev}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button className="lmp-ctrl-btn lmp-ctrl-play" onClick={handlePlayPause}>
            {playing
              ? <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              : <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>}
          </button>
          <button className="lmp-ctrl-btn" onClick={handleNext}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg>
          </button>
          <button className={`lmp-ctrl-btn lmp-ctrl-sm ${loop ? 'lmp-ctrl-active' : ''}`} onClick={() => setLoop(p => !p)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
          </button>
        </div>

        {/* Volume */}
        <div className="lmp-volume-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
          </svg>
          <input className="lmp-volume" type="range" min={0} max={1} step={0.01} value={volume} onChange={e => setVolume(parseFloat(e.target.value))} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        </div>

        {/* Scan area */}
        <div className="lmp-scan-area">
          {isNative ? (
            <button className="lmp-scan-btn" onClick={handleNativeScan} disabled={scanning}>
              {scanning
                ? <><span className="lmp-spin">⟳</span>&nbsp;{scanMsg || 'Memindai...'}</>
                : <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:4}}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Refresh Daftar Lagu</>}
            </button>
          ) : (
            <>
              <input ref={fileInputRef} type="file" accept="audio/*" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
              <button className="lmp-scan-btn" onClick={() => fileInputRef.current?.click()} disabled={scanning}>
                {scanning
                  ? <><span className="lmp-spin">⟳</span>&nbsp;Scanning...</>
                  : <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>&nbsp;Pilih File Audio</>}
              </button>
              <div className="lmp-web-note">💡 Di browser pilih file manual. Di Android lagu terdeteksi otomatis.</div>
            </>
          )}
          {!scanning && scanMsg && <div className="lmp-scan-msg">{scanMsg}</div>}
          {scanError && (
            <div className="lmp-scan-error">
              ⚠️ {scanError}
            </div>
          )}
        </div>

        {/* Playlist */}
        {tracks.length > 0 && (
          <div className="lmp-playlist">
            <div className="lmp-playlist-header">
              Playlist <span className="lmp-playlist-count">{tracks.length} lagu</span>
            </div>
            <div className="lmp-playlist-list">
              {tracks.map((t, i) => (
                <div key={t.id} className={`lmp-playlist-item ${i === currentIdx ? 'lmp-playlist-active' : ''}`} onClick={() => loadTrack(i)}>
                  <div className="lmp-playlist-num">
                    {i === currentIdx && playing ? <span className="lmp-bars"><b/><b/><b/></span> : <span>{i + 1}</span>}
                  </div>
                  <div className="lmp-playlist-name">{t.name}</div>
                  <div className="lmp-playlist-dur">{fmtTime(t.duration)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tracks.length === 0 && !scanning && (
          <div className="lmp-empty">
            <div className="lmp-empty-icon">🎵</div>
            <div className="lmp-empty-text">
              {scanError
                ? 'Gagal memuat lagu'
                : isNative
                  ? 'Sedang memindai...'
                  : <><br/><small>Klik "Pilih File Audio" untuk mulai</small></>}
            </div>
          </div>
        )}
      </div>

      <style>{`
        .lmp-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.72);backdrop-filter:blur(4px);display:flex;align-items:flex-end;}
        .lmp-panel{width:100%;max-width:480px;margin:0 auto;background:linear-gradient(160deg,#0f0f1a 0%,#111827 100%);border-radius:20px 20px 0 0;border-top:1px solid rgba(139,92,246,0.3);padding-bottom:env(safe-area-inset-bottom,16px);max-height:90dvh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -8px 40px rgba(139,92,246,0.15);}
        .lmp-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;}
        .lmp-header-left{display:flex;align-items:center;gap:8px;}
        .lmp-icon-note{font-size:18px;color:#a78bfa;}
        .lmp-title{font-size:16px;font-weight:700;color:#e2e8f0;letter-spacing:0.3px;}
        .lmp-badge{font-size:9px;font-weight:700;background:rgba(124,58,237,0.25);color:#a78bfa;border:1px solid rgba(124,58,237,0.4);border-radius:99px;padding:2px 7px;letter-spacing:0.5px;}
        .lmp-close{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.08);border:none;cursor:pointer;color:#94a3b8;font-size:14px;display:flex;align-items:center;justify-content:center;transition:background 0.2s;}
        .lmp-close:hover{background:rgba(255,255,255,0.15);color:#e2e8f0;}
        .lmp-now-playing{display:flex;align-items:center;gap:14px;padding:16px 20px 8px;flex-shrink:0;}
        .lmp-vinyl{width:52px;height:52px;border-radius:50%;background:conic-gradient(#1e1b4b,#312e81,#4c1d95,#6d28d9,#7c3aed,#1e1b4b);position:relative;flex-shrink:0;animation:lmp-spin 3s linear infinite;box-shadow:0 0 16px rgba(139,92,246,0.4);}
        .lmp-vinyl-inner{position:absolute;inset:10px;border-radius:50%;background:#0f0f1a;border:1px solid rgba(139,92,246,0.2);}
        .lmp-vinyl-dot{position:absolute;inset:0;margin:auto;width:8px;height:8px;border-radius:50%;background:#7c3aed;}
        @keyframes lmp-spin{to{transform:rotate(360deg);}}
        .lmp-track-info{flex:1;min-width:0;}
        .lmp-track-name{font-size:14px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .lmp-track-dur{font-size:11px;color:#64748b;margin-top:2px;}
        .lmp-progress-wrap{padding:4px 20px;flex-shrink:0;}
        .lmp-progress{width:100%;height:3px;appearance:none;background:rgba(255,255,255,0.1);border-radius:99px;cursor:pointer;outline:none;}
        .lmp-progress::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;background:#7c3aed;cursor:pointer;box-shadow:0 0 6px rgba(124,58,237,0.6);}
        .lmp-progress:disabled{opacity:0.3;cursor:default;}
        .lmp-controls{display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 20px;flex-shrink:0;}
        .lmp-ctrl-btn{background:none;border:none;cursor:pointer;color:#94a3b8;padding:8px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:color 0.2s,background 0.2s;}
        .lmp-ctrl-btn:hover{color:#e2e8f0;background:rgba(255,255,255,0.07);}
        .lmp-ctrl-play{width:50px;height:50px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff!important;border-radius:50%;box-shadow:0 4px 16px rgba(124,58,237,0.4);}
        .lmp-ctrl-play:hover{transform:scale(1.06);}
        .lmp-ctrl-sm{opacity:0.6;}
        .lmp-ctrl-active{color:#a78bfa!important;opacity:1!important;}
        .lmp-volume-wrap{display:flex;align-items:center;gap:8px;padding:0 20px 10px;flex-shrink:0;}
        .lmp-volume{flex:1;height:3px;appearance:none;background:rgba(255,255,255,0.1);border-radius:99px;cursor:pointer;outline:none;}
        .lmp-volume::-webkit-slider-thumb{appearance:none;width:12px;height:12px;border-radius:50%;background:#7c3aed;cursor:pointer;}
        .lmp-scan-area{padding:8px 20px 10px;flex-shrink:0;border-top:1px solid rgba(255,255,255,0.05);}
        .lmp-scan-btn{width:100%;padding:10px;border-radius:10px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);color:#a78bfa;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:background 0.2s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .lmp-scan-btn:hover:not(:disabled){background:rgba(124,58,237,0.25);border-color:rgba(124,58,237,0.5);}
        .lmp-scan-btn:disabled{opacity:0.7;cursor:not-allowed;}
        .lmp-scan-msg{text-align:center;font-size:11px;color:#64748b;margin-top:6px;}
        .lmp-scan-error{text-align:center;font-size:11px;color:#f87171;margin-top:6px;line-height:1.6;}
        .lmp-web-note{text-align:center;font-size:10px;color:#334155;margin-top:5px;}
        .lmp-spin{display:inline-block;animation:lmp-spin 0.8s linear infinite;margin-right:4px;}
        .lmp-playlist{flex:1;overflow:hidden;display:flex;flex-direction:column;border-top:1px solid rgba(255,255,255,0.05);min-height:0;}
        .lmp-playlist-header{padding:10px 20px 6px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.8px;text-transform:uppercase;display:flex;align-items:center;gap:8px;flex-shrink:0;}
        .lmp-playlist-count{background:rgba(124,58,237,0.2);color:#a78bfa;border-radius:99px;padding:1px 8px;font-size:10px;font-weight:600;}
        .lmp-playlist-list{overflow-y:auto;flex:1;padding-bottom:8px;}
        .lmp-playlist-list::-webkit-scrollbar{width:3px;}
        .lmp-playlist-list::-webkit-scrollbar-thumb{background:rgba(124,58,237,0.3);border-radius:99px;}
        .lmp-playlist-item{display:flex;align-items:center;gap:10px;padding:9px 20px;cursor:pointer;transition:background 0.15s;}
        .lmp-playlist-item:hover{background:rgba(255,255,255,0.04);}
        .lmp-playlist-active{background:rgba(124,58,237,0.12)!important;}
        .lmp-playlist-num{width:22px;text-align:center;flex-shrink:0;font-size:11px;color:#475569;}
        .lmp-playlist-active .lmp-playlist-num{color:#a78bfa;}
        .lmp-playlist-name{flex:1;font-size:13px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .lmp-playlist-active .lmp-playlist-name{color:#e2e8f0;font-weight:600;}
        .lmp-playlist-dur{font-size:11px;color:#475569;flex-shrink:0;}
        .lmp-bars{display:flex;align-items:flex-end;gap:2px;height:14px;}
        .lmp-bars b{display:block;width:2px;border-radius:1px;background:#a78bfa;animation:lmp-bar 0.6s ease-in-out infinite alternate;}
        .lmp-bars b:nth-child(1){height:6px;animation-delay:0s;}
        .lmp-bars b:nth-child(2){height:12px;animation-delay:0.15s;}
        .lmp-bars b:nth-child(3){height:8px;animation-delay:0.3s;}
        @keyframes lmp-bar{from{transform:scaleY(0.4);}to{transform:scaleY(1);}}
        .lmp-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 20px;gap:8px;}
        .lmp-empty-icon{font-size:36px;opacity:0.3;}
        .lmp-empty-text{text-align:center;color:#475569;font-size:13px;line-height:1.6;}
        .lmp-empty-text small{font-size:11px;color:#334155;}
      `}</style>
    </div>
  )
}
