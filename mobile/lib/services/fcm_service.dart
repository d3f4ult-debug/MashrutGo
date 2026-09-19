import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';

typedef OnRouteDeepLink = void Function(String route);

class FcmService {
  static final FcmService _instance = FcmService._internal();
  factory FcmService() => _instance;
  FcmService._internal();

  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  String? _fcmToken;
  OnRouteDeepLink? _onDeepLink;
  bool _isInitialized = false;

  String? get fcmToken => _fcmToken;

  /// Initialize Firebase & FCM notifications
  Future<void> initialize({OnRouteDeepLink? onDeepLink}) async {
    _onDeepLink = onDeepLink;

    try {
      // 1. Initialize Firebase Core
      await Firebase.initializeApp();

      // 2. Setup local notifications for Android/iOS foreground display
      const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
      const iosSettings = DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      );
      const initSettings = InitializationSettings(android: androidSettings, iOS: iosSettings);

      await _localNotifications.initialize(
        initSettings,
        onDidReceiveNotificationResponse: (response) {
          if (response.payload != null && response.payload!.isNotEmpty) {
            _handleNotificationPayload(response.payload!);
          }
        },
      );

      // 3. Request permissions from user
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(
        alert: true,
        announcement: false,
        badge: true,
        carPlay: false,
        criticalAlert: false,
        provisional: false,
        sound: true,
      );

      if (settings.authorizationStatus == AuthorizationStatus.authorized ||
          settings.authorizationStatus == AuthorizationStatus.provisional) {
        debugPrint('[FCM] Permission granted');

        // 4. Retrieve FCM token
        _fcmToken = await messaging.getToken();
        debugPrint('[FCM] Device Token: $_fcmToken');

        if (_fcmToken != null) {
          await registerDeviceWithBackend(_fcmToken!);
        }

        // Listen for token refresh
        messaging.onTokenRefresh.listen((newToken) {
          _fcmToken = newToken;
          registerDeviceWithBackend(newToken);
        });

        // 5. Handle foreground messages
        FirebaseMessaging.onMessage.listen((RemoteMessage message) {
          debugPrint('[FCM] Foreground message: ${message.notification?.title}');
          _showForegroundNotification(message);
        });

        // 6. Handle notification click when app opened from background
        FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
          debugPrint('[FCM] Notification tapped: ${message.data}');
          final targetRoute = message.data['route'] ?? message.data['deep_link'];
          if (targetRoute != null && _onDeepLink != null) {
            _onDeepLink!(targetRoute.toString());
          }
        });

        // 7. Check if app was opened from terminated state via notification
        final initialMessage = await messaging.getInitialMessage();
        if (initialMessage != null) {
          final targetRoute = initialMessage.data['route'] ?? initialMessage.data['deep_link'];
          if (targetRoute != null && _onDeepLink != null) {
            _onDeepLink!(targetRoute.toString());
          }
        }
      }

      _isInitialized = true;
    } catch (e) {
      debugPrint('[FCM] Warning: Firebase/FCM init skipped or failed (expected in mock dev without google-services.json): $e');
      // Generate simulated mock token for development testing with Web bridge
      _fcmToken = 'mock-fcm-token-${DateTime.now().millisecondsSinceEpoch}';
    }
  }

  /// Register device token with Dev1 Backend endpoint
  Future<bool> registerDeviceWithBackend(String token, {String? authToken}) async {
    try {
      final url = Uri.parse('${AppConfig.apiBaseUrl}/devices/register');
      final headers = {
        'Content-Type': 'application/json',
        if (authToken != null) 'Authorization': 'Bearer $authToken',
      };

      final body = jsonEncode({
        'token': token,
        'platform': !kIsWeb && Platform.isAndroid ? 'android' : 'ios',
        'app_version': '1.0.0',
        'registered_at': DateTime.now().toIso8601String(),
      });

      final res = await http.post(url, headers: headers, body: body).timeout(const Duration(seconds: 10));
      debugPrint('[FCM] Device registration response: ${res.statusCode}');
      return res.statusCode >= 200 && res.statusCode < 300;
    } catch (e) {
      debugPrint('[FCM] Backend device registration deferred: $e');
      return false;
    }
  }

  void _showForegroundNotification(RemoteMessage message) {
    final notification = message.notification;
    if (notification == null) return;

    final targetRoute = message.data['route'] ?? message.data['deep_link'] ?? '';

    _localNotifications.show(
      notification.hashCode,
      notification.title ?? 'MashrutGo',
      notification.body ?? '',
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'mashrutgo_operations',
          'MashrutGo Bildirishnomalar',
          importance: Importance.max,
          priority: Priority.high,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
      payload: targetRoute.toString(),
    );
  }

  void _handleNotificationPayload(String payload) {
    if (_onDeepLink != null && payload.isNotEmpty) {
      _onDeepLink!(payload);
    }
  }
}
