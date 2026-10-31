import * as vscode from 'vscode';
import type { DiagnosticLocale } from '../core/diagnostics';
import type {
  PresetName,
  RuleConfig,
  RuleOverride,
} from '../core/rules/types';

export interface CfixSettings {
  enabled: boolean;
  preset: PresetName;
  completionEnabled: boolean;
  correctionEnabled: boolean;
  debounceMs: number;
  stackLimitKB: number;
  reshowAfterMs: number;
  includeFixableDiagnostics: boolean;
  locale: DiagnosticLocale;
  ruleConfig: RuleConfig;
}

const PRESETS = new Set<PresetName>(['core', 'standard', 'all']);
const RULE_OVERRIDES = new Set<RuleOverride>(['off', 'warning', 'error']);
const LOCALES = new Set<DiagnosticLocale>(['zh', 'en']);

export function readCfixSettings(): CfixSettings {
  const config = vscode.workspace.getConfiguration('cfix');
  const presetValue = config.get<string>('preset', 'core');
  const preset = PRESETS.has(presetValue as PresetName)
    ? (presetValue as PresetName)
    : 'core';
  const stackLimitKB = nonNegative(config.get<number>('stackLimitKB', 1024), 1024);
  const localeValue = config.get<string>('locale', 'zh');
  const locale = LOCALES.has(localeValue as DiagnosticLocale)
    ? (localeValue as DiagnosticLocale)
    : 'zh';
  const overrides = readRuleOverrides(config.get<unknown>('rules', {}));

  return {
    enabled: config.get<boolean>('enable', true),
    preset,
    completionEnabled: config.get<boolean>('completion.enable', true),
    correctionEnabled: config.get<boolean>('correction.enable', true),
    debounceMs: nonNegative(
      config.get<number>('correction.debounceMs', 300),
      300,
    ),
    stackLimitKB,
    reshowAfterMs: nonNegative(config.get<number>('reshowAfterMs', 0), 0),
    includeFixableDiagnostics: config.get<boolean>(
      'diagnostics.includeFixable',
      true,
    ),
    locale,
    ruleConfig: {
      preset,
      overrides,
      stackLimitKB,
    },
  };
}

function readRuleOverrides(value: unknown): Record<string, RuleOverride> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const overrides: Record<string, RuleOverride> = {};
  for (const [ruleId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && RULE_OVERRIDES.has(raw as RuleOverride)) {
      overrides[ruleId] = raw as RuleOverride;
    }
  }
  return overrides;
}

function nonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
