'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Eye, FileArchive, FileText, Image, Info, Mic, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { ContextSource, Project, UserMemoryProfile } from '@/types/clarity';
import { GoogleWorkspaceSignals } from '@/types/google';
import { discardContextSource, makeId, restoreContextSource } from '@/lib/context/ingestion';
import { makeLocalDemoStorageUrl } from '@/lib/storage/assets';
import { ConnectedContext } from '@/components/ConnectedContext';
import { AppScope } from '@/types/scope';
import { contextTargetForScope, GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';
import { authFetch } from '@/lib/auth/client';

interface ContextInboxProps {
  project: Project;
  projects: Project[];
  scope: AppScope;
  generalContext: Project;
  profile: UserMemoryProfile;
  userId: string;
  onUpdateProject: (updated: Project) => void;
  onUpdateGeneralContext: (updated: Project) => void;
  focusedSourceId?: string;
  entryTab?: 'recent' | 'connections';
}

type ContextTab = 'recent' | 'documents' | 'connections' | 'add';

const sourceTypeOptions: Array<{ type: ContextSource['type']; label: string; icon: React.ReactNode }> = [
  { type: 'text', label: 'Text', icon: <FileText className="w-3.5 h-3.5" /> },
  { type: 'note', label: 'Note', icon: <FileText className="w-3.5 h-3.5" /> },
  { type: 'pdf', label: 'PDF', icon: <FileArchive className="w-3.5 h-3.5" /> },
  { type: 'image', label: 'Image', icon: <Image className="w-3.5 h-3.5" /> },
  { type: 'voice', label: 'Voice', icon: <Mic className="w-3.5 h-3.5" /> },
];

function statusLabel(source: ContextSource): string {
  if (source.discarded_at) return 'Discarded';
  if (source.processing_status === 'failed') return 'Needs attention';
  if (source.processing_status === 'processing' || source.processing_status === 'pending') return 'Processing';
  if (source.type === 'pdf' && source.extraction_summary) return 'Processed';
  if (source.storage_url) return 'Uploaded';
  return 'Processed';
}

function summaryFor(source: ContextSource): string {
  if (source.extraction_summary) return source.extraction_summary;
  if (source.error_message) return source.error_message;
  return source.content.trim() || 'No summary available yet.';
}

function sourceIcon(type: ContextSource['type']): React.ReactNode {
  if (type === 'pdf') return <FileArchive className="w-4 h-4 text-cyan-300" />;
  if (type === 'image') return <Image className="w-4 h-4 text-cyan-300" />;
  if (type === 'voice') return <Mic className="w-4 h-4 text-cyan-300" />;
  return <FileText className="w-4 h-4 text-cyan-300" />;
}

function learnedCount(source: ContextSource): string {
  if (!source.derived_node_ids.length) return 'Not used yet';
  if (source.derived_node_ids.length === 1) return '1 thing learned';
  return `${source.derived_node_ids.length} things learned`;
}

function formatBytes(value: number | undefined): string | null {
  if (!value) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function learnedNodesForSource(source: ContextSource, contexts: Project[]): Project['nodes'] {
  const learnedIds = new Set(source.derived_node_ids);
  return contexts
    .flatMap((context) => context.nodes)
    .filter((node) => learnedIds.has(node.id));
}

export const ContextInbox: React.FC<ContextInboxProps> = ({
  project,
  projects,
  scope,
  generalContext,
  profile,
  userId,
  onUpdateProject,
  onUpdateGeneralContext,
  focusedSourceId,
  entryTab,
}) => {
  const [activeTab, setActiveTab] = useState<ContextTab>(entryTab ?? 'recent');
  const [pasteText, setPasteText] = useState('');
  const [filenameInput, setFilenameInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState<ContextSource['type']>('text');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [targetProjectId, setTargetProjectId] = useState(GENERAL_CONTEXT_ID);
  const [selectedSource, setSelectedSource] = useState<ContextSource | null>(null);

  useEffect(() => {
    if (entryTab) setActiveTab(entryTab);
    if (!focusedSourceId) return;
    setActiveTab('recent');
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`context-source-${focusedSourceId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entryTab, focusedSourceId]);

  useEffect(() => {
    if (!selectedSource) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedSource(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedSource]);

  const targetProject = contextTargetForScope(scope, projects, generalContext, targetProjectId);
  const visibleProjects = scope.type === 'project' ? [project] : [...projects, generalContext];
  const visibleSources = useMemo(
    () => Array.from(new Map(visibleProjects.flatMap((item) => item.sources).map((source) => [source.id, source])).values()),
    [visibleProjects]
  );

  const updateTargetProject = (updated: Project) => {
    if (updated.id === GENERAL_CONTEXT_ID) onUpdateGeneralContext(updated);
    else onUpdateProject(updated);
  };

  const sourceScopeLabel = (sourceId: string): string => {
    const owner = visibleProjects.find((item) => item.sources.some((source) => source.id === sourceId));
    return owner?.id === GENERAL_CONTEXT_ID ? 'General' : owner?.title ?? project.title;
  };

  const recentSources = useMemo(
    () => {
      const sorted = visibleSources
        .filter((source) => !source.discarded_at)
        .sort((a, b) => b.extracted_at.localeCompare(a.extracted_at));
      const recent = sorted.slice(0, 8);
      const focused = focusedSourceId ? sorted.find((source) => source.id === focusedSourceId) : undefined;
      return focused && !recent.some((source) => source.id === focused.id)
        ? [focused, ...recent.slice(0, 7)]
        : recent;
    },
    [visibleSources, focusedSourceId]
  );
  const documentSources = useMemo(
    () => visibleSources.filter((source) => !source.discarded_at && (['pdf', 'image', 'voice'].includes(source.type) || Boolean(source.storage_url))),
    [visibleSources]
  );
  const discardedSources = useMemo(
    () => visibleSources.filter((source) => Boolean(source.discarded_at)).sort((a, b) => (b.discarded_at ?? '').localeCompare(a.discarded_at ?? '')),
    [visibleSources]
  );

  const readFileText = async (file: File): Promise<string> => {
    if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
      return file.text();
    }
    return pasteText.trim();
  };

  const handleAddTextSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteText.trim() && !selectedFile) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('Adding context...');
    try {
      const fileText = selectedFile ? await readFileText(selectedFile) : '';
      const content = pasteText.trim() || fileText || (selectedFile && sourceType === 'pdf' ? selectedFile.name : '');
      if (!content) {
        setErrorMessage(
          selectedFile
            ? 'Add a short description, transcript, or excerpt so Gapswise can understand this source.'
            : 'Paste some context before adding.'
        );
        return;
      }

      const name = filenameInput.trim() || selectedFile?.name || `context_${Date.now()}.txt`;
      const sourceId = makeId('src');
      const requestBody = {
        userId,
        projectId: targetProject.id,
        sourceId,
        filename: name,
        content,
        type: sourceType,
        mimeType: selectedFile?.type || (sourceType === 'text' || sourceType === 'note' ? 'text/plain' : undefined),
        sizeBytes: selectedFile?.size,
        storageUrl: selectedFile && sourceType !== 'pdf' ? makeLocalDemoStorageUrl(selectedFile.name) : undefined,
        profile,
      };
      let response: Response;
      if (selectedFile && sourceType === 'pdf') {
        const formData = new FormData();
        Object.entries(requestBody).forEach(([key, value]) => {
          if (value === undefined) return;
          formData.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        });
        formData.set('file', selectedFile);
        response = await authFetch('/api/context/ingest', { method: 'POST', body: formData });
      } else {
        response = await authFetch('/api/context/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
      }
      const body = await response.json().catch(() => ({}));
      if (body.project && typeof body.project === 'object') updateTargetProject(body.project as Project);
      if (!response.ok) throw new Error(body.error || 'Context could not be analyzed.');
      if (body.skipped) setStatusMessage('This context was already analyzed.');
      setPasteText('');
      setFilenameInput('');
      setSelectedFile(null);
      setSourceType('text');
      setStatusMessage('Context added.');
      setActiveTab(sourceType === 'pdf' || selectedFile ? 'documents' : 'recent');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Context could not be added.');
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    const owner = visibleProjects.find((item) => item.sources.some((source) => source.id === sourceId));
    if (owner) updateTargetProject(discardContextSource(owner, sourceId, profile));
  };

  const handleRestoreSource = (sourceId: string) => {
    const owner = visibleProjects.find((item) => item.sources.some((source) => source.id === sourceId));
    if (owner) updateTargetProject(restoreContextSource(owner, sourceId, profile));
  };

  const handleImportWorkspaceSignals = (signals: GoogleWorkspaceSignals) => {
    const updated: Project = JSON.parse(JSON.stringify(targetProject));
    const existingIds = new Set(updated.sources.map((source) => source.id));
    signals.derivedSources.forEach((source) => {
      if (!existingIds.has(source.id)) {
        updated.sources.push(source);
      }
    });
    updated.updated_at = new Date().toISOString();
    updateTargetProject(updated);
  };

  const openSourceDetails = (source: ContextSource) => setSelectedSource(source);

  const handleSourceCardKeyDown = (event: React.KeyboardEvent<HTMLElement>, source: ContextSource) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openSourceDetails(source);
    }
  };

  const renderSourceCard = (src: ContextSource, compact = false, discarded = false) => (
    <article
      key={src.id}
      id={`context-source-${src.id}`}
      className={`rounded-xl border bg-slate-900 p-4 space-y-3 transition-colors ${
        focusedSourceId === src.id ? 'border-cyan-500 ring-2 ring-cyan-500/20' : discarded ? 'border-amber-900/70' : 'border-slate-800'
      } cursor-pointer hover:border-cyan-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40`}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${src.filename}`}
      onClick={() => openSourceDetails(src)}
      onKeyDown={(event) => handleSourceCardKeyDown(event, src)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 rounded-lg border border-slate-800 bg-slate-950 p-2">
            {sourceIcon(src.type)}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-slate-100">{src.filename}</h3>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {src.type} · {new Date(src.extracted_at).toLocaleDateString()} · {sourceScopeLabel(src.id)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {src.relevance === 'possibly_not_relevant' && (
            <span
              aria-label="Is this relevant to this project?"
              title="Is this relevant to this project?"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-700/70 bg-amber-950/60 text-amber-300"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          )}
          {discarded ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleRestoreSource(src.id);
              }}
              className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-2 text-emerald-300 hover:bg-emerald-900"
              title="Restore context"
              aria-label={`Restore ${src.filename}`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleDeleteSource(src.id);
              }}
              className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-500 hover:text-rose-300"
              title="Move to Discarded context"
              aria-label={`Move ${src.filename} to Discarded context`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold">
        <span className={`rounded-full border px-2.5 py-1 ${discarded ? 'border-amber-800 bg-amber-950 text-amber-200' : 'border-cyan-800 bg-cyan-950 text-cyan-200'}`}>
          {statusLabel(src)}
        </span>
        <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-400">
          {learnedCount(src)}
        </span>
        {src.size_bytes && (
          <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-400">
            {(src.size_bytes / 1024).toFixed(1)} KB
          </span>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {src.extraction_summary ? 'What Gapswise learned' : 'Summary'}
        </p>
        <p className={`mt-2 text-xs text-slate-300 ${compact ? 'line-clamp-2' : ''}`}>
          {summaryFor(src)}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
        <span className="text-[10px] text-slate-500">{discarded ? 'Stored but excluded from reasoning' : 'Click to inspect all source details'}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openSourceDetails(src);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-800 bg-cyan-950/50 px-2.5 py-1.5 text-[10px] font-bold text-cyan-200 hover:bg-cyan-900"
        >
          <Eye className="h-3.5 w-3.5" />
          View details
        </button>
      </div>
    </article>
  );

  const renderSourceDetails = () => {
    if (!selectedSource) return null;
    const sourceContexts = visibleProjects.filter((context) =>
      context.sources.some((source) => source.id === selectedSource.id)
    );
    const learnedNodes = learnedNodesForSource(selectedSource, sourceContexts);
    const size = formatBytes(selectedSource.size_bytes);
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedSource(null);
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="context-source-details-title"
          className="max-h-[min(760px,calc(100vh-2rem))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="rounded-lg border border-cyan-800 bg-cyan-950 p-2.5">
                {sourceIcon(selectedSource.type)}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-400">Source details</p>
                <h2 id="context-source-details-title" className="mt-1 break-words text-lg font-extrabold text-slate-100">
                  {selectedSource.filename}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  {selectedSource.type.toUpperCase()} · {sourceScopeLabel(selectedSource.id)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSource(null)}
              aria-label="Close source details"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-500">Status</p>
              <p className="mt-1 text-xs font-semibold text-cyan-200">{statusLabel(selectedSource)}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-500">Origin</p>
              <p className="mt-1 text-xs font-semibold text-slate-200">{selectedSource.origin === 'connector' ? 'Connected account' : 'Supplied by you'}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-500">Type</p>
              <p className="mt-1 break-words text-xs font-semibold text-slate-200">{selectedSource.mime_type ?? selectedSource.type}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-500">Size</p>
              <p className="mt-1 text-xs font-semibold text-slate-200">{size ?? 'Not provided'}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-500">Added</p>
              <p className="mt-1 text-xs text-slate-300">{formatDate(selectedSource.extracted_at) ?? 'Not provided'}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-[10px] font-bold uppercase text-slate-500">Processed</p>
              <p className="mt-1 text-xs text-slate-300">{formatDate(selectedSource.processed_at) ?? 'Not processed yet'}</p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-100">
                <Info className="h-4 w-4 text-cyan-300" />
                What Gapswise learned
              </h3>
              <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950 p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{summaryFor(selectedSource)}</p>
                {learnedNodes.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
                    {learnedNodes.map((node) => (
                      <div key={node.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">{node.type.replaceAll('_', ' ')}</span>
                          <span className="text-[10px] text-slate-500">Confidence {Math.round(node.confidence * 100)}%</span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-300">{node.text}</p>
                        {node.why_it_matters?.length ? (
                          <p className="mt-2 text-[11px] text-slate-500">{node.why_it_matters[0]}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {!learnedNodes.length && selectedSource.derived_node_ids.length === 0 && (
                  <p className="mt-3 text-xs text-slate-500">This source has not produced a separate learned statement yet.</p>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-extrabold text-slate-100">Original content</h3>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-4">
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-300">
                  {selectedSource.content || 'No text content was stored for this source.'}
                </p>
              </div>
            </div>

            {(selectedSource.storage_url || selectedSource.model_used || selectedSource.hash || selectedSource.error_message) && (
              <div>
                <h3 className="text-sm font-extrabold text-slate-100">Processing and storage</h3>
                <div className="mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                  {selectedSource.storage_url && <p className="break-all"><span className="font-semibold text-slate-300">Stored at:</span> {selectedSource.storage_url}</p>}
                  {selectedSource.model_used && <p><span className="font-semibold text-slate-300">Analysis:</span> {selectedSource.model_used}</p>}
                  {selectedSource.hash && <p className="break-all"><span className="font-semibold text-slate-300">File fingerprint:</span> {selectedSource.hash}</p>}
                  {selectedSource.error_message && <p className="text-rose-300"><span className="font-semibold">Issue:</span> {selectedSource.error_message}</p>}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 flex justify-end border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setSelectedSource(null)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:text-cyan-300"
            >
              Close
            </button>
          </div>
        </section>
      </div>
    );
  };

  const renderAddContext = () => (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
        <Plus className="w-4 h-4 text-cyan-300" />
        Add context
      </h2>

      <form onSubmit={handleAddTextSource} className="mt-5 space-y-4">
        {scope.type === 'everything' && (
          <label className="block">
            <span className="block text-xs font-semibold text-slate-400 mb-2">Where does this belong?</span>
            <select
              value={targetProjectId}
              onChange={(event) => setTargetProjectId(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-cyan-500"
            >
              <option value={GENERAL_CONTEXT_ID}>General / no project</option>
              {projects.filter((item) => item.status !== 'archived').map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </label>
        )}
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-2">Source type</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {sourceTypeOptions.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => setSourceType(option.type)}
                className={`h-10 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  sourceType === option.type
                    ? 'border-cyan-700 bg-cyan-950 text-cyan-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-400 mb-1">Title or filename</span>
            <input
              type="text"
              value={filenameInput}
              onChange={(e) => setFilenameInput(e.target.value)}
              placeholder="customer-interview-notes.txt"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder-slate-500 outline-none focus:border-cyan-500"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-semibold text-slate-400 mb-1">File</span>
            <input
              type="file"
              accept=".txt,.md,.pdf,image/*,audio/*"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSelectedFile(file);
                if (file) {
                  setFilenameInput((current) => current || file.name);
                  if (file.type === 'application/pdf') setSourceType('pdf');
                  else if (file.type.startsWith('image/')) setSourceType('image');
                  else if (file.type.startsWith('audio/')) setSourceType('voice');
                  else setSourceType('text');
                }
              }}
              className="w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-200 hover:file:bg-slate-700"
            />
            {selectedFile && (
              <span className="mt-1 block text-[10px] text-slate-500">
                {selectedFile.type || 'unknown type'} · {(selectedFile.size / 1024).toFixed(1)} KB
              </span>
            )}
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-semibold text-slate-400 mb-1">
            {sourceType === 'voice'
              ? 'Transcript or voice note summary'
              : sourceType === 'image'
                ? 'Visible text or image description'
                : sourceType === 'pdf'
                  ? 'PDF excerpt or short description'
                  : 'Content'}
          </span>
          <textarea
            rows={7}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste notes, extracted text, a transcript, or a concise description..."
            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder-slate-500 outline-none focus:border-cyan-500"
          />
        </label>

        <button
          type="submit"
          disabled={isProcessing || (!pasteText.trim() && !selectedFile)}
          className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl text-xs shadow-lg transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
        >
          {isProcessing ? (
            <>
              <Clock className="w-4 h-4 animate-spin" />
              <span>Adding context...</span>
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              <span>Add context</span>
            </>
          )}
        </button>

        {statusMessage && (
          <p className="text-xs text-emerald-400 font-medium text-center flex items-center justify-center space-x-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{statusMessage}</span>
          </p>
        )}

        {errorMessage && (
          <p className="text-xs text-rose-300 font-medium text-center">{errorMessage}</p>
        )}
      </form>
    </section>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-400">CONTEXT</p>
          <h1 className="mt-2 text-2xl font-extrabold text-slate-100">Context</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Information and sources Gapswise can use.
          </p>
          <p className="mt-2 text-xs font-semibold text-cyan-300">
            {scope.type === 'project' ? `Focused on: ${project.title}` : 'Focused on: Everything'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('add')}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950"
        >
          <Plus className="w-4 h-4" />
          Add context
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto border-b border-slate-800 pb-2">
        {([
          ['recent', 'Recent'],
          ['documents', 'Documents'],
          ['connections', 'Connections'],
          ['add', 'Add context'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${
              activeTab === id ? 'bg-cyan-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'recent' && (
        <section className="space-y-4">
          <h2 className="text-lg font-extrabold text-slate-100">Recent</h2>
          {recentSources.length ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {recentSources.map((source) => renderSourceCard(source, true))}
            </div>
          ) : !discardedSources.length ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-500">
              No context has been added yet.
            </div>
          ) : null}
          {discardedSources.length > 0 && (
            <div className="space-y-3 border-t border-slate-800 pt-6">
              <div>
                <h3 className="text-base font-extrabold text-slate-100">Discarded context</h3>
                <p className="mt-1 text-xs text-slate-500">Stored safely, but excluded from Gapswise reasoning until restored.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {discardedSources.map((source) => renderSourceCard(source, true, true))}
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'documents' && (
        <section className="space-y-4">
          <h2 className="text-lg font-extrabold text-slate-100">Documents</h2>
          {documentSources.length ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {documentSources.map((source) => renderSourceCard(source))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-500">
              No uploaded documents or files yet.
            </div>
          )}
        </section>
      )}

      {activeTab === 'connections' && (
        <ConnectedContext
          userId={userId}
          project={targetProject}
          onImportSources={handleImportWorkspaceSignals}
        />
      )}

      {activeTab === 'add' && renderAddContext()}
      {renderSourceDetails()}
    </div>
  );
};
