import type { FileAttachmentMeta, MessageItem } from '@ipm/shared';

export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'] as const;

export function parseFileMeta(message: Pick<MessageItem, 'content' | 'contentType'>): FileAttachmentMeta | null {
  if (message.contentType !== 'file') return null;
  try {
    const meta = JSON.parse(message.content) as FileAttachmentMeta;
    if (!meta || typeof meta.fileName !== 'string') return null;
    return { ...meta, transferIds: meta.transferIds ?? {} };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function isImageFile(name: string, mime?: string): boolean {
  return (mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

export function isVideoFile(name: string, mime?: string): boolean {
  return (mime ?? '').startsWith('video/') || /\.(mp4|webm|mov)$/i.test(name);
}

/** Text used when copying / quoting a message. */
export function messagePlainText(message: MessageItem): string {
  if (message.isDeleted) return '';
  const meta = parseFileMeta(message);
  if (meta) return meta.caption ? `${meta.fileName} — ${meta.caption}` : meta.fileName;
  return message.content;
}

export function formatMessageTime(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDayLabel(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (same(date, today)) return 'Today';
  if (same(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** Reads clipboard / drop `File` objects into the shape the store sends. */
export async function filesToUploads(
  files: File[],
  getPath: (file: File) => string
): Promise<Array<{ path?: string; name: string; type?: string; data?: Uint8Array }>> {
  const out: Array<{ path?: string; name: string; type?: string; data?: Uint8Array }> = [];
  for (const file of files) {
    const path = getPath(file);
    if (path) {
      out.push({ path, name: file.name, type: file.type });
    } else {
      // In-memory data (e.g. a screenshot pasted from the clipboard)
      const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
      const name =
        file.name && file.name !== 'image.png'
          ? file.name
          : `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
      out.push({ name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) });
    }
  }
  return out;
}
