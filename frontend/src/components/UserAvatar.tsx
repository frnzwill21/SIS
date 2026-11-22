'use client';

import { useEffect, useState } from 'react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-16 w-16 text-lg',
};

const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i;

function computeInitials(nama?: string | null, username?: string | null): string {
  const raw = (nama || username || '').trim();
  if (!raw) return '?';
  const words = raw
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return raw.slice(0, 2).toUpperCase();
}

export default function UserAvatar({
  nama,
  username,
  fotoProfil,
  size = 'md',
  className = '',
}: {
  nama?: string | null;
  username?: string | null;
  fotoProfil?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [fotoProfil]);

  const trimmedPhoto = typeof fotoProfil === 'string' ? fotoProfil.trim() : '';
  const hasValidPhoto = !imgError && trimmedPhoto.length > 0 && SAFE_DATA_IMAGE_RE.test(trimmedPhoto);
  const displayName = (nama || username || '').trim();
  const initials = computeInitials(nama, username);

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border-subtle)] select-none ${
        hasValidPhoto
          ? 'bg-[var(--bg-elevated)]'
          : 'bg-[var(--accent-ink)] font-semibold tracking-tight text-[var(--accent-ink-fg)]'
      } ${SIZE_CLASSES[size]} ${className}`}
    >
      {hasValidPhoto ? (
        <img
          src={trimmedPhoto}
          alt={displayName ? `Foto profil ${displayName}` : 'Foto profil'}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
