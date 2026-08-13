export type StagingArgumentStance = "root" | "pro" | "con";

export type StagingArgument = {
  id: string;
  parentId: string | null;
  rootId: string;
  stance: StagingArgumentStance;
  author: { name: string; kind: "citizen" | "mecky" };
  content: string;
  createdAt: string;
};

export type ArgumentTreeNode = {
  argument: StagingArgument;
  children: ArgumentTreeNode[];
};

export type ArgumentTree = {
  root: ArgumentTreeNode;
  orphans: StagingArgument[];
};

export type SunburstSegment = {
  id: string;
  stance: "pro" | "con";
  depth: number;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
};

function ordered(left: StagingArgument, right: StagingArgument): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function buildArgumentTree(argumentsList: readonly StagingArgument[]): ArgumentTree {
  const byId = new Map<string, StagingArgument>();
  for (const argument of argumentsList) {
    if (byId.has(argument.id)) throw new Error("argument_id_duplicate");
    byId.set(argument.id, argument);
  }
  const roots = argumentsList.filter(
    (argument) => argument.stance === "root" && argument.parentId === null && argument.rootId === argument.id,
  );
  if (roots.length !== 1) throw new Error("argument_root_invalid");
  const root = roots[0]!;
  const attached = new Set<string>([root.id]);

  const visit = (argument: StagingArgument, path: ReadonlySet<string>): ArgumentTreeNode => {
    const nextPath = new Set(path).add(argument.id);
    const children = argumentsList
      .filter((candidate) =>
        candidate.rootId === root.id &&
        candidate.parentId === argument.id &&
        candidate.stance !== "root" &&
        !nextPath.has(candidate.id),
      )
      .sort(ordered)
      .map((child) => {
        attached.add(child.id);
        return visit(child, nextPath);
      });
    return { argument, children };
  };

  const rootNode = visit(root, new Set());
  return {
    root: rootNode,
    orphans: argumentsList.filter((argument) => !attached.has(argument.id)).sort(ordered),
  };
}

function descendantWeight(node: ArgumentTreeNode): number {
  return 1 + node.children.reduce((total, child) => total + descendantWeight(child), 0);
}

export function buildSunburstSegments(root: ArgumentTreeNode): SunburstSegment[] {
  const segments: SunburstSegment[] = [];
  const visit = (node: ArgumentTreeNode, depth: number, startAngle: number, endAngle: number) => {
    const childrenWeight = node.children.reduce((total, child) => total + descendantWeight(child), 0);
    let cursor = startAngle;
    for (const child of node.children) {
      const share = childrenWeight === 0 ? 0 : descendantWeight(child) / childrenWeight;
      const childEnd = cursor + (endAngle - startAngle) * share;
      segments.push({
        id: child.argument.id,
        stance: child.argument.stance as "pro" | "con",
        depth: depth + 1,
        startAngle: cursor,
        endAngle: childEnd,
        innerRadius: 30 + depth * 32,
        outerRadius: 58 + depth * 32,
      });
      visit(child, depth + 1, cursor, childEnd);
      cursor = childEnd;
    }
  };
  visit(root, 0, 0, Math.PI * 2);
  return segments;
}
