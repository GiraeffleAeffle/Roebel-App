/**
 * QR Scanner Component
 *
 * Camera-based QR code scanner for verification requests
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import ErrorDrawer from './ErrorDrawer';

// Module-level constant so CameraView doesn't see a new object on every
// render — a fresh prop identity can stall barcode detection on some devices.
const BARCODE_SCANNER_SETTINGS = { barcodeTypes: ['qr'] as const };

export type QRScanResult = {
  type: 'verification' | 'checkpoint' | 'stamp' | 'order' | 'roebel_card' | 'event' | 'unknown';
  data: string;
  id?: string;
  nftType?: string;
  slug?: string;
  tableNumber?: string;
  /** Röbel Card payload version ('v1' = unsigned, 'v2' = HMAC signed). */
  cardVersion?: string;
  /** Full v2 payload string (unchanged) to hand to create_roebel_card_charge_from_qr. */
  cardPayload?: string;
};

interface QRScannerProps {
  onScan?: (result: QRScanResult) => void;
  /** Restrict to specific QR types. If omitted, all types are handled. */
  allowedTypes?: QRScanResult['type'][];
}

function parseQRCode(data: string): QRScanResult {
  // Verification: hometownevents://verification/request/{id}?type=citizen
  const verificationMatch = data.match(/(?:hometownevents|roebel):\/\/verification\/request\/(\d+)\?type=(\w+)/);
  if (verificationMatch) {
    return { type: 'verification', data, id: verificationMatch[1], nftType: verificationMatch[2] };
  }

  // Explorer checkpoint: roebel-checkpoint:<qr_code>
  if (data.startsWith('roebel-checkpoint:')) {
    return { type: 'checkpoint', data, id: data.replace('roebel-checkpoint:', '') };
  }

  // Stamp card: roebel-stamp:<partner_id>
  if (data.startsWith('roebel-stamp:')) {
    return { type: 'stamp', data, id: data.replace('roebel-stamp:', '') };
  }

  // Röbel Card v2 (HMAC-signed): roebel-card:v2:<card_id>:<expires_unix>:<hex_hmac>
  // The full payload is passed through to create_roebel_card_charge_from_qr
  // where the server verifies the HMAC against the card's qr_secret.
  const cardV2Match = data.match(
    /^roebel-card:v2:([0-9a-f-]{36}):(\d+):([0-9a-f]{64})$/i,
  );
  if (cardV2Match) {
    return {
      type: 'roebel_card',
      data,
      cardVersion: 'v2',
      id: cardV2Match[1],
      cardPayload: data,
    };
  }

  // Röbel Card v1 (legacy unsigned): roebel-card:v1:<card_id>
  // Still parsed for backward compat during the v1 → v2 transition, but
  // the RPC will refuse to create a charge from a v1 payload since it
  // doesn't match the expected 5-part format.
  const cardV1Match = data.match(/^roebel-card:v1:([0-9a-f-]{36})$/i);
  if (cardV1Match) {
    return {
      type: 'roebel_card',
      data,
      cardVersion: 'v1',
      id: cardV1Match[1],
      cardPayload: data,
    };
  }

  // Smart Event QR: https://www.roebel.app/e/<eventId> OR the custom-scheme
  // deep-link form roebel://e/<eventId> (e.g. when a web landing hands off).
  const eventMatch = data.match(/(?:roebel\.app\/e\/|roebel:\/\/e\/)([0-9a-f-]{36})/i);
  if (eventMatch) {
    return { type: 'event', data, id: eventMatch[1] };
  }

  // Restaurant order: https://roebel.app/order/{slug}/{tableNumber}
  const orderMatch = data.match(/roebel\.app\/order\/([^/]+)\/([^/?#]+)/);
  if (orderMatch) {
    return { type: 'order', data, slug: orderMatch[1], tableNumber: decodeURIComponent(orderMatch[2]) };
  }

  return { type: 'unknown', data };
}

export default function QRScanner({ onScan, allowedTypes }: QRScannerProps) {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [errorDrawer, setErrorDrawer] = useState({ visible: false, message: '' });
  // Bumping this on each focus forces CameraView to remount — a documented
  // workaround for Android where `onBarcodeScanned` silently stops firing
  // after the screen has been left and re-entered, even after the camera UI
  // appears to render normally again.
  const [cameraKey, setCameraKey] = useState(0);
  // Diagnostic counters — surfaced in a small HUD over the camera so we can
  // tell remotely whether the barcode callback is firing on the user's
  // device at all. Remove once verification scanning is confirmed working.
  const [diag, setDiag] = useState({
    ready: false,
    mountErr: '' as string,
    events: 0,
    lastData: '' as string,
  });

  useFocusEffect(
    useCallback(() => {
      setScanned(false);
      setCameraKey((k) => k + 1);
    }, []),
  );

  const handleBarCodeScanned = useCallback(({ data }: { type: string; data: string }) => {
    setDiag((d) => ({ ...d, events: d.events + 1, lastData: data.slice(0, 60) }));
    if (scanned) return;
    setScanned(true);

    const result = parseQRCode(data);

    // Check if this type is allowed
    if (allowedTypes && !allowedTypes.includes(result.type)) {
      const typeLabels: Record<string, string> = {
        verification: 'Verifizierung',
        checkpoint: 'Explorer-Checkpoint',
        stamp: 'Stempelkarte',
        order: 'Bestellung',
        roebel_card: 'Röbel Card',
        event: 'Event',
      };
      const expected = allowedTypes.map(t => typeLabels[t] || t).join(' oder ');
      setErrorDrawer({
        visible: true,
        message: `Dieser QR-Code ist kein ${expected}-Code.`,
      });
      setScanned(false);
      return;
    }

    if (result.type === 'unknown') {
      setErrorDrawer({
        visible: true,
        message: 'Dieser QR-Code wird nicht erkannt.',
      });
      setScanned(false);
      return;
    }

    // Recognized + allowed QR code — successful scan, once per scan (guarded
    // by the `scanned` early-return above and the unknown/allowedTypes checks
    // above, which reset `scanned` back to false on a rejected code).
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    if (onScan) {
      onScan(result);
      return;
    }

    // Default navigation based on type
    if (result.type === 'order' && result.slug && result.tableNumber) {
      router.push(`/order/${result.slug}/${result.tableNumber}` as any);
      return;
    } else if (result.type === 'verification' && result.id) {
      router.push({
        pathname: '/verification/request/[id]',
        params: { id: result.id, type: result.nftType ?? 'citizen' },
      });
      return;
    } else if (result.type === 'event' && result.id) {
      router.push(`/e/${result.id}` as any);
      return;
    } else if (result.type === 'checkpoint') {
      // Handled by parent via onScan
      setScanned(false);
    } else if (result.type === 'stamp') {
      // Handled by parent via onScan
      setScanned(false);
    }
  }, [scanned, allowedTypes, onScan, router]);

  // No automatic error drawer for camera permission
  // The UI already shows a message and button to request permission

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Lade Kamera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Kamera-Berechtigung erforderlich</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Berechtigung erteilen</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        key={cameraKey}
        style={styles.camera}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={BARCODE_SCANNER_SETTINGS}
        onCameraReady={() => setDiag((d) => ({ ...d, ready: true }))}
        onMountError={(e) =>
          setDiag((d) => ({ ...d, mountErr: String(e?.message ?? e) }))
        }
      >
        {/* Diagnostic HUD — temporary, remove once verification scanning is confirmed working */}
        <View style={styles.diagHud} pointerEvents="none">
          <Text style={styles.diagText}>
            {`ready=${diag.ready ? '1' : '0'}  err=${diag.mountErr || '–'}  events=${diag.events}`}
          </Text>
          {diag.lastData ? (
            <Text style={styles.diagText} numberOfLines={2}>
              {`last: ${diag.lastData}`}
            </Text>
          ) : null}
        </View>

        {/* Overlay */}
        <View style={styles.overlay}>
          {/* Top overlay */}
          <View style={styles.overlayTop} />

          {/* Middle section with scanning frame */}
          <View style={styles.overlayMiddle}>
            <View style={styles.overlaySide} />
            <View style={styles.scanFrame}>
              {/* Corner indicators */}
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <View style={styles.overlaySide} />
          </View>

          {/* Bottom overlay with instructions */}
          <View style={styles.overlayBottom}>
            <Text style={styles.instructionText}>
              QR-Code in den Rahmen positionieren
            </Text>
            {scanned && (
              <Pressable
                style={styles.scanAgainButton}
                onPress={() => setScanned(false)}
              >
                <Text style={styles.scanAgainButtonText}>Erneut scannen</Text>
              </Pressable>
            )}
          </View>
        </View>
      </CameraView>

      {/* Error Drawer */}
      <ErrorDrawer
        visible={errorDrawer.visible}
        message={errorDrawer.message}
        onDismiss={() => setErrorDrawer({ visible: false, message: '' })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  diagHud: {
    position: 'absolute',
    top: 70,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 20,
  },
  diagText: {
    color: '#ffffff',
    fontSize: 11,
    fontFamily: 'Inter-Regular',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayMiddle: {
    flexDirection: 'row',
    height: 250,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  scanFrame: {
    width: 250,
    height: 250,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#ffffff',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  instructionText: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 16,
  },
  scanAgainButton: {
    backgroundColor: '#00498B',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  scanAgainButtonText: {
    fontSize: 15,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    color: '#ffffff',
  },
  message: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: '#ffffff',
    textAlign: 'center',
    padding: 32,
  },
  button: {
    backgroundColor: '#00498B',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginHorizontal: 32,
  },
  buttonText: {
    fontSize: 15,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    color: '#ffffff',
    textAlign: 'center',
  },
});
