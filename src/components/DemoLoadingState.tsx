'use client';

import React from 'react';
import { WorkspaceLoadingState } from '@/components/WorkspaceLoadingState';

interface DemoLoadingStateProps {
  label: string;
}

/** Shared full-page transition state while a demo replaces the active workspace. */
export const DemoLoadingState: React.FC<DemoLoadingStateProps> = ({ label }) => (
  <WorkspaceLoadingState message={`Preparing ${label}…`} />
);
