const fs = require('fs');
const path = require('path');

console.log('--- KyokoApp Android Native Configurator ---');

const appPackage = 'com.kyokoapp.app';
const manifestPath = path.join(__dirname, '../android/app/src/main/AndroidManifest.xml');
const mainActivityDir = path.join(__dirname, '../android/app/src/main/java/com/kyokoapp/app');
const mainActivityKt  = path.join(mainActivityDir, 'MainActivity.kt');
const mainActivityJava = path.join(mainActivityDir, 'MainActivity.java');

// ── 1. AndroidManifest.xml ────────────────────────────────────────────────────
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');

  // Permissions
  const permissions = `
    <!-- KyokoApp Permissions -->
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
  `;

  if (!manifest.includes('READ_MEDIA_AUDIO')) {
    manifest = manifest.replace('<application', `${permissions}\n    <application`);
    console.log('✓ Injected storage & media permissions');
  }

  if (!manifest.includes('usesCleartextTraffic')) {
    manifest = manifest.replace(
      'android:label="@string/app_name"',
      'android:label="@string/app_name"\n        android:usesCleartextTraffic="true"\n        android:hardwareAccelerated="true"'
    );
    console.log('✓ Added usesCleartextTraffic & hardwareAccelerated');
  }

  if (!manifest.includes('android:requestLegacyExternalStorage')) {
    manifest = manifest.replace(
      '<application',
      '<application android:requestLegacyExternalStorage="true"'
    );
    console.log('✓ Added requestLegacyExternalStorage');
  }

  fs.writeFileSync(manifestPath, manifest, 'utf8');
} else {
  console.error('❌ AndroidManifest.xml not found:', manifestPath);
  process.exit(1);
}

// ── 2. MainActivity — patch WebView settings for streaming ───────────────────
const mainActivityCode = fs.existsSync(mainActivityKt) ? 'kt' : 'java';
const mainActivityPath = mainActivityCode === 'kt' ? mainActivityKt : mainActivityJava;

if (mainActivityCode === 'kt') {
  const ktCode = `package ${appPackage}

import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val webView: WebView = bridge.webView
    val settings: WebSettings = webView.settings
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    settings.domStorageEnabled = true
    settings.javaScriptEnabled = true
    settings.allowUniversalAccessFromFileURLs = true
    settings.allowFileAccessFromFileURLs = true
    settings.mediaPlaybackRequiresUserGesture = false
    WebView.setWebContentsDebuggingEnabled(false)
  }
}
`;
  fs.writeFileSync(mainActivityPath, ktCode, 'utf8');
  console.log('✓ Patched MainActivity.kt (streaming WebView settings)');
} else {
  const javaCode = `package ${appPackage};

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WebView webView = getBridge().getWebView();
    WebSettings settings = webView.getSettings();
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    settings.setDomStorageEnabled(true);
    settings.setJavaScriptEnabled(true);
    settings.setAllowUniversalAccessFromFileURLs(true);
    settings.setAllowFileAccessFromFileURLs(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    WebView.setWebContentsDebuggingEnabled(false);
  }
}
`;
  fs.writeFileSync(mainActivityPath, javaCode, 'utf8');
  console.log('✓ Patched MainActivity.java (streaming WebView settings)');
}

console.log('--- KyokoApp Android configuration complete ✅ ---');
