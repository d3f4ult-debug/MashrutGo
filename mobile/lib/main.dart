import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'screens/webview_screen.dart';
import 'services/fcm_service.dart';

final GlobalKey<WebViewScreenState> webViewKey = GlobalKey<WebViewScreenState>();

/// Notification tapped before the WebView existed (cold start) — opened once it is ready.
String? _pendingRoute;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0F111A),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  await FcmService().initialize(
    onDeepLink: (route) {
      final state = webViewKey.currentState;
      if (state != null) {
        state.navigateToRoute(route);
      } else {
        _pendingRoute = route;
      }
    },
  );

  runApp(const MashrutGoApp());
}

class MashrutGoApp extends StatelessWidget {
  const MashrutGoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MashrutGo',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0F111A),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF3B82F6),
          secondary: Color(0xFFA855F7),
          surface: Color(0xFF181B26),
        ),
        useMaterial3: true,
      ),
      home: WebViewScreen(key: webViewKey, initialRoute: _pendingRoute),
    );
  }
}
