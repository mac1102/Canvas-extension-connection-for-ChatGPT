import { moduleDateRange } from "./module-schedule.js";
export async function discoverResources(client, courses, graph, optional, { window = null } = {}) {
  const candidates = [];
  candidates.moduleGroups = [];
  for (const course of courses) {
    const root = graph.add("Course", course.id, course.id, { title: course.name });
    const [files, pages, modules] = await Promise.all([
      optional("File metadata", () => client.getFiles(course.id), []),
      optional("Page metadata", () => client.getPages(course.id), []),
      optional("Module metadata", () => client.getModules(course.id), [])
    ]);
    for (const [type, items] of [["File", files], ["Page", pages]]) for (const item of items) {
      const node = graph.add(type, course.id, type === "Page" ? item.url : item.id, {
        title: item.title || item.display_name || item.filename, filename: item.filename,
        updated_at: item.updated_at, size: item.size, contentType: item["content-type"]
      });
      graph.edge(root, node, "CONTAINS"); if (node) candidates.push(node);
    }
    const rankedModules = window ? [...modules].sort((a, b) => {
      const matches = (m) => { const range = moduleDateRange(m.name, window, course); return Number(Boolean(range && range.end >= window.start && range.start <= window.end)); };
      return matches(b) - matches(a);
    }) : modules;
    if (modules.length > 40) candidates.moduleCapReached = true;
    for (const module of rankedModules.slice(0, 40)) {
      if (module.published === false || module.workflow_state === "deleted") continue;
      const parent = graph.add("Module", course.id, module.id, { title: module.name, position: module.position }); graph.edge(root, parent, "CONTAINS");
      const items = module.items && module.items.length === module.items_count ? module.items
        : await optional("Module items", () => client.getModuleItems(course.id, module.id), module.items || []);
      const ordered = [...items].sort((a, b) => (a.position || 0) - (b.position || 0));
      const group = { course, module, items: [], complete: modules.complete !== false && items.complete !== false && items.length === module.items_count };
      candidates.moduleGroups.push(group);
      for (const item of ordered) {
        const child = graph.add("ModuleItem", course.id, item.id, { title: item.title, moduleId: module.id,
          itemType: item.type, position: item.position, contentId: item.content_id, pageUrl: item.page_url, url: item.html_url }); graph.edge(parent, child, "CONTAINS");
        const remote = item.type === "Page" ? item.page_url : item.content_id;
        const target = remote && ["Page", "File", "Assignment"].includes(item.type)
          ? graph.add(item.type, course.id, remote, { title: item.title, moduleId: module.id }) : null;
        group.items.push({ ...item, resourceNode: target });
        graph.edge(child, target, "REFERENCES");
        if (target && ["Page", "File"].includes(target.type) && !candidates.includes(target)) candidates.push(target);
      }
    }
  }
  return candidates;
}
