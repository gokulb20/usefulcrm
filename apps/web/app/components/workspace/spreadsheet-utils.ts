import type { CellBase, Matrix, Selection, Point } from "react-spreadsheet";
import { createEmptyMatrix } from "react-spreadsheet";
import { utils, type WorkSheet } from "xlsx";

// ---------------------------------------------------------------------------
// File extension helpers
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set(["csv", "tsv"]);

export function fileExt(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function isTextSpreadsheet(filename: string): boolean {
  return TEXT_EXTENSIONS.has(fileExt(filename));
}

// ---------------------------------------------------------------------------
// Cell reference helpers
// ---------------------------------------------------------------------------

/** Convert zero-based column index to Excel-style label (A, B, ..., Z, AA, AB, ...) */
export function columnLabel(idx: number): string {
  let label = "";
  let n = idx;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Format a cell coordinate as an Excel-style reference like "C7" */
export function cellRef(point: Point): string {
  return `${columnLabel(point.column)}${point.row + 1}`;
}

// ---------------------------------------------------------------------------
// Data conversion
// ---------------------------------------------------------------------------

/** Convert an xlsx WorkSheet to a react-spreadsheet data matrix */
export function sheetToMatrix(sheet: WorkSheet): Matrix<CellBase> {
  const raw: unknown[][] = utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });
  if (raw.length === 0) {return createEmptyMatrix<CellBase>(1, 1);}

  const maxCols = raw.reduce((m, r) => Math.max(m, r.length), 0);
  return raw.map((row) => {
    const cells: (CellBase | undefined)[] = [];
    for (let c = 0; c < maxCols; c++) {
      const v = c < row.length ? row[c] : "";
      cells.push({ value: v == null ? "" : v });
    }
    return cells;
  });
}

/** Convert a react-spreadsheet data matrix to an xlsx WorkSheet */
export function matrixToSheet(data: Matrix<CellBase>): WorkSheet {
  const aoa: unknown[][] = data.map((row) =>
    (row ?? []).map((cell) => (cell ? cell.value : "")),
  );
  return utils.aoa_to_sheet(aoa);
}

/** Convert data matrix to CSV text */
export function matrixToCsv(data: Matrix<CellBase>, sep = ","): string {
  return data
    .map((row) =>
      (row ?? [])
        .map((cell) => {
          const v = cell ? String(cell.value) : "";
          if (v.includes(sep) || v.includes('"') || v.includes("\n")) {
            return `"${v.replace(/"/g, '""')}"`;
          }
          return v;
        })
        .join(sep),
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Selection statistics
// ---------------------------------------------------------------------------

export type SelectionStatsResult = {
  count: number;
  numericCount: number;
  sum: number;
  avg: number;
};

/** Compute summary stats for numeric cells in current selection */
export function selectionStats(
  data: Matrix<CellBase>,
  sel: Selection | null,
): SelectionStatsResult | null {
  if (!sel) {return null;}
  const range = sel.toRange(data);
  if (!range) {return null;}

  let count = 0;
  let numericCount = 0;
  let sum = 0;

  for (const pt of range) {
    const cell = data[pt.row]?.[pt.column];
    if (!cell) {continue;}
    count++;
    const n = Number(cell.value);
    if (cell.value !== "" && !isNaN(n)) {
      numericCount++;
      sum += n;
    }
  }

  if (count <= 1) {return null;}
  return { count, numericCount, sum, avg: numericCount > 0 ? sum / numericCount : 0 };
}
