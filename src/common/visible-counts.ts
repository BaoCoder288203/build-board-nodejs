/** Counts that match what the board canvas shows (open lists, live cards). */
export const visibleColumnWhere = {
  deletedAt: null,
  isArchived: false,
} as const;

export const visibleTaskWhere = {
  deletedAt: null,
  column: visibleColumnWhere,
} as const;

export const visibleBoardWhere = {
  deletedAt: null,
  isArchived: false,
} as const;

export const visibleProjectTaskWhere = {
  deletedAt: null,
  board: visibleBoardWhere,
  column: visibleColumnWhere,
} as const;
