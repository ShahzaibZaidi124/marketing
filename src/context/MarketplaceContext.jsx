import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { serviceListings } from "../data/services.js";

const MarketplaceContext = createContext(null);

export function MarketplaceProvider({ children }) {
  const [sellerServices, setSellerServices] = useState([]);
  const [savedServiceIds, setSavedServiceIds] = useState([]);
  const [recentlyViewedServiceIds, setRecentlyViewedServiceIds] = useState([]);
  const [customerProfile, setCustomerProfile] = useState({
    displayName: "Customer",
    username: "",
    email: "",
    country: "",
    city: "",
    description: "",
    interests: "",
  });
  const publishedServices = useMemo(
    () => sellerServices.filter((service) => service.status === "published"),
    [sellerServices],
  );
  const allServices = useMemo(
    () => [...serviceListings, ...publishedServices],
    [publishedServices],
  );

  const getOwnedServices = (username) => sellerServices.filter((service) => service.ownerUsername === username);
  const getOwnedService = (id, username) => sellerServices.find(
    (service) => service.id === id && service.ownerUsername === username,
  );
  const getService = (id) => allServices.find((service) => service.id === id);
  const toggleSavedService = useCallback((id) => {
    if (!id) return;
    setSavedServiceIds((current) => current.includes(id)
      ? current.filter((serviceId) => serviceId !== id)
      : [...current, id]);
  }, []);
  const removeSavedService = useCallback((id) => {
    setSavedServiceIds((current) => current.filter((serviceId) => serviceId !== id));
  }, []);
  const recordRecentlyViewed = useCallback((id) => {
    if (!id) return;
    setRecentlyViewedServiceIds((current) => [id, ...current.filter((serviceId) => serviceId !== id)].slice(0, 6));
  }, []);
  const updateCustomerProfile = useCallback((profile) => {
    setCustomerProfile((current) => ({ ...current, ...profile }));
  }, []);

  const saveSellerService = (service, username) => {
    if (!service.id || !username || service.ownerUsername !== username) return false;
    const existing = sellerServices.find((item) => item.id === service.id);
    if (existing && existing.ownerUsername !== username) return false;

    setSellerServices((current) => {
      const currentIndex = current.findIndex((item) => item.id === service.id);
      if (currentIndex >= 0 && current[currentIndex].ownerUsername !== username) return current;
      if (currentIndex < 0) return [...current, service];
      return current.map((item, index) => index === currentIndex ? service : item);
    });
    return true;
  };

  const deleteSellerService = (id, username) => {
    const service = sellerServices.find((item) => item.id === id);
    if (!service || service.ownerUsername !== username) return false;
    setSellerServices((current) => current.filter(
      (item) => item.id !== id || item.ownerUsername !== username,
    ));
    return true;
  };

  const value = {
    allServices,
    publishedServices,
    sellerServices,
    getOwnedService,
    getOwnedServices,
    getService,
    savedServiceIds,
    toggleSavedService,
    removeSavedService,
    recentlyViewedServiceIds,
    recordRecentlyViewed,
    customerProfile,
    updateCustomerProfile,
    saveSellerService,
    deleteSellerService,
  };

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace() {
  const context = useContext(MarketplaceContext);
  if (!context) throw new Error("useMarketplace must be used within a MarketplaceProvider.");
  return context;
}
