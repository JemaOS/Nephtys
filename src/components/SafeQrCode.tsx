// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

import { Component, type ReactNode } from 'react';
import QRCode from 'react-qr-code';

interface SafeQrCodeProps {
  value: string;
  size: number;
}

interface SafeQrCodeState {
  failed: boolean;
}

/**
 * Rend un QR code en **isolant l'échec** : si la donnée dépasse la capacité du
 * QR (ex. invitation SMP trop longue), on affiche un message au lieu de faire
 * planter toute la page (comme le faisait le `QRCode` nu).
 */
export class SafeQrCode extends Component<SafeQrCodeProps, SafeQrCodeState> {
  state: SafeQrCodeState = { failed: false };

  static getDerivedStateFromError(): SafeQrCodeState {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <p className="text-[11px] text-text-tertiary text-center">
          Invitation trop longue pour un QR code — partagez le <b>lien</b> ci-dessous.
        </p>
      );
    }
    return (
      <div className="bg-white p-3 rounded-xl">
        <QRCode value={this.props.value} size={this.props.size} />
      </div>
    );
  }
}
