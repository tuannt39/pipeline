import path from 'path';

export interface TriageResult {
  profile: 'patch' | 'investigate' | 'ecc';
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  detectedSignals: {
    isBugfixOrPatch: boolean;
    isInvestigateOnly: boolean;
    isArchitectureOrFeature: boolean;
    hasSpecificFileTarget: boolean;
    targetFiles: string[];
  };
}

/**
 * Regex to extract file paths mentioned in objectives
 */
const FILE_PATH_REGEX = /(?:[a-zA-Z0-9_\-/\\]+[/\\][a-zA-Z0-9_\-/\\]+\.(?:java|ts|js|py|go|rs|cpp|c|cs|kt|rb|php|html|css|json|yml|yaml|xml|properties|sql))/gi;

const INVESTIGATE_KEYWORDS = [
  'chỉ phân tích',
  'chỉ tìm hiểu',
  'chỉ đọc',
  'điều tra log',
  'phân tích log',
  'chẩn đoán log',
  'tìm hiểu nguyên nhân',
  'investigate',
  'log analysis',
  'root cause only',
  'diagnose',
  'troubleshoot log',
  'why failed',
  'read-only',
];

const BUGFIX_KEYWORDS = [
  'fix',
  'sửa lỗi',
  'khắc phục',
  'vá lỗi',
  'bug',
  'patch',
  'lỗi',
  'sai logic',
  'nhầm',
  'không tìm thấy',
  'not found',
  'mâu thuẫn',
  'searchterm',
  'exception',
  'failed',
  'resolve',
  'cố định',
  'động',
  'crash',
  'nullpointer',
];

const ARCHITECTURE_FEATURE_KEYWORDS = [
  'xây dựng tính năng',
  'tính năng mới',
  'phát triển tính năng',
  'implement feature',
  'new feature',
  'kiến trúc',
  'architecture',
  'tái cấu trúc',
  'refactor',
  'redesign',
  'migration',
  'microservice',
  'oauth',
  'sso',
  'module mới',
  'subsystem',
];

/**
 * Classifies an objective to determine the optimal pipeline profile (patch, investigate, or ecc).
 */
export function classifyObjective(objective: string): TriageResult {
  const text = objective.toLowerCase();

  // 1. Detect target file paths
  const matches = objective.match(FILE_PATH_REGEX) || [];
  const targetFiles = [...new Set(matches.map((m) => m.trim()))];
  const hasSpecificFileTarget = targetFiles.length > 0;

  // 2. Detect keywords
  const isInvestigateOnly = INVESTIGATE_KEYWORDS.some((kw) => text.includes(kw)) &&
    !text.includes('sửa') && !text.includes('fix') && !text.includes('implement');

  const isBugfixOrPatch = BUGFIX_KEYWORDS.some((kw) => text.includes(kw));

  const isArchitectureOrFeature = ARCHITECTURE_FEATURE_KEYWORDS.some((kw) => text.includes(kw)) ||
    (text.includes('refactor') && !text.includes('refactor nhỏ'));

  const signals = {
    isBugfixOrPatch,
    isInvestigateOnly,
    isArchitectureOrFeature,
    hasSpecificFileTarget,
    targetFiles,
  };

  // Rule 1: Explicit investigation/diagnostic without code modification
  if (isInvestigateOnly) {
    return {
      profile: 'investigate',
      confidence: 'high',
      rationale: 'Objective requests diagnostic log investigation and root-cause analysis without code modification.',
      detectedSignals: signals,
    };
  }

  // Rule 2: Bugfix / Patch targeting 1-2 specific files or localized issue
  if (isBugfixOrPatch && (!isArchitectureOrFeature || hasSpecificFileTarget)) {
    const fileHint = hasSpecificFileTarget
      ? `targeting specific file(s): ${targetFiles.map((f) => path.basename(f)).join(', ')}`
      : 'with localized bugfix scope';
    return {
      profile: 'patch',
      confidence: hasSpecificFileTarget ? 'high' : 'medium',
      rationale: `Localized bugfix/patch detected (${fileHint}). Utilizing lightweight 6-stage surgical lifecycle to prevent architectural over-engineering.`,
      detectedSignals: signals,
    };
  }

  // Rule 3: Complex multi-component feature or system architecture refactor
  if (isArchitectureOrFeature) {
    return {
      profile: 'ecc',
      confidence: 'high',
      rationale: 'Substantial feature development or architectural restructuring detected. Full 20-stage ECC lifecycle with 360° master plan recommended.',
      detectedSignals: signals,
    };
  }

  // Rule 4: Default fallback
  // If specific files are mentioned, prefer patch to be surgical
  if (hasSpecificFileTarget && targetFiles.length <= 2) {
    return {
      profile: 'patch',
      confidence: 'medium',
      rationale: `Objective references localized files (${targetFiles.map((f) => path.basename(f)).join(', ')}). Defaulting to surgical patch profile.`,
      detectedSignals: signals,
    };
  }

  // Otherwise, default to ecc for safe 360 plan and user review
  return {
    profile: 'ecc',
    confidence: 'low',
    rationale: 'General or unclassified engineering objective. Defaulting to full ECC profile with user plan approval gate.',
    detectedSignals: signals,
  };
}
