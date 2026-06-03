import { Filesystem, Directory } from '@capacitor/filesystem';

// Fetch version.json dari Netlify (selalu up-to-date)
const VERSION_URL = 'https://kyokoapp.netlify.app/version.json';
// ⬆️ Ganti dengan URL Netlify kamu yang sebenarnya

// Versi app saat ini — otomatis dari package.json via Vite define
export const CURRENT_VERSION: string =
  (import.meta as any).env?.VITE_APP_VERSION || '1.0.0';

export interface UpdateInfo {
  version: string;
  apkUrl: string;
  changelog: string;
}

/** Cek apakah ada versi baru. Return null kalau gagal / sudah up to date. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(VERSION_URL + '?t=' + Date.now());
    if (!res.ok) return null;
    const data: UpdateInfo = await res.json();
    if (compareVersions(data.version, CURRENT_VERSION) > 0) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/** Download APK ke storage internal lalu trigger install */
export async function downloadAndInstall(
  apkUrl: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const res = await fetch(apkUrl);
  if (!res.ok) throw new Error('Gagal download APK');

  const contentLength = Number(res.headers.get('content-length') || 0);
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength > 0) {
      onProgress(Math.round((received / contentLength) * 100));
    }
  }

  // Gabung semua chunk → base64
  const blob = new Blob(chunks as BlobPart[], {
    type: 'application/vnd.android.package-archive',
  });
  const base64 = await blobToBase64(blob);

  // Simpan ke External storage
  await Filesystem.writeFile({
    path: 'KyokoApp-update.apk',
    data: base64,
    directory: Directory.External,
  });

  // Ambil URI file
  const { uri: fileUri } = await Filesystem.getUri({
    path: 'KyokoApp-update.apk',
    directory: Directory.External,
  });

  // Trigger install via Android Intent
  if ((window as any).AndroidInstallApk) {
    (window as any).AndroidInstallApk.install(fileUri);
  } else {
    window.open(fileUri, '_system');
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Return > 0 kalau a lebih baru dari b (semver x.y.z) */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
