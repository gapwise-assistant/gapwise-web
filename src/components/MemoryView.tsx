'use client';

import React, { useEffect, useState } from 'react';
import { Brain, CheckCircle2, Eye, Plus, Save, Sliders, Trash2 } from 'lucide-react';
import { DurableMemory, MemoryCategory } from '@/types/contextPack';
import { UserMemoryProfile } from '@/types/clarity';
import { activeMemories, confirmMemory, editMemory, forgetMemory } from '@/lib/memory/store';
import { createDurableMemory } from '@/lib/memory/policy';
import { buildPromptProfile } from '@/lib/personalization/promptProfile';

interface MemoryViewProps {
  profile: UserMemoryProfile;
  memories: DurableMemory[];
  onUpdateProfile: (updated: UserMemoryProfile) => void;
  onUpdateMemories: (updated: DurableMemory[]) => void;
  section?: 'all' | 'memory' | 'preferences';
  variant?: 'page' | 'drawer';
}

const categories: MemoryCategory[] = ['career', 'communication', 'learning', 'current_priorities', 'custom'];

export const MemoryView: React.FC<MemoryViewProps> = ({
  profile,
  memories,
  onUpdateProfile,
  onUpdateMemories,
  section = 'all',
  variant = 'page',
}) => {
  const [formData, setFormData] = useState<UserMemoryProfile>(profile);
  const [draftMemory, setDraftMemory] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    setFormData(profile);
  }, [profile]);

  const visibleMemories = activeMemories(memories);
  const promptProfile = buildPromptProfile(profile, memories);
  const showMemory = section === 'all' || section === 'memory';
  const showPreferences = section === 'all' || section === 'preferences';

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile(formData);
    setSavedMessage('Memory profile updated.');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  const handleAddMemory = () => {
    const created = createDurableMemory(`Remember that ${draftMemory.trim()}`);
    if (!created) return;
    onUpdateMemories([created, ...memories]);
    setDraftMemory('');
  };

  const handleSaveEdit = (memory: DurableMemory) => {
    onUpdateMemories(editMemory(memories, memory.id, editingText, memory.category));
    setEditingId(null);
    setEditingText('');
  };

  if (variant === 'drawer') {
    return (
      <div className="w-full space-y-7">
        {showMemory && (
          <>
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
                <Plus className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                What Gapwise remembers
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">Add a preference, priority, or personal detail Gapwise should remember.</p>
              <textarea
                rows={4}
                value={draftMemory}
                onChange={(event) => setDraftMemory(event.target.value)}
                placeholder="Write something Gapwise should remember..."
                className="mt-4 min-h-24 w-full resize-y rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-600"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleAddMemory}
                  disabled={!draftMemory.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  Remember
                </button>
              </div>
              {savedMessage && <p className="mt-2 text-xs text-emerald-300">{savedMessage}</p>}
            </div>

            <div className="border-t border-slate-800 pt-6">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
                <Brain className="h-4 w-4 text-fuchsia-300" aria-hidden="true" />
                Durable memory
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">Information Gapwise can use across conversations.</p>
              <div className="mt-4 space-y-6">
                {categories.map((category) => {
                  const categoryMemories = visibleMemories.filter((memory) => memory.category === category);
                  const categoryLabel = category.replace('_', ' ');
                  return (
                    <section key={category}>
                      <h3 className="text-xs font-bold capitalize text-slate-300">{categoryLabel}</h3>
                      {categoryMemories.length === 0 ? (
                        <p className="mt-2 text-xs text-slate-600">No active memories</p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {categoryMemories.map((memory) => (
                            <div key={memory.id} className="rounded-lg border border-slate-800/80 bg-slate-900/60 p-3">
                              {editingId === memory.id ? (
                                <textarea
                                  rows={3}
                                  value={editingText}
                                  onChange={(event) => setEditingText(event.target.value)}
                                  className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs leading-relaxed text-slate-100 outline-none focus:border-cyan-600"
                                />
                              ) : (
                                <p className="text-sm leading-relaxed text-slate-200">{memory.text}</p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
                                <span className="text-emerald-300">{memory.last_confirmed_at ? 'Confirmed' : 'Active'}</span>
                                <span aria-hidden="true">·</span>
                                <span>{categoryLabel}</span>
                                <span className="ml-auto flex items-center gap-2">
                                  {editingId === memory.id ? (
                                    <button type="button" onClick={() => handleSaveEdit(memory)} className="font-semibold text-cyan-200 hover:text-cyan-100">Save</button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingId(memory.id);
                                        setEditingText(memory.text);
                                      }}
                                      className="font-semibold text-cyan-200 hover:text-cyan-100"
                                    >
                                      Edit
                                    </button>
                                  )}
                                  <button type="button" onClick={() => onUpdateMemories(confirmMemory(memories, memory.id))} className="font-semibold text-emerald-300 hover:text-emerald-200">Confirm</button>
                                  <button type="button" onClick={() => onUpdateMemories(forgetMemory(memories, memory.id))} className="font-semibold text-slate-500 hover:text-rose-200">Forget</button>
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {showPreferences && (
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <h2 className="text-sm font-bold text-slate-100">Preferences</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">Choose how Gapwise communicates and uses evidence.</p>
            </div>
            <div className="space-y-4 text-xs">
              <label className="block">
                <span className="block font-semibold text-slate-300">Answer density</span>
                <select value={formData.answer_density} onChange={(event) => setFormData({ ...formData, answer_density: event.target.value as UserMemoryProfile['answer_density'] })} className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 outline-none focus:border-cyan-600">
                  <option value="concise">Concise</option>
                  <option value="balanced">Balanced</option>
                  <option value="detailed">Detailed</option>
                </select>
              </label>
              <label className="block">
                <span className="block font-semibold text-slate-300">Question frequency</span>
                <select value={formData.question_frequency} onChange={(event) => setFormData({ ...formData, question_frequency: event.target.value as UserMemoryProfile['question_frequency'] })} className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 outline-none focus:border-cyan-600">
                  <option value="low">Low</option>
                  <option value="moderate">Moderate</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="block">
                <span className="block font-semibold text-slate-300">Evidence preference</span>
                <select value={formData.evidence_preference} onChange={(event) => setFormData({ ...formData, evidence_preference: event.target.value as UserMemoryProfile['evidence_preference'] })} className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 outline-none focus:border-cyan-600">
                  <option value="research_first">Research first</option>
                  <option value="intuition_allowed">Intuition allowed</option>
                  <option value="strict_data">Strict data</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-md border border-cyan-700 bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-100 hover:border-cyan-500">
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                Save preferences
              </button>
            </div>
            {savedMessage && <p className="text-xs text-emerald-300">{savedMessage}</p>}
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      {section === 'all' && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-2 sm:p-6">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-cyan-950 border border-cyan-800 rounded-xl text-cyan-400">
            <Sliders className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-100">Memory</h1>
            <p className="text-xs text-slate-400">
              Inspect, edit, confirm, or forget durable preferences and priorities that retrieval is allowed to use.
            </p>
          </div>
        </div>
      </div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {showPreferences && <form onSubmit={handleSaveProfile} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-xl">
          <h2 className="text-sm font-bold text-slate-200">Preferences</h2>
          <div className="space-y-4 text-xs">
            <label className="block">
              <span className="block font-semibold text-slate-300 mb-1">Answer Density</span>
              <select
                value={formData.answer_density}
                onChange={(e) => setFormData({ ...formData, answer_density: e.target.value as UserMemoryProfile['answer_density'] })}
                className="min-h-11 w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-cyan-500 sm:min-h-0"
              >
                <option value="concise">Concise</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>

            <label className="block">
              <span className="block font-semibold text-slate-300 mb-1">Question Frequency</span>
              <select
                value={formData.question_frequency}
                onChange={(e) => setFormData({ ...formData, question_frequency: e.target.value as UserMemoryProfile['question_frequency'] })}
                className="min-h-11 w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-cyan-500 sm:min-h-0"
              >
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
              </select>
            </label>

            <label className="block">
              <span className="block font-semibold text-slate-300 mb-1">Evidence Preference</span>
              <select
                value={formData.evidence_preference}
                onChange={(e) => setFormData({ ...formData, evidence_preference: e.target.value as UserMemoryProfile['evidence_preference'] })}
                className="min-h-11 w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-cyan-500 sm:min-h-0"
              >
                <option value="research_first">Research First</option>
                <option value="intuition_allowed">Intuition Allowed</option>
                <option value="strict_data">Strict Data</option>
              </select>
            </label>
          </div>

          <button
            type="submit"
            className="min-h-11 w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-semibold rounded-xl text-xs shadow-lg flex items-center justify-center gap-2 sm:min-h-0"
          >
            <Save className="w-4 h-4" />
            Save Profile
          </button>
          {savedMessage && <p className="text-xs text-emerald-400 text-center">{savedMessage}</p>}
        </form>}

        {showMemory && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
          <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Plus className="w-4 h-4 text-cyan-400" />
            What Gapwise remembers
          </h2>
          <textarea
            rows={4}
            value={draftMemory}
            onChange={(e) => setDraftMemory(e.target.value)}
            placeholder="Financial stability is my top priority for the next 3 months."
            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder-slate-500 outline-none focus:border-cyan-500"
          />
          <button
            type="button"
            onClick={handleAddMemory}
            disabled={!draftMemory.trim()}
            className="min-h-11 w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold rounded-xl text-xs disabled:opacity-50 sm:min-h-0"
          >
            Remember This
          </button>
        </div>}
      </div>

      {showMemory && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Brain className="w-4 h-4 text-fuchsia-400" />
          Durable Memory Bank
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {categories.map((category) => {
            const categoryMemories = visibleMemories.filter((memory) => memory.category === category);
            return (
              <section key={category} className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">{category.replace('_', ' ')}</h3>
                {categoryMemories.length === 0 ? (
                  <p className="text-xs text-slate-600">No active memories.</p>
                ) : (
                  categoryMemories.map((memory) => (
                    <div key={memory.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 space-y-2">
                      {editingId === memory.id ? (
                        <textarea
                          rows={3}
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100"
                        />
                      ) : (
                        <p className="text-xs text-slate-200">{memory.text}</p>
                      )}
                      <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        <Eye className="w-3 h-3" />
                        {memory.why_remembered}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {editingId === memory.id ? (
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(memory)}
                            className="min-h-10 rounded-lg border border-cyan-800 bg-cyan-950 px-2 py-1 text-[10px] font-semibold text-cyan-200 sm:min-h-0"
                          >
                            Save Edit
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(memory.id);
                              setEditingText(memory.text);
                            }}
                            className="min-h-10 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300 sm:min-h-0"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onUpdateMemories(confirmMemory(memories, memory.id))}
                          className="min-h-10 rounded-lg border border-emerald-800 bg-emerald-950 px-2 py-1 text-[10px] font-semibold text-emerald-200 flex items-center gap-1 sm:min-h-0"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateMemories(forgetMemory(memories, memory.id))}
                          className="min-h-10 rounded-lg border border-rose-800 bg-rose-950 px-2 py-1 text-[10px] font-semibold text-rose-200 flex items-center gap-1 sm:min-h-0"
                        >
                          <Trash2 className="w-3 h-3" />
                          Forget
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </section>
            );
          })}
        </div>
      </div>}

      {showPreferences && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-sm font-bold text-slate-200">Why Gapwise Thinks This About You</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <span className="block text-slate-500">Question threshold</span>
            <span className="text-cyan-300 font-bold">{Math.round(promptProfile.questionPriorityThreshold * 100)}%</span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <span className="block text-slate-500">Citation limit</span>
            <span className="text-cyan-300 font-bold">{promptProfile.citationLimit}</span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <span className="block text-slate-500">Challenge level</span>
            <span className="text-cyan-300 font-bold">{promptProfile.challengeLevel}</span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <span className="block text-slate-500">Assumptions</span>
            <span className="text-cyan-300 font-bold">{promptProfile.suggestTemporaryAssumptions ? 'Explicit' : 'Quiet'}</span>
          </div>
        </div>
        <div className="space-y-2">
          {promptProfile.memoryReasons.map((memory) => (
            <div key={memory.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
              <p className="text-slate-200">{memory.text}</p>
              <p className="mt-1 text-slate-500">{memory.why}</p>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
};
