import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';

class PermissionService {
  /// Location permission for the driver's shift GPS and the passenger's "current location".
  static Future<bool> requestLocationPermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return permission == LocationPermission.always || permission == LocationPermission.whileInUse;
  }

  /// Camera permission for the fare QR scanner (getUserMedia inside the WebView).
  static Future<bool> requestCameraPermission() async {
    final status = await Permission.camera.request();
    return status.isGranted;
  }

  /// One high-accuracy fix for the web app (fallback when WebView geolocation is unavailable).
  static Future<Map<String, dynamic>?> getCurrentLocation() async {
    if (!await requestLocationPermission()) return null;
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
      );
      return {
        'latitude': position.latitude,
        'longitude': position.longitude,
        'accuracy': position.accuracy,
        'heading': position.heading,
        'speed': position.speed,
        'timestamp': position.timestamp.millisecondsSinceEpoch,
      };
    } catch (_) {
      return null;
    }
  }
}
