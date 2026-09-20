import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../config/app_config.dart';
import '../services/fcm_service.dart';
import '../services/nfc_bridge.dart';
import '../services/permission_service.dart';

/// The whole product runs in the web app; this screen only hosts it and bridges native
/// capabilities (GPS/camera permissions, NFC, FCM token, keep-screen-on, external links).
class WebViewScreen extends StatefulWidget {
  final String? initialRoute;

  const WebViewScreen({super.key, this.initialRoute});

  @override
  State<WebViewScreen> createState() => WebViewScreenState();
}

class WebViewScreenState extends State<WebViewScreen> {
  late final WebViewController _controller;
  bool _isLoading = true;
  double _progress = 0.0;
  bool _hasError = false;
  String? _errorMessage;
  String? _currentUrl;

  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  StreamSubscription<String>? _tokenSub;

  @override
  void initState() {
    super.initState();
    _initWebView();
    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final online = results.any((r) => r != ConnectivityResult.none);
      if (online && _hasError) _retry();
    });
    // A refreshed FCM token must reach the web app so it can re-register it for the signed-in user
    _tokenSub = FcmService().tokenChanges.listen((_) => _injectNativeEnvironment());
  }

  @override
  void dispose() {
    _connectivitySub?.cancel();
    _tokenSub?.cancel();
    WakelockPlus.disable();
    super.dispose();
  }

  void _initWebView() {
    final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      // iOS: the QR scanner shows the camera stream inline
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }

    _controller = WebViewController.fromPlatformCreationParams(params, onPermissionRequest: _onWebPermissionRequest)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0F111A))
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) => setState(() => _progress = progress / 100.0),
          onPageStarted: (url) => setState(() {
            _isLoading = true;
            _hasError = false;
            _currentUrl = url;
          }),
          onPageFinished: (url) {
            setState(() {
              _isLoading = false;
              _currentUrl = url;
            });
            _injectNativeEnvironment();
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame ?? true) {
              setState(() {
                _isLoading = false;
                _hasError = true;
                _errorMessage = error.description;
              });
            }
          },
          onNavigationRequest: (request) async {
            if (!request.isMainFrame) return NavigationDecision.navigate;
            final uri = Uri.tryParse(request.url);
            if (uri != null && AppConfig.isExternalLink(uri)) {
              await _openExternal(uri);
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
        ),
      )
      ..addJavaScriptChannel('MashrutGoNativeBridge', onMessageReceived: _handleJavaScriptMessage);

    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      // Android WebView does not ask for location on its own: bridge it to the app permission
      platform.setGeolocationPermissionsPromptCallbacks(
        onShowPrompt: (request) async {
          final trusted = AppConfig.isTrustedPage(request.origin);
          final granted = trusted && await PermissionService.requestLocationPermission();
          return GeolocationPermissionsResponse(allow: granted, retain: granted);
        },
      );
      platform.setMediaPlaybackRequiresUserGesture(false);
    }

    final route = AppConfig.routeFromDeepLink(widget.initialRoute);
    _controller.loadRequest(Uri.parse('${AppConfig.initialWebUrl}${route ?? ''}'));
  }

  Future<void> _onWebPermissionRequest(WebViewPermissionRequest request) async {
    if (!AppConfig.isTrustedPage(_currentUrl)) {
      await request.deny();
      return;
    }
    if (request.types.contains(WebViewPermissionResourceType.camera)) {
      final granted = await PermissionService.requestCameraPermission();
      granted ? await request.grant() : await request.deny();
      return;
    }
    await request.deny();
  }

  /// Exposes native capabilities to the web app (read by `src/services/nativeBridge.ts`).
  void _injectNativeEnvironment() {
    if (!AppConfig.isTrustedPage(_currentUrl)) return;
    final platform = Platform.isIOS ? 'ios' : 'android';
    final token = jsonEncode(FcmService().fcmToken);
    _controller.runJavaScript('''
      window.isNativeWrapper = true;
      window.nativePlatform = '$platform';
      window.nativeFcmToken = $token;
      window.dispatchEvent(new CustomEvent('MashrutGoNativeReady', { detail: { isNative: true, fcmToken: $token } }));
    ''');
  }

  Future<void> _reply(String callback, Object? value) {
    return _controller.runJavaScript('if (window.$callback) window.$callback(${jsonEncode(value)});');
  }

  Future<void> _handleJavaScriptMessage(JavaScriptMessage message) async {
    // Only our own web app may drive native features
    if (!AppConfig.isTrustedPage(_currentUrl)) return;
    try {
      final data = jsonDecode(message.message) as Map<String, dynamic>;
      switch (data['action'] as String?) {
        case 'requestLocation':
          await _reply('onNativeLocation', await PermissionService.getCurrentLocation());
          break;
        case 'getFcmToken':
          await _reply('onNativeFcmToken', FcmService().fcmToken);
          break;
        case 'scanNfc':
          await _reply('onNativeNfcResult', await NfcBridge().readTransportTag());
          break;
        case 'setKeepScreenOn':
          // Driver shift: keep the screen (and the GPS transmitter in the page) alive
          data['enabled'] == true ? await WakelockPlus.enable() : await WakelockPlus.disable();
          break;
        case 'openExternal':
          final uri = Uri.tryParse((data['url'] as String?) ?? '');
          if (uri != null && (uri.scheme == 'https' || AppConfig.isExternalLink(uri))) await _openExternal(uri);
          break;
        default:
          debugPrint('[NativeBridge] Unknown action: ${data['action']}');
      }
    } catch (e) {
      debugPrint('[NativeBridge] Error handling message: $e');
    }
  }

  Future<void> _openExternal(Uri uri) async {
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('[WebView] Failed to open external url: $e');
    }
  }

  /// Deep link (notification tap / mashrutgo:// link) into a web route.
  void navigateToRoute(String route) {
    final path = AppConfig.routeFromDeepLink(route);
    if (path == null) return;
    _controller.loadRequest(Uri.parse('${AppConfig.initialWebUrl}$path'));
  }

  void _retry() {
    setState(() {
      _hasError = false;
      _isLoading = true;
    });
    _controller.reload();
  }

  Future<void> _handleBack() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return;
    }
    if (!mounted) return;
    final shouldExit = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF181B26),
        title: const Text('MashrutGo', style: TextStyle(color: Colors.white)),
        content: const Text('Ilovadan chiqmoqchimisiz?', style: TextStyle(color: Color(0xFF94A3B8))),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Bekor qilish')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Chiqish', style: TextStyle(color: Colors.redAccent)),
          ),
        ],
      ),
    );
    if (shouldExit == true) SystemNavigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _handleBack();
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0F111A),
        body: SafeArea(
          child: Stack(
            children: [
              if (!_hasError) WebViewWidget(controller: _controller),
              if (_isLoading && !_hasError)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: LinearProgressIndicator(
                    value: _progress > 0 ? _progress : null,
                    backgroundColor: Colors.transparent,
                    valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF3B82F6)),
                    minHeight: 2.5,
                  ),
                ),
              if (_hasError) _buildOfflineShell(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOfflineShell() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: const Color(0xFF1E2235),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFF334155)),
              ),
              child: const Icon(Icons.wifi_off_rounded, size: 40, color: Color(0xFFEF4444)),
            ),
            const SizedBox(height: 24),
            const Text(
              'Internet bilan aloqa uzildi',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 10),
            Text(
              _errorMessage ?? 'MashrutGo serveriga ulanib bo‘lmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.',
              style: const TextStyle(fontSize: 14, color: Color(0xFF94A3B8), height: 1.4),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            ElevatedButton.icon(
              onPressed: _retry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Qayta urinish'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF3B82F6),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
