import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ListFilter, Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import MarketplaceServiceCard from "../components/MarketplaceServiceCard.jsx";
import { serviceCategories } from "../data/services.js";
import { useMarketplace } from "../context/MarketplaceContext.jsx";

const sortOptions = [
  { value: "recommended", label: "Recommended" },
  { value: "price-low", label: "Price: Low to High" },
  { value: "price-high", label: "Price: High to Low" },
  { value: "newest", label: "Newest" },
];

const deliveryOptions = [
  { value: "", label: "Any delivery time" },
  { value: "3", label: "Up to 3 days" },
  { value: "7", label: "Up to 7 days" },
  { value: "14", label: "Up to 14 days" },
];

function isValidCategory(categoryId) {
  return categoryId === "all" || serviceCategories.some((category) => category.id === categoryId);
}

export default function ExploreServices() {
  const { allServices } = useMarketplace();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryFromUrl = searchParams.get("category") || "all";
  const [selectedCategory, setSelectedCategory] = useState(
    isValidCategory(categoryFromUrl) ? categoryFromUrl : "all",
  );
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [deliveryLimit, setDeliveryLimit] = useState("");
  const [sellerInput, setSellerInput] = useState("");
  const [sortOrder, setSortOrder] = useState("recommended");

  useEffect(() => {
    setSelectedCategory(isValidCategory(categoryFromUrl) ? categoryFromUrl : "all");
  }, [categoryFromUrl]);

  const filteredServices = useMemo(() => {
    const min = minPrice === "" ? 0 : Number(minPrice);
    const max = maxPrice === "" ? Infinity : Number(maxPrice);
    const sellerTerm = sellerInput.trim().toLowerCase();

    return allServices
      .filter((service) => {
        const matchesTitle = !searchTerm || service.title.toLowerCase().includes(searchTerm);
        const matchesCategory = selectedCategory === "all" || service.categoryId === selectedCategory;
        const matchesPrice = service.price >= min && service.price <= max;
        const matchesDelivery = !deliveryLimit || service.deliveryDays <= Number(deliveryLimit);
        const matchesSeller = !sellerTerm || service.seller.toLowerCase().includes(sellerTerm);
        return matchesTitle && matchesCategory && matchesPrice && matchesDelivery && matchesSeller;
      })
      .sort((first, second) => {
        if (sortOrder === "price-low") return first.price - second.price;
        if (sortOrder === "price-high") return second.price - first.price;
        if (sortOrder === "newest") return Date.parse(second.createdAt) - Date.parse(first.createdAt);
        return first.recommendedOrder - second.recommendedOrder;
      });
  }, [allServices, deliveryLimit, maxPrice, minPrice, searchTerm, selectedCategory, sellerInput, sortOrder]);

  function chooseCategory(categoryId) {
    setSelectedCategory(categoryId);
    setSearchParams(categoryId === "all" ? {} : { category: categoryId });
  }

  function searchServices(event) {
    event.preventDefault();
    setSearchTerm(searchInput.trim().toLowerCase());
  }

  function clearFilters() {
    setSearchInput("");
    setSearchTerm("");
    setMinPrice("");
    setMaxPrice("");
    setDeliveryLimit("");
    setSellerInput("");
    setSortOrder("recommended");
    setSelectedCategory("all");
    setSearchParams({});
  }

  const hasActiveFilters = Boolean(
    searchTerm || selectedCategory !== "all" || minPrice || maxPrice || deliveryLimit || sellerInput,
  );

  return (
    <main className="explore-page">
      <section className="explore-page-intro">
        <div className="market-section explore-intro-inner">
          <span className="market-eyebrow"><span className="market-eyebrow-dot" /> THE NEXTECH MARKETPLACE</span>
          <h1>Explore Website Services</h1>
          <p>Find talented developers to build your perfect website.</p>
          <form className="explore-search" onSubmit={searchServices} role="search">
            <Search size={19} aria-hidden="true" />
            <input
              aria-label="Search services by title"
              placeholder="Search website services by title..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput && (
              <button className="explore-search-clear" type="button" aria-label="Clear search text" onClick={() => { setSearchInput(""); setSearchTerm(""); }}>
                <X size={16} />
              </button>
            )}
            <button className="market-button market-button-primary" type="submit">Search <ArrowRight size={16} /></button>
          </form>
          <span className="explore-sample-note">Sample and seller preview listings · Seller previews are session-only</span>
        </div>
      </section>

      <div className="market-section explore-layout">
        <aside className="explore-filters" aria-label="Service filters">
          <div className="filter-heading"><h2><ListFilter size={17} /> Filters</h2><button type="button" onClick={clearFilters}>Clear all</button></div>

          <fieldset className="filter-group">
            <legend>Categories</legend>
            <div className="filter-category-list">
              <button className={selectedCategory === "all" ? "filter-category active" : "filter-category"} type="button" aria-pressed={selectedCategory === "all"} onClick={() => chooseCategory("all")}>
                <span>All categories</span><small>{allServices.length}</small>
              </button>
              {serviceCategories.map((category) => {
                const count = allServices.filter((service) => service.categoryId === category.id).length;
                return (
                  <button
                    className={selectedCategory === category.id ? "filter-category active" : "filter-category"}
                    key={category.id}
                    type="button"
                    aria-pressed={selectedCategory === category.id}
                    onClick={() => chooseCategory(category.id)}
                  >
                    <span>{category.name}</span><small>{count}</small>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="filter-group">
            <legend>Price range (PKR)</legend>
            <div className="price-inputs">
              <label><span>Min</span><input aria-label="Minimum price in PKR" type="number" min="0" step="1000" placeholder="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} /></label>
              <span className="price-separator">–</span>
              <label><span>Max</span><input aria-label="Maximum price in PKR" type="number" min="0" step="1000" placeholder="Any" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset className="filter-group">
            <legend>Delivery time</legend>
            <select aria-label="Filter by delivery time" value={deliveryLimit} onChange={(event) => setDeliveryLimit(event.target.value)}>
              {deliveryOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </fieldset>

          <fieldset className="filter-group">
            <legend>Seller name</legend>
            <input className="seller-filter-input" aria-label="Search by seller name" placeholder="Enter a seller name" value={sellerInput} onChange={(event) => setSellerInput(event.target.value)} />
          </fieldset>
        </aside>

        <section className="explore-results" aria-label="Website development services">
          <div className="explore-results-heading">
            <div><h2>            {selectedCategory === "all" ? "Website development services" : serviceCategories.find((category) => category.id === selectedCategory)?.name}</h2><p>{filteredServices.length} {filteredServices.length === 1 ? "service" : "services"}</p></div>
            <label className="sort-control"><span>Sort by</span><select aria-label="Sort services" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>{sortOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          </div>

          {filteredServices.length > 0 ? (
            <div className="browse-service-grid">
              {filteredServices.map((service) => <MarketplaceServiceCard service={service} key={service.id} />)}
            </div>
          ) : (
            <div className="explore-empty-state">
              <span className="category-icon"><Search size={20} /></span>
              <h3>No matching services</h3>
              <p>Try adjusting your search or clearing one or more filters.</p>
              {hasActiveFilters && <button className="market-button market-button-outline" type="button" onClick={clearFilters}>Clear all filters</button>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
