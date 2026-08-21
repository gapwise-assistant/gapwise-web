# ClinicFlow outpatient intake pilot — working brief

Date: August 20, 2026
Sponsor: Priya Shah, VP Ambulatory Operations
Pilot site: Lakeview Outpatient Clinic

The team is considering a six-week ClinicFlow pilot beginning September 8. The pending go/no-go decision must be made by September 4. This decision is still open. The sponsor wants a visible result before the September 18 grant review, but the clinic may delay or narrow the pilot if patient-safety controls are not ready.

The pilot goal is to reduce median check-in time from eight minutes to four minutes without increasing clinical errors or staff overtime. The optimistic plan assumes 120 patient submissions per day. Lakeview currently sees 65–80 patients per day, with Monday peaks near 95.

Proposed workflow:

1. A patient receives an SMS link before the appointment.
2. The patient confirms demographics, medications, allergies, consent, and symptoms.
3. ClinicFlow sends a structured intake packet to the EHR staging queue.
4. An intake coordinator reviews exceptions.
5. A clinician signs off on medication or allergy changes before the visit.

The current pilot budget is capped at $45,000. The team has six weeks and one internal integration engineer available at roughly 40% capacity. There is no approved budget for weekend support.

Pending launch decision: choose one of these options.

- Launch at Lakeview for all eligible patients on September 8.
- Launch a narrow 30-patient, one-clinic safety pilot with read-only EHR integration.
- Delay two weeks while safety, consent, and duplicate-record controls are completed.
- Stop the pilot and use the grant period for workflow research only.

The go/no-go decision is explicitly blocked by four unresolved inputs:

- Who has final clinical accountability and legal authority to correct medication or allergy information after a patient submits it?
- Can the offline queue retry without creating duplicate EHR records?
- Is the SMS consent language approved for PHI-related intake?
- Can one coordinator safely handle exception review during the Monday peak?

The sponsor believes the pilot is reversible because it lasts six weeks. The clinical safety lead disagrees: a rollout can be stopped, but an unreviewed allergy error or duplicate clinical record is not meaningfully reversible for the affected patient.

