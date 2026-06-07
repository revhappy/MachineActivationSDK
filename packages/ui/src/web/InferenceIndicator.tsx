import * as React from 'react';
import { formatTokensPerSecond } from '../core/formatTokensPerSecond';
import type { UseInferenceReturn } from '../core/types';

export interface InferenceIndicatorProps {
  inference: UseInferenceReturn;
  className?: string;
  showAbort?: boolean;
}

export function InferenceIndicator(props: InferenceIndicatorProps): React.ReactElement {
  const { inference, className, showAbort = true } = props;
  const tokens = inference.usage?.completionTokens ?? 0;

  return (
    <div
      className={className}
      data-machine-ui="inference-indicator"
      data-status={inference.status}
    >
      <span data-machine-ui="inference-indicator-status">{inference.status}</span>
      <span data-machine-ui="inference-indicator-rate">
        {formatTokensPerSecond(inference.tokensPerSecond)}
      </span>
      <span data-machine-ui="inference-indicator-tokens">{tokens} tok</span>
      {showAbort && inference.status === 'streaming' && (
        <button type="button" onClick={inference.abort}>
          Stop
        </button>
      )}
      {inference.error && (
        <span data-machine-ui="inference-indicator-error" role="alert">
          {inference.error.message}
        </span>
      )}
    </div>
  );
}
