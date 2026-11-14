import React, { useCallback, useEffect, useState } from 'react';
import { Mic, Camera, ShieldCheck, Loader2, Settings2, CheckCircle2, XCircle } from 'lucide-react';
import type { MediaAccessStatus } from '@ipm/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { describeMediaError } from '../../services/webrtcService';

const STORAGE_KEY = 'arcwire.mediaPermission.v1';

type DeviceResult = 'unknown' | 'granted' | 'denied' | 'missing';

const readFlag = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeFlag = (value: string) => {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage unavailable — prompt may show again next launch
  }
};

/** Probes one device kind by actually requesting it (this is what triggers the OS prompt). */
async function probe(kind: 'audio' | 'video'): Promise<{ result: DeviceResult; error?: string }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: true } : { video: true });
    stream.getTracks().forEach((t) => t.stop());
    return { result: 'granted' };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return { result: 'missing' };
    return { result: 'denied', error: describeMediaError(err, kind === 'audio' ? 'microphone' : 'camera') };
  }
}

interface MediaPermissionPromptProps {
  /** Open on demand (e.g. from Settings) regardless of the first-run flag */
  forceOpen?: boolean;
  onClose?: () => void;
}

export const MediaPermissionPrompt: React.FC<MediaPermissionPromptProps> = ({ forceOpen, onClose }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState<DeviceResult>('unknown');
  const [cam, setCam] = useState<DeviceResult>('unknown');
  const [error, setError] = useState<string | null>(null);

  const refreshFromSystem = useCallback(async () => {
    try {
      const status: MediaAccessStatus | undefined = await window.api?.getMediaAccessStatus?.();
      if (!status) return;
      if (status.microphone === 'granted') setMic((m) => (m === 'unknown' ? 'granted' : m));
      if (status.microphone === 'denied') setMic('denied');
      if (status.camera === 'granted') setCam((c) => (c === 'unknown' ? 'granted' : c));
      if (status.camera === 'denied') setCam('denied');
      return status;
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      void refreshFromSystem();
      return;
    }
    if (readFlag()) return;
    // First run: show the prompt shortly after the main UI appears
    const t = setTimeout(async () => {
      const status = await refreshFromSystem();
      if (status?.microphone === 'granted' && status?.camera === 'granted') {
        writeFlag('granted');
        return;
      }
      setOpen(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [forceOpen, refreshFromSystem]);

  const close = (flag: string) => {
    writeFlag(flag);
    setOpen(false);
    onClose?.();
  };

  const requestAccess = async () => {
    setBusy(true);
    setError(null);
    const micRes = await probe('audio');
    const camRes = await probe('video');
    setMic(micRes.result);
    setCam(camRes.result);
    setBusy(false);

    const err = micRes.error ?? camRes.error ?? null;
    setError(err);
    if (!err) {
      setTimeout(() => close('granted'), 700);
    }
  };

  const Row: React.FC<{ icon: React.ElementType; label: string; state: DeviceResult; kind: 'microphone' | 'camera' }> = ({
    icon: Icon,
    label,
    state,
    kind,
  }) => (
    <div className="flex items-center gap-3 rounded-md border border-border p-2.5">
      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">
          {state === 'granted'
            ? 'Allowed'
            : state === 'denied'
            ? 'Blocked by Windows'
            : state === 'missing'
            ? 'No device found'
            : 'Not requested yet'}
        </p>
      </div>
      {state === 'granted' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
      {state === 'denied' && (
        <button
          onClick={() => window.api?.openPrivacySettings?.(kind)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
        >
          <Settings2 className="w-3 h-3" /> Settings
        </button>
      )}
      {state === 'missing' && <XCircle className="w-4 h-4 text-muted-foreground" />}
    </div>
  );

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && close('dismissed')}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Allow microphone and camera
          </AlertDialogTitle>
          <AlertDialogDescription>
            Arcwire needs your microphone for voice calls and your camera for video calls. Media stays on your local
            network and is never sent to the internet.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Row icon={Mic} label="Microphone" state={mic} kind="microphone" />
          <Row icon={Camera} label="Camera" state={cam} kind="camera" />
        </div>

        {error && <p className="text-[11px] text-destructive leading-snug">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close('dismissed')}>Not now</AlertDialogCancel>
          <Button onClick={requestAccess} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {mic === 'unknown' && cam === 'unknown' ? 'Allow access' : 'Try again'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
