import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../config/app_config.dart';

typedef OnRouteDeepLink = void Function(String route);

/// Firebase Cloud Messaging for the wrapper.
///
/// The device token is only handed to the web app; the web app registers it with the backend
/// (`POST /notifications/device-token`) using the signed-in user's JWT, so the native side never
/// talks to the API without authentication. Without FCM configuration push stays disabled —
/// no placeholder tokens are ever produced.
class FcmService {
  static final FcmService _instance = FcmService._internal();
  factory FcmService() => _instance;
  FcmService._internal();

  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  final StreamController<String> _tokenChanges = StreamController<String>.broadcast();
  String? _fcmToken;
  OnRouteDeepLink? _onDeepLink;

  String? get fcmToken => _fcmToken;

  /// Emits whenever FCM issues a (new) token, so the web app can re-register it.
  Stream<String> get tokenChanges => _tokenChanges.stream;

  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'mashrutgo_operations',
    'MashrutGo bildirishnomalari',
    description: 'To‘lovlar, pul yechish va smena xabarlari',
    importance: Importance.high,
  );

  Future<void> initialize({OnRouteDeepLink? onDeepLink}) async {
    _onDeepLink = onDeepLink;
    if (!AppConfig.fcmConfigured) {
      debugPrint('[FCM] Not configured (FCM_* dart-defines missing): push notifications disabled');
      return;
    }
    try {
      await Firebase.initializeApp(
        options: FirebaseOptions(
          apiKey: AppConfig.fcmApiKey,
          appId: AppConfig.fcmAppId,
          messagingSenderId: AppConfig.fcmSenderId,
          projectId: AppConfig.fcmProjectId,
          iosBundleId: AppConfig.fcmIosBundleId.isEmpty ? null : AppConfig.fcmIosBundleId,
        ),
      );

      await _localNotifications.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
        onDidReceiveNotificationResponse: (response) => _openRoute(response.payload),
      );
      if (Platform.isAndroid) {
        await _localNotifications
            .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
            ?.createNotificationChannel(_channel);
      }

      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        debugPrint('[FCM] Notification permission denied by the user');
        return;
      }

      _setToken(await messaging.getToken());
      messaging.onTokenRefresh.listen(_setToken);

      FirebaseMessaging.onMessage.listen(_showForegroundNotification);
      FirebaseMessaging.onMessageOpenedApp.listen((message) => _openRoute(_routeOf(message)));
      final initial = await messaging.getInitialMessage();
      if (initial != null) _openRoute(_routeOf(initial));
    } catch (e) {
      // Misconfiguration must not break the app: the in-app notification list still works
      debugPrint('[FCM] Initialization failed, push disabled: $e');
      _fcmToken = null;
    }
  }

  void _setToken(String? token) {
    if (token == null || token.isEmpty || token == _fcmToken) return;
    _fcmToken = token;
    _tokenChanges.add(token);
  }

  String? _routeOf(RemoteMessage message) => (message.data['route'] ?? message.data['deep_link'])?.toString();

  void _openRoute(String? raw) {
    final route = AppConfig.routeFromDeepLink(raw);
    if (route != null) _onDeepLink?.call(route);
  }

  Future<void> _showForegroundNotification(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;
    await _localNotifications.show(
      id: message.messageId?.hashCode ?? notification.hashCode,
      title: notification.title ?? 'MashrutGo',
      body: notification.body ?? '',
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: const DarwinNotificationDetails(presentAlert: true, presentBadge: true, presentSound: true),
      ),
      payload: _routeOf(message),
    );
  }
}
