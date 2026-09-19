import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'screens/webview_screen.dart';
import 'services/fcm_service.dart';

final GlobalKey<WebViewScreenState> webViewKey = GlobalKey<WebViewScreenState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Dark immersive status bar styling
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0F111A),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  // Initialize FCM and hook up notification tap deep-linking
  await FcmService().initialize(
    onDeepLink: (route) {
      debugPrint('[Main] Deep link received: $route');
      webViewKey.currentState?.navigateToRoute(route);
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
        colorScheme: ColorScheme.dark(
          primary: const Color(0xFF3B82F6),
          secondary: const Color(0xFFA855F7),
          surface: const Color(0xFF181B26),
        ),
        fontFamily: 'Inter',
        useMaterial3: true,
      ),
      home: WebViewScreen(key: webViewKey),
    );
  }
}
