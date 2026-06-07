import * as React from 'react';
import type {
  CartridgeManifest,
  CatalogEntry,
} from '@machine/activation-sdk';
import { formatBytes } from '../core/formatBytes';

export interface CartridgeCardProps {
  manifest: CartridgeManifest;
  catalogEntry?: CatalogEntry;
  onInstall?: () => void;
  onOpen?: () => void;
  installed?: boolean;
  installing?: { progress: number };
  className?: string;
}

export function CartridgeCard(props: CartridgeCardProps): React.ReactElement {
  const { manifest, catalogEntry, onInstall, onOpen, installed, installing, className } = props;

  const progressPct = installing ? Math.max(0, Math.min(1, installing.progress)) * 100 : null;

  return (
    <article className={className} data-machine-ui="cartridge-card">
      <header data-machine-ui="cartridge-card-header">
        <h3>{manifest.name}</h3>
        {manifest.author?.name && (
          <small data-machine-ui="cartridge-card-author">by {manifest.author.name}</small>
        )}
      </header>

      {manifest.description && <p>{manifest.description}</p>}

      <dl data-machine-ui="cartridge-card-meta">
        <dt>Version</dt>
        <dd>{manifest.version}</dd>
        {catalogEntry && (
          <>
            <dt>Size</dt>
            <dd>{formatBytes(catalogEntry.downloadSizeBytes)}</dd>
          </>
        )}
        {manifest.license && (
          <>
            <dt>License</dt>
            <dd>{manifest.license}</dd>
          </>
        )}
        {manifest.capabilities?.contextWindowTokens && (
          <>
            <dt>Context</dt>
            <dd>{manifest.capabilities.contextWindowTokens.toLocaleString()} tokens</dd>
          </>
        )}
      </dl>

      {installing && progressPct !== null && (
        <div
          data-machine-ui="cartridge-card-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
        >
          {progressPct.toFixed(0)}%
        </div>
      )}

      <footer data-machine-ui="cartridge-card-actions">
        {installed ? (
          onOpen && (
            <button type="button" onClick={onOpen}>
              Open
            </button>
          )
        ) : (
          onInstall && (
            <button type="button" onClick={onInstall} disabled={Boolean(installing)}>
              {installing ? 'Installing…' : 'Install'}
            </button>
          )
        )}
      </footer>
    </article>
  );
}
