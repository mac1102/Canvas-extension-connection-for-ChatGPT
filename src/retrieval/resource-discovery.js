export async function discoverResources(client, courses, graph, optional) {
  const candidates = [];
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
    for (const module of modules.slice(0, 40)) {
      const parent = graph.add("Module", course.id, module.id, { title: module.name }); graph.edge(root, parent, "CONTAINS");
      const items = module.items && module.items.length === module.items_count ? module.items
        : await optional("Module items", () => client.getModuleItems(course.id, module.id), module.items || []);
      for (const item of items) {
        const child = graph.add("ModuleItem", course.id, item.id, { title: item.title }); graph.edge(parent, child, "CONTAINS");
        const remote = item.type === "Page" ? item.page_url : item.content_id || item.id;
        const target = graph.add(item.type, course.id, remote, { title: item.title, moduleId: module.id });
        graph.edge(child, target, "REFERENCES");
        if (target && ["Page", "File"].includes(target.type) && !candidates.includes(target)) candidates.push(target);
      }
    }
  }
  return candidates;
}
