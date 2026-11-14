import React, { lazy, Suspense, useState } from 'react';
import { Smile, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useThemeStore } from '../../stores/themeStore';

// The picker (and its emoji dataset) is only loaded the first time it is opened.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

interface EmojiPickerButtonProps {
  onSelect: (emoji: string) => void;
  /** Keep the popover open after picking (composer) or close it (reactions). */
  closeOnSelect?: boolean;
  trigger?: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  title?: string;
  /** Optional controlled open state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const EmojiPickerButton: React.FC<EmojiPickerButtonProps> = ({
  onSelect,
  closeOnSelect = false,
  trigger,
  side = 'top',
  align = 'start',
  title = 'Emoji',
  open: controlledOpen,
  onOpenChange,
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const isDark = useThemeStore((s) => s.resolvedDark);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={title}
            aria-label={title}
          >
            <Smile className="w-4 h-4" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-auto p-0 border-border overflow-hidden">
        <Suspense
          fallback={
            <div className="w-[340px] h-[380px] flex items-center justify-center text-xs text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading emoji…
            </div>
          }
        >
          <EmojiPicker
            onEmojiClick={(data) => {
              onSelect(data.emoji);
              if (closeOnSelect) setOpen(false);
            }}
            theme={(isDark ? 'dark' : 'light') as any}
            emojiStyle={'native' as any}
            lazyLoadEmojis
            width={340}
            height={380}
            previewConfig={{ showPreview: false }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
};
