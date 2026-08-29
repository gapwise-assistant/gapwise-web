import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production public-demo build configuration', () => {
  it('requires, builds, and deploys the App Check site key and public limits', () => {
    const cloudbuild = readFileSync(path.join(process.cwd(), 'cloudbuild.yaml'), 'utf8');
    const dockerfile = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');

    expect(cloudbuild).toContain('_NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY:');
    expect(cloudbuild).toContain('NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY=${_NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY}');
    expect(cloudbuild).toContain('GAPSWISE_FULL_ACCESS_EMAILS=martelaxe@gmail.com');
    expect(cloudbuild).toContain('GAPSWISE_PUBLIC_DAILY_DEMO_LIMIT=50');
    expect(cloudbuild).toContain('GAPSWISE_PUBLIC_DAILY_ASK_LIMIT=30');
    expect(cloudbuild).toContain('FIREBASE_APPCHECK_ENABLED=true');
    expect(dockerfile).toContain('ARG NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY');
    expect(dockerfile).toContain('ENV NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY=${NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY}');
  });
});
