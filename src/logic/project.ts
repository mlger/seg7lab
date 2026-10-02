/**
 * Project serialization / validation / migration.
 * Used by import, localStorage hydration and the API layer.
 */
import {
  SEGMENT_NAMES,
  type CustomFont,
  type DisplayMode,
  type DisplaySettings,
  type FontGlyphData,
  type InvalidBehavior,
  type InputWidth,
  type ProjectData,
  type SegmentName,
  type SegmentOutput,
} from '@/types/simulator';
import { DEFAULT_DISPLAY_SETTINGS, buildDefaultProject } from './decoder';
import { presetTable, resizeTable } from './truthTable';
import { isSegmentName } from './font';

export const PROJECT_VERSION = 1;

export const FONT_FILE_FORMAT = 'sevenseg-font';

export interface FontFileResult {
  ok: boolean;
  font?: CustomFont;
  errors: string[];
}

/** Parse and validate a font file ({ format: "sevenseg-font", name, glyphs: [...] }). */
export function parseFontFile(raw: unknown): FontFileResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['E-260: Font file root must be a JSON object.'] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== FONT_FILE_FORMAT) {
    return { ok: false, errors: ['E-261: Not a sevenseg-font file — missing "format": "sevenseg-font".'] };
  }
  const name = typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name.trim().slice(0, 100) : 'Imported font';
  if (!Array.isArray(obj.glyphs)) {
    return { ok: false, errors: ['E-262: Font file "glyphs" must be an array.'] };
  }
  if (obj.glyphs.length === 0) {
    return { ok: false, errors: ['E-263: Font file contains no glyphs.'] };
  }
  if (obj.glyphs.length > 1024) {
    return { ok: false, errors: ['E-264: Font file has too many glyphs (> 1024).'] };
  }
  const glyphs: FontGlyphData[] = [];
  obj.glyphs.forEach((g, i) => {
    if (typeof g === 'object' && g !== null) {
      const char = (g as Record<string, unknown>).char;
      const segs = (g as Record<string, unknown>).segments;
      const charOk = typeof char === 'string' && char.length > 0 && char.length <= 4;
      const segsOk = typeof segs === 'string' && [...segs].every(isSegmentName);
      if (charOk && segsOk) {
        glyphs.push({ char, segments: segs });
        return;
      }
    }
    errors.push(`E-265: Glyph ${i} invalid (needs "char": string and "segments": subset of ABCDEFGDP) — dropped.`);
  });
  if (glyphs.length === 0) {
    return { ok: false, errors: [...errors, 'E-266: No valid glyphs remain after validation.'] };
  }
  return { ok: errors.length === 0, font: { name, glyphs }, errors };
}

export function serializeProject(project: ProjectData): string {
  return JSON.stringify(project, null, 2);
}

export interface ValidateResult {
  ok: boolean;
  data?: ProjectData;
  errors: string[];
}

function isDisplayMode(v: unknown): v is DisplayMode {
  return v === 'decimal' || v === 'hex' || v === 'binary' || v === 'custom' || v === 'raw' || v === 'font';
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

  // ---- font / table-order settings (optional, backward compatible) ----
  let tableStartCode = 0;
  if (obj.tableStartCode !== undefined) {
    if (typeof obj.tableStartCode === 'number' && Number.isInteger(obj.tableStartCode)) {
      tableStartCode = Math.min(Math.max(obj.tableStartCode, 0), (1 << inputBits) - 1);
    } else {
      errors.push('E-218: "tableStartCode" must be an integer — using 0.');
    }
  }

  let fontStart = 0;
  if (obj.fontStart !== undefined) {
    if (typeof obj.fontStart === 'number' && Number.isInteger(obj.fontStart) && obj.fontStart >= 0) {
      fontStart = obj.fontStart;
    } else {
      errors.push('E-219: "fontStart" must be a non-negative integer — using 0.');
    }
  }

  let customFont: CustomFont | undefined;
  if (obj.customFont !== undefined) {
    const parsed = parseFontGlyphsField(obj.customFont);
    if (parsed) customFont = parsed;
    else errors.push('E-220: "customFont" invalid (needs name + glyphs array) — using built-in font.');
  }

  // ---- preset library linkage (optional, backward compatible) ----
  let appliedPresetId: string | undefined;
  if (obj.appliedPresetId !== undefined) {
    if (typeof obj.appliedPresetId === 'string' && obj.appliedPresetId.length > 0 && obj.appliedPresetId.length <= 100) {
      appliedPresetId = obj.appliedPresetId;
    } else {
      errors.push('E-222: "appliedPresetId" must be a non-empty string (≤ 100 chars) — ignored.');
    }
  }

  let appliedPresetName: string | undefined;
  if (obj.appliedPresetName !== undefined) {
    if (typeof obj.appliedPresetName === 'string' && obj.appliedPresetName.trim() !== '' && obj.appliedPresetName.length <= 100) {
      appliedPresetName = obj.appliedPresetName.trim().slice(0, 100);
    } else {
      errors.push('E-223: "appliedPresetName" must be a non-empty string (≤ 100 chars) — ignored.');
    }
  }

  let activeFontId: string | undefined;
  if (obj.activeFontId !== undefined) {
    if (typeof obj.activeFontId === 'string' && obj.activeFontId.length > 0 && obj.activeFontId.length <= 100) {
      activeFontId = obj.activeFontId;
    } else {
      errors.push('E-224: "activeFontId" must be a non-empty string (≤ 100 chars) — ignored.');
    }
  }

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
      tableStartCode,
      fontStart,
      ...(customFont ? { customFont } : {}),
      ...(appliedPresetId !== undefined ? { appliedPresetId } : {}),
      ...(appliedPresetName !== undefined ? { appliedPresetName } : {}),
      ...(activeFontId !== undefined ? { activeFontId } : {}),
    },
  };
}

/** Validate the embedded customFont field of a project (less strict than a font file). */
function parseFontGlyphsField(raw: unknown): CustomFont | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.glyphs) || obj.glyphs.length === 0) return null;
  const name = typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name.trim().slice(0, 100) : 'Custom font';
  const glyphs: FontGlyphData[] = [];
  for (const g of obj.glyphs) {
    if (typeof g === 'object' && g !== null) {
      const char = (g as Record<string, unknown>).char;
      const segs = (g as Record<string, unknown>).segments;
      if (typeof char === 'string' && char.length > 0 && char.length <= 4 && typeof segs === 'string' && [...segs].every(isSegmentName)) {
        glyphs.push({ char, segments: segs });
      }
    }
  }
  if (glyphs.length === 0) return null;
  return { name, glyphs };
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
