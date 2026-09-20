import 'dart:io';
import 'package:flutter/foundation.dart';

/// Build-time configuration (`--dart-define=KEY=value`). Nothing secret is hardcoded here.
class AppConfig {
  /// Web app (PWA) loaded inside the WebView, e.g. `--dart-define=WEB_URL=https://app.mashrutgo.uz`.
  static const String _overrideWebUrl = String.fromEnvironment('WEB_URL', defaultValue: '');

  static String get initialWebUrl {
    if (_overrideWebUrl.isNotEmpty) return _overrideWebUrl.replaceAll(RegExp(r'/+$'), '');
    if (kReleaseMode) return 'https://app.mashrutgo.uz';
    // Development: Android emulator reaches the host machine via 10.0.2.2
    if (!kIsWeb && Platform.isAndroid) return 'http://10.0.2.2:5173';
    return 'http://localhost:5173';
  }

  static Uri get webOrigin => Uri.parse(initialWebUrl);

  /// Only pages served from the configured web origin may use the native bridge.
  static bool isTrustedPage(String? url) {
    final uri = Uri.tryParse(url ?? '');
    if (uri == null) return false;
    final origin = webOrigin;
    return uri.scheme == origin.scheme && uri.host == origin.host && uri.port == origin.port;
  }

  /// Web route for a notification/deep link (`/driver/payments`, `mashrutgo://route?path=/wallet`, …).
  /// Anything that is not an in-app path is ignored.
  static String? routeFromDeepLink(String? raw) {
    if (raw == null || raw.trim().isEmpty) return null;
    final value = raw.trim();
    if (value.startsWith('/')) return value.startsWith('//') ? null : value;
    final uri = Uri.tryParse(value);
    if (uri == null) return null;
    if (uri.scheme == 'mashrutgo') {
      final path = uri.queryParameters['path'];
      if (path != null && path.startsWith('/') && !path.startsWith('//')) return path;
      final segments = [uri.host, ...uri.pathSegments].where((s) => s.isNotEmpty).join('/');
      return segments.isEmpty ? '/' : '/$segments';
    }
    if (isTrustedPage(value)) {
      return '${uri.path.isEmpty ? '/' : uri.path}${uri.hasQuery ? '?${uri.query}' : ''}';
    }
    return null;
  }

  // ── Firebase Cloud Messaging (optional). Without these values push is simply disabled. ──
  static const String fcmApiKey = String.fromEnvironment('FCM_API_KEY', defaultValue: '');
  static const String fcmAppId = String.fromEnvironment('FCM_APP_ID', defaultValue: '');
  static const String fcmSenderId = String.fromEnvironment('FCM_SENDER_ID', defaultValue: '');
  static const String fcmProjectId = String.fromEnvironment('FCM_PROJECT_ID', defaultValue: '');
  static const String fcmIosBundleId = String.fromEnvironment('FCM_IOS_BUNDLE_ID', defaultValue: '');

  static bool get fcmConfigured =>
      fcmApiKey.isNotEmpty && fcmAppId.isNotEmpty && fcmSenderId.isNotEmpty && fcmProjectId.isNotEmpty;

  /// Schemes and domains opened outside the WebView (dialer, mail, Telegram, payment apps).
  static const List<String> externalSchemes = ['tel', 'mailto', 'sms', 'tg', 'intent', 'market'];

  static const List<String> externalDomains = [
    't.me',
    'telegram.me',
    'payme.uz',
    'click.uz',
    'checkout.paycom.uz',
    'play.google.com',
    'apps.apple.com',
  ];

  static bool isExternalLink(Uri uri) {
    if (externalSchemes.contains(uri.scheme.toLowerCase())) return true;
    final host = uri.host.toLowerCase();
    for (final domain in externalDomains) {
      if (host == domain || host.endsWith('.$domain')) return true;
    }
    // Any other http(s) site that is not our web app opens in the system browser
    if ((uri.scheme == 'http' || uri.scheme == 'https') && host.isNotEmpty && !isTrustedPage(uri.toString())) {
      return true;
    }
    return false;
  }
}
