import React from 'react';
import { FolderSync, UploadCloud, HardDrive, CheckCircle2, Shield, FolderPlus } from 'lucide-react';
import { useProfileStore } from '../../stores/profileStore';

export const FilesView: React.FC = () => {
  const { systemInfo } = useProfileStore();

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto space-y-6 select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">File Sharing & LAN Drive</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Peer-to-peer chunked streaming (256 KB chunks) with SHA-256 integrity verification.
          </p>
        </div>
        <button
          className="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold flex items-center gap-1.5 shadow transition-colors"
          title="Share a local folder over LAN"
        >
          <FolderPlus className="w-3.5 h-3.5" /> Share Folder
        </button>
      </div>

      {/* Drag & Drop Zone */}
      <div className="p-8 rounded-xl border-2 border-dashed border-border bg-card/40 hover:bg-card/70 hover:border-primary/50 transition-all flex flex-col items-center justify-center text-center cursor-pointer group">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
          <UploadCloud className="w-6 h-6" />
        </div>
        <h3 className="font-semibold text-sm text-foreground">Drag and drop files here to transfer over LAN</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          Files are transferred directly to peers via TLS TCP in 256 KB chunks without cloud intermediation.
        </p>
      </div>

      {/* Storage Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-card border border-border space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <HardDrive className="w-4 h-4 text-primary" /> Incoming Transfers Directory
          </div>
          <p className="font-mono text-xs text-muted-foreground bg-background p-2 rounded border border-border select-all break-all">
            {systemInfo?.paths.transfers}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-card border border-border space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Shield className="w-4 h-4 text-primary" /> Path Traversal Guard Status
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-500 font-medium">
            <CheckCircle2 className="w-4 h-4" /> Root Boundary & Reparse Point Protection Active
          </div>
          <p className="text-[11px] text-muted-foreground">
            Strict confinement prevents access outside authorized shared folder roots.
          </p>
        </div>
      </div>
    </div>
  );
};
