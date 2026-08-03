type ProjectOrderItem = {
  readonly key: string;
};

export function mergeHomeProjectOrder<T extends ProjectOrderItem>(
  projects: readonly T[],
  rankedKeys: readonly string[],
): readonly T[] {
  const ranks = rankedKeys.reduce((result, key, index) => {
    if (!result.has(key)) result.set(key, index);
    return result;
  }, new Map<string, number>());

  return Object.freeze(
    projects
      .map((project, index) => ({ project, index, rank: ranks.get(project.key) }))
      .sort((left, right) => {
        if (left.rank !== undefined && right.rank !== undefined) return left.rank - right.rank;
        if (left.rank !== undefined) return -1;
        if (right.rank !== undefined) return 1;
        return left.index - right.index;
      })
      .map((entry) => entry.project),
  );
}

export function buildHomeProjectDrop(options: {
  readonly projects: readonly ProjectOrderItem[];
  readonly rankedKeys: readonly string[];
  readonly sourceKey: string;
  readonly anchorKey: string;
  readonly dropAfter: boolean;
  readonly cap: number;
}): readonly string[] {
  const mountedKeys = options.projects.map((project) => project.key);
  const fullOrder = [
    ...options.rankedKeys,
    ...mergeHomeProjectOrder(options.projects, options.rankedKeys)
      .map((project) => project.key)
      .filter((key) => !options.rankedKeys.includes(key)),
  ];

  if (
    options.sourceKey === options.anchorKey ||
    !fullOrder.includes(options.sourceKey) ||
    !fullOrder.includes(options.anchorKey)
  ) {
    return pruneHomeProjectOrder(fullOrder, mountedKeys, options.cap);
  }

  const withoutSource = fullOrder.filter((key) => key !== options.sourceKey);
  const anchorIndex = withoutSource.indexOf(options.anchorKey);
  const insertionIndex = anchorIndex + (options.dropAfter ? 1 : 0);
  return pruneHomeProjectOrder(
    [
      ...withoutSource.slice(0, insertionIndex),
      options.sourceKey,
      ...withoutSource.slice(insertionIndex),
    ],
    mountedKeys,
    options.cap,
  );
}

function pruneHomeProjectOrder(
  nextOrder: readonly string[],
  mountedKeys: readonly string[],
  cap: number,
): readonly string[] {
  const uniqueOrder = [...new Set(nextOrder)];
  const normalizedCap = Math.max(0, Math.floor(cap));
  if (uniqueOrder.length <= normalizedCap) return Object.freeze(uniqueOrder);

  const mounted = new Set(mountedKeys);
  const staleCapacity = Math.max(
    0,
    normalizedCap - uniqueOrder.filter((key) => mounted.has(key)).length,
  );
  const staleKeys = uniqueOrder.filter((key) => !mounted.has(key));
  const staleToKeep = new Set(staleCapacity === 0 ? [] : staleKeys.slice(-staleCapacity));
  return Object.freeze(uniqueOrder.filter((key) => mounted.has(key) || staleToKeep.has(key)));
}
