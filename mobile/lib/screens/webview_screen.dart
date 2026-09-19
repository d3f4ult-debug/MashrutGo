import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

import '../config/app_config.dart';
import '../services/fcm_service.dart';
import '../services/permission_service.dart';
import '../services/nfc_bridge.dart';

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

  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  @override
  void initState() {
    super.initState();
    _initWebView();
    _initConnectivityListener();
    _requestInitialPermissions();
  }

  @override
  void dispose() {
    _connectivitySub?.cancel();
    super.dispose();
  }

  void _requestInitialPermissions() async {
    // Request driver GPS permissions on startup for smooth operation
    await PermissionService.requestLocationPermission();
  }

  void _initConnectivityListener() {
    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final isConnected = results.any((r) => r != ConnectivityResult.none);
      if (isConnected && _hasError) {
        // Auto-retry when internet connection is restored
        setState(() {
          _hasError = false;
          _isLoading = true;
        });
        _controller.reload();
      }
    });
  }

  void _initWebView() {
    final startUrl = widget.initialRoute != null && widget.initialRoute!.isNotEmpty
        ? '${AppConfig.initialWebUrl}${widget.initialRoute}'
        : AppConfig.initialWebUrl;

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0F111A)) // Dark surface background
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (int progress) {
            setState(() {
              _progress = progress / 100.0;
            });
          },
          onPageStarted: (String url) {
            setState(() {
              _isLoading = true;
              _hasError = false;
            });
          },
          onPageFinished: (String url) {
            setState(() {
              _isLoading = false;
            });
            // Inject native device flags into window
            _injectNativeEnvironment();
          },
          onWebResourceError: (WebResourceError error) {
            // Only trigger error screen on main page load failures
            if (error.isForMainFrame ?? true) {
              setState(() {
                _isLoading = false;
                _hasError = true;
                _errorMessage = error.description;
              });
            }
          },
          onNavigationRequest: (NavigationRequest request) async {
            final uri = Uri.parse(request.url);

            // External Links Policy: intercept tel:, mailto:, tg:, and banking links
            if (AppConfig.isExternalLink(uri)) {
              try {
                await launchUrl(uri, mode: LaunchMode.externalApplication);
              } catch (e) {
                debugPrint('[WebView] Failed to launch external url: $e');
              }
              return NavigationDecision.prevent;
            }

            return NavigationDecision.navigate;
          },
        ),
      )
      ..addJavaScriptChannel(
        'MashrutGoNativeBridge',
        onMessageReceived: _handleJavaScriptMessage,
      )
      ..loadRequest(Uri.parse(startUrl));
  }

  /// Inject native information and helpers into web JavaScript environment
  void _injectNativeEnvironment() {
    final script = '''
      window.isNativeWrapper = true;
      window.nativePlatform = '${Theme.of(context).platform.name}';
      window.nativeFcmToken = '${FcmService().fcmToken ?? ""}';
      if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('MashrutGoNativeReady', {
          detail: {
            isNative: true,
            fcmToken: '${FcmService().fcmToken ?? ""}'
          }
        }));
      }
    ''';
    _controller.runJavaScript(script);
  }

  /// Handle messages sent from Web/PWA via window.MashrutGoNativeBridge.postMessage(...)
  void _handleJavaScriptMessage(JavaScriptMessage message) async {
    try {
      final data = jsonDecode(message.message) as Map<String, dynamic>;
      final action = data['action'] as String?;

      switch (action) {
        case 'requestLocation':
          final loc = await PermissionService.getCurrentLocation();
          _controller.runJavaScript(
            'if (window.onNativeLocation) window.onNativeLocation(${jsonEncode(loc)});',
          );
          break;

        case 'getFcmToken':
          final token = FcmService().fcmToken;
          _controller.runJavaScript(
            'if (window.onNativeFcmToken) window.onNativeFcmToken(${jsonEncode(token)});',
          );
          break;

        case 'scanNfc':
          final result = await NfcBridge().readTransportCard();
          _controller.runJavaScript(
            'if (window.onNativeNfcResult) window.onNativeNfcResult(${jsonEncode(result)});',
          );
          break;

        case 'openExternal':
          final targetUrl = data['url'] as String?;
          if (targetUrl != null) {
            launchUrl(Uri.parse(targetUrl), mode: LaunchMode.externalApplication);
          }
          break;

        default:
          debugPrint('[NativeBridge] Unknown action: $action');
      }
    } catch (e) {
      debugPrint('[NativeBridge] Error handling message: $e');
    }
  }

  /// Deep link navigation into web route (triggered by notification click)
  void navigateToRoute(String route) {
    final cleanRoute = route.startsWith('/') ? route : '/$route';
    final targetUrl = '${AppConfig.initialWebUrl}$cleanRoute';
    _controller.loadRequest(Uri.parse(targetUrl));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        // WebView back navigation handling
        if (await _controller.canGoBack()) {
          await _controller.goBack();
        } else {
          // Confirm exit
          if (!context.mounted) return;
          final shouldExit = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              backgroundColor: const Color(0xFF181B26),
              title: const Text('MashrutGo', style: TextStyle(color: Colors.white)),
              content: const Text(
                'Ilovadan chiqmoqchimisiz?',
                style: TextStyle(color: Color(0xFF94A3B8)),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(false),
                  child: const Text('Bekor qilish'),
                ),
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(true),
                  child: const Text('Chiqish', style: TextStyle(color: Colors.redAccent)),
                ),
              ],
            ),
          );

          if (shouldExit == true) {
            SystemNavigator.pop();
          }
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0F111A),
        body: SafeArea(
          child: Stack(
            children: [
              // Main WebView
              if (!_hasError) WebViewWidget(controller: _controller),

              // Top progress bar during page transition
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

              // Offline / Error Shell
              if (_hasError) _buildOfflineErrorShell(),
            ],
          ),
        ),
      ),
    );
  }

  /// Dark-themed offline / loading error fallback shell
  Widget _buildOfflineErrorShell() {
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
              child: const Icon(
                Icons.wifi_off_rounded,
                size: 40,
                color: Color(0xFFEF4444),
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'Internet bilan aloqa uzildi',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 10),
            Text(
              _errorMessage ?? 'MashrutGo tizimiga ulanishda xatolik yuz berdi. Internet aloqangizni tekshiring va qayta urinib ko\'ring.',
              style: const TextStyle(
                fontSize: 14,
                color: Color(0xFF94A3B8),
                height: 1.4,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            ElevatedButton.icon(
              onPressed: () {
                setState(() {
                  _hasError = false;
                  _isLoading = true;
                });
                _controller.reload();
              },
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Qayta urinish'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF3B82F6),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                elevation: 4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
