import React, { useState } from 'react';
import { X, Users, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useDeviceStore } from '../../stores/deviceStore';
import { useChatStore } from '../../stores/chatStore';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ isOpen, onClose }) => {
  const { devices } = useDeviceStore();
  const { createGroupChat } = useChatStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleDevice = (deviceId: string) => {
    setSelectedDevices((prev) =>
      prev.includes(deviceId) ? prev.filter((id) => id !== deviceId) : [...prev, deviceId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setError('Group name must be at least 2 characters.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await createGroupChat(trimmedName, description.trim() || undefined, selectedDevices);
      setIsSubmitting(false);
      setName('');
      setDescription('');
      setSelectedDevices([]);
      onClose();
    } catch (err) {
      setIsSubmitting(false);
      setError(err instanceof Error ? err.message : 'Failed to create group');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Create LAN Group</h2>
              <p className="text-xs text-muted-foreground">
                You will act as temporary group host with automatic failover election
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Group Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engineering Team, Office LAN"
              className="w-full px-3 py-2 text-xs rounded-xl bg-background border border-input focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Description (Optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Topic or channel purpose..."
              className="w-full px-3 py-2 text-xs rounded-xl bg-background border border-input focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Members Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-foreground">
                Select Initial Members ({selectedDevices.length} selected)
              </label>
              {devices.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDevices(
                      selectedDevices.length === devices.length ? [] : devices.map((d) => d.id)
                    )
                  }
                  className="text-[11px] text-primary hover:underline"
                >
                  {selectedDevices.length === devices.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            <div className="max-h-48 overflow-y-auto rounded-xl border border-border divide-y divide-border/40 bg-background/50">
              {devices.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No other LAN devices currently discovered. You can create the group now and invite peers later.
                </div>
              ) : (
                devices.map((device) => {
                  const isSelected = selectedDevices.includes(device.id);
                  return (
                    <div
                      key={device.id}
                      onClick={() => toggleDevice(device.id)}
                      className="p-2.5 flex items-center justify-between hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px] shrink-0">
                          {device.displayName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="truncate">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-foreground truncate">
                              {device.displayName}
                            </span>
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                device.status === 'online' ? 'bg-emerald-500' : 'bg-muted-foreground/60'
                              }`}
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {device.hostname} • {device.ipAddress}
                          </p>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-border bg-background'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating...
                </>
              ) : (
                'Create Group'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

