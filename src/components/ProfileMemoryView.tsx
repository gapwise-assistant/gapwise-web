'use client';

import React from 'react';
import { Sliders, User, Brain, Save, CheckCircle2 } from 'lucide-react';
import { UserMemoryProfile } from '@/types/clarity';

interface ProfileMemoryViewProps {
  profile: UserMemoryProfile;
  onUpdateProfile: (updated: UserMemoryProfile) => void;
}

export const ProfileMemoryView: React.FC<ProfileMemoryViewProps> = ({
  profile,
  onUpdateProfile,
}) => {
  const [formData, setFormData] = React.useState<UserMemoryProfile>(profile);
  const [savedMessage, setSavedMessage] = React.useState('');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile(formData);
    setSavedMessage('Memory Profile updated! Gapswise will adapt question frequency & style instantly.');
    setTimeout(() => setSavedMessage(''), 4000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-2">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-cyan-950 border border-cyan-800 rounded-xl text-cyan-400">
            <Sliders className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-100">How I Work With You</h1>
            <p className="text-xs text-slate-400">
              Inspectable persistent memory. Edit durable working preferences to change how aggressively Gapswise challenges assumptions and ranks questions.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Working Style Preferences */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
          <h2 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
            <User className="w-4 h-4 text-cyan-400" />
            <span>Interaction & Personalization Controls</span>
          </h2>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-300 mb-1">Answer Density</label>
              <select
                value={formData.answer_density}
                onChange={(e) => setFormData({ ...formData, answer_density: e.target.value as any })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-cyan-500"
              >
                <option value="concise">Concise - Short explanations and crisp question bullets</option>
                <option value="balanced">Balanced - Moderate detail and explanations</option>
                <option value="detailed">Detailed - Comprehensive context breakdown</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-1">Question Frequency</label>
              <select
                value={formData.question_frequency}
                onChange={(e) => setFormData({ ...formData, question_frequency: e.target.value as any })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-cyan-500"
              >
                <option value="low">Low - Only interrupt on critical decision blockers</option>
                <option value="moderate">Moderate - Balanced question pacing</option>
                <option value="high">High - Guide closely through every open gap</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-1">Challenge Level</label>
              <select
                value={formData.challenge_level}
                onChange={(e) => setFormData({ ...formData, challenge_level: e.target.value as any })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-cyan-500"
              >
                <option value="high">High - Proactively surface weak assumptions & contradictions</option>
                <option value="moderate">Moderate - Gentle assumption testing</option>
                <option value="low">Low - Supportive confirmation</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-1">Evidence Preference</label>
              <select
                value={formData.evidence_preference}
                onChange={(e) => setFormData({ ...formData, evidence_preference: e.target.value as any })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 outline-none focus:border-cyan-500"
              >
                <option value="research_first">Research First - Search corpus before asking</option>
                <option value="intuition_allowed">Intuition Allowed - Accept user estimates</option>
                <option value="strict_data">Strict Data - Require source references for facts</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-semibold rounded-xl text-xs shadow-lg transition-all flex items-center justify-center space-x-2"
          >
            <Save className="w-4 h-4" />
            <span>Save Profile Memory</span>
          </button>

          {savedMessage && (
            <p className="text-xs text-emerald-400 font-medium text-center flex items-center justify-center space-x-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{savedMessage}</span>
            </p>
          )}
        </div>

        {/* Durable Learned Notes & Session Memory */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
          <h2 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
            <Brain className="w-4 h-4 text-purple-400" />
            <span>Durable Cross-Session Memory Bank</span>
          </h2>

          <p className="text-xs text-slate-400">
            Gapswise persists your work style and feedback across sessions automatically.
          </p>

          <div className="space-y-2">
            {formData.durable_notes?.map((note, idx) => (
              <div
                key={idx}
                className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 flex items-start space-x-2"
              >
                <span className="text-cyan-400 font-bold">•</span>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
};
