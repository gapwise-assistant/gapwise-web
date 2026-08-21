# ClinicFlow clinical and operations interviews — combined notes

These notes combine several conversations and have not been reconciled.

Priya Shah, executive sponsor:

> Lakeview nurses already correct intake mistakes today. ClinicFlow should not need a new approval workflow. If something looks wrong, the nurse can fix it before the visit.

Dr. Maya Chen, clinical safety lead:

> That is only true for demographics and a limited set of history fields. Nurses at Lakeview cannot independently overwrite a physician-entered medication or allergy record. A treating clinician or delegated pharmacist must approve those corrections. I have not agreed to be the pilot's accountable clinical owner.

Luis Ortega, clinic manager:

> I thought the vendor's site-admin role could correct every field. We planned to give that role to the intake coordinator so the queue would not stall.

Nora Bell, vendor solutions engineer:

> The admin override can edit a submitted intake packet before export. I need to confirm whether the audit log distinguishes a patient edit, coordinator edit, and clinician approval. The medication and allergy permissions depend on the customer's EHR configuration.

Samir Patel, compliance analyst:

> The current policy names the treating clinician as the accountable approver for medication and allergy corrections. A delegated pharmacist is also permitted. It does not mention vendor administrators. Any broader role needs formal approval and an auditable reason code.

Operational observations:

- One intake coordinator covers check-in, phone calls, and exception review from 7:30 to 10:30 AM.
- On the observed Monday, 23 of 84 patients required some manual correction.
- Seven patients did not have a smartphone available at check-in.
- Four patients needed an interpreter; Spanish is supported, Mandarin is not ready.
- The coordinator estimates that a simple demographic correction takes 45 seconds and a medication discrepancy takes 4–7 minutes plus clinician waiting time.
- The sponsor's 120-submission forecast is not supported by current Lakeview volume.

The clinic manager wants an answer by tomorrow afternoon because the training schedule must be released. Dr. Chen can attend a 25-minute safety review tomorrow at 10:00 AM if the vendor and compliance analyst join. This meeting is the cheapest available way to establish the correction authority, escalation owner, audit requirement, and stop condition.

No one has yet recorded a final answer to the clinical ownership question. The training plan and the September 8 launch decision remain blocked by it.

