import { create } from 'zustand';
import { TransferItem, TransferProgressEventData } from '@ipm/shared';

interface TransferState {
  transfers: TransferItem[];
  incomingOffers: TransferItem[];
  progressMap: Record<string, TransferProgressEventData>;
  isLoading: boolean;
  error: string | null;

  fetchTransfers: (conversationId?: string) => Promise<void>;
  sendFile: (conversationId: string, peerDeviceId: string, filePath: string) => Promise<TransferItem | null>;
  selectAndSendFile: (conversationId: string, peerDeviceId: string) => Promise<void>;
  acceptTransfer: (transferId: string, customPath?: string) => Promise<void>;
  rejectTransfer: (transferId: string) => Promise<void>;
  pauseTransfer: (transferId: string) => Promise<void>;
  resumeTransfer: (transferId: string) => Promise<void>;
  cancelTransfer: (transferId: string) => Promise<void>;
  openFolder: (filePath: string) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  saveAs: (filePath: string) => Promise<void>;
  upsertTransfer: (transfer: TransferItem) => void;
  initListeners: () => () => void;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  transfers: [],
  incomingOffers: [],
  progressMap: {},
  isLoading: false,
  error: null,

  fetchTransfers: async (conversationId?: string) => {
    set({ isLoading: true, error: null });
    try {
      if (window.api?.getTransfers) {
        const transfers = await window.api.getTransfers(conversationId);
        set({ transfers, isLoading: false });
      }
    } catch (err: any) {
      set({
        isLoading: false,
        error: err.message || 'Failed to fetch transfers',
      });
    }
  },

  sendFile: async (conversationId: string, peerDeviceId: string, filePath: string) => {
    set({ error: null });
    try {
      if (!window.api?.sendFile) throw new Error('Send file API not available');
      const transfer = await window.api.sendFile({ conversationId, peerDeviceId, filePath });
      set((state) => ({
        transfers: [transfer, ...state.transfers.filter((t) => t.id !== transfer.id)],
      }));
      return transfer;
    } catch (err: any) {
      set({ error: err.message || 'Failed to send file' });
      return null;
    }
  },

  selectAndSendFile: async (conversationId: string, peerDeviceId: string) => {
    if (!window.api?.selectFile) return;
    const files = await window.api.selectFile();
    if (!files || files.length === 0) return;

    for (const filePath of files) {
      await get().sendFile(conversationId, peerDeviceId, filePath);
    }
  },

  acceptTransfer: async (transferId: string, customPath?: string) => {
    try {
      if (!window.api?.acceptTransfer) throw new Error('Accept transfer API not available');
      await window.api.acceptTransfer(transferId, customPath);
      set((state) => ({
        incomingOffers: state.incomingOffers.filter((o) => o.id !== transferId),
        transfers: state.transfers.map((t) =>
          t.id === transferId ? { ...t, status: 'transferring' as const } : t
        ),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to accept transfer' });
    }
  },

  rejectTransfer: async (transferId: string) => {
    try {
      if (!window.api?.rejectTransfer) throw new Error('Reject transfer API not available');
      await window.api.rejectTransfer(transferId);
      set((state) => ({
        incomingOffers: state.incomingOffers.filter((o) => o.id !== transferId),
        transfers: state.transfers.map((t) =>
          t.id === transferId ? { ...t, status: 'rejected' as const } : t
        ),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to reject transfer' });
    }
  },

  pauseTransfer: async (transferId: string) => {
    try {
      if (window.api?.pauseTransfer) {
        await window.api.pauseTransfer(transferId);
        set((state) => ({
          transfers: state.transfers.map((t) =>
            t.id === transferId ? { ...t, status: 'paused' as const } : t
          ),
        }));
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to pause transfer' });
    }
  },

  resumeTransfer: async (transferId: string) => {
    try {
      if (window.api?.resumeTransfer) {
        await window.api.resumeTransfer(transferId);
        set((state) => ({
          transfers: state.transfers.map((t) =>
            t.id === transferId ? { ...t, status: 'transferring' as const } : t
          ),
        }));
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to resume transfer' });
    }
  },

  cancelTransfer: async (transferId: string) => {
    try {
      if (window.api?.cancelTransfer) {
        await window.api.cancelTransfer(transferId);
        set((state) => ({
          transfers: state.transfers.map((t) =>
            t.id === transferId ? { ...t, status: 'cancelled' as const } : t
          ),
          incomingOffers: state.incomingOffers.filter((o) => o.id !== transferId),
        }));
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to cancel transfer' });
    }
  },

  openFolder: async (filePath: string) => {
    if (window.api?.openTransferFolder) {
      await window.api.openTransferFolder(filePath);
    }
  },

  openFile: async (filePath: string) => {
    try {
      const errorText = await window.api?.openTransferFile?.(filePath);
      if (errorText) set({ error: errorText });
    } catch (err: any) {
      set({ error: (err?.message || 'Could not open file').replace(/^Error invoking remote method [^:]+:\s*(Error:\s*)?/, '') });
    }
  },

  saveAs: async (filePath: string) => {
    try {
      await window.api?.saveTransferAs?.(filePath);
    } catch (err: any) {
      set({ error: err?.message || 'Could not save file' });
    }
  },

  upsertTransfer: (transfer: TransferItem) => {
    set((state) => ({
      transfers: state.transfers.some((t) => t.id === transfer.id)
        ? state.transfers.map((t) => (t.id === transfer.id ? { ...t, ...transfer } : t))
        : [transfer, ...state.transfers],
      incomingOffers:
        transfer.status === 'offered' && transfer.direction === 'incoming'
          ? state.incomingOffers.some((o) => o.id === transfer.id)
            ? state.incomingOffers
            : [transfer, ...state.incomingOffers]
          : state.incomingOffers.filter((o) => o.id !== transfer.id),
    }));
  },

  initListeners: () => {
    if (!window.api) return () => {};

    const unsubUpdated = window.api.onTransferUpdated?.((transfer: TransferItem) => {
      get().upsertTransfer(transfer);
    });

    const unsubOffer = window.api.onTransferOffer?.((offer: TransferItem) => {
      set((state) => ({
        incomingOffers: [offer, ...state.incomingOffers.filter((o) => o.id !== offer.id)],
        transfers: [offer, ...state.transfers.filter((t) => t.id !== offer.id)],
      }));
    });

    const unsubProgress = window.api.onTransferProgress?.((prog: TransferProgressEventData) => {
      set((state) => ({
        progressMap: {
          ...state.progressMap,
          [prog.transferId]: prog,
        },
        transfers: state.transfers.map((t) =>
          t.id === prog.transferId
            ? { ...t, bytesTransferred: prog.bytesTransferred, status: 'transferring' as const }
            : t
        ),
      }));
    });

    const unsubCompleted = window.api.onTransferCompleted?.((transfer: TransferItem) => {
      set((state) => ({
        transfers: state.transfers.some((t) => t.id === transfer.id)
          ? state.transfers.map((t) => (t.id === transfer.id ? transfer : t))
          : [transfer, ...state.transfers],
        incomingOffers: state.incomingOffers.filter((o) => o.id !== transfer.id),
      }));
    });

    const unsubFailed = window.api.onTransferFailed?.((data: { transferId: string; error: string }) => {
      set((state) => ({
        transfers: state.transfers.map((t) =>
          t.id === data.transferId
            ? { ...t, status: 'failed' as const, errorMessage: data.error }
            : t
        ),
      }));
    });

    get().fetchTransfers();

    return () => {
      unsubUpdated?.();
      unsubOffer?.();
      unsubProgress?.();
      unsubCompleted?.();
      unsubFailed?.();
    };
  },
}));

