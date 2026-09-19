import 'dart:io';
import 'package:flutter/foundation.dart';

class AppConfig {
  /// Base Web URL loaded inside the WebView wrapper.
  /// Overridable at build time with: flutter run --dart-define=WEB_URL=https://app.mashrutgo.uz
  static const String _overrideWebUrl = String.fromEnvironment('WEB_URL', defaultValue: '');

  static String get initialWebUrl {
    if (_overrideWebUrl.isNotEmpty) {
      return _overrideWebUrl;
    }

    if (kReleaseMode) {
      return 'https://app.mashrutgo.uz';
    }

    // Development defaults
    if (!kIsWeb && Platform.isAndroid) {
      // Android emulator loopback to host computer
      return 'http://10.0.2.2:5173';
    } else {
      // iOS simulator or desktop testing
      return 'http://localhost:5173';
    }
  }

  /// Backend API base URL for device registration & FCM tokens
  static const String _overrideApiUrl = String.fromEnvironment('API_URL', defaultValue: '');

  static String get apiBaseUrl {
    if (_overrideApiUrl.isNotEmpty) {
      return _overrideApiUrl;
    }

    if (kReleaseMode) {
      return 'https://api.mashrutgo.uz/api/v1';
    }

    if (!kIsWeb && Platform.isAndroid) {
      return 'http://10.0.2.2:8000/api/v1';
    } else {
      return 'http://localhost:8000/api/v1';
    }
  }

  /// External schemes and domains that should NOT be loaded inside the WebView,
  /// but instead launched externally in native system applications (dialer, mail, telegram, banking).
  static final List<String> externalSchemes = [
    'tel',
    'mailto',
    'sms',
    'tg',
  ];

  static final List<String> externalDomains = [
    't.me',
    'telegram.me',
    'payme.uz',
    'click.uz',
    'checkout.paycom.uz',
  ];

  static bool isExternalLink(Uri uri) {
    if (externalSchemes.contains(uri.scheme.toLowerCase())) {
      return true;
    }

    final host = uri.host.toLowerCase();
    for (final domain in externalDomains) {
      if (host == domain || host.endsWith('.$domain')) {
        return true;
      }
    }

    return false;
  }
}
