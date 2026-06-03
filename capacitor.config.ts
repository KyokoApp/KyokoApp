import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kyokoapp.app',
  appName: 'KyokoApp',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
    // ⬇️ Ganti dengan URL Netlify kamu yang sebenarnya
    url: 'https://kyokoapp.netlify.app',
    cleartext: true,
    allowNavigation: [
      '*.hianime.to',
      '*.yugenanime.tv',
      '*.allanime.to',
      '*.gogoanime.*',
      '*.gogo-stream.*',
      '*.gogoplay.*',
      '*.megacloud.tv',
      '*.rapid-cloud.co',
      '*.embtaku.*',
    ],
  },

  android: {
    allowMixedContent: true,
    backgroundColor: '#0a0a0a',
    webContentsDebuggingEnabled: false,
    allowNavigation: [
      '*.hianime.to',
      '*.yugenanime.tv',
      '*.allanime.to',
      '*.gogoanime.*',
      '*.gogo-stream.*',
      '*.gogoplay.*',
      '*.megacloud.tv',
      '*.rapid-cloud.co',
      '*.embtaku.*',
    ],
  },

  plugins: {
    SplashScreen: {
      backgroundColor: '#0a0a0a',
      showSpinner: false,
      launchAutoHide: true,
      launchShowDuration: 0,
    },
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '730376199922-8hj9gq2ifvkc6ag6ddfs6qsgi84i6tq7.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;
