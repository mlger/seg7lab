/**
 * Project serialization / validation / migration.
 * Used by import, localStorage hydration and the API layer.
 */
import {
  SEGMENT_NAMES,
  type DisplayMode,
  type DisplaySettings,
  type InvalidBehavior,
  type InputWidth,
  type ProjectData,
  type SegmentName,
  type SegmentOutput,
} from '@/types/simulator';
import { DEFAULT_DISPLAY_SETTINGS, buildDefaultProject } from './decoder';
import { presetTable, resizeTable } from './truthTable';

export const PROJECT_VERSION = 1;

export function serializeProject(project: ProjectData): string {
  return JSON.stringify(project, null, 2);
}

export interface ValidateResult {
  ok: boolean;
  data?: ProjectData;
  errors: string[];
}

function isDisplayMode(v: unknown): v is DisplayMode {
  return v === 'decimal' || v === 'hex' || v === 'binary' || v === 'custom' || v === 'raw';
}

function isInvalidBehavior(v: unknown): v is InvalidBehavior {
  return v === 'blank' || v === 'dontcare' || v === 'custom';
}

function isSegmentOutput(v: unknown): v is SegmentOutput {
  return v === 0 || v === 1 || v === 'X';
}

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/**
 * Validate and normalize arbitrary JSON into a ProjectData.
 * Returns engineering-style error messages with codes.
 */
export function validateProject(raw: unknown): ValidateResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['E-200: Project root must be a JSON object.'] };
  }
  const obj = raw as Record<string, unknown>;

  const version = typeof obj.version === 'number' ? obj.version : PROJECT_VERSION;
  if (version > PROJECT_VERSION) {
    errors.push(`E-201: Unsupported project version ${version} (this build supports ${PROJECT_VERSION}).`);
  }

  const name = typeof obj.name === 'string' && obj.name.trim() !== ''
    ? obj.name.trim().slice(0, 100)
    : 'Imported project';
  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    errors.push('E-202: Missing or empty project "name" — using default.');
  }

  let inputBits: InputWidth = 4;
  if (obj.inputBits === 4 || obj.inputBits === 5) inputBits = obj.inputBits;
  else errors.push(`E-203: "inputBits" must be 4 or 5 (got ${JSON.stringify(obj.inputBits)}) — using 4.`);

  if (!isDisplayMode(obj.displayMode)) {
    errors.push(`E-204: Invalid "displayMode" ${JSON.stringify(obj.displayMode)} — using "custom".`);
  }
  const displayMode: DisplayMode = isDisplayMode(obj.displayMode) ? obj.displayMode : 'custom';

  if (!isInvalidBehavior(obj.invalidBehavior)) {
    errors.push(`E-205: Invalid "invalidBehavior" ${JSON.stringify(obj.invalidBehavior)} — using "blank".`);
  }
  const invalidBehavior: InvalidBehavior = isInvalidBehavior(obj.invalidBehavior)
    ? obj.invalidBehavior
    : 'blank';

  let currentInput = 0;
  if (typeof obj.currentInput === 'number' && Number.isInteger(obj.currentInput)) {
    const max = (1 << inputBits) - 1;
    if (obj.currentInput < 0 || obj.currentInput > max) {
      errors.push(`E-206: "currentInput" ${obj.currentInput} out of range 0..${max} — clamped.`);
    }
    currentInput = Math.min(Math.max(obj.currentInput, 0), max);
  } else if (obj.currentInput !== undefined) {
    errors.push('E-207: "currentInput" must be an integer — using 0.');
  }

  // ---- truth table ----
  const fallback = presetTable(inputBits, displayMode === 'binary' || displayMode === 'raw' ? 'custom' : displayMode, invalidBehavior);
  let truthTable = fallback;

  const tt = obj.truthTable;
  if (typeof tt !== 'object' || tt === null || Array.isArray(tt)) {
    errors.push('E-208: Missing or invalid "truthTable" — using preset.');
  } else {
    const t = tt as Record<string, unknown>;
    const rowList = t.rows;
    if (!Array.isArray(rowList)) {
      errors.push('E-209: "truthTable.rows" must be an array — using preset.');
    } else {
      const expected = 1 << inputBits;
      if (rowList.length !== expected) {
        errors.push(
          `E-210: Truth table has ${rowList.length} rows but ${inputBits}-bit input requires ${expected} — ${
            rowList.length > expected ? 'extra rows dropped' : 'missing rows filled with preset'
          }.`,
        );
      }
      const rows = [];
      for (let m = 0; m < expected; m++) {
        const row = rowList[m];
        if (typeof row === 'object' && row !== null && 'outputs' in row) {
          const outputsRaw = (row as Record<string, unknown>).outputs as Record<string, unknown>;
          const outputs = {} as Record<SegmentName, SegmentOutput>;
          for (const seg of SEGMENT_NAMES) {
            const v = outputsRaw?.[seg];
            if (isSegmentOutput(v)) outputs[seg] = v;
            else {
              if (v !== undefined) {
                errors.push(`E-211: Row m${m} segment ${seg} has invalid value ${JSON.stringify(v)} (must be 0, 1 or "X") — using 0.`);
              }
              outputs[seg] = 0;
            }
          }
          rows.push({ input: m, outputs });
        } else {
          errors.push(`E-212: Truth-table row ${m} malformed — filled from preset.`);
          rows.push({ input: m, outputs: { ...fallback.rows[m].outputs } });
        }
      }
      truthTable = { inputBits, rows };
    }
  }

  // ---- display settings ----
  let displaySettings: DisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
  const ds = obj.displaySettings;
  if (typeof ds === 'object' && ds !== null && !Array.isArray(ds)) {
    const d = ds as Record<string, unknown>;
    const merged: DisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
    if (isHexColor(d.activeColor)) merged.activeColor = d.activeColor;
    else if (d.activeColor !== undefined) errors.push(`E-213: Invalid activeColor ${JSON.stringify(d.activeColor)} — using default.`);
    if (isHexColor(d.inactiveColor)) merged.inactiveColor = d.inactiveColor;
    else if (d.inactiveColor !== undefined) errors.push(`E-214: Invalid inactiveColor ${JSON.stringify(d.inactiveColor)} — using default.`);
    if (typeof d.brightness === 'number' && d.brightness > 0 && d.brightness <= 1) merged.brightness = d.brightness;
    if (typeof d.commonAnode === 'boolean') merged.commonAnode = d.commonAnode;
    if (typeof d.reverseLogic === 'boolean') merged.reverseLogic = d.reverseLogic;
    if (typeof d.showDP === 'boolean') merged.showDP = d.showDP;
    if (typeof d.skew === 'boolean') merged.skew = d.skew;
    displaySettings = merged;
  } else if (ds !== undefined) {
    errors.push('E-215: "displaySettings" invalid — using defaults.');
  }

  // ---- cover exclusions / additions ----
  const parseOverrideMap = (source: unknown, label: string): ProjectData['coverExcluded'] => {
    const out: ProjectData['coverExcluded'] = {};
    if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
      for (const seg of SEGMENT_NAMES) {
        const per = (source as Record<string, unknown>)[seg];
        if (typeof per === 'object' && per !== null) {
          const entry: Partial<Record<'sop' | 'pos', string[]>> = {};
          for (const form of ['sop', 'pos'] as const) {
            const list = (per as Record<string, unknown>)[form];
            if (Array.isArray(list) && list.every((x) => typeof x === 'string')) {
              entry[form] = list as string[];
            } else if (list !== undefined) {
              errors.push(`E-216: ${label}.${seg}.${form} must be an array of strings — ignored.`);
            }
          }
          if (entry.sop || entry.pos) out[seg] = entry;
        }
      }
    } else if (source !== undefined) {
      errors.push(`E-217: "${label}" invalid — ignored.`);
    }
    return out;
  };

  const coverExcluded = parseOverrideMap(obj.coverExcluded, 'coverExcluded');
  const coverAdded = parseOverrideMap(obj.coverAdded, 'coverAdded');

  return {
    ok: errors.length === 0,
    errors,
    data: {
      version: PROJECT_VERSION,
      name,
      inputBits,
      displayMode,
      invalidBehavior,
      currentInput,
      truthTable,
      displaySettings,
      coverExcluded,
      coverAdded,
    },
  };
}

/** Rebuild a valid project when switching width with existing data. */
export function migrateInputBits(project: ProjectData, bits: InputWidth): ProjectData {
  return {
    ...project,
    inputBits: bits,
    currentInput: Math.min(project.currentInput, (1 << bits) - 1),
    truthTable: resizeTable(project.truthTable, bits),
  };
}

export { buildDefaultProject };
