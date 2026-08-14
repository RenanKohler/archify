// Structured diagnostics for the reverse-engineering pipeline.
//
// Receipts keep the Archify diagnostic shape (code / severity / message /
// subject / evidence / supportedFixes) so one machine reader handles every
// command. `contractCode` additionally carries the documentation contract
// vocabulary (TRACEABILITY_MISSING, EVIDENCE_MISSING, ...) used by
// references/reverse-engineering-contract.md.

export function reverseDiagnostic({
  code,
  contractCode,
  message,
  artifact,
  subject = {},
  evidence = {},
  supportedFixes = [],
  severity = 'error',
}) {
  return {
    code,
    ...(contractCode ? { contractCode } : {}),
    severity,
    message,
    ...(artifact ? { artifact } : {}),
    subject,
    evidence,
    supportedFixes,
  };
}

export function summarize(diagnostics) {
  return {
    errors: diagnostics.filter((entry) => entry.severity === 'error').length,
    warnings: diagnostics.filter((entry) => entry.severity === 'warning').length,
  };
}

export function formatDiagnostics(diagnostics) {
  return diagnostics.map((entry) => {
    const where = entry.artifact ? ` ${entry.artifact}` : '';
    const fix = entry.supportedFixes?.length ? ` Fix: ${entry.supportedFixes.join('; ')}.` : '';
    return `[${entry.severity}] [${entry.code}]${where} ${entry.message}${fix}`;
  }).join('\n');
}
