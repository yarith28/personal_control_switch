// Commits arrive newest first in topological order. Each live lane tracks a
// parent that has yet to appear, so shared ancestors join the same lane.
export function layoutCommitGraph(commits) {
  const lanes = [];
  const rows = [];
  let nextColor = 0;
  let laneCount = 1;

  for (const commit of commits) {
    const before = lanes.slice();
    let lane = lanes.findIndex((item) => item?.sha === commit.sha);
    if (lane < 0) {
      lane = lanes.findIndex((item) => !item);
      if (lane < 0) lane = lanes.length;
    }
    const color = lanes[lane]?.color ?? nextColor++;
    const incoming = before[lane]?.sha === commit.sha;
    lanes[lane] = null;
    const edges = [];

    for (const [parentIndex, parent] of commit.parents.entries()) {
      let parentLane = lanes.findIndex((item) => item?.sha === parent);
      if (parentLane < 0) {
        parentLane = parentIndex === 0 && !lanes[lane] ? lane : lanes.findIndex((item) => !item);
        if (parentLane < 0) parentLane = lanes.length;
        lanes[parentLane] = {
          sha: parent,
          color: parentIndex === 0 ? color : nextColor++,
          dashed: Boolean(commit.workingTree),
        };
      }
      edges.push({ lane: parentLane, color: lanes[parentLane].color });
    }

    rows.push({
      lane,
      color,
      incoming,
      incomingDashed: Boolean(before[lane]?.dashed),
      through: before.flatMap((item, index) => item && index !== lane ? [{ lane: index, ...item }] : []),
      edges,
    });
    laneCount = Math.max(laneCount, lane + 1, lanes.length);
  }

  return { rows, laneCount, continues: lanes.some(Boolean) };
}
