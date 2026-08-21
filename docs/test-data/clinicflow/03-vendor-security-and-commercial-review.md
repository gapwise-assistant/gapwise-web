# ClinicFlow vendor, security, reliability, and commercial review

Prepared from a vendor call, security questionnaire, draft quote, and an unrelated pilot incident report. Some statements conflict and need verification.

Reliability:

- The vendor states that its API achieved 99.9% availability during the last quarter.
- The mobile form can queue submissions while a device is offline and retry later.
- The vendor has not supplied an idempotency-key specification for the EHR export endpoint.
- An incident report from the Riverside pilot recorded 11 duplicate demographic records after queued submissions retried. The vendor says that connector was an older version, but no regression-test report has been provided for the current connector.
- The current rollback runbook says “disable sync and reconcile manually” but does not name the person authorized to trigger it.

Security and privacy:

- ClinicFlow encrypts data in transit and at rest.
- Application logs may contain patient identifiers and are retained for 30 days.
- The draft data-processing agreement is still under legal review.
- SSO is not included in the pilot build; staff would use vendor-managed accounts with MFA.
- The security team has not approved the exception for vendor-managed identities.
- The SMS link expires after 72 hours. The consent language says “care coordination,” but legal has not confirmed that this adequately describes digital intake and PHI processing.

Accessibility and language:

- The vendor reports WCAG 2.1 AA conformance but has supplied only a self-attestation.
- Spanish content is ready.
- Mandarin content is scheduled after the proposed pilot start.

Commercial terms:

- Six-week pilot fee: $38,000.
- EHR integration services: an additional $14,000.
- Optional weekend support: $6,000.
- The sponsor's approved total budget is $45,000.
- The vendor verbally suggested it might waive part of the integration fee if a production contract is signed, but this is not in the quote.

The open launch decision could change if duplicate prevention is not demonstrated, if the identity exception is rejected, or if the full price remains above budget. The duplicate-record issue is safety-relevant; the commercial gap is important but can be negotiated after a safe pilot shape is known.

