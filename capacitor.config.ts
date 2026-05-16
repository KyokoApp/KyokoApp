import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kyokoapp.app',
  appName: 'KyokoApp',
  webDir: 'dist',

  android: {
    // Izinkan mixed content (http + https dalam satu halaman)
    allowMixedContent: true,
    // Izinkan WebView load URL eksternal tanpa intercept
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

  server: {
    androidScheme: 'https',
    // Izinkan cleartext HTTP (untuk provider yang masih pakai http)
    cleartext: true,
    // Izinkan navigasi ke domain eksternal dari WebView
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
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '730376199922-8hj9gq2ifvkc6ag6ddfs6qsgi84i6tq7.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;
