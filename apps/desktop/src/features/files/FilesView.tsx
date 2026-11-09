import React, { useState, useEffect } from 'react';
import {
  UploadCloud,
  HardDrive,
  CheckCircle2,
  Shield,
  FolderPlus,
  ArrowDownLeft,
  ArrowUpRight,
  Pause,
  Play,
  X,
  Folder,
  File,
  RefreshCw,
  FolderOpen,
  Trash2,
  Edit2,
  Check,
  ChevronRight,
  Download,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import { useProfileStore } from '../../stores/profileStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { useTransferStore } from '../../stores/transferStore';
import { useSharedFolderStore } from '../../stores/sharedFolderStore';
import { FolderPermission, TransferItem, RemoteFolderItem } from '@ipm/shared';

export const FilesView: React.FC = () => {
  const { systemInfo } = useProfileStore();
  const { devices, fetchDevices } = useDeviceStore();

  const {
    transfers,
    incomingOffers,
    progressMap,
    fetchTransfers,
    acceptTransfer,
    rejectTransfer,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    openFolder,
    selectAndSendFile,
    initListeners: initTransferListeners,
  } = useTransferStore();

  const {
    sharedFolders,
    remoteBrowseItems,
    remoteCurrentPath,
    remoteEffectivePermission,
    activeRemoteDeviceId,
    pathBreadcrumbs,
    fetchSharedFolders,
    createSharedFolder,
    selectDirectory,
    deleteSharedFolder,
    browseRemote,
    navigateRemoteBreadcrumb,
    createRemoteDir,
    deleteRemoteItem,
    renameRemoteItem,
  } = useSharedFolderStore();

  const [activeTab, setActiveTab] = useState<'transfers' | 'folders'>('transfers');

  // Send File Modal / State
  const [selectedPeerId, setSelectedPeerId] = useState<string>('');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [newShareName, setNewShareName] = useState('');
  const [newSharePath, setNewSharePath] = useState('');
  const [newSharePermission, setNewSharePermission] = useState<FolderPermission>('read_only');

  // Remote Browse State
  const [browsePeerId, setBrowsePeerId] = useState<string>('');
  const [browseFolderId, setBrowseFolderId] = useState<string>('');
  const [isNewDirModalOpen, setIsNewDirModalOpen] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [renamingItem, setRenamingItem] = useState<{ path: string; name: string } | null>(null);
  const [renameNewName, setRenameNewName] = useState('');

  useEffect(() => {
    fetchDevices();
    fetchSharedFolders();
    const unsub = initTransferListeners();
    return () => {
      unsub();
    };
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSec?: number): string => {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
    return `${formatBytes(bytesPerSec)}/s`;
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds || seconds <= 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const handleSelectFolderForShare = async () => {
    const path = await selectDirectory();
    if (path) {
      setNewSharePath(path);
      if (!newShareName) {
        const parts = path.split(/[/\\]/);
        setNewShareName(parts[parts.length - 1] || 'SharedFolder');
      }
    }
  };

  const handleCreateShareSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShareName || !newSharePath) return;

    await createSharedFolder({
      name: newShareName,
      localPath: newSharePath,
      defaultPermission: newSharePermission,
    });

    setIsShareModalOpen(false);
    setNewShareName('');
    setNewSharePath('');
    setNewSharePermission('read_only');
  };

  const handleStartSendFile = async () => {
    if (!selectedPeerId) return;
    await selectAndSendFile('global', selectedPeerId);
  };

  const handleRemoteBrowseStart = async () => {
    if (!browsePeerId || !browseFolderId) return;
    await browseRemote(browsePeerId, browseFolderId, '');
  };

  const activeTransfers = transfers.filter((t) =>
    ['queued', 'transferring', 'paused', 'accepted'].includes(t.status)
  );

  const transferHistory = transfers.filter((t) =>
    ['completed', 'failed', 'cancelled', 'rejected'].includes(t.status)
  );

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto space-y-6 select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">File Sharing & LAN Drive</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            256 KB chunked streaming, SHA-256 verification, and controlled LAN folder sharing.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border">
          <button
            onClick={() => setActiveTab('transfers')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'transfers'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            File Transfers
            {activeTransfers.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                {activeTransfers.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('folders')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'folders'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            LAN Shared Folders
            {sharedFolders.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-muted-foreground/30 text-foreground text-[10px] flex items-center justify-center font-bold">
                {sharedFolders.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* TAB 1: FILE TRANSFERS                                    */}
      {/* ======================================================== */}
      {activeTab === 'transfers' && (
        <div className="space-y-6">
          {/* Incoming Offers Alert */}
          {incomingOffers.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-medium text-amber-500 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> Incoming File Transfer Requests ({incomingOffers.length})
              </h2>
              {incomingOffers.map((offer) => (
                <div
                  key={offer.id}
                  className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <File className="w-4 h-4 text-amber-500" />
                      <span className="font-semibold text-sm text-foreground">{offer.fileName}</span>
                      <span className="text-xs text-muted-foreground">({formatBytes(offer.fileSize)})</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      From Device ID: <span className="font-mono">{offer.remoteDeviceId}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => acceptTransfer(offer.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" /> Accept
                    </button>
                    <button
                      onClick={() => rejectTransfer(offer.id)}
                      className="px-3 py-1.5 rounded-lg bg-destructive/80 hover:bg-destructive text-destructive-foreground text-xs font-semibold shadow transition-colors flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick Send File Bar */}
          <div className="p-4 rounded-xl border border-border bg-card flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <UploadCloud className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">Send File to LAN Peer</h3>
                <p className="text-xs text-muted-foreground">
                  Select a discovered peer device and choose file(s) to transfer.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full md:w-auto">
              <select
                value={selectedPeerId}
                onChange={(e) => setSelectedPeerId(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-[200px]"
              >
                <option value="">Select Target Peer...</option>
                {devices
                  .filter((d) => d.status === 'online')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.displayName} ({d.ipAddress})
                    </option>
                  ))}
              </select>

              <button
                disabled={!selectedPeerId}
                onClick={handleStartSendFile}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold flex items-center gap-1.5 shadow transition-colors shrink-0"
              >
                <File className="w-3.5 h-3.5" /> Choose & Send
              </button>
            </div>
          </div>

          {/* Active Transfers Section */}
          <div className="space-y-3">
            <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Active Transfers ({activeTransfers.length})
            </h2>

            {activeTransfers.length === 0 ? (
              <div className="p-8 rounded-xl border border-dashed border-border bg-card/30 text-center">
                <p className="text-xs text-muted-foreground">No active file transfers at the moment.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {activeTransfers.map((item) => {
                  const progress = progressMap[item.id];
                  const bytesTransferred = progress?.bytesTransferred ?? item.bytesTransferred;
                  const totalBytes = item.fileSize;
                  const percentage = totalBytes > 0 ? Math.min(100, Math.round((bytesTransferred / totalBytes) * 100)) : 0;
                  const speed = progress?.speed ?? 0;
                  const eta = progress?.remainingTime ?? 0;

                  return (
                    <div
                      key={item.id}
                      className="p-4 rounded-xl border border-border bg-card space-y-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            item.direction === 'outgoing'
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-emerald-500/10 text-emerald-500'
                          }`}>
                            {item.direction === 'outgoing' ? (
                              <ArrowUpRight className="w-4 h-4" />
                            ) : (
                              <ArrowDownLeft className="w-4 h-4" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-foreground">{item.fileName}</span>
                              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                                {item.direction}
                              </span>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                item.status === 'paused'
                                  ? 'bg-amber-500/20 text-amber-500'
                                  : 'bg-blue-500/20 text-blue-500'
                              }`}>
                                {item.status}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(bytesTransferred)} of {formatBytes(totalBytes)} • {percentage}%
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {item.status === 'paused' ? (
                            <button
                              onClick={() => resumeTransfer(item.id)}
                              className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs"
                              title="Resume Transfer"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => pauseTransfer(item.id)}
                              className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs"
                              title="Pause Transfer"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            onClick={() => cancelTransfer(item.id)}
                            className="p-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs"
                            title="Cancel Transfer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-primary h-1.5 rounded-full"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>

                      {/* Transfer Rate Metrics */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                        <span>Speed: {formatSpeed(speed)}</span>
                        <span>ETA: {formatDuration(eta)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Transfer History Table */}
          <div className="space-y-3">
            <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <FileCheck className="w-3.5 h-3.5" /> Transfer History ({transferHistory.length})
            </h2>

            {transferHistory.length === 0 ? (
              <div className="p-8 rounded-xl border border-dashed border-border bg-card/30 text-center">
                <p className="text-xs text-muted-foreground">No past transfer records found.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground">
                    <tr>
                      <th className="p-3 font-semibold">File Name</th>
                      <th className="p-3 font-semibold">Direction</th>
                      <th className="p-3 font-semibold">Size</th>
                      <th className="p-3 font-semibold">Status</th>
                      <th className="p-3 font-semibold">Date</th>
                      <th className="p-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {transferHistory.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-medium text-foreground max-w-xs truncate" title={item.fileName}>
                          {item.fileName}
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            item.direction === 'outgoing'
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-emerald-500/10 text-emerald-500'
                          }`}>
                            {item.direction === 'outgoing' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                            {item.direction}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground">{formatBytes(item.fileSize)}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize ${
                            item.status === 'completed'
                              ? 'bg-emerald-500/20 text-emerald-500'
                              : item.status === 'failed'
                              ? 'bg-destructive/20 text-destructive'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {new Date(item.updatedAt || item.createdAt).toLocaleString()}
                        </td>
                        <td className="p-3 text-right">
                          {item.finalPath && item.status === 'completed' && (
                            <button
                              onClick={() => openFolder(item.finalPath!)}
                              className="px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs inline-flex items-center gap-1"
                              title="Show in File Explorer"
                            >
                              <FolderOpen className="w-3.5 h-3.5" /> Show in Folder
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Directory & Security Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-card border border-border space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <HardDrive className="w-4 h-4 text-primary" /> Transfers Directory
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
      )}

      {/* ======================================================== */}
      {/* TAB 2: LAN SHARED FOLDERS                                */}
      {/* ======================================================== */}
      {activeTab === 'folders' && (
        <div className="space-y-8">
          {/* Section A: Local Shared Folders */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-foreground">My Shared Folders (This Computer)</h2>
                <p className="text-xs text-muted-foreground">
                  Folders shared with LAN peers like a controlled LAN network drive.
                </p>
              </div>
              <button
                onClick={() => setIsShareModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold flex items-center gap-1.5 shadow transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" /> Share Folder
              </button>
            </div>

            {sharedFolders.length === 0 ? (
              <div className="p-8 rounded-xl border border-dashed border-border bg-card/30 text-center">
                <p className="text-xs text-muted-foreground">You are not sharing any folders over LAN yet.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground">
                    <tr>
                      <th className="p-3 font-semibold">Share Name</th>
                      <th className="p-3 font-semibold">Local Path</th>
                      <th className="p-3 font-semibold">Default Permission</th>
                      <th className="p-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sharedFolders.map((f) => (
                      <tr key={f.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                          <Folder className="w-4 h-4 text-primary shrink-0" />
                          <span>{f.name}</span>
                        </td>
                        <td className="p-3 font-mono text-muted-foreground max-w-sm truncate" title={f.localPath}>
                          {f.localPath}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize ${
                            f.defaultPermission === 'full_control'
                              ? 'bg-purple-500/20 text-purple-500'
                              : f.defaultPermission === 'modify'
                              ? 'bg-blue-500/20 text-blue-500'
                              : f.defaultPermission === 'upload'
                              ? 'bg-emerald-500/20 text-emerald-500'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {f.defaultPermission.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => deleteSharedFolder(f.id)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            title="Unshare Folder"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section B: Remote LAN Folders Explorer */}
          <div className="space-y-4 pt-4 border-t border-border">
            <div>
              <h2 className="text-sm font-bold text-foreground">Remote LAN Folders (Network Computers)</h2>
              <p className="text-xs text-muted-foreground">
                Browse shared directories on other network computers without Windows SMB or internet clouds.
              </p>
            </div>

            {/* Remote Peer & Share Connect Bar */}
            <div className="p-4 rounded-xl border border-border bg-card flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-3 w-full md:w-auto">
                <select
                  value={browsePeerId}
                  onChange={(e) => setBrowsePeerId(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-[200px]"
                >
                  <option value="">Select Remote Peer...</option>
                  {devices
                    .filter((d) => d.status === 'online')
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.displayName} ({d.ipAddress})
                      </option>
                    ))}
                </select>

                <input
                  type="text"
                  placeholder="Shared Folder ID or Name"
                  value={browseFolderId}
                  onChange={(e) => setBrowseFolderId(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
                />
              </div>

              <button
                disabled={!browsePeerId || !browseFolderId}
                onClick={handleRemoteBrowseStart}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold flex items-center gap-1.5 shadow transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" /> Open Remote Folder
              </button>
            </div>

            {/* Remote Explorer View (when activeRemoteDeviceId is loaded) */}
            {activeRemoteDeviceId && (
              <div className="rounded-xl border border-border bg-card overflow-hidden space-y-0">
                {/* Explorer Toolbar / Breadcrumbs */}
                <div className="p-3 bg-muted/40 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs">
                    <button
                      onClick={() => navigateRemoteBreadcrumb(-1)}
                      className="font-semibold text-foreground hover:underline flex items-center gap-1"
                    >
                      <HardDrive className="w-3.5 h-3.5 text-primary" /> Root
                    </button>
                    {pathBreadcrumbs.map((crumb, idx) => (
                      <React.Fragment key={idx}>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                        <button
                          onClick={() => navigateRemoteBreadcrumb(idx)}
                          className={`hover:underline ${
                            idx === pathBreadcrumbs.length - 1
                              ? 'font-bold text-foreground'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {crumb}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      Permission: {remoteEffectivePermission.replace('_', ' ')}
                    </span>

                    {['modify', 'full_control', 'upload'].includes(remoteEffectivePermission) && (
                      <button
                        onClick={() => setIsNewDirModalOpen(true)}
                        className="px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold flex items-center gap-1"
                      >
                        <FolderPlus className="w-3 h-3" /> New Dir
                      </button>
                    )}

                    <button
                      onClick={() => browseRemote(activeRemoteDeviceId, browseFolderId, remoteCurrentPath)}
                      className="p-1 rounded bg-muted hover:bg-muted/80 text-foreground"
                      title="Refresh"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Explorer Items Table */}
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/20 border-b border-border text-muted-foreground">
                    <tr>
                      <th className="p-3 font-semibold">Name</th>
                      <th className="p-3 font-semibold">Size</th>
                      <th className="p-3 font-semibold">Modified</th>
                      <th className="p-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {remoteBrowseItems.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-muted-foreground">
                          This folder is empty.
                        </td>
                      </tr>
                    ) : (
                      remoteBrowseItems.map((item) => (
                        <tr key={item.relativePath} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-medium text-foreground">
                            {item.isDirectory ? (
                              <button
                                onClick={() =>
                                  browseRemote(
                                    activeRemoteDeviceId,
                                    browseFolderId,
                                    remoteCurrentPath ? `${remoteCurrentPath}/${item.name}` : item.name
                                  )
                                }
                                className="flex items-center gap-2 text-primary hover:underline font-semibold"
                              >
                                <Folder className="w-4 h-4 shrink-0 text-amber-500" />
                                <span>{item.name}</span>
                              </button>
                            ) : (
                              <div className="flex items-center gap-2">
                                <File className="w-4 h-4 shrink-0 text-muted-foreground" />
                                <span>{item.name}</span>
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {item.isDirectory ? '-' : formatBytes(item.size)}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {new Date(item.modifiedAt).toLocaleString()}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Rename item (requires modify or full_control) */}
                              {['modify', 'full_control'].includes(remoteEffectivePermission) && (
                                <button
                                  onClick={() => {
                                    setRenamingItem({ path: item.relativePath, name: item.name });
                                    setRenameNewName(item.name);
                                  }}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                  title="Rename Item"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Delete item (requires full_control) */}
                              {remoteEffectivePermission === 'full_control' && (
                                <button
                                  onClick={() => {
                                    if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
                                      deleteRemoteItem(item.relativePath);
                                    }
                                  }}
                                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                  title="Delete Item"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share Folder Modal */}
      {isShareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                <FolderPlus className="w-4 h-4 text-primary" /> Share Local Folder over LAN
              </h3>
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateShareSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Share Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ProjectDocs"
                  value={newShareName}
                  onChange={(e) => setNewShareName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Local Folder Path</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    readOnly
                    placeholder="Select folder..."
                    value={newSharePath}
                    className="flex-1 px-3 py-2 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleSelectFolderForShare}
                    className="px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold shrink-0"
                  >
                    Browse...
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Default Access Permission</label>
                <select
                  value={newSharePermission}
                  onChange={(e) => setNewSharePermission(e.target.value as FolderPermission)}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="read_only">Read Only (Download / View)</option>
                  <option value="upload">Upload (Read + Upload Files)</option>
                  <option value="modify">Modify (Read + Upload + Rename)</option>
                  <option value="full_control">Full Control (Read + Upload + Rename + Delete)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newShareName || !newSharePath}
                  className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold shadow"
                >
                  Create Share
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Directory Modal */}
      {isNewDirModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl overflow-hidden p-6 space-y-4">
            <h3 className="font-bold text-sm text-foreground">Create New Folder on Remote Peer</h3>
            <input
              type="text"
              autoFocus
              placeholder="Folder Name"
              value={newDirName}
              onChange={(e) => setNewDirName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsNewDirModalOpen(false);
                  setNewDirName('');
                }}
                className="px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newDirName.trim()}
                onClick={async () => {
                  await createRemoteDir(newDirName.trim());
                  setIsNewDirModalOpen(false);
                  setNewDirName('');
                }}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold shadow"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renamingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl overflow-hidden p-6 space-y-4">
            <h3 className="font-bold text-sm text-foreground">Rename Remote Item</h3>
            <input
              type="text"
              autoFocus
              value={renameNewName}
              onChange={(e) => setRenameNewName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenamingItem(null)}
                className="px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!renameNewName.trim() || renameNewName === renamingItem.name}
                onClick={async () => {
                  await renameRemoteItem(renamingItem.path, renameNewName.trim());
                  setRenamingItem(null);
                }}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold shadow"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
