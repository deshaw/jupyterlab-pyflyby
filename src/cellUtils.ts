import { toArray } from '@lumino/algorithm';
import { MultilineString } from '@jupyterlab/nbformat';
import { ICellModel } from '@jupyterlab/cells';
import { PYFLYBY_END_MSG, PYFLYBY_START_MSG } from './constants';

// FIXME: There's got to be a better Typescript solution
// for distinguishing between members of a union type at runtime.
export const normalizeMultilineString = (source: MultilineString): string[] => {
  // Multilinestring can be an array of strings or string
  return typeof source === 'string' ? source.split('\n') : source;
};

/**
 * Very hacky code snippets to check if a line could be a code statement.
 * This could go wrong in a lot of ways and will just work in the
 * most common use cases.
 *
 * Expected to return true for import and code blocks
 */
export const couldBeCode = (line: string): boolean => {
  return (
    !(
      line.startsWith('#') ||
      line.startsWith('"""') ||
      line.trim() === '' ||
      line.match(/^\s.*$/)
    ) || line.startsWith('%')
  );
};

export const couldBeImportStatement = (line: string): boolean => {
  return (
    couldBeCode(line) &&
    (line.includes('__future__') ||
      line.split(' ').indexOf('import') !== -1 ||
      line.includes('import_all_names'))
  );
};

/**
 * It is safe to insert import only if current line is empty or doesn't start with a whitespace
 * */
export const safeToinsertImport = (line: string): boolean => {
  return line.trim() === '' || !line.match(/^\s.*$/);
};

/**
 * Takes in a list of cell models and returns
 * the first *code* cell that
 *
 * - doesn't start with a line or cell magic
 *   (If it is line magic, should we inspect the following block of code?)
 * - isn't all import blocks and comments.
 *
 * @param cellModels - an array of cell models
 */
export const findCell = (cellModels: ICellModel[]): number => {
  const cellsArray = toArray(cellModels);
  for (let i = 0; i < cellsArray.length; i++) {
    const cellModel = cellsArray[i];
    if (cellModel.type === 'code') {
      const lines: string[] = normalizeMultilineString(
        cellModel.toJSON().source
      );
      // FIXME: Deal with line magics better.
      if (
        lines.length > 0 &&
        !lines[0].startsWith('%') &&
        !lines[0].startsWith('"""')
      ) {
        for (let j = 0; j < lines.length; j++) {
          if (couldBeCode(lines[j])) {
            return i;
          }
        }
      }
    }
  }
  return -1;
};

/**
 * Find the last import in a cell and return the position after that.
 *
 * If no imports exist, but code does, return 0.
 *
 * Else, it is likely an empty cell or a comment cell. Return -1.
 *
 * If we decide to reformat on each import, we can change this to
 * insert at the end of any code cell and just
 *
 * @param cell - a cell model
 */
export const findLinePos = (cell: ICellModel): number => {
  const lines: string[] = normalizeMultilineString(cell.toJSON().source);
  for (let i = lines.length - 1; i >= 0; i--) {
    // If PYFLYBY_END_MSG is found, add new import statement above it
    if (lines[i] === PYFLYBY_END_MSG.substr(0, PYFLYBY_END_MSG.length - 1)) {
      let pos = 0;
      for (let j = 0; j < i - 1; j++) {
        pos += lines[j].length + 1;
      }
      return pos;
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (
      couldBeImportStatement(lines[i]) &&
      (i === lines.length - 1 || safeToinsertImport(lines[i + 1]))
    ) {
      let pos = 0;
      for (let j = 0; j <= i; j++) {
        pos += lines[j].length + 1;
      }
      return pos;
    }
  }
  // Cell contains only comments or magics, so return -1.
  // These imports will be moved to next cell
  return -1;
};

/**
 * This code extracts non-imports lines from the pyflyby cell.
 *
 * @param cell - a cell model
 */
export const extractCodeFromPyflybyCell = (cell: ICellModel): string => {
  const lines: string[] = normalizeMultilineString(cell.toJSON().source);

  let stIdx = -1,
    enIdx = -1;
  for (let i = 0; i < lines.length; ++i) {
    if (lines[i] === PYFLYBY_START_MSG.trim()) {
      stIdx = i;
    }
    if (lines[i] === PYFLYBY_END_MSG.trim()) {
      enIdx = i;
    }
  }

  // we splice it twice to remove the pyflyby messages
  const imports: string = lines
    .splice(stIdx, enIdx - stIdx + 1)
    .splice(stIdx + 1, enIdx - stIdx - 1)
    .join();
  const remainingCode: string = lines.join('');
  console.log(imports, remainingCode);
  return remainingCode;
};
