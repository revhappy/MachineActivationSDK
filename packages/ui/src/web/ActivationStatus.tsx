import * as React from 'react';
import type { ActivationCapabilitySnapshot } from 'machineai-activation';

export interface ActivationStatusProps {
  snapshot: ActivationCapabilitySnapshot;
  className?: string;
}

export function ActivationStatus(props: ActivationStatusProps): React.ReactElement {
  const { snapshot, className } = props;
  const { resolvedContract, diagnostics } = snapshot;
  const { compatibility, memoryAssessment, reasons, warnings } = resolvedContract;

  const backendLabel =
    diagnostics.backendName ??
    diagnostics.backendId ??
    '(unknown backend)';

  return (
    <section className={className} data-machine-ui="activation-status">
      <div
        data-machine-ui="activation-status-badge"
        data-compatibility={compatibility}
        role="status"
      >
        {compatibility}
      </div>

      <div data-machine-ui="activation-status-backend">
        <strong>Backend:</strong> {backendLabel}
        {diagnostics.backendVersion && ` v${diagnostics.backendVersion}`}
      </div>

      <div
        data-machine-ui="activation-status-memory"
        data-status={memoryAssessment.status}
      >
        <strong>Memory:</strong> {memoryAssessment.detail}
      </div>

      {reasons.length > 0 && (
        <ul data-machine-ui="activation-status-reasons">
          {reasons.map((r, i) => (
            <li key={i} data-severity="error">{r}</li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul data-machine-ui="activation-status-warnings">
          {warnings.map((w, i) => (
            <li key={i} data-severity="warning">{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
