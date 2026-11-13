import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { categories, templates } from "../data/templates.js";
import TemplateCard from "./TemplateCard.jsx";

export default function TemplateGrid({ featured = false }) {
  const [category, setCategory] = useState("All templates");
  const [query, setQuery] = useState("");
  const searchInput = useRef(null);

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesCategory = category === "All templates" || template.category === category;
      const matchesSearch =
        !needle ||
        `${template.name} ${template.category} ${template.description}`.toLowerCase().includes(needle);
      return matchesCategory && matchesSearch;
    }).slice(0, featured ? 3 : undefined);
  }, [category, featured, query]);

  return (
    <div className="marketplace">
      <div className="marketplace-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            ref={searchInput}
            aria-label="Search templates"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a starting point..."
          />
          <kbd>⌘ K</kbd>
        </div>
        <span className="template-count"><SlidersHorizontal size={14} /> {filtered.length} thoughtfully made templates</span>
      </div>
      <div className="category-list" aria-label="Filter by category">
        {categories.map((item) => (
          <button
            key={item}
            className={`category-chip${category === item ? " category-chip-active" : ""}`}
            onClick={() => setCategory(item)}
            type="button"
            aria-pressed={category === item}
          >
            {item}
          </button>
        ))}
      </div>
      {filtered.length > 0 ? (
        <div className="template-grid">
          {filtered.map((template, index) => (
            <div className="card-reveal" style={{ "--card-delay": `${index * 55}ms` }} key={template.id}>
              <TemplateCard template={template} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-search">
          <span className="empty-search-icon"><Search size={21} /></span>
          <h3>No templates found — yet.</h3>
          <p>Try a different search or category. The right starting point is here somewhere.</p>
          <button className="button button-outline" onClick={() => { setCategory("All templates"); setQuery(""); }}>Clear filters</button>
        </div>
      )}
    </div>
  );
}
