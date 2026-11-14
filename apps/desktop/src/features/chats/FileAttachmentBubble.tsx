import React, { useState } from 'react';
import {
  FileText,
  FileArchive,
  FileImage,
  FileVideo,
  FileAudio,
  Download,
  X,
  Pause,
  Play,
  FolderOpen,
  ExternalLink,
  AlertCircle,
  Check,
  Loader2,
} from 'lucide-react';
import type { FileAttachmentMeta, TransferItem } from '@ipm/shared';
import { useTransferStore } from '../../stores/transferStore';
import { formatBytes, isImageFile, isVideoFile } from '@/lib/messageUtils';
import { cn } from '@/lib/utils';

interface FileAttachmentBubbleProps {
  meta: FileAttachmentMeta;
  isMe: boolean;
  localDeviceId: string;
}

const iconFor = (name: string, mime: string) => {
  if (isImageFile(name, mime)) return FileImage;
  if (isVideoFile(name, mime)) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return FileArchive;
  return FileText;
};

const formatSpeed = (bps: number) => (bps > 0 ? `${formatBytes(bps)}/s` : '');

export const FileAttachmentBubble: React.FC<FileAttachmentBubbleProps> = ({ meta, isMe, localDeviceId }) => {
  const { transfers, progressMap, acceptTransfer, rejectTransfer, pauseTransfer, resumeTransfer, cancelTransfer, openFile, openFolder } =
    useTransferStore();
  const [previewFailed, setPreviewFailed] = useState(false);

  // Outgoing: one transfer per recipient — show the most advanced one. Incoming: ours.
  const relevantIds = isMe ? Object.values(meta.transferIds) : [meta.transferIds[localDeviceId]].filter(Boolean);
  const related = relevantIds
    .map((id) => transfers.find((t) => t.id === id))
    .filter((t): t is TransferItem => Boolean(t));
  const rank: Record<string, number> = { completed: 6, transferring: 5, accepted: 4, paused: 3, offered: 2, queued: 2, rejected: 1, cancelled: 1, failed: 0 };
  const transfer = related.sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0))[0];
  const recipients = Object.keys(meta.transferIds).length;
  const completedCount = related.filter((t) => t.status === 'completed').length;

  const progress = transfer ? progressMap[transfer.id] : undefined;
  const bytes = progress?.bytesTransferred ?? transfer?.bytesTransferred ?? 0;
  const pct = meta.fileSize > 0 ? Math.min(100, Math.round((bytes / meta.fileSize) * 100)) : transfer?.status === 'completed' ? 100 : 0;

  const status = transfer?.status;
  const isImage = isImageFile(meta.fileName, meta.mimeType);
  const canPreview =
    isImage && !previewFailed && transfer && (transfer.direction === 'outgoing' || transfer.status === 'completed');
  const Icon = iconFor(meta.fileName, meta.mimeType);
  const filePath = transfer?.finalPath ?? undefined;

  const statusText = (() => {
    if (!transfer) return isMe ? 'Preparing…' : 'Waiting for the file offer…';
    switch (status) {
      case 'offered':
        return isMe ? 'Waiting for recipient to accept' : 'Tap download to receive';
      case 'accepted':
      case 'queued':
        return 'Starting…';
      case 'transferring':
        return `${pct}% · ${formatBytes(bytes)} of ${formatBytes(meta.fileSize)} ${formatSpeed(progress?.speed ?? 0)}`.trim();
      case 'paused':
        return `Paused at ${pct}%`;
      case 'completed':
        return isMe
          ? recipients > 1
            ? `Delivered to ${completedCount}/${recipients}`
            : 'Delivered'
          : 'Downloaded';
      case 'rejected':
        return isMe ? 'Declined by recipient' : 'Declined';
      case 'cancelled':
        return 'Cancelled';
      case 'failed':
        return transfer.errorMessage ? `Failed: ${transfer.errorMessage}` : 'Failed';
      default:
        return status ?? '';
    }
  })();

  const iconBtn = cn(
    'p-1.5 rounded-lg transition-colors',
    isMe ? 'hover:bg-white/15 text-primary-foreground' : 'hover:bg-muted text-foreground'
  );

  return (
    <div className="w-[260px] max-w-full space-y-1.5">
      {canPreview && (
        <button
          type="button"
          onClick={() => filePath && openFile(filePath)}
          className="block w-full overflow-hidden rounded-xl bg-black/10"
          title="Open image"
        >
          <img
            src={`arcwire-media://${transfer!.id}/`}
            alt={meta.fileName}
            onError={() => setPreviewFailed(true)}
            className="w-full max-h-64 object-cover"
            draggable={false}
          />
        </button>
      )}

      <div
        className={cn(
          'flex items-center gap-2.5 rounded-xl p-2',
          isMe ? 'bg-black/10' : 'bg-muted/70'
        )}
      >
        <div
          className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            isMe ? 'bg-white/15' : 'bg-primary/10 text-primary'
          )}
        >
          {status === 'transferring' || status === 'accepted' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : status === 'failed' || status === 'rejected' ? (
            <AlertCircle className="w-4 h-4" />
          ) : (
            <Icon className="w-4 h-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate" title={meta.fileName}>
            {meta.fileName}
          </p>
          <p className={cn('text-[10px] truncate', isMe ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
            {formatBytes(meta.fileSize)} · {statusText}
          </p>
        </div>

        <div className="flex items-center shrink-0">
          {!isMe && status === 'offered' && transfer && (
            <>
              <button className={iconBtn} title="Download" onClick={() => acceptTransfer(transfer.id)}>
                <Download className="w-4 h-4" />
              </button>
              <button className={iconBtn} title="Decline" onClick={() => rejectTransfer(transfer.id)}>
                <X className="w-4 h-4" />
              </button>
            </>
          )}
          {transfer && status === 'transferring' && (
            <button className={iconBtn} title="Pause" onClick={() => pauseTransfer(transfer.id)}>
              <Pause className="w-4 h-4" />
            </button>
          )}
          {transfer && status === 'paused' && (
            <button className={iconBtn} title="Resume" onClick={() => resumeTransfer(transfer.id)}>
              <Play className="w-4 h-4" />
            </button>
          )}
          {transfer && (status === 'transferring' || status === 'paused' || (isMe && status === 'offered')) && (
            <button className={iconBtn} title="Cancel" onClick={() => cancelTransfer(transfer.id)}>
              <X className="w-4 h-4" />
            </button>
          )}
          {status === 'completed' && filePath && (
            <>
              <button className={iconBtn} title="Open" onClick={() => openFile(filePath)}>
                <ExternalLink className="w-4 h-4" />
              </button>
              <button className={iconBtn} title="Show in folder" onClick={() => openFolder(filePath)}>
                <FolderOpen className="w-4 h-4" />
              </button>
            </>
          )}
          {status === 'completed' && !filePath && <Check className="w-4 h-4" />}
        </div>
      </div>

      {(status === 'transferring' || status === 'paused') && (
        <div className={cn('h-1 w-full rounded-full overflow-hidden', isMe ? 'bg-white/20' : 'bg-muted')}>
          <div
            className={cn(
              'h-full w-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-300',
              isMe ? 'bg-primary-foreground' : 'bg-primary'
            )}
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </div>
      )}

      {meta.caption && <p className="whitespace-pre-wrap break-words leading-relaxed text-xs pt-0.5">{meta.caption}</p>}
    </div>
  );
};
