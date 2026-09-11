export class ResourceGraph {
  constructor({ maxNodes = 5000 } = {}) { this.nodes = new Map(); this.keys = new Map(); this.edges = []; this.maxNodes = maxNodes; this.truncated = false; }
  add(type, courseId, remoteId, metadata = {}) {
    const key = JSON.stringify([type, String(courseId), String(remoteId)]);
    if (this.keys.has(key)) { const node = this.nodes.get(this.keys.get(key)); Object.assign(node, metadata); return node; }
    if (this.nodes.size >= this.maxNodes) { this.truncated = true; return null; }
    const node = { ...metadata, local_id: `r${this.nodes.size + 1}`, type, courseId, remoteId };
    this.nodes.set(node.local_id, node); this.keys.set(key, node.local_id); return node;
  }
  edge(from, to, relation = "LINKS") {
    if (!from || !to) return;
    if (!this.edges.some((e) => e.from === from.local_id && e.to === to.local_id && e.relation === relation)) this.edges.push({ from: from.local_id, to: to.local_id, relation });
  }
  distances(roots, maxDepth = 3) {
    const result = new Map(roots.map((node) => [node.local_id, 0])); const queue = [...result.keys()];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i], depth = result.get(id); if (depth >= maxDepth) continue;
      for (const edge of this.edges.filter((e) => e.from === id)) if (!result.has(edge.to)) { result.set(edge.to, depth + 1); queue.push(edge.to); }
    }
    return result;
  }
}
