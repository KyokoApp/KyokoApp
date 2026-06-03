import React, { useState } from 'react';
import { Download, X, Sparkles, AlertCircle } from 'lucide-react';
import { UpdateInfo, downloadAndInstall } from '../lib/updater';

interface Props {
  info: UpdateInfo;
  onDismiss: () => void;
}

export default function UpdateDialog({ info, onDismiss }: Props) {
  const [state, setState] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const handleUpdate = async () => {
    setState('downloading');
    setProgress(0);
    try {
      await downloadAndInstall(info.apkUrl, (pct) => setProgress(pct));
      setState('done');
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal mengunduh update');
      setState('error');
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '1rem',
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 440,
          borderRadius: 20,
          background: '#0f0f0f',
          border: '1px solid rgba(200,255,0,0.25)',
          boxShadow: '0 0 50px rgba(200,255,0,0.1)',
          overflow: 'hidden',
          animation: 'kyoko-slide-up 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        <style>{`
          @keyframes kyoko-slide-up {
            from { transform: translateY(60px); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        `}</style>

        {/* ── Header ── */}
        <div style={{
          position: 'relative', padding: '1.25rem 1.25rem 1rem',
          background: 'linear-gradient(135deg, rgba(200,255,0,0.08) 0%, transparent 60%)',
          borderBottom: '1px solid rgba(200,255,0,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(200,255,0,0.08)', border: '1px solid rgba(200,255,0,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Sparkles size={18} color="#c8ff00" />
            </div>
            <div>
              <div style={{
                fontFamily: 'monospace', fontSize: 13, letterSpacing: 3,
                color: '#c8ff00', fontWeight: 700,
              }}>
                UPDATE TERSEDIA
              </div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                KyokoApp v{info.version}
              </div>
            </div>
          </div>

          {state === 'idle' && (
            <button
              onClick={onDismiss}
              style={{
                position: 'absolute', top: 16, right: 16,
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#555', padding: 4,
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* ── Changelog ── */}
        <div style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 10, color: '#444', letterSpacing: 2, marginBottom: 6 }}>
            YANG BARU
          </div>
          <p style={{
            fontSize: 13, color: '#bbb', lineHeight: 1.6,
            margin: 0, whiteSpace: 'pre-line',
          }}>
            {info.changelog}
          </p>
        </div>

        {/* ── Progress bar ── */}
        {state === 'downloading' && (
          <div style={{ padding: '0 1.25rem 0.75rem' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: '#666', marginBottom: 6,
            }}>
              <span>Mengunduh...</span>
              <span>{progress}%</span>
            </div>
            <div style={{
              width: '100%', height: 4, borderRadius: 4,
              background: '#1a1a1a', overflow: 'hidden',
            }}>
              <div style={{
                width: `${progress}%`, height: '100%',
                background: '#c8ff00', borderRadius: 4,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}

        {state === 'done' && (
          <div style={{ padding: '0 1.25rem 0.75rem' }}>
            <div style={{
              padding: '0.75rem', borderRadius: 10, fontSize: 12,
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.2)',
              color: '#4ade80',
            }}>
              ✅ Download selesai! Ikuti instruksi install yang muncul.
            </div>
          </div>
        )}

        {state === 'error' && (
          <div style={{ padding: '0 1.25rem 0.75rem' }}>
            <div style={{
              padding: '0.75rem', borderRadius: 10,
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <AlertCircle size={14} color="#f87171" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: '#f87171' }}>{errorMsg}</span>
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div style={{ display: 'flex', gap: 10, padding: '0.75rem 1.25rem 1.25rem' }}>
          {state === 'idle' && (
            <>
              <button
                onClick={onDismiss}
                style={{
                  flex: 1, padding: '0.65rem', borderRadius: 10,
                  background: 'none', border: '1px solid #2a2a2a',
                  color: '#666', fontSize: 13, cursor: 'pointer',
                  transition: 'border-color 0.2s, color 0.2s',
                }}
              >
                Nanti Saja
              </button>
              <button
                onClick={handleUpdate}
                style={{
                  flex: 2, padding: '0.65rem', borderRadius: 10,
                  background: '#c8ff00', border: 'none',
                  color: '#000', fontWeight: 700, fontSize: 13,
                  cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', gap: 6,
                  boxShadow: '0 4px 20px rgba(200,255,0,0.25)',
                  transition: 'box-shadow 0.2s',
                }}
              >
                <Download size={15} />
                Update Sekarang
              </button>
            </>
          )}

          {state === 'downloading' && (
            <div style={{
              flex: 1, padding: '0.65rem', borderRadius: 10, textAlign: 'center',
              background: 'rgba(200,255,0,0.08)',
              color: '#c8ff00', fontSize: 13, border: '1px solid rgba(200,255,0,0.2)',
            }}>
              Mengunduh... {progress}%
            </div>
          )}

          {(state === 'done' || state === 'error') && (
            <button
              onClick={onDismiss}
              style={{
                flex: 1, padding: '0.65rem', borderRadius: 10,
                background: 'none', border: '1px solid #2a2a2a',
                color: '#666', fontSize: 13, cursor: 'pointer',
              }}
            >
              Tutup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
