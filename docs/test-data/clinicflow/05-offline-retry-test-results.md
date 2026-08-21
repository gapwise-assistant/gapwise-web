# ClinicFlow offline retry test results

August 21, 2026 — The integration engineer ran the planned 20-record
offline/retry test against the current EHR connector.

Three records were written twice: the connector received the first write,
returned no acknowledgement, and accepted the retry as a second EHR record.

The connector has no stable idempotency key and the vendor cannot ship a fix
before September 15.

The read-only pilot path does not write patient data back to the EHR and
remains available for workflow research.
