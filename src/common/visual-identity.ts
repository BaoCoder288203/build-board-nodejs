const WORKSPACE_PALETTES = [
  { from: "#0C66E4", to: "#579DFF" },
  { from: "#216E4E", to: "#4BCE97" },
  { from: "#C25100", to: "#F5CD47" },
  { from: "#172B4D", to: "#626F86" },
  { from: "#5E4DB2", to: "#9F8FEF" },
  { from: "#AE2A19", to: "#F87168" },
  { from: "#0055CC", to: "#85B8FF" },
  { from: "#1F845A", to: "#7EE2B8" },
] as const;

const NATURE_COVER_SEEDS = [
  "nature-forest",
  "nature-mountain",
  "nature-lake",
  "nature-ocean",
  "nature-valley",
  "nature-desert",
  "nature-river",
  "nature-meadow",
  "nature-cliff",
  "nature-waterfall",
  "nature-sunset",
  "nature-coast",
] as const;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function pickWorkspaceTheme(seed: string) {
  const palette = WORKSPACE_PALETTES[hashSeed(seed) % WORKSPACE_PALETTES.length];
  return { themeColorFrom: palette.from, themeColorTo: palette.to };
}

export function extractProjectInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const firstWord = trimmed.split(/\s+/)[0] ?? trimmed;
  const char = [...firstWord][0];
  return char ? char.toUpperCase() : "?";
}

export function buildBoardCoverUrl(
  boardId: string,
  width = 640,
  height = 360,
): string {
  const seedBase = NATURE_COVER_SEEDS[hashSeed(boardId) % NATURE_COVER_SEEDS.length];
  const seed = `${seedBase}-${boardId}`;
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;
}

export function resolveWorkspaceTheme(workspace: {
  id: string;
  themeColorFrom?: string | null;
  themeColorTo?: string | null;
}) {
  if (workspace.themeColorFrom && workspace.themeColorTo) {
    return {
      themeColorFrom: workspace.themeColorFrom,
      themeColorTo: workspace.themeColorTo,
    };
  }
  return pickWorkspaceTheme(workspace.id);
}

export function resolveProjectTheme(project: {
  id: string;
  name: string;
  icon?: string | null;
  themeColorFrom?: string | null;
  themeColorTo?: string | null;
  color?: string | null;
}) {
  const theme =
    project.themeColorFrom && project.themeColorTo
      ? {
          themeColorFrom: project.themeColorFrom,
          themeColorTo: project.themeColorTo,
        }
      : project.color
        ? {
            themeColorFrom: project.color,
            themeColorTo: project.color,
          }
        : pickWorkspaceTheme(project.id);

  return {
    icon: project.icon ?? extractProjectInitial(project.name),
    ...theme,
  };
}

export function resolveBoardCover(board: {
  id: string;
  coverUrl?: string | null;
}) {
  return {
    coverUrl: board.coverUrl ?? buildBoardCoverUrl(board.id),
  };
}
