import * as React from 'react';

export interface ImportedModelFile {
  name: string;
  size: number;
  file: File;
}

export interface ModelImportButtonProps {
  onImport: (imported: ImportedModelFile) => void | Promise<void>;
  accept?: string;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const DEFAULT_ACCEPT = '.gguf,.mcart,.litertlm,.task';

export function ModelImportButton(props: ModelImportButtonProps): React.ReactElement {
  const { onImport, accept = DEFAULT_ACCEPT, disabled, className, children } = props;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const handleClick = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setBusy(true);
      try {
        await onImport({ name: file.name, size: file.size, file });
      } finally {
        setBusy(false);
      }
    },
    [onImport],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
        data-machine-ui="model-import-input"
      />
      <button
        type="button"
        className={className}
        onClick={handleClick}
        disabled={disabled || busy}
        data-machine-ui="model-import-button"
      >
        {children ?? (busy ? 'Importing…' : 'Import model')}
      </button>
    </>
  );
}
