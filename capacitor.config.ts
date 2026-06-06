import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kyokobeat.musicplayer',
  appName: 'KyokoBeat',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true
  },
  android: {
    allowMixedContent: true,
    // Background hitam agar tidak ada flash putih saat app loading di HP apapun
    backgroundColor: '#0a0a0a',
    // Paksa WebView pakai hardware acceleration penuh
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#0a0a0a',
      showSpinner: false,
      launchAutoHide: true,
      launchShowDuration: 0,
    },
  },
};

export default config;
