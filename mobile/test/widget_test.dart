import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mashrutgo_mobile/config/app_config.dart';
import 'package:mashrutgo_mobile/services/nfc_bridge.dart';
import 'package:nfc_manager/ndef_record.dart';

NdefRecord _wellKnown(String type, List<int> payload) => NdefRecord(
      typeNameFormat: TypeNameFormat.wellKnown,
      type: Uint8List.fromList(type.codeUnits),
      identifier: Uint8List(0),
      payload: Uint8List.fromList(payload),
    );

void main() {
  group('external links policy', () {
    test('dialer, mail, messengers and payment sites open outside the WebView', () {
      expect(AppConfig.isExternalLink(Uri.parse('tel:+998901234567')), isTrue);
      expect(AppConfig.isExternalLink(Uri.parse('https://t.me/mashrutgo')), isTrue);
      expect(AppConfig.isExternalLink(Uri.parse('https://my.click.uz/services/pay?x=1')), isTrue);
      expect(AppConfig.isExternalLink(Uri.parse('https://example.com/page')), isTrue);
    });

    test('pages of the web app stay inside', () {
      expect(AppConfig.isExternalLink(Uri.parse('${AppConfig.initialWebUrl}/driver/payments')), isFalse);
      expect(AppConfig.isTrustedPage('${AppConfig.initialWebUrl}/wallet'), isTrue);
      expect(AppConfig.isTrustedPage('https://evil.example/wallet'), isFalse);
    });
  });

  group('deep links', () {
    test('notification routes are in-app paths only', () {
      expect(AppConfig.routeFromDeepLink('/driver/payments'), '/driver/payments');
      expect(AppConfig.routeFromDeepLink('mashrutgo://route?path=/wallet'), '/wallet');
      expect(AppConfig.routeFromDeepLink('mashrutgo://driver/payments'), '/driver/payments');
      expect(AppConfig.routeFromDeepLink('${AppConfig.initialWebUrl}/pay?v=AND01-V0001'), '/pay?v=AND01-V0001');
      expect(AppConfig.routeFromDeepLink('//evil.example'), isNull);
      expect(AppConfig.routeFromDeepLink('https://evil.example/x'), isNull);
      expect(AppConfig.routeFromDeepLink(''), isNull);
    });
  });

  group('NFC sticker decoding', () {
    test('reads an NDEF text record (vehicle internal id)', () {
      final record = _wellKnown('T', [0x02, ...'en'.codeUnits, ...utf8.encode('AND01-V0001')]);
      expect(NfcBridge.decodeRecord(record), 'AND01-V0001');
    });

    test('reads an NDEF URI record with a prefix code', () {
      final record = _wellKnown('U', [0x04, ...utf8.encode('app.mashrutgo.uz/pay?v=AND01-V0002')]);
      expect(NfcBridge.decodeRecord(record), 'https://app.mashrutgo.uz/pay?v=AND01-V0002');
    });

    test('formats chip UIDs like Web NFC so both readers match the same vehicle', () {
      expect(NfcBridge.formatUid([0x04, 0xa2, 0x3b, 0x0c]), '04:a2:3b:0c');
    });
  });
}
