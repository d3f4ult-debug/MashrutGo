import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:nfc_manager/ndef_record.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';

/// Reads the NFC sticker of a vehicle for fare payment.
///
/// The sticker either carries an NDEF text/URI record (the vehicle's internal id or a
/// `mashrutgo://v/<id>` link) or is identified by its chip UID. The web app sends the value to
/// `POST /payments/resolve-vehicle`; the backend decides which vehicle it is.
class NfcBridge {
  static final NfcBridge _instance = NfcBridge._internal();
  factory NfcBridge() => _instance;
  NfcBridge._internal();

  bool _busy = false;

  Future<Map<String, dynamic>> readTransportTag({Duration timeout = const Duration(seconds: 30)}) async {
    if (_busy) return {'success': false, 'error': 'NFC o‘qish allaqachon davom etmoqda'};
    final NfcAvailability availability;
    try {
      availability = await NfcManager.instance.checkAvailability();
    } catch (e) {
      return {'success': false, 'error': 'NFC holatini aniqlab bo‘lmadi'};
    }
    if (availability == NfcAvailability.disabled) {
      return {'success': false, 'error': 'NFC o‘chirilgan. Telefon sozlamalaridan NFC ni yoqing.'};
    }
    if (availability != NfcAvailability.enabled) {
      return {'success': false, 'error': 'Bu qurilmada NFC mavjud emas'};
    }

    _busy = true;
    final completer = Completer<Map<String, dynamic>>();
    void finish(Map<String, dynamic> result) {
      if (!completer.isCompleted) completer.complete(result);
    }

    try {
      await NfcManager.instance.startSession(
        pollingOptions: {NfcPollingOption.iso14443, NfcPollingOption.iso15693},
        alertMessageIos: 'Telefonni transportdagi NFC belgisiga yaqinlashtiring',
        onSessionErrorIos: (error) => finish({'success': false, 'error': error.message}),
        onDiscovered: (NfcTag tag) async {
          final value = extractIdentifier(tag);
          try {
            if (value != null) {
              await NfcManager.instance.stopSession(alertMessageIos: 'Belgi o‘qildi');
            } else {
              await NfcManager.instance.stopSession(errorMessageIos: 'Belgida transport ma’lumoti yo‘q');
            }
          } catch (_) {}
          finish(value != null
              ? {'success': true, 'card_id': value, 'read_at': DateTime.now().toUtc().toIso8601String()}
              : {'success': false, 'error': 'NFC belgisida transport ma’lumoti topilmadi'});
        },
      );
      return await completer.future.timeout(timeout, onTimeout: () async {
        try {
          await NfcManager.instance.stopSession(errorMessageIos: 'Vaqt tugadi');
        } catch (_) {}
        return {'success': false, 'error': 'NFC belgisi topilmadi (vaqt tugadi). Qayta urinib ko‘ring.'};
      });
    } catch (e) {
      debugPrint('[NFC] Session error: $e');
      return {'success': false, 'error': 'NFC o‘qishda xatolik'};
    } finally {
      _busy = false;
    }
  }

  /// NDEF text/URI record first, otherwise the chip UID as colon-separated hex (Web NFC format).
  static String? extractIdentifier(NfcTag tag) {
    NdefMessage? message;
    Uint8List? uid;
    if (Platform.isAndroid) {
      message = NdefAndroid.from(tag)?.cachedNdefMessage;
      uid = NfcTagAndroid.from(tag)?.id;
    } else if (Platform.isIOS) {
      message = NdefIos.from(tag)?.cachedNdefMessage;
      uid = MiFareIos.from(tag)?.identifier ?? Iso15693Ios.from(tag)?.identifier ?? Iso7816Ios.from(tag)?.identifier;
    }
    for (final record in message?.records ?? const <NdefRecord>[]) {
      final text = decodeRecord(record);
      if (text != null && text.trim().isNotEmpty) return text.trim();
    }
    if (uid != null && uid.isNotEmpty) return formatUid(uid);
    return null;
  }

  static String formatUid(List<int> bytes) =>
      bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join(':');

  static const List<String> _uriPrefixes = [
    '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:',
    'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://',
    'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://',
    'btl2cap://', 'btgoep://', 'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:',
    'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
  ];

  /// Decodes NFC Forum well-known Text ("T") and URI ("U") records.
  static String? decodeRecord(NdefRecord record) {
    if (record.typeNameFormat != TypeNameFormat.wellKnown || record.type.length != 1 || record.payload.isEmpty) {
      return null;
    }
    final payload = record.payload;
    final type = String.fromCharCode(record.type.first);
    if (type == 'T') {
      final status = payload.first;
      final langLength = status & 0x3f;
      final isUtf16 = (status & 0x80) != 0;
      if (payload.length <= 1 + langLength) return null;
      final body = payload.sublist(1 + langLength);
      if (isUtf16) {
        final units = <int>[];
        for (var i = 0; i + 1 < body.length; i += 2) {
          units.add((body[i] << 8) | body[i + 1]);
        }
        return String.fromCharCodes(units);
      }
      return utf8.decode(body, allowMalformed: true);
    }
    if (type == 'U') {
      final code = payload.first;
      final prefix = code < _uriPrefixes.length ? _uriPrefixes[code] : '';
      return prefix + utf8.decode(payload.sublist(1), allowMalformed: true);
    }
    return null;
  }
}
