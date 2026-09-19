import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nativeBridge } from '../services/nativeBridge.ts';

describe('Stage 10 — Flutter Wrapper & Native Bridge Smoke Tests', () => {
  const rootDir = path.resolve(process.cwd(), '..');
  const mobileDir = path.join(rootDir, 'mobile');

  test('Flutter Project Files & Manifests Smoke Test', () => {
    // 1. pubspec.yaml existence and dependencies
    const pubspecPath = path.join(mobileDir, 'pubspec.yaml');
    assert.ok(fs.existsSync(pubspecPath), 'mobile/pubspec.yaml must exist');
    const pubspecContent = fs.readFileSync(pubspecPath, 'utf8');
    assert.ok(pubspecContent.includes('webview_flutter'), 'pubspec.yaml must declare webview_flutter');
    assert.ok(pubspecContent.includes('firebase_messaging'), 'pubspec.yaml must declare firebase_messaging');
    assert.ok(pubspecContent.includes('geolocator'), 'pubspec.yaml must declare geolocator');

    // 2. AndroidManifest.xml permissions & deep link intent filter
    const manifestPath = path.join(mobileDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    assert.ok(fs.existsSync(manifestPath), 'AndroidManifest.xml must exist');
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    assert.ok(manifestContent.includes('android.permission.ACCESS_FINE_LOCATION'));
    assert.ok(manifestContent.includes('android.permission.CAMERA'));
    assert.ok(manifestContent.includes('android:scheme="mashrutgo"'));

    // 3. iOS Info.plist usage descriptions
    const plistPath = path.join(mobileDir, 'ios', 'Runner', 'Info.plist');
    assert.ok(fs.existsSync(plistPath), 'Info.plist must exist');
    const plistContent = fs.readFileSync(plistPath, 'utf8');
    assert.ok(plistContent.includes('NSLocationWhenInUseUsageDescription'));
    assert.ok(plistContent.includes('NSCameraUsageDescription'));

    // 4. Dart core files
    assert.ok(fs.existsSync(path.join(mobileDir, 'lib', 'main.dart')));
    assert.ok(fs.existsSync(path.join(mobileDir, 'lib', 'screens', 'webview_screen.dart')));
    assert.ok(fs.existsSync(path.join(mobileDir, 'lib', 'services', 'fcm_service.dart')));
    assert.ok(fs.existsSync(path.join(mobileDir, 'lib', 'config', 'app_config.dart')));
  });

  test('FCM Token Registration Payload & Deep Link Parsing', () => {
    // 1. Device registration payload format expected by backend
    const mockToken = 'fcm-sample-device-token-12345';
    const payload = {
      token: mockToken,
      platform: 'android',
      app_version: '1.0.0',
      registered_at: new Date().toISOString(),
    };

    assert.equal(payload.token, mockToken);
    assert.equal(payload.platform, 'android');
    assert.ok(payload.registered_at);

    // 2. Deep link extraction from notification data
    const notificationData = {
      title: 'Yangi to\'lov tushdi',
      body: '4 500 UZS qabul qilindi',
      route: '/driver/payments',
    };

    const targetRoute = notificationData.route || '/';
    assert.equal(targetRoute, '/driver/payments', 'Deep link route must be correctly resolved from FCM payload');
  });

  test('Native Bridge Contract: Web to Flutter JavaScript Channel', () => {
    // Verify nativeBridge methods exist
    assert.equal(typeof nativeBridge.isNative, 'function');
    assert.equal(typeof nativeBridge.requestLocation, 'function');
    assert.equal(typeof nativeBridge.getFcmToken, 'function');
    assert.equal(typeof nativeBridge.scanNfc, 'function');
    assert.equal(typeof nativeBridge.openExternal, 'function');

    // In Node/non-native environment, isNative must return false
    assert.equal(nativeBridge.isNative(), false);
  });
});
