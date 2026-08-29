'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import type { ResolutionValidation } from '@/types/resolutionValidation';

export function ResolutionValidationNotice({
  validation,
  onEdit,
  onSave,
  saving = false,
}: {
  validation: ResolutionValidation;
  onEdit: () => void;
  onSave: () => void;
  saving?: boolean;
}) {
  if (validation.verdict === 'unavailable') {
    return (
      <section className="rounded-xl border border-amber-800/70 bg-amber-950/20 p-4" role="status">
        <p className="text-sm font-semibold text-amber-100">Gapwise could not check this response right now.</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-200/80">You can return to editing or save it without checking.</p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onEdit} disabled={saving}>Return to editing</Button>
          <Button variant="primary" onClick={onSave} loading={saving}>Save without checking</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-amber-800/70 bg-amber-950/20 p-4" role="alert" aria-labelledby="resolution-validation-title">
      <p id="resolution-validation-title" className="text-sm font-semibold text-amber-100">Check this response</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-200/80">This may not fully resolve the question or decision.</p>
      <p className="mt-3 text-sm leading-relaxed text-slate-200">{validation.reason}</p>
      {validation.missingInformation.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Missing</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-300">
            {validation.missingInformation.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
      {validation.suggestedRevision && (
        <div className="mt-3">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Suggested improvement</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">“{validation.suggestedRevision}”</p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onEdit} disabled={saving}>Edit response</Button>
        <Button variant="primary" onClick={onSave} loading={saving}>Save anyway</Button>
      </div>
    </section>
  );
}
